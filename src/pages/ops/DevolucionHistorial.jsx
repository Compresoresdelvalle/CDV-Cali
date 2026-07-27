import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Undo2, ArrowLeftCircle } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatDate } from "../../lib/utils";
import { useFiltros } from "../../hooks/useFiltros";
import { useSedes } from "../../hooks/useSedes";
import BarraFiltros from "../../components/filtros/BarraFiltros";
import { esNumeroPuro } from "../../lib/filtros";
import { keywordTerms } from "../../lib/search";
import {
  devolucionTipoPill,
  devolucionSigno,
  devolucionEstadoClass,
  devolucionEstadoLabel,
  devolucionPulse,
} from "../../lib/devoluciones-ui";

const PAGE_SIZE = 20;

const COLS = `id, numero, fecha, reingresa_stock, cantidad, motivo, estado, venta_id,
   producto:producto_id(nombre, referencia),
   registrador:registrado_por(nombre),
   venta:venta_id(numero)`;

// Tope de productos que se resuelven para la búsqueda por nombre/referencia.
// Los ids viajan dentro de la URL del `or=(...)`, así que no puede ser enorme;
// una búsqueda de producto que empate con más de 100 no está buscando nada.
const PRODUCTOS_MATCH_MAX = 100;

// Pestañas de tipo. El diseño Lovable usa tabs duales cliente/proveedor; aquí
// se mapean directamente a la columna real `reingresa_stock` (true=cliente).
const TIPO_TABS = [
  { id: "cliente", label: "Devoluciones de cliente", reingresa: true },
  { id: "proveedor", label: "Devoluciones a proveedor", reingresa: false },
];

export default function DevolucionHistorial() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";

  const { sedes } = useSedes();

  const [devoluciones, setDevoluciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("cliente");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  // Cache del último "texto → ids de producto": evita resolverlo dos veces
  // para la misma búsqueda.
  const idsCacheRef = useRef({ texto: null, ids: [] });

  const reingresa = tab === "cliente";

  // Los campos se MEMOIZAN: `useFiltros` deriva `valoresAplicados` de ellos y,
  // si el array se recreara en cada render, el efecto de carga entraría en bucle.
  const campos = useMemo(
    () => [
      {
        id: "q",
        tipo: "texto",
        label: "Buscar",
        // Sin `columnas`: el texto se aplica a mano dentro de `cargarDevoluciones`,
        // porque nombre y referencia del producto viven en otra tabla y hay que
        // resolverlos a `producto_id` antes de poder cruzarlos con `motivo`.
        debounce: 400,
      },
      {
        id: "rango",
        tipo: "fecha",
        label: "Fecha",
        columna: "fecha",
        presets: ["hoy", "semana", "mes", "mesPasado"],
      },
      {
        id: "sede",
        tipo: "opciones",
        label: "Sede",
        columna: "sede_id",
        // Solo Admin: a los demás la RLS ya los ata a su sede.
        visible: esAdmin,
        opciones: sedes.map((s) => ({ v: s.id, l: s.nombre })),
      },
    ],
    [esAdmin, sedes],
  );

  const f = useFiltros({ clave: "devoluciones", campos });
  const texto = (f.valoresAplicados.q ?? "").trim();

  /** Ids de productos que empatan con el texto (todas las palabras). */
  const buscarProductoIds = async (raw) => {
    if (idsCacheRef.current.texto === raw) return idsCacheRef.current.ids;
    let q = supabase.from("productos").select("id");
    for (const term of keywordTerms(raw)) {
      q = q.or(`nombre.ilike.%${term}%,referencia.ilike.%${term}%`);
    }
    const { data, error } = await q.limit(PRODUCTOS_MATCH_MAX);
    const ids = error ? [] : (data ?? []).map((p) => p.id);
    idsCacheRef.current = { texto: raw, ids };
    return ids;
  };

  const cargarDevoluciones = async (reset = false) => {
    const myReq = f.nuevoReqId();
    setLoading(true);
    setErrorMsg(null);
    const currentPage = reset ? 0 : page;
    try {
      // El ÚNICO paso async al armar la consulta es resolver el texto de
      // búsqueda por nombre/referencia a ids de producto. Se hace ANTES de tocar
      // el query builder: NUNCA se debe `await` un builder a medio armar, porque
      // el builder de supabase-js es "thenable" y el `await` lo EJECUTA — devuelve
      // {data,error,count} en vez del builder, y el siguiente `.order()` revienta
      // con "order is not a function". Ese era el bug de "no cargan las
      // devoluciones". `numero` es integer: un término numérico puro busca ESA
      // devolución (un ilike contra integer revienta en Postgres).
      const n = texto ? esNumeroPuro(texto) : null;
      const productoIds =
        texto && n == null ? await buscarProductoIds(texto) : null;

      let query = supabase
        .from("devoluciones")
        .select(COLS, { count: "exact" })
        .eq("reingresa_stock", reingresa);
      // Los no-Admin quedan atados a su sede (la RLS igual lo fuerza).
      if (!esAdmin) query = query.eq("sede_id", perfil?.sede_id);
      // Filtros de la barra (fecha, sede si es Admin).
      query = f.aplicar(query);

      // Texto a mano: nombre y referencia del producto viven en otra tabla y hay
      // que resolverlos a `producto_id` antes de cruzarlos con motivo/observaciones.
      if (texto) {
        if (n != null) {
          query = query.eq("numero", n);
        } else {
          for (const term of keywordTerms(texto)) {
            const ors = [
              `motivo.ilike.%${term}%`,
              `observaciones.ilike.%${term}%`,
            ];
            // Sin empates no se agrega: `in.()` vacío es sintaxis inválida.
            if (productoIds?.length)
              ors.push(`producto_id.in.(${productoIds.join(",")})`);
            query = query.or(ors.join(","));
          }
        }
      }

      query = query
        // Desempate obligatorio: sin él, el "Cargar más" puede repetir o
        // saltar devoluciones que comparten la misma fecha.
        .order("fecha", { ascending: false })
        .order("numero", { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      const { data, error, count } = await query;
      if (!f.esReqVigente(myReq)) return; // respuesta obsoleta
      if (error) throw error;

      const filas = data ?? [];
      if (reset) {
        setDevoluciones(filas);
        setPage(1);
      } else {
        setDevoluciones((prev) => [...prev, ...filas]);
        setPage((p) => p + 1);
      }
      const totalReal = count ?? 0;
      setTotal(totalReal);
      setHasMore((currentPage + 1) * PAGE_SIZE < totalReal);
    } catch (e) {
      if (f.esReqVigente(myReq)) {
        // Se SURFACEA la causa real (código/mensaje de PostgREST o de red). Antes
        // el aviso era genérico y la consola quedaba muda, así que un fallo real
        // (400 de PostgREST, 401, "Failed to fetch"...) no dejaba rastro para
        // diagnosticar. Ahora el operario ve el porqué y queda en consola.
        const detalle = [e?.code, e?.message].filter(Boolean).join(" · ");
        // eslint-disable-next-line no-console
        console.error("[devoluciones] no cargó:", e);
        setErrorMsg(
          detalle
            ? `No se pudieron cargar las devoluciones. (${detalle})`
            : "No se pudieron cargar las devoluciones.",
        );
      }
    } finally {
      if (f.esReqVigente(myReq)) setLoading(false);
    }
  };

  useEffect(() => {
    cargarDevoluciones(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.valoresAplicados, tab, esAdmin, perfil?.sede_id]);

  const enVista = devoluciones.length;
  const filtrando = f.hayFiltros;

  return (
    <div className="flex h-full flex-col animate-fade-in">
      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-start justify-between gap-4 border-b px-4 pb-4 pt-5 sm:px-7 sm:pt-6"
        style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
      >
        <div className="min-w-0 flex-1">
          <p
            className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em]"
            style={{ color: "var(--n-500)" }}
          >
            Operaciones · Post-venta
          </p>
          <h1
            className="m-0 text-[22px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--n-950)" }}
          >
            Devoluciones
          </h1>
          <p
            className="mt-1.5 text-[13px] leading-[1.5]"
            style={{ color: "var(--n-500)" }}
          >
            {loading && enVista === 0 ? (
              "cargando…"
            ) : (
              <>
                {/* El conteo es del FILTRO COMPLETO (count:'exact'), no de las
                    filas cargadas: antes decía "en vista" y el operario lo leía
                    como el total. */}
                <b
                  className="font-mono font-medium"
                  style={{ color: "var(--n-700)" }}
                >
                  {total}
                </b>{" "}
                {reingresa ? "de cliente" : "a proveedor"}
                {filtrando ? " (filtro)" : ""}
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <button
            onClick={() => navigate("/ops/devoluciones/nueva")}
            className="btn btn-pri"
            style={{ height: 48 }}
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            Nueva devolución
          </button>
        </div>
      </div>

      {/* ── Tabs duales por tipo (mapeadas a reingresa_stock) ───────── */}
      <div
        className="border-b px-4 pt-3 sm:px-7"
        style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
      >
        <div
          className="flex max-w-[520px] items-end border-b"
          style={{ borderColor: "var(--n-150)" }}
        >
          {TIPO_TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="relative -mb-px flex flex-1 items-center justify-center gap-2 border-b-2 px-4 text-[13px] font-medium transition-colors"
                style={{
                  height: 48,
                  borderColor: active ? "var(--p-600)" : "transparent",
                  backgroundColor: active ? "var(--p-50)" : "transparent",
                  color: active ? "var(--p-700)" : "var(--n-500)",
                  fontWeight: active ? 600 : 500,
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.color = "var(--n-950)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.color = "var(--n-500)";
                }}
              >
                <span
                  style={{
                    transform: t.id === "proveedor" ? "scaleX(-1)" : undefined,
                  }}
                >
                  <ArrowLeftCircle className="h-4 w-4" strokeWidth={2} />
                </span>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Barra de filtros ────────────────────────────────────────── */}
      <div
        className="px-4 py-3 sm:px-7"
        style={{ backgroundColor: "var(--n-25)" }}
      >
        <BarraFiltros
          filtros={f}
          placeholder="Buscar por número, producto o motivo…"
          legacy
        />
      </div>

      {/* ── Contenido ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-4 pb-14 pt-3 sm:px-7">
        {errorMsg && (
          <div
            role="alert"
            className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border px-4 py-3 text-sm"
            style={{
              backgroundColor: "var(--dang-50)",
              borderColor: "var(--dang-border)",
              color: "var(--dang-700)",
            }}
          >
            <span className="min-w-0">{errorMsg}</span>
            {/* Botón de verdad: antes el texto decía "Reintenta" pero no había
                forma de reintentar sin recargar toda la página. */}
            <button
              onClick={() => cargarDevoluciones(true)}
              disabled={loading}
              className="shrink-0 rounded-[8px] border px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
              style={{
                borderColor: "var(--dang-border)",
                color: "var(--dang-700)",
              }}
            >
              {loading ? "Reintentando…" : "Reintentar"}
            </button>
          </div>
        )}

        {loading && enVista === 0 ? (
          <SkeletonList />
        ) : devoluciones.length === 0 ? (
          <EmptyState
            filtrando={filtrando}
            tipo={reingresa ? "de cliente" : "a proveedor"}
          />
        ) : (
          <>
            {/* Móvil/Tablet: cards (< md) */}
            <ul className="md:hidden space-y-2.5" role="list">
              {devoluciones.map((d) => (
                <li key={d.id}>
                  <DevolucionCard
                    devolucion={d}
                    onSelect={() => navigate(`/ops/devoluciones/${d.id}`)}
                  />
                </li>
              ))}
            </ul>

            {/* Desktop: tabla (≥ md) */}
            <div
              className="hidden md:block min-w-0 overflow-hidden rounded-[10px] border"
              style={{
                borderColor: "var(--n-150)",
                backgroundColor: "var(--n-0)",
              }}
            >
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      <Th width={92}>#</Th>
                      <Th width={110}>Fecha</Th>
                      <Th>Producto</Th>
                      <Th width={120}>{reingresa ? "Venta origen" : "—"}</Th>
                      <Th>Motivo</Th>
                      <Th width={130}>Registró</Th>
                      <Th width={100} right>
                        Stock
                      </Th>
                      <Th width={150}>Estado</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {devoluciones.map((d) => (
                      <DevolucionFila
                        key={d.id}
                        devolucion={d}
                        onSelect={() => navigate(`/ops/devoluciones/${d.id}`)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div
                className="flex items-center justify-between border-t px-5 py-3.5 text-xs"
                style={{
                  borderColor: "var(--n-150)",
                  backgroundColor: "var(--muted, var(--n-25))",
                  color: "var(--n-500)",
                }}
              >
                <span>
                  Mostrando{" "}
                  <b className="font-mono" style={{ color: "var(--n-700)" }}>
                    {enVista}
                  </b>{" "}
                  de{" "}
                  <b className="font-mono" style={{ color: "var(--n-700)" }}>
                    {total}
                  </b>{" "}
                  devoluciones {reingresa ? "de cliente" : "a proveedor"}
                </span>
                {hasMore && (
                  <span className="font-mono">
                    Carga las siguientes con &ldquo;Cargar más&rdquo;
                  </span>
                )}
              </div>
            </div>

            {/* Cargar más — antes se escondía al buscar (`!busqueda.trim()`),
                justo cuando más se necesita: la búsqueda filtra en memoria
                sobre lo ya cargado, así que sin este botón el operario no tenía
                forma de traer las páginas donde sí está lo que busca, y la
                pantalla le decía "no hay resultados" sobre datos existentes. */}
            {hasMore && (
              <button
                onClick={() => cargarDevoluciones(false)}
                disabled={loading}
                className="btn btn-out mt-4 w-full justify-center disabled:opacity-50"
                style={{ height: 48 }}
              >
                {loading ? "Cargando…" : "Cargar más"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function Th({ children, width, right }) {
  return (
    <th
      style={{ width, backgroundColor: "var(--n-50)", color: "var(--n-500)" }}
      className={
        "whitespace-nowrap border-b px-3 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] " +
        (right ? "text-right" : "text-left")
      }
    >
      {children}
    </th>
  );
}

function Td({ children, right }) {
  return (
    <td
      className={
        "border-b px-3 py-2.5 align-top " + (right ? "text-right" : "")
      }
      style={{ borderColor: "var(--n-100)" }}
    >
      {children}
    </td>
  );
}

function DevolucionFila({ devolucion: d, onSelect }) {
  const tipo = devolucionTipoPill(d.reingresa_stock);
  const signo = devolucionSigno(d.reingresa_stock);
  return (
    <tr
      className="h-14 cursor-pointer"
      onClick={onSelect}
      onMouseEnter={(e) =>
        (e.currentTarget.style.backgroundColor = "var(--n-25)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
    >
      <Td>
        <span
          className="font-mono text-[12.5px] font-medium"
          style={{ color: "var(--p-700)" }}
        >
          #{d.numero}
        </span>
      </Td>
      <Td>
        <span
          className="font-mono text-[11.5px]"
          style={{ color: "var(--n-500)" }}
        >
          {formatDate(d.fecha)}
        </span>
      </Td>
      <Td>
        <div className="flex min-w-0 flex-col leading-tight">
          <span
            className="flex items-center gap-1.5 text-[13px] font-medium"
            style={{ color: "var(--n-950)" }}
          >
            {d.producto?.nombre ?? "—"}
            <span className={tipo.cls}>
              <span className="dot" />
              {tipo.label}
            </span>
          </span>
          <span
            className="font-mono text-[11px]"
            style={{ color: "var(--n-500)" }}
          >
            {d.producto?.referencia ?? ""}
          </span>
        </div>
      </Td>
      <Td>
        {/* La tabla real solo vincula venta_id (devoluciones de cliente). Para
            proveedor no existe OC ligada en el modelo actual → guion honesto. */}
        {d.reingresa_stock && d.venta?.numero ? (
          <span className="link-pill v">V-{d.venta.numero}</span>
        ) : (
          <span style={{ color: "var(--n-300)" }}>—</span>
        )}
      </Td>
      <Td>
        <span
          className="block max-w-[260px] truncate text-[12.5px]"
          style={{ color: "var(--n-700)" }}
          title={d.motivo ?? undefined}
        >
          {d.motivo ?? "—"}
        </span>
      </Td>
      <Td>
        <span style={{ color: "var(--n-700)" }}>
          {d.registrador?.nombre ?? "—"}
        </span>
      </Td>
      <Td right>
        <span
          className="font-mono font-semibold tabular-nums"
          style={{
            color: d.reingresa_stock ? "var(--succ-700)" : "var(--warn-700)",
          }}
        >
          {signo}
          {d.cantidad}
        </span>
      </Td>
      <Td>
        <span className={devolucionEstadoClass(d.estado)}>
          <span
            className={`dot ${devolucionPulse(d.estado) ? "animate-pulse" : ""}`}
          />
          {devolucionEstadoLabel(d.estado)}
        </span>
      </Td>
    </tr>
  );
}

function DevolucionCard({ devolucion: d, onSelect }) {
  const tipo = devolucionTipoPill(d.reingresa_stock);
  const signo = devolucionSigno(d.reingresa_stock);
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full rounded-[10px] border px-4 py-3.5 text-left shadow-sm"
      style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span
              className="font-mono text-[12px] font-medium"
              style={{ color: "var(--p-700)" }}
            >
              #{d.numero}
            </span>
            <span className={tipo.cls}>
              <span className="dot" />
              {tipo.label}
            </span>
            <span className={devolucionEstadoClass(d.estado)}>
              <span
                className={`dot ${devolucionPulse(d.estado) ? "animate-pulse" : ""}`}
              />
              {devolucionEstadoLabel(d.estado)}
            </span>
          </div>
          <p
            className="truncate text-[14px] font-medium leading-tight"
            style={{ color: "var(--n-950)" }}
          >
            {d.producto?.nombre ?? "—"}
          </p>
          {d.reingresa_stock && d.venta?.numero && (
            <p className="mt-1">
              <span className="link-pill v">V-{d.venta.numero}</span>
            </p>
          )}
          <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--n-500)" }}>
            {formatDate(d.fecha)}
            {d.motivo && ` · ${d.motivo}`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span
            className="font-mono text-[18px] font-semibold tabular-nums"
            style={{
              color: d.reingresa_stock ? "var(--succ-700)" : "var(--warn-700)",
            }}
          >
            {signo}
            {d.cantidad}
          </span>
        </div>
      </div>
    </button>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-3">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-[10px] border p-4"
          style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
        >
          <div className="flex justify-between">
            <div className="flex-1 space-y-2">
              <div
                className="h-4 w-1/4 rounded"
                style={{ backgroundColor: "var(--n-100)" }}
              />
              <div
                className="h-3 w-1/2 rounded"
                style={{ backgroundColor: "var(--n-100)" }}
              />
            </div>
            <div
              className="ml-3 h-6 w-16 rounded"
              style={{ backgroundColor: "var(--n-100)" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ filtrando, tipo }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <div
        className="mb-4 grid h-14 w-14 place-items-center rounded-[12px]"
        style={{ backgroundColor: "var(--p-50)", color: "var(--p-600)" }}
      >
        <Undo2 className="h-7 w-7" strokeWidth={1.5} />
      </div>
      <p className="font-semibold" style={{ color: "var(--n-950)" }}>
        {filtrando
          ? "Sin devoluciones para la búsqueda"
          : `Sin devoluciones ${tipo} registradas`}
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--n-500)" }}>
        {filtrando
          ? "Prueba con otro número, producto o motivo"
          : "Las devoluciones aparecerán aquí una vez registradas"}
      </p>
    </div>
  );
}
