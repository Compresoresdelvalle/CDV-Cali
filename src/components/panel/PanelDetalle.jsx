import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { X, ChevronRight } from "lucide-react";
import { formatCOP, formatDate } from "../../lib/utils";
import BotonExportar from "./BotonExportar";

/** A dónde lleva cada fila según su tipo de documento. */
const RUTA = {
  venta: (id) => `/ops/ventas/${id}`,
  orden: (id) => `/ops/ordenes/${id}`,
  devolucion: (id) => `/ops/devoluciones/${id}`,
  // La ruta real lleva "venta" en medio; sin eso el enlace daría 404.
  garantia_venta: (id) => `/ops/garantias/venta/${id}`,
};

/**
 * El panel lateral de detalle. El corazón de "poder desagregar".
 *
 * En escritorio se desliza desde la derecha y deja ver el panel detrás: no es un
 * modal que tape todo, porque mantener el contexto es la mitad del valor. En
 * móvil ocupa casi toda la pantalla.
 *
 * Cierra con la X, con Escape y tocando fuera, y devuelve el foco a donde
 * estaba.
 */
export default function PanelDetalle({
  abierto,
  titulo,
  subtitulo,
  filas = [],
  cargando,
  error,
  onCerrar,
  // El servidor corta el detalle en 200 filas. Si el concepto tiene más, el
  // pie tiene que decir el total DE VERDAD, no la suma de lo que alcanzó a
  // traer: si no, contradice en silencio la cifra de la sección que lo abrió.
  totalReal,
  nReal,
}) {
  const cerrarRef = useRef(null);
  const focoPrevio = useRef(null);

  useEffect(() => {
    if (!abierto) return;
    focoPrevio.current = document.activeElement;
    cerrarRef.current?.focus();
    const alTeclear = (e) => {
      if (e.key === "Escape") onCerrar();
    };
    document.addEventListener("keydown", alTeclear);
    return () => {
      document.removeEventListener("keydown", alTeclear);
      // Devolver el foco a donde estaba: si se pierde, quien navega con teclado
      // queda al principio de la página.
      focoPrevio.current?.focus?.();
    };
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  const sumaVisible = filas.reduce((s, f) => s + Number(f.monto ?? 0), 0);
  const total = totalReal == null ? sumaVisible : Number(totalReal);
  const n = nReal == null ? filas.length : Number(nReal);
  const recortado = n > filas.length;

  return (
    <>
      {/* El fondo deja ver el panel detrás, atenuado. */}
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: "hsl(var(--foreground) / 0.25)" }}
        onClick={onCerrar}
        aria-hidden="true"
      />
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-full flex-col border-l shadow-xl sm:w-[480px]"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
      >
        <header
          className="flex items-start justify-between gap-3 border-b px-4 py-3"
          style={{
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--muted) / 0.3)",
          }}
        >
          <div className="min-w-0">
            <p
              className="text-[15px] font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {titulo}
            </p>
            {subtitulo && (
              <p
                className="mt-0.5 text-[12px]"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {subtitulo}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Exporta lo que está en la hoja, que puede ser mucho más de lo
                que cabe en pantalla: el detalle llega hasta 200 filas. */}
            <BotonExportar
              filas={filas}
              columnas={[
                { clave: "fecha", titulo: "Fecha" },
                { clave: "referencia", titulo: "Documento" },
                { clave: "descripcion", titulo: "Detalle" },
                { clave: "monto", titulo: "Monto" },
              ]}
              base={`panel-${(titulo || "detalle")
                .toLowerCase()
                .normalize("NFD")
                .replace(/[̀-ͯ]/g, "")
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")}`}
              rango={null}
            />
            <button
              ref={cerrarRef}
              type="button"
              onClick={onCerrar}
              className="grid shrink-0 place-items-center rounded-lg border"
              style={{
                height: 48,
                width: 48,
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--muted-foreground))",
              }}
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" strokeWidth={1.7} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <p
              className="p-4 text-[13px]"
              style={{ color: "hsl(var(--destructive))" }}
            >
              {error}
            </p>
          ) : cargando ? (
            <div
              className="space-y-2 p-4"
              aria-busy="true"
              aria-label="Cargando"
            >
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded"
                  style={{ backgroundColor: "hsl(var(--muted))" }}
                />
              ))}
            </div>
          ) : filas.length === 0 ? (
            <p
              className="p-4 text-[13px]"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              No hay nada en este rango. Es una buena noticia.
            </p>
          ) : (
            <ul>
              {filas.map((f, i) => {
                const ruta = RUTA[f.doc_tipo]?.(f.doc_id);
                const contenido = (
                  <>
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-[13px]"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {f.descripcion}
                      </span>
                      <span
                        className="block text-[11.5px]"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {formatDate(f.fecha)} · {f.referencia}
                      </span>
                    </span>
                    <span
                      className="shrink-0 text-[13px] tabular-nums"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {formatCOP(f.monto)}
                    </span>
                    {ruta && (
                      <ChevronRight
                        className="h-4 w-4 shrink-0"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                        strokeWidth={1.7}
                      />
                    )}
                  </>
                );
                const clases =
                  "flex items-center gap-3 border-b px-4 py-2.5 text-left";
                const estilo = {
                  borderColor: "hsl(var(--border))",
                  minHeight: 48,
                };
                return (
                  <li key={`${f.doc_id}-${i}`}>
                    {ruta ? (
                      <Link to={ruta} className={clases} style={estilo}>
                        {contenido}
                      </Link>
                    ) : (
                      <div className={clases} style={estilo}>
                        {contenido}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {filas.length > 0 && !cargando && (
          <footer
            className="flex items-center justify-between border-t px-4 py-3"
            style={{
              borderColor: "hsl(var(--border))",
              backgroundColor: "hsl(var(--muted) / 0.3)",
            }}
          >
            <span
              className="text-[12px]"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {recortado
                ? `${filas.length} de ${n} registros`
                : `${n} ${n === 1 ? "registro" : "registros"}`}
            </span>
            <span
              className="text-[15px] font-semibold tabular-nums"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {formatCOP(total)}
            </span>
          </footer>
        )}
      </aside>
    </>
  );
}
