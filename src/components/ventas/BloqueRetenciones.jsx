import { useState } from "react";
import { calcularRetenciones, normalizarPct } from "../../lib/retenciones";
import { formatCOP } from "../../lib/utils";

/**
 * Bloque plegable de retenciones, compartido por Nueva Venta y la OT.
 *
 * Apagado por defecto: mientras nadie lo abra, la pantalla se ve y se comporta
 * exactamente igual que antes de que esto existiera. Ese es el criterio de
 * aceptación más importante de toda la funcionalidad.
 *
 * Al abrirlo por primera vez las tres se precargan con las tarifas sugeridas de
 * Configuración, para no obligar a la vendedora a saberse los porcentajes de
 * memoria. Si el documento ya trae alguna tarifa, no se pisa.
 *
 * Los porcentajes son editables documento por documento porque las tarifas
 * cambian por ley y por municipio: la app no puede quedar amarrada a un número.
 *
 * @param {object}   p
 * @param {number}   p.base        subtotal menos descuento (sin IVA ni domicilio)
 * @param {number}   p.iva         IVA facturado
 * @param {number}   p.total       total de la factura
 * @param {object}   p.valores     { retefuentePct, reteicaPct, reteivaPct }
 * @param {Function} p.onChange    recibe el objeto de valores completo
 * @param {object}   [p.sugeridas] tarifas de Configuración con que precargar
 * @param {boolean}  [p.abierto]   fuerza el estado abierto (para pruebas)
 * @param {boolean}  [p.soloLectura]
 */
/**
 * Una línea del bloque: etiqueta, porcentaje editable y el monto que sale.
 *
 * Vive FUERA de BloqueRetenciones a propósito. Definida dentro del render,
 * React la trata como un componente nuevo en cada pulsación y remonta el
 * input, que pierde el foco: escribir "0,69" era imposible porque el cursor
 * se salía después del primer dígito.
 *
 * Guarda el TEXTO mientras se escribe y solo entrega el NÚMERO al salir del
 * campo. Con el value atado al número parseado, `Number("2,")` daba 2, el
 * input se revertía a "2" y el siguiente dígito se concatenaba: "2,5" quedaba
 * en 25% y "0,69" en 69%. En una venta de un millón eso convierte $25.000 de
 * retefuente en $250.000, sin avisar.
 *
 * Persistir al salir del campo —y no en cada tecla— es además lo que hace el
 * descuento de la OT, y evita una escritura a la base por cada dígito.
 */
function Fila({ etiqueta, clave, valor, monto, soloLectura, onCambiar }) {
  const [texto, setTexto] = useState(String(valor ?? 0));

  // Si el valor cambia desde afuera (la precarga al abrir el bloque, o un
  // refresco del documento), el campo tiene que reflejarlo. Se ajusta durante
  // el render comparando contra el anterior —el patrón que recomienda React—
  // en vez de un efecto, que encadenaría un render de más por cada tecla.
  // No pelea con lo que se está escribiendo porque el valor de afuera solo
  // cambia cuando ya se entregó.
  const [valorPrevio, setValorPrevio] = useState(valor);
  if (valor !== valorPrevio) {
    setValorPrevio(valor);
    setTexto(String(valor ?? 0));
  }

  const entregar = () => {
    const n = normalizarPct(texto);
    setTexto(String(n));
    if (n !== Number(valor ?? 0)) onCambiar(n);
  };

  return (
    <div className="flex items-center gap-3">
      <label
        className="flex-1 text-[13px]"
        htmlFor={`ret-${clave}`}
        style={{ color: "hsl(var(--foreground))" }}
      >
        {etiqueta}
      </label>
      {soloLectura ? (
        <span
          className="w-20 text-right text-[13px] tabular-nums"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {valor || 0}%
        </span>
      ) : (
        <input
          id={`ret-${clave}`}
          type="text"
          inputMode="decimal"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={entregar}
          onFocus={(e) => e.target.select()}
          className="w-20 rounded-lg border px-2 py-2 text-right text-[13px] tabular-nums"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
            color: "hsl(var(--foreground))",
          }}
          aria-label={`${etiqueta} en porcentaje`}
        />
      )}
      <span
        className="w-28 text-right text-[13px] tabular-nums"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {monto > 0 ? `- ${formatCOP(monto)}` : formatCOP(0)}
      </span>
    </div>
  );
}

export default function BloqueRetenciones({
  base = 0,
  iva = 0,
  total = 0,
  valores = {},
  onChange,
  sugeridas = null,
  abierto: abiertoInicial = false,
  soloLectura = false,
}) {
  const [abierto, setAbierto] = useState(abiertoInicial);

  const ret = calcularRetenciones({
    base,
    iva,
    total,
    retefuentePct: valores.retefuentePct,
    reteicaPct: valores.reteicaPct,
    reteivaPct: valores.reteivaPct,
  });

  const vacio =
    !Number(valores.retefuentePct) &&
    !Number(valores.reteicaPct) &&
    !Number(valores.reteivaPct);

  const alternar = () => {
    const abriendo = !abierto;
    setAbierto(abriendo);
    // Solo al ABRIR y solo si no hay nada puesto: así, si alguien deja las tres
    // en cero a propósito y vuelve a abrir, no se le repone la sugerencia.
    if (abriendo && vacio && sugeridas && !soloLectura) {
      onChange?.({
        retefuentePct: Number(sugeridas.retefuentePct) || 0,
        reteicaPct: Number(sugeridas.reteicaPct) || 0,
        reteivaPct: Number(sugeridas.reteivaPct) || 0,
      });
    }
  };

  // Recibe el número ya normalizado por la Fila, al salir del campo.
  const cambiar = (clave) => (n) => onChange?.({ ...valores, [clave]: n });

  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <button
        type="button"
        onClick={alternar}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        style={{ minHeight: 48, backgroundColor: "hsl(var(--muted) / 0.3)" }}
        aria-expanded={abierto}
      >
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Retenciones
        </span>
        <span
          className="text-[13px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {ret.hay ? `- ${formatCOP(ret.total)}` : "Sin retenciones"}
        </span>
      </button>

      {abierto && (
        <div className="space-y-3 p-4">
          <p
            className="text-[12px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Lo que el cliente descuenta y consigna a la DIAN o al municipio. La
            factura no cambia: solo cambia cuánta plata entra.
          </p>

          <Fila
            etiqueta="Retefuente (sobre la base)"
            clave="retefuentePct"
            valor={valores.retefuentePct}
            soloLectura={soloLectura}
            onCambiar={cambiar("retefuentePct")}
            monto={ret.retefuente}
          />
          <Fila
            etiqueta="ReteICA (sobre la base)"
            clave="reteicaPct"
            valor={valores.reteicaPct}
            soloLectura={soloLectura}
            onCambiar={cambiar("reteicaPct")}
            monto={ret.reteica}
          />
          <Fila
            etiqueta="ReteIVA (sobre el IVA)"
            clave="reteivaPct"
            valor={valores.reteivaPct}
            soloLectura={soloLectura}
            onCambiar={cambiar("reteivaPct")}
            monto={ret.reteiva}
          />

          <div
            className="mt-1 flex items-center justify-between border-t pt-3"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <span
              className="text-[13px]"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Total facturado
            </span>
            <span
              className="text-[13px] tabular-nums"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {formatCOP(total)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span
              className="text-[13px] font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Neto a recibir
            </span>
            <span
              className="text-[15px] font-semibold tabular-nums"
              style={{
                color: ret.hay
                  ? "hsl(var(--warning))"
                  : "hsl(var(--foreground))",
              }}
            >
              {formatCOP(ret.neto)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
