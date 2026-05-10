import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { formatDate, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";

const TABS = [
  { key: "stock", label: "Stock bajo / agotado" },
  { key: "herramientas", label: "Herramientas vencidas" },
  { key: "ordenes", label: "Órdenes esperando repuesto" },
  { key: "ot30dias", label: "OT > 30 días sin recoger" },
  // F12: Alertas de rotación (RPC fn_alertas_rotacion, periodo 30 días)
  { key: "sobre_stock", label: "Sobre-stock (sin movimiento)" },
  { key: "mayor_rotacion", label: "Mayor rotación" },
  { key: "menor_rotacion", label: "Menor rotación" },
];

export default function Alertas() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("stock");
  const [datos, setDatos] = useState({
    stock: [],
    herramientas: [],
    ordenes: [],
    ot30dias: [],
    sobre_stock: [],
    mayor_rotacion: [],
    menor_rotacion: [],
  });
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
      const [s, h, o, ot30, rot] = await Promise.all([
        supabase
          .from("inventario")
          .select(
            `cantidad, estado_stock, sede:sede_id(nombre), producto:producto_id(referencia, nombre, stock_minimo)`,
          )
          .in("estado_stock", ["Bajo", "Agotado"])
          .order("estado_stock", { ascending: false })
          .limit(200),
        supabase
          .from("herramientas_prestamo")
          .select(
            `id, herramienta_nombre, herramienta_codigo, fecha_devolucion_esperada, sede_id, usuario:prestada_a(nombre)`,
          )
          .eq("estado", "prestada")
          .lt("fecha_devolucion_esperada", new Date().toISOString())
          .order("fecha_devolucion_esperada", { ascending: true }),
        supabase
          .from("ordenes_servicio")
          .select(
            `id, numero, cliente_nombre, equipo_descripcion, fecha, sede_id, tecnico:tecnico_id(nombre)`,
          )
          .eq("estado", "esperando_repuesto")
          .order("fecha", { ascending: true }),
        // Fase 10 §10.4: OTs completadas hace > 30 días sin recoger
        supabase
          .from("v_ot_alertas_30_dias")
          .select(
            `id, numero, cliente_nombre, cliente_telefono, equipo_descripcion, fecha, sede_id, total_abonado`,
          )
          .order("fecha", { ascending: true }),
        // F12: alertas de rotación (RPC retorna las 3 categorías)
        supabase.rpc("fn_alertas_rotacion", { p_dias: 30, p_sede: null }),
      ]);
      if (!mountedRef.current) return;
      if (s.error) throw s.error;
      if (h.error) throw h.error;
      if (o.error) throw o.error;
      if (ot30.error) throw ot30.error;
      if (rot.error) throw rot.error;
      const rotData = rot.data ?? [];
      setDatos({
        stock: s.data ?? [],
        herramientas: h.data ?? [],
        ordenes: o.data ?? [],
        ot30dias: ot30.data ?? [],
        sobre_stock: rotData.filter((r) => r.categoria === "sobre_stock"),
        mayor_rotacion: rotData.filter((r) => r.categoria === "mayor_rotacion"),
        menor_rotacion: rotData.filter((r) => r.categoria === "menor_rotacion"),
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar alertas"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  const counts = {
    stock: datos.stock.length,
    herramientas: datos.herramientas.length,
    ordenes: datos.ordenes.length,
    ot30dias: datos.ot30dias.length,
    sobre_stock: datos.sobre_stock.length,
    mayor_rotacion: datos.mayor_rotacion.length,
    menor_rotacion: datos.menor_rotacion.length,
  };

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Alertas"
        description={
          loading
            ? "Cargando…"
            : `${counts.stock + counts.herramientas + counts.ordenes + counts.ot30dias} alertas activas`
        }
        actions={
          <button
            onClick={cargar}
            className="h-9 px-4 rounded-lg text-sm font-medium border cursor-pointer"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            ↻ Refrescar
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

      {/* Tabs con contador */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer flex items-center gap-2"
            style={
              tab === t.key
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
            {t.label}
            <span
              className="px-1.5 rounded text-xs font-bold tabular-nums"
              style={{
                backgroundColor:
                  counts[t.key] > 0
                    ? "hsl(var(--destructive))"
                    : "hsl(var(--muted))",
                color:
                  counts[t.key] > 0
                    ? "hsl(var(--destructive-foreground))"
                    : "hsl(var(--muted-foreground))",
              }}
            >
              {counts[t.key]}
            </span>
          </button>
        ))}
      </div>

      {/* Stock */}
      {tab === "stock" &&
        (datos.stock.length === 0 ? (
          <Empty icon="✅">No hay stock bajo ni agotado</Empty>
        ) : (
          <ul className="space-y-2" role="list">
            {datos.stock.map((s) => (
              <li
                key={`${s.producto?.referencia}-${s.sede?.nombre}`}
                className="rounded-lg border px-4 py-3 flex items-center justify-between gap-3"
                style={{
                  backgroundColor: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                }}
              >
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-medium"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {s.producto?.nombre}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    <span className="font-mono">{s.producto?.referencia}</span>{" "}
                    · {s.sede?.nombre} · mínimo: {s.producto?.stock_minimo}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <StatusBadge status={s.estado_stock} />
                  <p
                    className="text-sm font-bold tabular-nums mt-1"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {s.cantidad} uds
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ))}

      {/* Herramientas */}
      {tab === "herramientas" &&
        (datos.herramientas.length === 0 ? (
          <Empty icon="🔧">Sin herramientas vencidas</Empty>
        ) : (
          <ul className="space-y-2" role="list">
            {datos.herramientas.map((h) => {
              const dias = Math.floor(
                (new Date() - new Date(h.fecha_devolucion_esperada)) /
                  (1000 * 60 * 60 * 24),
              );
              return (
                <li
                  key={h.id}
                  className="rounded-lg border px-4 py-3"
                  style={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--destructive) / 0.4)",
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-medium"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {h.herramienta_nombre}
                      </p>
                      <p
                        className="text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {h.herramienta_codigo && (
                          <span className="font-mono">
                            {h.herramienta_codigo} ·{" "}
                          </span>
                        )}
                        Prestada a <strong>{h.usuario?.nombre ?? "—"}</strong>
                      </p>
                      <p
                        className="text-xs mt-0.5"
                        style={{ color: "hsl(var(--destructive))" }}
                      >
                        Vencida hace {dias} día{dias === 1 ? "" : "s"} (
                        {formatDate(h.fecha_devolucion_esperada)})
                      </p>
                    </div>
                    <button
                      onClick={() => navigate("/ops/herramientas")}
                      className="text-xs px-3 py-2 rounded-lg border cursor-pointer shrink-0"
                      style={{
                        borderColor: "hsl(var(--primary))",
                        color: "hsl(var(--primary))",
                      }}
                    >
                      Ver
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ))}

      {/* Órdenes */}
      {tab === "ordenes" &&
        (datos.ordenes.length === 0 ? (
          <Empty icon="🛠️">Sin órdenes esperando repuesto</Empty>
        ) : (
          <ul className="space-y-2" role="list">
            {datos.ordenes.map((o) => (
              <li
                key={o.id}
                className="rounded-lg border px-4 py-3"
                style={{
                  backgroundColor: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-xs font-bold font-mono"
                      style={{ color: "hsl(var(--primary))" }}
                    >
                      #{o.numero}
                    </p>
                    <p
                      className="text-sm font-medium"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {o.cliente_nombre}
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {o.equipo_descripcion} · {formatDate(o.fecha)} ·{" "}
                      {o.tecnico?.nombre}
                    </p>
                  </div>
                  <button
                    onClick={() => navigate(`/ops/ordenes/${o.id}`)}
                    className="text-xs px-3 py-2 rounded-lg border cursor-pointer shrink-0"
                    style={{
                      borderColor: "hsl(var(--primary))",
                      color: "hsl(var(--primary))",
                    }}
                  >
                    Abrir
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ))}

      {/* Fase 10 §10.4: OT > 30 días sin recoger */}
      {tab === "ot30dias" &&
        (datos.ot30dias.length === 0 ? (
          <Empty icon="📦">Sin OT pendientes de recogida</Empty>
        ) : (
          <ul className="space-y-2" role="list">
            {datos.ot30dias.map((o) => {
              const dias = Math.floor(
                (Date.now() - new Date(o.fecha).getTime()) /
                  (1000 * 60 * 60 * 24),
              );
              return (
                <li
                  key={o.id}
                  className="rounded-lg border px-4 py-3"
                  style={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--warning))",
                  }}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <p
                          className="text-xs font-bold font-mono"
                          style={{ color: "hsl(var(--primary))" }}
                        >
                          #{o.numero}
                        </p>
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-semibold"
                          style={{
                            backgroundColor: "hsl(var(--warning) / 0.15)",
                            color: "hsl(var(--warning))",
                          }}
                        >
                          {dias} días
                        </span>
                      </div>
                      <p
                        className="text-sm font-medium"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {o.cliente_nombre}
                        {o.cliente_telefono ? ` · ${o.cliente_telefono}` : ""}
                      </p>
                      <p
                        className="text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {o.equipo_descripcion} · Completada{" "}
                        {formatDate(o.fecha)}
                        {Number(o.total_abonado) > 0
                          ? ` · Abonado: ${Number(o.total_abonado).toLocaleString("es-CO")}`
                          : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => navigate(`/ops/ordenes/${o.id}`)}
                      className="text-xs px-3 py-2 rounded-lg border cursor-pointer shrink-0 min-h-[44px]"
                      style={{
                        borderColor: "hsl(var(--warning))",
                        color: "hsl(var(--warning))",
                      }}
                    >
                      Abrir OT
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ))}

      {/* F12: Sobre-stock (productos sin movimiento) */}
      {tab === "sobre_stock" &&
        (datos.sobre_stock.length === 0 ? (
          <Empty icon="📦">
            Sin productos con sobre-stock en los últimos 30 días.
          </Empty>
        ) : (
          <RotacionList
            items={datos.sobre_stock}
            navigate={navigate}
            modo="sobre_stock"
          />
        ))}

      {/* F12: Mayor rotación */}
      {tab === "mayor_rotacion" &&
        (datos.mayor_rotacion.length === 0 ? (
          <Empty icon="🔥">Sin movimientos en los últimos 30 días.</Empty>
        ) : (
          <RotacionList
            items={datos.mayor_rotacion}
            navigate={navigate}
            modo="mayor"
          />
        ))}

      {/* F12: Menor rotación */}
      {tab === "menor_rotacion" &&
        (datos.menor_rotacion.length === 0 ? (
          <Empty icon="🐢">Sin productos de menor rotación.</Empty>
        ) : (
          <RotacionList
            items={datos.menor_rotacion}
            navigate={navigate}
            modo="menor"
          />
        ))}
    </div>
  );
}

function RotacionList({ items, navigate, modo }) {
  return (
    <ul className="space-y-2">
      {items.map((r) => (
        <li
          key={`${modo}-${r.producto_id}-${r.sede_id}`}
          onClick={() => navigate(`/ops/inventario/${r.producto_id}`)}
          className="rounded-xl border px-4 py-3 cursor-pointer flex items-center justify-between gap-3"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          <div className="min-w-0 flex-1">
            <p
              className="text-sm font-semibold truncate"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {r.nombre}
            </p>
            <p
              className="text-xs font-mono"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {r.codigo_interno} · {r.sede_id}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p
              className="text-sm font-bold tabular-nums"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {r.ventas_periodo} vendidos
            </p>
            <p
              className="text-xs tabular-nums"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Stock: {r.stock_actual}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Empty({ icon, children }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-5xl mb-3">{icon}</div>
      <p style={{ color: "hsl(var(--muted-foreground))" }}>{children}</p>
    </div>
  );
}
