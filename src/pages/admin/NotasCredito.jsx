import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";

/**
 * Listado de notas crédito de proveedor — F13.
 * Admin ve todas; saldo_restante > 0 destacado.
 */
export default function NotasCredito() {
  const navigate = useNavigate();
  const [notas, setNotas] = useState([]);
  const [filtroSoloActivas, setFiltroSoloActivas] = useState(true);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const cargar = async () => {
      setLoading(true);
      setErrorMsg("");
      try {
        let q = supabase
          .from("notas_credito_proveedor")
          .select(
            `id, numero, proveedor, monto, saldo_restante, fecha, observaciones,
             garantia_compra_id`,
          )
          .order("fecha", { ascending: false })
          .limit(200);
        if (filtroSoloActivas) q = q.gt("saldo_restante", 0);
        const { data, error } = await q;
        if (error) throw error;
        setNotas(data ?? []);
      } catch (err) {
        setErrorMsg(safeError(err, "Error al cargar notas crédito"));
      } finally {
        setLoading(false);
      }
    };
    cargar();
  }, [filtroSoloActivas]);

  const totalSaldo = notas.reduce(
    (acc, n) => acc + Number(n.saldo_restante),
    0,
  );

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Notas crédito de proveedores"
        description="Saldos a favor pendientes de aplicar en próximas compras."
      />

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setFiltroSoloActivas((v) => !v)}
          className="h-9 px-3 rounded-lg text-sm font-medium border cursor-pointer"
          style={{
            backgroundColor: filtroSoloActivas
              ? "hsl(var(--primary))"
              : "hsl(var(--card))",
            color: filtroSoloActivas
              ? "hsl(var(--primary-foreground))"
              : "hsl(var(--foreground))",
            borderColor: "hsl(var(--border))",
          }}
        >
          {filtroSoloActivas ? "Solo con saldo" : "Todas (con/sin saldo)"}
        </button>
        <p
          className="text-sm"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Total saldo:{" "}
          <strong style={{ color: "hsl(var(--success))" }}>
            {formatCOP(totalSaldo)}
          </strong>
        </p>
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
      ) : notas.length === 0 ? (
        <p
          className="text-center py-8 text-sm"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Sin notas crédito{filtroSoloActivas ? " con saldo activo" : ""}.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {notas.map((n) => (
            <li
              key={n.id}
              className="rounded-lg border px-3 py-2.5"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p
                    className="text-sm font-bold font-mono"
                    style={{ color: "hsl(var(--primary))" }}
                  >
                    NC #{n.numero}
                  </p>
                  <p
                    className="text-sm font-medium"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {n.proveedor}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {formatDate(n.fecha)}
                    {n.garantia_compra_id && (
                      <>
                        {" · "}
                        <button
                          onClick={() =>
                            navigate(
                              `/ops/garantias/compra/${n.garantia_compra_id}`,
                            )
                          }
                          className="underline cursor-pointer"
                          style={{ color: "hsl(var(--primary))" }}
                        >
                          ver garantía origen
                        </button>
                      </>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className="text-xs"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    Monto: {formatCOP(n.monto)}
                  </p>
                  <p
                    className="text-base font-bold"
                    style={{
                      color:
                        Number(n.saldo_restante) > 0
                          ? "hsl(var(--success))"
                          : "hsl(var(--muted-foreground))",
                    }}
                  >
                    Saldo: {formatCOP(n.saldo_restante)}
                  </p>
                </div>
              </div>
              {n.observaciones && (
                <p
                  className="text-xs mt-1"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {n.observaciones}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
