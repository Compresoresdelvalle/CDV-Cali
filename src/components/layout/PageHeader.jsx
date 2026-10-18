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
      {/* min-w-0 + crecer: una descripción larga se parte en renglones en vez
          de empujar las acciones a otra línea en escritorio. La base de 16rem
          hace que en el celular las acciones sí bajen, en vez de aplastar el
          título a unas pocas letras de ancho. */}
      <div className="min-w-0 flex-[1_1_16rem]">
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
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
