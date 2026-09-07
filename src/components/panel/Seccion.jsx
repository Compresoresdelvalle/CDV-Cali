/**
 * Envoltorio de cada bloque del panel.
 *
 * Es lo que hace que una sección caída no tumbe las demás: el panel viejo tenía
 * una sola RPC que al fallar se llevaba por delante todas las secciones
 * avanzadas a la vez, y en silencio.
 *
 * Los cuatro estados se diseñan; ninguno es un descuido. Es donde un panel se
 * siente terminado o a medio hacer:
 *
 *   - cargando: esqueleto con la FORMA del contenido, no un spinner centrado.
 *     El salto de layout es lo que hace sentir lenta una pantalla que no lo es.
 *   - vacío: dice qué pasó y qué hacer. Nunca una tarjeta en blanco. Y si el
 *     vacío es una buena noticia, se dice así: "ningún producto se vendió bajo
 *     costo" es una respuesta, no un hueco.
 *   - error: dentro de la sección, con su propio reintento. El resto sigue.
 *   - sin permiso: explica. Un error de permisos parece una falla; esto no.
 */
export default function Seccion({
  titulo,
  subtitulo,
  acciones,
  cargando,
  error,
  onReintentar,
  sinPermiso,
  vacio,
  mensajeVacio,
  filasEsqueleto = 4,
  children,
}) {
  return (
    <section
      className="overflow-hidden rounded-xl border shadow-sm"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <header
        className="flex items-center justify-between gap-3 border-b px-4 py-3"
        style={{
          borderColor: "hsl(var(--border))",
          backgroundColor: "hsl(var(--muted) / 0.3)",
        }}
      >
        <div className="min-w-0">
          <p
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide"
            style={{ color: "hsl(var(--foreground))" }}
          >
            <span
              aria-hidden="true"
              className="inline-block h-3.5 w-1 shrink-0 rounded-full"
              style={{ backgroundColor: "hsl(var(--primary))" }}
            />
            {titulo}
          </p>
          {subtitulo && (
            <p
              className="mt-0.5 truncate text-[12px]"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {subtitulo}
            </p>
          )}
        </div>
        {acciones}
      </header>

      <div className="p-4">
        {sinPermiso ? (
          <p
            className="text-[13px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            El margen y los costos son información de administración.
          </p>
        ) : error ? (
          <div className="space-y-2">
            <p
              className="text-[13px]"
              style={{ color: "hsl(var(--destructive))" }}
            >
              {error}
            </p>
            {onReintentar && (
              <button
                type="button"
                onClick={onReintentar}
                className="rounded-lg border px-3 text-[12.5px] font-medium"
                style={{
                  minHeight: 48,
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
              >
                Reintentar esta sección
              </button>
            )}
          </div>
        ) : cargando ? (
          <div className="space-y-2" aria-busy="true" aria-label="Cargando">
            {Array.from({ length: filasEsqueleto }).map((_, i) => (
              <div
                key={i}
                className="h-6 animate-pulse rounded"
                style={{ backgroundColor: "hsl(var(--muted))" }}
              />
            ))}
          </div>
        ) : vacio ? (
          <p
            className="text-[13px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {mensajeVacio ?? "No hay datos en este rango."}
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
