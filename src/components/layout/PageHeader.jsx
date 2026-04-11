/**
 * PageHeader — encabezado de módulo con patrón .module-header de Lovable.
 * Props:
 *   title: string           — título del módulo
 *   subtitle?: string       — texto secundario opcional
 *   actions?: ReactNode     — botones / controles en el lado derecho
 *   className?: string      — clases adicionales para el wrapper
 */
export default function PageHeader({
  title,
  subtitle,
  actions,
  className = "",
}) {
  return (
    <div className={`module-header ${className}`}>
      <div>
        <h1
          className="text-xl font-bold leading-tight"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            className="text-sm mt-0.5"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
