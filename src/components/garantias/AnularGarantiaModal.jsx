import { useState } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Modal de confirmación para anular (revertir) una garantía de venta o compra.
 * Recoge un motivo opcional y delega la llamada RPC al padre vía onConfirm(motivo).
 *
 * Props:
 *   - open: boolean
 *   - tipo: "venta" | "compra"
 *   - busy: boolean (deshabilita los botones mientras corre la RPC)
 *   - onClose(): cerrar sin anular
 *   - onConfirm(motivo: string | null): ejecutar la anulación
 */
export default function AnularGarantiaModal({
  open,
  tipo = "venta",
  busy = false,
  onClose,
  onConfirm,
}) {
  const [motivo, setMotivo] = useState("");
  if (!open) return null;

  const advertencia =
    tipo === "compra"
      ? "Se revertirá el stock movido por la garantía y se anulará la nota de crédito asociada (solo si no fue consumida)."
      : "Se revertirá el stock movido (reingreso de piezas / retiro de chatarra) y se cancelará la OT de reparación si aún no fue entregada.";

  const cerrar = () => {
    setMotivo("");
    onClose();
  };
  const confirmar = () => onConfirm(motivo.trim() || null);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={() => !busy && cerrar()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full space-y-3 rounded-t-2xl p-5 sm:max-w-md sm:rounded-2xl"
        style={{ backgroundColor: "hsl(var(--card))" }}
        role="alertdialog"
        aria-labelledby="anular-garantia-title"
      >
        <div className="flex items-start gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{
              backgroundColor: "hsl(var(--destructive) / 0.12)",
              color: "hsl(var(--destructive))",
            }}
          >
            <AlertTriangle className="h-4 w-4" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h2
              id="anular-garantia-title"
              className="text-lg font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Anular garantía de {tipo}
            </h2>
            <p
              className="mt-1 text-sm"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {advertencia}
            </p>
          </div>
        </div>

        <p
          className="text-xs"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Esta acción no se puede deshacer. La reversa queda registrada en el
          historial de movimientos.
        </p>

        <div>
          <label
            className="text-xs font-medium"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Motivo (opcional)
          </label>
          <textarea
            rows={2}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            disabled={busy}
            placeholder="Ej.: apertura por error, resolución equivocada…"
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            style={{
              borderColor: "hsl(var(--border))",
              backgroundColor: "hsl(var(--background))",
              color: "hsl(var(--foreground))",
            }}
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={cerrar}
            disabled={busy}
            className="h-12 flex-1 rounded-lg border text-sm font-medium disabled:opacity-50"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
              backgroundColor: "transparent",
            }}
          >
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={busy}
            className="h-12 flex-1 rounded-lg text-sm font-medium disabled:opacity-60"
            style={{
              backgroundColor: "hsl(var(--destructive))",
              color: "hsl(var(--destructive-foreground))",
            }}
          >
            {busy ? "Anulando…" : "Anular garantía"}
          </button>
        </div>
      </div>
    </div>
  );
}
