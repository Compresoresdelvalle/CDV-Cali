import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { formatCOP, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";

export default function Reorden() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const cargar = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const { data, error } = await supabase
        .from("v_sugerencias_reorden")
        .select("*")
        .limit(200);
      if (!mountedRef.current) return;
      if (error) throw error;
      setItems(data ?? []);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar sugerencias"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  const totalCompra = items.reduce(
    (s, i) => s + Number(i.costo_estimado_compra || 0),
    0,
  );

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Sugerencias de reorden"
        description={
          loading
            ? "Cargando…"
            : `${items.length} productos · ${formatCOP(totalCompra)} estimado`
        }
        actions={
          <button
            onClick={() => navigate("/ops/compras/nueva")}
            className="h-9 px-4 rounded-lg text-sm font-medium cursor-pointer"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            Nueva compra
          </button>
        }
      />

      {errorMsg && (
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.08)",
            borderColor: "hsl(var(--destructive) / 0.4)",
            color: "hsl(var(--destructive))",
          }}
        >
          {errorMsg}
        </div>
      )}

      {loading ? (
        <SkeletonList />
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-5xl mb-3">📦</div>
          <p style={{ color: "hsl(var(--muted-foreground))" }}>
            Todos los productos están sobre el stock mínimo
          </p>
        </div>
      ) : (
        <>
          {/* Desktop tabla */}
          <div
            className="hidden md:block overflow-x-auto rounded-xl border"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <table className="w-full border-collapse">
              <thead>
                <tr
                  style={{
                    backgroundColor: "hsl(var(--muted) / 0.4)",
                    borderBottom: "1px solid hsl(var(--border))",
                  }}
                >
                  {[
                    "Producto",
                    "ABC",
                    "Sede",
                    "Estado",
                    "Stock",
                    "Mínimo",
                    "Sugerido",
                    "Costo estimado",
                  ].map((c) => (
                    <th
                      key={c}
                      className="px-3 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap text-left"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((i, idx) => (
                  <tr
                    key={`${i.producto_id}-${i.sede_id}`}
                    style={{
                      borderTop:
                        idx === 0
                          ? "none"
                          : "1px solid hsl(var(--border) / 0.5)",
                    }}
                  >
                    <td className="px-3 py-3">
                      <p
                        className="text-sm font-medium"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {i.nombre}
                      </p>
                      <p
                        className="text-xs font-mono"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {i.referencia}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className="px-2 py-0.5 rounded text-xs font-bold"
                        style={{
                          backgroundColor:
                            i.clasificacion === "A"
                              ? "hsl(var(--success) / 0.2)"
                              : i.clasificacion === "B"
                                ? "hsl(var(--warning) / 0.2)"
                                : "hsl(var(--muted) / 0.4)",
                          color:
                            i.clasificacion === "A"
                              ? "hsl(var(--success))"
                              : i.clasificacion === "B"
                                ? "hsl(var(--warning))"
                                : "hsl(var(--muted-foreground))",
                        }}
                      >
                        {i.clasificacion}
                      </span>
                    </td>
                    <td
                      className="px-3 py-3 text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {i.sede_nombre}
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={i.estado_stock} />
                    </td>
                    <td
                      className="px-3 py-3 text-sm tabular-nums"
                      style={{ color: "hsl(var(--destructive))" }}
                    >
                      {i.stock_actual}
                    </td>
                    <td
                      className="px-3 py-3 text-sm tabular-nums"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {i.stock_minimo}
                    </td>
                    <td
                      className="px-3 py-3 text-sm font-bold tabular-nums"
                      style={{ color: "hsl(var(--primary))" }}
                    >
                      {i.cantidad_sugerida}
                    </td>
                    <td
                      className="px-3 py-3 text-sm font-medium tabular-nums"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {formatCOP(i.costo_estimado_compra)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid hsl(var(--border))" }}>
                  <td
                    colSpan="7"
                    className="px-3 py-3 text-sm font-semibold text-right"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    Total estimado:
                  </td>
                  <td
                    className="px-3 py-3 text-sm font-bold tabular-nums"
                    style={{ color: "hsl(var(--primary))" }}
                  >
                    {formatCOP(totalCompra)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="md:hidden space-y-2" role="list">
            {items.map((i) => (
              <li
                key={`${i.producto_id}-${i.sede_id}`}
                className="rounded-xl border p-3"
                style={{
                  backgroundColor: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                }}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm font-medium"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {i.nombre}
                    </p>
                    <p
                      className="text-xs font-mono"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {i.referencia} · {i.sede_nombre}
                    </p>
                  </div>
                  <StatusBadge status={i.estado_stock} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <p style={{ color: "hsl(var(--muted-foreground))" }}>
                      Stock
                    </p>
                    <p
                      className="font-bold tabular-nums"
                      style={{ color: "hsl(var(--destructive))" }}
                    >
                      {i.stock_actual}
                    </p>
                  </div>
                  <div>
                    <p style={{ color: "hsl(var(--muted-foreground))" }}>
                      Sugerido
                    </p>
                    <p
                      className="font-bold tabular-nums"
                      style={{ color: "hsl(var(--primary))" }}
                    >
                      {i.cantidad_sugerida}
                    </p>
                  </div>
                  <div>
                    <p style={{ color: "hsl(var(--muted-foreground))" }}>
                      Costo
                    </p>
                    <p
                      className="font-bold tabular-nums"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {formatCOP(i.costo_estimado_compra)}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="rounded-xl p-4 animate-pulse border h-16"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        />
      ))}
    </div>
  );
}
