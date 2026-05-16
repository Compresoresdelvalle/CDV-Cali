import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";
import ModalAbrirGarantiaCompra from "../../components/garantias/ModalAbrirGarantiaCompra";

/**
 * Detalle de una compra (Fase 13).
 *
 * Antes solo existía CompraHistorial; F13 introduce el detalle para poder
 * abrir garantías sobre compras ya recibidas.
 */
export default function CompraDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [compra, setCompra] = useState(null);
  const [items, setItems] = useState([]);
  const [garantias, setGarantias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalAbrir, setModalAbrir] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: c }, { data: d }, { data: g }] = await Promise.all([
        supabase
          .from("compras")
          .select(
            `id, numero, fecha, fecha_recepcion, proveedor, factura_proveedor,
             observaciones, subtotal, iva, total, recibida, estado, sede_destino_id,
             registrador:registrado_por(nombre)`,
          )
          .eq("id", id)
          .single(),
        supabase
          .from("detalle_compra")
          .select(
            `id, cantidad, costo_unitario, subtotal, producto_id,
             producto:producto_id(nombre, referencia, codigo_interno, unidad_medida)`,
          )
          .eq("compra_id", id),
        supabase
          .from("garantias_compra")
          .select("id, numero, fecha, resolucion, estado, motivo")
          .eq("compra_id", id)
          .order("fecha", { ascending: false }),
      ]);
      setCompra(c);
      setItems(d ?? []);
      setGarantias(g ?? []);
    } catch (e) {
      setError(safeError(e, "Error al cargar la compra"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (loading) {
    return (
      <div
        className="p-4 sm:p-6"
        style={{ backgroundColor: "hsl(var(--background))" }}
      >
        <div
          className="h-12 rounded-lg animate-pulse"
          style={{ backgroundColor: "hsl(var(--muted) / 0.4)" }}
        />
      </div>
    );
  }

  if (!compra) {
    return (
      <div className="p-4 sm:p-6 space-y-3">
        <p style={{ color: "hsl(var(--destructive))" }}>
          {error ?? "Compra no encontrada"}
        </p>
        <button
          onClick={() => navigate("/ops/compras")}
          className="text-sm px-4 py-2 rounded-lg border cursor-pointer"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          ← Volver
        </button>
      </div>
    );
  }

  const puedeAbrirGarantia = compra.recibida === true;

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title={`Compra #${compra.numero}`}
        description={`${compra.proveedor} · ${formatDate(compra.fecha)}`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={compra.recibida ? "recibida" : "pendiente"} />
            {compra.estado === "devolucion_garantia" && (
              <span
                className="px-2 py-0.5 rounded text-[10px] font-semibold"
                style={{
                  backgroundColor: "hsl(var(--warning) / 0.15)",
                  color: "hsl(var(--warning))",
                }}
              >
                🛡️ Garantía
              </span>
            )}
            <button
              onClick={() => navigate("/ops/compras")}
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

      {error && (
        <div
          role="alert"
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.08)",
            borderColor: "hsl(var(--destructive) / 0.4)",
            color: "hsl(var(--destructive))",
          }}
        >
          {error}
        </div>
      )}

      {/* Info general */}
      <div
        className="rounded-xl border p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <Info label="Proveedor" value={compra.proveedor} />
        <Info label="Factura" value={compra.factura_proveedor ?? "—"} />
        <Info
          label="Recepción"
          value={
            compra.fecha_recepcion
              ? formatDate(compra.fecha_recepcion)
              : "— pendiente"
          }
        />
        <Info label="Total" value={formatCOP(compra.total)} bold />
        {compra.observaciones && (
          <div className="col-span-2 md:col-span-4">
            <p
              className="text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Observaciones
            </p>
            <p style={{ color: "hsl(var(--foreground))" }}>
              {compra.observaciones}
            </p>
          </div>
        )}
      </div>

      {/* Items */}
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
          Items ({items.length})
        </div>
        <ul>
          {items.map((it, idx) => (
            <li
              key={it.id}
              className="px-4 py-3 flex justify-between gap-3"
              style={{
                borderTop:
                  idx === 0 ? "none" : "1px solid hsl(var(--border) / 0.5)",
              }}
            >
              <div className="min-w-0">
                <p
                  className="text-sm font-medium"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {it.producto?.nombre}
                </p>
                <p
                  className="text-xs font-mono"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {it.producto?.codigo_interno ?? it.producto?.referencia}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm">
                  {it.cantidad} × {formatCOP(it.costo_unitario)}
                </p>
                <p
                  className="text-xs font-bold"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {formatCOP(it.subtotal)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Acción: devolver al proveedor por garantía */}
      {puedeAbrirGarantia && (
        <div
          className="rounded-xl border p-4"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          <h3 className="text-sm font-semibold mb-2">Garantías</h3>
          <p
            className="text-xs mb-3"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            ¿Algún item llegó defectuoso? Abre una garantía para devolverlo al
            proveedor. Tres resoluciones: nota crédito, reposición física o
            pendiente.
          </p>
          <button
            onClick={() => setModalAbrir(true)}
            className="text-sm px-4 py-2 rounded-lg cursor-pointer min-h-[44px]"
            style={{
              backgroundColor: "hsl(var(--warning))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            🛡️ Devolver al proveedor por garantía
          </button>

          {garantias.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {garantias.map((g) => (
                <li
                  key={g.id}
                  className="rounded-lg border px-3 py-2 flex items-center justify-between gap-2 text-xs cursor-pointer"
                  style={{
                    backgroundColor: "hsl(var(--background))",
                    borderColor: "hsl(var(--border))",
                  }}
                  onClick={() => navigate(`/ops/garantias/compra/${g.id}`)}
                >
                  <span>
                    <strong>#{g.numero}</strong> · {g.resolucion} ·{" "}
                    {formatDate(g.fecha)}
                  </span>
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
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {modalAbrir && (
        <ModalAbrirGarantiaCompra
          compra={compra}
          items={items}
          onClose={() => setModalAbrir(false)}
          onCreated={(garantiaId) => {
            // Navegamos directo al detalle de la garantía; no recargamos
            // esta vista (evita setState sobre componente desmontado).
            setModalAbrir(false);
            navigate(`/ops/garantias/compra/${garantiaId}`);
          }}
        />
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
        className={bold ? "font-bold" : ""}
        style={{ color: "hsl(var(--foreground))" }}
      >
        {value}
      </p>
    </div>
  );
}
