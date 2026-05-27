import { Wrench } from "lucide-react";
import {
  iniciales as calcIniciales,
  avatarClase,
} from "../../lib/herramientas-ui";

/**
 * Piezas visuales compartidas del módulo Herramientas (diseño Lovable).
 *
 * Reproducen 1:1 los elementos `hrm-tool-ico`, `hrm-av`, `pill` con dot del
 * `ops.herramientas.*` de Lovable, conectados a los datos REALES
 * (nombres de usuario, estados, sedes). Solo presentación.
 */

/** Icono morado de herramienta (clase `hrm-tool-ico`, tamaños sm/lg/xl). */
export function ToolIcon({ size = "md" }) {
  const cls =
    size === "lg"
      ? "hrm-tool-ico lg"
      : size === "xl"
        ? "hrm-tool-ico xl"
        : "hrm-tool-ico";
  const icon =
    size === "lg" ? "h-7 w-7" : size === "xl" ? "h-9 w-9" : "h-5 w-5";
  return (
    <div className={cls} aria-hidden>
      <Wrench className={icon} strokeWidth={1.7} />
    </div>
  );
}

/**
 * Avatar circular de usuario. Si hay nombre real usa un gradiente estable
 * (`hrm-av-*`); si no, dibuja un avatar neutro conservando el espacio visual.
 * @param {{ nombre?: string|null, size?: "sm"|"md"|"lg"|"" }} props
 */
export function UserAvatar({ nombre, size = "" }) {
  const grad = avatarClase(nombre);
  const ini = nombre ? calcIniciales(nombre) : "··";
  const sizeCls = size ? ` ${size}` : "";
  if (grad) {
    return (
      <div className={`hrm-av${sizeCls} ${grad}`} title={nombre ?? undefined}>
        {ini}
      </div>
    );
  }
  // Avatar neutro (sin nombre real): mantiene la composición Lovable.
  return (
    <div
      className={`hrm-av${sizeCls}`}
      title="Sin usuario"
      style={{
        background: "var(--n-100)",
        color: "var(--n-500)",
        border: "1px solid var(--n-200)",
      }}
    >
      {ini}
    </div>
  );
}

/**
 * Pill con dot, replicando el `<span class="pill pill-*">` de Lovable.
 * `cls` ∈ pill-success | pill-warn | pill-danger | pill-info | pill-neutral.
 * @param {{ cls: string, label: string, pulse?: boolean, small?: boolean }} props
 */
export function Pill({ cls, label, pulse = false, small = false }) {
  const style = small
    ? { height: 20, padding: "0 8px", fontSize: 11 }
    : undefined;
  return (
    <span className={`pill ${cls}${pulse ? " pulse-dot" : ""}`} style={style}>
      <span className="dot" />
      {label}
    </span>
  );
}
