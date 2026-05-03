import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";

export default function VentaDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
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
      setError(safeError(e, "Error al anular la venta"));
    } finally {
      setAnulando(false);
    }
  };

  if (loading) {
    return (
      <div
        className="p-4 sm:p-6 space-y-4 animate-pulse"
        style={{ backgroundColor: "hsl(var(--background))" }}
      >
        <div
          className="h-8 rounded-lg w-1/3"
          style={{ backgroundColor: "hsl(var(--muted))" }}
        />
        <div
          className="rounded-xl border p-4 space-y-3"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-4 rounded w-3/4"
              style={{ backgroundColor: "hsl(var(--muted))" }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (!venta) {
    return (
      <div
        className="flex items-center justify-center min-h-[60vh]"
        style={{ backgroundColor: "hsl(var(--background))" }}
      >
        <p
          className="text-sm"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Venta no encontrada
        </p>
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
  const descuento = subtotalCalc * (venta.descuento_pct / 100);
  const baseIva = subtotalCalc - descuento;
  const iva = baseIva * (venta.iva_pct / 100);
  const totalCalc = venta.total > 0 ? venta.total : baseIva + iva;

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      {/* ── PageHeader ── */}
      <PageHeader
        title={`Venta #${venta.numero}`}
        description={formatDate(venta.fecha)}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={venta.anulada ? "anulada" : "completada"} />
            <button
              onClick={() => navigate("/ops/ventas")}
              className="h-9 px-3 rounded-lg border text-sm font-medium transition-all cursor-pointer"
              style={{
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--muted-foreground))",
                backgroundColor: "hsl(var(--card))",
              }}
            >
              ← Volver
            </button>
          </div>
        }
      />

      {/* ── Info general ── */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div
          className="px-4 py-3 border-b"
          style={{
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--muted) / 0.3)",
          }}
        >
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Información
          </p>
        </div>
        <div>
          <InfoRow label="Vendedor" value={venta.vendedor?.nombre ?? "—"} />
          <InfoRow label="Sede" value={venta.sede_id} />
          <InfoRow
            label="Cliente"
            value={venta.cliente_nombre || "Mostrador"}
          />
          {venta.cliente_nit && (
            <InfoRow label="NIT / Cédula" value={venta.cliente_nit} />
          )}
          <InfoRow label="Método de pago" value={venta.metodo_pago} />
          {venta.observaciones && (
            <InfoRow label="Observaciones" value={venta.observaciones} />
          )}
        </div>
      </div>

      {/* ── Productos ── */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div
          className="px-4 py-3 border-b"
          style={{
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--muted) / 0.3)",
          }}
        >
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Productos ({items.length})
          </p>
        </div>
        {items.map((item, idx) => (
          <div
            key={item.id}
            className="flex items-center justify-between px-4 py-3"
            style={{
              borderTop:
                idx === 0 ? "none" : `1px solid hsl(var(--border) / 0.5)`,
            }}
          >
            <div className="flex-1 min-w-0">
              <p
                className="text-sm font-medium truncate"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {item.producto?.nombre}
              </p>
              <p
                className="text-xs"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {item.producto?.referencia} · {item.cantidad}{" "}
                {item.producto?.unidad_medida} ×{" "}
                {formatCOP(item.precio_unitario)}
              </p>
            </div>
            <p
              className="text-sm font-semibold ml-4 tabular-nums"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {formatCOP(item.subtotal)}
            </p>
          </div>
        ))}
      </div>

      {/* ── Totales ── */}
      <div
        className="rounded-xl border p-4 space-y-2"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div
          className="flex justify-between text-sm"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          <span>Subtotal</span>
          <span className="tabular-nums">{formatCOP(subtotalCalc)}</span>
        </div>
        {venta.descuento_pct > 0 && (
          <div
            className="flex justify-between text-sm"
            style={{ color: "hsl(var(--warning))" }}
          >
            <span>Descuento ({venta.descuento_pct}%)</span>
            <span className="tabular-nums">−{formatCOP(descuento)}</span>
          </div>
        )}
        <div
          className="flex justify-between text-sm"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          <span>IVA {venta.iva_pct}%</span>
          <span className="tabular-nums">{formatCOP(iva)}</span>
        </div>
        <div
          className="flex justify-between font-bold text-base pt-2 border-t"
          style={{
            borderColor: "hsl(var(--border))",
            color: "hsl(var(--foreground))",
          }}
        >
          <span>Total</span>
          <span className="tabular-nums">{formatCOP(totalCalc)}</span>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div
          className="rounded-xl border px-4 py-3"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.05)",
            borderColor: "hsl(var(--destructive) / 0.2)",
          }}
        >
          <p className="text-sm" style={{ color: "hsl(var(--destructive))" }}>
            {error}
          </p>
        </div>
      )}

      {/* ── Anular venta (solo Admin, no anulada) ── */}
      {esAdmin && !venta.anulada && (
        <>
          {!confirmAnular ? (
            <button
              onClick={() => setConfirmAnular(true)}
              className="w-full py-3 rounded-xl text-sm font-medium border transition-all cursor-pointer"
              style={{
                borderColor: "hsl(var(--destructive) / 0.4)",
                color: "hsl(var(--destructive))",
                backgroundColor: "transparent",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor =
                  "hsl(var(--destructive) / 0.05)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              Anular venta
            </button>
          ) : (
            <div
              className="rounded-xl border p-4 space-y-3"
              style={{
                backgroundColor: "hsl(var(--destructive) / 0.05)",
                borderColor: "hsl(var(--destructive) / 0.2)",
              }}
            >
              <p
                className="text-sm font-medium"
                style={{ color: "hsl(var(--destructive))" }}
              >
                ¿Confirmar anulación? El stock será devuelto automáticamente.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmAnular(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all cursor-pointer"
                  style={{
                    borderColor: "hsl(var(--border))",
                    color: "hsl(var(--muted-foreground))",
                    backgroundColor: "hsl(var(--card))",
                  }}
                >
                  Cancelar
                </button>
                <button
                  onClick={anularVenta}
                  disabled={anulando}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-opacity disabled:opacity-50 cursor-pointer"
                  style={{
                    backgroundColor: "hsl(var(--destructive))",
                    color: "hsl(var(--destructive-foreground))",
                  }}
                >
                  {anulando ? "Anulando..." : "Sí, anular"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div
      className="flex justify-between items-start px-4 py-3 border-t first:border-t-0"
      style={{ borderColor: "hsl(var(--border) / 0.5)" }}
    >
      <span
        className="text-sm"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </span>
      <span
        className="text-sm font-medium text-right max-w-[60%]"
        style={{ color: "hsl(var(--foreground))" }}
      >
        {value}
      </span>
    </div>
  );
}
