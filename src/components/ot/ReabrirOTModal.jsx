import { useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { safeError } from "../../lib/utils";
import { avisarOk } from "../../lib/notify";
import { MOTIVO_ABANDONADA_MIN } from "../../lib/ot-flujo";

/**
 * Modal (hoja inferior en celular) para REABRIR una OT abandonada: el cliente
 * volvió por el equipo. Solo Admin (lo valida fn_reabrir_ot_abandonada).
 * La OT vuelve al estado en que estaba antes de abandonarla.
 *
 * Mismo estilo que MarcarAbandonadaModal.
 *
 * Props:
 *  - orden: { id, numero, cliente_nombre, equipo_descripcion }
 *  - onClose(): cerrar sin hacer nada
 *  - onDone(resultado): después de reabrirla; el llamador refresca
 */
export default function ReabrirOTModal({ orden, onClose, onDone }) {
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const motivoLimpio = motivo.trim();
  const motivoOk = motivoLimpio.length >= MOTIVO_ABANDONADA_MIN;

  const cerrar = () => {
    if (!guardando) onClose?.();
  };

  const confirmar = async () => {
    if (guardando) return;
    if (!motivoOk) {
      setError(
        `Escribe por qué se reabre (mínimo ${MOTIVO_ABANDONADA_MIN} letras), por ejemplo: "el cliente volvió por el equipo".`,
      );
      return;
    }
    setGuardando(true);
    setError("");
    try {
      const { data, error: e } = await supabase.rpc(
        "fn_reabrir_ot_abandonada",
        { p_orden_id: orden.id, p_motivo: motivoLimpio },
      );
      if (e) throw e;
      avisarOk(
        `OT-${orden.numero} reabierta: quedó como estaba antes de abandonarla.`,
      );
      await onDone?.(data);
    } catch (err) {
      setError(
        safeError(
          err,
          "No se pudo reabrir la OT. Revisa tu conexión e inténtalo de nuevo.",
        ),
      );
    } finally {
      setGuardando(false);
    }
  };

  const inputStyle = {
    borderColor: "hsl(var(--border))",
    backgroundColor: "hsl(var(--background))",
    color: "hsl(var(--foreground))",
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={cerrar}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl"
        style={{ backgroundColor: "hsl(var(--card))" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reabrir-ot-title"
      >
        <div
          className="flex items-start gap-3 border-b px-5 py-4"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
            style={{
              backgroundColor: "hsl(var(--primary) / 0.12)",
              color: "hsl(var(--primary))",
            }}
          >
            <RotateCcw className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="reabrir-ot-title"
              className="text-lg font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Reabrir OT-{orden?.numero}
            </h2>
            <p
              className="truncate text-sm"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {orden?.cliente_nombre || "Sin cliente"}
              {orden?.equipo_descripcion
                ? ` · ${orden.equipo_descripcion}`
                : ""}
            </p>
          </div>
          <button
            onClick={cerrar}
            disabled={guardando}
            aria-label="Cerrar"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-lg -mr-2 -mt-1"
            style={{ color: "hsl(var(--muted-foreground))" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor =
                "hsl(var(--muted) / 0.5)")
            }
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div
            className="rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed"
            style={{
              backgroundColor: "hsl(var(--info) / 0.08)",
              borderColor: "hsl(var(--info) / 0.35)",
              color: "hsl(var(--foreground))",
            }}
          >
            La OT vuelve a como estaba antes de abandonarla. Úsalo si el cliente
            volvió por el equipo.
          </div>

          <label className="block space-y-1.5">
            <span
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Motivo (obligatorio)
            </span>
            <textarea
              value={motivo}
              onChange={(e) => {
                setMotivo(e.target.value);
                if (error) setError("");
              }}
              disabled={guardando}
              rows={3}
              autoFocus
              placeholder="Ej.: el cliente volvió por el equipo y va a pagar el saldo."
              className="w-full rounded-lg border p-3 text-sm outline-none disabled:opacity-60"
              style={inputStyle}
            />
          </label>

          {error && (
            <div
              role="alert"
              className="rounded-lg border px-3 py-2 text-sm"
              style={{
                backgroundColor: "hsl(var(--destructive) / 0.08)",
                borderColor: "hsl(var(--destructive) / 0.3)",
                color: "hsl(var(--destructive))",
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          className="flex gap-2 border-t px-5 py-4"
          style={{
            borderColor: "hsl(var(--border))",
            paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
          }}
        >
          <button
            onClick={cerrar}
            disabled={guardando}
            className="h-12 flex-1 rounded-lg border text-sm font-medium disabled:opacity-60"
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
            disabled={guardando || !motivoOk}
            title={
              motivoOk
                ? undefined
                : `Escribe el motivo (mínimo ${MOTIVO_ABANDONADA_MIN} letras) para poder confirmar`
            }
            className="h-12 flex-1 rounded-lg border text-sm font-semibold disabled:opacity-60"
            style={{
              backgroundColor: "hsl(var(--primary))",
              borderColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            {guardando ? "Reabriendo…" : "Reabrir OT"}
          </button>
        </div>
      </div>
    </div>
  );
}
