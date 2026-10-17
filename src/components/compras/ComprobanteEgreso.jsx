import { createPortal } from "react-dom";
import Logo from "../ui/Logo";
import { sedeLabel } from "../../lib/traspasos-ui";
import { formatCOP } from "../../lib/utils";
import { montoEnLetras } from "../../lib/numero-a-letras";
import {
  MARCA,
  RECIBO_DIRECCION,
  SEDE_TELEFONO,
} from "../../lib/pdf/pdfStyles";

/*
 * Comprobante de egreso de caja menor, imprimible en MEDIA CARTA.
 *
 * Mismo mecanismo que la remisión de traslados (RemisionTraslado): se monta
 * como portal hijo directo de <body>, oculto en pantalla, y al hacer
 * `window.print()` el @media print esconde toda la app y deja solo esta hoja.
 * Antes, "Imprimir comprobante" sacaba la pantalla entera de la app.
 *
 * Si la caja menor quedó a Crédito no es un egreso todavía: el título pasa a
 * "Cuenta por pagar", el monto a "Valor adeudado", y se listan los pagos que
 * ya se le hicieron con el saldo que falta.
 *
 * Solo se monta para cajas menores: las órdenes de compra siguen imprimiendo
 * la pantalla como antes.
 */

const fFechaHora = (ts) =>
  ts
    ? new Intl.DateTimeFormat("es-CO", {
        timeZone: "America/Bogota",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }).format(new Date(ts))
    : "—";

const fFecha = (ts) =>
  ts
    ? new Intl.DateTimeFormat("es-CO", {
        timeZone: "America/Bogota",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date(ts))
    : "—";

/** La hoja sola, sin portal (la usa el portal de abajo y las pruebas). */
export function HojaEgreso({ compra, pagos = [], saldo }) {
  if (!compra) return null;

  const esCredito = compra.metodo_pago === "Crédito";
  const cancelada = compra.estado === "cancelada";
  const total = Number(compra.total ?? 0);
  const retenciones = Number(compra.retenciones_total ?? 0);
  // Lo que de verdad sale (o saldrá) de la caja: la retención se le descuenta
  // al beneficiario y se consigna a la DIAN, no se le entrega.
  const neto = Math.max(0, total - retenciones);
  const pagado = pagos.reduce((s, p) => s + Number(p.monto ?? 0), 0);
  const titulo = esCredito ? "Cuenta por pagar" : "Comprobante de egreso";
  const lblMonto = esCredito ? "Valor adeudado" : "Valor pagado";
  const tel = SEDE_TELEFONO[compra.sede_destino_id];
  const obs = (compra.observaciones || "").trim();
  const registro = compra.registrador?.nombre || "—";

  return (
    <div className="egreso-print">
      <style>{EGR_CSS}</style>
      <div className="egr-sheet">
        <div className="egr-band">
          <div className="egr-band-l">
            <Logo className="egr-logo" />
            <div>
              <div className="egr-band-co">{MARCA.nombre}</div>
              <div className="egr-band-tit">
                {titulo} <span className="egr-mono">#{compra.numero}</span>
              </div>
            </div>
          </div>
          <div className="egr-band-r">
            {cancelada && <span className="egr-anul">ANULADO</span>}
            <div className="egr-band-fecha">{fFechaHora(compra.fecha)}</div>
          </div>
        </div>

        <div className="egr-body">
          <div className="egr-grid">
            <div>
              <div className="egr-fl">Sede</div>
              <div className="egr-fv">
                {sedeLabel(compra.sede_destino_id)}
                {tel ? (
                  <span className="egr-mut egr-small"> · Tel. {tel}</span>
                ) : null}
              </div>
            </div>
            <div>
              <div className="egr-fl">Categoría de gasto</div>
              <div className="egr-fv">{compra.categoria?.nombre || "—"}</div>
            </div>
            <div className="egr-full">
              <div className="egr-fl">Concepto</div>
              <div className="egr-fv">{compra.concepto || "—"}</div>
            </div>
            <div className="egr-full">
              <div className="egr-fl">Pagado a (proveedor / beneficiario)</div>
              <div className="egr-fv">{compra.proveedor || "—"}</div>
            </div>
            <div>
              <div className="egr-fl">Forma de pago</div>
              <div className="egr-fv">{compra.metodo_pago || "Efectivo"}</div>
            </div>
            <div>
              <div className="egr-fl">Cuenta</div>
              <div className="egr-fv">{compra.cuenta_bancaria || "—"}</div>
            </div>
          </div>

          <div className="egr-monto">
            <div className="egr-monto-top">
              <div className="egr-fl">{lblMonto}</div>
              <div className="egr-tot">{formatCOP(neto)}</div>
            </div>
            <div className="egr-letras">{montoEnLetras(neto)}</div>
            {retenciones > 0 && (
              <div className="egr-mut egr-small egr-ret">
                Total factura {formatCOP(total)} · retenciones −
                {formatCOP(retenciones)}
              </div>
            )}
          </div>

          {esCredito && (
            <div className="egr-pagos">
              <div className="egr-fl">Pagos hechos</div>
              {pagos.length === 0 ? (
                <div className="egr-fv egr-small">Todavía no tiene pagos.</div>
              ) : (
                <table className="egr-table">
                  <tbody>
                    {pagos.map((p) => (
                      <tr key={p.id}>
                        <td className="egr-mono">{fFecha(p.fecha)}</td>
                        <td>
                          {p.metodo_pago}
                          {p.cuenta_bancaria ? ` · ${p.cuenta_bancaria}` : ""}
                        </td>
                        <td className="egr-r egr-mono">{formatCOP(p.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="egr-saldo">
                <span>Pagado {formatCOP(pagado)}</span>
                <b>
                  {saldo == null
                    ? "Saldo: sin dato"
                    : saldo > 0.01
                      ? `Saldo por pagar ${formatCOP(saldo)}`
                      : "Saldada"}
                </b>
              </div>
            </div>
          )}

          <div className="egr-grid egr-grid-b">
            <div>
              <div className="egr-fl">Registró</div>
              <div className="egr-fv">{registro}</div>
            </div>
            <div className="egr-full">
              <div className="egr-fl">Observaciones</div>
              <div className="egr-fv egr-obs">
                {obs || "Sin observaciones."}
              </div>
            </div>
          </div>

          <div className="egr-sigs">
            <div className="egr-sig">
              <div className="egr-sig1">
                <b>Entregado por</b>
              </div>
            </div>
            <div className="egr-sig">
              <div className="egr-sig1">
                <b>Recibido por</b>
              </div>
              <div className="egr-sig2">Nombre, cédula y firma</div>
            </div>
          </div>

          <div className="egr-pie">
            <span>
              {MARCA.nombre} · {RECIBO_DIRECCION} · {MARCA.ciudad}
            </span>
            <span>
              {titulo} #{compra.numero}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ComprobanteEgreso(props) {
  if (!props.compra) return null;
  return createPortal(<HojaEgreso {...props} />, document.body);
}

/* Papel siempre claro, como la remisión: va a impresora y no sigue el tema de
 * la app (por eso los colores son fijos aquí y no tokens). Media carta
 * vertical: 5,5 × 8,5 pulgadas. */
const EGR_CSS = `
.egreso-print{ display:none }
@media print{
  body > *:not(.egreso-print){ display:none !important }
  .egreso-print{ display:block !important }
  @page{ size:5.5in 8.5in; margin:8mm }
  html,body{ background:#fff !important }
  .egreso-print, .egreso-print *{ -webkit-print-color-adjust:exact; print-color-adjust:exact }
  .egreso-print .egr-sigs, .egreso-print .egr-monto, .egreso-print tr{ break-inside:avoid }
}
.egreso-print{ color:#1a2430; font-family:"IBM Plex Sans", system-ui, -apple-system, sans-serif }
.egr-sheet{ max-width:5.1in; margin:0 auto; font-size:11px; line-height:1.38 }
.egr-sheet *{ box-sizing:border-box }
.egr-mono{ font-family:ui-monospace,"Cascadia Code","Roboto Mono",Menlo,Consolas,monospace; font-variant-numeric:tabular-nums }
.egr-mut{ color:#6a7888 }
.egr-small{ font-size:9.5px }
.egr-r{ text-align:right }
.egr-fl{ font-size:8px; letter-spacing:.08em; text-transform:uppercase; color:#8a97a6; font-weight:700; font-family:ui-monospace,Menlo,Consolas,monospace }
.egr-fv{ font-size:11px; color:#1a2430; font-weight:560; overflow-wrap:anywhere }

.egr-band{ background:linear-gradient(120deg,#245a8c,#2f6ea8); color:#fff; padding:11px 14px; display:flex; justify-content:space-between; align-items:center; gap:10px; border-radius:8px 8px 0 0 }
.egr-band-l{ display:flex; align-items:center; gap:9px }
.egr-logo{ width:34px; height:34px; background:#fff }
.egr-band-co{ font-size:10px; font-weight:600; opacity:.92 }
.egr-band-tit{ font-size:14px; font-weight:800; line-height:1.15 }
.egr-band-r{ text-align:right }
.egr-band-fecha{ font-size:9.5px; opacity:.92 }
.egr-anul{ display:inline-block; font-size:9px; font-weight:800; padding:2px 8px; border-radius:999px; background:#fff; color:#b02a22; margin-bottom:4px; font-family:ui-monospace,Menlo,Consolas,monospace }

.egr-body{ padding:12px 14px 12px; border:1px solid #d7dfe8; border-top:none; border-radius:0 0 8px 8px }
.egr-grid{ display:grid; grid-template-columns:1fr 1fr; gap:8px 12px }
.egr-grid-b{ margin-top:10px }
.egr-full{ grid-column:1 / -1 }

.egr-monto{ margin-top:11px; border:1px solid #245a8c; background:#f4f9fd; border-radius:8px; padding:9px 11px }
.egr-monto-top{ display:flex; justify-content:space-between; align-items:baseline; gap:8px }
.egr-tot{ font-size:18px; font-weight:800; color:#245a8c; font-family:ui-monospace,Menlo,Consolas,monospace }
.egr-letras{ margin-top:3px; font-size:11px; font-style:italic; color:#1a2430 }
.egr-ret{ margin-top:3px }

.egr-pagos{ margin-top:10px }
.egr-table{ width:100%; border-collapse:collapse; margin-top:3px }
.egr-table td{ padding:4px 6px; border-bottom:1px solid #eaeff4; font-size:10px; vertical-align:top }
.egr-saldo{ display:flex; justify-content:space-between; gap:8px; margin-top:4px; font-size:10px }
.egr-obs{ font-weight:400; font-size:10.5px }

.egr-sigs{ display:grid; grid-template-columns:1fr 1fr; gap:22px; margin-top:34px }
.egr-sig{ border-top:1.3px solid #2a3742; padding-top:4px }
.egr-sig1{ font-size:10px; color:#55636f }
.egr-sig2{ font-size:9px; color:#8a97a6 }

.egr-pie{ display:flex; flex-wrap:wrap; gap:4px 10px; justify-content:space-between; margin-top:14px; padding-top:7px; border-top:1px solid #e4e9ef; font-size:8.5px; color:#9aa6b2; font-family:ui-monospace,Menlo,Consolas,monospace }
`;
