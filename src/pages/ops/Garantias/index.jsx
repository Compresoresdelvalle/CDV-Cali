import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabase";
import { formatDate, safeError } from "../../../lib/utils";
import PageHeader from "../../../components/layout/PageHeader";

/**
 * Listado de garantías — F13.
 * Dos tabs: Compras (al proveedor) y Ventas (cliente).
 */
export default function GarantiasIndex() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("compra"); // compra | venta
  const [filtroEstado, setFiltroEstado] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const cargar = async () => {
      setLoading(true);
      setErrorMsg("");
      try {
        if (tab === "compra") {
          let q = supabase
            .from("garantias_compra")
            .select(
              `id, numero, fecha, resolucion, estado, motivo,
               compra:compra_id(numero, proveedor)`,
            )
            .order("fecha", { ascending: false })
            .limit(200);
          if (filtroEstado) q = q.eq("estado", filtroEstado);
          const { data, error } = await q;
          if (error) throw error;
          setItems(data ?? []);
        } else {
          let q = supabase
            .from("garantias_venta")
            .select(
              `id, numero, fecha, resolucion, estado, motivo, monto_devuelto,
               venta:venta_id(numero, cliente_nombre),
               orden:orden_servicio_id(numero, cliente_nombre),
               ot_reparacion:ot_reparacion_id(numero)`,
            )
            .order("fecha", { ascending: false })
            .limit(200);
          if (filtroEstado) q = q.eq("estado", filtroEstado);
          const { data, error } = await q;
          if (error) throw error;
          setItems(data ?? []);
        }
      } catch (err) {
        setErrorMsg(safeError(err, "Error al cargar garantías"));
      } finally {
        setLoading(false);
      }
    };
    cargar();
  }, [tab, filtroEstado]);

  const estadosCompra = [
    "abierta",
    "nota_credito_emitida",
    "reposicion_pendiente",
    "reposicion_recibida",
    "cerrada",
  ];
  const estadosVenta = ["abierta", "cerrada"];

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Garantías"
        description="Devoluciones a proveedores y reclamos de clientes."
      />

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          { v: "compra", label: "🛡️ De compras (al proveedor)" },
          { v: "venta", label: "🤝 De ventas (cliente reclama)" },
        ].map((t) => (
          <button
            key={t.v}
            onClick={() => {
              setTab(t.v);
              setFiltroEstado("");
            }}
            className="h-9 px-4 rounded-lg text-sm font-medium border cursor-pointer"
            style={{
              backgroundColor:
                tab === t.v ? "hsl(var(--primary))" : "hsl(var(--card))",
              color:
                tab === t.v
                  ? "hsl(var(--primary-foreground))"
                  : "hsl(var(--foreground))",
              borderColor:
                tab === t.v ? "hsl(var(--primary))" : "hsl(var(--border))",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filtro estado */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setFiltroEstado("")}
          className="px-3 h-8 rounded-lg text-xs font-medium border cursor-pointer"
          style={{
            backgroundColor: filtroEstado
              ? "hsl(var(--card))"
              : "hsl(var(--primary))",
            color: filtroEstado
              ? "hsl(var(--foreground))"
              : "hsl(var(--primary-foreground))",
            borderColor: "hsl(var(--border))",
          }}
        >
          Todos
        </button>
        {(tab === "compra" ? estadosCompra : estadosVenta).map((e) => (
          <button
            key={e}
            onClick={() => setFiltroEstado(e)}
            className="px-3 h-8 rounded-lg text-xs font-medium border cursor-pointer"
            style={{
              backgroundColor:
                filtroEstado === e ? "hsl(var(--primary))" : "hsl(var(--card))",
              color:
                filtroEstado === e
                  ? "hsl(var(--primary-foreground))"
                  : "hsl(var(--foreground))",
              borderColor: "hsl(var(--border))",
            }}
          >
            {e}
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
      ) : items.length === 0 ? (
        <p
          className="text-center py-8 text-sm"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Sin garantías {filtroEstado ? `en estado ${filtroEstado}` : ""}.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((g) => (
            <li
              key={g.id}
              onClick={() => navigate(`/ops/garantias/${tab}/${g.id}`)}
              className="rounded-lg border px-3 py-2.5 cursor-pointer transition-all"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <p
                    className="text-sm font-bold font-mono"
                    style={{ color: "hsl(var(--primary))" }}
                  >
                    #{g.numero}
                  </p>
                  <p
                    className="text-sm"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {tab === "compra"
                      ? `Compra #${g.compra?.numero ?? "?"} · ${g.compra?.proveedor ?? "—"}`
                      : g.venta
                        ? `Venta #${g.venta.numero} · ${g.venta.cliente_nombre ?? "—"}`
                        : `OT #${g.orden?.numero} · ${g.orden?.cliente_nombre ?? "—"}`}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {g.resolucion} · {formatDate(g.fecha)}
                  </p>
                </div>
                <span
                  className="px-2 py-0.5 rounded text-[10px] font-semibold"
                  style={{
                    backgroundColor:
                      g.estado === "cerrada"
                        ? "hsl(var(--success) / 0.15)"
                        : "hsl(var(--warning) / 0.15)",
                    color:
                      g.estado === "cerrada"
                        ? "hsl(var(--success))"
                        : "hsl(var(--warning))",
                  }}
                >
                  {g.estado}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
