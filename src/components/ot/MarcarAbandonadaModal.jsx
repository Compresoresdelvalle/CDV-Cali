import { useState } from "react";
import { PackageX, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCOP, safeError } from "../../lib/utils";
import { avisarOk } from "../../lib/notify";
import {
  SEDE_LABEL,
  MOTIVO_ABANDONADA_MIN,
  sedeEquipoActual,
  sedeParaAbandonar,
} from "../../lib/ot-flujo";

/**
 * Modal (hoja inferior en celular) para cerrar una OT como ABANDONADA: el
 * cliente nunca volvió por su equipo. Solo Admin (lo valida el servidor).
 *
 * Se usa desde el detalle de la OT y desde Alertas → "Equipos sin recoger".
 *
 * Props:
 *  - orden: { id, numero, cliente_nombre, equipo_descripcion, sede_id, sede_equipo_id }
 *  - abonado: lo que el cliente ya pagó en abonos (número)
 *  - onClose(): cerrar sin hacer nada
 *  - onDone(resultado): después de marcarla; el llamador refresca
 */
export default function MarcarAbandonadaModal({
  orden,
  abonado = 0,
  onClose,
  onDone,
}) {
  const sedeActual = sedeEquipoActual(orden) ?? "";
  const [motivo, setMotivo] = useState("");
  const [destino, setDestino] = useState(sedeActual);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const motivoLimpio = motivo.trim();
  const motivoOk = motivoLimpio.length >= MOTIVO_ABANDONADA_MIN;
  const abonos = Number(abonado) || 0;

  const cerrar = () => {
    if (!guardando) onClose?.();
  };

  const confirmar = async () => {
    if (guardando) return;
    if (!motivoOk) {
      setError(
        "Escribe por qué queda abandonada. Así, quien abra la OT después sabe qué pasó con el equipo.",
      );
      return;
    }
    setGuardando(true);
    setError("");
    try {
      const { data, error: e } = await supabase.rpc("fn_marcar_ot_abandonada", {
        p_orden_id: orden.id,
        p_motivo: motivoLimpio,
        p_sede_equipo: sedeParaAbandonar(orden, destino),
      });
      if (e) throw e;
      const siguen = Number(data?.abonos_que_siguen_en_cierre) || 0;
      avisarOk(
        siguen > 0
          ? `OT-${orden.numero} cerrada como abandonada. Los ${formatCOP(siguen)} de abonos siguen en la caja.`
          : `OT-${orden.numero} cerrada como abandonada.`,
      );
      await onDone?.(data);
    } catch (err) {
      setError(
        safeError(
          err,
          "No se pudo marcar la OT como abandonada. Revisa tu conexión e inténtalo de nuevo.",
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
        aria-labelledby="abandonada-title"
      >
        <div
          className="flex items-start gap-3 border-b px-5 py-4"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
            style={{
              backgroundColor: "hsl(var(--warning) / 0.12)",
              color: "hsl(var(--warning))",
            }}
          >
            <PackageX className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="abandonada-title"
              className="text-lg font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Marcar OT-{orden?.numero} como abandonada
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
          {/* Qué pasa con la OT y con la plata */}
          <div
            className="rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed"
            style={{
              backgroundColor: "hsl(var(--warning) / 0.08)",
              borderColor: "hsl(var(--warning) / 0.35)",
              color: "hsl(var(--foreground))",
            }}
          >
            <p>
              La OT queda cerrada como abandonada y ya no se puede seguir
              trabajando ni facturar.
            </p>
            <p className="mt-1.5">
              {abonos > 0 ? (
                <>
                  Los abonos que dejó el cliente (
                  <b className="tabular-nums">{formatCOP(abonos)}</b>) siguen
                  contando en la caja: esa plata sí entró.
                </>
              ) : (
                "El cliente no dejó abonos en esta OT, así que la caja no cambia."
              )}
            </p>
            <p
              className="mt-1.5"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              El equipo se puede seguir moviendo de sede después.
            </p>
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
              placeholder="Ej.: el cliente no contesta hace 3 meses; va para chatarra. O: el cliente dijo que no lo recoge, se deja para repuestos."
              className="w-full rounded-lg border p-3 text-sm outline-none disabled:opacity-60"
              style={inputStyle}
            />
          </label>

          <label className="block space-y-1.5">
            <span
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              ¿Dónde queda el equipo?
            </span>
            <select
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              disabled={guardando}
              className="h-12 w-full rounded-lg border px-3 text-sm outline-none disabled:opacity-60"
              style={inputStyle}
            >
              {Object.entries(SEDE_LABEL).map(([id, nombre]) => (
                <option key={id} value={id}>
                  {id === sedeActual ? `${nombre} (donde está ahora)` : nombre}
                </option>
              ))}
            </select>
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
              motivoOk ? undefined : "Escribe el motivo para poder confirmar"
            }
            className="h-12 flex-1 rounded-lg border text-sm font-semibold disabled:opacity-60"
            style={{
              // Advertencia, no rojo: cerrar como abandonada no es un error.
              // Texto en --foreground para que se lea en claro y en oscuro.
              backgroundColor: "hsl(var(--warning) / 0.18)",
              borderColor: "hsl(var(--warning) / 0.6)",
              color: "hsl(var(--foreground))",
            }}
          >
            {guardando ? "Guardando…" : "Marcar abandonada"}
          </button>
        </div>
      </div>
    </div>
  );
}
