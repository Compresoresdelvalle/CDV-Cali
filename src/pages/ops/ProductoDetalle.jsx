import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../stores/authStore";
import StatusBadge from "../../components/ui/StatusBadge";
import PageHeader from "../../components/layout/PageHeader";
import QRGenerator from "../../components/qr/QRGenerator";
import QRPrintLabel from "../../components/qr/QRPrintLabel";
import TipoProductoBadge from "../../components/inventario/TipoProductoBadge";
import { formatCOP, formatDate, safeError } from "../../lib/utils";

export default function ProductoDetalle() {
  const { productoId } = useParams();
  const navigate = useNavigate();
  const authLoading = useAuthStore((s) => s.loading);
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";

  const [producto, setProducto] = useState(null);
  const [inventario, setInventario] = useState([]);
  const [movimientos, setMovimientos] = useState([]);
  const [proveedores, setProveedores] = useState([]); // F12: historial proveedores
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!productoId || authLoading) return;
    let cancelled = false;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: prod, error: prodErr } = await supabase
          .from("productos")
          .select(
            "id, referencia, codigo_interno, codigo_proveedor, tipo, nombre, categoria, subcategoria, marca, modelo, descripcion, precio_venta, costo_promedio, stock_minimo, stock_maximo, unidad_medida, activo",
          )
          .eq("id", productoId)
          .single();

        if (prodErr || !prod) throw new Error("Producto no encontrado");

        const { data: inv } = await supabase
          .from("inventario")
          .select(
            "id, cantidad, estado_stock, ubicacion_id, sede:sedes(id, nombre)",
          )
          .eq("producto_id", productoId)
          .order("sede_id");

        const { data: movs } = await supabase
          .from("movimientos")
          .select(
            "id, fecha, tipo, cantidad, stock_anterior, stock_posterior, observaciones, sede_id",
          )
          .eq("producto_id", productoId)
          .order("fecha", { ascending: false })
          .limit(10);

        // F12: historial de proveedores (último primero)
        const { data: provs } = await supabase
          .from("productos_proveedores")
          .select("proveedor, ultima_compra_at, ultimo_costo")
          .eq("producto_id", productoId)
          .order("ultima_compra_at", { ascending: false, nullsFirst: false });

        if (!cancelled) {
          setProducto(prod);
          setInventario(inv ?? []);
          setMovimientos(movs ?? []);
          setProveedores(provs ?? []);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(safeError(e, "Error al cargar el producto"));
          setLoading(false);
        }
      }
    };

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [productoId, authLoading]);

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} onBack={() => navigate(-1)} />;
  if (!producto) return null;

  const stockTotal = inventario.reduce((sum, i) => sum + i.cantidad, 0);

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      {/* ── PageHeader ── */}
      <PageHeader
        title={producto.nombre}
        description={
          [producto.codigo_interno, producto.codigo_proveedor]
            .filter(Boolean)
            .join(" · ") || producto.referencia
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <TipoProductoBadge tipo={producto.tipo} />
            {!producto.activo && (
              <span
                className="text-xs font-semibold px-2 py-1 rounded-full"
                style={{
                  backgroundColor: "hsl(var(--destructive) / 0.1)",
                  color: "hsl(var(--destructive))",
                }}
              >
                Inactivo
              </span>
            )}
            <button
              onClick={() => navigate(-1)}
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

      {/* ── Tarjeta principal ── */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div
          className="px-5 py-4 border-b"
          style={{
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--muted) / 0.3)",
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1
                className="text-base font-bold leading-tight"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {producto.nombre}
              </h1>
              <p
                className="text-xs font-mono mt-0.5"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {producto.referencia}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {producto.categoria && <Tag>{producto.categoria}</Tag>}
                {producto.marca && <Tag variant="accent">{producto.marca}</Tag>}
                {producto.modelo && <Tag>{producto.modelo}</Tag>}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p
                className="text-3xl font-black tabular-nums"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {stockTotal}
              </p>
              <p
                className="text-[10px] uppercase tracking-wide"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                total
              </p>
            </div>
          </div>

          {producto.descripcion && (
            <p
              className="text-xs mt-3 leading-relaxed"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {producto.descripcion}
            </p>
          )}
        </div>

        {/* Precios */}
        <div
          className={`grid divide-x ${esAdmin ? "grid-cols-2" : "grid-cols-1"}`}
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <div className="px-5 py-3.5">
            <p
              className="text-[10px] uppercase tracking-wide font-medium"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Precio venta
            </p>
            <p
              className="text-base font-bold mt-0.5"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {formatCOP(producto.precio_venta)}
            </p>
          </div>
          {esAdmin && (
            <div className="px-5 py-3.5">
              <p
                className="text-[10px] uppercase tracking-wide font-medium"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Costo promedio
              </p>
              <p
                className="text-base font-bold mt-0.5"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {formatCOP(producto.costo_promedio)}
              </p>
            </div>
          )}
        </div>

        {/* Mínimo / Máximo */}
        <div
          className="grid grid-cols-2 divide-x border-t"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <div className="px-5 py-3.5">
            <p
              className="text-[10px] uppercase tracking-wide font-medium"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Stock mínimo
            </p>
            <p
              className="text-sm font-semibold mt-0.5"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {producto.stock_minimo}
            </p>
          </div>
          <div className="px-5 py-3.5">
            <p
              className="text-[10px] uppercase tracking-wide font-medium"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Stock máximo
            </p>
            <p
              className="text-sm font-semibold mt-0.5"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {producto.stock_maximo}
            </p>
          </div>
        </div>
      </div>

      {/* ── Stock por sede ── */}
      <Section title="Stock por sede" icon="🏪">
        {inventario.length === 0 ? (
          <p
            className="text-sm px-4 py-3"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Sin registros de inventario
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr
                className="text-left border-b"
                style={{ borderColor: "hsl(var(--border))" }}
              >
                {["Sede", "Cant.", "Estado", "Ubicación"].map((col, i) => (
                  <th
                    key={col}
                    className={`px-4 py-2.5 text-xs font-semibold${i === 3 ? " hidden sm:table-cell" : ""}`}
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inventario.map((inv, idx) => (
                <tr
                  key={inv.id}
                  style={{
                    borderTop:
                      idx === 0 ? "none" : `1px solid hsl(var(--border) / 0.5)`,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor =
                      "hsl(var(--muted) / 0.4)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "")
                  }
                >
                  <td
                    className="px-4 py-3 text-sm"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {inv.sede?.nombre}
                  </td>
                  <td
                    className="px-4 py-3 text-right font-bold tabular-nums"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {inv.cantidad}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={inv.estado_stock} />
                  </td>
                  <td
                    className="px-4 py-3 text-xs hidden sm:table-cell"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {inv.ubicacion_id ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── QR ── */}
      <Section title="Código QR" icon="📱">
        <div className="flex flex-col sm:flex-row items-center gap-6 px-4 py-4">
          <div
            className="p-4 rounded-xl border"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
            }}
          >
            <QRGenerator value={producto.referencia} size={160} />
          </div>
          <div className="flex flex-col gap-3 items-center sm:items-start">
            <div>
              <p
                className="text-xs uppercase tracking-wide font-medium"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Referencia
              </p>
              <p
                className="text-lg font-bold font-mono mt-0.5"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {producto.referencia}
              </p>
            </div>
            <p
              className="text-xs text-center sm:text-left"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Escanea con la app para ver el detalle del producto.
            </p>
            <QRPrintLabel
              referencia={producto.referencia}
              nombre={producto.nombre}
            />
          </div>
        </div>
      </Section>

      {/* ── F12: Proveedores (último primero) ── */}
      <Section title="Proveedores" icon="🏷️">
        {proveedores.length === 0 ? (
          <p
            className="text-sm px-4 py-3"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Aún no hay compras registradas. Al recibir la primera compra quedará
            aquí el proveedor.
          </p>
        ) : (
          <ul>
            {proveedores.map((p, idx) => (
              <li
                key={p.proveedor}
                className="px-4 py-3 flex items-center justify-between gap-3"
                style={{
                  borderTop:
                    idx === 0 ? "none" : `1px solid hsl(var(--border) / 0.5)`,
                }}
              >
                <div className="min-w-0">
                  <p
                    className="text-sm font-semibold"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {idx === 0 && (
                      <span
                        className="mr-2 px-2 py-0.5 rounded text-[10px] font-bold"
                        style={{
                          backgroundColor: "hsl(var(--success) / 0.15)",
                          color: "hsl(var(--success))",
                        }}
                      >
                        ÚLTIMO
                      </span>
                    )}
                    {p.proveedor}
                  </p>
                  {p.ultima_compra_at && (
                    <p
                      className="text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      Última compra: {formatDate(p.ultima_compra_at)}
                    </p>
                  )}
                </div>
                {p.ultimo_costo != null && (
                  <span
                    className="text-sm font-mono tabular-nums"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {formatCOP(p.ultimo_costo)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── Últimos movimientos ── */}
      <Section title="Últimos 10 movimientos" icon="📋">
        {movimientos.length === 0 ? (
          <p
            className="text-sm px-4 py-3"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Sin movimientos registrados
          </p>
        ) : (
          <ul>
            {movimientos.map((mov, idx) => (
              <li
                key={mov.id}
                className="px-4 py-3 flex items-start gap-3"
                style={{
                  borderTop:
                    idx === 0 ? "none" : `1px solid hsl(var(--border) / 0.5)`,
                }}
              >
                <MovimientoIcon tipo={mov.tipo} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="text-sm font-semibold capitalize"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {mov.tipo.toLowerCase().replace("_", " ")}
                    </span>
                    <span
                      className="text-sm font-bold tabular-nums"
                      style={{
                        color:
                          mov.cantidad >= 0
                            ? "hsl(var(--success))"
                            : "hsl(var(--destructive))",
                      }}
                    >
                      {mov.cantidad >= 0 ? "+" : ""}
                      {mov.cantidad}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className="text-[11px]"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {mov.sede_id}
                    </span>
                    <span
                      className="text-xs"
                      style={{ color: "hsl(var(--border))" }}
                    >
                      ·
                    </span>
                    <span
                      className="text-[11px] tabular-nums"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {mov.stock_anterior} → {mov.stock_posterior}
                    </span>
                  </div>
                  {mov.observaciones && (
                    <p
                      className="text-[11px] mt-1 italic truncate"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {mov.observaciones}
                    </p>
                  )}
                  <p
                    className="text-[10px] mt-0.5"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {formatDate(mov.fecha)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/* ── Helpers ── */

function Section({ title, icon, children }) {
  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <div
        className="px-4 py-3 border-b flex items-center gap-2"
        style={{
          borderColor: "hsl(var(--border))",
          backgroundColor: "hsl(var(--muted) / 0.3)",
        }}
      >
        <span className="text-base">{icon}</span>
        <h2
          className="text-sm font-bold"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

function Tag({ children, variant = "default" }) {
  const styles =
    variant === "accent"
      ? {
          backgroundColor: "hsl(var(--primary) / 0.1)",
          color: "hsl(var(--primary))",
          border: "1px solid hsl(var(--primary) / 0.2)",
        }
      : {
          backgroundColor: "hsl(var(--muted))",
          color: "hsl(var(--muted-foreground))",
          border: "1px solid hsl(var(--border))",
        };
  return (
    <span
      className="text-[10px] font-medium px-2 py-0.5 rounded-full"
      style={styles}
    >
      {children}
    </span>
  );
}

function MovimientoIcon({ tipo }) {
  const colores = {
    COMPRA: {
      bg: "hsl(var(--success) / 0.1)",
      color: "hsl(var(--success))",
      symbol: "↓",
    },
    VENTA: {
      bg: "hsl(var(--destructive) / 0.1)",
      color: "hsl(var(--destructive))",
      symbol: "↑",
    },
    TRASPASO: {
      bg: "hsl(var(--info) / 0.1)",
      color: "hsl(var(--info))",
      symbol: "⇄",
    },
    AJUSTE: {
      bg: "hsl(var(--warning) / 0.1)",
      color: "hsl(var(--warning))",
      symbol: "≈",
    },
    DEVOLUCION: {
      bg: "hsl(var(--primary) / 0.1)",
      color: "hsl(var(--primary))",
      symbol: "↩",
    },
    ENSAMBLE: {
      bg: "hsl(var(--info) / 0.1)",
      color: "hsl(var(--info))",
      symbol: "⚙",
    },
    default: {
      bg: "hsl(var(--muted))",
      color: "hsl(var(--muted-foreground))",
      symbol: "•",
    },
  };
  const cfg = colores[tipo] ?? colores.default;
  return (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}
    >
      {cfg.symbol}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-pulse"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <div
        className="h-8 rounded-lg w-1/2"
        style={{ backgroundColor: "hsl(var(--muted))" }}
      />
      <div
        className="rounded-xl border h-40"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      />
      <div
        className="rounded-xl border h-32"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      />
      <div
        className="rounded-xl border h-56"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      />
    </div>
  );
}

function ErrorState({ message, onBack }) {
  return (
    <div
      className="flex flex-col items-center justify-center min-h-[60vh] px-8 text-center"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <div className="text-5xl mb-4">⚠️</div>
      <p className="font-bold" style={{ color: "hsl(var(--foreground))" }}>
        No se pudo cargar el producto
      </p>
      <p
        className="text-sm mt-1"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {message}
      </p>
      <button
        onClick={onBack}
        className="mt-6 px-5 py-2.5 rounded-xl text-sm font-semibold cursor-pointer transition-opacity"
        style={{
          backgroundColor: "hsl(var(--primary))",
          color: "hsl(var(--primary-foreground))",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
      >
        Volver
      </button>
    </div>
  );
}
