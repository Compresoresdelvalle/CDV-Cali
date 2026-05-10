import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../../lib/utils";
import PageHeader from "../../../components/layout/PageHeader";

/**
 * Detalle de una garantía de compra — F13.
 * Muestra items reclamados, nota crédito asociada (si aplica), y permite
 * marcar reposición recibida cuando estado=reposicion_pendiente.
 */
export default function GarantiaCompraDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [garantia, setGarantia] = useState(null);
  const [detalles, setDetalles] = useState([]);
  const [notaCredito, setNotaCredito] = useState(null);
  const [seleccion, setSeleccion] = useState({}); // { detalle_id: true }
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const [{ data: g }, { data: d }, { data: n }] = await Promise.all([
        supabase
          .from("garantias_compra")
          .select(
            `id, numero, fecha, resolucion, estado, motivo, fecha_cierre,
             compra:compra_id(id, numero, proveedor, fecha)`,
          )
          .eq("id", id)
          .single(),
        supabase
          .from("detalle_garantia_compra")
          .select(
            `id, cantidad, costo_unitario, reposicion_recibida_at,
             producto:producto_id(nombre, codigo_interno, referencia)`,
          )
          .eq("garantia_id", id),
        supabase
          .from("notas_credito_proveedor")
          .select("id, numero, monto, saldo_restante, fecha, observaciones")
          .eq("garantia_compra_id", id)
          .maybeSingle(),
      ]);
      setGarantia(g);
      setDetalles(d ?? []);
      setNotaCredito(n);
    } catch (err) {
      setErrorMsg(safeError(err, "Error al cargar garantía"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const marcarReposicion = async () => {
    const seleccionados = detalles.filter(
      (d) => seleccion[d.id] && !d.reposicion_recibida_at,
    );
    if (seleccionados.length === 0) {
      setErrorMsg("Selecciona al menos un item para marcar recibido");
      return;
    }
    setSubmitting(true);
    setErrorMsg("");
    try {
      const { error } = await supabase.rpc("fn_marcar_reposicion_recibida", {
        p_garantia_id: id,
        p_items: seleccionados.map((d) => ({ detalle_id: d.id })),
      });
      if (error) throw error;
      setSeleccion({});
      await cargar();
    } catch (err) {
      setErrorMsg(safeError(err, "Error al marcar reposición"));
    } finally {
      setSubmitting(false);
    }
  };

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
  if (!garantia) {
    return (
      <div className="p-4 sm:p-6">
        <p style={{ color: "hsl(var(--destructive))" }}>
          Garantía no encontrada
        </p>
      </div>
    );
  }

  const puedeRecibir = garantia.estado === "reposicion_pendiente";
  const total = detalles.reduce(
    (acc, d) => acc + Number(d.cantidad) * Number(d.costo_unitario),
    0,
  );

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title={`Garantía compra #${garantia.numero}`}
        description={`${garantia.compra?.proveedor ?? "—"} · ${formatDate(garantia.fecha)}`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="px-2 py-0.5 rounded text-[10px] font-semibold"
              style={{
                backgroundColor: "hsl(var(--warning) / 0.15)",
                color: "hsl(var(--warning))",
              }}
            >
              {garantia.estado}
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

      <div
        className="rounded-xl border p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <Info
          label="Compra"
          value={
            <button
              onClick={() => navigate(`/ops/compras/${garantia.compra?.id}`)}
              className="text-primary underline cursor-pointer"
              style={{ color: "hsl(var(--primary))" }}
            >
              #{garantia.compra?.numero}
            </button>
          }
        />
        <Info label="Resolución" value={garantia.resolucion} />
        <Info label="Monto total" value={formatCOP(total)} bold />
        <Info
          label="Cierre"
          value={
            garantia.fecha_cierre ? formatDate(garantia.fecha_cierre) : "—"
          }
        />
        {garantia.motivo && (
          <div className="col-span-2 md:col-span-4">
            <p
              className="text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Motivo
            </p>
            <p style={{ color: "hsl(var(--foreground))" }}>{garantia.motivo}</p>
          </div>
        )}
      </div>

      {/* Nota crédito */}
      {notaCredito && (
        <div
          className="rounded-xl border p-4 space-y-1"
          style={{
            backgroundColor: "hsl(var(--success) / 0.06)",
            borderColor: "hsl(var(--success) / 0.4)",
          }}
        >
          <h3
            className="text-sm font-semibold"
            style={{ color: "hsl(var(--success))" }}
          >
            💳 Nota crédito #{notaCredito.numero}
          </h3>
          <p className="text-sm">
            Monto: <strong>{formatCOP(notaCredito.monto)}</strong> · Saldo
            disponible:{" "}
            <strong style={{ color: "hsl(var(--success))" }}>
              {formatCOP(notaCredito.saldo_restante)}
            </strong>
          </p>
          <p
            className="text-xs"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Aplicable en próximas compras al mismo proveedor (función disponible
            en módulo de compras).
          </p>
        </div>
      )}

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
          Items reclamados ({detalles.length})
        </div>
        <ul>
          {detalles.map((d, idx) => {
            const recibido = !!d.reposicion_recibida_at;
            return (
              <li
                key={d.id}
                className="px-4 py-3 flex items-center gap-3"
                style={{
                  borderTop:
                    idx === 0 ? "none" : "1px solid hsl(var(--border) / 0.5)",
                }}
              >
                {puedeRecibir && !recibido && (
                  <input
                    type="checkbox"
                    checked={!!seleccion[d.id]}
                    onChange={() =>
                      setSeleccion((p) => ({ ...p, [d.id]: !p[d.id] }))
                    }
                    className="cursor-pointer"
                  />
                )}
                <div className="min-w-0 flex-1">
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
                <div className="text-right">
                  <p className="text-sm">
                    {d.cantidad} × {formatCOP(d.costo_unitario)}
                  </p>
                  {recibido ? (
                    <p
                      className="text-[10px] font-semibold"
                      style={{ color: "hsl(var(--success))" }}
                    >
                      ✓ recibido {formatDate(d.reposicion_recibida_at)}
                    </p>
                  ) : puedeRecibir ? (
                    <p
                      className="text-[10px]"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      pendiente
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {puedeRecibir && (
        <button
          onClick={marcarReposicion}
          disabled={submitting}
          className="text-sm px-5 py-2 rounded-lg cursor-pointer min-h-[48px] disabled:opacity-50"
          style={{
            backgroundColor: "hsl(var(--success))",
            color: "hsl(var(--primary-foreground))",
          }}
        >
          {submitting
            ? "Procesando..."
            : "✓ Marcar items seleccionados como recibidos"}
        </button>
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
