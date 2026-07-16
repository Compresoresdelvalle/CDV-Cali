import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, ShoppingCart } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate } from "../../lib/utils";
import { useFiltros } from "../../hooks/useFiltros";
import { useSedes } from "../../hooks/useSedes";
import BarraFiltros from "../../components/filtros/BarraFiltros";
import {
  METODOS_PAGO_VENTA,
  metodoPagoClass,
  ventaEstadoClass,
  ventaEstadoLabel,
  inicialesNombre,
  avatarVariant,
  resumenProductos,
} from "../../lib/ventas-ui";

const PAGE_SIZE = 20;

// Join read-only a detalle_venta para derivar el resumen de productos
// (columna del diseño Lovable). NO modifica lógica de escritura.
const COLS = `id, numero, fecha, cliente_nombre, metodo_pago, total, anulada, sede_id,
   vendedor:vendedor_id(nombre),
   detalle_venta(producto:producto_id(nombre))`;

// Tope de filas que se traen para sumar los KPIs del encabezado. El conteo real
// viene de `count: 'exact'`; si el filtro supera este tope, la suma se rotula
// como aproximada en vez de mentir.
const RESUMEN_MAX = 2000;

// #S1-17: "hoy" se calcula en America/Bogota explícito, no en la zona del
// dispositivo (tablets industriales sin sincronizar reloj daban conteos mal).
const diaBogota = (d) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(d));

export default function VentaHistorial() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";

  const { sedes } = useSedes();
  const [vendedores, setVendedores] = useState([]);

  const [ventas, setVentas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [resumen, setResumen] = useState({
    facturado: 0,
    hoy: 0,
    aprox: false,
  });
  const resumenReqRef = useRef(0);

  // Vendedores reales para el filtro. Los técnicos/bodegueros no venden, así
  // que el desplegable solo lista quienes pueden aparecer en `vendedor_id`.
  useEffect(() => {
    let vigente = true;
    supabase
      .from("usuarios")
      .select("id, nombre")
      .eq("activo", true)
      .in("rol", ["Vendedor", "Admin"])
      .order("nombre")
      .then(({ data }) => {
        if (vigente) setVendedores(data ?? []);
      });
    return () => {
      vigente = false;
    };
  }, []);

  // Los campos se MEMOIZAN: `useFiltros` deriva `valoresAplicados` de ellos y,
  // si el array se recreara en cada render, el efecto de carga se dispararía en
  // bucle.
  const campos = useMemo(
    () => [
      {
        id: "q",
        tipo: "texto",
        label: "Buscar",
        // OJO: `cliente_id` solo está poblado en 38 de 837 ventas — el cliente
        // se busca por el nombre denormalizado, que sí está en casi todas.
        columnas: ["cliente_nombre", "cliente_nit"],
        numericoA: "numero",
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
        id: "metodo",
        tipo: "opciones",
        label: "Método de pago",
        columna: "metodo_pago",
        // #S1-14: `ilike` exacto (insensible a mayúsculas) para que variantes de
        // casing heredadas ('efectivo' vs 'Efectivo') no dejen ventas invisibles.
        comparador: "ilike-exacto",
        opciones: METODOS_PAGO_VENTA.filter((m) => m !== "Todos").map((m) => ({
          v: m,
          l: m,
        })),
      },
      {
        id: "estado",
        tipo: "opciones",
        label: "Estado",
        columna: "anulada",
        opciones: [
          { v: "false", l: "Completadas" },
          { v: "true", l: "Anuladas" },
        ],
      },
      {
        id: "origen",
        tipo: "opciones",
        label: "Origen",
        columna: "origen",
        opciones: [
          { v: "directa", l: "Venta directa" },
          { v: "ot", l: "Orden de trabajo" },
        ],
      },
      {
        id: "vendedor",
        tipo: "opciones",
        label: "Vendedor",
        columna: "vendedor_id",
        opciones: vendedores.map((v) => ({ v: v.id, l: v.nombre })),
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
    [esAdmin, sedes, vendedores],
  );

  const f = useFiltros({ clave: "ventas", campos });

  const metodoActivo = f.valores.metodo || "Todos";

  /** Filtros de la pantalla + el recorte por sede de los no-Admin. */
  const aplicarBase = (q) => {
    let out = q;
    if (!esAdmin) out = out.eq("sede_id", perfil.sede_id);
    return f.aplicar(out);
  };

  const cargarVentas = async (reset = false) => {
    const myReq = f.nuevoReqId();
    setLoading(true);
    const currentPage = reset ? 0 : page;

    try {
      let query = supabase.from("ventas").select(COLS, { count: "exact" });
      query = aplicarBase(query);
      query = query
        // Desempate obligatorio: con solo `fecha`, dos ventas del mismo
        // instante pueden reordenarse entre páginas y el "Cargar más" repite
        // o salta filas.
        .order("fecha", { ascending: false })
        .order("numero", { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      const { data, error, count } = await query;
      if (!f.esReqVigente(myReq)) return;
      if (error) throw error;

      const filas = data ?? [];
      if (reset) {
        setVentas(filas);
        setPage(1);
      } else {
        setVentas((prev) => [...prev, ...filas]);
        setPage((p) => p + 1);
      }
      const totalReal = count ?? 0;
      setTotal(totalReal);
      setHasMore((currentPage + 1) * PAGE_SIZE < totalReal);
    } catch {
      // ignore
    } finally {
      if (f.esReqVigente(myReq)) setLoading(false);
    }
  };

  // KPIs sobre TODO el filtro, no sobre la página cargada: el encabezado decía
  // "facturado" sumando 20 ventas de 837.
  const cargarResumen = async () => {
    const myReq = ++resumenReqRef.current;
    try {
      let query = supabase.from("ventas").select("total, anulada, fecha");
      query = aplicarBase(query);
      const { data, error } = await query.range(0, RESUMEN_MAX - 1);
      if (myReq !== resumenReqRef.current || error) return;
      const filas = data ?? [];
      const hoyStr = diaBogota(new Date());
      setResumen({
        facturado: filas
          .filter((v) => !v.anulada)
          .reduce((s, v) => s + Number(v.total ?? 0), 0),
        hoy: filas.filter((v) => v.fecha && diaBogota(v.fecha) === hoyStr)
          .length,
        aprox: filas.length === RESUMEN_MAX,
      });
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    cargarVentas(true);
    cargarResumen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.valoresAplicados, esAdmin, perfil?.sede_id]);

  return (
    <div className="flex h-full flex-col animate-fade-in">
      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-start justify-between gap-4 border-b px-4 pb-4 pt-5 sm:px-7 sm:pt-6"
        style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
      >
        <div className="min-w-0 flex-1">
          <h1
            className="m-0 text-[22px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--n-950)" }}
          >
            Ventas
          </h1>
          <p
            className="mt-1.5 text-[13px] leading-[1.5]"
            style={{ color: "var(--n-500)" }}
          >
            {loading && ventas.length === 0 ? (
              "cargando…"
            ) : (
              <>
                {/* Los tres números son del FILTRO COMPLETO, no de lo cargado:
                    `total` viene de count:'exact' y el dinero de `cargarResumen`.
                    Antes el encabezado sumaba las 20 filas en pantalla y lo
                    llamaba "facturado". */}
                <b
                  className="font-mono font-medium"
                  style={{ color: "var(--n-700)" }}
                >
                  {total}
                </b>{" "}
                {total === 1 ? "venta" : "ventas"}
                {f.hayFiltros ? " (filtro)" : ""} ·{" "}
                <b
                  className="font-mono font-medium"
                  style={{ color: "var(--n-700)" }}
                >
                  {resumen.aprox ? "≈ " : ""}
                  {formatCOP(resumen.facturado)}
                </b>{" "}
                facturado
                {resumen.aprox ? ` (primeras ${RESUMEN_MAX})` : ""} ·{" "}
                <b
                  className="font-mono font-medium"
                  style={{ color: "var(--n-700)" }}
                >
                  {resumen.hoy}
                </b>{" "}
                hoy
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <button
            onClick={() => navigate("/ops/ventas/nueva")}
            className="btn btn-pri"
            style={{ height: 48 }}
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            Nueva venta
          </button>
        </div>
      </div>

      {/* ── Tabs por método de pago ─────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center gap-1.5 border-b px-4 py-3 sm:px-7"
        style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
      >
        {METODOS_PAGO_VENTA.map((m) => {
          const active = metodoActivo === m;
          return (
            <button
              key={m}
              // Las tabs son el mismo campo `metodo` de useFiltros: se cruzan
              // con el resto de filtros y quedan en el chip, en vez de ser un
              // filtro paralelo de un solo uso.
              onClick={() => f.setValor("metodo", m === "Todos" ? "" : m)}
              className="rounded-md px-3 text-[12.5px] font-medium transition-colors"
              style={{
                minHeight: 36,
                backgroundColor: active ? "var(--p-50)" : "transparent",
                color: active ? "var(--p-700)" : "var(--n-500)",
              }}
              onMouseEnter={(e) => {
                if (!active)
                  e.currentTarget.style.backgroundColor = "var(--n-50)";
              }}
              onMouseLeave={(e) => {
                if (!active)
                  e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              {m}
            </button>
          );
        })}
      </div>

      {/* ── Filtros ─────────────────────────────────────────────────────
          La búsqueda es SERVER-SIDE: antes filtraba en memoria sobre las 20
          filas cargadas y le decía "sin resultados" al vendedor sobre ventas
          que sí existían. La fecha dejó de competir con el texto: ahora son
          campos distintos y se cruzan. */}
      <div
        className="px-4 py-3 sm:px-7"
        style={{ backgroundColor: "var(--n-25)" }}
      >
        <BarraFiltros
          filtros={f}
          legacy
          placeholder="Buscar por número de venta, cliente o NIT…"
        />
      </div>

      {/* ── Contenido ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-4 pb-14 pt-3 sm:px-7">
        {loading && ventas.length === 0 ? (
          <SkeletonList />
        ) : ventas.length === 0 ? (
          // Con la búsqueda en el servidor, "sin resultados" ya es la verdad
          // sobre TODAS las ventas, no sobre las 20 cargadas. Por eso desapareció
          // el botón "cargar más para seguir buscando" (#S1-06): existía solo
          // porque el filtro era en memoria y el registro buscado podía estar en
          // una página no cargada.
          <EmptyState filtrando={f.hayFiltros} />
        ) : (
          <>
            {/* Móvil/Tablet: cards (< md) */}
            <ul className="md:hidden space-y-2.5" role="list">
              {ventas.map((v) => (
                <li key={v.id}>
                  <VentaCard
                    venta={v}
                    esAdmin={esAdmin}
                    onClick={() => navigate(`/ops/ventas/${v.id}`)}
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
                      <Th width={88}>#</Th>
                      <Th width={140}>Fecha</Th>
                      <Th>Cliente</Th>
                      <Th width={220}>Productos</Th>
                      <Th width={150}>Vendedor</Th>
                      <Th width={130}>Método pago</Th>
                      <Th width={130} right>
                        Total
                      </Th>
                      <Th width={110}>Recibo</Th>
                      <Th width={110}>Estado</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {ventas.map((v) => (
                      <VentaFila
                        key={v.id}
                        venta={v}
                        onClick={() => navigate(`/ops/ventas/${v.id}`)}
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
                    {ventas.length}
                  </b>{" "}
                  de{" "}
                  <b className="font-mono" style={{ color: "var(--n-700)" }}>
                    {total}
                  </b>{" "}
                  ventas
                </span>
                {hasMore && (
                  <span className="font-mono">
                    Carga las siguientes con &ldquo;Cargar más&rdquo;
                  </span>
                )}
              </div>
            </div>

            {/* Cargar más — visible también con búsqueda de texto activa
                (#S1-06): así los registros de páginas no cargadas se alcanzan. */}
            {hasMore && (
              <button
                onClick={() => cargarVentas(false)}
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
        "whitespace-nowrap border-b px-3 py-2.5 align-middle " +
        (right ? "text-right" : "")
      }
      style={{ borderColor: "var(--n-100)" }}
    >
      {children}
    </td>
  );
}

function VentaFila({ venta: v, onClick }) {
  const vendedorNombre = v.vendedor?.nombre ?? "—";
  const resumen = resumenProductos(v.detalle_venta);
  return (
    <tr
      onClick={onClick}
      className="h-12 cursor-pointer transition-colors"
      onMouseEnter={(e) =>
        (e.currentTarget.style.backgroundColor = "var(--n-50)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
    >
      <Td>
        <span
          className="font-mono text-[12.5px] font-medium"
          style={{ color: "var(--p-700)" }}
        >
          #{v.numero}
        </span>
      </Td>
      <Td>
        <span
          className="font-mono text-[11.5px]"
          style={{ color: "var(--n-500)" }}
        >
          {formatDate(v.fecha)}
        </span>
      </Td>
      <Td>
        <span className="font-medium" style={{ color: "var(--n-950)" }}>
          {v.cliente_nombre || "Cliente mostrador"}
        </span>
      </Td>
      <Td>
        <span
          className="block max-w-[200px] truncate text-[12.5px]"
          style={{ color: "var(--n-700)" }}
          title={resumen ?? undefined}
        >
          {resumen ?? "—"}
        </span>
      </Td>
      <Td>
        <span
          className="inline-flex items-center gap-2"
          style={{ color: "var(--n-700)" }}
        >
          <span className={`av-mini ${avatarVariant(vendedorNombre)}`}>
            {inicialesNombre(vendedorNombre)}
          </span>
          {vendedorNombre}
        </span>
      </Td>
      <Td>
        <span className={`pay-pill ${metodoPagoClass(v.metodo_pago)}`}>
          <span className="dot" />
          {v.metodo_pago}
        </span>
      </Td>
      <Td right>
        <span
          className="font-mono font-medium tabular-nums"
          style={{
            color: v.anulada ? "var(--n-300)" : "var(--n-950)",
            textDecoration: v.anulada ? "line-through" : "none",
          }}
        >
          {formatCOP(v.total)}
        </span>
      </Td>
      <Td>
        {/* El backend no emite "recibo" propio de venta (sin tabla ligada a
            ventas); el comprobante real se imprime desde el detalle. Se
            muestra el N.º de venta como referencia del recibo POS. */}
        <span className="rec-pill">Rec #{v.numero}</span>
      </Td>
      <Td>
        <span className={`s-pill ${ventaEstadoClass(v.anulada)}`}>
          <span className="dot" />
          {ventaEstadoLabel(v.anulada)}
        </span>
      </Td>
    </tr>
  );
}

function VentaCard({ venta: v, esAdmin, onClick }) {
  const vendedorNombre = v.vendedor?.nombre ?? "—";
  const resumen = resumenProductos(v.detalle_venta);
  return (
    <button
      onClick={onClick}
      className="w-full rounded-[10px] border px-4 py-3.5 text-left shadow-sm transition-all duration-100 active:scale-[0.985] active:shadow-none"
      style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span
              className="font-mono text-[12px] font-medium"
              style={{ color: "var(--p-700)" }}
            >
              #{v.numero}
            </span>
            <span className={`s-pill ${ventaEstadoClass(v.anulada)}`}>
              <span className="dot" />
              {ventaEstadoLabel(v.anulada)}
            </span>
            <span className={`pay-pill ${metodoPagoClass(v.metodo_pago)}`}>
              <span className="dot" />
              {v.metodo_pago}
            </span>
          </div>
          <p
            className="truncate text-[14px] font-medium leading-tight"
            style={{ color: "var(--n-950)" }}
          >
            {v.cliente_nombre || "Cliente mostrador"}
          </p>
          {resumen && (
            <p
              className="mt-0.5 truncate text-[12px]"
              style={{ color: "var(--n-700)" }}
            >
              {resumen}
            </p>
          )}
          <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--n-500)" }}>
            {formatDate(v.fecha)}
            {esAdmin && v.vendedor && ` · ${vendedorNombre}`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className="font-mono text-[15px] font-semibold tabular-nums"
            style={{
              color: v.anulada ? "var(--n-300)" : "var(--n-950)",
              textDecoration: v.anulada ? "line-through" : "none",
            }}
          >
            {formatCOP(v.total)}
          </p>
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
              className="ml-3 h-6 w-24 rounded"
              style={{ backgroundColor: "var(--n-100)" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ filtrando, hayMas }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <div
        className="mb-4 grid h-14 w-14 place-items-center rounded-[12px]"
        style={{ backgroundColor: "var(--p-50)", color: "var(--p-600)" }}
      >
        <ShoppingCart className="h-7 w-7" strokeWidth={1.5} />
      </div>
      <p className="font-semibold" style={{ color: "var(--n-950)" }}>
        {filtrando ? "Sin ventas para la búsqueda" : "Sin ventas registradas"}
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--n-500)" }}>
        {!filtrando
          ? "Las ventas aparecerán aquí una vez creadas"
          : hayMas
            ? "Puede estar en ventas aún no cargadas — toca “Cargar más” abajo"
            : "Prueba con otro número, cliente o producto"}
      </p>
    </div>
  );
}
