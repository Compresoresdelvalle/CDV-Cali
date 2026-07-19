import { useState, useEffect, useRef, useCallback } from "react";
import {
  Trophy,
  TrendingUp,
  ChevronRight,
  Package,
  Users,
  Building2,
  BarChart3,
  CalendarDays,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCOP, safeError } from "../../lib/utils";
import {
  PERIODOS_RANKING,
  labelPeriodoRanking,
  medallaRanking,
  variacionPct,
  variacionToken,
} from "../../lib/admin-analytics-ui";

/* Pestañas de ranking. `productos` usa la RPC real; las demás derivan de
 * SELECT de SOLO LECTURA (RLS por sede ya aplica). NUNCA se inventan números. */
const RANK_TABS = [
  { key: "productos", label: "Productos", icon: Package },
  { key: "clientes", label: "Clientes", icon: Users },
  { key: "categorias", label: "Categorías", icon: BarChart3 },
  { key: "proveedores", label: "Proveedores", icon: Building2 },
];

const LIMITE_RANKING = 10;

/* ── Top 10 — rankings de ventas (datos reales / derivados) ────────────── */
export default function Top10() {
  const [periodo, setPeriodo] = useState(30);
  const [tab, setTab] = useState("productos");
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

  const cargar = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const rows = await cargarRanking(tab, periodo);
      if (!mountedRef.current) return;
      setItems(rows);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar el ranking"));
      setItems([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [tab, periodo]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const maxValor = Math.max(1, ...items.map((i) => Number(i.valor)));
  const totalVendido = items.reduce((s, i) => s + Number(i.valor || 0), 0);
  const totalUnidades = items.reduce((s, i) => s + Number(i.unidades || 0), 0);
  const totalTx = items.reduce((s, i) => s + Number(i.transacciones || 0), 0);
  // Clientes y Proveedores se agrupan por cabecera (ventas/compras), donde no
  // hay cantidad de unidades: antes las tarjetas "Unidades" y "Ticket promedio"
  // mostraban 0 y $0 fijos, que se leía como "no se vendió nada". Cuando no hay
  // unidades ocultamos esa tarjeta y el ticket pasa a ser POR TRANSACCIÓN, que
  // sí es calculable con los datos que tenemos.
  const hayUnidades = totalUnidades > 0;
  const ticketPromedio = hayUnidades
    ? totalVendido / totalUnidades
    : totalTx > 0
      ? totalVendido / totalTx
      : 0;
  const tabActual = RANK_TABS.find((t) => t.key === tab);
  const esCompras = tab === "proveedores";

  return (
    <div className="flex flex-col gap-6 px-5 pb-8 pt-6 sm:px-7 animate-fade-in">
      {/* Page head */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="m-0 mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Admin · Rankings de ventas
          </p>
          <h1
            className="m-0 flex items-center gap-2.5 text-[24px] font-semibold leading-tight tracking-[-0.018em]"
            style={{ color: "hsl(var(--foreground))" }}
          >
            <Trophy
              className="h-5 w-5"
              strokeWidth={1.75}
              style={{ color: "hsl(var(--primary))" }}
            />
            Top 10
          </h1>
        </div>
        <Seg
          options={PERIODOS_RANKING.map((p) => p.label)}
          value={labelPeriodoRanking(periodo)}
          onChange={(label) =>
            setPeriodo(
              PERIODOS_RANKING.find((p) => p.label === label)?.dias ?? 30,
            )
          }
        />
      </div>

      {errorMsg && <ErrorBox msg={errorMsg} onRetry={cargar} />}

      {/* Tabs de ranking */}
      <div
        className="flex flex-wrap items-center gap-1.5 border-b"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        {RANK_TABS.map((t) => {
          const Icon = t.icon;
          const on = t.key === tab;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 pt-1 text-[12.5px] font-medium transition-colors cursor-pointer"
              style={{
                borderColor: on ? "hsl(var(--primary))" : "transparent",
                color: on
                  ? "hsl(var(--foreground))"
                  : "hsl(var(--muted-foreground))",
              }}
            >
              <Icon
                className="h-3.5 w-3.5"
                strokeWidth={1.5}
                style={{
                  color: on
                    ? "hsl(var(--primary))"
                    : "hsl(var(--muted-foreground))",
                }}
              />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* KPI strip */}
      <div
        className={`grid grid-cols-2 gap-y-4 border-b pb-5 pt-1 md:gap-y-0 ${
          hayUnidades ? "md:grid-cols-4" : "md:grid-cols-3"
        }`}
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <Kpi
          label={`${esCompras ? "Compras" : "Ventas"} · ${labelPeriodoRanking(periodo)}`}
          value={formatCOP(totalVendido)}
          sub={`Total Top ${LIMITE_RANKING}`}
        />
        {hayUnidades && (
          <Kpi
            label="Unidades"
            value={totalUnidades.toLocaleString("es-CO")}
            sub="Suma del ranking"
          />
        )}
        <Kpi
          label="Ticket promedio"
          value={formatCOP(Math.round(ticketPromedio))}
          sub={
            hayUnidades
              ? esCompras
                ? "Costo por unidad"
                : "Ingreso por unidad"
              : esCompras
                ? "Por orden de compra"
                : "Por transacción"
          }
        />
        <Kpi
          last
          label={esCompras ? "Órdenes de compra" : "Transacciones"}
          value={totalTx.toLocaleString("es-CO")}
          sub={esCompras ? "Compras del periodo" : "Ventas del periodo"}
        />
      </div>

      {/* Ranking */}
      <section className="space-y-2.5">
        <h2
          className="flex items-center gap-2 text-[13px] font-semibold"
          style={{ color: "hsl(var(--foreground))" }}
        >
          <TrendingUp
            className="h-4 w-4"
            strokeWidth={1.75}
            style={{ color: "hsl(var(--primary))" }}
          />
          Ranking — {tabActual?.label}
        </h2>

        {loading ? (
          <SkeletonList />
        ) : items.length === 0 ? (
          <Empty icon="📊">Sin datos para este período</Empty>
        ) : (
          <ul className="space-y-2" role="list">
            {items.map((it, i) => (
              <RankRow
                key={it.id ?? i}
                item={it}
                pos={i + 1}
                maxValor={maxValor}
                esCompras={esCompras}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Summary bar */}
      {!loading && items.length > 0 && (
        <div
          className="flex flex-col gap-3 rounded-[10px] border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          <div
            className="flex items-center gap-2 text-[12.5px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            <CalendarDays className="h-4 w-4" strokeWidth={1.5} />
            <span>
              Periodo: {labelPeriodoRanking(periodo).toLowerCase()} · variación
              comparada con el periodo previo equivalente
            </span>
          </div>
          <span
            className="font-mono text-[10.5px] tracking-[0.06em]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {items.length} de {LIMITE_RANKING} · orden descendente por{" "}
            {esCompras ? "compras" : "ventas"}
          </span>
        </div>
      )}
    </div>
  );
}

/* ── Carga de cada ranking ────────────────────────────────────────────────
 * Devuelve filas normalizadas { id, nombre, sub, valor, unidades,
 * transacciones, variacion } para que el render sea uniforme. La variación se
 * calcula contra el periodo previo equivalente; es `null` cuando no hay base
 * de comparación (nunca se inventa). */
async function cargarRanking(tab, dias) {
  if (tab === "productos") return cargarProductos(dias);
  if (tab === "clientes") return cargarClientes(dias);
  if (tab === "categorias") return cargarCategorias(dias);
  if (tab === "proveedores") return cargarProveedores(dias);
  return [];
}

function rangoFechas(dias) {
  const ahora = new Date();
  const inicio = new Date(ahora.getTime() - dias * 86_400_000);
  const inicioPrev = new Date(ahora.getTime() - 2 * dias * 86_400_000);
  return {
    inicioISO: inicio.toISOString(),
    inicioPrevISO: inicioPrev.toISOString(),
  };
}

async function cargarProductos(dias) {
  const [actual, previo] = await Promise.all([
    supabase.rpc("fn_top_productos", { p_dias: dias, p_limit: LIMITE_RANKING }),
    supabase.rpc("fn_top_productos", { p_dias: dias * 2, p_limit: 100 }),
  ]);
  if (actual.error) throw actual.error;
  // El periodo previo se aproxima con (total 2·días − actual): solo lectura.
  const prevMap = new Map();
  if (!previo.error) {
    const actualMap = new Map(
      (actual.data ?? []).map((r) => [
        r.producto_id,
        Number(r.unidades_vendidas),
      ]),
    );
    (previo.data ?? []).forEach((r) => {
      const prevUnidades =
        Number(r.unidades_vendidas) - (actualMap.get(r.producto_id) ?? 0);
      prevMap.set(r.producto_id, Math.max(0, prevUnidades));
    });
  }
  return (actual.data ?? []).map((r) => ({
    id: r.producto_id,
    nombre: r.nombre,
    sub: r.referencia,
    valor: Number(r.total_vendido),
    unidades: Number(r.unidades_vendidas),
    transacciones: Number(r.num_ventas),
    variacion: variacionPct(
      Number(r.unidades_vendidas),
      prevMap.get(r.producto_id) ?? 0,
    ),
  }));
}

async function cargarClientes(dias) {
  const { inicioISO, inicioPrevISO } = rangoFechas(dias);
  const { data, error } = await supabase
    .from("ventas")
    .select("cliente_nombre, total, fecha")
    .eq("anulada", false)
    .gte("fecha", inicioPrevISO)
    // Sin ORDER BY, el recorte del .limit() es arbitrario: el día que se superen
    // las 5000 ventas del periodo, el ranking se calcularía sobre una muestra
    // impredecible. Ordenando por fecha desc el recorte se queda con lo más
    // reciente, que es lo sensato. Hoy hay ~880 ventas/año, así que no trunca.
    //
    // SESGO CONOCIDO (latente, documentado en la verificación adversarial de la
    // S12): la consulta abarca periodo actual + previo, así que si algún día
    // trunca, lo primero que se descarta son las filas más viejas — justo las
    // que alimentan `valorPrev`. Los montos y el orden del podio seguirían
    // bien, pero la columna "Var. vs ant." se inflaría al alza. El arreglo
    // definitivo es traer los dos periodos en consultas separadas (o mover la
    // agregación a una RPC con GROUP BY); no se hizo porque faltan años para
    // llegar a 5000 y el cambio es mayor.
    .order("fecha", { ascending: false })
    .limit(5000);
  if (error) throw error;
  return agruparPorClave(
    data ?? [],
    (v) => claveCanonica(v.cliente_nombre, "CONSUMIDOR FINAL"),
    inicioISO,
  );
}

/**
 * Clave canónica para agrupar clientes/proveedores. Antes se agrupaba por el
 * texto crudo (case-sensitive), así que el mismo cliente se partía en dos filas
 * del ranking: las ventas sin nombre (etiquetadas "Consumidor final") quedaban
 * separadas del literal "CONSUMIDOR FINAL", y "Pro Estibas" de "PRO ESTIBAS".
 * Normaliza mayúsculas, espacios múltiples y acentos, y unifica el vacío con el
 * fallback para que caigan en una sola fila.
 */
function claveCanonica(raw, fallback) {
  const limpio = (raw || "").trim();
  if (!limpio) return fallback;
  return limpio
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos combinados
    .replace(/\s+/g, " ");
}

async function cargarCategorias(dias) {
  const { inicioISO, inicioPrevISO } = rangoFechas(dias);
  const { data, error } = await supabase
    .from("detalle_venta")
    .select(
      "cantidad, subtotal, venta:venta_id!inner(fecha, anulada), producto:producto_id(categoria)",
    )
    .eq("venta.anulada", false)
    .gte("venta.fecha", inicioPrevISO)
    // Recorte determinista, igual que Clientes y Proveedores (ver nota allí).
    // Se ordena por `created_at` de detalle_venta (columna PROPIA) y no por la
    // fecha de la venta embebida: en PostgREST, ordenar por un campo embebido
    // NO reordena las filas padre, así que no serviría para hacer determinista
    // el recorte del .limit(). created_at sigue el mismo orden cronológico.
    .order("created_at", { ascending: false })
    .limit(8000);
  if (error) throw error;
  const norm = (data ?? []).map((d) => ({
    clave: d.producto?.categoria || "Sin categoría",
    total: Number(d.subtotal),
    cantidad: Number(d.cantidad),
    fecha: d.venta?.fecha,
  }));
  return agruparDetalle(norm, inicioISO);
}

async function cargarProveedores(dias) {
  const { inicioISO, inicioPrevISO } = rangoFechas(dias);
  const { data, error } = await supabase
    .from("compras")
    .select("proveedor, total, fecha")
    // Las compras canceladas nunca se pagaron: incluirlas inflaba el gasto y el
    // ranking (un proveedor con una sola compra cancelada aparecía como gasto real).
    .neq("estado", "cancelada")
    .gte("fecha", inicioPrevISO)
    // Recorte determinista (ver nota en cargarClientes): lo más reciente primero.
    .order("fecha", { ascending: false })
    .limit(5000);
  if (error) throw error;
  // Proveedores se mide por volumen de COMPRAS (no hay venta por proveedor).
  return agruparPorClave(
    data ?? [],
    (c) => claveCanonica(c.proveedor, "SIN PROVEEDOR"),
    inicioISO,
  );
}

/* Agrupa filas tipo cabecera (ventas/compras) por una clave de texto. */
function agruparPorClave(filas, claveFn, inicioISO) {
  const acc = new Map();
  for (const f of filas) {
    const clave = claveFn(f);
    const enPeriodo = f.fecha >= inicioISO;
    const cur = acc.get(clave) ?? {
      nombre: clave,
      valor: 0,
      unidades: 0,
      transacciones: 0,
      valorPrev: 0,
    };
    if (enPeriodo) {
      cur.valor += Number(f.total || 0);
      cur.transacciones += 1;
    } else {
      cur.valorPrev += Number(f.total || 0);
    }
    acc.set(clave, cur);
  }
  return finalizarRanking(acc);
}

/* Agrupa filas de detalle (con cantidad) por clave de texto. */
function agruparDetalle(filas, inicioISO) {
  const acc = new Map();
  for (const f of filas) {
    const enPeriodo = f.fecha >= inicioISO;
    const cur = acc.get(f.clave) ?? {
      nombre: f.clave,
      valor: 0,
      unidades: 0,
      transacciones: 0,
      valorPrev: 0,
    };
    if (enPeriodo) {
      cur.valor += f.total;
      cur.unidades += f.cantidad;
      cur.transacciones += 1;
    } else {
      cur.valorPrev += f.total;
    }
    acc.set(f.clave, cur);
  }
  return finalizarRanking(acc);
}

function finalizarRanking(acc) {
  return [...acc.values()]
    .filter((r) => r.valor > 0)
    .sort((a, b) => b.valor - a.valor)
    .slice(0, LIMITE_RANKING)
    .map((r, i) => ({
      id: `${r.nombre}-${i}`,
      nombre: r.nombre,
      sub: null,
      valor: r.valor,
      unidades: r.unidades,
      transacciones: r.transacciones,
      variacion: variacionPct(r.valor, r.valorPrev),
    }));
}

/* ── Fila de ranking ──────────────────────────────────────────────────── */
function RankRow({ item, pos, maxValor, esCompras }) {
  const medal = medallaRanking(pos);
  const pct = (Number(item.valor) / maxValor) * 100;
  const top3 = pos <= 3;
  const varToken = variacionToken(item.variacion);

  return (
    <li
      className="group rounded-[10px] border p-3 transition-colors"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.borderColor = "hsl(var(--primary) / 0.5)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.borderColor = "hsl(var(--border))")
      }
    >
      <div className="flex items-center gap-3">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full font-mono text-sm font-bold tabular-nums"
          style={{
            backgroundColor: top3
              ? "hsl(var(--primary))"
              : "hsl(var(--muted) / 0.6)",
            color: top3
              ? "hsl(var(--primary-foreground))"
              : "hsl(var(--muted-foreground))",
          }}
        >
          {pos}
        </span>
        {medal && (
          <span className="shrink-0 text-lg" aria-hidden>
            {medal}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-medium"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {item.nombre}
          </p>
          {item.sub && (
            <p
              className="truncate font-mono text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {item.sub}
            </p>
          )}
        </div>

        {/* Métricas desktop */}
        <div className="hidden shrink-0 items-center gap-6 sm:flex">
          <Metric
            label={esCompras ? "Compras" : "Ventas"}
            value={formatCOP(item.valor)}
            valueColor="hsl(var(--primary))"
          />
          {item.unidades > 0 && (
            <Metric
              label="Unidades"
              value={item.unidades.toLocaleString("es-CO")}
            />
          )}
          <Metric
            label="Var. vs ant."
            value={
              item.variacion == null
                ? "—"
                : `${item.variacion >= 0 ? "+" : ""}${item.variacion.toFixed(0)}%`
            }
            valueColor={`hsl(var(${varToken}))`}
          />
        </div>

        {/* Métricas mobile */}
        <div className="flex shrink-0 flex-col items-end gap-1 sm:hidden">
          <span
            className="text-sm font-bold tabular-nums"
            style={{ color: "hsl(var(--primary))" }}
          >
            {formatCOP(item.valor)}
          </span>
          <span
            className="text-xs font-medium tabular-nums"
            style={{ color: `hsl(var(${varToken}))` }}
          >
            {item.variacion == null
              ? "—"
              : `${item.variacion >= 0 ? "+" : ""}${item.variacion.toFixed(0)}%`}
          </span>
        </div>

        <ChevronRight
          className="hidden h-4 w-4 shrink-0 sm:block"
          strokeWidth={1.5}
          style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}
        />
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full"
        style={{ backgroundColor: "hsl(var(--muted) / 0.4)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: "hsl(var(--primary))" }}
        />
      </div>
    </li>
  );
}

function Metric({ label, value, valueColor }) {
  return (
    <div className="text-right">
      <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
        {label}
      </p>
      <p
        className="text-sm font-bold tabular-nums"
        style={{ color: valueColor ?? "hsl(var(--foreground))" }}
      >
        {value}
      </p>
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
function Kpi({ label, value, sub, last }) {
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
        style={{ color: "hsl(var(--foreground))" }}
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
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-xl border"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        />
      ))}
    </div>
  );
}

function ErrorBox({ msg, onRetry }) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
      style={{
        backgroundColor: "hsl(var(--destructive) / 0.08)",
        borderColor: "hsl(var(--destructive) / 0.4)",
        color: "hsl(var(--destructive))",
      }}
    >
      <p className="text-xs">{msg}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded border px-3 py-1.5 text-xs cursor-pointer"
          style={{
            borderColor: "hsl(var(--destructive))",
            color: "hsl(var(--destructive))",
          }}
        >
          Reintentar
        </button>
      )}
    </div>
  );
}
