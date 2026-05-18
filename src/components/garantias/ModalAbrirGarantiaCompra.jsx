import { useState, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { formatCOP, safeError } from "../../lib/utils";

/**
 * Modal para abrir garantía de compra (Fase 13).
 *
 * Permite seleccionar uno o más items de la compra ya recibida, indicar
 * cantidad a devolver y elegir resolución (nota crédito / reposición /
 * pendiente). El backend descuenta stock y, si aplica, crea la nota crédito.
 *
 * Props:
 *   - compra: objeto con { id, proveedor }
 *   - items: detalle_compra[] (id, cantidad, costo_unitario, producto_id, producto)
 *   - onClose: () => void
 *   - onCreated: (garantia_id) => void
 */
export default function ModalAbrirGarantiaCompra({
  compra,
  items,
  onClose,
  onCreated,
}) {
  // selección: { detalle_id: cantidad }
  const [sel, setSel] = useState({});
  const [resolucion, setResolucion] = useState("nota_credito");
  const [motivo, setMotivo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const guardandoRef = useRef(false);

  const toggleItem = (it) => {
    setSel((prev) =>
      prev[it.id] != null
        ? Object.fromEntries(
            Object.entries(prev).filter(([k]) => k !== String(it.id)),
          )
        : { ...prev, [it.id]: it.cantidad },
    );
  };

  const setCantidad = (it, v) => {
    const n = Math.max(1, Math.min(it.cantidad, Number(v) || 1));
    setSel((prev) => ({ ...prev, [it.id]: n }));
  };

  const seleccionados = items.filter((i) => sel[i.id] != null);
  const montoEstimado = seleccionados.reduce(
    (acc, i) => acc + sel[i.id] * Number(i.costo_unitario),
    0,
  );

  const submit = async () => {
    setErrorMsg("");
    if (seleccionados.length === 0) {
      setErrorMsg("Selecciona al menos un item para abrir la garantía");
      return;
    }
    // Guard síncrono anti doble-submit (el `disabled` no aplica de inmediato).
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setSubmitting(true);
    try {
      const payload = {
        compra_id: compra.id,
        resolucion,
        motivo: motivo.trim() || null,
        items: seleccionados.map((i) => ({
          producto_id: i.producto_id,
          cantidad: sel[i.id],
          costo_unitario: Number(i.costo_unitario),
        })),
      };
      const { data, error } = await supabase.rpc("fn_abrir_garantia_compra", {
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
            Devolver al proveedor por garantía
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
          Proveedor: <strong>{compra?.proveedor}</strong>. Los items
          seleccionados saldrán del inventario.
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

        {/* Items */}
        <div className="overflow-y-auto flex-1 min-h-0">
          <ul className="space-y-1.5">
            {items.map((it) => {
              const checked = sel[it.id] != null;
              return (
                <li
                  key={it.id}
                  className="rounded-lg border px-3 py-2"
                  style={{
                    backgroundColor: checked
                      ? "hsl(var(--primary) / 0.06)"
                      : "hsl(var(--background))",
                    borderColor: checked
                      ? "hsl(var(--primary))"
                      : "hsl(var(--border))",
                  }}
                >
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleItem(it)}
                      className="cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-medium"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {it.producto?.nombre}
                      </p>
                      <p
                        className="text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        compradas: {it.cantidad} ×{" "}
                        {formatCOP(it.costo_unitario)}
                      </p>
                    </div>
                    {checked && (
                      <input
                        type="number"
                        min={1}
                        max={it.cantidad}
                        value={sel[it.id]}
                        onChange={(e) => setCantidad(it, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-20 px-2 py-1 rounded-lg border text-sm text-right"
                        style={{
                          backgroundColor: "hsl(var(--card))",
                          borderColor: "hsl(var(--border))",
                        }}
                      />
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

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
              v: "nota_credito",
              t: "Nota crédito del proveedor",
              d: `Saldo a favor de ~${formatCOP(montoEstimado)} para descontar en próxima compra`,
            },
            {
              v: "reposicion_fisica",
              t: "Reposición física",
              d: "Proveedor enviará producto nuevo (queda pendiente recibir)",
            },
            {
              v: "pendiente",
              t: "Pendiente — no decidida aún",
              d: "Abierta hasta que el proveedor responda",
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
                name="resolucion"
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
            placeholder="Detalle del defecto..."
            maxLength={500}
          />
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
            disabled={submitting || seleccionados.length === 0}
            className="text-sm px-5 py-2 rounded-lg cursor-pointer min-h-[44px] disabled:opacity-50"
            style={{
              backgroundColor: "hsl(var(--warning))",
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
