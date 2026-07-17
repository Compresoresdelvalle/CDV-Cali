import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, X, Package } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../stores/authStore";
import { useDebounce } from "../../hooks/useDebounce";
import { useFiltros } from "../../hooks/useFiltros";
import StatusBadge from "../../components/ui/StatusBadge";
import TipoProductoBadge from "../../components/inventario/TipoProductoBadge";
import { formatCOP, safeError } from "../../lib/utils";
import { categoriaClass } from "../../lib/inventario-ui";

const PAGE_SIZE = 30;

// Valores REALES del enum `tipo_producto` en la base (verificados contra
// pg_enum, no inventados): nuevo | segunda_mano | chatarra.
const TIPOS = [
  { v: "nuevo", l: "Nuevo" },
  { v: "segunda_mano", l: "Segunda mano" },
  { v: "chatarra", l: "Chatarra" },
];

/** '12000' -> 12000 · '' / basura -> null (no filtra). */
function aNumero(raw) {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const n = Number(t.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Columnas del producto maestro — mismas que consulta ProductoDetalle.jsx
// (catálogo, sin stock por sede).
const SELECT_COLS =
  "id, referencia, codigo_interno, codigo_proveedor, tipo, nombre, " +
  "categoria, marca, modelo, precio_venta, unidad_medida, activo";

/**
 * Raíz de una categoría, para agrupar la misma cosa escrita de varias formas.
 *
 * En el catálogo real conviven RODAMIENTOS/RODAMIENTO, CODOS/CODO,
 * FLAPPER/FLAPPERS, EMPAQUEES/EMPAQUE… Se normaliza a mayúsculas, sin tildes y
 * sin la terminación de plural. Verificado contra producción: agrupa 8 pares
 * reales y NO junta categorías distintas entre sí.
 *
 * Es a propósito conservador: si algún día une dos categorías que no deben ir
 * juntas, el síntoma es visible (aparecen mezcladas en el desplegable), no
 * silencioso como el problema que resuelve.
 */
function raizCategoria(cat) {
  return (cat ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita tildes
    .replace(/(OES|ES|S)$/, ""); // singulariza la terminación
}

/**
 * Catálogo maestro de productos — una fila por producto (sin stock por sede).
 * Lee la tabla real `productos` respetando RLS (sesión authenticated).
 */
export default function Productos() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(null);
  const [soloActivos, setSoloActivos] = useState(true);

  // El precio va en estado local (no en useFiltros): el hook resuelve texto,
  // fecha y opciones, y un rango numérico no es ninguno de los tres. Se aplica
  // aquí abajo, explícito, sobre el mismo query.
  const [precioMin, setPrecioMin] = useState("");
  const [precioMax, setPrecioMax] = useState("");
  const precioMinAplicado = useDebounce(precioMin, 400);
  const precioMaxAplicado = useDebounce(precioMax, 400);

  // `campos` DEBE memoizarse: useFiltros lo usa como dependencia, y un array
  // nuevo en cada render regeneraría `aplicar` -> refetch -> render -> bucle.
  const campos = useMemo(
    () => [
      {
        id: "q",
        tipo: "texto",
        label: "Buscar",
        // #32: mismas columnas de siempre — nombre/referencia/códigos.
        columnas: [
          "nombre",
          "referencia",
          "codigo_interno",
          "codigo_proveedor",
        ],
        debounce: 400,
      },
      {
        id: "tipo",
        tipo: "opciones",
        label: "Tipo",
        columna: "tipo",
        opciones: TIPOS,
      },
      {
        id: "vendible",
        tipo: "opciones",
        label: "Vendible",
        columna: "vendible",
        opciones: [
          { v: "true", l: "Solo vendibles" },
          { v: "false", l: "No vendibles" },
        ],
      },
    ],
    [],
  );

  const f = useFiltros({ clave: "productos", campos });
  const { aplicar, nuevoReqId, esReqVigente, valoresAplicados } = f;
  const busquedaAplicada = valoresAplicados.q ?? "";

  // ── Filtro de categoría ──────────────────────────────────────────────────
  // El catálogo tiene la misma categoría escrita de varias formas (verificado
  // en producción: RODAMIENTOS/RODAMIENTO, CODOS/CODO, FLAPPER/FLAPPERS…). Un
  // filtro que mandara `categoria = 'CODOS'` escondería los 3 productos
  // guardados como 'CODO' sin avisar: sería un filtro que miente, que es justo
  // el problema que esta campaña busca matar.
  //
  // Por eso el desplegable ofrece GRUPOS (una entrada por categoría real, no
  // por grafía) y al filtrar manda TODAS las grafías del grupo con `.in()`.
  // No se tocan los datos: la limpieza del catálogo es otra decisión.
  const [gruposCat, setGruposCat] = useState([]);
  const [catSel, setCatSel] = useState("");

  useEffect(() => {
    let vigente = true;
    (async () => {
      // Se leen las categorías del catálogo activo para armar los grupos.
      const filas = [];
      for (let pagina = 0; pagina < 10; pagina++) {
        const { data, error } = await supabase
          .from("productos")
          .select("categoria")
          .eq("activo", true)
          .not("categoria", "is", null)
          .order("categoria")
          .range(pagina * 1000, pagina * 1000 + 999);
        if (error) break;
        const lote = data ?? [];
        filas.push(...lote);
        if (lote.length < 1000) break;
      }
      if (!vigente) return;
      // Una sola pasada: por raíz, cuántos productos y cuántos por grafía.
      const porRaiz = new Map();
      for (const { categoria } of filas) {
        const cat = (categoria ?? "").trim();
        if (!cat) continue;
        const raiz = raizCategoria(cat);
        const g = porRaiz.get(raiz) ?? { grafias: new Map(), n: 0 };
        g.grafias.set(cat, (g.grafias.get(cat) ?? 0) + 1);
        g.n += 1;
        porRaiz.set(raiz, g);
      }
      setGruposCat(
        [...porRaiz.values()]
          .map((g) => {
            // Se muestra la grafía más usada del grupo: es la que el equipo
            // reconoce, aunque el filtro traiga todas por debajo.
            const [label] = [...g.grafias.entries()].sort(
              (a, b) => b[1] - a[1],
            )[0];
            return { label, grafias: [...g.grafias.keys()], n: g.n };
          })
          .sort((a, b) => a.label.localeCompare(b.label, "es")),
      );
    })();
    return () => {
      vigente = false;
    };
  }, []);

  const pageRef = useRef(0);

  const fetchProductos = useCallback(
    async (append) => {
      const reqId = nuevoReqId();
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        pageRef.current = 0;
      }
      setError(null);

      try {
        const offset = append ? pageRef.current * PAGE_SIZE : 0;
        // count: 'exact' -> el total lo dice el servidor. Contar lo cargado es
        // lo que hacía que la pantalla mintiera sobre cuántos productos hay.
        let q = supabase
          .from("productos")
          .select(SELECT_COLS, { count: "exact" });

        q = aplicar(q); // texto + tipo + vendible, cruzables entre sí.

        if (soloActivos) q = q.eq("activo", true);

        // Categoría por GRUPO: se mandan todas las grafías, no la elegida. Con
        // `.eq('categoria','CODOS')` se perderían los 3 guardados como 'CODO'.
        if (catSel) {
          const g = gruposCat.find((x) => x.label === catSel);
          if (g) q = q.in("categoria", g.grafias);
        }

        const min = aNumero(precioMinAplicado);
        const max = aNumero(precioMaxAplicado);
        if (min != null) q = q.gte("precio_venta", min);
        if (max != null) q = q.lte("precio_venta", max);

        q = q
          .order("nombre", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);

        const { data, count, error: qErr } = await q;
        if (qErr) throw qErr;

        // Descarta si llegó una respuesta más nueva mientras esperábamos.
        if (!esReqVigente(reqId)) return;

        const rows = data ?? [];
        if (append) {
          setItems((prev) => [...prev, ...rows]);
          pageRef.current += 1;
        } else {
          setItems(rows);
          pageRef.current = 1;
        }
        setTotal(count ?? null);
        const cargados = offset + rows.length;
        setHasMore(
          count != null ? cargados < count : rows.length === PAGE_SIZE,
        );
      } catch (err) {
        if (!esReqVigente(reqId)) return;
        setError(safeError(err, "No se pudo cargar el catálogo"));
        if (!append) {
          setItems([]);
          setTotal(null);
        }
        setHasMore(false);
      } finally {
        if (esReqVigente(reqId)) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [
      aplicar,
      nuevoReqId,
      esReqVigente,
      soloActivos,
      precioMinAplicado,
      precioMaxAplicado,
      catSel,
      gruposCat,
    ],
  );

  // Re-fetch al cambiar cualquier filtro. `fetchProductos(false)` reinicia la
  // página a 0, así que cada cambio de filtro arranca desde el principio.
  useEffect(() => {
    fetchProductos(false);
  }, [fetchProductos]);

  // Limpia TODO: los filtros del hook y el precio, que vive aparte.
  const limpiarTodo = useCallback(() => {
    f.limpiar();
    setPrecioMin("");
    setPrecioMax("");
    setSoloActivos(true);
    setCatSel("");
  }, [f]);

  // La categoría cuenta como filtro activo: si no, "Limpiar filtros" no
  // aparecería con una categoría puesta y el operario vería una lista recortada
  // sin nada que le dijera por qué.
  const hayFiltros =
    f.hayFiltros ||
    precioMin !== "" ||
    precioMax !== "" ||
    !soloActivos ||
    catSel !== "";

  const loadMore = useCallback(() => {
    if (hasMore && !loadingMore && !loading) fetchProductos(true);
  }, [hasMore, loadingMore, loading, fetchProductos]);

  // Infinite scroll
  const sentinelRef = useRef(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => {
      observer.unobserve(el);
      observer.disconnect();
    };
  }, [loadMore]);

  const handleItemClick = (id) => {
    if (id) navigate(`/ops/inventario/${id}`);
  };

  // Bloque 1 (#4): crear producto es exclusivo de Admin.
  const esAdmin = perfil?.rol === "Admin";

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-[18px] px-4 py-5 sm:px-7 sm:py-6 animate-fade-in">
      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em]"
            style={{ color: "var(--n-300)" }}
          >
            Operaciones · Catálogo maestro ·{" "}
            {loading
              ? "cargando…"
              : `${total ?? items.length} producto${(total ?? items.length) === 1 ? "" : "s"}`}{" "}
            · {soloActivos ? "activos" : "todos"}
          </p>
          <h1
            className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.018em]"
            style={{ color: "var(--n-950)" }}
          >
            Productos
          </h1>
        </div>
        {esAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/ops/inventario/nuevo")}
              className="btn btn-pri"
              style={{ height: 48 }}
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
              Nuevo producto
            </button>
          </div>
        )}
      </div>

      {/* ── Búsqueda ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-12 flex-1 items-center gap-2.5 rounded-lg border px-3.5"
          style={{ borderColor: "var(--n-200)", backgroundColor: "var(--n-0)" }}
        >
          <Search
            className="h-4 w-4 shrink-0"
            strokeWidth={1.5}
            style={{ color: "var(--n-500)" }}
          />
          <input
            type="search"
            value={f.valores.q ?? ""}
            onChange={(e) => f.setValor("q", e.target.value)}
            placeholder="Buscar por nombre o referencia…"
            className="flex-1 border-none bg-transparent text-[14px] outline-none"
            style={{ color: "var(--n-950)" }}
          />
          {f.valores.q && (
            <button
              onClick={() => f.setValor("q", "")}
              aria-label="Limpiar búsqueda"
              className="grid h-6 w-6 place-items-center rounded"
              style={{ color: "var(--n-500)" }}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>

      {/* ── Grid: filtros + tabla ───────────────────────────────────── */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Panel de filtros */}
        <aside
          className="flex flex-col gap-4 self-start rounded-[10px] border p-3.5 text-[12.5px]"
          style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
        >
          <div>
            <div
              className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
              style={{ color: "var(--n-500)" }}
            >
              Estado
            </div>
            <div className="flex flex-col gap-px">
              <FilterRow on={soloActivos} onClick={() => setSoloActivos(true)}>
                <Check on={soloActivos} />
                Solo activos
              </FilterRow>
              <FilterRow
                on={!soloActivos}
                onClick={() => setSoloActivos(false)}
              >
                <Check on={!soloActivos} />
                Incluir inactivos
              </FilterRow>
            </div>
          </div>

          {/* Categoría. Es un desplegable con buscador propio del navegador y
              no chips: son ~145 categorías y en chips no cabrían. Cada opción
              es un GRUPO, no una grafía (ver `raizCategoria`). */}
          {gruposCat.length > 0 && (
            <div>
              <div
                className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
                style={{ color: "var(--n-500)" }}
              >
                Categoría
              </div>
              <select
                value={catSel}
                onChange={(e) => setCatSel(e.target.value)}
                className="h-12 w-full rounded-[8px] border bg-transparent px-2 text-[12.5px] outline-none"
                style={{ borderColor: "var(--n-200)", color: "var(--n-950)" }}
              >
                <option value="">Todas</option>
                {gruposCat.map((g) => (
                  <option key={g.label} value={g.label}>
                    {g.label} ({g.n})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Tipo — valores reales del enum `tipo_producto`. Se cruzan con el
              resto: tipo + vendible + precio + búsqueda actúan a la vez. */}
          <GrupoFiltro titulo="Tipo">
            <FilterRow
              on={!f.valores.tipo}
              onClick={() => f.setValor("tipo", "")}
            >
              <Check on={!f.valores.tipo} />
              Todos
            </FilterRow>
            {TIPOS.map((t) => (
              <FilterRow
                key={t.v}
                on={f.valores.tipo === t.v}
                onClick={() => f.setValor("tipo", t.v)}
              >
                <Check on={f.valores.tipo === t.v} />
                {t.l}
              </FilterRow>
            ))}
          </GrupoFiltro>

          <GrupoFiltro titulo="Vendible">
            <FilterRow
              on={!f.valores.vendible}
              onClick={() => f.setValor("vendible", "")}
            >
              <Check on={!f.valores.vendible} />
              Todos
            </FilterRow>
            <FilterRow
              on={f.valores.vendible === "true"}
              onClick={() => f.setValor("vendible", "true")}
            >
              <Check on={f.valores.vendible === "true"} />
              Solo vendibles
            </FilterRow>
            <FilterRow
              on={f.valores.vendible === "false"}
              onClick={() => f.setValor("vendible", "false")}
            >
              <Check on={f.valores.vendible === "false"} />
              No vendibles
            </FilterRow>
          </GrupoFiltro>

          {/* Precio — se manda al servidor con gte/lte sobre precio_venta.
              Dejar uno vacío es válido: "desde 50.000" o "hasta 200.000". */}
          <GrupoFiltro titulo="Precio de venta">
            <div className="flex items-center gap-1.5">
              <PrecioInput
                value={precioMin}
                onChange={setPrecioMin}
                placeholder="Mín"
                aria-label="Precio mínimo"
              />
              <span className="text-[11px]" style={{ color: "var(--n-500)" }}>
                a
              </span>
              <PrecioInput
                value={precioMax}
                onChange={setPrecioMax}
                placeholder="Máx"
                aria-label="Precio máximo"
              />
            </div>
          </GrupoFiltro>

          {hayFiltros && (
            <button
              onClick={limpiarTodo}
              className="min-h-[44px] rounded-[5px] border text-[12.5px] font-medium transition-colors lg:min-h-[36px]"
              style={{ borderColor: "var(--n-200)", color: "var(--n-700)" }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = "var(--n-50)")
              }
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
            >
              Limpiar filtros
            </button>
          )}
        </aside>

        {/* Contenido */}
        <div className="min-w-0">
          {error && (
            <div
              className="mb-3 rounded-[10px] border p-4"
              style={{
                backgroundColor: "var(--dang-50)",
                borderColor: "var(--dang-border)",
              }}
            >
              <p
                className="text-sm font-medium"
                style={{ color: "var(--dang-700)" }}
              >
                Error al cargar el catálogo
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--dang-600)" }}>
                {error}
              </p>
            </div>
          )}

          {loading && <SkeletonList />}

          {!loading && items.length === 0 && !error && (
            <EmptyState filtroBusqueda={busquedaAplicada} />
          )}

          {!loading && items.length > 0 && (
            <>
              {/* Móvil/Tablet: cards (< md) */}
              <ul className="md:hidden space-y-2.5" role="list">
                {items.map((p) => (
                  <li key={p.id}>
                    <ProductoCard
                      producto={p}
                      onClick={() => handleItemClick(p.id)}
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
                <div
                  className="flex flex-wrap items-center gap-3 border-b px-4 py-3 text-[12.5px]"
                  style={{ borderColor: "var(--n-100)", color: "var(--n-500)" }}
                >
                  {/* El total lo dice el servidor (count: 'exact'), no lo
                      cargado: "30+ productos" cuando hay 412 es la clase de
                      dato que hace desconfiar de la pantalla entera. */}
                  <span>
                    <strong
                      className="font-mono font-semibold"
                      style={{ color: "var(--n-950)" }}
                    >
                      {total ?? items.length}
                    </strong>{" "}
                    producto{(total ?? items.length) === 1 ? "" : "s"}
                    {total != null && items.length < total && (
                      <span style={{ color: "var(--n-300)" }}>
                        {" "}
                        · {items.length} en vista
                      </span>
                    )}
                  </span>
                  <span>·</span>
                  <span>{soloActivos ? "activos" : "todos"}</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr>
                        <Th width={140}>Referencia</Th>
                        <Th>Producto</Th>
                        <Th width={130}>Categoría</Th>
                        <Th width={150}>Marca / Modelo</Th>
                        <Th width={110}>Estado</Th>
                        <Th width={120} right>
                          Precio
                        </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((p) => (
                        <ProductoFila
                          key={p.id}
                          producto={p}
                          onClick={() => handleItemClick(p.id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* Sentinel infinite scroll */}
          <div ref={sentinelRef} className="h-4" />

          {loadingMore && (
            <div className="flex justify-center py-4">
              <div
                className="h-6 w-6 animate-spin rounded-full border-2"
                style={{
                  borderColor: "var(--p-200)",
                  borderTopColor: "var(--p-600)",
                }}
              />
            </div>
          )}

          {!loading && !loadingMore && !hasMore && items.length > 0 && (
            <p
              className="py-4 text-center font-mono text-[11px]"
              style={{ color: "var(--n-300)" }}
            >
              — {items.length} productos —
            </p>
          )}
        </div>
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
        "border-b px-2.5 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] " +
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
      className={"border-b px-2.5 py-2.5 " + (right ? "text-right" : "")}
      style={{ borderColor: "var(--n-100)" }}
    >
      {children}
    </td>
  );
}

function GrupoFiltro({ titulo, children }) {
  return (
    <div>
      <div
        className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--n-500)" }}
      >
        {titulo}
      </div>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  );
}

/**
 * Entrada de precio. `inputMode="numeric"` saca el teclado numérico en tablet
 * (se usa con guantes); el saneo real de lo tecleado lo hace `aNumero`.
 */
function PrecioInput({ value, onChange, placeholder, ...rest }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-11 w-full min-w-0 rounded-[5px] border px-2 font-mono text-[12px] outline-none"
      style={{
        borderColor: "var(--n-200)",
        backgroundColor: "var(--n-0)",
        color: "var(--n-950)",
      }}
      {...rest}
    />
  );
}

function FilterRow({ on, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={
        "relative flex min-h-[44px] items-center justify-between gap-1.5 rounded-[5px] px-2 py-2.5 text-left text-[12.5px] leading-tight transition-colors lg:min-h-0 lg:py-1.5 " +
        (on
          ? "font-medium before:absolute before:left-[-8px] before:top-1 before:bottom-1 before:w-[2.5px] before:rounded-[1px]"
          : "")
      }
      style={
        on
          ? { backgroundColor: "var(--p-50)", color: "var(--p-700)" }
          : { color: "var(--n-700)" }
      }
      onMouseEnter={(e) => {
        if (!on) e.currentTarget.style.backgroundColor = "var(--n-50)";
      }}
      onMouseLeave={(e) => {
        if (!on) e.currentTarget.style.backgroundColor = "";
      }}
    >
      <span className="flex min-w-0 items-center gap-2">{children}</span>
      {on && (
        <span
          aria-hidden="true"
          className="absolute left-[-8px] top-1 bottom-1 w-[2.5px] rounded-[1px]"
          style={{ backgroundColor: "var(--p-500)" }}
        />
      )}
    </button>
  );
}

function Check({ on }) {
  return (
    <span
      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border-[1.5px]"
      style={
        on
          ? {
              borderColor: "var(--p-600)",
              backgroundColor: "var(--p-600)",
              color: "#fff",
            }
          : { borderColor: "var(--n-300)", backgroundColor: "var(--n-0)" }
      }
    >
      {on && <span className="text-[9px] font-bold leading-none">✓</span>}
    </span>
  );
}

function marcaModelo(p) {
  const parts = [p.marca, p.modelo].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

function ProductoFila({ producto: p, onClick }) {
  const inactivo = !p.activo;
  const ref = p.codigo_interno ?? p.referencia ?? "—";
  return (
    <tr
      onClick={onClick}
      className="cursor-pointer transition-colors"
      onMouseEnter={(e) =>
        (e.currentTarget.style.backgroundColor = "var(--n-50)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
    >
      <Td>
        <span
          className="whitespace-nowrap font-mono text-[12.5px] font-medium tracking-[-0.005em]"
          style={{ color: inactivo ? "var(--n-300)" : "var(--n-950)" }}
          title={
            p.codigo_proveedor ? `Proveedor: ${p.codigo_proveedor}` : undefined
          }
        >
          {ref}
          {p.codigo_proveedor && (
            <span style={{ color: "var(--n-300)" }}>
              {" "}
              / {p.codigo_proveedor}
            </span>
          )}
        </span>
      </Td>
      <Td>
        <div
          className={
            "font-medium leading-tight " + (inactivo ? "opacity-60" : "")
          }
          style={{ color: "var(--n-950)" }}
        >
          {p.nombre}
          <span
            className="mt-px block font-mono text-[11px] font-normal tracking-[0.04em]"
            style={{ color: "var(--n-500)" }}
          >
            {p.referencia ?? "—"}
          </span>
        </div>
      </Td>
      <Td>
        <span className={`bdg ${categoriaClass(p.categoria)}`}>
          {p.categoria ?? "—"}
        </span>
      </Td>
      <Td>
        <span style={{ color: "var(--n-700)" }}>{marcaModelo(p)}</span>
      </Td>
      <Td>
        <div className="flex items-center gap-1.5">
          {p.activo ? (
            <StatusBadge status="success">Activo</StatusBadge>
          ) : (
            <StatusBadge status="neutral">Inactivo</StatusBadge>
          )}
          <TipoProductoBadge tipo={p.tipo} />
        </div>
      </Td>
      <Td right>
        <span
          className="font-mono font-medium"
          style={{ color: inactivo ? "var(--n-300)" : "var(--n-950)" }}
        >
          {p.precio_venta != null ? formatCOP(p.precio_venta) : "—"}
        </span>
      </Td>
    </tr>
  );
}

function ProductoCard({ producto: p, onClick }) {
  const inactivo = !p.activo;
  const ref = p.codigo_interno ?? p.referencia ?? "—";
  return (
    <button
      onClick={onClick}
      className="w-full rounded-[10px] border px-4 py-3.5 text-left shadow-sm transition-all duration-100 active:scale-[0.985] active:shadow-none"
      style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className={
              "truncate text-[14px] font-medium leading-tight " +
              (inactivo ? "opacity-60" : "")
            }
            style={{ color: "var(--n-950)" }}
          >
            {p.nombre}
          </p>
          <p
            className="mt-0.5 font-mono text-[11px] tracking-[0.04em]"
            style={{ color: "var(--n-500)" }}
          >
            {ref}
            {p.codigo_proveedor && (
              <span style={{ opacity: 0.7 }}> · {p.codigo_proveedor}</span>
            )}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={`bdg ${categoriaClass(p.categoria)}`}>
              {p.categoria ?? "—"}
            </span>
            <span className="text-[11px]" style={{ color: "var(--n-500)" }}>
              {marcaModelo(p)}
            </span>
          </div>
          {p.precio_venta != null && (
            <p
              className="mt-1.5 font-mono text-[13px] font-semibold"
              style={{ color: "var(--n-950)" }}
            >
              {formatCOP(p.precio_venta)}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {p.activo ? (
            <StatusBadge status="success">Activo</StatusBadge>
          ) : (
            <StatusBadge status="neutral">Inactivo</StatusBadge>
          )}
          <TipoProductoBadge tipo={p.tipo} />
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
                className="h-4 w-3/4 rounded"
                style={{ backgroundColor: "var(--n-100)" }}
              />
              <div
                className="h-3 w-1/2 rounded"
                style={{ backgroundColor: "var(--n-100)" }}
              />
              <div
                className="h-3 w-1/3 rounded"
                style={{ backgroundColor: "var(--n-100)" }}
              />
            </div>
            <div
              className="ml-3 h-12 w-12 rounded-lg"
              style={{ backgroundColor: "var(--n-100)" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ filtroBusqueda }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <div
        className="mb-4 grid h-14 w-14 place-items-center rounded-[12px]"
        style={{ backgroundColor: "var(--p-50)", color: "var(--p-600)" }}
      >
        <Package className="h-7 w-7" strokeWidth={1.5} />
      </div>
      <p className="font-semibold" style={{ color: "var(--n-950)" }}>
        Sin resultados
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--n-500)" }}>
        {filtroBusqueda
          ? `No se encontraron productos para "${filtroBusqueda}"`
          : "No hay productos en el catálogo"}
      </p>
    </div>
  );
}
