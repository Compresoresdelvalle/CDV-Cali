import { createPortal } from "react-dom";
import Logo from "../ui/Logo";
import { sedeLabel, traspasoEstadoPill } from "../../lib/traspasos-ui";
import { formatCOP } from "../../lib/utils";
import {
  MARCA,
  RECIBO_DIRECCION,
  SEDE_TELEFONO,
} from "../../lib/pdf/pdfStyles";

/*
 * Remisión de traslado imprimible (Opción B aprobada por la clienta).
 *
 * Se renderiza SIEMPRE como hijo directo de <body> (portal) pero está oculta en
 * pantalla; solo aparece al imprimir. Al hacer `window.print()` desde el botón
 * "Imprimir guía", el @media print oculta toda la app (#root y demás portales)
 * y deja únicamente esta hoja, con paginación A4 limpia:
 *   - el encabezado de la tabla se repite en cada hoja (thead group),
 *   - ninguna fila se parte a la mitad,
 *   - las firmas van justo después del contenido (flujo normal), así que con
 *     pocos ítems NO queda medio pliego en blanco, y con muchos caen al final
 *     real del listado sin quedar huérfanas.
 *
 * Es solo presentación: no toca stock ni permisos. Lee los datos ya cargados en
 * TraspasoDetalle (traspaso + items con producto.tipo y detalle.es_insumo).
 */

const fFecha = (ts) =>
  ts
    ? new Intl.DateTimeFormat("es-CO", {
        timeZone: "America/Bogota",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date(ts))
    : "—";

const fHora = (ts) =>
  ts
    ? new Intl.DateTimeFormat("es-CO", {
        timeZone: "America/Bogota",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }).format(new Date(ts))
    : "—";

// Etiqueta de tipo por línea: Insumo si sale del bolsillo de insumo; si no,
// Segunda/Chatarra según el tipo del producto; si no, Venta.
function tipoLinea(it) {
  if (it.es_insumo) return { k: "insumo", label: "Insumo" };
  const t = it.producto?.tipo;
  if (t === "segunda_mano") return { k: "seg", label: "Segunda" };
  if (t === "chatarra") return { k: "chat", label: "Chatarra" };
  return { k: "venta", label: "Venta" };
}

const ORDEN_TIPO = ["venta", "insumo", "seg", "chat"];

export default function RemisionTraslado({
  traspaso,
  items = [],
  valorMercancia = 0,
}) {
  if (!traspaso) return null;

  const cantDe = (it) => it.cantidad_enviada ?? it.cantidad_solicitada ?? 0;
  const totalUnidades = items.reduce((s, it) => s + cantDe(it), 0);

  // Composición del traslado por tipo (para el bloque "Contenido").
  const compMap = items.reduce((acc, it) => {
    const { k, label } = tipoLinea(it);
    if (!acc[k]) acc[k] = { label, n: 0 };
    acc[k].n += 1;
    return acc;
  }, {});
  const composicion = ORDEN_TIPO.filter((k) => compMap[k]).map((k) => ({
    k,
    ...compMap[k],
  }));

  const estadoPill = traspasoEstadoPill(traspaso.estado);
  const solicita = traspaso.solicitante?.nombre || "—";
  const entrega =
    traspaso.picker?.nombre || traspaso.verificador?.nombre || "—";
  const recibe = traspaso.receptor?.nombre || "—";
  const telOrigen = SEDE_TELEFONO[traspaso.sede_origen_id];
  const obs = (traspaso.observaciones || "").trim();

  const sheet = (
    <div className="remision-print">
      <style>{REM_CSS}</style>
      <div className="rem-sheet">
        {/* Banda superior */}
        <div className="rem-band">
          <div className="rem-band-l">
            <Logo className="rem-logo" />
            <div>
              <div className="rem-band-co">
                Remisión de traslado · {MARCA.nombre}
              </div>
              <div className="rem-band-num">N° {traspaso.numero}</div>
            </div>
          </div>
          <div className="rem-band-r">
            <span className={`rem-estado rem-e-${traspaso.estado}`}>
              {estadoPill.label}
            </span>
            <div className="rem-band-fecha">
              Creada {fFecha(traspaso.fecha)} · {fHora(traspaso.fecha)}
            </div>
          </div>
        </div>

        <div className="rem-body">
          {/* Origen → Destino */}
          <div className="rem-od">
            <div className="rem-odc">
              <div className="rem-fl">Sale de</div>
              <div className="rem-fv rem-big">
                {sedeLabel(traspaso.sede_origen_id)}
              </div>
              <div className="rem-mut rem-mono">
                {traspaso.sede_origen_id}
                {telOrigen ? ` · Tel. ${telOrigen}` : ""}
              </div>
            </div>
            <div className="rem-arrow">→</div>
            <div className="rem-odc rem-to">
              <div className="rem-fl">Ingresa a</div>
              <div className="rem-fv rem-big">
                {sedeLabel(traspaso.sede_destino_id)}
              </div>
              <div className="rem-mut rem-mono">
                {traspaso.sede_destino_id}
                {SEDE_TELEFONO[traspaso.sede_destino_id]
                  ? ` · Tel. ${SEDE_TELEFONO[traspaso.sede_destino_id]}`
                  : ""}
              </div>
            </div>
          </div>

          {/* Datos */}
          <div className="rem-grid">
            <div>
              <div className="rem-fl">Solicita</div>
              <div className="rem-fv">{solicita}</div>
            </div>
            <div>
              <div className="rem-fl">Entrega</div>
              <div className="rem-fv">{entrega}</div>
            </div>
            <div>
              <div className="rem-fl">Recibe</div>
              <div className="rem-fv">{recibe}</div>
            </div>
            <div>
              <div className="rem-fl">Contenido</div>
              {composicion.length ? (
                <div className="rem-comp">
                  {composicion.map((c) => (
                    <span key={c.k} className={`rem-b rem-${c.k}`}>
                      {c.n} {c.label}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="rem-fv">—</div>
              )}
            </div>
          </div>

          {/* Productos */}
          <table className="rem-table">
            <thead>
              <tr>
                <th>Descripción</th>
                <th>Stand salida</th>
                <th className="rem-c">Cant.</th>
                <th className="rem-r">V. unit.</th>
                <th className="rem-r">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const tipo = tipoLinea(it);
                const cant = cantDe(it);
                const pu = it.producto?.precio_venta ?? 0;
                const stand = it.ubicacion_origen_id
                  ? String(it.ubicacion_origen_id).replace(/-/g, " · ")
                  : "—";
                return (
                  <tr key={it.id}>
                    <td className="rem-desc">
                      <b>{it.producto?.nombre || "Producto"}</b>
                      <div className="rem-sub">
                        {it.producto?.referencia && (
                          <span className="rem-mono rem-mut">
                            {it.producto.referencia}
                          </span>
                        )}
                        <span className={`rem-b rem-${tipo.k}`}>
                          {tipo.label}
                        </span>
                      </div>
                    </td>
                    <td className="rem-mono">{stand}</td>
                    <td className="rem-c rem-num">{cant}</td>
                    <td className="rem-r rem-num">{formatCOP(pu)}</td>
                    <td className="rem-r rem-num">{formatCOP(pu * cant)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Resumen + observaciones */}
          <div className="rem-foot">
            <div className="rem-sumcard">
              <div className="rem-fl">Valor de la mercancía</div>
              <div className="rem-tot">{formatCOP(valorMercancia)}</div>
              <div className="rem-mut rem-small">
                {totalUnidades} unidad{totalUnidades === 1 ? "" : "es"} ·{" "}
                {items.length} ítem{items.length === 1 ? "" : "s"}
              </div>
            </div>
            <div className="rem-obs">
              <div className="rem-fl">Observaciones</div>
              <div className="rem-fv rem-obs-txt">
                {obs || "Sin observaciones."}
              </div>
            </div>
          </div>

          {/* Firmas — flujo normal: quedan justo debajo del contenido */}
          <div className="rem-sigs">
            <div className="rem-sig">
              <div className="rem-sig1">
                <b>Entrega</b>
                {entrega !== "—" ? ` — ${entrega}` : ""}
              </div>
              <div className="rem-sig2">Firma y C.C. de quien entrega</div>
            </div>
            <div className="rem-sig">
              <div className="rem-sig1">
                <b>Recibe</b>
                {recibe !== "—" ? ` — ${recibe}` : ""}
              </div>
              <div className="rem-sig2">
                Firma y C.C. de quien recibe la mercancía
              </div>
            </div>
          </div>

          {/* Pie */}
          <div className="rem-pie">
            <span>
              {MARCA.nombre} · {RECIBO_DIRECCION} · {MARCA.ciudad}
            </span>
            <span>Remisión de traslado N° {traspaso.numero}</span>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(sheet, document.body);
}

/* Estilos de la hoja. Papel siempre claro (look único, va a impresora). El
 * @media print oculta el resto de la app y deja solo esta hoja. */
const REM_CSS = `
.remision-print{ display:none }
@media print{
  body > *:not(.remision-print){ display:none !important }
  .remision-print{ display:block !important }
  @page{ size:A4; margin:12mm }
  html,body{ background:#fff !important }
  .remision-print, .remision-print *{ -webkit-print-color-adjust:exact; print-color-adjust:exact }
  .remision-print thead{ display:table-header-group }
  .remision-print tr{ break-inside:avoid }
  .remision-print .rem-sigs, .remision-print .rem-foot{ break-inside:avoid }
}
.remision-print{ color:#1a2430; font-family:"IBM Plex Sans", system-ui, -apple-system, sans-serif }
.rem-sheet{ max-width:800px; margin:0 auto; font-size:13px; line-height:1.42 }
.rem-sheet *{ box-sizing:border-box }
.rem-mono{ font-family:ui-monospace,"Cascadia Code","Roboto Mono",Menlo,Consolas,monospace }
.rem-mut{ color:#6a7888 }
.rem-num{ font-variant-numeric:tabular-nums; font-family:ui-monospace,Menlo,Consolas,monospace }
.rem-small{ font-size:11px }
.rem-fl{ font-size:9.5px; letter-spacing:.09em; text-transform:uppercase; color:#8a97a6; font-weight:700; font-family:ui-monospace,Menlo,Consolas,monospace }
.rem-fv{ font-size:13px; color:#1a2430; font-weight:560 }
.rem-big{ font-size:15px }
.rem-r{ text-align:right }
.rem-c{ text-align:center }

.rem-band{ background:linear-gradient(120deg,#245a8c,#2f6ea8); color:#fff; padding:20px 28px; display:flex; justify-content:space-between; align-items:center; gap:14px; border-radius:10px 10px 0 0 }
.rem-band-l{ display:flex; align-items:center; gap:13px }
.rem-logo{ width:50px; height:50px; background:#fff }
.rem-band-co{ font-size:14px; font-weight:600; opacity:.92 }
.rem-band-num{ font-size:26px; font-weight:800; line-height:1; font-family:ui-monospace,Menlo,Consolas,monospace }
.rem-band-r{ text-align:right }
.rem-estado{ display:inline-flex; align-items:center; font-size:11px; font-weight:700; padding:3px 10px; border-radius:999px; background:rgba(255,255,255,.92); color:#245a8c; font-family:ui-monospace,Menlo,Consolas,monospace }
.rem-e-en_transito{ color:#9a5409 }
.rem-e-recibido{ color:#1f7a45 }
.rem-e-con_diferencia{ color:#b02a22 }
.rem-e-cancelado{ color:#b02a22 }
.rem-band-fecha{ font-size:11px; opacity:.9; margin-top:6px }

.rem-body{ padding:22px 28px 24px; border:1px solid #d7dfe8; border-top:none; border-radius:0 0 10px 10px }
.rem-od{ display:flex; align-items:stretch; gap:12px; margin-bottom:16px }
.rem-odc{ flex:1; border:1px solid #dde5ec; border-radius:10px; padding:11px 14px }
.rem-to{ border-color:#245a8c; background:#f4f9fd }
.rem-arrow{ display:flex; align-items:center; color:#245a8c; font-size:20px; font-weight:800 }
.rem-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:12px 16px; margin-bottom:16px }
.rem-comp{ display:flex; flex-wrap:wrap; gap:5px; margin-top:4px }
.rem-b{ display:inline-flex; align-items:center; font-size:10.5px; font-weight:700; padding:2px 9px; border-radius:999px; font-family:ui-monospace,Menlo,Consolas,monospace }
.rem-venta{ color:#1f7a45; background:#e4f3ea }
.rem-insumo{ color:#245a8c; background:#e6eff8 }
.rem-seg{ color:#9a5409; background:#fbeecf }
.rem-chat{ color:#b02a22; background:#fbe5e3 }

.rem-table{ width:100%; border-collapse:collapse }
.rem-table thead th{ background:#245a8c; color:#fff; padding:8px 11px; font-size:9.5px; letter-spacing:.05em; text-transform:uppercase; text-align:left; font-weight:700; font-family:ui-monospace,Menlo,Consolas,monospace }
.rem-table thead th:first-child{ border-radius:7px 0 0 7px }
.rem-table thead th:last-child{ border-radius:0 7px 7px 0 }
.rem-table tbody td{ padding:8px 11px; border-bottom:1px solid #eaeff4; vertical-align:top; font-size:12.5px }
.rem-table tbody tr:nth-child(even) td{ background:#f7fafc }
.rem-table th:nth-child(2), .rem-table td:nth-child(2){ white-space:nowrap }
.rem-desc b{ color:#152331 }
.rem-sub{ margin-top:2px; display:flex; gap:7px; align-items:center; flex-wrap:wrap }

.rem-foot{ display:flex; gap:16px; margin-top:16px; align-items:flex-end }
.rem-sumcard{ flex:none; width:210px; border:1px solid #dde5ec; border-radius:10px; padding:12px 14px; background:#fafcfe }
.rem-tot{ font-size:21px; font-weight:800; color:#245a8c; font-family:ui-monospace,Menlo,Consolas,monospace }
.rem-obs{ flex:1 }
.rem-obs-txt{ font-weight:400; font-size:12.5px }

.rem-sigs{ display:grid; grid-template-columns:1fr 1fr; gap:40px; margin-top:26px }
.rem-sig{ border-top:1.5px solid #2a3742; padding-top:6px }
.rem-sig1{ font-size:11px; color:#55636f }
.rem-sig2{ font-size:10px; color:#8a97a6 }

.rem-pie{ display:flex; flex-wrap:wrap; gap:6px 16px; justify-content:space-between; margin-top:22px; padding-top:10px; border-top:1px solid #e4e9ef; font-size:10px; color:#9aa6b2; font-family:ui-monospace,Menlo,Consolas,monospace }
`;
