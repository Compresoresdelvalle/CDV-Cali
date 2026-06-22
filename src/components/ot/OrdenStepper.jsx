import { Check } from "lucide-react";

/**
 * OrdenStepper — barra de progreso de los 7 pasos del asistente de OT.
 *
 * Desktop: horizontal con línea conectora.
 * Móvil: scroll-x compacto.
 *
 * Estados de cada paso (derivados de `actual`):
 *   - completado (i < actual): check verde (--success), navegable.
 *   - activo (i === actual): círculo --primary.
 *   - bloqueado (i > reachableUntil): --muted-foreground, no navegable.
 *
 * Props:
 *   pasos          : array PASOS (de ot-flujo.js) — { i, key, label }
 *   actual         : índice del paso actual de la OT
 *   onGo           : (i) => void — navega a un paso alcanzable
 *   reachableUntil : índice máximo navegable (normalmente = actual)
 */
export default function OrdenStepper({
  pasos = [],
  actual = 0,
  onGo,
  reachableUntil = actual,
}) {
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <ol className="flex items-center gap-0 min-w-max md:min-w-0" role="list">
        {pasos.map((p, idx) => {
          const completado = idx < actual;
          const activo = idx === actual;
          const alcanzable = idx <= reachableUntil;
          const esUltimo = idx === pasos.length - 1;

          // Tonos por estado.
          const circleBg = completado
            ? "hsl(var(--success))"
            : activo
              ? "hsl(var(--primary))"
              : "hsl(var(--muted))";
          const circleFg =
            completado || activo
              ? "hsl(var(--primary-foreground))"
              : "hsl(var(--muted-foreground))";
          const circleBorder = completado
            ? "hsl(var(--success))"
            : activo
              ? "hsl(var(--primary))"
              : "hsl(var(--border))";
          const labelColor = activo
            ? "hsl(var(--foreground))"
            : completado
              ? "hsl(var(--success))"
              : "hsl(var(--muted-foreground))";

          return (
            <li
              key={p.key}
              className="flex items-center"
              style={{ flex: esUltimo ? "0 0 auto" : "1 1 0%" }}
            >
              <button
                type="button"
                disabled={!alcanzable}
                onClick={() => alcanzable && onGo?.(idx)}
                aria-current={activo ? "step" : undefined}
                className="flex flex-col items-center gap-1.5 shrink-0 transition-opacity disabled:cursor-not-allowed"
                style={{
                  minWidth: 64,
                  cursor: alcanzable ? "pointer" : "not-allowed",
                }}
                title={p.titulo ?? p.label}
              >
                <span
                  className="grid place-items-center rounded-full border text-[13px] font-semibold transition-colors"
                  style={{
                    width: 32,
                    height: 32,
                    backgroundColor: circleBg,
                    color: circleFg,
                    borderColor: circleBorder,
                    boxShadow: activo
                      ? "0 0 0 4px hsl(var(--primary) / 0.12)"
                      : "none",
                  }}
                >
                  {completado ? (
                    <Check className="h-4 w-4" strokeWidth={3} />
                  ) : (
                    idx + 1
                  )}
                </span>
                <span
                  className="text-[11px] font-medium leading-tight text-center whitespace-nowrap"
                  style={{ color: labelColor }}
                >
                  {p.label}
                </span>
              </button>

              {/* Línea conectora (no en el último paso) */}
              {!esUltimo && (
                <span
                  aria-hidden
                  className="h-0.5 mx-1.5 md:mx-2 mb-5"
                  style={{
                    flex: "1 1 auto",
                    minWidth: 16,
                    backgroundColor:
                      idx < actual
                        ? "hsl(var(--success))"
                        : "hsl(var(--border))",
                  }}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
