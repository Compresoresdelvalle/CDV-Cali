import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  ArrowLeftCircle,
  User,
  Package,
  FileText,
  Link2,
  Activity,
  Wallet,
  Phone,
  Mail,
  Download,
  Printer,
  Pencil,
  MessageCircle,
  ShoppingCart,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import { generarCotizacionPDF } from "../../lib/pdf/cotizacionPDF";
import {
  MARCA,
  RECIBO_DIRECCION,
  SEDE_TELEFONO,
} from "../../lib/pdf/pdfStyles";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import EstadoCotizacionPanel from "../../components/cotizaciones/EstadoCotizacionPanel";
import { useAuthStore } from "../../stores/authStore";
import {
  cotizacionEstadoLabel,
  cotizacionPhStateTone,
  cotizacionVigencia,
  descomponerObservaciones,
  construirHistorialCotizacion,
} from "../../lib/cotizaciones-ui";

const PDF_TEXTO_ENTREGA =
  "El producto se entrega únicamente en nuestras instalaciones sin ningún costo. " +
  "Fuera de nuestras instalaciones el flete corre por cuenta del cliente. " +
  "Las garantías aplican según política de fábrica del producto.";

export default function CotizacionDetalle() {
  const rolUsuario = useAuthStore((s) => s.perfil?.rol ?? null);
  const { id } = useParams();
  const navigate = useNavigate();

  const { confirm, ConfirmDialog } = useConfirm();
  const [cotizacion, setCotizacion] = useState(null);
  const [items, setItems] = useState([]);
  const [cuentasPDF, setCuentasPDF] = useState([]);
  const [otVinculo, setOtVinculo] = useState(null); // { total, saldo, abonado }
  const [abonos, setAbonos] = useState([]);
  const [otrasCotizaciones, setOtrasCotizaciones] = useState(null);
  const [loading, setLoading] = useState(true);
  const [convirtiendo, setConvirtiendo] = useState(false);
  const [error, setError] = useState(null);
  const convirtiendoRef = useRef(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cotRes, detRes, cuentasRes] = await Promise.all([
        supabase
          .from("cotizaciones")
          .select(
            `*, vendedor:vendedor_id(nombre), ot:ot_id(id, numero, estado, cliente_nombre, total), venta:venta_id(id, numero)`,
          )
          .eq("id", id)
          .single(),
        supabase
          .from("detalle_cotizacion")
          .select(`*, producto:producto_id(nombre, referencia, unidad_medida)`)
          .eq("cotizacion_id", id),
        supabase
          .from("cotizacion_cuentas_bancarias")
          .select(
            "cuenta:cuenta_id(id, banco, tipo, numero, titular, marca_iva)",
          )
          .eq("cotizacion_id", id),
      ]);
      // El error de la cotización es bloqueante; los secundarios solo degradan.
      if (cotRes.error) throw cotRes.error;
      const cot = cotRes.data;
      setCotizacion(cot);
      setItems(detRes.data ?? []);
      setCuentasPDF(
        (cuentasRes.data ?? []).map((r) => r.cuenta).filter(Boolean),
      );
      if (detRes.error || cuentasRes.error) {
        setError("Algunos datos no se pudieron cargar completamente.");
      }
    } catch (e) {
      setError(safeError(e, "Error al cargar la cotización"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  /* ── Lecturas secundarias READ-ONLY (no bloquean el render principal) ──
     Vinculación a OT: saldo y abonos reales. Conteo de otras cotizaciones
     del mismo cliente. Cualquier error de permisos degrada en silencio. */
  useEffect(() => {
    if (!cotizacion) return;
    let mounted = true;

    const cargarOt = async () => {
      if (!cotizacion.ot?.id) {
        setOtVinculo(null);
        setAbonos([]);
        return;
      }
      const { data: abos } = await supabase
        .from("abonos")
        .select("id, fecha, monto, metodo_pago, observaciones")
        .eq("orden_id", cotizacion.ot.id)
        .order("fecha", { ascending: true });
      if (!mounted) return;
      const lista = abos ?? [];
      const abonado = lista.reduce((s, a) => s + Number(a.monto ?? 0), 0);
      const totalOt = Number(cotizacion.ot.total ?? 0);
      setAbonos(lista);
      setOtVinculo({
        total: totalOt,
        abonado,
        saldo: Math.max(0, totalOt - abonado),
      });
    };

    const cargarOtras = async () => {
      const nombre = (cotizacion.cliente_nombre ?? "").trim();
      if (!nombre) {
        setOtrasCotizaciones(null);
        return;
      }
      const { count } = await supabase
        .from("cotizaciones")
        .select("id", { count: "exact", head: true })
        .eq("cliente_nombre", nombre)
        .neq("id", cotizacion.id);
      if (!mounted) return;
      setOtrasCotizaciones(typeof count === "number" ? count : null);
    };

    cargarOt();
    cargarOtras();
    return () => {
      mounted = false;
    };
  }, [cotizacion]);

  const generarPDF = (action = "download") => {
    if (!cotizacion) return;
    try {
      const pdf = generarCotizacionPDF({
        cotizacion,
        items,
        cuentas: cuentasPDF,
        vendedor: cotizacion.vendedor?.nombre ?? "—",
      });
      if (action === "print") pdf.print();
      else pdf.download();
    } catch (err) {
      setError(safeError(err, "Error al generar PDF"));
    }
  };

  const convertirEnVenta = async () => {
    // Guard síncrono: el `await confirm` abre una ventana donde el `disabled`
    // de React aún no aplica — un doble-tap dispararía dos conversiones.
    if (convirtiendoRef.current) return;
    convirtiendoRef.current = true;
    const ok = await confirm({
      titulo: "Convertir cotización en venta",
      mensaje: `Se generará una venta a partir de la cotización #${cotizacion?.numero ?? "?"} por ${formatCOP(cotizacion?.total ?? 0)}. Esta acción descuenta stock del inventario y NO se puede deshacer fácilmente.`,
      confirmLabel: "Sí, convertir",
      danger: true,
    });
    if (!ok) {
      convirtiendoRef.current = false;
      return;
    }
    setConvirtiendo(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc(
        "fn_convertir_cotizacion",
        { p_cotizacion_id: id },
      );
      if (rpcErr) throw new Error(rpcErr.message);
      navigate(`/ops/ventas/${data.venta_id}`);
    } catch (e) {
      setError(safeError(e, "Error al convertir la cotización"));
    } finally {
      setConvirtiendo(false);
      convirtiendoRef.current = false;
    }
  };

  if (loading) {
    return (
      <div className="px-4 pb-16 pt-5 sm:px-7 lg:px-8 animate-pulse">
        <div
          className="h-8 w-1/3 rounded-lg"
          style={{ backgroundColor: "var(--n-100)" }}
        />
        <div
          className="mt-4 rounded-[10px] border p-5 space-y-3"
          style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
        >
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-4 w-3/4 rounded"
              style={{ backgroundColor: "var(--n-100)" }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (!cotizacion) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm" style={{ color: "var(--n-500)" }}>
          Cotización no encontrada
        </p>
      </div>
    );
  }

  return (
    <>
      <DetalleContenido
        cotizacion={cotizacion}
        items={items}
        cuentasPDF={cuentasPDF}
        otVinculo={otVinculo}
        abonos={abonos}
        otrasCotizaciones={otrasCotizaciones}
        rolUsuario={rolUsuario}
        error={error}
        convirtiendo={convirtiendo}
        onConvertir={convertirEnVenta}
        onPDF={generarPDF}
        onEditar={() => navigate(`/ops/cotizaciones/${id}/editar`)}
        onVolver={() => navigate("/ops/cotizaciones")}
        onRefrescar={cargar}
      />
      <ConfirmDialog />
    </>
  );
}

/* ─────────────────────────── Contenido del detalle ─────────────────────── */

function DetalleContenido({
  cotizacion,
  items,
  cuentasPDF,
  otVinculo,
  abonos,
  otrasCotizaciones,
  rolUsuario,
  error,
  convirtiendo,
  onConvertir,
  onPDF,
  onEditar,
  onVolver,
  onRefrescar,
}) {
  // B4: descuento en $ (cae al % legado si no hay valor); domicilio tras el IVA.
  const descuento =
    cotizacion.descuento_valor != null
      ? Math.min(
          Math.max(0, Number(cotizacion.descuento_valor)),
          cotizacion.subtotal,
        )
      : cotizacion.subtotal * ((cotizacion.descuento_pct ?? 0) / 100);
  const baseIva = cotizacion.subtotal - descuento;
  const iva = baseIva * ((cotizacion.iva_pct ?? 19) / 100);
  const domicilio = Math.max(0, Number(cotizacion.domicilio ?? 0));

  const convertida = Boolean(cotizacion.venta_id);
  // F11.5: solo se puede convertir a venta desde estado APROBADA.
  const puedeConvertir = cotizacion.estado === "aprobada" && !convertida;
  // Editar solo en borrador (una vez enviada debe ser inmutable).
  const puedeEditar = cotizacion.estado === "borrador" && !convertida;

  const tone = cotizacionPhStateTone(cotizacion.estado, convertida);
  const estadoLabel = cotizacionEstadoLabel(cotizacion.estado, convertida);
  const vigencia = cotizacionVigencia(
    cotizacion.fecha,
    cotizacion.vigencia_dias,
    cotizacion.estado,
  );

  // Datos extendidos del cliente preservados dentro de las observaciones.
  const extra = useMemo(
    () => descomponerObservaciones(cotizacion.observaciones),
    [cotizacion.observaciones],
  );

  const historial = useMemo(
    () => construirHistorialCotizacion(cotizacion, formatDate),
    [cotizacion],
  );

  // WhatsApp real (solo si hay teléfono): abre wa.me con número normalizado.
  const waLink = useMemo(() => {
    const tel = (cotizacion.cliente_telefono ?? "").replace(/[^\d]/g, "");
    if (!tel) return null;
    const numero = tel.length === 10 ? `57${tel}` : tel;
    const texto = encodeURIComponent(
      `Hola, te comparto la cotización #${cotizacion.numero} de ${MARCA.nombre} por ${formatCOP(cotizacion.total)}.`,
    );
    return `https://wa.me/${numero}?text=${texto}`;
  }, [cotizacion.cliente_telefono, cotizacion.numero, cotizacion.total]);

  return (
    <div className="px-4 pb-16 pt-5 sm:px-7 lg:px-8 animate-fade-in">
      <button
        onClick={onVolver}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium transition-colors"
        style={{ color: "var(--n-500)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--n-900)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--n-500)")}
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={2} />
        Volver a Cotizaciones
      </button>

      {/* ── Page header ────────────────────────────────────────────── */}
      <div
        className="mt-4 flex flex-col items-start gap-4 border-b pb-4 md:flex-row md:items-start md:gap-6"
        style={{ borderColor: "var(--n-150)" }}
      >
        <div className="min-w-0 flex-1">
          <div className="ph-eyebrow">Cotización</div>
          <div className="ph-num">#{cotizacion.numero}</div>
          <div className="ph-client">
            {cotizacion.cliente_nombre || "Sin nombre"}
          </div>
          <div className="ph-sub">
            Emitida el{" "}
            <b
              className="font-mono font-medium"
              style={{ color: "var(--n-900)" }}
            >
              {formatDate(cotizacion.fecha)}
            </b>{" "}
            · <span className="vence-pill">{vigencia.label}</span>
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 md:items-end">
          {tone ? (
            <span className={`ph-state ${tone}`}>
              <span className="dot" />
              {estadoLabel}
            </span>
          ) : (
            <span
              className="ph-state"
              style={{
                background: "var(--n-50)",
                color: "var(--n-700)",
                borderColor: "var(--n-150)",
              }}
            >
              <span className="dot" style={{ background: "var(--n-400)" }} />
              {estadoLabel}
            </span>
          )}
          <div className="flex flex-col md:items-end">
            <span className="ph-total-lbl">Total</span>
            <span className="ph-total">{formatCOP(cotizacion.total)}</span>
          </div>
        </div>
      </div>

      {/* ── Action bar ─────────────────────────────────────────────── */}
      <div className="action-bar mt-4">
        {cotizacion.ot && (
          <Link
            to={`/ops/ordenes/${cotizacion.ot.id}`}
            className="vinc-pill"
            title="Ver OT vinculada"
            style={{ minHeight: 32 }}
          >
            <Link2 className="mr-1.5 h-3 w-3" strokeWidth={2} />
            OT #{cotizacion.ot.numero}
          </Link>
        )}
        {cotizacion.venta && (
          <Link
            to={`/ops/ventas/${cotizacion.venta.id}`}
            className="vinc-pill"
            title="Ver venta convertida"
            style={{ minHeight: 32 }}
          >
            <ShoppingCart className="mr-1.5 h-3 w-3" strokeWidth={2} />
            Venta #{cotizacion.venta.numero}
          </Link>
        )}
        {puedeEditar && (
          <button
            onClick={onEditar}
            className="btn btn-out"
            style={{ height: 48 }}
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
            Editar
          </button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={() => onPDF("download")}
            title="Descargar PDF"
            className="btn btn-out"
            style={{ height: 48 }}
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2} />
            Descargar PDF
          </button>
          <button
            onClick={() => onPDF("print")}
            title="Imprimir PDF"
            className="btn btn-out"
            style={{ height: 48 }}
          >
            <Printer className="h-3.5 w-3.5" strokeWidth={2} />
            Imprimir
          </button>
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-out"
              style={{ height: 48 }}
              title="Compartir por WhatsApp"
            >
              <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} />
              Compartir por WhatsApp
            </a>
          )}
        </div>
      </div>

      {/* ── Banner de estado y workflow (F11.5) ─────────────────────── */}
      <div className="mt-4">
        <EstadoCotizacionPanel
          cotizacion={cotizacion}
          rolUsuario={rolUsuario}
          onChange={onRefrescar}
        />
      </div>

      {/* ── Error ──────────────────────────────────────────────────── */}
      {error && (
        <div
          className="mt-4 rounded-[10px] border px-4 py-3"
          style={{
            backgroundColor: "var(--dang-50)",
            borderColor: "var(--dang-border)",
          }}
        >
          <p className="text-sm" style={{ color: "var(--dang-700)" }}>
            {error}
          </p>
        </div>
      )}

      {/* ── Two-column layout: info + PDF preview ──────────────────── */}
      <div className="mt-5 grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,540px)_minmax(0,1fr)]">
        {/* Col Izq · INFO */}
        <div className="flex min-w-0 flex-col gap-3.5">
          {/* Cliente */}
          <section className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <User className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Cliente</div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Razón social" full>
                <div
                  className="text-[13px] font-medium"
                  style={{ color: "var(--n-900)" }}
                >
                  {cotizacion.cliente_nombre || "Sin nombre"}
                </div>
                {cotizacion.cliente_nit && (
                  <div
                    className="mt-0.5 font-mono text-[11.5px]"
                    style={{ color: "var(--n-500)" }}
                  >
                    NIT {cotizacion.cliente_nit}
                  </div>
                )}
              </Field>
              <Field label="Teléfono">
                {cotizacion.cliente_telefono ? (
                  <div
                    className="flex items-center gap-1.5 text-[13px]"
                    style={{ color: "var(--n-900)" }}
                  >
                    <Phone
                      className="h-3 w-3"
                      strokeWidth={2}
                      style={{ color: "var(--n-300)" }}
                    />
                    <span className="font-mono">
                      {cotizacion.cliente_telefono}
                    </span>
                  </div>
                ) : (
                  <Vacio />
                )}
              </Field>
              <Field label="Correo">
                {cotizacion.cliente_email ? (
                  <div
                    className="flex items-center gap-1.5 text-[13px]"
                    style={{ color: "var(--n-900)" }}
                  >
                    <Mail
                      className="h-3 w-3"
                      strokeWidth={2}
                      style={{ color: "var(--n-300)" }}
                    />
                    <span className="font-mono break-all">
                      {cotizacion.cliente_email}
                    </span>
                  </div>
                ) : (
                  <Vacio />
                )}
              </Field>
              <Field label="Contacto">
                {extra.contacto || extra.cargo ? (
                  <>
                    <div
                      className="text-[13px] font-medium"
                      style={{ color: "var(--n-900)" }}
                    >
                      {extra.contacto || "—"}
                    </div>
                    {extra.cargo && (
                      <div
                        className="mt-0.5 text-[11.5px]"
                        style={{ color: "var(--n-500)" }}
                      >
                        {extra.cargo}
                      </div>
                    )}
                  </>
                ) : (
                  <Vacio />
                )}
              </Field>
              <Field label="Dirección">
                {extra.direccion ? (
                  <div
                    className="text-[12.5px]"
                    style={{ color: "var(--n-700)" }}
                  >
                    {extra.direccion}
                  </div>
                ) : (
                  <Vacio />
                )}
              </Field>
            </div>
            {otrasCotizaciones != null && otrasCotizaciones > 0 && (
              <Link
                to={`/ops/cotizaciones?cliente=${encodeURIComponent(cotizacion.cliente_nombre ?? "")}`}
                className="ib-sublink"
              >
                Ver otras cotizaciones de este cliente ({otrasCotizaciones})
              </Link>
            )}
          </section>

          {/* Productos */}
          <section className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <Package className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Productos</div>
              <div className="ib-aux">{items.length} items</div>
            </div>
            <div className="overflow-x-auto">
              <table className="prod-tbl">
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>Ref.</th>
                    <th>Producto</th>
                    <th className="r" style={{ width: 50 }}>
                      Cant
                    </th>
                    <th className="r" style={{ width: 100 }}>
                      Unit
                    </th>
                    <th className="r" style={{ width: 120 }}>
                      Subtotal
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const esServicio = item.servicio_id != null;
                    return (
                      <tr key={item.id}>
                        <td>
                          <span
                            className="p-sku"
                            style={
                              esServicio ? { color: "var(--p-600)" } : undefined
                            }
                          >
                            {esServicio
                              ? "Servicio"
                              : (item.producto?.referencia ?? "—")}
                          </span>
                          <div className="p-meta">
                            {esServicio
                              ? "—"
                              : (item.producto?.unidad_medida ?? "")}
                          </div>
                        </td>
                        <td>
                          <div className="p-nm">
                            {item.descripcion ?? item.producto?.nombre ?? "—"}
                          </div>
                        </td>
                        <td className="p-qty">×{item.cantidad}</td>
                        <td className="p-pr">
                          {formatCOP(item.precio_unitario)}
                        </td>
                        <td className="p-sub">{formatCOP(item.subtotal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="totals">
              <div className="ln">
                <span>Subtotal</span>
                <span className="v">{formatCOP(cotizacion.subtotal)}</span>
              </div>
              {descuento > 0 && (
                <div className="ln">
                  <span>Descuento</span>
                  <span className="v">−{formatCOP(descuento)}</span>
                </div>
              )}
              <div className="ln">
                <span>IVA {cotizacion.iva_pct ?? 19}%</span>
                <span className="v">{formatCOP(iva)}</span>
              </div>
              {domicilio > 0 && (
                <div className="ln">
                  <span>Domicilio</span>
                  <span className="v">{formatCOP(domicilio)}</span>
                </div>
              )}
              <div className="ln tot">
                <span>Total</span>
                <span className="v">{formatCOP(cotizacion.total)}</span>
              </div>
            </div>
          </section>

          {/* Términos comerciales */}
          <section className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <FileText className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Términos comerciales</div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Validez">
                <div className="text-[13px]" style={{ color: "var(--n-700)" }}>
                  {cotizacion.vigencia_dias} días
                </div>
              </Field>
              <Field label="IVA aplicable">
                <div
                  className="font-mono text-[13px] font-medium"
                  style={{ color: "var(--n-900)" }}
                >
                  {cotizacion.iva_pct ?? 19}%
                </div>
              </Field>
              <Field label="Condiciones de pago" full>
                <div className="text-[13px]" style={{ color: "var(--n-700)" }}>
                  {cotizacion.condiciones_pago || <Vacio inline />}
                </div>
              </Field>
              <Field label="Tiempo de entrega" full>
                <div className="text-[13px]" style={{ color: "var(--n-700)" }}>
                  {cotizacion.tiempo_entrega_nota || <Vacio inline />}
                </div>
              </Field>
              {extra.notas && (
                <Field label="Notas adicionales" full>
                  <div
                    className="whitespace-pre-line text-[13px]"
                    style={{ color: "var(--n-700)" }}
                  >
                    {extra.notas}
                  </div>
                </Field>
              )}
            </div>

            <div
              className="mt-4 border-t border-dashed pt-3.5"
              style={{ borderColor: "var(--n-150)" }}
            >
              <div
                className="mb-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em]"
                style={{ color: "var(--n-300)" }}
              >
                Cuentas bancarias para pago
              </div>
              {cuentasPDF.length > 0 ? (
                cuentasPDF.map((b) => (
                  <div key={b.id} className="bank-card">
                    <div className="flex flex-col gap-0.5">
                      <span className="bank-name">
                        {[b.banco, b.tipo].filter(Boolean).join(" · ")}
                      </span>
                      <span className="bank-meta">
                        {b.numero}
                        {b.titular ? ` · ${b.titular}` : ""}
                      </span>
                    </div>
                    {b.marca_iva && (
                      <span className="bank-iva">IVA incluido</span>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-[12.5px]" style={{ color: "var(--n-500)" }}>
                  Sin cuentas bancarias seleccionadas para el PDF.
                </p>
              )}
            </div>
          </section>

          {/* Vinculaciones */}
          {cotizacion.ot ? (
            <section className="iblock info-tint">
              <div className="ib-head">
                <div className="ib-ico info">
                  <Link2 className="h-3.5 w-3.5" strokeWidth={2} />
                </div>
                <div className="ib-title">Vinculaciones</div>
              </div>
              <Link
                to={`/ops/ordenes/${cotizacion.ot.id}`}
                className="vinc-card"
              >
                <span className="vinc-pill">OT #{cotizacion.ot.numero}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="vinc-cli">
                    {cotizacion.ot.cliente_nombre || cotizacion.cliente_nombre}
                  </span>
                  <span className="vinc-state">
                    <span className="dot" />
                    {cotizacion.ot.estado}
                  </span>
                </div>
                {otVinculo && (
                  <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
                    <span className="vinc-saldo-lbl">Saldo pendiente</span>
                    <span className="vinc-saldo-v">
                      {formatCOP(otVinculo.saldo)}
                    </span>
                  </div>
                )}
              </Link>
              {otVinculo && (
                <p
                  className="mt-3 text-[12px] leading-[1.5]"
                  style={{ color: "var(--n-500)" }}
                >
                  Esta cotización está vinculada operacionalmente. Los abonos
                  registrados en la OT (
                  <b
                    className="font-mono font-medium"
                    style={{ color: "var(--n-700)" }}
                  >
                    {formatCOP(otVinculo.abonado)}
                  </b>
                  ) se aplican al saldo de la orden.
                </p>
              )}
            </section>
          ) : (
            <section className="iblock">
              <div className="ib-head">
                <div className="ib-ico">
                  <Link2 className="h-3.5 w-3.5" strokeWidth={2} />
                </div>
                <div className="ib-title">Vinculaciones</div>
              </div>
              <p className="text-[12.5px]" style={{ color: "var(--n-500)" }}>
                {convertida
                  ? "Esta cotización fue convertida en venta directa (sin orden de servicio vinculada)."
                  : "Sin vinculaciones todavía. Al aprobarse puede convertirse en venta o asociarse a una OT."}
              </p>
            </section>
          )}

          {/* Abonos (solo si hay OT vinculada con abonos reales) */}
          {cotizacion.ot && abonos.length > 0 && otVinculo && (
            <section className="iblock">
              <div className="ib-head">
                <div className="ib-ico succ">
                  <Wallet className="h-3.5 w-3.5" strokeWidth={2} />
                </div>
                <div className="ib-title">Abonos recibidos</div>
              </div>
              <AbonoBar abonado={otVinculo.abonado} total={otVinculo.total} />
              {abonos.map((a) => (
                <div key={a.id} className="abono-row">
                  <span className="abono-date">{formatDate(a.fecha)}</span>
                  <span className="abono-amt">{formatCOP(a.monto)}</span>
                  <span className="abono-method">{a.metodo_pago}</span>
                  <span className="abono-ref">{a.observaciones ?? "—"}</span>
                </div>
              ))}
              <Link
                to={`/ops/ordenes/${cotizacion.ot.id}`}
                className="ib-sublink"
              >
                Registrar abono en la OT #{cotizacion.ot.numero}
              </Link>
            </section>
          )}

          {/* B4 — Abonos de la cotización (ligados a la futura venta) */}
          <AbonosCotizacionSection
            cotizacion={cotizacion}
            rolUsuario={rolUsuario}
          />

          {/* Historial */}
          {historial.length > 0 && (
            <section className="iblock">
              <div className="ib-head">
                <div className="ib-ico">
                  <Activity className="h-3.5 w-3.5" strokeWidth={2} />
                </div>
                <div className="ib-title">Historial</div>
              </div>
              <div className="timeline">
                {historial.map((h, i) => (
                  <div key={i} className="tl-row">
                    <span className={`tl-dot ${h.tipo}`} />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="tl-act">{h.accion}</span>
                      <span className="tl-meta">{h.actor}</span>
                    </div>
                    {h.fecha && <span className="tl-time">{h.fecha}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Convertir en venta */}
          {puedeConvertir && (
            <button
              onClick={onConvertir}
              disabled={convirtiendo}
              className="btn btn-pri w-full justify-center disabled:opacity-40"
              style={{ height: 52 }}
            >
              {convirtiendo
                ? "Convirtiendo…"
                : `Convertir en venta · ${formatCOP(cotizacion.total)}`}
            </button>
          )}
        </div>

        {/* Col Der · PDF Preview */}
        <div className="xl:sticky xl:top-[72px]">
          <PdfPreview
            cotizacion={cotizacion}
            items={items}
            cuentasPDF={cuentasPDF}
            extra={extra}
            descuento={descuento}
            iva={iva}
            domicilio={domicilio}
            onPDF={onPDF}
          />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function Field({ label, full, children }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <div
        className="mb-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--n-300)" }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Vacio({ inline }) {
  const cls = inline ? "" : "text-[13px]";
  return (
    <span className={cls} style={{ color: "var(--n-300)" }}>
      —
    </span>
  );
}

function AbonoBar({ abonado, total }) {
  const pct =
    total > 0 ? Math.min(100, Math.round((abonado / total) * 100)) : 0;
  return (
    <div className="abono-bar">
      <div className="abono-bar-row">
        <span>
          Abonado {formatCOP(abonado)} / Total {formatCOP(total)}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="abono-bar-progress">
        <div className="abono-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ─────────────────────────── PDF preview ─────────────────────────── */

function PdfPreview({
  cotizacion,
  items,
  cuentasPDF,
  extra,
  descuento,
  iva,
  domicilio,
  onPDF,
}) {
  const fechaEmision = cotizacion.fecha ? formatDate(cotizacion.fecha) : "—";
  const direccionPDF = extra.direccion || "—";

  return (
    <div className="pdf-wrap">
      <header className="pdf-head">
        <div>
          <div className="pdf-eyebrow">Preview del PDF</div>
          <div className="pdf-title">Cotización #{cotizacion.numero}</div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onPDF("print")}
            className="pdf-zoom-btn"
            aria-label="Imprimir PDF"
            title="Imprimir"
          >
            <Printer className="h-3 w-3" strokeWidth={2} />
          </button>
          <button
            onClick={() => onPDF("download")}
            className="pdf-zoom-btn"
            aria-label="Descargar PDF"
            title="Descargar"
          >
            <Download className="h-3 w-3" strokeWidth={2} />
          </button>
        </div>
      </header>
      <div className="pdf-stage">
        <div className="pdf-paper">
          {/* Head */}
          <div className="mb-3.5 grid grid-cols-2 gap-6 pb-3.5">
            <div className="flex flex-col gap-1">
              <div className="pdf-logo-sq">CHV</div>
              <div className="pdf-logo-tag">Compresores del Valle</div>
            </div>
            <div className="flex flex-col gap-px text-right leading-[1.45]">
              <div className="pdf-co-name">{MARCA.nombre}</div>
              <div className="pdf-co-line sans">{RECIBO_DIRECCION}</div>
              <div className="pdf-co-line sans">
                {MARCA.ciudad}
                {SEDE_TELEFONO[cotizacion.sede_id]
                  ? ` · Tel: ${SEDE_TELEFONO[cotizacion.sede_id]}`
                  : ""}
              </div>
            </div>
          </div>

          {/* Title */}
          <div
            className="mb-4 border-y py-4 text-center"
            style={{ borderColor: "#E6E8ED" }}
          >
            <div className="pdf-title-main">COTIZACIÓN</div>
            <div className="pdf-title-num">#{cotizacion.numero}</div>
          </div>

          {/* Cliente + meta */}
          <div
            className="mb-3.5 grid grid-cols-[1.2fr_1fr] gap-6 border-b pb-4"
            style={{ borderColor: "#E6E8ED" }}
          >
            <div>
              <div className="pdf-eyebrow-print">Cliente</div>
              <div className="pdf-cli-name">
                {cotizacion.cliente_nombre || "Sin nombre"}
              </div>
              {cotizacion.cliente_nit && (
                <div className="pdf-cli-line">NIT {cotizacion.cliente_nit}</div>
              )}
              <div className="pdf-cli-line sans">{direccionPDF}</div>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <div>
                <div className="pdf-eyebrow-print">Fecha emisión</div>
                <div className="pdf-meta-val sans">{fechaEmision}</div>
              </div>
              <div>
                <div className="pdf-eyebrow-print">Validez</div>
                <div className="pdf-meta-val">
                  {cotizacion.vigencia_dias} días
                </div>
              </div>
              <div>
                <div className="pdf-eyebrow-print">Cotizado por</div>
                <div className="pdf-meta-val sans">
                  {cotizacion.vendedor?.nombre ?? "—"}
                </div>
              </div>
              <div>
                <div className="pdf-eyebrow-print">Sede</div>
                <div className="pdf-meta-val">{cotizacion.sede_id}</div>
              </div>
            </div>
          </div>

          {/* Tabla */}
          <table className="pdf-table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Ref.</th>
                <th>Descripción</th>
                <th className="c" style={{ width: 50 }}>
                  Cant
                </th>
                <th className="r" style={{ width: 80 }}>
                  Precio Unit
                </th>
                <th className="r" style={{ width: 90 }}>
                  Subtotal
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const esServicio = p.servicio_id != null;
                return (
                  <tr key={p.id}>
                    <td className="mono">
                      {esServicio
                        ? "Servicio"
                        : (p.producto?.referencia ?? "—")}
                    </td>
                    <td>{p.descripcion ?? p.producto?.nombre ?? "—"}</td>
                    <td className="c">{p.cantidad}</td>
                    <td className="r">{formatCOP(p.precio_unitario)}</td>
                    <td className="r sub">{formatCOP(p.subtotal)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Totals */}
          <div className="mb-4 flex justify-end">
            <table className="pdf-totals-tbl">
              <tbody>
                <tr>
                  <td>Subtotal</td>
                  <td>{formatCOP(cotizacion.subtotal)}</td>
                </tr>
                {descuento > 0 && (
                  <tr>
                    <td>Descuento</td>
                    <td>−{formatCOP(descuento)}</td>
                  </tr>
                )}
                <tr>
                  <td>IVA {cotizacion.iva_pct ?? 19}%</td>
                  <td>{formatCOP(iva)}</td>
                </tr>
                {domicilio > 0 && (
                  <tr>
                    <td>Domicilio</td>
                    <td>{formatCOP(domicilio)}</td>
                  </tr>
                )}
                <tr className="tot">
                  <td>TOTAL</td>
                  <td>{formatCOP(cotizacion.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Sections */}
          <div className="mb-3.5">
            <div className="pdf-section-h">Términos comerciales</div>
            <div className="pdf-section-list">
              <div>
                <b>Validez:</b> {cotizacion.vigencia_dias} días a partir de la
                fecha de emisión.
              </div>
              {cotizacion.condiciones_pago && (
                <div>
                  <b>Condiciones de pago:</b> {cotizacion.condiciones_pago}
                </div>
              )}
              {cotizacion.tiempo_entrega_nota && (
                <div>
                  <b>Tiempo de entrega:</b> {cotizacion.tiempo_entrega_nota}
                </div>
              )}
              <div>
                <b>IVA incluido:</b>{" "}
                {(cotizacion.iva_pct ?? 19) > 0
                  ? `Sí, ${cotizacion.iva_pct ?? 19}%`
                  : "No aplica"}
                .
              </div>
            </div>
          </div>

          {cuentasPDF.length > 0 && (
            <div className="mb-3.5">
              <div className="pdf-section-h">Cuentas para pago</div>
              <div className="pdf-section-list">
                {cuentasPDF.map((b) => (
                  <div key={b.id}>
                    <b>{b.banco}</b>
                    {b.tipo ? ` · ${b.tipo}` : ""} · {b.numero} · A nombre de{" "}
                    {b.titular || MARCA.nombre}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mb-3.5">
            <div className="pdf-section-h">Condiciones de entrega</div>
            <div className="pdf-section-list" style={{ fontSize: 8.5 }}>
              {PDF_TEXTO_ENTREGA}
            </div>
          </div>

          {/* Footer */}
          <div
            className="mt-4 flex flex-col gap-2 border-t pt-3.5"
            style={{ borderColor: "#E6E8ED" }}
          >
            <div className="pdf-footer-legal">
              Esta cotización es válida hasta la fecha indicada. Los precios
              incluyen embalaje estándar. Las garantías aplican según política
              de fábrica del producto.
            </div>
            <div className="pdf-footer-page">
              Página 1 de 1 · #{cotizacion.numero} · {MARCA.nombre}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── B4 · Abonos de la cotización ─────────────────── */

const ABONO_METODOS = [
  { v: "efectivo", l: "Efectivo" },
  { v: "transferencia", l: "Transferencia" },
  { v: "tarjeta", l: "Tarjeta" },
  { v: "otro", l: "Otro" },
];

function AbonosCotizacionSection({ cotizacion, rolUsuario }) {
  const [abonos, setAbonos] = useState([]);
  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState("efectivo");
  const [obs, setObs] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState(null);

  const convertida = Boolean(cotizacion.venta_id);
  const puedeRegistrar =
    !convertida && ["Admin", "Vendedor"].includes(rolUsuario);
  const esAdmin = rolUsuario === "Admin";

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from("abonos_cotizacion")
      .select("id, fecha, monto, metodo_pago, observaciones")
      .eq("cotizacion_id", cotizacion.id)
      .order("fecha", { ascending: true });
    setAbonos(data ?? []);
  }, [cotizacion.id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const abonado = abonos.reduce((s, a) => s + Number(a.monto ?? 0), 0);
  const total = Number(cotizacion.total ?? 0);
  const saldo = Math.max(0, total - abonado);

  const registrar = async () => {
    const n = Number(String(monto).replace(/[^\d]/g, ""));
    if (!n || n <= 0) {
      setErr("Ingresa un monto válido mayor a 0.");
      return;
    }
    setErr(null);
    setGuardando(true);
    try {
      const { error: e } = await supabase.rpc("fn_registrar_abono_cotizacion", {
        p_cotizacion_id: cotizacion.id,
        p_monto: n,
        p_metodo_pago: metodo,
        p_observaciones: obs || null,
      });
      if (e) throw new Error(e.message);
      setMonto("");
      setObs("");
      await cargar();
    } catch (e2) {
      setErr(safeError(e2, "No se pudo registrar el abono"));
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (abonoId) => {
    setErr(null);
    try {
      const { error: e } = await supabase.rpc("fn_eliminar_abono_cotizacion", {
        p_abono_id: abonoId,
      });
      if (e) throw new Error(e.message);
      await cargar();
    } catch (e2) {
      setErr(safeError(e2, "No se pudo eliminar el abono"));
    }
  };

  // Si no hay abonos y no se puede registrar (p.ej. ya convertida), no mostrar.
  if (abonos.length === 0 && !puedeRegistrar) return null;

  return (
    <section className="iblock">
      <div className="ib-head">
        <div className="ib-ico succ">
          <Wallet className="h-3.5 w-3.5" strokeWidth={2} />
        </div>
        <div className="ib-title">Abonos de la cotización</div>
      </div>

      {total > 0 && <AbonoBar abonado={abonado} total={total} />}

      <div
        className="mb-3 flex items-center justify-between text-[12.5px]"
        style={{ color: "var(--n-700)" }}
      >
        <span>
          Abonado{" "}
          <b
            className="font-mono"
            style={{ color: "var(--success-700, var(--n-900))" }}
          >
            {formatCOP(abonado)}
          </b>
        </span>
        <span>
          Saldo{" "}
          <b className="font-mono" style={{ color: "var(--n-900)" }}>
            {formatCOP(saldo)}
          </b>
        </span>
      </div>

      {abonos.map((a) => (
        <div key={a.id} className="abono-row">
          <span className="abono-date">{formatDate(a.fecha)}</span>
          <span className="abono-amt">{formatCOP(a.monto)}</span>
          <span className="abono-method">{a.metodo_pago}</span>
          <span className="abono-ref">{a.observaciones ?? "—"}</span>
          {esAdmin && (
            <button
              onClick={() => eliminar(a.id)}
              className="text-[11px] font-medium"
              style={{ color: "var(--dang-600)" }}
              aria-label="Eliminar abono"
            >
              Eliminar
            </button>
          )}
        </div>
      ))}

      {convertida && (
        <p className="mt-2 text-[12px]" style={{ color: "var(--n-500)" }}>
          Cotización convertida en venta — los abonos quedaron ligados a la
          venta y su saldo se gestiona allí.
        </p>
      )}

      {puedeRegistrar && (
        <div
          className="mt-3 border-t border-dashed pt-3"
          style={{ borderColor: "var(--n-150)" }}
        >
          <div
            className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.08em]"
            style={{ color: "var(--n-300)" }}
          >
            Registrar abono
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px]" style={{ color: "var(--n-500)" }}>
                Monto $
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder="0"
                className="finput"
                style={{ width: 120, textAlign: "right" }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px]" style={{ color: "var(--n-500)" }}>
                Método
              </span>
              <select
                value={metodo}
                onChange={(e) => setMetodo(e.target.value)}
                className="h-10 cursor-pointer rounded-[10px] border bg-transparent px-3 text-[13px] outline-none"
                style={{ borderColor: "var(--n-200)", color: "var(--n-950)" }}
              >
                {ABONO_METODOS.map((m) => (
                  <option key={m.v} value={m.v}>
                    {m.l}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[160px] flex-1 flex-col gap-1">
              <span className="text-[11px]" style={{ color: "var(--n-500)" }}>
                Nota (opcional)
              </span>
              <input
                type="text"
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                placeholder="Referencia / observación"
                className="finput sans"
              />
            </label>
            <button
              onClick={registrar}
              disabled={guardando}
              className="btn btn-pri disabled:opacity-40"
              style={{ height: 40 }}
            >
              {guardando ? "Guardando…" : "Agregar abono"}
            </button>
          </div>
        </div>
      )}

      {err && (
        <p className="mt-2 text-[12px]" style={{ color: "var(--dang-700)" }}>
          {err}
        </p>
      )}
    </section>
  );
}
