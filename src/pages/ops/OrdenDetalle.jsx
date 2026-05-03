import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import {
  formatCOP,
  formatDate,
  sanitizeSearch,
  safeError,
} from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";
import { useConfirm } from "../../components/ui/ConfirmDialog";

const ESTADOS = [
  "abierta",
  "en_proceso",
  "esperando_repuesto",
  "completada",
  "entregada",
];
const ESTADO_LABEL = {
  abierta: "Abierta",
  en_proceso: "En proceso",
  esperando_repuesto: "Esperando repuesto",
  completada: "Completada",
  entregada: "Entregada",
};

// Transiciones permitidas (debe coincidir con trg_orden_validar_transicion en BD)
const TRANSICIONES_VALIDAS = {
  abierta: ["en_proceso", "esperando_repuesto"],
  en_proceso: ["esperando_repuesto", "completada"],
  esperando_repuesto: ["en_proceso", "completada"],
  completada: ["entregada"],
  entregada: [],
};

export default function OrdenDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const { confirm, ConfirmDialog } = useConfirm();

  const [orden, setOrden] = useState(null);
  const [detalles, setDetalles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [trabajoRealizado, setTrabajoRealizado] = useState("");
  const [savingTrabajo, setSavingTrabajo] = useState(false);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);

  // Repuesto picker state
  const [search, setSearch] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [agregando, setAgregando] = useState(false);

  const cargar = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const { data: o, error: e1 } = await supabase
        .from("ordenes_servicio")
        .select(`*, tecnico:tecnico_id(nombre, rol)`)
        .eq("id", id)
        .maybeSingle();
      if (e1) throw e1;
      if (!o) {
        setErrorMsg("Orden no encontrada");
        setLoading(false);
        return;
      }
      setOrden(o);
      setTrabajoRealizado(o.trabajo_realizado ?? "");

      const { data: d, error: e2 } = await supabase
        .from("detalle_orden")
        .select(
          `id, cantidad, costo_unitario, subtotal,
           producto:producto_id(id, referencia, nombre)`,
        )
        .eq("orden_id", id)
        .order("created_at", { ascending: true });
      if (e2) throw e2;
      setDetalles(d ?? []);
    } catch (err) {
      console.error("[OrdenDetalle]", err);
      setErrorMsg(safeError(err, "Error al cargar"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
  }, [id]);

  // Buscar productos para agregar repuesto
  // Depende solo de search y sede_id (estable) para evitar abortar al refrescar orden
  const sedeOrden = orden?.sede_id;
  useEffect(() => {
    if (!sedeOrden) return;
    const q = sanitizeSearch(search.trim());
    if (q.length < 2) {
      setResultados([]);
      setBuscando(false);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        // Búsqueda en dos pasos: primero match por nombre/referencia,
        // luego inventario para esos productos en la sede de la orden.
        const { data: prods, error: e1 } = await supabase
          .from("productos")
          .select("id, referencia, nombre, precio_venta, costo_promedio")
          .eq("activo", true)
          .or(`referencia.ilike.%${q}%,nombre.ilike.%${q}%`)
          .limit(15);
        if (ac.signal.aborted) return;
        if (e1) throw e1;

        if (!prods || prods.length === 0) {
          setResultados([]);
          return;
        }

        const ids = prods.map((p) => p.id);
        const { data: inv, error: e2 } = await supabase
          .from("inventario")
          .select("producto_id, cantidad")
          .in("producto_id", ids)
          .eq("sede_id", sedeOrden);
        if (ac.signal.aborted) return;
        if (e2) throw e2;

        const stockByProd = new Map();
        (inv ?? []).forEach((r) => stockByProd.set(r.producto_id, r.cantidad));

        const enriched = prods.map((p) => ({
          ...p,
          inventario: [
            { cantidad: stockByProd.get(p.id) ?? 0, sede_id: sedeOrden },
          ],
        }));
        setResultados(enriched);
      } catch (err) {
        if (!ac.signal.aborted) {
          console.error("[OrdenDetalle] search:", err);
          setResultados([]);
        }
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [search, sedeOrden]);

  const agregarRepuesto = async (producto) => {
    setAgregando(true);
    setErrorMsg("");
    try {
      const stockSede = producto.inventario?.[0]?.cantidad ?? 0;
      if (stockSede < 1) {
        setErrorMsg(
          `Sin stock en esta sede para "${producto.nombre}" (disponible: ${stockSede})`,
        );
        setAgregando(false);
        return;
      }
      // Para reportes de margen: el COSTO de un repuesto consumido es
      // costo_promedio (lo que costó adquirirlo), no precio_venta.
      // Si el cliente paga por la mano de obra + repuestos, el cargo se
      // hace aparte en costo_mano_obra.
      const costo = producto.costo_promedio || producto.precio_venta || 0;
      const { error } = await supabase.from("detalle_orden").insert({
        orden_id: id,
        producto_id: producto.id,
        cantidad: 1,
        costo_unitario: costo,
        subtotal: costo,
      });
      if (error) throw error;
      // Los totales se recalculan automáticamente vía trigger BD
      setSearch("");
      setResultados([]);
      await cargar();
    } catch (err) {
      console.error("[OrdenDetalle] agregar:", err);
      setErrorMsg(safeError(err, "Error al agregar repuesto"));
    } finally {
      setAgregando(false);
    }
  };

  const quitarRepuesto = async (detalleId) => {
    const ok = await confirm({
      titulo: "Eliminar repuesto",
      mensaje:
        "El stock del componente será restaurado automáticamente. Esta acción registra un movimiento de devolución en BD.",
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    setErrorMsg("");
    try {
      const { error } = await supabase
        .from("detalle_orden")
        .delete()
        .eq("id", detalleId);
      if (error) throw error;
      // El trigger BD repone stock y recalcula totales automáticamente
      await cargar();
    } catch (err) {
      console.error("[OrdenDetalle] quitar:", err);
      setErrorMsg(safeError(err, "Error al eliminar repuesto"));
    }
  };

  const cambiarEstado = async (nuevoEstado) => {
    setCambiandoEstado(true);
    setErrorMsg("");
    try {
      const update = { estado: nuevoEstado };
      if (nuevoEstado === "entregada")
        update.fecha_entrega = new Date().toISOString();
      const { error } = await supabase
        .from("ordenes_servicio")
        .update(update)
        .eq("id", id);
      if (error) throw error;
      await cargar();
    } catch (err) {
      console.error("[OrdenDetalle] estado:", err);
      setErrorMsg(safeError(err, "Error al cambiar estado"));
    } finally {
      setCambiandoEstado(false);
    }
  };

  const guardarTrabajo = async () => {
    setSavingTrabajo(true);
    setErrorMsg("");
    try {
      const { error } = await supabase
        .from("ordenes_servicio")
        .update({ trabajo_realizado: trabajoRealizado || null })
        .eq("id", id);
      if (error) throw error;
    } catch (err) {
      console.error("[OrdenDetalle] trabajo:", err);
      setErrorMsg(safeError(err, "Error al guardar"));
    } finally {
      setSavingTrabajo(false);
    }
  };

  if (loading)
    return (
      <div className="p-6">
        <p style={{ color: "hsl(var(--muted-foreground))" }}>Cargando…</p>
      </div>
    );
  if (!orden)
    return (
      <div className="p-6">
        <p style={{ color: "hsl(var(--destructive))" }}>
          {errorMsg || "No encontrada"}
        </p>
        <button
          onClick={() => navigate("/ops/ordenes")}
          className="mt-4 px-4 py-2 rounded-lg text-sm font-medium border cursor-pointer"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          ← Volver
        </button>
      </div>
    );

  const editable = orden.estado !== "entregada";
  const isAdmin = perfil?.rol === "Admin";
  // Solo Admin o el técnico ASIGNADO específicamente puede editar.
  // Otros técnicos solo ven (la RLS también lo refuerza).
  const puedeEditar = isAdmin || orden.tecnico_id === perfil?.id;

  return (
    <div
      className="p-4 sm:p-6 space-y-5 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title={`Orden #${orden.numero}`}
        description={`${orden.cliente_nombre} · ${formatDate(orden.fecha)}`}
      />

      {errorMsg && (
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.08)",
            borderColor: "hsl(var(--destructive) / 0.4)",
            color: "hsl(var(--destructive))",
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* Info card */}
      <div
        className="rounded-xl border p-4 space-y-3"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <StatusBadge status={orden.estado} />
          <p
            className="text-xs"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Técnico: {orden.tecnico?.nombre ?? "—"}
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <Info label="Equipo" value={orden.equipo_descripcion} />
          <Info label="Serie" value={orden.equipo_serie || "—"} />
          <Info label="Teléfono" value={orden.cliente_telefono || "—"} />
          <Info
            label="Mano de obra"
            value={formatCOP(orden.costo_mano_obra ?? 0)}
          />
        </div>
        {orden.diagnostico && (
          <Info label="Diagnóstico" value={orden.diagnostico} block />
        )}
      </div>

      {/* Cambiar estado */}
      {puedeEditar && editable && (
        <div className="space-y-2">
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Cambiar estado
          </p>
          <div className="flex gap-2 flex-wrap">
            {ESTADOS.map((e) => {
              const esActual = orden.estado === e;
              const permitido =
                esActual || TRANSICIONES_VALIDAS[orden.estado]?.includes(e);
              return (
                <button
                  key={e}
                  onClick={() => permitido && !esActual && cambiarEstado(e)}
                  disabled={cambiandoEstado || esActual || !permitido}
                  title={
                    !permitido && !esActual
                      ? `Transición ${orden.estado} → ${e} no permitida`
                      : undefined
                  }
                  className="px-3 py-2 rounded-lg text-xs font-medium border transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  style={
                    esActual
                      ? {
                          backgroundColor: "hsl(var(--primary))",
                          color: "hsl(var(--primary-foreground))",
                          borderColor: "hsl(var(--primary))",
                        }
                      : {
                          backgroundColor: "transparent",
                          color: "hsl(var(--foreground))",
                          borderColor: "hsl(var(--border))",
                        }
                  }
                >
                  {ESTADO_LABEL[e]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Repuestos */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3
            className="text-sm font-semibold"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Repuestos consumidos
          </h3>
          <p
            className="text-sm font-bold tabular-nums"
            style={{ color: "hsl(var(--primary))" }}
          >
            {formatCOP(orden.costo_repuestos ?? 0)}
          </p>
        </div>

        {detalles.length === 0 && (
          <p
            className="text-xs italic"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Aún no hay repuestos
          </p>
        )}

        <ul className="space-y-2" role="list">
          {detalles.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            >
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-medium truncate"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {d.producto?.nombre ?? "—"}
                </p>
                <p
                  className="text-xs font-mono"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {d.producto?.referencia} · ×{d.cantidad} ·{" "}
                  {formatCOP(d.costo_unitario)}
                </p>
              </div>
              <p
                className="text-sm font-bold tabular-nums shrink-0"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {formatCOP(d.subtotal)}
              </p>
              {puedeEditar && editable && (
                <button
                  onClick={() => quitarRepuesto(d.id)}
                  className="text-xs px-2 py-1 rounded cursor-pointer"
                  style={{ color: "hsl(var(--destructive))" }}
                  aria-label="Quitar"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>

        {puedeEditar && editable && (
          <div className="space-y-2 pt-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar repuesto por nombre o referencia (mín 2 letras)…"
              className="w-full h-12 px-3 rounded-lg border text-sm"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--foreground))",
              }}
            />
            {buscando && (
              <p
                className="text-xs"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Buscando…
              </p>
            )}
            {resultados.length > 0 && (
              <ul
                className="space-y-1 max-h-64 overflow-y-auto rounded-lg border"
                style={{ borderColor: "hsl(var(--border))" }}
              >
                {resultados.map((p) => {
                  const stock = p.inventario?.[0]?.cantidad ?? 0;
                  const sinStock = stock < 1;
                  return (
                    <li key={p.id}>
                      <button
                        onClick={() => !sinStock && agregarRepuesto(p)}
                        disabled={agregando || sinStock}
                        className="w-full text-left px-3 py-2.5 flex items-center justify-between gap-3 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          backgroundColor: "hsl(var(--card))",
                          borderBottom: "1px solid hsl(var(--border) / 0.5)",
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <p
                            className="text-sm font-medium truncate"
                            style={{ color: "hsl(var(--foreground))" }}
                          >
                            {p.nombre}
                          </p>
                          <p
                            className="text-xs font-mono"
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          >
                            {p.referencia} ·{" "}
                            <span
                              style={{
                                color: sinStock
                                  ? "hsl(var(--destructive))"
                                  : "hsl(var(--success))",
                              }}
                            >
                              Stock: {stock}
                            </span>
                          </p>
                        </div>
                        <p
                          className="text-sm font-bold tabular-nums shrink-0"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {formatCOP(p.precio_venta)}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Trabajo realizado */}
      {puedeEditar && editable && (
        <div className="space-y-2">
          <h3
            className="text-sm font-semibold"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Trabajo realizado
          </h3>
          <textarea
            value={trabajoRealizado}
            onChange={(e) => setTrabajoRealizado(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border text-sm"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
          />
          <button
            onClick={guardarTrabajo}
            disabled={savingTrabajo}
            className="px-4 h-10 rounded-lg text-sm font-medium border cursor-pointer disabled:opacity-50"
            style={{
              borderColor: "hsl(var(--primary))",
              color: "hsl(var(--primary))",
              backgroundColor: "hsl(var(--primary) / 0.05)",
            }}
          >
            {savingTrabajo ? "Guardando…" : "Guardar trabajo"}
          </button>
        </div>
      )}

      {/* Total */}
      <div
        className="rounded-xl border p-4 flex items-center justify-between"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--primary))",
        }}
      >
        <p
          className="text-sm font-semibold"
          style={{ color: "hsl(var(--foreground))" }}
        >
          Total
        </p>
        <p
          className="text-xl font-bold tabular-nums"
          style={{ color: "hsl(var(--primary))" }}
        >
          {formatCOP(orden.total ?? 0)}
        </p>
      </div>

      <button
        onClick={() => navigate("/ops/ordenes")}
        className="px-4 h-10 rounded-lg text-sm font-medium border cursor-pointer"
        style={{
          borderColor: "hsl(var(--border))",
          color: "hsl(var(--muted-foreground))",
        }}
      >
        ← Volver al historial
      </button>

      <ConfirmDialog />
    </div>
  );
}

function Info({ label, value, block }) {
  return (
    <div className={block ? "col-span-full" : ""}>
      <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
        {label}
      </p>
      <p className="text-sm" style={{ color: "hsl(var(--foreground))" }}>
        {value}
      </p>
    </div>
  );
}
