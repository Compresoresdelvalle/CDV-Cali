import { useState } from "react";
import { calcularRetenciones, normalizarPct } from "../../lib/retenciones";
import { formatCOP } from "../../lib/utils";

/**
 * Bloque plegable de retenciones, compartido por Nueva Venta, la OT y Nueva
 * Compra. En venta el cliente nos retiene y nos entra menos; en compra nosotros
 * le retenemos al proveedor y le pagamos menos. La aritmética es idéntica: lo
 * único que cambia son las palabras (ver `modo`).
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
 * @param {"venta"|"compra"} [p.modo] cambia las palabras, no la aritmética
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
  modo = "venta",
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

  // Abrir el bloque NO pone tarifas. Antes se rellenaban solas con las
  // sugeridas, y eso descuadra una caja: basta que alguien lo abra por
  // curiosidad y lo cierre para que la venta salga con una retención que nadie
  // quiso. El sistema diría que entran $950.000 y en el cajón habría
  // $1.000.000, y el descuadre aparece al cerrar, cuando ya nadie se acuerda.
  //
  // Las sugeridas siguen a la mano, pero hay que pulsarlas (ver "Aplicar
  // sugeridas" abajo): retener es una decisión, no un valor por defecto.
  const alternar = () => setAbierto((a) => !a);

  const aplicarSugeridas = () => {
    if (!sugeridas || soloLectura) return;
    onChange?.({
      retefuentePct: Number(sugeridas.retefuentePct) || 0,
      reteicaPct: Number(sugeridas.reteicaPct) || 0,
      reteivaPct: Number(sugeridas.reteivaPct) || 0,
    });
  };

  // El sentido del dinero es el opuesto en cada lado: en venta el cliente nos
  // retiene y nos entra menos; en compra nosotros le retenemos al proveedor y
  // le pagamos menos. La aritmética es idéntica, solo cambian las palabras.
  const esCompra = modo === "compra";
  const invitacion = esCompra
    ? "¿Le retenemos al proveedor? Tocar para aplicar"
    : "¿El cliente retiene? Tocar para aplicar";
  const explicacion = esCompra
    ? "Lo que le descontamos al proveedor y consignamos a la DIAN o al municipio. La factura no cambia: solo cambia cuánta plata sale."
    : "Lo que el cliente descuenta y consigna a la DIAN o al municipio. La factura no cambia: solo cambia cuánta plata entra.";
  const etiquetaTotal = esCompra ? "Total de la factura" : "Total facturado";
  const etiquetaNeto = esCompra ? "Neto a pagar" : "Neto a recibir";

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
        {/* Plegado decía "RETENCIONES / Sin retenciones", una franja gris que
            parecía un dato y no un control: nadie la abría. Ahora, mientras no
            haya ninguna, invita a usarla; cuando ya hay, manda el monto. */}
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{
            color: ret.hay
              ? "hsl(var(--foreground))"
              : "hsl(var(--muted-foreground))",
          }}
        >
          Retenciones
        </span>
        <span
          className="flex items-center gap-1.5 text-[13px]"
          style={{
            color: ret.hay ? "hsl(var(--warning))" : "hsl(var(--primary))",
          }}
        >
          {ret.hay
            ? `- ${formatCOP(ret.total)}`
            : soloLectura
              ? "Sin retenciones"
              : invitacion}
          <span aria-hidden="true">{abierto ? "▴" : "▾"}</span>
        </span>
      </button>

      {abierto && (
        <div className="space-y-3 p-4">
          <p
            className="text-[12px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {explicacion}
          </p>

          {/* Las tarifas de Configuración quedan a un toque, pero no se ponen
              solas: aplicarlas es una decisión de quien está atendiendo. */}
          {!soloLectura && sugeridas && vacio && (
            <button
              type="button"
              onClick={aplicarSugeridas}
              className="w-full rounded-lg border text-[13px] font-medium"
              style={{
                minHeight: 48,
                borderColor: "hsl(var(--primary) / 0.4)",
                backgroundColor: "hsl(var(--primary) / 0.06)",
                color: "hsl(var(--primary))",
              }}
            >
              Aplicar las tarifas de siempre ({Number(sugeridas.retefuentePct) || 0}
              % · {Number(sugeridas.reteicaPct) || 0}% ·{" "}
              {Number(sugeridas.reteivaPct) || 0}%)
            </button>
          )}

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
              {etiquetaTotal}
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
              {etiquetaNeto}
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
