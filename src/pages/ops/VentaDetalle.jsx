import { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  ArrowLeftCircle,
  ArrowRightLeft,
  User,
  Package,
  Wallet,
  Link2,
  Activity,
  XCircle,
  Printer,
  Shield,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate } from "../../lib/utils";
import { avisarOk, avisarError } from "../../lib/notify";
import ModalAbrirGarantiaVenta from "../../components/garantias/ModalAbrirGarantiaVenta";
import ModalCambioProducto from "../../components/ventas/ModalCambioProducto";
import { generarVentaPOS } from "../../lib/pdf/ventaPOS";
import {
  metodoPagoClass,
  ventaEstadoLabel,
  devolucionEstadoLabel,
  garantiaVentaEstadoLabel,
  construirHistorialVenta,
} from "../../lib/ventas-ui";

// Referencia estable para "sin abonos": permite que setCredito con este mismo
// objeto haga bail-out en React (Object.is) y no regenere el recibo en balde.
const CREDITO_VACIO = { abonosCotiz: 0, cobros: [] };

export default function VentaDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";

  const [venta, setVenta] = useState(null);
  const [items, setItems] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [devoluciones, setDevoluciones] = useState([]);
  const [garantias, setGarantias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cargaError, setCargaError] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [confirmAnular, setConfirmAnular] = useState(false);
  const [motivoAnular, setMotivoAnular] = useState("");
  const [modalGarantia, setModalGarantia] = useState(false);
  const [modalCambio, setModalCambio] = useState(false);
  const [imprimiendo, setImprimiendo] = useState(false);
  const [reciboUrl, setReciboUrl] = useState(null);
  // B10: saldo de una venta a crédito (abonos de cotización + cobros directos).
  const [credito, setCredito] = useState(CREDITO_VACIO);

  // #17: un ÚNICO documento PDF (ventaPOS) alimenta el preview Y la impresión,
  // así lo que se ve en pantalla es exactamente lo que se imprime.
  const reciboDoc = useMemo(() => {
    if (!venta) return null;
    return generarVentaPOS({
      venta,
      items,
      pagos,
      vendedor: venta.vendedor?.nombre ?? "—",
      credito,
    });
  }, [venta, items, pagos, credito]);

  // URL del blob para el <iframe> de preview (se libera al cambiar/desmontar).
  useEffect(() => {
    if (!reciboDoc) {
      setReciboUrl(null);
      return;
    }
    const url = URL.createObjectURL(reciboDoc.blob);
    setReciboUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [reciboDoc]);

  // Guard anti doble-click: imprime el MISMO documento del preview.
  const imprimirRecibo = () => {
    if (imprimiendo || !reciboDoc) return;
    setImprimiendo(true);
    try {
      reciboDoc.print();
    } finally {
      setTimeout(() => setImprimiendo(false), 1500);
    }
  };

  useEffect(() => {
    const cargar = async () => {
      setLoading(true);
      setCargaError(false);
      try {
        // Datos primarios de la venta y su detalle.
        const [vRes, dRes] = await Promise.all([
          supabase
            .from("ventas")
            .select(`*, vendedor:vendedor_id(nombre)`)
            .eq("id", id)
            .single(),
          supabase
            .from("detalle_venta")
            .select(
              // `precio_venta` es la lista de HOY del producto: la necesita el
              // modal de cambio para sugerir el precio acordado.
              `*, producto:producto_id(nombre, referencia, unidad_medida, precio_venta)`,
            )
            .eq("venta_id", id),
        ]);
        // #S1-18: `.single()` devuelve PGRST116 cuando no existe la fila (eso SÍ
        // es "no encontrada"). Cualquier otro error (red, permisos) es un fallo
        // real de carga y debe distinguirse para no decir "no existe" por error.
        if (vRes.error && vRes.error.code !== "PGRST116") throw vRes.error;
        setVenta(vRes.data ?? null);
        setItems(dRes.data ?? []);
      } catch {
        setCargaError(true);
      } finally {
        setLoading(false);
      }
    };
    cargar();
  }, [id]);

  // #S1-04: desglose real del pago (tabla pagos_venta) — necesario para ver
  // cuánto entró en efectivo y cuánto por transferencia en un pago Mixto, y a
  // qué cuenta. Solo lectura; falla en silencio si no hay permisos.
  useEffect(() => {
    const cargarPagos = async () => {
      const { data } = await supabase
        .from("pagos_venta")
        .select("id, metodo_pago, monto, cuenta_bancaria")
        .eq("venta_id", id)
        .order("id", { ascending: true });
      setPagos(data ?? []);
    };
    cargarPagos();
  }, [id]);

  // Vinculaciones del ciclo (lecturas READ-ONLY a tablas existentes que
  // referencian la venta). Se cargan aparte para que un eventual error de
  // permisos en una tabla secundaria nunca afecte el render principal.
  useEffect(() => {
    const cargarVinculos = async () => {
      const [{ data: dev }, { data: gar }] = await Promise.all([
        supabase
          .from("devoluciones")
          .select("id, numero, fecha, estado")
          .eq("venta_id", id)
          .order("fecha", { ascending: true }),
        supabase
          .from("garantias_venta")
          .select("id, numero, fecha, estado")
          .eq("venta_id", id)
          .order("fecha", { ascending: true }),
      ]);
      setDevoluciones(dev ?? []);
      setGarantias(gar ?? []);
    };
    cargarVinculos();
  }, [id]);

  // B10: carga abonos de la cotización de origen + cobros directos (pagos_cuenta).
  // El bloque "Saldo a crédito" y el recibo solo los muestran en ventas a CRÉDITO
  // (en una de contado ya están pagados: un saldo pendiente ahí sería falso). Solo
  // lectura; el cobro del saldo se gestiona en Panel Admin → Cuentas. Falla en
  // silencio si no hay permisos de lectura.
  useEffect(() => {
    const cargarCredito = async () => {
      const [{ data: cots }, { data: cobros }] = await Promise.all([
        supabase
          .from("cotizaciones")
          .select("abonos_cotizacion(monto)")
          .eq("venta_id", id),
        supabase
          .from("pagos_cuenta")
          .select("id, fecha, monto, metodo_pago, observaciones")
          .eq("venta_id", id)
          .eq("tipo", "cobro")
          .eq("anulado", false)
          .order("fecha", { ascending: true }),
      ]);
      const abonosCotiz = (cots ?? [])
        .flatMap((c) => c.abonos_cotizacion ?? [])
        .reduce((s, a) => s + Number(a.monto ?? 0), 0);
      const listaCobros = cobros ?? [];
      // Sin abonos → referencia estable (no dispara regeneración del recibo).
      setCredito(
        abonosCotiz > 0 || listaCobros.length > 0
          ? { abonosCotiz, cobros: listaCobros }
          : CREDITO_VACIO,
      );
    };
    cargarCredito();
  }, [id]);

  const anularVenta = async () => {
    setAnulando(true);
    try {
      const { error: fnErr } = await supabase.rpc("fn_anular_venta", {
        p_venta_id: id,
        p_motivo: motivoAnular.trim() || null,
      });
      if (fnErr) throw new Error(fnErr.message);
      setVenta((prev) => ({ ...prev, anulada: true }));
      setConfirmAnular(false);
      avisarOk("Venta anulada correctamente");
    } catch (e) {
      avisarError(e, "Error al anular la venta");
    } finally {
      setAnulando(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1240px] px-4 py-5 sm:px-7 sm:py-6 animate-pulse">
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

  if (!venta) {
    // #S1-18: un fallo de carga (red/permisos) NO es lo mismo que una venta
    // inexistente; se comunica distinto y se ofrece reintentar.
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        {cargaError ? (
          <>
            <p
              className="text-sm font-medium"
              style={{ color: "var(--n-900)" }}
            >
              No pudimos cargar la venta
            </p>
            <p className="max-w-sm text-sm" style={{ color: "var(--n-500)" }}>
              Puede ser un problema de conexión. Revisa tu internet e intenta de
              nuevo.
            </p>
            <button
              onClick={() => navigate(0)}
              className="btn btn-out"
              style={{ height: 48 }}
            >
              Reintentar
            </button>
          </>
        ) : (
          <>
            <p
              className="text-sm font-medium"
              style={{ color: "var(--n-900)" }}
            >
              Venta no encontrada
            </p>
            <button
              onClick={() => navigate("/ops/ventas")}
              className="btn btn-out"
              style={{ height: 48 }}
            >
              Volver a Ventas
            </button>
          </>
        )}
      </div>
    );
  }

  const subtotalCalc =
    venta.subtotal > 0
      ? venta.subtotal
      : items.reduce(
          (s, i) => s + (i.subtotal ?? i.cantidad * i.precio_unitario),
          0,
        );
  // B3: descuento en $ (cae al % legado); domicilio tras el IVA.
  const descBruto =
    venta.descuento_valor != null
      ? Number(venta.descuento_valor)
      : subtotalCalc * ((venta.descuento_pct ?? 0) / 100);
  const descuento = Math.min(Math.max(0, descBruto), subtotalCalc);
  const baseIva = subtotalCalc - descuento;
  const iva = baseIva * ((venta.iva_pct ?? 19) / 100);
  const domicilioVenta = Math.max(0, Number(venta.domicilio ?? 0));
  const totalCalc =
    venta.total > 0 ? venta.total : baseIva + iva + domicilioVenta;

  const historial = construirHistorialVenta(
    venta,
    { devoluciones, garantias },
    formatDate,
  );

  // Una venta generada por un CAMBIO de producto (es la diferencia cobrada) no
  // debe anularse por separado: anularla reingresaría el producto nuevo dejando
  // también reingresado el viejo (de la devolución del cambio), inflando el
  // inventario. Para revertir un cambio se registra el cambio inverso.
  // El enlace vive en `cambio_de_venta_id` desde 2026-08-29. La observación se
  // sigue mirando como respaldo por si alguna venta vieja no quedó enlazada en
  // el backfill; el prefijo lo sigue escribiendo fn_registrar_cambio.
  const obs = venta.observaciones || "";
  const esCambio =
    venta.cambio_de_venta_id != null || obs.startsWith("Cambio por venta #");
  const cambioRefNum = esCambio ? (obs.match(/#(\d+)/)?.[1] ?? null) : null;

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-5 sm:px-7 sm:py-6 animate-fade-in">
      <button
        onClick={() => navigate("/ops/ventas")}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium transition-colors"
        style={{ color: "var(--n-500)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--n-700)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--n-500)")}
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver a Ventas
      </button>

      {modalGarantia && (
        <ModalAbrirGarantiaVenta
          origen={{
            tipo: "venta",
            id: venta.id,
            cliente_nombre: venta.cliente_nombre,
            sede_id: venta.sede_id,
          }}
          onClose={() => setModalGarantia(false)}
          onCreated={(gid) => {
            setModalGarantia(false);
            navigate(`/ops/garantias/venta/${gid}`);
          }}
        />
      )}

      {modalCambio && (
        <ModalCambioProducto
          venta={venta}
          items={items}
          sedeId={perfil?.sede_id}
          onClose={() => setModalCambio(false)}
          onDone={(res) => {
            setModalCambio(false);
            if (res?.venta_nueva_id) {
              navigate(`/ops/ventas/${res.venta_nueva_id}`);
            } else {
              navigate(0);
            }
          }}
        />
      )}

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div
        className="mt-4 flex flex-col items-start gap-4 border-b pb-4 md:flex-row md:gap-6"
        style={{ borderColor: "var(--n-150)" }}
      >
        <div className="min-w-0 flex-1">
          <div className="ph-eyebrow">Venta</div>
          <div className="ph-num">#{venta.numero}</div>
          <div className="ph-client">
            {venta.cliente_nombre || "Cliente mostrador"}
          </div>
          <div className="ph-sub">
            {venta.anulada ? "Anulada" : "Completada"} el{" "}
            <b
              className="font-mono font-medium"
              style={{ color: "var(--n-900)" }}
            >
              {formatDate(venta.fecha)}
            </b>{" "}
            · Vendida por {venta.vendedor?.nombre ?? "—"}
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 md:items-end">
          <span className={`ph-state ${venta.anulada ? "danger" : "succ"}`}>
            <span className="dot" />
            {ventaEstadoLabel(venta.anulada)}
          </span>
          <div className="flex flex-col md:items-end">
            <span className="ph-total-lbl">Total</span>
            <span
              className="ph-total"
              style={
                venta.anulada
                  ? { textDecoration: "line-through", color: "var(--n-300)" }
                  : undefined
              }
            >
              {formatCOP(totalCalc)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Action bar ─────────────────────────────────────────────── */}
      <div className="action-bar mt-4">
        <button
          onClick={imprimirRecibo}
          disabled={imprimiendo}
          className="btn btn-out disabled:opacity-50"
          style={{ height: 48 }}
          title="Imprimir recibo POS"
        >
          <Printer className="h-3.5 w-3.5" />
          Imprimir recibo
        </button>
        {!venta.anulada && (
          <button
            onClick={() => setModalGarantia(true)}
            className="btn btn-out"
            style={{ height: 48, color: "var(--warn-700)" }}
            title="Abrir reclamo de garantía"
          >
            <Shield className="h-3.5 w-3.5" />
            Cliente reclama garantía
          </button>
        )}
        {!venta.anulada && items.some((i) => i.producto_id != null) && (
          <button
            onClick={() => setModalCambio(true)}
            className="btn btn-out"
            style={{ height: 48, color: "var(--p-600)" }}
            title="Cambiar un producto de esta venta por otro"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
            Registrar cambio
          </button>
        )}
        {esAdmin && !venta.anulada && !confirmAnular && !esCambio && (
          <button
            onClick={() => setConfirmAnular(true)}
            className="btn btn-out"
            style={{ height: 48, color: "var(--dang-700)" }}
          >
            <XCircle className="h-3.5 w-3.5" />
            Anular venta
          </button>
        )}
      </div>

      {/* ── Nota: venta generada por un cambio (no se anula por separado) ── */}
      {esCambio && !venta.anulada && (
        <div
          className="mt-4 rounded-[10px] border px-4 py-3"
          style={{
            backgroundColor: "var(--info-50)",
            borderColor: "var(--info-border, var(--n-200))",
          }}
        >
          <p className="text-[13px]" style={{ color: "var(--info-700)" }}>
            Esta venta es la <b>diferencia de un cambio</b>
            {cambioRefNum ? ` sobre la venta #${cambioRefNum}` : ""}. No se
            anula por separado (dejaría el inventario descuadrado). Para
            revertir el cambio, usa <b>“Registrar cambio”</b> a la inversa:
            devuelve el producto nuevo y entrega de vuelta el original.
          </p>
        </div>
      )}

      {/* ── Confirmación de anulación ──────────────────────────────── */}
      {confirmAnular && (
        <div
          className="mt-4 rounded-[10px] border p-4 space-y-3"
          style={{
            backgroundColor: "var(--dang-50)",
            borderColor: "var(--dang-border)",
          }}
        >
          <p
            className="text-sm font-medium"
            style={{ color: "var(--dang-700)" }}
          >
            ¿Confirmar anulación? El stock será devuelto automáticamente.
          </p>
          <textarea
            value={motivoAnular}
            onChange={(e) => setMotivoAnular(e.target.value)}
            placeholder="Motivo de la anulación (opcional, queda en la auditoría)"
            rows={2}
            className="w-full rounded-[8px] border px-3 py-2 text-sm"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setConfirmAnular(false)}
              className="btn btn-out"
              style={{ height: 48 }}
            >
              Cancelar
            </button>
            <button
              onClick={anularVenta}
              disabled={anulando}
              className="btn disabled:opacity-50"
              style={{
                height: 48,
                backgroundColor: "var(--dang-600)",
                borderColor: "var(--dang-600)",
                color: "#fff",
              }}
            >
              {anulando ? "Anulando…" : "Sí, anular"}
            </button>
          </div>
        </div>
      )}

      {/* ── Layout: contenido + preview de recibo sticky ───────────── */}
      <div className="mt-4 grid items-start gap-3 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-3">
          {/* Cliente */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <User className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Cliente</div>
            </div>
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Kv
                label="Cliente"
                value={venta.cliente_nombre || "Mostrador"}
                full
              />
              {venta.cliente_nit && (
                <Kv label="NIT / Cédula" value={venta.cliente_nit} mono />
              )}
              <Kv label="Sede" value={venta.sede_id} mono />
              <Kv label="Vendedor" value={venta.vendedor?.nombre ?? "—"} />
              {venta.observaciones && (
                <Kv label="Observaciones" value={venta.observaciones} full />
              )}
            </div>
          </div>

          {/* Productos vendidos */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <Package className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Productos vendidos</div>
              <div className="ib-aux">{items.length} items</div>
            </div>
            <div className="overflow-x-auto">
              <table className="prod-tbl">
                <tbody>
                  {items.map((item) => {
                    // B3: las líneas de servicio no tienen producto; usan
                    // `descripcion` y se marcan como "Servicio".
                    const esServicio = item.servicio_id != null;
                    return (
                      <tr key={item.id}>
                        <td style={{ width: 140 }}>
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
                        <td className="p-pr" style={{ width: 170 }}>
                          ×{item.cantidad} · {formatCOP(item.precio_unitario)}
                        </td>
                        <td className="p-sub" style={{ width: 130 }}>
                          {formatCOP(item.subtotal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="totals">
              <div className="ln">
                <span>Subtotal</span>
                <span className="v">{formatCOP(subtotalCalc)}</span>
              </div>
              {descuento > 0 && (
                <div className="ln">
                  <span>Descuento</span>
                  <span className="v">−{formatCOP(descuento)}</span>
                </div>
              )}
              <div className="ln">
                <span>IVA {venta.iva_pct ?? 19}%</span>
                <span className="v">{formatCOP(iva)}</span>
              </div>
              {domicilioVenta > 0 && (
                <div className="ln">
                  <span>Domicilio</span>
                  <span className="v">{formatCOP(domicilioVenta)}</span>
                </div>
              )}
              <div className="ln tot">
                <span>Total</span>
                <span className="v">{formatCOP(totalCalc)}</span>
              </div>
            </div>
          </div>

          {/* Pago */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico succ">
                <Wallet className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Pago</div>
              <div className="ib-aux">
                {venta.metodo_pago} ·{" "}
                {pagos.length > 0
                  ? `${pagos.length} movimiento${pagos.length > 1 ? "s" : ""}`
                  : "1 movimiento"}
              </div>
            </div>
            {/* #S1-04: cuando hay desglose real (pago Mixto o electrónico) se
                muestra una fila por forma de pago con su cuenta, para poder
                cuadrar caja. Si no hay filas en pagos_venta, se cae al método
                único de la venta. */}
            {pagos.length > 0 ? (
              pagos.map((p) => (
                <div key={p.id} className="pay-row">
                  <span className="pdate">{formatDate(venta.fecha)}</span>
                  <span
                    className={`pay-pill ${metodoPagoClass(p.metodo_pago)}`}
                  >
                    <span className="dot" />
                    {p.metodo_pago}
                    {p.cuenta_bancaria ? ` · ${p.cuenta_bancaria}` : ""}
                  </span>
                  <span className="pamt">{formatCOP(p.monto)}</span>
                </div>
              ))
            ) : (
              <div className="pay-row">
                <span className="pdate">{formatDate(venta.fecha)}</span>
                <span
                  className={`pay-pill ${metodoPagoClass(venta.metodo_pago)}`}
                >
                  <span className="dot" />
                  {venta.metodo_pago}
                  {venta.cuenta_bancaria ? ` · ${venta.cuenta_bancaria}` : ""}
                </span>
                <span className="pamt">{formatCOP(totalCalc)}</span>
              </div>
            )}
            <div
              className="mt-2 font-mono text-[11px]"
              style={{ color: "var(--n-500)" }}
            >
              Pago registrado en {venta.sede_id} · Recibo POS Rec #
              {venta.numero}
            </div>
          </div>

          {/* Saldo / abonos: SOLO ventas a crédito. Una venta de contado, aunque
              venga de una cotización con abono, ya está pagada — mostrar ahí un
              "saldo pendiente" sería falso. Coincide con el recibo impreso. */}
          {!venta.anulada && venta.metodo_pago === "Crédito" && (
            <div className="iblock">
              <div className="ib-head">
                <div className="ib-ico warn">
                  <Wallet className="h-3.5 w-3.5" strokeWidth={2} />
                </div>
                <div className="ib-title">Saldo a crédito</div>
                <div className="ib-aux">Cuenta por cobrar</div>
              </div>

              {(() => {
                const cobrosTotal = credito.cobros.reduce(
                  (s, c) => s + Number(c.monto ?? 0),
                  0,
                );
                const abonado = credito.abonosCotiz + cobrosTotal;
                const saldoCred = Math.max(0, totalCalc - abonado);
                return (
                  <>
                    {credito.cobros.length > 0 &&
                      credito.cobros.map((c) => (
                        <div key={c.id} className="pay-row">
                          <span className="pdate">{formatDate(c.fecha)}</span>
                          <span
                            className={`pay-pill ${metodoPagoClass(c.metodo_pago)}`}
                          >
                            <span className="dot" />
                            {c.metodo_pago}
                          </span>
                          <span className="pamt">{formatCOP(c.monto)}</span>
                        </div>
                      ))}
                    <div className="totals">
                      {credito.abonosCotiz > 0 && (
                        <div className="ln">
                          <span>Abonos de cotización</span>
                          <span className="v">
                            −{formatCOP(credito.abonosCotiz)}
                          </span>
                        </div>
                      )}
                      {cobrosTotal > 0 && (
                        <div className="ln">
                          <span>Cobros registrados</span>
                          <span className="v">−{formatCOP(cobrosTotal)}</span>
                        </div>
                      )}
                      <div className="ln tot">
                        <span>Saldo pendiente</span>
                        <span
                          className="v"
                          style={{
                            color:
                              saldoCred > 0
                                ? "var(--dang-700)"
                                : "var(--success-700, var(--n-900))",
                          }}
                        >
                          {formatCOP(saldoCred)}
                        </span>
                      </div>
                    </div>
                    <div
                      className="mt-2 font-mono text-[11px]"
                      style={{ color: "var(--n-500)" }}
                    >
                      {saldoCred > 0
                        ? "Los cobros se registran en Panel Admin → Cuentas por cobrar."
                        : "Cuenta saldada."}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* Vinculaciones del ciclo comercial */}
          <div className="iblock info-tint">
            <div className="ib-head">
              <div className="ib-ico info">
                <Link2 className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Vinculaciones del ciclo comercial</div>
            </div>
            <div className="vinc-link-grid">
              {/* Recibo POS — siempre presente (impreso desde esta venta). */}
              <VincLink
                kind="Recibo emitido"
                num={`Rec #${venta.numero}`}
                estado={venta.anulada ? "Anulado" : "Activo"}
              />
              {/* Devoluciones reales asociadas (sin ruta de detalle propia). */}
              {devoluciones.length > 0 ? (
                devoluciones.map((d) => (
                  <VincLink
                    key={d.id}
                    kind="Devolución asociada"
                    num={`Dev #${d.numero}`}
                    estado={devolucionEstadoLabel(d.estado)}
                  />
                ))
              ) : (
                <VincLink
                  kind="Devoluciones"
                  num="Ninguna"
                  estado="Sin devoluciones"
                />
              )}
              {/* Garantías reales asociadas (con ruta de detalle navegable). */}
              {garantias.length > 0 ? (
                garantias.map((g) => (
                  <VincLink
                    key={g.id}
                    kind="Garantía asociada"
                    num={`Gar #${g.numero}`}
                    estado={garantiaVentaEstadoLabel(g.estado)}
                    to={`/ops/garantias/venta/${g.id}`}
                  />
                ))
              ) : (
                <VincLink
                  kind="Garantías"
                  num="Ninguna"
                  estado="Sin reclamos"
                />
              )}
            </div>
          </div>

          {/* Historial */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <Activity className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Historial</div>
            </div>
            <div className="timeline">
              {historial.map((h, i) => (
                <div className="tl-row" key={i}>
                  <span className={`tl-dot ${h.tone}`} />
                  <div>
                    <div className="tl-act">{h.act}</div>
                    <div className="tl-meta">{h.meta}</div>
                  </div>
                  {h.time && <span className="tl-time">{h.time}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Recibo preview (sticky) ───────────────────────────────── */}
        <aside className="pdf-wrap lg:sticky lg:top-4">
          <header className="pdf-head">
            <div>
              <div className="pdf-eyebrow">Preview del recibo</div>
              <div className="pdf-title">Rec #{venta.numero}</div>
            </div>
          </header>
          <div className="pdf-stage">
            {/* #17: el preview ES el PDF real (mismo blob que se imprime). */}
            {reciboUrl ? (
              <iframe
                title={`Recibo de venta #${venta.numero}`}
                src={reciboUrl}
                className="w-full rounded-lg border"
                style={{
                  height: 560,
                  borderColor: "var(--n-150)",
                  backgroundColor: "var(--n-0)",
                }}
              />
            ) : (
              <div
                className="px-4 py-10 text-center text-sm"
                style={{ color: "var(--n-500)" }}
              >
                Generando recibo…
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function Kv({ label, value, mono, full }) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <div
        className="font-mono text-[10px] uppercase tracking-[0.08em]"
        style={{ color: "var(--n-300)" }}
      >
        {label}
      </div>
      <div
        className={"mt-1 text-[13px] font-medium" + (mono ? " font-mono" : "")}
        style={{ color: "var(--n-900)" }}
      >
        {value}
      </div>
    </div>
  );
}

function VincLink({ kind, num, estado, to }) {
  const body = (
    <>
      <span className="vlk">{kind}</span>
      <span className="vpill">{num}</span>
      <span className="vst">{estado}</span>
    </>
  );
  if (to) {
    return (
      <Link
        to={to}
        className="vinc-link transition-colors"
        onMouseEnter={(e) =>
          (e.currentTarget.style.backgroundColor = "var(--n-50)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
      >
        {body}
      </Link>
    );
  }
  return <div className="vinc-link">{body}</div>;
}
