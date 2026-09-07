import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, TrendingDown } from "lucide-react";
import { formatCOP } from "../../lib/utils";

/**
 * Los siete ejes, con el nombre que usa quien vende, no el de la columna.
 *
 * `parte` dice si cada factura cae en un solo renglón. En sede o vendedora sí:
 * una venta tiene una sede y una vendedora. En producto o categoría NO: una
 * factura con cinco productos aparece en cinco renglones, así que sumar la
 * columna de facturas contaría esa venta cinco veces. La plata sí se puede
 * sumar siempre —está repartida entre las líneas—, el conteo de facturas no.
 */
const DIMENSIONES = [
  { id: "sede", rotulo: "Sede", parte: true },
  { id: "vendedora", rotulo: "Vendedora", parte: true },
  { id: "producto", rotulo: "Producto", parte: false },
  { id: "categoria", rotulo: "Categoría", parte: false },
  { id: "tipo", rotulo: "Tipo", parte: true },
  { id: "metodo_pago", rotulo: "Método de pago", parte: true },
  { id: "cliente", rotulo: "Cliente", parte: true },
];

/** Las columnas ordenables, en el orden en que se pintan. */
const COLUMNAS = [
  { id: "etiqueta", rotulo: "", texto: true },
  { id: "n", rotulo: "Facturas" },
  { id: "venta", rotulo: "Venta" },
  { id: "costo", rotulo: "Costo", soloAdmin: true },
  { id: "margen", rotulo: "Margen", soloAdmin: true },
  { id: "margen_pct", rotulo: "%", soloAdmin: true },
  // La participación ordena por venta: es la misma magnitud vista en barra.
  { id: "participacion", rotulo: "Participación", ordenaPor: "venta" },
];

const num = (v) => Number(v ?? 0);

/**
 * La barra de participación. Es lo que permite comparar sin leer: dos barras
 * de distinto largo se distinguen antes de que el ojo procese dos cifras.
 */
function Barra({ parte }) {
  const pct = Math.max(0, Math.min(100, parte * 100));
  return (
    <span className="flex items-center gap-2">
      <span
        className="h-1.5 w-full min-w-[40px] overflow-hidden rounded-full"
        style={{ backgroundColor: "hsl(var(--muted))" }}
      >
        <span
          className="block h-full rounded-full"
          style={{
            width: `${pct}%`,
            backgroundColor: "hsl(var(--primary))",
          }}
        />
      </span>
      <span
        className="shrink-0 text-[11.5px] tabular-nums"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {pct.toFixed(1)}%
      </span>
    </span>
  );
}

/**
 * De qué se compone la venta.
 *
 * Una sola tabla que cambia de eje, no siete widgets. Y ordenable por cualquier
 * columna, porque la pregunta cambia según quién mire: quién vende más no es la
 * misma pregunta que quién deja menos margen.
 *
 * El pie con el total no es decoración: es lo que deja verificar que las partes
 * suman lo mismo que la cascada de arriba. Un desglose que no cuadra con su
 * titular obliga a escoger cuál de los dos creer, y entonces no sirve ninguno.
 */
export default function Composicion({
  dimension,
  onDimension,
  filas = [],
  peores,
  onPeores,
  admin = true,
}) {
  const [orden, setOrden] = useState({ col: "venta", dir: "desc" });

  // "Ver los peores" manda sobre el orden manual: es un atajo a una pregunta
  // concreta —quién deja menos margen— no una preferencia de columna.
  const activo = peores ? { col: "margen_pct", dir: "asc" } : orden;

  const columnas = COLUMNAS.filter((c) => admin || !c.soloAdmin);

  const { ordenadas, total } = useMemo(() => {
    const campo =
      COLUMNAS.find((c) => c.id === activo.col)?.ordenaPor ?? activo.col;
    const signo = activo.dir === "asc" ? 1 : -1;
    const copia = [...filas].sort((a, b) => {
      if (campo === "etiqueta") {
        return (
          signo *
          String(a.etiqueta ?? "").localeCompare(String(b.etiqueta ?? ""), "es")
        );
      }
      // Un margen sin porcentaje (venta cero) va siempre al final: no es "el
      // peor", es que no se puede calcular.
      const va = a[campo] == null ? null : num(a[campo]);
      const vb = b[campo] == null ? null : num(b[campo]);
      if (va == null) return 1;
      if (vb == null) return -1;
      return signo * (va - vb);
    });
    const t = filas.reduce(
      (acc, f) => ({
        venta: acc.venta + num(f.venta),
        costo: acc.costo + num(f.costo),
        margen: acc.margen + num(f.margen),
        n: acc.n + num(f.n),
      }),
      { venta: 0, costo: 0, margen: 0, n: 0 },
    );
    return { ordenadas: copia, total: t };
  }, [filas, activo.col, activo.dir]);

  const parteDe = (f) => (total.venta > 0 ? num(f.venta) / total.venta : 0);
  // Solo se suman las facturas cuando cada una cae en un renglón. Ver DIMENSIONES.
  const sumaFacturas =
    DIMENSIONES.find((d) => d.id === dimension)?.parte !== false;
  const pctTotal =
    total.venta > 0 ? ((total.venta - total.costo) / total.venta) * 100 : null;

  const alOrdenar = (id) => {
    // Ordenar a mano apaga "ver los peores": si no, el clic no haría nada
    // visible y parecería que la tabla está rota.
    if (peores) onPeores(false);
    setOrden((o) =>
      o.col === id
        ? { col: id, dir: o.dir === "desc" ? "asc" : "desc" }
        : { col: id, dir: id === "etiqueta" ? "asc" : "desc" },
    );
  };

  return (
    <div className="space-y-3">
      {/* Los ejes. Cada uno responde una pregunta distinta sobre la misma plata. */}
      <div className="flex flex-wrap gap-2">
        {DIMENSIONES.map((d) => {
          const sel = d.id === dimension;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => onDimension(d.id)}
              aria-pressed={sel}
              className="rounded-lg border px-3 text-[12.5px] font-medium"
              style={{
                minHeight: 48,
                borderColor: sel ? "hsl(var(--primary))" : "hsl(var(--border))",
                backgroundColor: sel
                  ? "hsl(var(--primary))"
                  : "hsl(var(--card))",
                color: sel
                  ? "hsl(var(--primary-foreground))"
                  : "hsl(var(--foreground))",
              }}
            >
              {d.rotulo}
            </button>
          );
        })}
      </div>

      {admin && (
        <button
          type="button"
          onClick={() => onPeores(!peores)}
          aria-pressed={Boolean(peores)}
          className="flex items-center gap-2 rounded-lg border px-3 text-[12.5px] font-medium"
          style={{
            minHeight: 48,
            borderColor: peores ? "hsl(var(--warning))" : "hsl(var(--border))",
            backgroundColor: peores
              ? "hsl(var(--warning) / 0.12)"
              : "hsl(var(--card))",
            color: "hsl(var(--foreground))",
          }}
        >
          <TrendingDown className="h-4 w-4 shrink-0" strokeWidth={1.7} />
          <span className="whitespace-nowrap">Ver los peores</span>
          {/* La coletilla se esconde en móvil: partía "Ver los / peores" en dos
              líneas y el botón dejaba de leerse como una sola cosa. */}
          <span
            className="hidden text-[11.5px] sm:inline"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {peores ? "· menor margen primero" : "· los que menos margen dejan"}
          </span>
        </button>
      )}

      {filas.length === 0 ? (
        <p
          className="text-[13px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          No hubo ventas en este rango.
        </p>
      ) : (
        <>
          {/* Escritorio: tabla. Regla #5 del sistema de diseño. */}
          <div
            className="hidden overflow-x-auto rounded-xl border md:block"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ backgroundColor: "hsl(var(--muted) / 0.3)" }}>
                  {columnas.map((c) => {
                    // La flecha marca la columna PULSADA, no el campo por el
                    // que se ordena: venta y participación ordenan por lo
                    // mismo, y marcar las dos se lee como si hubiera dos
                    // criterios activos a la vez.
                    const esActiva = activo.col === c.id;
                    const Flecha =
                      activo.dir === "asc" ? ChevronUp : ChevronDown;
                    return (
                      <th
                        key={c.id}
                        className={`px-3 py-2 ${c.texto ? "text-left" : "text-right"}`}
                      >
                        <button
                          type="button"
                          onClick={() => alOrdenar(c.id)}
                          className={`inline-flex items-center gap-1 text-[11.5px] font-semibold uppercase tracking-wide ${
                            c.texto ? "" : "flex-row-reverse"
                          }`}
                          style={{
                            color: esActiva
                              ? "hsl(var(--foreground))"
                              : "hsl(var(--muted-foreground))",
                          }}
                        >
                          {c.rotulo || "Nombre"}
                          {esActiva && (
                            <Flecha className="h-3.5 w-3.5" strokeWidth={2} />
                          )}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {ordenadas.map((f) => (
                  <tr
                    key={f.clave}
                    className="border-t"
                    style={{ borderColor: "hsl(var(--border))" }}
                  >
                    <td
                      className="max-w-[260px] truncate px-3 py-2 text-[13px]"
                      style={{ color: "hsl(var(--foreground))" }}
                      title={f.etiqueta}
                    >
                      {f.etiqueta}
                    </td>
                    <td
                      className="px-3 py-2 text-right text-[13px] tabular-nums"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {f.n}
                    </td>
                    <td
                      className="px-3 py-2 text-right text-[13px] tabular-nums"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {formatCOP(f.venta)}
                    </td>
                    {admin && (
                      <>
                        <td
                          className="px-3 py-2 text-right text-[13px] tabular-nums"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {formatCOP(f.costo)}
                        </td>
                        <td
                          className="px-3 py-2 text-right text-[13px] tabular-nums"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {formatCOP(f.margen)}
                        </td>
                        <td
                          className="px-3 py-2 text-right text-[13px] tabular-nums"
                          style={{
                            color:
                              f.margen_pct == null
                                ? "hsl(var(--muted-foreground))"
                                : num(f.margen_pct) < 0
                                  ? "hsl(var(--destructive))"
                                  : "hsl(var(--foreground))",
                          }}
                        >
                          {f.margen_pct == null ? "—" : `${f.margen_pct}%`}
                        </td>
                      </>
                    )}
                    <td className="w-[160px] px-3 py-2">
                      <Barra parte={parteDe(f)} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr
                  className="border-t-2"
                  style={{
                    borderColor: "hsl(var(--border))",
                    backgroundColor: "hsl(var(--muted) / 0.3)",
                  }}
                >
                  <td
                    className="px-3 py-2.5 text-[13px] font-semibold"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    Total
                  </td>
                  <td
                    className="px-3 py-2.5 text-right text-[13px] tabular-nums"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                    title={
                      sumaFacturas
                        ? undefined
                        : "Una misma factura aparece en varios renglones, así que sumarlas contaría de más"
                    }
                  >
                    {sumaFacturas ? total.n : "—"}
                  </td>
                  <td
                    className="px-3 py-2.5 text-right text-[14px] font-semibold tabular-nums"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {formatCOP(total.venta)}
                  </td>
                  {admin && (
                    <>
                      <td
                        className="px-3 py-2.5 text-right text-[13px] tabular-nums"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {formatCOP(total.costo)}
                      </td>
                      <td
                        className="px-3 py-2.5 text-right text-[14px] font-semibold tabular-nums"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {formatCOP(total.margen)}
                      </td>
                      <td
                        className="px-3 py-2.5 text-right text-[13px] tabular-nums"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {pctTotal == null ? "—" : `${pctTotal.toFixed(1)}%`}
                      </td>
                    </>
                  )}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Móvil: tarjetas. */}
          <ul className="space-y-2.5 md:hidden" role="list">
            {ordenadas.map((f) => (
              <li
                key={f.clave}
                className="rounded-xl border px-4 py-3"
                style={{
                  backgroundColor: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className="min-w-0 flex-1 text-[13px]"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {f.etiqueta}
                  </span>
                  <span
                    className="shrink-0 text-[14px] font-semibold tabular-nums"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {formatCOP(f.venta)}
                  </span>
                </div>
                <p
                  className="mt-0.5 text-[11.5px]"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {f.n} {Number(f.n) === 1 ? "factura" : "facturas"}
                  {admin && (
                    <>
                      {" · margen "}
                      {formatCOP(f.margen)}
                      {f.margen_pct != null && ` (${f.margen_pct}%)`}
                    </>
                  )}
                </p>
                <div className="mt-2">
                  <Barra parte={parteDe(f)} />
                </div>
              </li>
            ))}
            <li
              className="flex items-center justify-between rounded-xl border px-4 py-3"
              style={{
                backgroundColor: "hsl(var(--muted) / 0.3)",
                borderColor: "hsl(var(--border))",
              }}
            >
              <span
                className="text-[13px] font-semibold"
                style={{ color: "hsl(var(--foreground))" }}
              >
                Total
              </span>
              <span
                className="text-[15px] font-semibold tabular-nums"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {formatCOP(total.venta)}
              </span>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
