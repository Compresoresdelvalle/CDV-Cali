import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate } from "../../lib/utils";

const ESTADO_COLORS = {
  borrador: { bg: "#EDE9E0", text: "#636B74", label: "Borrador" },
  enviada: { bg: "#DBEAFE", text: "#2563EB", label: "Enviada" },
  aprobada: { bg: "#D1FAE5", text: "#0B8A57", label: "Aprobada" },
  rechazada: { bg: "#FEE2E2", text: "#C0392B", label: "Rechazada" },
  vencida: { bg: "#F3F4F6", text: "#9CA3AB", label: "Vencida" },
};

export default function CotizacionDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [cotizacion, setCotizacion] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [convirtiendo, setConvirtiendo] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const cargar = async () => {
      setLoading(true);
      try {
        const [{ data: cot }, { data: det }] = await Promise.all([
          supabase
            .from("cotizaciones")
            .select(`*, vendedor:vendedor_id(nombre)`)
            .eq("id", id)
            .single(),
          supabase
            .from("detalle_cotizacion")
            .select(
              `*, producto:producto_id(nombre, referencia, unidad_medida)`,
            )
            .eq("cotizacion_id", id),
        ]);
        setCotizacion(cot);
        setItems(det ?? []);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    cargar();
  }, [id]);

  const convertirEnVenta = async () => {
    setConvirtiendo(true);
    setError(null);
    try {
      if (cotizacion.estado === "vencida")
        throw new Error("La cotización está vencida");
      if (cotizacion.estado === "rechazada")
        throw new Error("La cotización fue rechazada");

      // Pre-validar stock de cada ítem
      for (const item of items) {
        const { data: inv } = await supabase
          .from("inventario")
          .select("cantidad")
          .eq("producto_id", item.producto_id)
          .eq("sede_id", cotizacion.sede_id)
          .single();
        if (!inv || inv.cantidad < item.cantidad) {
          throw new Error(
            `Stock insuficiente para: ${item.producto?.nombre ?? "producto"}`,
          );
        }
      }

      // Insertar cabecera de venta con los totales reales de la cotización
      const { data: venta, error: ventaErr } = await supabase
        .from("ventas")
        .insert({
          vendedor_id: cotizacion.vendedor_id,
          sede_id: cotizacion.sede_id,
          cliente_nombre: cotizacion.cliente_nombre,
          cliente_nit: cotizacion.cliente_nit,
          metodo_pago: "Efectivo",
          descuento_pct: cotizacion.descuento_pct,
          iva_pct: cotizacion.iva_pct,
          subtotal: cotizacion.subtotal,
          total: cotizacion.total,
        })
        .select("id, numero")
        .single();
      if (ventaErr) throw new Error(ventaErr.message);

      // Insertar ítems — triggers manejan stock y recálculo
      const detalles = items.map((i) => ({
        venta_id: venta.id,
        producto_id: i.producto_id,
        cantidad: i.cantidad,
        precio_unitario: i.precio_unitario,
        costo_unitario: 0,
        subtotal: i.cantidad * i.precio_unitario,
      }));
      const { error: detErr } = await supabase
        .from("detalle_venta")
        .insert(detalles);
      if (detErr) throw new Error(detErr.message);

      // Marcar cotización como aprobada
      await supabase
        .from("cotizaciones")
        .update({ estado: "aprobada" })
        .eq("id", id);

      navigate(`/ops/ventas/${venta.id}`);
    } catch (e) {
      setError(e.message ?? "Error al convertir la cotización");
    } finally {
      setConvirtiendo(false);
    }
  };

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: "#F4F1EB" }}
      >
        <p className="text-sm" style={{ color: "#9CA3AB" }}>
          Cargando...
        </p>
      </div>
    );
  }

  if (!cotizacion) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: "#F4F1EB" }}
      >
        <p className="text-sm" style={{ color: "#9CA3AB" }}>
          Cotización no encontrada
        </p>
      </div>
    );
  }

  const estadoStyle =
    ESTADO_COLORS[cotizacion.estado] ?? ESTADO_COLORS.borrador;
  const descuento = cotizacion.subtotal * (cotizacion.descuento_pct / 100);
  const baseIva = cotizacion.subtotal - descuento;
  const iva = baseIva * (cotizacion.iva_pct / 100);
  const puedeConvertir =
    cotizacion.estado !== "rechazada" &&
    cotizacion.estado !== "vencida" &&
    cotizacion.estado !== "aprobada";

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F4F1EB" }}>
      {/* Header */}
      <div
        className="sticky top-0 z-10 px-4 py-4 shadow-sm"
        style={{ backgroundColor: "#14352A" }}
      >
        <div className="flex items-center gap-3 max-w-2xl mx-auto">
          <button
            onClick={() => navigate("/ops/cotizaciones")}
            className="text-white/70 hover:text-white transition-colors"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-white font-semibold text-lg">
                Cotización #{cotizacion.numero}
              </h1>
              <span
                className="px-2 py-0.5 rounded-full text-xs font-medium"
                style={{
                  backgroundColor: estadoStyle.bg,
                  color: estadoStyle.text,
                }}
              >
                {estadoStyle.label}
              </span>
            </div>
            <p className="text-white/60 text-xs">
              {formatDate(cotizacion.fecha)}
            </p>
          </div>
          {/* Botón editar — no disponible para aprobadas */}
          {cotizacion.estado !== "aprobada" && (
            <button
              onClick={() => navigate(`/ops/cotizaciones/${id}/editar`)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors"
              style={{
                backgroundColor: "rgba(255,255,255,0.15)",
                color: "#fff",
              }}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
              Editar
            </button>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Info general */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div
            className="px-4 py-3 border-b"
            style={{ borderColor: "#E2DED5" }}
          >
            <p
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "#9CA3AB" }}
            >
              Información
            </p>
          </div>
          <div className="divide-y" style={{ borderColor: "#E2DED5" }}>
            <Row label="Vendedor" value={cotizacion.vendedor?.nombre ?? "—"} />
            <Row label="Sede" value={cotizacion.sede_id} />
            <Row
              label="Cliente"
              value={cotizacion.cliente_nombre || "Sin nombre"}
            />
            {cotizacion.cliente_nit && (
              <Row label="NIT / Cédula" value={cotizacion.cliente_nit} />
            )}
            {cotizacion.cliente_email && (
              <Row label="Email" value={cotizacion.cliente_email} />
            )}
            {cotizacion.cliente_telefono && (
              <Row label="Teléfono" value={cotizacion.cliente_telefono} />
            )}
            <Row label="Vigencia" value={`${cotizacion.vigencia_dias} días`} />
            {cotizacion.observaciones && (
              <Row label="Observaciones" value={cotizacion.observaciones} />
            )}
          </div>
        </div>

        {/* Productos */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div
            className="px-4 py-3 border-b"
            style={{ borderColor: "#E2DED5" }}
          >
            <p
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "#9CA3AB" }}
            >
              Productos ({items.length})
            </p>
          </div>
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between px-4 py-3 border-b last:border-b-0"
              style={{ borderColor: "#E2DED5" }}
            >
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-medium truncate"
                  style={{ color: "#151515" }}
                >
                  {item.producto?.nombre}
                </p>
                <p className="text-xs" style={{ color: "#9CA3AB" }}>
                  {item.producto?.referencia} · {item.cantidad}{" "}
                  {item.producto?.unidad_medida} ×{" "}
                  {formatCOP(item.precio_unitario)}
                </p>
              </div>
              <p
                className="text-sm font-semibold ml-4"
                style={{ color: "#14352A" }}
              >
                {formatCOP(item.subtotal)}
              </p>
            </div>
          ))}
        </div>

        {/* Totales */}
        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-2">
          <div
            className="flex justify-between text-sm"
            style={{ color: "#636B74" }}
          >
            <span>Subtotal</span>
            <span>{formatCOP(cotizacion.subtotal)}</span>
          </div>
          {cotizacion.descuento_pct > 0 && (
            <div
              className="flex justify-between text-sm"
              style={{ color: "#C47F17" }}
            >
              <span>Descuento ({cotizacion.descuento_pct}%)</span>
              <span>−{formatCOP(descuento)}</span>
            </div>
          )}
          <div
            className="flex justify-between text-sm"
            style={{ color: "#636B74" }}
          >
            <span>IVA {cotizacion.iva_pct}%</span>
            <span>{formatCOP(iva)}</span>
          </div>
          <div
            className="flex justify-between font-bold text-base pt-2 border-t"
            style={{ borderColor: "#E2DED5", color: "#14352A" }}
          >
            <span>Total</span>
            <span>{formatCOP(cotizacion.total)}</span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Botón convertir en venta */}
        {puedeConvertir && (
          <button
            onClick={convertirEnVenta}
            disabled={convirtiendo}
            className="w-full py-4 rounded-2xl font-semibold text-base text-white transition-opacity disabled:opacity-40"
            style={{ backgroundColor: "#14352A" }}
          >
            {convirtiendo
              ? "Convirtiendo..."
              : `Convertir en venta · ${formatCOP(cotizacion.total)}`}
          </button>
        )}

        <div className="h-6" />
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between items-start px-4 py-3">
      <span className="text-sm" style={{ color: "#9CA3AB" }}>
        {label}
      </span>
      <span
        className="text-sm font-medium text-right max-w-[60%]"
        style={{ color: "#151515" }}
      >
        {value}
      </span>
    </div>
  );
}
