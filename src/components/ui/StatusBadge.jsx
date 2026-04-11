/**
 * Badge de estado de stock — usa las clases .status-badge de index.css
 * Props:
 *   status: 'OK' | 'Bajo' | 'Agotado' | 'Sobrestock'
 *   size: 'sm' | 'md' (default 'md')
 */

const STATUS_MAP = {
  OK: { label: "OK", modifier: "status-success", dot: "hsl(var(--success))" },
  Bajo: {
    label: "Bajo",
    modifier: "status-warning",
    dot: "hsl(var(--warning))",
  },
  Agotado: {
    label: "Agotado",
    modifier: "status-danger",
    dot: "hsl(var(--destructive))",
  },
  Sobrestock: {
    label: "Sobre",
    modifier: "status-info",
    dot: "hsl(var(--info))",
  },
};

export default function StatusBadge({ status, size = "md" }) {
  const cfg = STATUS_MAP[status] ?? STATUS_MAP.OK;
  const isSmall = size === "sm";

  return (
    <span
      className={`status-badge ${cfg.modifier} ${isSmall ? "text-[10px] px-1.5 py-0.5" : ""}`}
    >
      <span
        className={`rounded-full shrink-0 ${isSmall ? "w-1.5 h-1.5" : "w-2 h-2"}`}
        style={{ backgroundColor: cfg.dot }}
      />
      {cfg.label}
    </span>
  );
}
