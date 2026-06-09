/**
 * Badge tipo de producto: nuevo / segunda mano / chatarra (Fase 12).
 * Discreto en cards y tablas de Inventario.
 *
 * "chatarra" = retorno defectuoso por garantía (no vendible).
 */
const TIPO_CFG = {
  segunda_mano: {
    label: "Segunda mano",
    color: "warning",
    title: "Producto de segunda mano",
  },
  chatarra: {
    label: "Chatarra",
    color: "destructive",
    title: "Chatarra — no vendible (retorno por garantía)",
  },
};
const TIPO_NUEVO = {
  label: "Nuevo",
  color: "success",
  title: "Producto nuevo",
};

export default function TipoProductoBadge({ tipo }) {
  if (!tipo) return null;
  const cfg = TIPO_CFG[tipo] ?? TIPO_NUEVO;
  return (
    <span
      className="px-2 py-0.5 rounded text-[10px] font-semibold"
      style={{
        backgroundColor: `hsl(var(--${cfg.color}) / 0.15)`,
        color: `hsl(var(--${cfg.color}))`,
      }}
      title={cfg.title}
    >
      {cfg.label}
    </span>
  );
}
