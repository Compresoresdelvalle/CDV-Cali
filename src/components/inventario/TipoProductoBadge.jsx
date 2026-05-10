/**
 * Badge tipo de producto: nuevo / segunda mano (Fase 12).
 * Discreto en cards y tablas de Inventario.
 */
export default function TipoProductoBadge({ tipo }) {
  if (!tipo) return null;
  const isSegunda = tipo === "segunda_mano";
  const label = isSegunda ? "Segunda mano" : "Nuevo";
  const color = isSegunda ? "warning" : "success";
  return (
    <span
      className="px-2 py-0.5 rounded text-[10px] font-semibold"
      style={{
        backgroundColor: `hsl(var(--${color}) / 0.15)`,
        color: `hsl(var(--${color}))`,
      }}
      title={isSegunda ? "Producto de segunda mano" : "Producto nuevo"}
    >
      {label}
    </span>
  );
}
