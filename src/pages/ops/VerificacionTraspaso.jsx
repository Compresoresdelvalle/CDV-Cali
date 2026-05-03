import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";

const SEDE_LABELS = {
  "BOD-PRINCIPAL": "Bodega Principal",
  "ALM-01": "Almacén 01",
  "ALM-02": "Almacén 02",
  "ALM-03": "Almacén 03",
};

function sedeLabel(id) {
  return SEDE_LABELS[id] ?? id;
}

export default function VerificacionTraspaso() {
  const { id } = useParams();
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [traspaso, setTraspaso] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [verificando, setVerificando] = useState(false);
  const [error, setError] = useState(null);

  const esAdmin = perfil?.rol === "Admin";
  const esBodeguero = perfil?.rol === "Bodeguero";

  /* ── Cargar datos ─────────────────────────────────────────── */
  useEffect(() => {
    const cargar = async () => {
      setLoading(true);
      try {
        const [{ data: t, error: errT }, { data: d, error: errD }] =
          await Promise.all([
            supabase
              .from("traspasos")
              .select(
                `id, numero, estado, picker_id, sede_origen_id, sede_destino_id,
                 picker:picker_id(nombre)`,
              )
              .eq("id", id)
              .single(),
            supabase
              .from("detalle_traspaso")
              .select(
                `id, cantidad_solicitada, cantidad_enviada, picking_completado,
                 producto:producto_id(nombre, referencia, unidad_medida),
                 ubicacion:ubicacion_origen_id(pasillo, estante, nivel)`,
              )
              .eq("traspaso_id", id)
              .order("created_at"),
          ]);

        if (errT || !t) throw new Error("Traspaso no encontrado");
        if (errD) throw new Error(errD.message);

        // Solo Admin o Bodeguero que NO sea el picker puede verificar
        if (!esAdmin && !esBodeguero) {
          navigate(`/ops/traspasos/${id}`, { replace: true });
          return;
        }
        if (t.picker_id === perfil?.id && !esAdmin) {
          navigate(`/ops/traspasos/${id}`, { replace: true });
          return;
        }

        setTraspaso(t);
        setItems(d ?? []);
      } catch (e) {
        setError(safeError(e, "Error en verificación de traspaso"));
      } finally {
        setLoading(false);
      }
    };

    cargar();
  }, [id, perfil, navigate, esAdmin, esBodeguero]);

  /* ── Acción: verificar ────────────────────────────────────── */
  const verificar = async () => {
    setVerificando(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc("fn_procesar_traspaso", {
        p_traspaso_id: id,
        p_accion: "verificar",
        p_items: null,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      navigate(`/ops/traspasos/${id}`);
    } catch (e) {
      setError(safeError(e, "Error en verificación de traspaso"));
    } finally {
      setVerificando(false);
    }
  };

  if (loading) return <LoadingView />;
  if (!traspaso)
    return <NotFoundView onBack={() => navigate(`/ops/traspasos/${id}`)} />;

  // Validación frontend: todos los items deben estar pickeados
  const totalItems = items.length;
  const itemsCompletos = items.filter((i) => i.picking_completado).length;
  const pickingOk = totalItems > 0 && itemsCompletos === totalItems;

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in pb-36"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title={`Verificar #${traspaso.numero}`}
        description={`${sedeLabel(traspaso.sede_origen_id)} → ${sedeLabel(traspaso.sede_destino_id)}`}
        actions={
          <button
            onClick={() => navigate(`/ops/traspasos/${id}`)}
            className="h-9 px-3 rounded-lg border text-sm font-medium cursor-pointer"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
              backgroundColor: "hsl(var(--card))",
            }}
          >
            ← Volver
          </button>
        }
      />

      {/* Banner de contexto */}
      <div
        className="p-4 rounded-xl border"
        style={{
          backgroundColor: "hsl(var(--info) / 0.06)",
          borderColor: "hsl(var(--info) / 0.25)",
        }}
      >
        <div className="flex items-start gap-3">
          <span className="text-xl">✅</span>
          <div>
            <p
              className="text-sm font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Verificación de picking
            </p>
            <p
              className="text-xs mt-0.5"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Pickeado por <strong>{traspaso.picker?.nombre ?? "—"}</strong>.
              Revisa las cantidades y confirma si todo está correcto.
            </p>
          </div>
        </div>
      </div>

      {/* Estado del picking */}
      {!pickingOk && (
        <div
          className="p-3 rounded-lg border text-sm"
          style={{
            backgroundColor: "hsl(var(--warning) / 0.08)",
            borderColor: "hsl(var(--warning) / 0.3)",
            color: "hsl(var(--warning))",
          }}
        >
          ⚠️ El picking no está completo ({itemsCompletos}/{totalItems} items).
          El picker debe terminar antes de verificar.
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="p-3 rounded-lg border text-sm"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.08)",
            borderColor: "hsl(var(--destructive) / 0.3)",
            color: "hsl(var(--destructive))",
          }}
        >
          {error}
        </div>
      )}

      {/* Tabla de items — Desktop */}
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
                "Referencia",
                "Ubicación",
                "Solicitado",
                "Enviado",
                "Estado",
              ].map((col) => (
                <th
                  key={col}
                  className="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-left whitespace-nowrap"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const loc = item.ubicacion;
              const ubicCode = loc
                ? `${loc.pasillo}-${loc.estante}-${loc.nivel}`
                : "—";
              const diferencia =
                (item.cantidad_enviada ?? 0) - item.cantidad_solicitada;

              return (
                <tr
                  key={item.id}
                  style={{
                    borderTop:
                      idx === 0 ? "none" : "1px solid hsl(var(--border) / 0.5)",
                    backgroundColor: item.picking_completado
                      ? "transparent"
                      : "hsl(var(--warning) / 0.04)",
                  }}
                >
                  <td className="px-3 py-3.5">
                    <p
                      className="text-sm font-medium"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {item.producto?.nombre ?? "—"}
                    </p>
                  </td>
                  <td className="px-3 py-3.5">
                    <span
                      className="text-xs font-mono"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {item.producto?.referencia ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-3.5">
                    <span
                      className="text-xs font-mono font-bold px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: "hsl(var(--primary) / 0.08)",
                        color: "hsl(var(--primary))",
                      }}
                    >
                      {ubicCode}
                    </span>
                  </td>
                  <td className="px-3 py-3.5 text-center">
                    <span
                      className="text-sm font-medium"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {item.cantidad_solicitada}
                    </span>
                  </td>
                  <td className="px-3 py-3.5 text-center">
                    <span
                      className="text-sm font-bold"
                      style={{
                        color:
                          diferencia !== 0
                            ? "hsl(var(--warning))"
                            : "hsl(var(--foreground))",
                      }}
                    >
                      {item.cantidad_enviada ?? "—"}
                    </span>
                    {diferencia !== 0 && item.cantidad_enviada != null && (
                      <span
                        className="ml-1 text-xs"
                        style={{ color: "hsl(var(--warning))" }}
                      >
                        ({diferencia > 0 ? "+" : ""}
                        {diferencia})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3.5">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={
                        item.picking_completado
                          ? {
                              backgroundColor: "hsl(var(--success) / 0.12)",
                              color: "hsl(var(--success))",
                            }
                          : {
                              backgroundColor: "hsl(var(--warning) / 0.12)",
                              color: "hsl(var(--warning))",
                            }
                      }
                    >
                      {item.picking_completado ? "✓ Pickeado" : "Pendiente"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Cards de items — Mobile */}
      <ul className="md:hidden space-y-2.5" role="list">
        {items.map((item) => {
          const loc = item.ubicacion;
          const ubicCode = loc
            ? `${loc.pasillo}-${loc.estante}-${loc.nivel}`
            : null;
          const diferencia =
            item.cantidad_enviada != null
              ? item.cantidad_enviada - item.cantidad_solicitada
              : null;

          return (
            <li key={item.id}>
              <div
                className="rounded-xl px-4 py-4 border"
                style={{
                  backgroundColor: item.picking_completado
                    ? "hsl(var(--card))"
                    : "hsl(var(--warning) / 0.05)",
                  borderColor: item.picking_completado
                    ? "hsl(var(--border))"
                    : "hsl(var(--warning) / 0.3)",
                }}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <p
                    className="text-sm font-semibold flex-1 min-w-0"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {item.producto?.nombre ?? "—"}
                  </p>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0"
                    style={
                      item.picking_completado
                        ? {
                            backgroundColor: "hsl(var(--success) / 0.12)",
                            color: "hsl(var(--success))",
                          }
                        : {
                            backgroundColor: "hsl(var(--warning) / 0.12)",
                            color: "hsl(var(--warning))",
                          }
                    }
                  >
                    {item.picking_completado ? "✓ Pickeado" : "Pendiente"}
                  </span>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <span
                    className="text-xs"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {item.producto?.referencia}
                  </span>
                  {ubicCode && (
                    <span
                      className="text-xs font-mono font-bold px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: "hsl(var(--primary) / 0.08)",
                        color: "hsl(var(--primary))",
                      }}
                    >
                      {ubicCode}
                    </span>
                  )}
                </div>

                <div
                  className="mt-2 flex items-center gap-4 text-xs"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  <span>
                    Solicitado:{" "}
                    <strong style={{ color: "hsl(var(--foreground))" }}>
                      {item.cantidad_solicitada}
                    </strong>
                  </span>
                  <span>
                    Enviado:{" "}
                    <strong
                      style={{
                        color:
                          diferencia !== null && diferencia !== 0
                            ? "hsl(var(--warning))"
                            : "hsl(var(--foreground))",
                      }}
                    >
                      {item.cantidad_enviada ?? "—"}
                    </strong>
                    {diferencia !== null && diferencia !== 0 && (
                      <span style={{ color: "hsl(var(--warning))" }}>
                        {" "}
                        ({diferencia > 0 ? "+" : ""}
                        {diferencia})
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Barra de acción fija */}
      <div
        className="fixed bottom-0 left-0 right-0 p-4 border-t"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div className="max-w-xl mx-auto space-y-2">
          {pickingOk ? (
            <p
              className="text-xs text-center"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Todos los items fueron pickeados. Al verificar el traspaso pasará
              a estado <strong>Verificado</strong>.
            </p>
          ) : (
            <p
              className="text-xs text-center"
              style={{ color: "hsl(var(--warning))" }}
            >
              El picking no está completo. No es posible verificar aún.
            </p>
          )}
          <button
            onClick={verificar}
            disabled={!pickingOk || verificando}
            className="w-full h-12 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-40 cursor-pointer"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
            onMouseEnter={(e) =>
              pickingOk &&
              !verificando &&
              (e.currentTarget.style.opacity = "0.9")
            }
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            {verificando ? "Verificando…" : "✓ Confirmar verificación"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LoadingView() {
  return (
    <div
      className="p-4 sm:p-6 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="h-20 rounded-xl animate-pulse"
            style={{ backgroundColor: "hsl(var(--muted))" }}
          />
        ))}
      </div>
    </div>
  );
}

function NotFoundView({ onBack }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="text-5xl mb-4">🔄</div>
      <p
        className="font-semibold mb-4"
        style={{ color: "hsl(var(--foreground))" }}
      >
        Traspaso no encontrado
      </p>
      <button
        onClick={onBack}
        className="px-4 h-9 rounded-lg text-sm font-medium cursor-pointer"
        style={{
          backgroundColor: "hsl(var(--primary))",
          color: "hsl(var(--primary-foreground))",
        }}
      >
        Volver
      </button>
    </div>
  );
}
