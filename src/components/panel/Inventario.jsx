import { Link } from "react-router-dom";
import { formatCOP } from "../../lib/utils";

const num = (v) => Number(v ?? 0);

/**
 * Una cifra con su explicación de una línea y, si la hay, a dónde ir a hacer
 * algo al respecto. Una cifra sin salida es una cifra que solo preocupa.
 */
function Cifra({ valor, rotulo, explicacion, color, a, accion }) {
  return (
    <div
      className="rounded-xl border p-3"
      style={{
        borderColor: "hsl(var(--border))",
        backgroundColor: "hsl(var(--muted) / 0.2)",
      }}
    >
      <p
        className="text-[11.5px] uppercase tracking-wide"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {rotulo}
      </p>
      <p
        className="mt-1 text-[19px] font-semibold tabular-nums"
        style={{ color: color ?? "hsl(var(--foreground))" }}
      >
        {valor}
      </p>
      <p
        className="mt-1 text-[11.5px]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {explicacion}
      </p>
      {a && (
        <Link
          to={a}
          className="mt-2 inline-flex items-center rounded-lg border px-3 text-[12.5px] font-medium"
          style={{
            minHeight: 48,
            borderColor: "hsl(var(--border))",
            color: "hsl(var(--foreground))",
          }}
        >
          {accion}
        </Link>
      )}
    </div>
  );
}

/**
 * El inventario visto como plata, no como unidades.
 *
 * Tres cifras, no un tablero: cuánto capital hay parado, cuánto de ese capital
 * lleva tres meses sin moverse, y cuánta venta se está perdiendo por tener
 * agotado justo lo que más rota.
 *
 * Es una foto de hoy y se dice, para que nadie crea que el rango la filtra.
 */
export default function Inventario({ datos }) {
  const valor = num(datos?.valor_costo);
  const dormido = num(datos?.dormido);
  const pct = valor > 0 ? (dormido / valor) * 100 : 0;
  const agotados = num(datos?.agotados_a);

  return (
    <div className="space-y-3">
      <p
        className="text-[11.5px]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        Foto de hoy: el rango de arriba no la filtra.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Cifra
          rotulo="Capital en inventario"
          valor={formatCOP(valor)}
          explicacion="Lo que costó lo que hay en bodega y almacenes ahora mismo."
        />
        <Cifra
          rotulo="Plata dormida"
          valor={formatCOP(dormido)}
          color={pct >= 50 ? "hsl(var(--warning))" : undefined}
          explicacion={`${num(datos?.n_dormido)} productos sin salir en 90 días — el ${pct.toFixed(0)}% del capital.`}
          a="/admin/reorden"
          accion="Ver reorden"
        />
        <Cifra
          rotulo="Agotados clase A"
          valor={String(agotados)}
          color={agotados > 0 ? "hsl(var(--destructive))" : undefined}
          explicacion="De lo que más rota, en cero teniendo mínimo puesto. Es venta que se pierde."
          a="/admin/alertas"
          accion="Ver alertas"
        />
      </div>
    </div>
  );
}
