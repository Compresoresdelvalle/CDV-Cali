import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { formatCOP, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";

const PERIODOS = [
  { dias: 7, label: "7 días" },
  { dias: 30, label: "30 días" },
  { dias: 90, label: "90 días" },
  { dias: 365, label: "1 año" },
];

export default function Top10() {
  const [periodo, setPeriodo] = useState(30);
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
      const { data, error } = await supabase.rpc("fn_top_productos", {
        p_dias: periodo,
        p_limit: 10,
      });
      if (!mountedRef.current) return;
      if (error) throw error;
      setItems(data ?? []);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar top productos"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
  }, [periodo]);

  const maxUnidades = Math.max(
    1,
    ...items.map((i) => Number(i.unidades_vendidas)),
  );

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Top 10 productos"
        description={`Productos más vendidos · ${PERIODOS.find((p) => p.dias === periodo)?.label}`}
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

      <div className="flex gap-2 overflow-x-auto pb-1">
        {PERIODOS.map((p) => (
          <button
            key={p.dias}
            onClick={() => setPeriodo(p.dias)}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer"
            style={
              periodo === p.dias
                ? {
                    backgroundColor: "hsl(var(--primary))",
                    color: "hsl(var(--primary-foreground))",
                    borderColor: "hsl(var(--primary))",
                  }
                : {
                    backgroundColor: "transparent",
                    color: "hsl(var(--muted-foreground))",
                    borderColor: "hsl(var(--border))",
                  }
            }
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
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
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-5xl mb-3">📊</div>
          <p style={{ color: "hsl(var(--muted-foreground))" }}>
            Sin ventas en este período
          </p>
        </div>
      ) : (
        <ul className="space-y-2" role="list">
          {items.map((p, i) => {
            const pct = (Number(p.unidades_vendidas) / maxUnidades) * 100;
            return (
              <li
                key={p.producto_id}
                className="rounded-xl border p-3"
                style={{
                  backgroundColor: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                }}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span
                    className="text-sm font-bold w-7 h-7 rounded flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor:
                        i < 3 ? "hsl(var(--primary))" : "hsl(var(--muted))",
                      color:
                        i < 3
                          ? "hsl(var(--primary-foreground))"
                          : "hsl(var(--muted-foreground))",
                    }}
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm font-medium"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {p.nombre}
                    </p>
                    <p
                      className="text-xs font-mono"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {p.referencia}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className="text-base font-bold tabular-nums"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {p.unidades_vendidas}
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      uds · {p.num_ventas} ventas
                    </p>
                  </div>
                  <div className="text-right shrink-0 hidden sm:block">
                    <p
                      className="text-sm font-bold tabular-nums"
                      style={{ color: "hsl(var(--primary))" }}
                    >
                      {formatCOP(p.total_vendido)}
                    </p>
                  </div>
                </div>
                <div
                  className="h-1.5 rounded-full overflow-hidden"
                  style={{ backgroundColor: "hsl(var(--muted) / 0.4)" }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: "hsl(var(--primary))",
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
