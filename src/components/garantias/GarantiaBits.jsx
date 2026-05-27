import { Check } from "lucide-react";

/**
 * Piezas visuales compartidas del DETALLE de Garantías (diseño Lovable F13).
 *
 * Reproducen 1:1 los bloques del `ops.garantias.$id.tsx` de Lovable
 * (state machine / proceso, caja de vigencia, timeline de historial, campos),
 * conectados a los datos REALES. Solo presentación — sin fetching ni lógica.
 */

/* ─────────────────────── Caja de vigencia (vence / días) ───────────────── */

const TONE_VIGENCIA = {
  ok: { fg: "var(--succ-700)", bg: "var(--succ-50)", bd: "var(--succ-border)" },
  warn: {
    fg: "var(--warn-700)",
    bg: "var(--warn-50)",
    bd: "var(--warn-border)",
  },
  danger: {
    fg: "var(--dang-700)",
    bg: "var(--dang-50)",
    bd: "var(--dang-border)",
  },
  expired: {
    fg: "var(--dang-700)",
    bg: "var(--dang-50)",
    bd: "var(--dang-border)",
  },
};

/**
 * Caja "Vence · N días restantes" del header (garantías de venta).
 * Reproduce el bloque destacado del diseño Lovable usando la vigencia
 * derivada de la fecha origen + parámetro `dias_garantia_venta`.
 */
export function VigenciaBox({ vence, diasRestantes, tone, fmtDate }) {
  if (vence == null || diasRestantes == null) return null;
  const c = TONE_VIGENCIA[tone] ?? TONE_VIGENCIA.ok;
  const vencido = tone === "expired";
  return (
    <div
      className="rounded-[10px] border px-4 py-3 text-right"
      style={{ borderColor: c.bd, backgroundColor: c.bg }}
    >
      <div
        className="text-[11px] uppercase tracking-wider"
        style={{ color: c.fg }}
      >
        {vencido ? "Venció" : "Vence"} {fmtDate(vence)}
      </div>
      <div
        className="font-mono text-[26px] font-semibold leading-none"
        style={{ color: c.fg }}
      >
        {vencido ? Math.abs(diasRestantes) : diasRestantes}
        <span className="ml-1.5 font-sans text-[11px] font-normal opacity-80">
          {vencido ? "días vencida" : "días restantes"}
        </span>
      </div>
    </div>
  );
}

/* ─────────────────────── State machine (proceso) ──────────────────────── */

/**
 * State machine del proceso de la reclamación. Reutiliza el sistema CSS
 * `.stepper`/`.step`/`.step-dot`/`.step-line` ya existente en el design system.
 *
 * @param {{ pasos: Array<{ label: string, meta: string, state: 'done'|'active'|'pending' }> }} props
 */
export function ProcesoStepper({ pasos }) {
  if (!pasos || pasos.length === 0) return null;
  return (
    <div className="iblock">
      <div
        className="mb-3 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-wider"
        style={{ color: "var(--n-500)" }}
      >
        <span>Proceso de la reclamación</span>
      </div>
      <div className="overflow-x-auto">
        <div className="flex min-w-[480px] items-start">
          {pasos.map((p, i) => {
            const stepClass =
              p.state === "done"
                ? "done"
                : p.state === "active"
                  ? "active"
                  : "todo";
            const lineDone = p.state === "done";
            return (
              <div key={i} className="flex flex-1 items-start">
                {i > 0 && (
                  <div
                    className={
                      "step-line" +
                      (pasos[i - 1].state === "done" ? " done" : "")
                    }
                  />
                )}
                <div className={"step " + stepClass} style={{ minWidth: 96 }}>
                  <span
                    className="step-dot"
                    style={
                      p.state === "active"
                        ? {
                            boxShadow: "0 0 0 4px hsl(var(--p-600) / 0)",
                            outline: "4px solid var(--p-100)",
                          }
                        : undefined
                    }
                  >
                    {p.state === "done" ? (
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="step-lbl text-center">{p.label}</span>
                  <span
                    className="font-mono text-[10px]"
                    style={{ color: "var(--n-400)" }}
                  >
                    {p.meta}
                  </span>
                </div>
                {i < pasos.length - 1 && (
                  <div className={"step-line" + (lineDone ? " done" : "")} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Timeline (historial) ─────────────────────── */

/**
 * Timeline vertical (sidebar "Historial"). Reutiliza el sistema CSS
 * `.timeline`/`.tl-row`/`.tl-dot` ya existente.
 */
export function HistorialTimeline({ eventos }) {
  if (!eventos || eventos.length === 0) return null;
  return (
    <div className="timeline">
      {eventos.map((t, i) => (
        <div className="tl-row" key={i}>
          <span className={`tl-dot ${t.tone}`} />
          <div>
            <div className="tl-act">{t.act}</div>
            <div className="tl-meta">{t.meta}</div>
          </div>
          {t.time && <span className="tl-time">{t.time}</span>}
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────────── Campos (FieldGrid) ──────────────────────── */

/** Campo etiqueta + valor del diseño Lovable (FieldGrid). */
export function Fact({ lk, v, mono, full }) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <div
        className="mb-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--n-300)" }}
      >
        {lk}
      </div>
      <div
        className={"text-[13px] font-medium " + (mono ? "font-mono" : "")}
        style={{ color: "var(--n-950)" }}
      >
        {v}
      </div>
    </div>
  );
}

/** Caja-dato compacta con tono opcional (FactBox). */
export function FactBox({ lk, v, tone }) {
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border p-3"
      style={{ borderColor: "var(--n-100)", backgroundColor: "var(--n-50)" }}
    >
      <span
        className="font-mono text-[10px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--n-500)" }}
      >
        {lk}
      </span>
      <span
        className="font-mono text-[13.5px] font-medium"
        style={{ color: tone === "succ" ? "var(--succ-700)" : "var(--n-950)" }}
      >
        {v}
      </span>
    </div>
  );
}

/** Bloque "Motivo" reutilizable (textarea read-only estilizado). */
export function MotivoBlock({ motivo }) {
  if (!motivo) return null;
  return (
    <div className="mt-3">
      <div
        className="mb-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--n-300)" }}
      >
        Motivo de la reclamación
      </div>
      <blockquote
        className="rounded-lg border-l-2 px-3.5 py-3 text-[12.5px] italic leading-[1.55]"
        style={{
          borderColor: "var(--p-300)",
          backgroundColor: "var(--n-50)",
          color: "var(--n-700)",
        }}
      >
        {motivo}
      </blockquote>
    </div>
  );
}

/* ──────────────────── Card de política aplicable F13 ───────────────────── */

/**
 * Card "Política aplicable F13". El diseño Lovable muestra texto canónico;
 * aquí mostramos las reglas REALES derivadas del parámetro de vigencia y del
 * tipo de garantía (compra vs venta). No inventa cláusulas sin respaldo.
 */
export function PoliticaCard({ items, configHref, onConfig }) {
  if (!items || items.length === 0) return null;
  return (
    <div
      className="rounded-[10px] border p-4"
      style={{
        borderColor: "var(--p-200)",
        backgroundColor: "var(--p-50)",
      }}
    >
      <div
        className="mb-2 font-mono text-[10.5px] uppercase tracking-wider"
        style={{ color: "var(--p-700)" }}
      >
        Política aplicable F13
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((p, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-[12px] leading-relaxed"
            style={{ color: "var(--n-700)" }}
          >
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: "var(--p-600)" }}
            />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      {onConfig && (
        <button
          onClick={onConfig}
          className="mt-3 inline-block text-[11.5px] font-medium underline-offset-2 hover:underline"
          style={{ color: "var(--p-700)" }}
        >
          {configHref ?? "Ver parámetros de garantía en Configuración"}
        </button>
      )}
    </div>
  );
}
