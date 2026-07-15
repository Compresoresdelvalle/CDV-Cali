import { useState, useEffect, useRef, useMemo } from "react";
import {
  Package,
  Wrench,
  Check,
  ChevronDown,
  Search,
  Boxes,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { safeError } from "../../lib/utils";
import { sedeLabel, estadoPill } from "../../lib/herramientas-ui";
import { ToolIcon, UserAvatar, Pill } from "./HerramientasBits";

/* Duración default del préstamo (días). */
const DIAS_DEFAULT = 7;

/* ────────────────────────── Modal: Registrar préstamo ─────────────────── */

/**
 * Reproduce el formulario por pasos `ops.herramientas.nueva.tsx` de Lovable
 * (1·herramienta seleccionada, 2·usuario, 3·fechas, 4·notas) conectado a la
 * lógica REAL de préstamo (mismo UPDATE con guards anti-race y RBAC por sede).
 */
export function ModalPrestar({
  herramienta,
  usuarios,
  onClose,
  onSaved,
  onRefrescar,
}) {
  const perfil = useAuthStore((s) => s.perfil);
  const savingRef = useRef(false);
  const [usuarioId, setUsuarioId] = useState("");
  const [fechaEsperada, setFechaEsperada] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + DIAS_DEFAULT);
    return d.toISOString().slice(0, 10);
  });
  const [observaciones, setObservaciones] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // REQ7 — préstamo por lote: cuántas unidades disponibles de esta referencia.
  const [cantidad, setCantidad] = useState(1);
  const [disponibles, setDisponibles] = useState(1);
  // Aviso persistente si el lote se prestó solo parcialmente (antes se
  // mostraba y el modal se cerraba en el mismo instante, así que nunca se
  // alcanzaba a leer).
  const [parcial, setParcial] = useState("");

  const usuarioSel = usuarios.find((u) => u.id === usuarioId) ?? null;
  const pill = estadoPill(herramienta.estado);

  // Cuenta las unidades DISPONIBLES de la misma referencia en la sede, para
  // permitir prestar varias de una (mismo producto_id, o nombre+código si es
  // una herramienta manual sin producto vinculado).
  useEffect(() => {
    let cancel = false;
    (async () => {
      let q = supabase
        .from("herramientas_prestamo")
        .select("id", { count: "exact", head: true })
        .eq("sede_id", herramienta.sede_id)
        .eq("estado", "disponible")
        .eq("activo", true);
      if (herramienta.producto_id) {
        q = q.eq("producto_id", herramienta.producto_id);
      } else {
        q = q.is("producto_id", null);
        q = q.eq("herramienta_nombre", herramienta.herramienta_nombre);
        q = herramienta.herramienta_codigo
          ? q.eq("herramienta_codigo", herramienta.herramienta_codigo)
          : q.is("herramienta_codigo", null);
      }
      const { count, error: e } = await q;
      if (cancel) return;
      setDisponibles(e ? 1 : Math.max(count ?? 1, 1));
    })();
    return () => {
      cancel = true;
    };
  }, [herramienta]);

  const guardar = async (e) => {
    e.preventDefault();
    if (!usuarioId) {
      setError("Selecciona un usuario");
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      // Fecha esperada: 17:00 hora Colombia (UTC-5) = 22:00 UTC del mismo día
      const fechaEsperadaISO = new Date(
        `${fechaEsperada}T17:00:00-05:00`,
      ).toISOString();
      const cant = Math.max(1, Math.min(cantidad || 1, disponibles));
      // REQ7 — préstamo por lote: presta hasta `cant` unidades disponibles de la
      // misma referencia en la sede, atómicamente (RPC con FOR UPDATE).
      const { data, error: e2 } = await supabase.rpc(
        "fn_prestar_herramientas_lote",
        {
          p_herramienta_id: herramienta.id,
          p_usuario_id: usuarioId,
          p_cantidad: cant,
          p_fecha_esperada: fechaEsperadaISO,
          p_observaciones: observaciones || null,
        },
      );
      if (e2) throw e2;
      const prestadas = data?.prestadas ?? 0;
      if (prestadas === 0) {
        setError("La herramienta ya no está disponible o no tienes permiso.");
        return;
      }
      if (prestadas < cant) {
        // Éxito parcial: se deja el modal ABIERTO con el aviso (antes se
        // cerraba de inmediato vía onSaved() y el mensaje nunca se veía).
        // Se refresca la lista de fondo para reflejar el préstamo ya hecho.
        setParcial(
          `Solo había ${prestadas} unidad(es) disponible(s) en este momento; se prestaron ${prestadas} de ${cant} solicitadas.`,
        );
        await onRefrescar?.();
        return;
      }
      await onSaved();
    } catch (err) {
      setError(safeError(err, "Error al prestar"));
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  // Préstamo parcial: reemplaza el formulario por una confirmación explícita
  // que el usuario debe cerrar a propósito, para que el aviso no se pierda.
  if (parcial) {
    return (
      <ModalShell onClose={onClose} maxWidth={480}>
        <div className="mb-1.5 flex items-center gap-2.5">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{
              backgroundColor: "var(--warn-50)",
              color: "var(--warn-700)",
            }}
          >
            <Package className="h-5 w-5" strokeWidth={1.8} />
          </div>
          <h2
            className="m-0 flex-1 text-[16px] font-semibold leading-[1.3]"
            style={{ color: "var(--n-950)" }}
          >
            Préstamo parcial
          </h2>
        </div>
        <p
          className="mb-5 rounded-md px-3 py-2.5 text-[13px] leading-[1.5]"
          style={{
            backgroundColor: "var(--warn-50)",
            color: "var(--warn-700)",
          }}
        >
          {parcial}
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-pri"
            style={{ height: 48 }}
          >
            Entendido
          </button>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell onClose={onClose} maxWidth={640}>
      {/* Header */}
      <div className="mb-1.5 flex items-center gap-2.5">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ backgroundColor: "var(--p-50)", color: "var(--p-700)" }}
        >
          <Package className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <h2
          className="m-0 flex-1 text-[16px] font-semibold leading-[1.3]"
          style={{ color: "var(--n-950)" }}
        >
          Registrar préstamo de herramienta
        </h2>
      </div>
      <p
        className="mb-5 text-[13px] leading-[1.5]"
        style={{ color: "var(--n-500)" }}
      >
        Confirma la herramienta, asigna el usuario que la recibe y la fecha de
        devolución esperada.
      </p>

      <form onSubmit={guardar}>
        {/* 1 · Herramienta (ya seleccionada desde la lista) */}
        <Section step="1" label="Herramienta seleccionada">
          <div
            className="flex items-center gap-3 rounded-md border-2 p-2.5"
            style={{
              borderColor: "var(--p-600)",
              backgroundColor: "var(--p-50)",
            }}
          >
            <ToolIcon />
            <div className="flex-1 min-w-0">
              <div
                className="truncate text-[13px] font-medium"
                style={{ color: "var(--n-950)" }}
              >
                {herramienta.herramienta_nombre}
              </div>
              <div
                className="mt-0.5 text-[11px]"
                style={{ color: "var(--n-500)" }}
              >
                {herramienta.herramienta_codigo && (
                  <span
                    className="font-mono font-medium"
                    style={{ color: "var(--n-700)" }}
                  >
                    {herramienta.herramienta_codigo} ·{" "}
                  </span>
                )}
                {sedeLabel(herramienta.sede_id)}
              </div>
            </div>
            <Pill cls={pill.cls} label={pill.label} small />
          </div>

          {/* REQ7 — cantidad a prestar (varias unidades de la misma referencia) */}
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <div>
              <FieldLabel>Cantidad a prestar</FieldLabel>
              <p
                className="mt-0.5 text-[11px]"
                style={{ color: "var(--n-500)" }}
              >
                {disponibles} disponible{disponibles === 1 ? "" : "s"} de esta
                referencia en la sede
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <QtyStep
                onClick={() => setCantidad((c) => Math.max(1, c - 1))}
                disabled={cantidad <= 1}
              >
                −
              </QtyStep>
              <input
                type="number"
                value={cantidad}
                min={1}
                max={disponibles}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setCantidad(
                    Number.isNaN(n) ? 1 : Math.max(1, Math.min(n, disponibles)),
                  );
                }}
                className="rounded-md border text-center font-mono text-sm font-bold outline-none"
                style={{
                  width: 56,
                  height: 40,
                  borderColor: "var(--n-150)",
                  backgroundColor: "var(--n-0)",
                  color: "var(--n-950)",
                }}
              />
              <QtyStep
                onClick={() => setCantidad((c) => Math.min(disponibles, c + 1))}
                disabled={cantidad >= disponibles}
              >
                +
              </QtyStep>
            </div>
          </div>
        </Section>

        {/* 2 · Usuario */}
        <Section step="2" label="Asignar usuario">
          <div className="relative">
            <select
              value={usuarioId}
              onChange={(e) => setUsuarioId(e.target.value)}
              required
              className="w-full appearance-none rounded-md border bg-transparent py-2.5 pl-3 pr-9 text-[13px] outline-none"
              style={{ borderColor: "var(--n-150)", color: "var(--n-950)" }}
            >
              <option value="">— Selecciona usuario —</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre} ({u.rol})
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
              style={{ color: "var(--n-500)" }}
            />
          </div>
          {usuarioSel && (
            <div className="mt-2 flex items-center gap-2.5">
              <UserAvatar nombre={usuarioSel.nombre} size="sm" />
              <span className="text-[12px]" style={{ color: "var(--n-700)" }}>
                {usuarioSel.nombre} · {usuarioSel.rol}
              </span>
            </div>
          )}
          <p className="mt-1.5 text-[11px]" style={{ color: "var(--n-500)" }}>
            {usuarios.length} usuario{usuarios.length === 1 ? "" : "s"} activo
            {usuarios.length === 1 ? "" : "s"} · cualquier rol puede recibir
            préstamo
          </p>
        </Section>

        {/* 3 · Fechas */}
        <Section step="3" label="Fechas">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Fecha de préstamo</FieldLabel>
              <div
                className="rounded-md border px-3 py-2 font-mono text-[13px] font-medium"
                style={{
                  borderColor: "var(--n-150)",
                  color: "var(--n-950)",
                  backgroundColor: "var(--n-50)",
                }}
              >
                Hoy
              </div>
            </div>
            <div>
              <FieldLabel>Devolución esperada</FieldLabel>
              <input
                type="date"
                value={fechaEsperada}
                onChange={(e) => setFechaEsperada(e.target.value)}
                required
                min={new Date().toISOString().slice(0, 10)}
                className="w-full rounded-md border bg-transparent px-3 py-2 font-mono text-[13px] font-medium outline-none"
                style={{ borderColor: "var(--n-150)", color: "var(--n-950)" }}
              />
            </div>
          </div>
          <p className="mt-1.5 text-[11px]" style={{ color: "var(--n-500)" }}>
            Duración default {DIAS_DEFAULT} días · ajusta según el uso planeado
          </p>
        </Section>

        {/* 4 · Notas */}
        <Section step="4" label="Notas · opcional">
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={2}
            placeholder="Propósito del préstamo, equipo o cliente asociado…"
            className="min-h-[60px] w-full rounded-md border bg-transparent px-3 py-2.5 text-[13px] outline-none"
            style={{ borderColor: "var(--n-150)", color: "var(--n-950)" }}
          />
        </Section>

        {error && (
          <p className="mb-2 text-xs" style={{ color: "var(--dang-700)" }}>
            {error}
          </p>
        )}

        {/* Footer */}
        <div
          className="mt-5 flex justify-end gap-2 border-t pt-4"
          style={{ borderColor: "var(--n-100)" }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="btn btn-out disabled:opacity-50"
            style={{ height: 48 }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="btn btn-pri inline-flex items-center gap-1.5 disabled:opacity-50"
            style={{ height: 48 }}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2} />
            {saving ? "Guardando…" : "Registrar préstamo"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/* ───────────────────────── Modal: Nueva herramienta ───────────────────── */

/**
 * Alta de una herramienta del catálogo (Admin o Bodeguero; el Bodeguero solo en
 * su propia sede). Reusa la estética del formulario por pasos de Lovable.
 */
export function ModalNueva({ sedeDefault, onClose, onSaved }) {
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";
  const savingRef = useRef(false);
  // 'insumo' = inventariable (sale del stock de insumo) · 'manual' = no inventariable
  const [modo, setModo] = useState("insumo");
  const [sedeId, setSedeId] = useState(sedeDefault);
  const [sedes, setSedes] = useState([]);
  // Modo manual
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  // Modo insumo
  const [insumos, setInsumos] = useState([]);
  const [loadingInsumos, setLoadingInsumos] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [productoSel, setProductoSel] = useState(null);
  // Cuántas unidades crear de una vez (antes solo se podía crear 1 por vez,
  // por lo que casi nunca había más de 1 unidad disponible para prestar).
  const [cantidadCrear, setCantidadCrear] = useState(1);
  // Común
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const MAX_MANUAL_CREAR = 50;
  const maxCantidadCrear =
    modo === "insumo" ? Math.max(1, productoSel?.stock ?? 1) : MAX_MANUAL_CREAR;

  useEffect(() => {
    supabase
      .from("sedes")
      .select("id, nombre")
      .eq("activa", true)
      .order("nombre")
      .then(({ data }) => setSedes(data ?? []));
  }, []);

  // Inventario de insumos de la sede (cantidad_insumo > 0). Son pocos (≤ ~30),
  // así que se traen todos y se filtran en memoria — sin búsqueda server-side.
  useEffect(() => {
    if (modo !== "insumo" || !sedeId) return;
    let cancel = false;
    setLoadingInsumos(true);
    setProductoSel(null);
    setBusqueda("");
    supabase
      .from("inventario")
      .select(
        "producto_id, cantidad_insumo, producto:productos!inner(id, nombre, referencia, codigo_interno)",
      )
      .eq("sede_id", sedeId)
      .eq("producto.activo", true)
      .gt("cantidad_insumo", 0)
      .order("cantidad_insumo", { ascending: false })
      .limit(200)
      .then(({ data, error: e }) => {
        if (cancel) return;
        setInsumos(e ? [] : (data ?? []));
        setLoadingInsumos(false);
      });
    return () => {
      cancel = true;
    };
  }, [modo, sedeId]);

  const insumosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const norm = (s) => (s ?? "").toString().toLowerCase();
    const list = !q
      ? insumos
      : insumos.filter((r) => {
          const p = r.producto ?? {};
          return (
            norm(p.nombre).includes(q) ||
            norm(p.referencia).includes(q) ||
            norm(p.codigo_interno).includes(q)
          );
        });
    return list.slice(0, 12);
  }, [insumos, busqueda]);

  const elegirInsumo = (r) => {
    const p = r.producto ?? {};
    setProductoSel({
      producto_id: r.producto_id,
      nombre: p.nombre,
      codigo: p.codigo_interno || p.referencia || "",
      stock: r.cantidad_insumo,
    });
    setBusqueda("");
    setCantidadCrear(1);
  };

  const guardar = async (e) => {
    e.preventDefault();
    if (!["Admin", "Bodeguero"].includes(perfil?.rol)) {
      setError("Solo Admin o Bodeguero pueden crear herramientas");
      return;
    }
    if (modo === "manual" && !nombre.trim()) {
      setError("El nombre es obligatorio");
      return;
    }
    if (modo === "insumo" && !productoSel) {
      setError("Selecciona un insumo del inventario de la sede");
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const cant = Math.max(1, Math.min(cantidadCrear || 1, maxCantidadCrear));
      if (modo === "insumo") {
        // Inventariable: descuenta `cant` del stock de insumo, crea `cant`
        // filas de una vez (RPC con FOR UPDATE, todo en una transacción).
        const { error: e2 } = await supabase.rpc(
          "fn_crear_herramienta_desde_insumo",
          {
            p_producto_id: productoSel.producto_id,
            p_sede_id: sedeId,
            p_cantidad: cant,
          },
        );
        if (e2) throw e2;
      } else {
        // Manual: no inventariable, no toca stock. Crea `cant` filas iguales.
        const filas = Array.from({ length: cant }, () => ({
          herramienta_nombre: nombre.trim(),
          herramienta_codigo: codigo.trim() || null,
          sede_id: sedeId,
          estado: "disponible",
        }));
        const { error: e2 } = await supabase
          .from("herramientas_prestamo")
          .insert(filas);
        if (e2) throw e2;
      }
      await onSaved();
    } catch (err) {
      setError(safeError(err, "Error al crear"));
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  const puedeGuardar =
    !saving && (modo === "manual" ? nombre.trim().length > 0 : !!productoSel);

  return (
    <ModalShell onClose={onClose} maxWidth={520}>
      <div className="mb-1.5 flex items-center gap-2.5">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{
            backgroundColor: "var(--cat-hrm-bg)",
            color: "var(--cat-hrm)",
          }}
        >
          <Wrench className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <h2
          className="m-0 flex-1 text-[16px] font-semibold leading-[1.3]"
          style={{ color: "var(--n-950)" }}
        >
          Nueva herramienta
        </h2>
      </div>
      <p
        className="mb-4 text-[13px] leading-[1.5]"
        style={{ color: "var(--n-500)" }}
      >
        Sácala del inventario de insumos (inventariable) o regístrala a mano si
        no existe en el catálogo.
      </p>

      {/* Selector de modo */}
      <div className="mb-4 flex gap-2">
        {[
          { v: "insumo", t: "Desde insumos", Icon: Boxes },
          { v: "manual", t: "Manual", Icon: Wrench },
        ].map((m) => {
          const on = modo === m.v;
          const Icon = m.Icon;
          return (
            <button
              key={m.v}
              type="button"
              onClick={() => {
                setModo(m.v);
                setError("");
                setCantidadCrear(1);
              }}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border text-[13px] font-medium transition-colors"
              style={{
                minHeight: 40,
                borderColor: on ? "var(--p-500)" : "var(--n-200)",
                backgroundColor: on ? "var(--p-600)" : "var(--n-0)",
                color: on ? "#fff" : "var(--n-700)",
              }}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
              {m.t}
            </button>
          );
        })}
      </div>

      <form onSubmit={guardar} className="space-y-4">
        <Field label="Sede *">
          <select
            value={sedeId}
            onChange={(e) => setSedeId(e.target.value)}
            required
            disabled={!esAdmin}
            className="finput sans"
            style={!esAdmin ? { opacity: 0.7 } : undefined}
          >
            {sedes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
          {!esAdmin && (
            <p className="mt-1 text-[11px]" style={{ color: "var(--n-500)" }}>
              Solo puedes crear herramientas en tu sede.
            </p>
          )}
        </Field>

        {modo === "insumo" ? (
          <Field label="Insumo del inventario *">
            {productoSel ? (
              <div
                className="flex items-center gap-3 rounded-md border-2 p-2.5"
                style={{
                  borderColor: "var(--p-600)",
                  backgroundColor: "var(--p-50)",
                }}
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    backgroundColor: "var(--p-100)",
                    color: "var(--p-700)",
                  }}
                >
                  <Boxes className="h-4 w-4" strokeWidth={1.8} />
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className="truncate text-[13px] font-medium"
                    style={{ color: "var(--n-950)" }}
                  >
                    {productoSel.nombre}
                  </div>
                  <div
                    className="mt-0.5 text-[11px]"
                    style={{ color: "var(--n-500)" }}
                  >
                    {productoSel.codigo && (
                      <span
                        className="font-mono font-medium"
                        style={{ color: "var(--n-700)" }}
                      >
                        {productoSel.codigo} ·{" "}
                      </span>
                    )}
                    Stock insumo: {productoSel.stock}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setProductoSel(null)}
                  className="shrink-0 text-[12px] font-medium"
                  style={{ color: "var(--p-700)" }}
                >
                  Cambiar
                </button>
              </div>
            ) : null}
            {productoSel && (
              <CantidadCrearField
                cantidad={cantidadCrear}
                setCantidad={setCantidadCrear}
                max={maxCantidadCrear}
                sub={`${productoSel.stock} disponible${productoSel.stock === 1 ? "" : "s"} en el stock de insumo`}
              />
            )}
            {!productoSel && (
              <>
                <div
                  className="flex h-11 items-center gap-2.5 rounded-md border px-3"
                  style={{
                    borderColor: "var(--n-150)",
                    backgroundColor: "var(--n-0)",
                  }}
                >
                  <Search
                    className="h-4 w-4 shrink-0"
                    strokeWidth={1.6}
                    style={{ color: "var(--n-400)" }}
                  />
                  <input
                    type="text"
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Buscar insumo por nombre, referencia o código…"
                    className="flex-1 border-none bg-transparent text-[13px] outline-none"
                    style={{ color: "var(--n-900)" }}
                  />
                </div>
                <div
                  className="mt-2 max-h-[220px] overflow-y-auto rounded-md border"
                  style={{ borderColor: "var(--n-150)" }}
                >
                  {loadingInsumos ? (
                    <p
                      className="px-3 py-4 text-center text-[12px]"
                      style={{ color: "var(--n-500)" }}
                    >
                      Cargando insumos…
                    </p>
                  ) : insumosFiltrados.length === 0 ? (
                    <p
                      className="px-3 py-4 text-center text-[12px]"
                      style={{ color: "var(--n-500)" }}
                    >
                      {insumos.length === 0
                        ? "No hay insumos con stock en esta sede."
                        : "Sin coincidencias."}
                    </p>
                  ) : (
                    insumosFiltrados.map((r, idx) => {
                      const p = r.producto ?? {};
                      return (
                        <button
                          key={r.producto_id}
                          type="button"
                          onClick={() => elegirInsumo(r)}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors"
                          style={{
                            borderTop:
                              idx === 0 ? "none" : "1px solid var(--n-100)",
                            backgroundColor: "var(--n-0)",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.backgroundColor =
                              "var(--n-50)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.backgroundColor =
                              "var(--n-0)")
                          }
                        >
                          <div className="min-w-0">
                            <p
                              className="truncate text-[13px] font-medium"
                              style={{ color: "var(--n-950)" }}
                            >
                              {p.nombre}
                            </p>
                            <p
                              className="font-mono text-[11px]"
                              style={{ color: "var(--n-500)" }}
                            >
                              {p.codigo_interno || p.referencia || "—"}
                            </p>
                          </div>
                          <span
                            className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] font-medium"
                            style={{
                              backgroundColor: "var(--p-50)",
                              color: "var(--p-700)",
                            }}
                          >
                            {r.cantidad_insumo} ud
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
                <p
                  className="mt-1.5 text-[11px] leading-[1.45]"
                  style={{ color: "var(--n-500)" }}
                >
                  Al crear se descuenta la cantidad elegida del stock de insumo.
                  Al marcar devuelta regresa al insumo.
                </p>
              </>
            )}
          </Field>
        ) : (
          <>
            <Field label="Nombre *">
              <input
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                autoFocus
                placeholder="Ej. Llave inglesa 12 pulgadas"
                className="finput sans"
              />
            </Field>
            <Field label="Código (opcional)">
              <input
                type="text"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="Ej. HER-001"
                className="finput"
              />
            </Field>
            <p className="text-[11px]" style={{ color: "var(--n-500)" }}>
              Herramienta no inventariable: no afecta el stock de insumos.
            </p>
            <CantidadCrearField
              cantidad={cantidadCrear}
              setCantidad={setCantidadCrear}
              max={maxCantidadCrear}
              sub="Crea varias unidades iguales de una vez (para poder prestar más de una)."
            />
          </>
        )}

        {error && (
          <p className="text-xs" style={{ color: "var(--dang-700)" }}>
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="btn btn-out flex-1 justify-center disabled:opacity-50"
            style={{ height: 48 }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!puedeGuardar}
            className="btn btn-pri flex-1 justify-center disabled:opacity-50"
            style={{ height: 48 }}
          >
            {saving
              ? "Guardando…"
              : cantidadCrear > 1
                ? `Crear ${cantidadCrear} unidades`
                : "Crear"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/* ───────────────────────────── Helpers UI ─────────────────────────────── */

function ModalShell({ children, onClose, maxWidth = 480 }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl p-5 sm:rounded-2xl sm:p-6"
        style={{ backgroundColor: "var(--n-0)", maxWidth }}
      >
        <div className="mb-3 flex justify-end">
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ color: "var(--n-500)" }}
            aria-label="Cerrar"
            type="button"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Section({ step, label, children }) {
  return (
    <div className="mb-4">
      <span
        className="mb-2 block font-mono text-[10.5px] font-semibold uppercase tracking-[0.05em]"
        style={{ color: "var(--n-500)" }}
      >
        {step} · {label}
      </span>
      {children}
    </div>
  );
}

function FieldLabel({ children }) {
  return (
    <span
      className="mb-1 block font-mono text-[11px] font-medium uppercase tracking-[0.05em]"
      style={{ color: "var(--n-500)" }}
    >
      {children}
    </span>
  );
}

/* Selector de cuántas unidades crear de una vez (ModalNueva). */
function CantidadCrearField({ cantidad, setCantidad, max, sub }) {
  return (
    <div className="mt-2.5 flex items-center justify-between gap-3">
      <div>
        <FieldLabel>Cantidad a crear</FieldLabel>
        {sub && (
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--n-500)" }}>
            {sub}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <QtyStep
          onClick={() => setCantidad((c) => Math.max(1, c - 1))}
          disabled={cantidad <= 1}
        >
          −
        </QtyStep>
        <input
          type="number"
          value={cantidad}
          min={1}
          max={max}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            setCantidad(Number.isNaN(n) ? 1 : Math.max(1, Math.min(n, max)));
          }}
          className="rounded-md border text-center font-mono text-sm font-bold outline-none"
          style={{
            width: 56,
            height: 40,
            borderColor: "var(--n-150)",
            backgroundColor: "var(--n-0)",
            color: "var(--n-950)",
          }}
        />
        <QtyStep
          onClick={() => setCantidad((c) => Math.min(max, c + 1))}
          disabled={cantidad >= max}
        >
          +
        </QtyStep>
      </div>
    </div>
  );
}

/* Botón +/- para el contador de cantidad (REQ7). */
function QtyStep({ children, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center rounded-md border font-bold disabled:opacity-40"
      style={{
        width: 40,
        height: 40,
        fontSize: 18,
        borderColor: "var(--n-150)",
        backgroundColor: "var(--n-50)",
        color: "var(--n-700)",
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span
        className="mb-1.5 block text-xs font-medium"
        style={{ color: "var(--n-500)" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
