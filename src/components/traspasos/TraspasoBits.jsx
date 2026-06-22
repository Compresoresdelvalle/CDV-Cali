import { Shield } from "lucide-react";
import {
  sedeCorto,
  sedeDotVar,
  iniciales as calcIniciales,
  avatarGradient,
} from "../../lib/traspasos-ui";

/**
 * Piezas visuales compartidas del módulo Traspasos (diseño Lovable).
 *
 * Reproducen 1:1 los helpers `WhChip`, `Avatar`, `Pill` y los badges del
 * `ops.traspasos.index.tsx` de Lovable, conectados a los datos REALES
 * (IDs de sede TEXT, nombres de usuario). Solo presentación.
 */

/** Chip de sede con dot de color estable por sede. */
export function WhChip({ sedeId }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-[3px] font-mono text-[11.5px]"
      style={{
        borderColor: "var(--n-150)",
        backgroundColor: "var(--n-50)",
        color: "var(--n-700)",
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: sedeDotVar(sedeId) }}
      />
      {sedeCorto(sedeId)}
    </span>
  );
}

/**
 * Avatar circular del responsable. Si no hay nombre real, dibuja un avatar
 * neutro (sin gradiente) conservando el espacio visual del diseño.
 */
export function Avatar({ nombre, size = 22 }) {
  const grad = avatarGradient(nombre);
  const ini = nombre ? calcIniciales(nombre) : "··";
  return (
    <span
      title={nombre ?? "Sin responsable"}
      className="inline-flex items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size <= 22 ? 10 : 11,
        color: grad ? "#fff" : "var(--n-500)",
        background: grad ?? "var(--n-100)",
        border: grad ? "none" : "1px solid var(--n-200)",
      }}
    >
      {ini}
    </span>
  );
}

const PILL_MAP = {
  neut: {
    bg: "var(--n-50)",
    fg: "var(--n-700)",
    bd: "var(--n-150)",
    dot: "var(--n-400)",
  },
  info: {
    bg: "var(--info-50)",
    fg: "var(--info-700)",
    bd: "var(--info-border)",
    dot: "var(--info-500)",
  },
  warn: {
    bg: "var(--warn-50)",
    fg: "var(--warn-700)",
    bd: "var(--warn-border)",
    dot: "var(--warn-500)",
  },
  succ: {
    bg: "var(--succ-50)",
    fg: "var(--succ-700)",
    bd: "var(--succ-border)",
    dot: "var(--succ-500)",
  },
  dang: {
    bg: "var(--dang-50)",
    fg: "var(--dang-700)",
    bd: "var(--dang-border)",
    dot: "var(--dang-500)",
  },
  prog: {
    bg: "var(--prog-50)",
    fg: "var(--prog-700)",
    bd: "var(--prog-border)",
    dot: "var(--prog-500)",
  },
};

/** Pill con dot, replicando el `<Pill>` de Lovable. `kind` ∈ PILL_MAP. */
export function Pill({ kind, label }) {
  const c = PILL_MAP[kind] ?? PILL_MAP.neut;
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[11px] font-medium"
      style={{ background: c.bg, color: c.fg, borderColor: c.bd }}
    >
      <span
        className="h-[5px] w-[5px] rounded-full"
        style={{ background: c.dot }}
      />
      {label}
    </span>
  );
}

/** Badge "Garantía" (tipo devolucion_garantia). */
export function BadgeGarantia({ compact = false }) {
  return (
    <span
      className="ml-1 inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[0.04em]"
      style={{
        borderColor: "var(--prog-border)",
        backgroundColor: "var(--prog-50)",
        color: "var(--prog-700)",
      }}
    >
      <Shield className="h-2.5 w-2.5" strokeWidth={2} />
      Garantía
    </span>
  );
}

/** Badge "Abandonada" (tipo mercancia_abandonada). */
export function BadgeAbandonada() {
  return (
    <span
      className="ml-1 inline-flex items-center rounded-[5px] border px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[0.04em]"
      style={{
        borderColor: "var(--warn-border)",
        backgroundColor: "var(--warn-50)",
        color: "var(--warn-700)",
      }}
    >
      Abandonada
    </span>
  );
}

/** Renderiza el badge correspondiente al tipo (o nada). */
export function TipoBadge({ badge, compact = false }) {
  if (badge === "garantia") return <BadgeGarantia compact={compact} />;
  if (badge === "abandonada") return <BadgeAbandonada />;
  return null;
}
