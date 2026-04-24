/**
 * PageHeader — encabezado de módulo con patrón .module-header de Lovable.
 *
 * Props:
 *   title       : string        — título del módulo
 *   description : string?       — texto secundario (alias: subtitle)
 *   subtitle    : string?       — alias de description
 *   actions     : ReactNode?    — botones / controles en el lado derecho
 *   className   : string?       — clases adicionales para el wrapper
 */
export default function PageHeader({
  title,
  description,
  subtitle,
  actions,
  className = "",
}) {
  const sub = description ?? subtitle;

  return (
    <div className={`module-header ${className}`}>
      <div>
        <h1
          className="text-xl md:text-2xl font-bold leading-tight"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {title}
        </h1>
        {sub && (
          <p
            className="text-sm mt-0.5"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {sub}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
