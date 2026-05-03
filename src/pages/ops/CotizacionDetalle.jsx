import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";

export default function CotizacionDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();

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

  if (!cotizacion) {
    return (
      <div
        className="flex items-center justify-center min-h-[60vh]"
        style={{ backgroundColor: "hsl(var(--background))" }}
      >
        <p
          className="text-sm"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Cotización no encontrada
        </p>
      </div>
    );
  }

  const descuento = cotizacion.subtotal * (cotizacion.descuento_pct / 100);
  const baseIva = cotizacion.subtotal - descuento;
  const iva = baseIva * (cotizacion.iva_pct / 100);
  const puedeConvertir =
    cotizacion.estado !== "rechazada" &&
    cotizacion.estado !== "vencida" &&
    cotizacion.estado !== "aprobada";

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      {/* ── PageHeader ── */}
      <PageHeader
        title={`Cotización #${cotizacion.numero}`}
        description={formatDate(cotizacion.fecha)}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={cotizacion.estado} />
            <button
              onClick={() => navigate("/ops/cotizaciones")}
              className="h-9 px-3 rounded-lg border text-sm font-medium transition-all cursor-pointer"
              style={{
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--muted-foreground))",
                backgroundColor: "hsl(var(--card))",
              }}
            >
              ← Volver
            </button>
            {cotizacion.estado !== "aprobada" && (
              <button
                onClick={() => navigate(`/ops/cotizaciones/${id}/editar`)}
                className="flex items-center gap-1.5 h-9 px-3 rounded-lg border text-sm font-medium transition-all cursor-pointer"
                style={{
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                  backgroundColor: "hsl(var(--card))",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor =
                    "hsl(var(--primary) / 0.4)";
                  e.currentTarget.style.backgroundColor =
                    "hsl(var(--primary) / 0.05)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "hsl(var(--border))";
                  e.currentTarget.style.backgroundColor = "hsl(var(--card))";
                }}
              >
                <EditIcon />
                Editar
              </button>
            )}
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
          <InfoRow
            label="Vendedor"
            value={cotizacion.vendedor?.nombre ?? "—"}
          />
          <InfoRow label="Sede" value={cotizacion.sede_id} />
          <InfoRow
            label="Cliente"
            value={cotizacion.cliente_nombre || "Sin nombre"}
          />
          {cotizacion.cliente_nit && (
            <InfoRow label="NIT / Cédula" value={cotizacion.cliente_nit} />
          )}
          {cotizacion.cliente_email && (
            <InfoRow label="Email" value={cotizacion.cliente_email} />
          )}
          {cotizacion.cliente_telefono && (
            <InfoRow label="Teléfono" value={cotizacion.cliente_telefono} />
          )}
          <InfoRow
            label="Vigencia"
            value={`${cotizacion.vigencia_dias} días`}
          />
          {cotizacion.observaciones && (
            <InfoRow label="Observaciones" value={cotizacion.observaciones} />
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
          <span className="tabular-nums">{formatCOP(cotizacion.subtotal)}</span>
        </div>
        {cotizacion.descuento_pct > 0 && (
          <div
            className="flex justify-between text-sm"
            style={{ color: "hsl(var(--warning))" }}
          >
            <span>Descuento ({cotizacion.descuento_pct}%)</span>
            <span className="tabular-nums">−{formatCOP(descuento)}</span>
          </div>
        )}
        <div
          className="flex justify-between text-sm"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          <span>IVA {cotizacion.iva_pct}%</span>
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
          <span className="tabular-nums">{formatCOP(cotizacion.total)}</span>
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

      {/* ── Botón convertir ── */}
      {puedeConvertir && (
        <button
          onClick={convertirEnVenta}
          disabled={convirtiendo}
          className="w-full py-4 rounded-xl font-semibold text-base transition-opacity disabled:opacity-40 cursor-pointer"
          style={{
            backgroundColor: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
          }}
        >
          {convirtiendo
            ? "Convirtiendo..."
            : `Convertir en venta · ${formatCOP(cotizacion.total)}`}
        </button>
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

function EditIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}
