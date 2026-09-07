import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { formatCOP } from "../../lib/utils";

/**
 * El color de cada tramo. El +90 en destructivo porque a esa altura ya no es
 * cartera, es un problema; los anteriores en un gradiente que sube de tono para
 * que la barra se lea sin leyenda.
 */
const COLOR = {
  "0-30": "hsl(var(--success))",
  "31-60": "hsl(var(--muted-foreground))",
  "61-90": "hsl(var(--warning))",
  "+90": "hsl(var(--destructive))",
};

const ROTULO = {
  "0-30": "Hasta 30 días",
  "31-60": "De 31 a 60",
  "61-90": "De 61 a 90",
  "+90": "Más de 90 días",
};

const num = (v) => Number(v ?? 0);

/**
 * Lo que deben, por antigüedad.
 *
 * Una barra apilada arriba y la lista de quién debe más abajo. La barra es lo
 * que responde de un vistazo la única pregunta que importa aquí: ¿esto es
 * cartera sana o es plata que ya no vuelve?
 *
 * No lleva rango: es una foto de hoy. Se dice en pantalla para que nadie crea
 * que el selector de arriba la está filtrando.
 */
export default function Cartera({ datos, onVerTodas }) {
  const tramos = datos?.tramos ?? [];
  const total = num(datos?.total);
  const detalle = datos?.detalle ?? [];

  if (total <= 0) {
    return (
      <p
        className="text-[13px]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        Nadie debe nada ahora mismo. Es una buena noticia.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p
        className="text-[11.5px]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        Foto de hoy: el rango de arriba no la filtra.
      </p>

      <div className="flex items-baseline justify-between gap-3">
        <span
          className="text-[19px] font-semibold tabular-nums"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {formatCOP(total)}
        </span>
        <span
          className="text-[12px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {detalle.length} {detalle.length === 1 ? "factura" : "facturas"} sin
          cobrar
        </span>
      </div>

      {/* La barra apilada. Cada tramo con su ancho proporcional. */}
      <div
        className="flex h-3 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: "hsl(var(--muted))" }}
      >
        {tramos.map((t) => {
          const parte = total > 0 ? num(t.monto) / total : 0;
          if (parte <= 0) return null;
          return (
            <span
              key={t.rango}
              className="block h-full"
              style={{
                width: `${parte * 100}%`,
                backgroundColor: COLOR[t.rango],
              }}
              title={`${ROTULO[t.rango]}: ${formatCOP(t.monto)}`}
            />
          );
        })}
      </div>

      {/* La leyenda muestra los cuatro tramos, incluso en cero: un tramo que no
          aparece no se distingue de uno vacío, y "nada vencido a más de 90
          días" es justo lo que se quiere poder leer. */}
      <ul
        className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4"
        role="list"
      >
        {tramos.map((t) => (
          <li key={t.rango} className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  backgroundColor:
                    num(t.monto) > 0
                      ? COLOR[t.rango]
                      : "hsl(var(--muted-foreground) / 0.4)",
                }}
              />
              <span
                className="truncate text-[11.5px]"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {ROTULO[t.rango]}
              </span>
            </span>
            <span
              className="mt-0.5 block text-[13px] tabular-nums"
              style={{
                color:
                  num(t.monto) > 0
                    ? "hsl(var(--foreground))"
                    : "hsl(var(--muted-foreground))",
              }}
            >
              {formatCOP(t.monto)}
            </span>
          </li>
        ))}
      </ul>

      {detalle.length > 0 && (
        <ul
          className="border-t pt-1"
          style={{ borderColor: "hsl(var(--border))" }}
          role="list"
        >
          {detalle.slice(0, 8).map((f) => (
            <li key={f.doc_id}>
              {/* Cada fila es UNA factura, así que lleva directo a ella: abrir
                  una hoja de detalle para mostrar el mismo renglón otra vez no
                  agregaría nada. */}
              <Link
                to={`/ops/ventas/${f.doc_id}`}
                className="flex w-full items-center gap-3 border-b px-1 py-2.5 text-left last:border-b-0"
                style={{ borderColor: "hsl(var(--border))", minHeight: 48 }}
              >
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
                    {f.referencia} · {f.dias} {f.dias === 1 ? "día" : "días"}
                  </span>
                </span>
                <span
                  className="shrink-0 text-[13px] tabular-nums"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {formatCOP(f.monto)}
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                  strokeWidth={1.7}
                />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {detalle.length > 8 && (
        <button
          type="button"
          onClick={() => onVerTodas(detalle)}
          className="w-full rounded-lg border px-3 text-[12.5px] font-medium"
          style={{
            minHeight: 48,
            borderColor: "hsl(var(--border))",
            color: "hsl(var(--foreground))",
          }}
        >
          Ver las {detalle.length} facturas
        </button>
      )}
    </div>
  );
}
