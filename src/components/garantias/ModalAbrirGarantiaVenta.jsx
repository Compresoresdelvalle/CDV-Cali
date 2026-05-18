import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { formatCOP, safeError, sanitizeSearch } from "../../lib/utils";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";

/**
 * Modal para abrir garantía de venta o de OT entregada (Fase 13).
 *
 * Resoluciones:
 *   - cambiar_pieza: descuenta inventario nuevo, cierra garantía
 *   - devolver_dinero: registra monto, cierra garantía (sin tocar stock)
 *   - arreglar_producto: crea OT con tipo='garantia' vinculada
 *
 * Props:
 *   - origen: { tipo: "venta"|"ot", id: UUID, cliente_nombre, sede_id, items? }
 *   - onClose: () => void
 *   - onCreated: (garantia_id) => void
 */
export default function ModalAbrirGarantiaVenta({
  origen,
  onClose,
  onCreated,
}) {
  const [resolucion, setResolucion] = useState("cambiar_pieza");
  const [motivo, setMotivo] = useState("");
  const [montoDevuelto, setMontoDevuelto] = useState("");
  const [equipoDescripcion, setEquipoDescripcion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Productos para "cambiar_pieza"
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [items, setItems] = useState([]); // [{ producto_id, nombre, cantidad }]
  const mountedRef = useRef(true);
  const guardandoRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const buscar = async (q) => {
    if ((q ?? "").trim().length < 2) {
      setResultados([]);
      return;
    }
    // sanitizeSearch elimina los metacaracteres PostgREST (`,().:*`) para que
    // el término no pueda manipular el filtro `.or()`.
    const term = sanitizeSearch(q);
    if (term.length < 2) {
      setResultados([]);
      return;
    }
    const { data, error } = await supabase
      .from("productos")
      .select("id, nombre, referencia, codigo_interno")
      .eq("activo", true)
      .or(
        `nombre.ilike.%${term}%,referencia.ilike.%${term}%,codigo_interno.ilike.%${term}%`,
      )
      .limit(15);
    if (mountedRef.current) setResultados(error ? [] : (data ?? []));
  };
  const buscarDebounced = useDebouncedCallback(buscar, 300);

  const addItem = (p) => {
    setItems((prev) =>
      prev.some((i) => i.producto_id === p.id)
        ? prev
        : [...prev, { producto_id: p.id, nombre: p.nombre, cantidad: 1 }],
    );
    setBusqueda("");
    setResultados([]);
  };
  const setQty = (id, v) => {
    const n = Math.max(1, Number(v) || 1);
    setItems((prev) =>
      prev.map((i) => (i.producto_id === id ? { ...i, cantidad: n } : i)),
    );
  };
  const removeItem = (id) =>
    setItems((prev) => prev.filter((i) => i.producto_id !== id));

  const submit = async () => {
    setErrorMsg("");
    if (resolucion === "cambiar_pieza" && items.length === 0) {
      setErrorMsg("Selecciona al menos un repuesto para cambiar");
      return;
    }
    if (resolucion === "devolver_dinero") {
      const monto = Number(montoDevuelto);
      // String vacío → Number("")=NaN; NaN<=0 es false, así que valida aparte
      if (montoDevuelto === "" || !Number.isFinite(monto) || monto <= 0) {
        setErrorMsg("Indica un monto a devolver válido (mayor a 0)");
        return;
      }
    }

    // Guard síncrono anti doble-submit (el `disabled` no aplica de inmediato).
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setSubmitting(true);
    try {
      const payload = {
        venta_id: origen.tipo === "venta" ? origen.id : null,
        orden_servicio_id: origen.tipo === "ot" ? origen.id : null,
        resolucion,
        motivo: motivo.trim() || null,
        monto_devuelto:
          resolucion === "devolver_dinero" ? Number(montoDevuelto) : null,
        equipo_descripcion:
          resolucion === "arreglar_producto"
            ? equipoDescripcion.trim() || null
            : null,
        items: resolucion === "cambiar_pieza" ? items : [],
      };
      const { data, error } = await supabase.rpc("fn_abrir_garantia_venta", {
        p_payload: payload,
      });
      if (error) throw error;
      onCreated?.(data);
    } catch (err) {
      setErrorMsg(safeError(err, "Error al abrir garantía"));
    } finally {
      setSubmitting(false);
      guardandoRef.current = false;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="rounded-xl border p-5 w-full max-w-2xl space-y-3 max-h-[85vh] overflow-hidden flex flex-col"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3
            className="text-lg font-semibold"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Cliente reclama garantía
          </h3>
          <button
            onClick={onClose}
            className="text-xs px-3 py-2 rounded-lg border cursor-pointer"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            Cerrar
          </button>
        </div>

        <p
          className="text-xs"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Cliente: <strong>{origen?.cliente_nombre ?? "—"}</strong>. Origen:{" "}
          {origen?.tipo === "venta" ? "Venta" : "Orden de servicio"}
        </p>

        {errorMsg && (
          <div
            role="alert"
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

        {/* Resolución */}
        <div className="space-y-2">
          <p
            className="text-xs uppercase tracking-wide font-semibold"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Resolución
          </p>
          {[
            {
              v: "cambiar_pieza",
              t: "Cambiar pieza",
              d: "Entrego un repuesto nuevo del inventario (descuenta stock)",
            },
            {
              v: "devolver_dinero",
              t: "Devolver dinero",
              d: "Registra monto a devolver (el recibo lo gestiona el módulo de recibos)",
            },
            {
              v: "arreglar_producto",
              t: "Arreglar producto",
              d: "Crea una OT nueva con tipo 'garantía' (sin cobro al cliente)",
            },
          ].map((opt) => (
            <label
              key={opt.v}
              className="flex items-start gap-2 p-2 rounded-lg cursor-pointer"
              style={{
                backgroundColor:
                  resolucion === opt.v
                    ? "hsl(var(--primary) / 0.06)"
                    : "transparent",
              }}
            >
              <input
                type="radio"
                name="resolucion-venta"
                value={opt.v}
                checked={resolucion === opt.v}
                onChange={() => setResolucion(opt.v)}
                className="mt-0.5 cursor-pointer"
              />
              <div>
                <p
                  className="text-sm font-medium"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {opt.t}
                </p>
                <p
                  className="text-xs"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {opt.d}
                </p>
              </div>
            </label>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 space-y-3">
          {/* cambiar_pieza: selector productos */}
          {resolucion === "cambiar_pieza" && (
            <div>
              <p
                className="text-xs uppercase tracking-wide font-semibold mb-1"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Repuestos a entregar
              </p>
              <input
                type="text"
                value={busqueda}
                onChange={(e) => {
                  setBusqueda(e.target.value);
                  buscarDebounced(e.target.value);
                }}
                placeholder="Buscar producto (mín. 2 letras)..."
                className="w-full px-3 py-2 rounded-lg border text-sm min-h-[44px]"
                style={{
                  backgroundColor: "hsl(var(--background))",
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
              />
              {resultados.length > 0 && (
                <ul
                  className="mt-1 border rounded-lg max-h-40 overflow-y-auto"
                  style={{ borderColor: "hsl(var(--border))" }}
                >
                  {resultados.map((p) => (
                    <li key={p.id}>
                      <button
                        onClick={() => addItem(p)}
                        className="w-full text-left px-3 py-2 text-sm cursor-pointer"
                        style={{
                          borderBottom: "1px solid hsl(var(--border) / 0.5)",
                          color: "hsl(var(--foreground))",
                        }}
                      >
                        {p.nombre}{" "}
                        <span style={{ opacity: 0.6 }}>
                          ({p.codigo_interno ?? p.referencia})
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {items.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {items.map((i) => (
                    <li
                      key={i.producto_id}
                      className="flex items-center gap-2 rounded-lg border px-2 py-1.5"
                      style={{ borderColor: "hsl(var(--border))" }}
                    >
                      <span className="flex-1 text-sm">{i.nombre}</span>
                      <input
                        type="number"
                        min={1}
                        value={i.cantidad}
                        onChange={(e) => setQty(i.producto_id, e.target.value)}
                        className="w-20 px-2 py-1 rounded border text-sm text-right"
                        style={{
                          backgroundColor: "hsl(var(--background))",
                          borderColor: "hsl(var(--border))",
                        }}
                      />
                      <button
                        onClick={() => removeItem(i.producto_id)}
                        className="text-xs px-2 py-1 rounded border cursor-pointer"
                        style={{
                          borderColor: "hsl(var(--destructive))",
                          color: "hsl(var(--destructive))",
                        }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* devolver_dinero: input monto */}
          {resolucion === "devolver_dinero" && (
            <div>
              <label
                className="text-xs"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Monto a devolver (COP)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={montoDevuelto}
                onChange={(e) => setMontoDevuelto(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg border text-sm"
                style={{
                  backgroundColor: "hsl(var(--background))",
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
              />
              {Number(montoDevuelto) > 0 && (
                <p
                  className="text-xs mt-1"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Total a devolver: {formatCOP(Number(montoDevuelto))}
                </p>
              )}
            </div>
          )}

          {/* arreglar_producto: descripción equipo */}
          {resolucion === "arreglar_producto" && (
            <div>
              <label
                className="text-xs"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Descripción del equipo a reparar (opcional)
              </label>
              <input
                type="text"
                value={equipoDescripcion}
                onChange={(e) => setEquipoDescripcion(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg border text-sm"
                style={{
                  backgroundColor: "hsl(var(--background))",
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
                placeholder="Si está vacío se usará referencia automática"
                maxLength={200}
              />
            </div>
          )}

          <div>
            <label
              className="text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Motivo (opcional)
            </label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              className="w-full mt-1 px-3 py-2 rounded-lg border text-sm"
              style={{
                backgroundColor: "hsl(var(--background))",
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--foreground))",
              }}
              maxLength={500}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-sm px-4 py-2 rounded-lg border cursor-pointer min-h-[44px] disabled:opacity-50"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="text-sm px-5 py-2 rounded-lg cursor-pointer min-h-[44px] disabled:opacity-50"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            {submitting ? "Abriendo..." : "Abrir garantía"}
          </button>
        </div>
      </div>
    </div>
  );
}
