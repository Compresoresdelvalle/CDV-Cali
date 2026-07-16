import { useState, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { safeError } from "../../lib/utils";

/**
 * Modal de recepción de una compra (S6 · recepción parcial).
 *
 * Muestra cada línea con la cantidad pedida y un campo "recibida" (por defecto
 * = pedida). Si el proveedor entregó incompleto, el usuario baja la cantidad:
 * la línea se ajusta a lo recibido (y el total de la compra se recalcula) antes
 * de ingresar el stock, evitando inventario inflado o deuda fantasma. Una línea
 * en 0 se elimina. Todo pasa por la RPC fn_recibir_compra.
 *
 * Props:
 *   - compra: { id, numero }
 *   - items: [{ id, cantidad, producto:{ nombre, referencia, unidad_medida } }]
 *   - onClose: () => void
 *   - onDone: () => void
 */
export default function RecibirCompraModal({ compra, items, onClose, onDone }) {
  const [recibidas, setRecibidas] = useState(() =>
    Object.fromEntries((items ?? []).map((i) => [i.id, String(i.cantidad)])),
  );
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState("");
  const guardandoRef = useRef(false);

  const set = (id, v) =>
    setRecibidas((prev) => ({ ...prev, [id]: v.replace(/[^\d]/g, "") }));

  const filas = (items ?? []).map((i) => {
    const rec = recibidas[i.id] === "" ? null : Number(recibidas[i.id]);
    const pedida = Number(i.cantidad);
    return {
      ...i,
      pedida,
      rec,
      parcial: rec != null && rec < pedida,
      cero: rec === 0,
    };
  });

  const hayParcial = filas.some((f) => f.parcial);
  const todasCero = filas.length > 0 && filas.every((f) => f.cero);
  const algunaInvalida = filas.some(
    (f) => f.rec == null || f.rec < 0 || f.rec > f.pedida,
  );

  const confirmar = async () => {
    if (guardandoRef.current) return;
    if (algunaInvalida) {
      setErr(
        "Revisa las cantidades: no pueden superar lo pedido ni quedar vacías.",
      );
      return;
    }
    if (todasCero) {
      setErr(
        "No recibiste ninguna unidad. Si no llegó nada, cancela la compra.",
      );
      return;
    }
    guardandoRef.current = true;
    setGuardando(true);
    setErr("");
    try {
      const p_recepciones = filas.map((f) => ({
        detalle_id: f.id,
        cantidad_recibida: f.rec,
      }));
      const { error } = await supabase.rpc("fn_recibir_compra", {
        p_compra_id: compra.id,
        p_recepciones,
      });
      if (error) throw error;
      onDone?.();
    } catch (e) {
      setErr(safeError(e, "No se pudo registrar la recepción"));
      setGuardando(false);
      guardandoRef.current = false;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={() => !guardando && onClose?.()}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border"
        style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-200)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b p-5" style={{ borderColor: "var(--n-150)" }}>
          <h3
            className="text-lg font-semibold"
            style={{ color: "var(--n-950)" }}
          >
            Recibir compra #{compra?.numero ?? "?"}
          </h3>
          <p className="mt-1 text-xs" style={{ color: "var(--n-500)" }}>
            Confirma cuánto llegó de cada producto. Recibir ingresa el stock al
            inventario y no se puede deshacer fácilmente.
          </p>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-5">
          {filas.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
              style={{
                borderColor: f.cero
                  ? "var(--dang-200)"
                  : f.parcial
                    ? "var(--warn-border, var(--warn-200))"
                    : "var(--n-150)",
              }}
            >
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-[13px] font-medium"
                  style={{ color: "var(--n-900)" }}
                >
                  {f.producto?.nombre ?? "—"}
                </p>
                <p
                  className="font-mono text-[11px]"
                  style={{ color: "var(--n-500)" }}
                >
                  Pedido: {f.pedida} {f.producto?.unidad_medida ?? ""}
                  {f.cero ? " · se eliminará" : f.parcial ? " · parcial" : ""}
                </p>
              </div>
              <input
                type="number"
                min="0"
                max={f.pedida}
                inputMode="numeric"
                value={recibidas[f.id]}
                onChange={(e) => set(f.id, e.target.value)}
                disabled={guardando}
                className="h-11 w-20 rounded-lg border px-2 text-center text-sm"
                style={{
                  borderColor: "var(--n-200)",
                  color: "var(--n-900)",
                  backgroundColor: "var(--n-0)",
                }}
                aria-label={`Cantidad recibida de ${f.producto?.nombre ?? ""}`}
              />
            </div>
          ))}
        </div>

        <div
          className="space-y-3 border-t p-5"
          style={{ borderColor: "var(--n-150)" }}
        >
          {hayParcial && !todasCero && (
            <p className="text-xs" style={{ color: "var(--warn-700)" }}>
              Recepción parcial: las líneas se ajustan a lo recibido. Lo que
              falte se registra como una compra nueva cuando llegue.
            </p>
          )}
          {err && (
            <div
              role="alert"
              className="rounded-lg border px-3 py-2 text-xs"
              style={{
                backgroundColor: "var(--dang-50)",
                borderColor: "var(--dang-200)",
                color: "var(--dang-700)",
              }}
            >
              {err}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={guardando}
              className="min-h-[44px] rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
              style={{ borderColor: "var(--n-200)", color: "var(--n-500)" }}
            >
              Cancelar
            </button>
            <button
              onClick={confirmar}
              disabled={guardando}
              className="min-h-[44px] rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
              style={{
                backgroundColor: "var(--succ-600, var(--succ-500))",
                color: "var(--p-contrast, #fff)",
              }}
            >
              {guardando ? "Recibiendo…" : "Confirmar recepción"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
