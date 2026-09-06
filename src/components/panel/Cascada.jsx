import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { formatCOP } from "../../lib/utils";

/**
 * Un renglón de la cascada. Vive fuera del componente para que React no lo
 * remonte en cada render.
 */
function Renglon({ etiqueta, nota, valor, signo, fuerte, color, onClick }) {
  const Etiqueta = (
    <span className="min-w-0">
      <span
        className={`block text-[13px] ${fuerte ? "font-semibold" : ""}`}
        style={{ color: "hsl(var(--foreground))" }}
      >
        {signo ? `${signo} ` : ""}
        {etiqueta}
      </span>
      {nota && (
        <span
          className="block text-[11.5px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {nota}
        </span>
      )}
    </span>
  );
  const Monto = (
    <span
      className={`shrink-0 tabular-nums ${fuerte ? "text-[17px] font-semibold" : "text-[14px]"}`}
      style={{ color: color ?? "hsl(var(--foreground))" }}
    >
      {formatCOP(valor)}
    </span>
  );
  const clases = `flex w-full items-start justify-between gap-3 py-2 text-left ${
    fuerte ? "border-t pt-3" : ""
  }`;
  const estilo = fuerte ? { borderColor: "hsl(var(--border))" } : undefined;

  // Solo es botón si de verdad lleva a algún lado: un botón que no hace nada
  // invita a pulsarlo y no responde.
  if (!onClick) {
    return (
      <div className={clases} style={estilo}>
        {Etiqueta}
        {Monto}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${clases} cursor-pointer`}
      style={estilo}
    >
      {Etiqueta}
      {Monto}
    </button>
  );
}

/**
 * La cascada del resultado.
 *
 * Se lee como un recibo: cada renglón dice de qué está hecho, y los de resultado
 * van en negrita con una regla arriba.
 *
 * El color: los gastos NO van en rojo. Un gasto es normal, no una alarma; el
 * rojo se guarda para lo que exige actuar. Si todo grita, nada se oye.
 */
export default function Cascada({ datos }) {
  const sc = datos.sin_clasificar ?? { n: 0, monto: 0 };
  const negativo = Number(datos.resultado) < 0;
  const mp = datos.margen_productos ?? {};
  const ms = datos.margen_servicios ?? {};

  return (
    <div>
      <Renglon
        etiqueta="Ventas netas"
        nota={`${datos.n_ventas} facturas, sin retenciones ni anuladas`}
        valor={datos.ventas_netas}
        color="hsl(var(--success))"
      />
      <Renglon
        etiqueta="Costo de lo vendido"
        nota="Costo promedio de cada producto al momento de venderlo"
        valor={datos.costo_vendido}
        signo="−"
        color="hsl(var(--muted-foreground))"
      />
      <Renglon
        etiqueta="Margen bruto"
        nota={
          datos.margen_pct != null
            ? `${datos.margen_pct}% en total · productos ${mp.pct ?? 0}% · servicios ${ms.pct ?? 0}%`
            : "Sin ventas en el periodo"
        }
        valor={datos.margen_bruto}
        signo="="
        fuerte
      />
      <Renglon
        etiqueta="Gastos operativos"
        nota={
          sc.n > 0
            ? `Incluye ${formatCOP(sc.monto)} sin clasificar todavía`
            : "Solo los egresos clasificados como gasto real"
        }
        valor={datos.gastos}
        signo="−"
        color="hsl(var(--muted-foreground))"
      />
      <Renglon
        etiqueta="Resultado"
        valor={datos.resultado}
        signo="="
        fuerte
        color={negativo ? "hsl(var(--destructive))" : "hsl(var(--foreground))"}
      />

      {/* Los sin clasificar YA están restados arriba, así que el número de
          arriba es el peor caso y clasificar solo puede subirlo. El aviso es un
          incentivo, no una amenaza. */}
      {sc.n > 0 && (
        <div
          className="mt-3 flex items-start gap-2 rounded-lg border p-3"
          style={{
            borderColor: "hsl(var(--warning))",
            backgroundColor: "hsl(var(--warning) / 0.08)",
          }}
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0"
            style={{ color: "hsl(var(--warning))" }}
            strokeWidth={1.7}
          />
          <div className="min-w-0 flex-1">
            <p
              className="text-[12.5px]"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Hay <b>{sc.n}</b> egresos sin clasificar por{" "}
              <b>{formatCOP(sc.monto)}</b>, y por ahora se cuentan todos como
              gasto. Al clasificarlos, el resultado puede subir hasta{" "}
              <b>{formatCOP(sc.resultado_mejor_caso)}</b>.
            </p>
            <Link
              to="/admin/egresos"
              className="mt-1.5 inline-flex items-center rounded-lg border px-3 text-[12.5px] font-medium"
              style={{
                minHeight: 48,
                borderColor: "hsl(var(--warning))",
                color: "hsl(var(--foreground))",
              }}
            >
              Clasificarlos
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
