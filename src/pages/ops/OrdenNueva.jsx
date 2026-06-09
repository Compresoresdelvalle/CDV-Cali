import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftCircle,
  User,
  Wrench,
  ClipboardList,
  FileText,
  Link2,
  X,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, safeError } from "../../lib/utils";
import SelectorCotizacionExistente from "../../components/ot/SelectorCotizacionExistente";
import ClientePicker from "../../components/forms/ClientePicker";
import { upsertCliente } from "../../lib/clientes";

export default function OrdenNueva() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteTelefono, setClienteTelefono] = useState("");
  // Datos adicionales del cliente (al elegir uno existente). No tienen campo
  // propio en la OT pero se reutilizan en el upsert para conservarlos.
  const [clienteId, setClienteId] = useState(null);
  const [clienteIdentificacion, setClienteIdentificacion] = useState("");
  const [clienteEmail, setClienteEmail] = useState("");
  const [clienteDireccion, setClienteDireccion] = useState("");
  const [equipoDescripcion, setEquipoDescripcion] = useState("");
  const [equipoSerie, setEquipoSerie] = useState("");
  const [diagnostico, setDiagnostico] = useState("");
  const [costoManoObra, setCostoManoObra] = useState("0");
  const [tecnicoId, setTecnicoId] = useState("");
  const [tecnicos, setTecnicos] = useState([]);
  const [observaciones, setObservaciones] = useState("");

  // Fase 10 §10.6: asociar cotización existente al crear la OT
  const [cotizacionVinculada, setCotizacionVinculada] = useState(null); // {id, numero, total, items: []}
  const [showSelector, setShowSelector] = useState(false);
  const [cargandoCotizacion, setCargandoCotizacion] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);

  useEffect(() => {
    const cargarTecnicos = async () => {
      try {
        let q = supabase
          .from("usuarios")
          .select("id, nombre, rol, sede_id")
          .eq("activo", true)
          .in("rol", ["Tecnico", "Admin"])
          .order("nombre");
        // Sin filtro por sede: hay un solo técnico para toda la empresa y se le
        // puede asignar OT de cualquier sede.
        const { data, error } = await q;
        if (error) throw error;
        setTecnicos(data ?? []);
        // Si el usuario actual es Tecnico, preseleccionarlo
        if (perfil?.rol === "Tecnico") setTecnicoId(perfil.id);
      } catch (err) {
        console.error("[OrdenNueva] tecnicos:", err);
      }
    };
    cargarTecnicos();
  }, [perfil?.id, perfil?.rol, perfil?.sede_id]);

  // Asociar cotización existente: cargar datos y reciclar campos vacíos
  const onSeleccionarCotizacion = async (cotId) => {
    setShowSelector(false);
    setCargandoCotizacion(true);
    setError("");
    try {
      const [{ data: cot, error: e1 }, { data: items, error: e2 }] =
        await Promise.all([
          supabase
            .from("cotizaciones")
            .select(
              "id, numero, total, cliente_nombre, cliente_telefono, observaciones",
            )
            .eq("id", cotId)
            .single(),
          supabase
            .from("detalle_cotizacion")
            .select(
              "cantidad, precio_unitario, subtotal, producto:producto_id(id, nombre, referencia)",
            )
            .eq("cotizacion_id", cotId),
        ]);
      if (e1) throw e1;
      if (e2) throw e2;
      // Reciclar SOLO los campos vacíos (no sobrescribir lo que ya escribió el usuario)
      if (!clienteNombre.trim() && cot.cliente_nombre)
        setClienteNombre(cot.cliente_nombre);
      if (!clienteTelefono.trim() && cot.cliente_telefono)
        setClienteTelefono(cot.cliente_telefono);
      if (!observaciones.trim()) {
        const ref = `Asociada a cotización #${cot.numero} (total: ${formatCOP(cot.total)})`;
        setObservaciones(
          cot.observaciones ? `${cot.observaciones}\n${ref}` : ref,
        );
      }
      setCotizacionVinculada({
        id: cot.id,
        numero: cot.numero,
        total: cot.total,
        items: items ?? [],
      });
    } catch (err) {
      setError(safeError(err, "Error al cargar la cotización"));
    } finally {
      setCargandoCotizacion(false);
    }
  };

  const desvincularCotizacion = () => setCotizacionVinculada(null);

  const guardar = async (e) => {
    e.preventDefault();
    if (!clienteNombre.trim() || !equipoDescripcion.trim()) {
      setError("Cliente y equipo son obligatorios");
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const costo = Math.max(0, parseFloat(costoManoObra) || 0);
      // La OT pertenece a la sede de QUIEN LA CREA (de ahí salen los repuestos) y
      // así cumple el RLS os_insert (no-Admin debe insertar en su propia sede). El
      // técnico asignado puede ser de otra sede. El Admin sí puede crearla para la
      // sede del técnico (su RLS permite cualquier sede).
      const tecnicoSeleccionado = tecnicos.find((t) => t.id === tecnicoId);
      const sedeOrden =
        perfil?.rol === "Admin"
          ? (tecnicoSeleccionado?.sede_id ?? perfil?.sede_id)
          : perfil?.sede_id;
      if (!sedeOrden) {
        setError(
          "No se pudo determinar la sede. Revisa que tu usuario o el técnico tenga sede asignada.",
        );
        setSaving(false);
        savingRef.current = false;
        return;
      }
      // Bloque 0 #2: guardar/reutilizar cliente para el autocompletado y obtener
      // su id. Si el upsert falla NO debe romper la creación de la OT.
      let clienteIdFinal = clienteId;
      const cli = await upsertCliente({
        nombre: clienteNombre,
        identificacion: clienteIdentificacion,
        telefono: clienteTelefono,
        email: clienteEmail,
        direccion: clienteDireccion,
      });
      if (cli?.id) clienteIdFinal = cli.id;

      const { data, error: e2 } = await supabase
        .from("ordenes_servicio")
        .insert({
          cliente_nombre: clienteNombre.trim(),
          cliente_telefono: clienteTelefono.trim() || null,
          cliente_id: clienteIdFinal || null,
          equipo_descripcion: equipoDescripcion.trim(),
          equipo_serie: equipoSerie.trim() || null,
          diagnostico: diagnostico.trim() || null,
          tecnico_id: tecnicoId || null,
          // B7: registrar quién creó la OT (independiente del técnico asignado).
          creado_por: perfil?.id || null,
          sede_id: sedeOrden,
          estado: "abierta",
          costo_mano_obra: costo,
          costo_repuestos: 0,
          total: costo,
          observaciones: observaciones.trim() || null,
        })
        .select("id")
        .single();
      if (e2) throw e2;
      // Vincular cotización si existe
      if (cotizacionVinculada?.id) {
        const { error: linkErr } = await supabase
          .from("cotizaciones")
          .update({ ot_id: data.id })
          .eq("id", cotizacionVinculada.id);
        if (linkErr) {
          console.warn("[OrdenNueva] No se pudo vincular cotización", linkErr);
          // OT ya creada — continuar al detalle aunque falle el vínculo
        }
      }
      navigate(`/ops/ordenes/${data.id}`);
    } catch (err) {
      console.error("[OrdenNueva] guardar:", err);
      setError(safeError(err, "Error al crear la orden"));
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4 px-4 py-5 sm:px-7 sm:py-6 animate-fade-in">
      <button
        onClick={() => navigate("/ops/ordenes")}
        className="back-btn inline-flex items-center gap-1.5"
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver a Órdenes
      </button>

      <div className="border-b pb-4" style={{ borderColor: "var(--n-100)" }}>
        <div className="ph-eyebrow">Nueva orden de servicio</div>
        <h1 className="ph-client" style={{ marginBottom: 0 }}>
          Registrar OT
        </h1>
        <p className="ph-sub mt-1.5">
          Registra el equipo y diagnóstico inicial.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-[10px] border px-4 py-3 text-sm"
          style={{
            backgroundColor: "var(--dang-50)",
            borderColor: "var(--dang-border)",
            color: "var(--dang-700)",
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={guardar} className="flex flex-col gap-4">
        {/* Cotización vinculada (opcional) */}
        <div className="iblock">
          <div className="ib-head">
            <div className="ib-ico">
              <Link2 className="h-3.5 w-3.5" strokeWidth={1.7} />
            </div>
            <div className="ib-title">Cotización vinculada (opcional)</div>
          </div>
          {cotizacionVinculada ? (
            <div
              className="space-y-2 rounded-lg border p-3.5"
              style={{
                backgroundColor: "var(--info-50)",
                borderColor: "var(--info-border)",
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p
                    className="text-sm font-semibold"
                    style={{ color: "var(--info-700)" }}
                  >
                    Cotización #{cotizacionVinculada.numero} ·{" "}
                    {formatCOP(cotizacionVinculada.total)}
                  </p>
                  <p
                    className="mt-1 text-xs leading-[1.5]"
                    style={{ color: "var(--n-500)" }}
                  >
                    {cotizacionVinculada.items.length} ítem(s) cotizado(s).
                    Quedará vinculada al guardar la OT. Los repuestos se agregan
                    después en el detalle (no se descuentan automáticamente del
                    inventario hasta que el técnico los use).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={desvincularCotizacion}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 text-xs font-medium"
                  style={{
                    height: 48,
                    borderColor: "var(--dang-border)",
                    color: "var(--dang-700)",
                  }}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.8} />
                  Desvincular
                </button>
              </div>
              {cotizacionVinculada.items.length > 0 && (
                <ul
                  className="mt-2 space-y-0.5 border-t pt-2 text-xs"
                  style={{ borderColor: "var(--n-150)" }}
                >
                  {cotizacionVinculada.items.map((it, i) => (
                    <li key={i} style={{ color: "var(--n-500)" }}>
                      • {it.producto?.nombre ?? "—"} (
                      {it.producto?.referencia ?? "?"}) × {it.cantidad} ={" "}
                      {formatCOP(it.subtotal)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowSelector(true)}
              disabled={cargandoCotizacion}
              className="inline-flex items-center gap-1.5 rounded-lg border px-4 text-sm font-medium disabled:opacity-50"
              style={{
                height: 48,
                borderColor: "var(--p-200)",
                color: "var(--p-700)",
                backgroundColor: "var(--n-0)",
              }}
            >
              <Link2 className="h-4 w-4" strokeWidth={1.7} />
              {cargandoCotizacion
                ? "Cargando cotización…"
                : "Asociar cotización existente (opcional)"}
            </button>
          )}
        </div>

        {/* Cliente */}
        <div className="iblock">
          <div className="ib-head">
            <div className="ib-ico">
              <User className="h-3.5 w-3.5" strokeWidth={1.7} />
            </div>
            <div className="ib-title">Cliente</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre *">
              <ClientePicker
                value={clienteNombre}
                onChange={(v) => {
                  setClienteNombre(v);
                  // Texto libre → ya no corresponde a un cliente existente.
                  setClienteId(null);
                }}
                onSelect={(c) => {
                  setClienteNombre(c.nombre ?? "");
                  setClienteId(c.id ?? null);
                  setClienteIdentificacion(c.identificacion ?? "");
                  setClienteEmail(c.email ?? "");
                  setClienteDireccion(c.direccion ?? "");
                  if (c.telefono) setClienteTelefono(c.telefono);
                }}
                required
                placeholder="Buscar o escribir cliente…"
              />
            </Field>
            <Field label="Teléfono">
              <Input
                value={clienteTelefono}
                onChange={setClienteTelefono}
                placeholder="3001234567"
              />
            </Field>
          </div>
        </div>

        {/* Equipo */}
        <div className="iblock">
          <div className="ib-head">
            <div className="ib-ico">
              <Wrench className="h-3.5 w-3.5" strokeWidth={1.7} />
            </div>
            <div className="ib-title">Equipo</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Descripción *">
              <Input
                value={equipoDescripcion}
                onChange={setEquipoDescripcion}
                required
                placeholder="Compresor 50L 2HP"
              />
            </Field>
            <Field label="Serie">
              <Input
                value={equipoSerie}
                onChange={setEquipoSerie}
                placeholder="SN12345"
              />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Diagnóstico inicial">
              <textarea
                value={diagnostico}
                onChange={(e) => setDiagnostico(e.target.value)}
                rows={3}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={fieldStyle}
                placeholder="Descripción del problema reportado por el cliente"
              />
            </Field>
          </div>
        </div>

        {/* Asignación */}
        <div className="iblock">
          <div className="ib-head">
            <div className="ib-ico">
              <ClipboardList className="h-3.5 w-3.5" strokeWidth={1.7} />
            </div>
            <div className="ib-title">Asignación</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Técnico (se asigna en revisión — opcional)">
              <select
                value={tecnicoId}
                onChange={(e) => setTecnicoId(e.target.value)}
                className="w-full rounded-lg border px-3 text-sm outline-none"
                style={{ ...fieldStyle, height: 48 }}
              >
                <option value="">— Asignar después —</option>
                {tecnicos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre} ({t.rol})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Revisión servicio (COP)">
              <Input
                type="number"
                value={costoManoObra}
                onChange={setCostoManoObra}
                min="0"
                step="1000"
              />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Observaciones">
              <textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                rows={2}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={fieldStyle}
              />
            </Field>
          </div>
        </div>

        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => navigate("/ops/ordenes")}
            disabled={saving}
            className="flex-1 rounded-lg border text-sm font-medium disabled:opacity-50"
            style={{
              height: 48,
              borderColor: "var(--n-200)",
              color: "var(--n-700)",
              backgroundColor: "var(--n-0)",
            }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ height: 48, backgroundColor: "var(--p-600)" }}
            onMouseEnter={(e) => {
              if (!saving)
                e.currentTarget.style.backgroundColor = "var(--p-700)";
            }}
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = "var(--p-600)")
            }
          >
            {saving ? "Creando…" : "Crear orden"}
          </button>
        </div>
      </form>

      {showSelector && (
        <SelectorCotizacionExistente
          sedeId={perfil?.sede_id}
          onClose={() => setShowSelector(false)}
          onSelect={onSeleccionarCotizacion}
        />
      )}
    </div>
  );
}

const fieldStyle = {
  backgroundColor: "var(--n-0)",
  borderColor: "var(--n-200)",
  color: "var(--n-950)",
};

function Field({ label, children }) {
  return (
    <label className="block">
      <span
        className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--n-500)" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Input({ value, onChange, type = "text", ...rest }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border px-3 text-sm outline-none"
      style={{ ...fieldStyle, height: 48 }}
      {...rest}
    />
  );
}
