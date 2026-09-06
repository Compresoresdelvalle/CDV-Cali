import { useState } from "react";
import { calcularRetenciones } from "../../lib/retenciones";
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
 */
function Fila({ etiqueta, clave, valor, monto, soloLectura, onCambiar }) {
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
          value={valor ?? 0}
          onChange={onCambiar}
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

  const cambiar = (clave) => (e) => {
    // Coma o punto: en Colombia se escribe "0,69". Se recorta a [0, 100] igual
    // que el CHECK de la tabla, para que nunca se envíe algo que el servidor
    // vaya a rechazar con un mensaje de constraint.
    const crudo = String(e.target.value ?? "").replace(",", ".");
    const n = crudo === "" ? 0 : Number(crudo);
    const limpio = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
    onChange?.({ ...valores, [clave]: limpio });
  };

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
