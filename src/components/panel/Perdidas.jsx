import { ChevronRight } from "lucide-react";
import { formatCOP } from "../../lib/utils";

/** Los seis conceptos, en el orden en que vienen del servidor. */
const CLAVES = [
  "bajo_costo",
  "descuentos",
  "devoluciones",
  "garantias",
  "retenciones",
  "ot_no_autorizadas",
];

/**
 * En qué se pierde la plata.
 *
 * Una lista, no tarjetas: en una columna se comparan magnitudes de un vistazo.
 * Ordenada de mayor a menor, porque lo que más duele va primero.
 *
 * Los conceptos en cero SE MUESTRAN: "ningún producto se vendió bajo costo en
 * este periodo" es una respuesta, no un hueco. Un renglón ausente no se
 * distingue de uno en cero.
 */
export default function Perdidas({ datos, onAbrir }) {
  const items = CLAVES.map((k) => ({ clave: k, ...(datos[k] ?? {}) })).filter(
    (i) => i.etiqueta,
  );
  const suman = items
    .filter((i) => i.suma_al_total)
    .sort((a, b) => Number(b.monto) - Number(a.monto));
  const aparte = items.filter((i) => !i.suma_al_total);

  const Fila = ({ i, apagado }) => (
    <button
      type="button"
      onClick={() => onAbrir(i.clave, i.etiqueta)}
      className="flex w-full items-center gap-3 border-b px-1 py-3 text-left last:border-b-0"
      style={{ borderColor: "hsl(var(--border))", minHeight: 48 }}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{
          backgroundColor:
            Number(i.monto) > 0 && !apagado
              ? "hsl(var(--warning))"
              : "hsl(var(--muted-foreground) / 0.4)",
        }}
      />
      <span className="min-w-0 flex-1">
        <span
          className="block text-[13px]"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {i.etiqueta}
        </span>
        <span
          className="block text-[11.5px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {i.n} {i.unidad}
          {apagado && " · no suma al total: es la revisión que sí se cobró"}
        </span>
      </span>
      <span
        className="shrink-0 text-[14px] tabular-nums"
        style={{
          color:
            Number(i.monto) > 0 && !apagado
              ? "hsl(var(--foreground))"
              : "hsl(var(--muted-foreground))",
        }}
      >
        {formatCOP(i.monto)}
      </span>
      <ChevronRight
        className="h-4 w-4 shrink-0"
        style={{ color: "hsl(var(--muted-foreground))" }}
        strokeWidth={1.7}
      />
    </button>
  );

  return (
    <div>
      {suman.map((i) => (
        <Fila key={i.clave} i={i} />
      ))}

      <div
        className="mt-1 flex items-center justify-between border-t px-1 pt-3"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <span
          className="text-[13px] font-semibold"
          style={{ color: "hsl(var(--foreground))" }}
        >
          Total
        </span>
        <span
          className="text-[17px] font-semibold tabular-nums"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {formatCOP(datos.total)}
        </span>
      </div>

      {/* Aparte y por debajo del total, para que nadie lo sume mentalmente. */}
      {aparte.map((i) => (
        <div key={i.clave} className="mt-2">
          <Fila i={i} apagado />
        </div>
      ))}
    </div>
  );
}
