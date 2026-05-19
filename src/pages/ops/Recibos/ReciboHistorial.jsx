import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../../lib/utils";
import PageHeader from "../../../components/layout/PageHeader";

/**
 * Historial de recibos de pago — Fase 14.
 */
export default function ReciboHistorial() {
  const navigate = useNavigate();
  const [recibos, setRecibos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [filtro, setFiltro] = useState("Todos"); // Todos | Vigentes | Anulados

  useEffect(() => {
    let cancelado = false;
    const cargar = async () => {
      setLoading(true);
      setErrorMsg("");
      try {
        let q = supabase
          .from("recibos")
          .select(
            "id, numero, fecha, cliente_nombre, total, monto_pagado, saldo, anulado",
          )
          .order("fecha", { ascending: false })
          .limit(200);
        if (filtro === "Vigentes") q = q.eq("anulado", false);
        if (filtro === "Anulados") q = q.eq("anulado", true);
        const { data, error } = await q;
        if (error) throw error;
        if (!cancelado) setRecibos(data ?? []);
      } catch (err) {
        if (!cancelado) setErrorMsg(safeError(err, "Error al cargar recibos"));
      } finally {
        if (!cancelado) setLoading(false);
      }
    };
    cargar();
    return () => {
      cancelado = true;
    };
  }, [filtro]);

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Recibos"
        description="Recibos de pago entregados a clientes."
        actions={
          <button
            onClick={() => navigate("/ops/recibos/nuevo")}
            className="h-9 px-3 rounded-lg text-sm font-medium cursor-pointer"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            🧾 Nuevo recibo
          </button>
        }
      />

      <div className="flex flex-wrap gap-1.5">
        {["Todos", "Vigentes", "Anulados"].map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className="px-3 h-8 rounded-lg text-xs font-medium border cursor-pointer"
            style={{
              backgroundColor:
                filtro === f ? "hsl(var(--primary))" : "hsl(var(--card))",
              color:
                filtro === f
                  ? "hsl(var(--primary-foreground))"
                  : "hsl(var(--foreground))",
              borderColor: "hsl(var(--border))",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {errorMsg && (
        <div
          role="alert"
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
        <div
          className="h-12 rounded-lg animate-pulse"
          style={{ backgroundColor: "hsl(var(--muted) / 0.4)" }}
        />
      ) : recibos.length === 0 ? (
        <p
          className="text-center py-8 text-sm"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Sin recibos.
        </p>
      ) : (
        <ul className="space-y-1.5" role="list">
          {recibos.map((r) => (
            <li key={r.id}>
              <div
                onClick={() => navigate(`/ops/recibos/${r.id}`)}
                className="rounded-lg border px-3 py-2.5 cursor-pointer"
                style={{
                  backgroundColor: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                  opacity: r.anulado ? 0.6 : 1,
                }}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p
                        className="text-sm font-bold font-mono"
                        style={{ color: "hsl(var(--primary))" }}
                      >
                        #{r.numero}
                      </p>
                      {r.anulado && (
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-semibold"
                          style={{
                            backgroundColor: "hsl(var(--destructive) / 0.15)",
                            color: "hsl(var(--destructive))",
                          }}
                        >
                          Anulado
                        </span>
                      )}
                    </div>
                    <p
                      className="text-sm"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {r.cliente_nombre}
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {formatDate(r.fecha)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className="text-sm font-bold tabular-nums"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {formatCOP(r.monto_pagado)}
                    </p>
                    <p
                      className="text-[10px]"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      Total {formatCOP(r.total)}
                    </p>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
