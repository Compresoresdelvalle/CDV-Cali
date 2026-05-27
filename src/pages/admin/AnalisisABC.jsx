import { useState, useEffect, useRef, useMemo } from "react";
import { RefreshCw, Package, TrendingUp } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCOP, safeError } from "../../lib/utils";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import {
  abcBadgeStyle,
  PERIODOS_RANKING,
  labelPeriodoRanking,
} from "../../lib/admin-analytics-ui";

const COLS =
  "grid-cols-[58px_120px_minmax(0,1fr)_110px_84px_84px_minmax(200px,1fr)]";

/* Sugerencia operativa derivada de la clase ABC (texto fijo por clase, no un
 * número inventado). Refleja la política de control de inventario por clase. */
const SUGERENCIA_CLASE = {
  A: "Alto valor · control estricto · revisar contrato proveedor",
  B: "Valor medio · control moderado · mantener",
  C: "Cola larga · control simple · candidato a liquidar",
};

/* ── Análisis ABC (datos reales: productos + fn_top_productos + RPC) ───── */
export default function AnalisisABC() {
  const [productos, setProductos] = useState([]);
  // Ventas por producto en el periodo (real, vía fn_top_productos).
  const [ventasMap, setVentasMap] = useState(() => new Map());
  const [loading, setLoading] = useState(true);
  const [recalculando, setRecalculando] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [filtro, setFiltro] = useState("Todos");
  const [periodo, setPeriodo] = useState(90);
  const mountedRef = useRef(true);
  const { confirm, ConfirmDialog } = useConfirm();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const cargar = async (dias = periodo) => {
    setLoading(true);
    setErrorMsg("");
    try {
      const [prodRes, topRes] = await Promise.all([
        supabase
          .from("productos")
          .select(
            "id, referencia, nombre, categoria, clasificacion, precio_venta, costo_promedio",
          )
          .eq("activo", true)
          .order("clasificacion", { ascending: true })
          .order("nombre", { ascending: true }),
        // Ventas reales del periodo para enriquecer la clasificación.
        supabase.rpc("fn_top_productos", { p_dias: dias, p_limit: 3000 }),
      ]);
      if (!mountedRef.current) return;
      if (prodRes.error) throw prodRes.error;
      if (topRes.error) throw topRes.error;
      const map = new Map();
      (topRes.data ?? []).forEach((t) =>
        map.set(t.producto_id, {
          ventas: Number(t.total_vendido),
          unidades: Number(t.unidades_vendidas),
        }),
      );
      setProductos(prodRes.data ?? []);
      setVentasMap(map);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar productos"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const recalcular = async () => {
    const ok = await confirm({
      titulo: "Recalcular clasificación ABC",
      mensaje:
        "Reclasifica TODOS los productos según ventas de los últimos 90 días. Puede tardar varios segundos.",
      confirmLabel: "Recalcular",
    });
    if (!ok) return;
    setRecalculando(true);
    setErrorMsg("");
    setOkMsg("");
    try {
      // Timeout duro 30s — recalcular ABC sobre 3000 productos puede tardar
      const { error } = await Promise.race([
        supabase.rpc("fn_recalcular_abc"),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  "Timeout: el recálculo tarda más de 30s, contacta soporte",
                ),
              ),
            30000,
          ),
        ),
      ]);
      if (!mountedRef.current) return;
      if (error) throw error;
      setOkMsg("Clasificación ABC recalculada correctamente");
      await cargar();
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al recalcular"));
    } finally {
      if (mountedRef.current) setRecalculando(false);
    }
  };

  useEffect(() => {
    cargar(periodo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo]);

  // Filas enriquecidas con ventas/unidades del periodo, ordenadas por ventas
  // descendente y con % acumulado sobre el total clasificado (modelo Lovable).
  const filas = useMemo(() => {
    const conVentas = productos.map((p) => {
      const v = ventasMap.get(p.id) ?? { ventas: 0, unidades: 0 };
      return { ...p, ventas: v.ventas, unidades: v.unidades };
    });
    conVentas.sort((a, b) => b.ventas - a.ventas);
    const totalVentas = conVentas.reduce((s, p) => s + p.ventas, 0) || 1;
    let acum = 0;
    return conVentas.map((p) => {
      acum += p.ventas;
      return { ...p, pctAcum: (acum / totalVentas) * 100 };
    });
  }, [productos, ventasMap]);

  const filtrados =
    filtro === "Todos"
      ? filas
      : filas.filter((p) => p.clasificacion === filtro);

  const counts = {
    A: productos.filter((p) => p.clasificacion === "A").length,
    B: productos.filter((p) => p.clasificacion === "B").length,
    C: productos.filter((p) => p.clasificacion === "C").length,
  };

  // Reparto de ventas por clase (modelo Lovable: % de ingresos por clase).
  const ventasPorClase = useMemo(() => {
    const acc = { A: 0, B: 0, C: 0, total: 0 };
    filas.forEach((p) => {
      acc.total += p.ventas;
      if (p.clasificacion === "A") acc.A += p.ventas;
      else if (p.clasificacion === "B") acc.B += p.ventas;
      else if (p.clasificacion === "C") acc.C += p.ventas;
    });
    return acc;
  }, [filas]);

  const pctVentas = (v) =>
    ventasPorClase.total > 0
      ? `${Math.round((v / ventasPorClase.total) * 100)}%`
      : "—";

  const TABS = [
    { id: "Todos", label: "Todas", count: productos.length },
    { id: "A", label: "Clase A", count: counts.A },
    { id: "B", label: "Clase B", count: counts.B },
    { id: "C", label: "Clase C", count: counts.C },
  ];

  return (
    <div className="flex flex-col gap-6 px-5 pb-8 pt-6 sm:px-7 animate-fade-in">
      {/* Page head */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="m-0 mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Admin · Clasificación de productos
          </p>
          <h1
            className="m-0 text-[24px] font-semibold leading-tight tracking-[-0.018em]"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Análisis ABC
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Seg
            options={PERIODOS_RANKING.map((p) => p.label)}
            value={labelPeriodoRanking(periodo)}
            onChange={(label) =>
              setPeriodo(
                PERIODOS_RANKING.find((p) => p.label === label)?.dias ?? 90,
              )
            }
          />
          <button
            onClick={recalcular}
            disabled={recalculando || loading}
            className="inline-flex h-12 items-center gap-1.5 rounded-md px-4 text-[12.5px] font-semibold transition-colors cursor-pointer disabled:opacity-60"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${recalculando ? "animate-spin" : ""}`}
              strokeWidth={1.75}
            />
            {recalculando ? "Recalculando…" : "Recalcular ABC"}
          </button>
        </div>
      </div>

      {errorMsg && <Alert tone="destructive">{errorMsg}</Alert>}
      {okMsg && <Alert tone="success">{okMsg}</Alert>}

      {/* KPI strip */}
      <div
        className="grid grid-cols-2 gap-y-4 border-b pb-5 pt-1 md:grid-cols-4 md:gap-y-0"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <Kpi
          label={`Ingresos · ${labelPeriodoRanking(periodo).toLowerCase()}`}
          value={formatCOP(ventasPorClase.total)}
          sub={`${productos.length.toLocaleString("es-CO")} SKUs clasificados`}
        />
        <Kpi
          label="Clase A · alto valor"
          value={pctVentas(ventasPorClase.A)}
          token="--success"
          sub={`${counts.A} SKUs · ${formatCOP(ventasPorClase.A)}`}
        />
        <Kpi
          label="Clase B · medio"
          value={pctVentas(ventasPorClase.B)}
          token="--warning"
          sub={`${counts.B} SKUs · control moderado`}
        />
        <Kpi
          last
          label="Clase C · cola larga"
          value={pctVentas(ventasPorClase.C)}
          token="--destructive"
          sub={`${counts.C} SKUs · candidatos a liquidar`}
        />
      </div>

      {/* Tabs de filtro */}
      <div
        className="flex flex-wrap items-center gap-1.5 border-b"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        {TABS.map((t) => {
          const on = t.id === filtro;
          return (
            <button
              key={t.id}
              onClick={() => setFiltro(t.id)}
              className="inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 pt-1 text-[12.5px] font-medium transition-colors cursor-pointer"
              style={{
                borderColor: on ? "hsl(var(--primary))" : "transparent",
                color: on
                  ? "hsl(var(--foreground))"
                  : "hsl(var(--muted-foreground))",
              }}
            >
              {t.label}
              <span
                className="rounded-[3px] border px-1.5 py-px font-mono text-[10.5px] font-semibold leading-[1.4] tabular-nums"
                style={{
                  backgroundColor: on
                    ? "hsl(var(--primary) / 0.12)"
                    : "hsl(var(--muted) / 0.4)",
                  borderColor: on
                    ? "hsl(var(--primary) / 0.4)"
                    : "hsl(var(--border))",
                  color: on
                    ? "hsl(var(--primary))"
                    : "hsl(var(--muted-foreground))",
                }}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Lista / Tabla */}
      {loading ? (
        <SkeletonList />
      ) : filtrados.length === 0 ? (
        <Empty icon="📦">Sin productos en categoría {filtro}</Empty>
      ) : (
        <section
          className="overflow-hidden rounded-[10px] border"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          {/* Desktop tabla */}
          <div className="hidden md:block overflow-x-auto">
            <div
              className={`grid ${COLS} items-center gap-3 border-b px-[18px] py-2 font-mono text-[10.5px] uppercase tracking-[0.06em]`}
              style={{
                borderColor: "hsl(var(--border))",
                backgroundColor: "hsl(var(--muted) / 0.3)",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              <span>#</span>
              <span>Referencia</span>
              <span>Producto · categoría</span>
              <span className="text-right">Ventas</span>
              <span className="text-right">Unidades</span>
              <span className="text-right">% acum.</span>
              <span>Sugerencia</span>
            </div>
            {filtrados.map((p, i) => (
              <div
                key={p.id}
                className={`grid ${COLS} items-center gap-3 border-b px-[18px] py-2.5 text-[12.5px] last:border-b-0`}
                style={{ borderColor: "hsl(var(--border))" }}
              >
                <span className="flex items-center gap-1.5 font-mono text-[11px]">
                  <span
                    className="w-4 text-right tabular-nums"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {i + 1}
                  </span>
                  <span
                    className="grid h-5 w-5 place-items-center rounded-[4px] border text-[10.5px] font-bold"
                    style={abcBadgeStyle(p.clasificacion)}
                  >
                    {p.clasificacion ?? "—"}
                  </span>
                </span>
                <span
                  className="rounded-[3px] border px-1.5 py-0.5 text-center font-mono text-[11px] font-medium"
                  style={{
                    borderColor: "hsl(var(--border))",
                    backgroundColor: "hsl(var(--muted) / 0.3)",
                    color: "hsl(var(--foreground))",
                  }}
                >
                  {p.referencia}
                </span>
                <div className="flex min-w-0 items-center gap-2">
                  <Package
                    className="h-3.5 w-3.5 shrink-0"
                    strokeWidth={1.5}
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span
                      className="truncate font-medium"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {p.nombre}
                    </span>
                    <span
                      className="truncate font-mono text-[10.5px] tracking-[0.04em]"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {p.categoria}
                    </span>
                  </div>
                </div>
                <span
                  className="text-right font-mono text-[12px] font-semibold tabular-nums"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {formatCOP(p.ventas)}
                </span>
                <span
                  className="text-right font-mono text-[12px] tabular-nums"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {p.unidades.toLocaleString("es-CO")}
                </span>
                <span
                  className="text-right font-mono text-[12px] tabular-nums"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {p.pctAcum.toFixed(1)}%
                </span>
                <span
                  className="flex items-center gap-1.5 text-[11.5px]"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  <TrendingUp
                    className="h-3 w-3 shrink-0"
                    strokeWidth={1.5}
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  />
                  {SUGERENCIA_CLASE[p.clasificacion] ?? "Sin clasificar"}
                </span>
              </div>
            ))}
          </div>

          {/* Mobile cards */}
          <ul className="md:hidden divide-y" role="list">
            {filtrados.map((p, i) => (
              <li
                key={p.id}
                className="px-4 py-3"
                style={{ borderColor: "hsl(var(--border))" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-md border text-xs font-bold"
                      style={abcBadgeStyle(p.clasificacion)}
                    >
                      {p.clasificacion ?? "—"}
                    </span>
                    <div className="min-w-0">
                      <p
                        className="truncate text-sm font-medium"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {p.nombre}
                      </p>
                      <p
                        className="truncate font-mono text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {p.referencia} · {p.categoria}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className="text-sm font-bold tabular-nums"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {formatCOP(p.ventas)}
                    </p>
                    <p
                      className="font-mono text-[10.5px] tabular-nums"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      #{i + 1} · {p.pctAcum.toFixed(1)}% acum.
                    </p>
                  </div>
                </div>
                <p
                  className="mt-2 flex items-center gap-1.5 text-[11.5px]"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  <TrendingUp className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                  {SUGERENCIA_CLASE[p.clasificacion] ?? "Sin clasificar"}
                </p>
              </li>
            ))}
          </ul>

          <footer
            className="flex flex-wrap items-center justify-between gap-2 border-t px-[18px] py-3 font-mono text-[10.5px] tracking-[0.06em]"
            style={{
              borderColor: "hsl(var(--border))",
              backgroundColor: "hsl(var(--muted) / 0.3)",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            <span>
              {filtrados.length} SKUs · ordenados por ventas descendente
            </span>
            <span>
              Ventas reales de {labelPeriodoRanking(periodo).toLowerCase()} ·
              clase recalculada sobre 90 días · timeout 30s
            </span>
          </footer>
        </section>
      )}
      <ConfirmDialog />
    </div>
  );
}

/* ── Segmented control (estilo Dashboard admin) ───────────────────────── */
function Seg({ options, value, onChange }) {
  return (
    <div
      className="inline-flex gap-px rounded-[7px] border p-0.5"
      style={{
        borderColor: "hsl(var(--border))",
        backgroundColor: "hsl(var(--muted) / 0.4)",
      }}
    >
      {options.map((opt) => {
        const on = opt === value;
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className="rounded-[5px] px-2.5 py-1.5 text-[12px] transition-colors cursor-pointer"
            style={{
              backgroundColor: on ? "hsl(var(--card))" : "transparent",
              color: on
                ? "hsl(var(--foreground))"
                : "hsl(var(--muted-foreground))",
              fontWeight: on ? 600 : 500,
              boxShadow: on ? "0 1px 2px rgba(16,24,40,0.06)" : "none",
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

/* ── KPI con separadores punteados ────────────────────────────────────── */
function Kpi({ label, value, sub, token, last }) {
  return (
    <div
      className={`flex flex-col gap-1.5 pr-7 md:pl-7 md:first:pl-0 ${
        last ? "" : "md:border-r md:border-dashed"
      }`}
      style={last ? undefined : { borderColor: "hsl(var(--border))" }}
    >
      <div
        className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </div>
      <div
        className="font-mono text-[22px] font-semibold leading-tight tracking-[-0.02em] tabular-nums"
        style={{
          color: token ? `hsl(var(${token}))` : "hsl(var(--foreground))",
        }}
      >
        {value}
      </div>
      <div
        className="text-[11.5px]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {sub}
      </div>
    </div>
  );
}

function Alert({ tone, children }) {
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs"
      style={{
        backgroundColor: `hsl(var(--${tone}) / 0.08)`,
        borderColor: `hsl(var(--${tone}) / 0.4)`,
        color: `hsl(var(--${tone}))`,
      }}
    >
      {children}
    </div>
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

function SkeletonList() {
  return (
    <div className="space-y-2">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="h-14 animate-pulse rounded-xl border"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        />
      ))}
    </div>
  );
}
