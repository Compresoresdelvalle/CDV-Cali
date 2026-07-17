import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Triangle,
  Package,
  Wrench,
  ClipboardList,
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Filter,
  Building2,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatDate, formatCOP, safeError } from "../../lib/utils";
import StatusBadge from "../../components/ui/StatusBadge";
import { severidadStock, diasDesde } from "../../lib/admin-analytics-ui";
import { useFiltros } from "../../hooks/useFiltros";
import { useSedes } from "../../hooks/useSedes";
import BarraFiltros from "../../components/filtros/BarraFiltros";

const TABS = [
  { key: "stock", label: "Stock bajo / agotado", icon: Package },
  { key: "herramientas", label: "Herramientas vencidas", icon: Wrench },
  { key: "ordenes", label: "OT esperando repuesto", icon: ClipboardList },
  { key: "ot30dias", label: "OT > 30 días sin recoger", icon: ClipboardList },
  { key: "sobre_stock", label: "Sobre-stock", icon: ShoppingCart },
  { key: "mayor_rotacion", label: "Mayor rotación", icon: TrendingUp },
  { key: "menor_rotacion", label: "Menor rotación", icon: TrendingDown },
];

/* Solo la pestaña de stock tiene volumen real (~2.6k filas): es la única que
 * pagina y filtra contra el servidor. Las demás caben enteras en memoria, así
 * que ahí filtrar en cliente no miente: se está filtrando TODO lo que hay. */
const PAGE_SIZE = 50;

/** Valores REALES del enum `estado_stock` (OK | Bajo | Agotado | Sobrestock).
 *  'OK' no es alerta y 'Sobrestock' tiene su propia pestaña. */
const ESTADOS_ALERTA = ["Bajo", "Agotado"];
const OPCIONES_ESTADO = [
  { v: "Agotado", l: "Agotado" },
  { v: "Bajo", l: "Bajo" },
];
/** Valores REALES del enum `clasificacion_abc` (columna productos.clasificacion). */
// La opción "A y B" manda las dos clases con `.in()` (ver useFiltros): es el
// arranque por defecto porque una lista de 2.634 alertas es una lista que nadie
// mira. No se esconde nada — el encabezado sigue diciendo el total real y el
// chip del filtro se quita en un toque.
const OPCIONES_ABC = [
  { v: "AB", l: "A y B — lo que más pesa", in: ["A", "B"] },
  { v: "A", l: "A — mayor impacto" },
  { v: "B", l: "B — impacto medio" },
  { v: "C", l: "C — menor impacto" },
];

/* `!inner` en el embed de producto: sin él, filtrar por `producto.clasificacion`
 * solo vaciaría el objeto embebido en vez de descartar la fila (y el count
 * seguiría contando filas que no cumplen el filtro). */
const COLS_STOCK = `id, cantidad, estado_stock, sede_id, sede:sede_id(nombre), producto:producto_id!inner(referencia, nombre, stock_minimo, clasificacion)`;

/* Las pestañas que no son de stock caben enteras en memoria y siguen con el
 * filtro por sede/prioridad de siempre. */
const PRIORIDADES = ["Todas", "Urgente", "Alta", "Media"];
const TODAS_SEDES = "Todas";

/* ── Centro de alertas (datos reales: inventario + RPC rotación) ───────── */
export default function Alertas() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("stock");
  const [sede, setSede] = useState(TODAS_SEDES);
  const [prioridad, setPrioridad] = useState("Todas");
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

  /* Stock se cuenta y se pagina en el servidor. Antes se traían 200 filas y se
   * filtraban aquí: con ~2.600 filas Bajo/Agotado el badge decía "200" y las
   * demás alertas no existían para el administrador. */
  const [stockTotal, setStockTotal] = useState(0);
  // Total sin recorte por clasificación: es el número honesto del badge.
  const [stockTotalGlobal, setStockTotalGlobal] = useState(0);
  const [stockPage, setStockPage] = useState(0);
  const [stockLoading, setStockLoading] = useState(true);
  const { sedes } = useSedes();

  const fStock = useFiltros({
    clave: "alertas-stock",
    campos: [
      {
        id: "sede",
        tipo: "opciones",
        label: "Sede",
        columna: "sede_id",
        opciones: sedes.map((s) => ({ v: s.id, l: s.nombre })),
      },
      {
        id: "estado",
        tipo: "opciones",
        label: "Estado",
        columna: "estado_stock",
        opciones: OPCIONES_ESTADO,
      },
      {
        id: "abc",
        tipo: "opciones",
        label: "Clasificación",
        columna: "producto.clasificacion",
        opciones: OPCIONES_ABC,
        // Arranca en A+B: son ~181 productos accionables de 2.634 alertas.
        porDefecto: "AB",
      },
    ],
  });

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
      const [h, o, ot30, rot] = await Promise.all([
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
      if (h.error) throw h.error;
      if (o.error) throw o.error;
      if (ot30.error) throw ot30.error;
      if (rot.error) throw rot.error;
      const rotData = rot.data ?? [];
      setDatos((prev) => ({
        ...prev,
        herramientas: h.data ?? [],
        ordenes: o.data ?? [],
        ot30dias: ot30.data ?? [],
        sobre_stock: rotData.filter((r) => r.categoria === "sobre_stock"),
        mayor_rotacion: rotData.filter((r) => r.categoria === "mayor_rotacion"),
        menor_rotacion: rotData.filter((r) => r.categoria === "menor_rotacion"),
      }));
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

  /* Stock bajo/agotado: filtrado, contado y paginado en el servidor.
   * `estado_stock` desc deja Agotado (enum 3) antes que Bajo (enum 2), sin
   * reordenar en cliente; y `count:'exact'` da el total honesto para el badge. */
  const cargarStock = useCallback(async () => {
    setStockLoading(true);
    const reqId = fStock.nuevoReqId();
    try {
      let query = supabase
        .from("inventario")
        .select(COLS_STOCK, { count: "exact" })
        .in("estado_stock", ESTADOS_ALERTA);
      query = fStock.aplicar(query);
      const desde = stockPage * PAGE_SIZE;
      const { data, error, count } = await query
        .order("estado_stock", { ascending: false })
        .order("cantidad", { ascending: true })
        .range(desde, desde + PAGE_SIZE - 1);
      if (!mountedRef.current || !fStock.esReqVigente(reqId)) return;
      if (error) throw error;
      setDatos((prev) => ({ ...prev, stock: data ?? [] }));
      setStockTotal(count ?? 0);

      // Total REAL de alertas de stock, sin el recorte por clasificación. La
      // pantalla arranca en A+B, y si el badge mostrara solo ese subconjunto
      // estaría escondiendo el resto: se cambiaría un número truncado (el viejo
      // "200") por otro. El operario tiene que ver siempre cuántas hay de verdad.
      const { count: global } = await supabase
        .from("inventario")
        .select("id", { count: "exact", head: true })
        .in("estado_stock", ESTADOS_ALERTA);
      if (mountedRef.current && fStock.esReqVigente(reqId)) {
        setStockTotalGlobal(global ?? 0);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar alertas de stock"));
    } finally {
      if (mountedRef.current && fStock.esReqVigente(reqId)) {
        setStockLoading(false);
      }
    }
  }, [fStock, stockPage]);

  // Un cambio de filtro vuelve a la primera página; el efecto de carga corre en
  // ambos casos (cambia stockPage, o cambia el filtro con la página ya en 0).
  useEffect(() => {
    setStockPage(0);
  }, [fStock.valoresAplicados]);

  useEffect(() => {
    cargarStock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockPage, fStock.valoresAplicados]);

  // Sedes presentes en las pestañas NO-stock (las que filtran en cliente). El
  // stock trae su propio filtro de sede desde la base (todas las sedes activas).
  const sedesDisponibles = useMemo(() => {
    const map = new Map();
    const add = (id, nombre) => {
      if (id && !map.has(id)) map.set(id, nombre || id);
    };
    datos.herramientas.forEach((r) => add(r.sede_id, null));
    datos.ordenes.forEach((r) => add(r.sede_id, null));
    datos.ot30dias.forEach((r) => add(r.sede_id, null));
    [
      ...datos.sobre_stock,
      ...datos.mayor_rotacion,
      ...datos.menor_rotacion,
    ].forEach((r) => add(r.sede_id, null));
    return map;
  }, [datos]);

  const counts = {
    // El badge de la pestaña dice cuántas alertas de stock HAY, no cuántas deja
    // ver el filtro: es la cifra que el dueño usa para saber cómo está el
    // inventario, y filtrar no cambia la realidad.
    stock: stockTotalGlobal,
    herramientas: datos.herramientas.length,
    ordenes: datos.ordenes.length,
    ot30dias: datos.ot30dias.length,
    sobre_stock: datos.sobre_stock.length,
    mayor_rotacion: datos.mayor_rotacion.length,
    menor_rotacion: datos.menor_rotacion.length,
  };
  const totalActivas = Object.values(counts).reduce((a, b) => a + b, 0);
  const tabActual = TABS.find((t) => t.key === tab);
  const esStock = tab === "stock";

  /* La pestaña de stock ya llega filtrada y anotada desde el servidor; el resto
   * cabe en memoria y conserva el filtro cliente por sede + prioridad. */
  const filasVisibles = useMemo(() => {
    if (esStock) {
      return (datos.stock ?? []).map((r) => ({
        ...r,
        _sev: severidadDeFila("stock", r),
      }));
    }
    return filtrarFilas(tab, datos, sede, prioridad);
  }, [esStock, tab, datos, sede, prioridad]);
  const urgentesVisibles = filasVisibles.filter(
    (f) => f._sev === "--destructive",
  ).length;
  const stockDesde = stockPage * PAGE_SIZE;
  const stockHasta = Math.min(stockDesde + PAGE_SIZE, stockTotal);
  const stockTotalPags = Math.max(1, Math.ceil(stockTotal / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6 px-5 pb-8 pt-6 sm:px-7 animate-fade-in">
      {/* Page head */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="m-0 mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Admin · Centro de alertas
          </p>
          <h1
            className="m-0 flex items-center gap-2.5 text-[24px] font-semibold leading-tight tracking-[-0.018em]"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Alertas
            {!loading && (
              <span
                className="rounded-[3px] border px-1.5 py-px font-mono text-[11px] font-semibold"
                style={{
                  backgroundColor: "hsl(var(--destructive) / 0.12)",
                  borderColor: "hsl(var(--destructive) / 0.4)",
                  color: "hsl(var(--destructive))",
                }}
              >
                {totalActivas} activas
              </span>
            )}
          </h1>
        </div>
        <button
          onClick={cargar}
          className="inline-flex h-12 items-center gap-1.5 rounded-md border px-4 text-[12.5px] font-medium transition-colors cursor-pointer"
          style={{
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--card))",
            color: "hsl(var(--muted-foreground))",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.color = "hsl(var(--foreground))")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.color = "hsl(var(--muted-foreground))")
          }
        >
          ↻ Refrescar
        </button>
      </div>

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

      {/* Tabs */}
      <div
        className="flex flex-wrap items-center gap-1.5 border-b"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        {TABS.map((t) => {
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
              <span
                className="rounded-[3px] border px-1.5 py-px font-mono text-[10.5px] font-semibold leading-[1.4] tabular-nums"
                style={{
                  backgroundColor:
                    counts[t.key] > 0
                      ? "hsl(var(--destructive) / 0.12)"
                      : "hsl(var(--muted) / 0.4)",
                  borderColor:
                    counts[t.key] > 0
                      ? "hsl(var(--destructive) / 0.4)"
                      : "hsl(var(--border))",
                  color:
                    counts[t.key] > 0
                      ? "hsl(var(--destructive))"
                      : "hsl(var(--muted-foreground))",
                }}
              >
                {counts[t.key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Barra de filtros — stock filtra contra el servidor (sede/estado/ABC);
          las demás pestañas caben en memoria y usan el filtro cliente. */}
      {esStock ? (
        <div className="-mt-3">
          <BarraFiltros filtros={fStock} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 -mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.06em]"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              <Filter className="h-3 w-3" strokeWidth={1.5} />
              Filtrar
            </span>
            {sedesDisponibles.size > 1 && (
              <Seg
                icon={Building2}
                options={[TODAS_SEDES, ...sedesDisponibles.keys()]}
                value={sede}
                onChange={setSede}
                labelOf={(s) =>
                  s === TODAS_SEDES ? "Todas" : (sedesDisponibles.get(s) ?? s)
                }
              />
            )}
            <Seg
              options={PRIORIDADES}
              value={prioridad}
              onChange={setPrioridad}
            />
          </div>
          <span
            className="font-mono text-[10.5px] tracking-[0.06em]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {filasVisibles.length} resultados · {urgentesVisibles} urgentes
          </span>
        </div>
      )}

      {/* Lista */}
      <section
        className="overflow-hidden rounded-[10px] border"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <header
          className="flex items-center justify-between border-b px-[18px] py-2.5"
          style={{
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--muted) / 0.3)",
          }}
        >
          <div className="flex items-center gap-2.5">
            <span
              className="grid h-6 w-6 place-items-center rounded-md"
              style={{
                backgroundColor: "hsl(var(--destructive) / 0.1)",
                color: "hsl(var(--destructive))",
              }}
            >
              <Triangle
                className="h-3.5 w-3.5"
                fill="currentColor"
                strokeWidth={1.5}
              />
            </span>
            <span
              className="text-[13px] font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {tabActual?.label}
            </span>
          </div>
          <span
            className="font-mono text-[10.5px] tracking-[0.06em]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Ordenado por severidad
          </span>
        </header>

        {/* Aviso honesto: la pantalla arranca recortada a A+B, y eso hay que
            DECIRLO. Un filtro puesto por defecto y en silencio es lo mismo que
            un truncado: el operario ve pocas y cree que no hay más. */}
        {esStock && !stockLoading && stockTotal < stockTotalGlobal && (
          <div
            className="mx-[18px] mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-[12.5px]"
            style={{
              backgroundColor: "hsl(var(--info) / 0.08)",
              borderColor: "hsl(var(--info) / 0.3)",
              color: "hsl(var(--foreground))",
            }}
          >
            <span>
              Viendo <b>{stockTotal}</b> de <b>{stockTotalGlobal}</b> alertas de
              stock. El resto son de <b>clase C</b> (cola larga): existen, pero
              casi nunca se actúa sobre ellas.
            </span>
            <button
              onClick={() => fStock.limpiar()}
              className="h-12 shrink-0 rounded-lg border px-3 text-[12.5px] font-medium"
              style={{
                borderColor: "hsl(var(--border))",
                backgroundColor: "hsl(var(--card))",
                color: "hsl(var(--foreground))",
              }}
            >
              Ver las {stockTotalGlobal}
            </button>
          </div>
        )}

        {(esStock ? stockLoading : loading) ? (
          <Skeleton />
        ) : (
          renderTab(tab, filasVisibles, navigate)
        )}

        {/* Paginación del stock (contra el servidor). Solo en esa pestaña, que
            es la única que puede exceder una página. */}
        {esStock && !stockLoading && stockTotal > PAGE_SIZE && (
          <div
            className="flex items-center justify-between gap-2 border-t px-[18px] py-2.5 text-[12px]"
            style={{
              borderColor: "hsl(var(--border))",
              backgroundColor: "hsl(var(--muted) / 0.3)",
            }}
          >
            <span
              className="font-mono text-[10.5px]"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {stockDesde + 1}–{stockHasta} de {stockTotal}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setStockPage((p) => Math.max(0, p - 1))}
                disabled={stockPage === 0}
                className="inline-flex h-9 items-center gap-1 rounded-md border px-2.5 text-xs font-medium disabled:opacity-40"
                style={{
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Anterior
              </button>
              <span
                className="font-mono text-[11px]"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {stockPage + 1}/{stockTotalPags}
              </span>
              <button
                type="button"
                onClick={() =>
                  setStockPage((p) => (stockHasta >= stockTotal ? p : p + 1))
                }
                disabled={stockHasta >= stockTotal}
                className="inline-flex h-9 items-center gap-1 rounded-md border px-2.5 text-xs font-medium disabled:opacity-40"
                style={{
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
              >
                Siguiente <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {!(esStock ? stockLoading : loading) && (
          <footer
            className="flex flex-wrap items-center justify-between gap-2 border-t px-[18px] py-3 text-[12px]"
            style={{
              borderColor: "hsl(var(--border))",
              backgroundColor: "hsl(var(--muted) / 0.3)",
            }}
          >
            <span
              className="font-mono text-[10.5px]"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Umbrales de stock y vencimientos en Configuración
            </span>
            <Link
              to="/admin/configuracion"
              className="inline-flex items-center gap-1.5 font-medium"
              style={{ color: "hsl(var(--primary))" }}
            >
              Ajustar reglas
              <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
            </Link>
          </footer>
        )}
      </section>
    </div>
  );
}

/* ── Filtrado por sede + prioridad ────────────────────────────────────────
 * Cada fila se anota con `_sev` (token de severidad) para que el filtro de
 * prioridad y el conteo de urgentes sean consistentes con el render. */
function filtrarFilas(tab, datos, sede, prioridad) {
  const sedeId = (r) => r.sede_id ?? r.sede?.id;
  const base = (datos[tab] ?? []).map((r) => ({
    ...r,
    _sev: severidadDeFila(tab, r),
  }));
  return base.filter((r) => {
    const okSede = sede === TODAS_SEDES || sedeId(r) === sede;
    const okPrio =
      prioridad === "Todas" || severidadLabel(r._sev) === prioridad;
    return okSede && okPrio;
  });
}

/* Token de severidad de cada fila según su pestaña (espejo del render). */
function severidadDeFila(tab, r) {
  switch (tab) {
    case "stock":
      return severidadStock(r.estado_stock).token;
    case "herramientas":
      return diasDesde(r.fecha_devolucion_esperada) > 3
        ? "--destructive"
        : "--warning";
    case "ordenes":
      return "--warning";
    case "ot30dias":
      return diasDesde(r.fecha) > 45 ? "--destructive" : "--warning";
    case "sobre_stock":
      return "--info";
    case "mayor_rotacion":
      // Badge visible dice "Alta" (ver RotacionRows más abajo) — el token
      // tiene que mapear a esa misma etiqueta en severidadLabel(), si no el
      // filtro de prioridad "Alta" no encuentra estas filas.
      return "--warning";
    case "menor_rotacion":
      // Badge visible dice "Baja" (no es ninguna de las 3 prioridades del
      // filtro) — se bucketiza como "Media" para no chocar con "Alta".
      return "--muted-foreground";
    default:
      return "--info";
  }
}

function severidadLabel(token) {
  if (token === "--destructive") return "Urgente";
  if (token === "--warning") return "Alta";
  return "Media";
}

/* ── Render por pestaña ───────────────────────────────────────────────── */
function renderTab(tab, filas, navigate) {
  if (filas.length === 0) {
    return <Empty icon={EMPTY_ICON[tab] ?? "✅"}>{EMPTY_MSG[tab]}</Empty>;
  }

  switch (tab) {
    case "stock":
      return filas.map((s) => {
        const sev = severidadStock(s.estado_stock);
        return (
          <AlertRow
            key={s.id}
            sevToken={sev.token}
            sevLabel={sev.label}
            keyText={s.producto?.referencia}
            title={s.producto?.nombre}
            meta={`${s.sede?.nombre} · stock ${s.cantidad} · mínimo ${s.producto?.stock_minimo}`}
            badge={<StatusBadge status={s.estado_stock} />}
            action={{
              label: "Reorden",
              onClick: () => navigate("/admin/reorden"),
            }}
          />
        );
      });

    case "herramientas":
      return filas.map((h) => {
        const dias = diasDesde(h.fecha_devolucion_esperada);
        return (
          <AlertRow
            key={h.id}
            sevToken={h._sev}
            sevLabel={dias > 3 ? "Urgente" : "Alta"}
            keyText={h.herramienta_codigo || "—"}
            title={h.herramienta_nombre}
            meta={`Prestada a ${h.usuario?.nombre ?? "—"} · vencida hace ${dias} día${dias === 1 ? "" : "s"} (${formatDate(h.fecha_devolucion_esperada)})`}
            action={{
              label: "Ver",
              onClick: () => navigate("/ops/herramientas"),
            }}
          />
        );
      });

    case "ordenes":
      return filas.map((o) => (
        <AlertRow
          key={o.id}
          sevToken="--warning"
          sevLabel="Alta"
          keyText={`#${o.numero}`}
          title={o.cliente_nombre}
          meta={`${o.equipo_descripcion} · ${formatDate(o.fecha)} · ${o.tecnico?.nombre ?? "—"}`}
          action={{
            label: "Abrir OT",
            onClick: () => navigate(`/ops/ordenes/${o.id}`),
          }}
        />
      ));

    case "ot30dias":
      return filas.map((o) => {
        const dias = diasDesde(o.fecha);
        const abonado =
          Number(o.total_abonado) > 0
            ? ` · Abonado: ${formatCOP(o.total_abonado)}`
            : "";
        return (
          <AlertRow
            key={o.id}
            sevToken={o._sev}
            sevLabel={`${dias} días`}
            keyText={`#${o.numero}`}
            title={`${o.cliente_nombre}${o.cliente_telefono ? ` · ${o.cliente_telefono}` : ""}`}
            meta={`${o.equipo_descripcion} · completada ${formatDate(o.fecha)}${abonado}`}
            action={{
              label: "Abrir OT",
              onClick: () => navigate(`/ops/ordenes/${o.id}`),
            }}
          />
        );
      });

    case "sobre_stock":
      return (
        <RotacionRows
          items={filas}
          navigate={navigate}
          sevToken="--info"
          sevLabel="Revisar"
          modo="sobre_stock"
        />
      );

    case "mayor_rotacion":
      return (
        <RotacionRows
          items={filas}
          navigate={navigate}
          sevToken="--success"
          sevLabel="Alta"
          modo="mayor"
        />
      );

    case "menor_rotacion":
      return (
        <RotacionRows
          items={filas}
          navigate={navigate}
          sevToken="--warning"
          sevLabel="Baja"
          modo="menor"
        />
      );

    default:
      return null;
  }
}

const EMPTY_ICON = {
  stock: "✅",
  herramientas: "🔧",
  ordenes: "🛠️",
  ot30dias: "📦",
  sobre_stock: "📦",
  mayor_rotacion: "🔥",
  menor_rotacion: "🐢",
};

const EMPTY_MSG = {
  stock: "No hay stock bajo ni agotado",
  herramientas: "Sin herramientas vencidas",
  ordenes: "Sin órdenes esperando repuesto",
  ot30dias: "Sin OT pendientes de recogida",
  sobre_stock: "Sin productos con sobre-stock en los últimos 30 días.",
  mayor_rotacion: "Sin movimientos en los últimos 30 días.",
  menor_rotacion: "Sin productos de menor rotación.",
};

function RotacionRows({ items, navigate, sevToken, sevLabel, modo }) {
  return items.map((r) => (
    <AlertRow
      key={`${modo}-${r.producto_id}-${r.sede_id}`}
      sevToken={sevToken}
      sevLabel={sevLabel}
      keyText={r.codigo_interno}
      title={r.nombre}
      meta={`${r.sede_id} · ${r.ventas_periodo} vendidos · stock ${r.stock_actual}`}
      action={{
        label: "Ver",
        onClick: () => navigate(`/ops/inventario/${r.producto_id}`),
      }}
    />
  ));
}

/* ── Fila de alerta (layout Lovable, tokens semánticos) ────────────────── */
function AlertRow({ sevToken, sevLabel, keyText, title, meta, badge, action }) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 border-b px-[18px] py-3 last:border-b-0"
      style={{ borderColor: "hsl(var(--border))" }}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: `hsl(var(${sevToken}))` }}
      />
      {keyText && (
        <span
          className="shrink-0 rounded-[3px] border px-1.5 py-0.5 font-mono text-[11px] font-medium leading-[1.4]"
          style={{
            backgroundColor: `hsl(var(${sevToken}) / 0.1)`,
            borderColor: `hsl(var(${sevToken}) / 0.4)`,
            color: `hsl(var(${sevToken}))`,
          }}
        >
          {keyText}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div
          className="truncate text-[12.5px] font-medium leading-[1.3]"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {title}
        </div>
        <div
          className="truncate font-mono text-[10.5px] tracking-[0.04em]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {meta}
        </div>
      </div>
      {badge ?? (
        <span
          className="shrink-0 rounded-[3px] border px-1.5 py-px font-mono text-[10.5px] font-semibold leading-[1.4]"
          style={{
            backgroundColor: `hsl(var(${sevToken}) / 0.12)`,
            borderColor: `hsl(var(${sevToken}) / 0.4)`,
            color: `hsl(var(${sevToken}))`,
          }}
        >
          {sevLabel}
        </span>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="inline-flex shrink-0 items-center gap-1 rounded-[5px] border px-2.5 py-1.5 text-[11.5px] font-medium leading-tight transition-colors cursor-pointer"
          style={{
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--card))",
            color: "hsl(var(--primary))",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.backgroundColor =
              "hsl(var(--primary) / 0.1)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.backgroundColor = "hsl(var(--card))")
          }
        >
          {action.label}
          <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}

/* ── Segmented control (estilo Dashboard admin) ───────────────────────── */
function Seg({ options, value, onChange, labelOf, icon: Icon }) {
  return (
    <div
      className="inline-flex flex-wrap items-center gap-px rounded-[7px] border p-0.5"
      style={{
        borderColor: "hsl(var(--border))",
        backgroundColor: "hsl(var(--muted) / 0.4)",
      }}
    >
      {Icon && (
        <span
          className="grid place-items-center pl-1.5 pr-0.5"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          <Icon className="h-3 w-3" strokeWidth={1.5} />
        </span>
      )}
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
            {labelOf ? labelOf(opt) : opt}
          </button>
        );
      })}
    </div>
  );
}

function Empty({ icon, children }) {
  return (
    <div className="flex flex-col items-center justify-center px-[18px] py-14 text-center">
      <div className="text-5xl mb-3">{icon}</div>
      <p
        className="text-[13px]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {children}
      </p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="divide-y" style={{ borderColor: "hsl(var(--border))" }}>
      {[...Array(5)].map((_, i) => (
        <div key={i} className="px-[18px] py-3.5">
          <div
            className="h-9 animate-pulse rounded"
            style={{ backgroundColor: "hsl(var(--muted) / 0.5)" }}
          />
        </div>
      ))}
    </div>
  );
}
