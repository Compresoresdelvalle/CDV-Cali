import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import SelectorCotizacionExistente from "../../components/ot/SelectorCotizacionExistente";

export default function OrdenNueva() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteTelefono, setClienteTelefono] = useState("");
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

  useEffect(() => {
    const cargarTecnicos = async () => {
      try {
        let q = supabase
          .from("usuarios")
          .select("id, nombre, rol, sede_id")
          .eq("activo", true)
          .in("rol", ["Tecnico", "Admin"])
          .order("nombre");
        if (perfil?.rol !== "Admin" && perfil?.sede_id)
          q = q.eq("sede_id", perfil.sede_id);
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
    if (!clienteNombre.trim() || !equipoDescripcion.trim() || !tecnicoId) {
      setError("Cliente, equipo y técnico son obligatorios");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const costo = parseFloat(costoManoObra) || 0;
      // La sede de la orden es la del técnico asignado (no la del Admin que crea)
      const tecnicoSeleccionado = tecnicos.find((t) => t.id === tecnicoId);
      const sedeOrden = tecnicoSeleccionado?.sede_id ?? perfil.sede_id;
      if (!sedeOrden) {
        setError(
          "No se pudo determinar la sede. Revisa que tu usuario o el técnico tenga sede asignada.",
        );
        setSaving(false);
        return;
      }
      const { data, error: e2 } = await supabase
        .from("ordenes_servicio")
        .insert({
          cliente_nombre: clienteNombre.trim(),
          cliente_telefono: clienteTelefono.trim() || null,
          equipo_descripcion: equipoDescripcion.trim(),
          equipo_serie: equipoSerie.trim() || null,
          diagnostico: diagnostico.trim() || null,
          tecnico_id: tecnicoId,
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
    }
  };

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Nueva orden de servicio"
        description="Registra el equipo y diagnóstico inicial"
      />

      {error && (
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.08)",
            borderColor: "hsl(var(--destructive) / 0.4)",
            color: "hsl(var(--destructive))",
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={guardar} className="space-y-5 max-w-2xl">
        {/* Fase 10 §10.6: asociar cotización existente con reciclado de datos */}
        <Section titulo="Cotización vinculada (opcional)">
          {cotizacionVinculada ? (
            <div
              className="rounded-lg border p-3 space-y-2"
              style={{
                backgroundColor: "hsl(var(--info) / 0.05)",
                borderColor: "hsl(var(--info))",
              }}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p
                    className="text-sm font-bold"
                    style={{ color: "hsl(var(--info))" }}
                  >
                    🔗 Cotización #{cotizacionVinculada.numero} ·{" "}
                    {formatCOP(cotizacionVinculada.total)}
                  </p>
                  <p
                    className="text-xs mt-1"
                    style={{ color: "hsl(var(--muted-foreground))" }}
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
                  className="text-xs px-3 py-2 rounded-lg border cursor-pointer min-h-[44px]"
                  style={{
                    borderColor: "hsl(var(--destructive))",
                    color: "hsl(var(--destructive))",
                  }}
                >
                  Desvincular
                </button>
              </div>
              {cotizacionVinculada.items.length > 0 && (
                <ul
                  className="text-xs space-y-0.5 mt-2 pt-2 border-t"
                  style={{ borderColor: "hsl(var(--border))" }}
                >
                  {cotizacionVinculada.items.map((it, i) => (
                    <li
                      key={i}
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
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
              className="text-sm px-4 py-2 rounded-lg border cursor-pointer min-h-[48px] disabled:opacity-50"
              style={{
                borderColor: "hsl(var(--primary))",
                color: "hsl(var(--primary))",
                backgroundColor: "hsl(var(--card))",
              }}
            >
              {cargandoCotizacion
                ? "Cargando cotización…"
                : "🔗 Asociar cotización existente (opcional)"}
            </button>
          )}
        </Section>

        <Section titulo="Cliente">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Nombre *">
              <Input
                value={clienteNombre}
                onChange={setClienteNombre}
                required
                placeholder="Ej. Juan Pérez"
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
        </Section>

        <Section titulo="Equipo">
          <div className="grid sm:grid-cols-2 gap-3">
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
          <Field label="Diagnóstico inicial">
            <textarea
              value={diagnostico}
              onChange={(e) => setDiagnostico(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={textareaStyle}
              placeholder="Descripción del problema reportado por el cliente"
            />
          </Field>
        </Section>

        <Section titulo="Asignación">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Técnico *">
              <select
                value={tecnicoId}
                onChange={(e) => setTecnicoId(e.target.value)}
                required
                className="w-full h-12 px-3 rounded-lg border text-sm"
                style={textareaStyle}
              >
                <option value="">— Seleccionar —</option>
                {tecnicos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre} ({t.rol})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Mano de obra (COP)">
              <Input
                type="number"
                value={costoManoObra}
                onChange={setCostoManoObra}
                min="0"
                step="1000"
              />
            </Field>
          </div>
          <Field label="Observaciones">
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={textareaStyle}
            />
          </Field>
        </Section>

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={() => navigate("/ops/ordenes")}
            disabled={saving}
            className="flex-1 h-12 rounded-lg text-sm font-medium border cursor-pointer disabled:opacity-50"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
              backgroundColor: "transparent",
            }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 h-12 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
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

const textareaStyle = {
  backgroundColor: "hsl(var(--card))",
  borderColor: "hsl(var(--border))",
  color: "hsl(var(--foreground))",
};

function Section({ titulo, children }) {
  return (
    <div className="space-y-3">
      <h3
        className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {titulo}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span
        className="block text-xs font-medium mb-1.5"
        style={{ color: "hsl(var(--muted-foreground))" }}
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
      className="w-full h-12 px-3 rounded-lg border text-sm"
      style={textareaStyle}
      {...rest}
    />
  );
}
