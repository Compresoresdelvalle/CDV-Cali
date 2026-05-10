import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../../lib/utils";
import PageHeader from "../../../components/layout/PageHeader";

/**
 * Detalle de garantía de venta — F13 (vista read-only).
 * Muestra info de origen (venta o OT), resolución, OT de reparación si aplica.
 */
export default function GarantiaVentaDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [g, setG] = useState(null);
  const [detalles, setDetalles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const cargar = async () => {
      setLoading(true);
      try {
        const [{ data: gar }, { data: det }] = await Promise.all([
          supabase
            .from("garantias_venta")
            .select(
              `id, numero, fecha, resolucion, estado, motivo, monto_devuelto,
               venta:venta_id(id, numero, cliente_nombre, fecha, total),
               orden:orden_servicio_id(id, numero, cliente_nombre, fecha_entrega, total),
               ot_reparacion:ot_reparacion_id(id, numero, estado, tipo)`,
            )
            .eq("id", id)
            .single(),
          supabase
            .from("detalle_garantia_venta")
            .select(
              `id, cantidad, producto:producto_id(nombre, codigo_interno, referencia)`,
            )
            .eq("garantia_id", id),
        ]);
        setG(gar);
        setDetalles(det ?? []);
      } catch (err) {
        setErrorMsg(safeError(err, "Error al cargar garantía"));
      } finally {
        setLoading(false);
      }
    };
    cargar();
  }, [id]);

  if (loading) {
    return (
      <div className="p-4 sm:p-6">
        <div
          className="h-12 rounded-lg animate-pulse"
          style={{ backgroundColor: "hsl(var(--muted) / 0.4)" }}
        />
      </div>
    );
  }
  if (!g) {
    return (
      <div className="p-4 sm:p-6">
        <p style={{ color: "hsl(var(--destructive))" }}>
          {errorMsg || "Garantía no encontrada"}
        </p>
      </div>
    );
  }

  const origen = g.venta
    ? {
        tipo: "Venta",
        num: g.venta.numero,
        cliente: g.venta.cliente_nombre,
        route: `/ops/ventas/${g.venta.id}`,
      }
    : g.orden
      ? {
          tipo: "OT",
          num: g.orden.numero,
          cliente: g.orden.cliente_nombre,
          route: `/ops/ordenes/${g.orden.id}`,
        }
      : null;

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title={`Garantía venta #${g.numero}`}
        description={`${origen?.cliente ?? "—"} · ${formatDate(g.fecha)}`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
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
            <button
              onClick={() => navigate("/ops/garantias")}
              className="h-9 px-3 rounded-lg border text-sm font-medium cursor-pointer"
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

      <div
        className="rounded-xl border p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div>
          <p
            className="text-xs"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Origen
          </p>
          {origen && (
            <button
              onClick={() => navigate(origen.route)}
              className="text-sm cursor-pointer underline"
              style={{ color: "hsl(var(--primary))" }}
            >
              {origen.tipo} #{origen.num}
            </button>
          )}
        </div>
        <Info label="Resolución" value={g.resolucion} />
        {g.monto_devuelto != null && (
          <Info
            label="Monto devuelto"
            value={formatCOP(g.monto_devuelto)}
            bold
          />
        )}
        {g.ot_reparacion && (
          <div>
            <p
              className="text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              OT reparación
            </p>
            <button
              onClick={() => navigate(`/ops/ordenes/${g.ot_reparacion.id}`)}
              className="text-sm cursor-pointer underline"
              style={{ color: "hsl(var(--primary))" }}
            >
              #{g.ot_reparacion.numero} ({g.ot_reparacion.estado})
            </button>
          </div>
        )}
        {g.motivo && (
          <div className="col-span-2 md:col-span-4">
            <p
              className="text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Motivo
            </p>
            <p style={{ color: "hsl(var(--foreground))" }}>{g.motivo}</p>
          </div>
        )}
      </div>

      {detalles.length > 0 && (
        <div
          className="rounded-xl border overflow-hidden"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          <div
            className="px-4 py-3 border-b text-xs font-semibold uppercase tracking-wide"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
              backgroundColor: "hsl(var(--muted) / 0.3)",
            }}
          >
            Repuestos entregados ({detalles.length})
          </div>
          <ul>
            {detalles.map((d, idx) => (
              <li
                key={d.id}
                className="px-4 py-3 flex items-center gap-3"
                style={{
                  borderTop:
                    idx === 0 ? "none" : "1px solid hsl(var(--border) / 0.5)",
                }}
              >
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-medium"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {d.producto?.nombre}
                  </p>
                  <p
                    className="text-xs font-mono"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {d.producto?.codigo_interno ?? d.producto?.referencia}
                  </p>
                </div>
                <span className="text-sm">× {d.cantidad}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Info({ label, value, bold }) {
  return (
    <div>
      <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
        {label}
      </p>
      <p
        className={bold ? "font-bold text-sm" : "text-sm"}
        style={{ color: "hsl(var(--foreground))" }}
      >
        {value}
      </p>
    </div>
  );
}
