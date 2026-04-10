import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate } from "../../lib/utils";

export default function VentaDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const session = useAuthStore((s) => s.session);
  const esAdmin = perfil?.rol === "Admin";

  const [venta, setVenta] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [anulando, setAnulando] = useState(false);
  const [confirmAnular, setConfirmAnular] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const cargar = async () => {
      setLoading(true);
      try {
        const [{ data: v }, { data: d }] = await Promise.all([
          supabase
            .from("ventas")
            .select(`*, vendedor:vendedor_id(nombre)`)
            .eq("id", id)
            .single(),
          supabase
            .from("detalle_venta")
            .select(
              `*, producto:producto_id(nombre, referencia, unidad_medida)`,
            )
            .eq("venta_id", id),
        ]);

        setVenta(v);
        setItems(d ?? []);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    cargar();
  }, [id]);

  const anularVenta = async () => {
    setAnulando(true);
    setError(null);
    try {
      const { error: fnErr } = await supabase.rpc("fn_anular_venta", {
        p_venta_id: id,
      });
      if (fnErr) throw new Error(fnErr.message);
      setVenta((prev) => ({ ...prev, anulada: true }));
      setConfirmAnular(false);
    } catch (e) {
      setError(e.message ?? "Error al anular la venta");
    } finally {
      setAnulando(false);
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

  if (!venta) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: "#F4F1EB" }}
      >
        <p className="text-sm" style={{ color: "#9CA3AB" }}>
          Venta no encontrada
        </p>
      </div>
    );
  }

  const descuento = venta.subtotal * (venta.descuento_pct / 100);
  const baseIva = venta.subtotal - descuento;
  const iva = baseIva * (venta.iva_pct / 100);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F4F1EB" }}>
      {/* Header */}
      <div
        className="sticky top-0 z-10 px-4 py-4 shadow-sm"
        style={{ backgroundColor: "#14352A" }}
      >
        <div className="flex items-center gap-3 max-w-2xl mx-auto">
          <button
            onClick={() => navigate("/ops/ventas")}
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
                Venta #{venta.numero}
              </h1>
              {venta.anulada && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-300">
                  Anulada
                </span>
              )}
            </div>
            <p className="text-white/60 text-xs">{formatDate(venta.fecha)}</p>
          </div>
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
            <Row label="Vendedor" value={venta.vendedor?.nombre ?? "—"} />
            <Row label="Sede" value={venta.sede_id} />
            <Row label="Cliente" value={venta.cliente_nombre || "Mostrador"} />
            {venta.cliente_nit && (
              <Row label="NIT / Cédula" value={venta.cliente_nit} />
            )}
            <Row label="Método de pago" value={venta.metodo_pago} />
            {venta.observaciones && (
              <Row label="Observaciones" value={venta.observaciones} />
            )}
          </div>
        </div>

        {/* Ítems */}
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
            <span>{formatCOP(venta.subtotal)}</span>
          </div>
          {venta.descuento_pct > 0 && (
            <div
              className="flex justify-between text-sm"
              style={{ color: "#C47F17" }}
            >
              <span>Descuento ({venta.descuento_pct}%)</span>
              <span>−{formatCOP(descuento)}</span>
            </div>
          )}
          <div
            className="flex justify-between text-sm"
            style={{ color: "#636B74" }}
          >
            <span>IVA {venta.iva_pct}%</span>
            <span>{formatCOP(iva)}</span>
          </div>
          <div
            className="flex justify-between font-bold text-base pt-2 border-t"
            style={{ borderColor: "#E2DED5", color: "#14352A" }}
          >
            <span>Total</span>
            <span>{formatCOP(venta.total)}</span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Anular venta — solo Admin y si no está anulada */}
        {esAdmin && !venta.anulada && (
          <>
            {!confirmAnular ? (
              <button
                onClick={() => setConfirmAnular(true)}
                className="w-full py-3 rounded-2xl text-sm font-medium border transition-colors"
                style={{ borderColor: "#C0392B", color: "#C0392B" }}
              >
                Anular venta
              </button>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-3">
                <p className="text-sm text-red-700 font-medium">
                  ¿Confirmar anulación? El stock será devuelto automáticamente.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setConfirmAnular(false)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors"
                    style={{ borderColor: "#E2DED5", color: "#636B74" }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={anularVenta}
                    disabled={anulando}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white transition-opacity disabled:opacity-50"
                    style={{ backgroundColor: "#C0392B" }}
                  >
                    {anulando ? "Anulando..." : "Sí, anular"}
                  </button>
                </div>
              </div>
            )}
          </>
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
