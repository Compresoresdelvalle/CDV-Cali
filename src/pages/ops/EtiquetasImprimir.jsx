import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Search,
  X,
  Package,
  QrCode,
  Printer,
  Download,
  ChevronDown,
  ChevronUp,
  Trash2,
  AlertTriangle,
  Check,
  Minus,
  Plus,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { sanitizeSearch, safeError } from "../../lib/utils";
import { avisarOk, avisarError } from "../../lib/notify";
import { useDebounce } from "../../hooks/useDebounce";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import PageHeader from "../../components/layout/PageHeader";
import {
  generarEtiquetasPDF,
  MAX_COPIAS_POR_PRODUCTO,
} from "../../lib/pdf/etiquetasPDF";

const PAGE_SIZE = 40;
// El tope viene del propio generador: así el operario ve el mismo límite ANTES
// de generar, en vez de que la librería le recorte la cantidad en silencio.
const MAX_COPIAS = MAX_COPIAS_POR_PRODUCTO;

const SELECT_COLS = "id, referencia, nombre, categoria";

/** Sin referencia (null / vacía / solo espacios) no se puede generar un QR
 * que identifique el producto — mismo criterio que `prepararProductos` en
 * etiquetasPDF.js. Se bloquea la selección ANTES en vez de dejar que el
 * usuario lo descubra en la lista de "omitidos" después de esperar el PDF. */
function tieneReferencia(p) {
  return typeof p?.referencia === "string" && p.referencia.trim().length > 0;
}

/**
 * Etiquetas · Imprimir — elige productos del catálogo y genera un PDF de
 * etiquetas QR (hoja carta en grilla o etiqueta suelta térmica).
 *
 * Solo Admin y Bodeguero (RoleGuard + entrada de menú). Deliberadamente NO
 * vive dentro de Inventario.jsx: esa vista es producto×sede, paginada y con
 * tope de resultados — la selección se perdería al cambiar de filtro y un
 * mismo producto se repetiría una vez por cada sede donde tiene stock.
 *
 * La selección se guarda como un Map (producto_id -> {referencia, nombre,
 * cantidad}), independiente de qué haya en pantalla en cada momento: buscar
 * "filtro", marcar 3, buscar "correa", marcar 2 más, deja 5 seleccionados.
 */
export default function EtiquetasImprimir() {
  const { confirm, ConfirmDialog } = useConfirm();

  // ── Búsqueda + filtro de categoría (server-side, debounce 400ms) ────────
  const [busqueda, setBusqueda] = useState("");
  const busquedaAplicada = useDebounce(busqueda, 400);
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [categorias, setCategorias] = useState([]);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(null);
  const pageRef = useRef(0);
  const reqIdRef = useRef(0);

  // ── Selección (sobrevive a cambios de búsqueda/categoría) ───────────────
  const [seleccion, setSeleccion] = useState(() => new Map());
  const [detalleAbierto, setDetalleAbierto] = useState(false);

  // ── Formato + generación ─────────────────────────────────────────────────
  const [formato, setFormato] = useState("hoja"); // "hoja" | "individual"
  const [generando, setGenerando] = useState(false);
  const [progreso, setProgreso] = useState(null); // { hechas, total }
  const [resultado, setResultado] = useState(null);
  const [firmaResultado, setFirmaResultado] = useState("");
  const [omitidosOcultos, setOmitidosOcultos] = useState(false);

  /* ── Categorías del catálogo activo (para el filtro atajo) ───────────── */
  useEffect(() => {
    let vigente = true;
    (async () => {
      const filas = [];
      // Paginado en bloques de 1000: PostgREST tope el resultado en 1000 filas
      // por defecto y el catálogo tiene ~2.000 productos activos.
      for (let pagina = 0; pagina < 5; pagina++) {
        const { data, error: err } = await supabase
          .from("productos")
          .select("categoria")
          .eq("activo", true)
          .not("categoria", "is", null)
          .order("categoria")
          .range(pagina * 1000, pagina * 1000 + 999);
        if (err || !vigente) break;
        const lote = data ?? [];
        filas.push(...lote);
        if (lote.length < 1000) break;
      }
      if (!vigente) return;
      const set = new Set(
        filas.map((f) => f.categoria?.trim()).filter(Boolean),
      );
      setCategorias([...set].sort((a, b) => a.localeCompare(b, "es")));
    })();
    return () => {
      vigente = false;
    };
  }, []);

  /* ── Búsqueda de productos ────────────────────────────────────────────── */
  const fetchProductos = useCallback(
    async (append) => {
      const reqId = ++reqIdRef.current;
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        pageRef.current = 0;
      }
      setError(null);
      try {
        const offset = append ? pageRef.current * PAGE_SIZE : 0;
        let q = supabase
          .from("productos")
          .select(SELECT_COLS, { count: "exact" })
          .eq("activo", true);

        const needle = sanitizeSearch(busquedaAplicada.trim());
        if (needle)
          q = q.or(`nombre.ilike.%${needle}%,referencia.ilike.%${needle}%`);
        if (categoriaFiltro) q = q.eq("categoria", categoriaFiltro);

        q = q
          .order("nombre", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);

        const { data, count, error: qErr } = await q;
        if (qErr) throw qErr;
        if (reqIdRef.current !== reqId) return; // respuesta obsoleta

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
        if (reqIdRef.current !== reqId) return;
        setError(safeError(err, "No se pudo cargar el catálogo"));
        if (!append) {
          setItems([]);
          setTotal(null);
        }
        setHasMore(false);
      } finally {
        if (reqIdRef.current === reqId) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [busquedaAplicada, categoriaFiltro],
  );

  useEffect(() => {
    fetchProductos(false);
  }, [fetchProductos]);

  const loadMore = useCallback(() => {
    if (hasMore && !loadingMore && !loading) fetchProductos(true);
  }, [hasMore, loadingMore, loading, fetchProductos]);

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

  /* ── Selección ─────────────────────────────────────────────────────────── */
  const toggle = (p) => {
    if (!tieneReferencia(p)) return;
    setSeleccion((prev) => {
      const next = new Map(prev);
      if (next.has(p.id)) next.delete(p.id);
      else
        next.set(p.id, {
          id: p.id,
          referencia: p.referencia,
          nombre: p.nombre,
          cantidad: 1,
        });
      return next;
    });
  };

  const setCantidad = (id, valor) => {
    const n = Math.min(MAX_COPIAS, Math.max(1, Math.round(Number(valor) || 1)));
    setSeleccion((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.set(id, { ...next.get(id), cantidad: n });
      return next;
    });
  };

  const quitar = (id) =>
    setSeleccion((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });

  const visiblesSeleccionables = useMemo(
    () => items.filter(tieneReferencia),
    [items],
  );
  const todosVisiblesOn =
    visiblesSeleccionables.length > 0 &&
    visiblesSeleccionables.every((p) => seleccion.has(p.id));

  const toggleVisibles = () => {
    setSeleccion((prev) => {
      const next = new Map(prev);
      if (todosVisiblesOn) {
        visiblesSeleccionables.forEach((p) => next.delete(p.id));
      } else {
        visiblesSeleccionables.forEach((p) => {
          if (!next.has(p.id))
            next.set(p.id, {
              id: p.id,
              referencia: p.referencia,
              nombre: p.nombre,
              cantidad: 1,
            });
        });
      }
      return next;
    });
  };

  const vaciarSeleccion = async () => {
    if (seleccion.size === 0) return;
    const ok = await confirm({
      titulo: "Vaciar selección",
      mensaje: `Se quitarán los ${seleccion.size} productos seleccionados. Esto no se puede deshacer.`,
      confirmLabel: "Vaciar selección",
      danger: true,
    });
    if (!ok) return;
    setSeleccion(new Map());
    setResultado(null);
  };

  const seleccionArr = useMemo(() => [...seleccion.values()], [seleccion]);
  const totalProductos = seleccion.size;
  const totalEtiquetas = seleccionArr.reduce((s, p) => s + p.cantidad, 0);

  /* ── Generación del PDF ───────────────────────────────────────────────── */
  // Firma de la selección + formato: si no cambió desde la última vez, se
  // reutiliza el PDF ya generado en vez de rehacer cientos de QR de nuevo
  // solo porque el usuario pasó de "Descargar" a "Abrir/Imprimir".
  const firmaActual = useMemo(() => {
    const partes = seleccionArr
      .map((p) => `${p.id}:${p.cantidad}`)
      .sort()
      .join(",");
    return `${formato}|${partes}`;
  }, [seleccionArr, formato]);

  // Generación en curso, guardada en un ref (no en estado): "Descargar" y
  // "Abrir/Imprimir" comparten esta promesa. El botón ya se deshabilita con
  // `generando`, pero ese estado tarda un tick en pintarse — este ref cierra
  // la ventana exacta que pregunta la auditoría (doble clic == doble PDF) sin
  // depender de que React ya haya repintado el disabled.
  const generacionEnCursoRef = useRef(null);

  const obtenerResultado = async () => {
    if (resultado && firmaResultado === firmaActual) return resultado;
    if (generacionEnCursoRef.current) return generacionEnCursoRef.current;

    setOmitidosOcultos(false);
    setGenerando(true);
    setProgreso({ hechas: 0, total: totalEtiquetas });

    const promesa = (async () => {
      try {
        const productos = seleccionArr.map((p) => ({
          referencia: p.referencia,
          nombre: p.nombre,
          cantidad: p.cantidad,
        }));
        const r = await generarEtiquetasPDF({
          productos,
          formato,
          onProgress: (hechas, totalGen) =>
            setProgreso({ hechas, total: totalGen }),
        });
        setResultado(r);
        setFirmaResultado(firmaActual);
        return r;
      } finally {
        setGenerando(false);
        generacionEnCursoRef.current = null;
      }
    })();

    generacionEnCursoRef.current = promesa;
    return promesa;
  };

  const handleDescargar = async () => {
    try {
      const r = await obtenerResultado();
      r.download();
      avisarOk(
        `${r.total} etiqueta${r.total === 1 ? "" : "s"} generada${r.total === 1 ? "" : "s"}` +
          (r.omitidos.length
            ? ` · ${r.omitidos.length} producto${r.omitidos.length === 1 ? "" : "s"} sin etiqueta`
            : ""),
      );
    } catch (err) {
      avisarError(err, "No se pudo generar el PDF de etiquetas");
    }
  };

  const handleAbrir = async () => {
    try {
      const r = await obtenerResultado();
      r.print();
    } catch (err) {
      avisarError(err, "No se pudo generar el PDF de etiquetas");
    }
  };

  const pctProgreso =
    progreso && progreso.total > 0
      ? Math.round((progreso.hechas / progreso.total) * 100)
      : 0;

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Etiquetas QR"
        description="Elige productos del catálogo y descarga el PDF de etiquetas para mandarlo a imprenta o imprimirlo tú mismo."
      />

      <ConfirmDialog />

      {error && (
        <div
          role="alert"
          className="rounded-xl border px-4 py-3 text-sm"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.08)",
            borderColor: "hsl(var(--destructive) / 0.3)",
            color: "hsl(var(--destructive))",
          }}
        >
          {error}
        </div>
      )}

      {/* ── Panel de selección + generación ──────────────────────────────── */}
      {totalProductos > 0 && (
        <section
          className="space-y-4 rounded-xl border p-4"
          style={{
            borderColor: "hsl(var(--primary) / 0.3)",
            backgroundColor: "hsl(var(--primary) / 0.06)",
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span
                className="font-semibold"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {totalProductos} producto{totalProductos === 1 ? "" : "s"}
              </span>
              <span style={{ color: "hsl(var(--muted-foreground))" }}>·</span>
              <span style={{ color: "hsl(var(--foreground))" }}>
                {totalEtiquetas} etiqueta{totalEtiquetas === 1 ? "" : "s"} en
                total
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setDetalleAbierto((v) => !v)}
                className="inline-flex h-11 items-center gap-1.5 rounded-md border px-3.5 text-[12.5px] font-medium cursor-pointer"
                style={{
                  borderColor: "hsl(var(--border))",
                  backgroundColor: "hsl(var(--card))",
                  color: "hsl(var(--foreground))",
                }}
              >
                Ver selección
                {detalleAbierto ? (
                  <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
                )}
              </button>
              <button
                onClick={vaciarSeleccion}
                className="inline-flex h-11 items-center gap-1.5 rounded-md border px-3.5 text-[12.5px] font-medium cursor-pointer"
                style={{
                  borderColor: "hsl(var(--destructive) / 0.35)",
                  color: "hsl(var(--destructive))",
                  backgroundColor: "hsl(var(--card))",
                }}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                Vaciar selección
              </button>
            </div>
          </div>

          {detalleAbierto && (
            <DetalleSeleccion
              items={seleccionArr}
              onCantidad={setCantidad}
              onQuitar={quitar}
            />
          )}

          {/* Formato: explicado en una frase, sin jerga de papelería. */}
          <div>
            <p
              className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Formato de impresión
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <FormatoOpcion
                seleccionado={formato === "hoja"}
                onClick={() => setFormato("hoja")}
                titulo="Hoja carta (grilla)"
                descripcion="32 etiquetas por hoja tamaño carta — para mandar a una imprenta o imprimir en una impresora normal."
              />
              <FormatoOpcion
                seleccionado={formato === "individual"}
                onClick={() => setFormato("individual")}
                titulo="Etiqueta individual"
                descripcion="Una etiqueta por página, del tamaño del rollo — para impresora térmica de etiquetas."
              />
            </div>
          </div>

          {generando && (
            <div>
              <div
                className="h-2 w-full overflow-hidden rounded-full"
                style={{ backgroundColor: "hsl(var(--muted) / 0.5)" }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${pctProgreso}%`,
                    backgroundColor: "hsl(var(--primary))",
                  }}
                />
              </div>
              <p
                className="mt-1.5 text-[12.5px]"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Generando etiqueta {progreso?.hechas ?? 0} de{" "}
                {progreso?.total ?? totalEtiquetas}… no cierres esta pantalla.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={handleDescargar}
              disabled={generando}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-md text-sm font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                backgroundColor: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
              }}
            >
              <Download className="h-4 w-4" strokeWidth={2} />
              {generando ? "Generando…" : "Descargar PDF"}
            </button>
            <button
              onClick={handleAbrir}
              disabled={generando}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-md border text-sm font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                borderColor: "hsl(var(--border))",
                backgroundColor: "hsl(var(--card))",
                color: "hsl(var(--foreground))",
              }}
            >
              <Printer className="h-4 w-4" strokeWidth={1.9} />
              Abrir / Imprimir
            </button>
          </div>

          {resultado &&
            !omitidosOcultos &&
            firmaResultado === firmaActual &&
            resultado.omitidos.length > 0 && (
              <BannerOmitidos
                omitidos={resultado.omitidos}
                onCerrar={() => setOmitidosOcultos(true)}
              />
            )}
        </section>
      )}

      {/* ── Búsqueda + categoría + atajos ────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 max-w-[380px]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
            style={{ color: "hsl(var(--muted-foreground))" }}
          />
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o referencia…"
            className="h-12 w-full rounded-lg border pl-9 pr-9 text-sm outline-none"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
          />
          {busqueda && (
            <button
              onClick={() => setBusqueda("")}
              aria-label="Limpiar búsqueda"
              className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded cursor-pointer"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          )}
        </div>

        {categorias.length > 0 && (
          <select
            value={categoriaFiltro}
            onChange={(e) => setCategoriaFiltro(e.target.value)}
            className="h-12 rounded-lg border px-2 text-sm"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
          >
            <option value="">Todas las categorías</option>
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}

        <button
          onClick={toggleVisibles}
          disabled={visiblesSeleccionables.length === 0}
          className="inline-flex h-12 items-center gap-1.5 rounded-md border px-3.5 text-[12.5px] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--card))",
            color: "hsl(var(--foreground))",
          }}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2} />
          {todosVisiblesOn ? "Quitar lo visible" : "Seleccionar lo visible"}
        </button>
      </div>

      {!loading && (
        <p
          className="text-xs"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {total ?? items.length} producto
          {(total ?? items.length) === 1 ? "" : "s"}
          {categoriaFiltro ? ` · ${categoriaFiltro}` : ""}
        </p>
      )}

      {/* ── Lista de resultados ──────────────────────────────────────────── */}
      {loading ? (
        <SkeletonList />
      ) : items.length === 0 ? (
        <Empty conFiltro={!!busqueda || !!categoriaFiltro} />
      ) : (
        <>
          {/* Móvil: cards */}
          <ul className="md:hidden space-y-2.5" role="list">
            {items.map((p) => (
              <li key={p.id}>
                <TarjetaProducto
                  producto={p}
                  seleccionado={seleccion.has(p.id)}
                  cantidad={seleccion.get(p.id)?.cantidad ?? 1}
                  onToggle={() => toggle(p)}
                  onCantidad={(v) => setCantidad(p.id, v)}
                />
              </li>
            ))}
          </ul>

          {/* Desktop: tabla */}
          <div
            className="hidden md:block overflow-x-auto rounded-xl border"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ backgroundColor: "hsl(var(--muted) / 0.3)" }}>
                  <Th width={44} />
                  <Th>Referencia</Th>
                  <Th>Producto</Th>
                  <Th width={140}>Categoría</Th>
                  <Th width={160} right>
                    Copias
                  </Th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <FilaProducto
                    key={p.id}
                    producto={p}
                    seleccionado={seleccion.has(p.id)}
                    cantidad={seleccion.get(p.id)?.cantidad ?? 1}
                    onToggle={() => toggle(p)}
                    onCantidad={(v) => setCantidad(p.id, v)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div ref={sentinelRef} className="h-4" />

      {loadingMore && (
        <div className="flex justify-center py-4">
          <div
            className="h-6 w-6 animate-spin rounded-full border-2"
            style={{
              borderColor: "hsl(var(--primary) / 0.25)",
              borderTopColor: "hsl(var(--primary))",
            }}
          />
        </div>
      )}

      {!loading && !loadingMore && !hasMore && items.length > 0 && (
        <p
          className="py-4 text-center font-mono text-[11px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          — {items.length} producto{items.length === 1 ? "" : "s"} —
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function CheckBox({ checked, onClick, ariaLabel, deshabilitado }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={deshabilitado}
      className="grid h-5 w-5 shrink-0 place-items-center rounded-[4px] border transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        borderColor: checked ? "hsl(var(--primary))" : "hsl(var(--border))",
        backgroundColor: checked ? "hsl(var(--primary))" : "transparent",
        color: "hsl(var(--primary-foreground))",
      }}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={2.75} />}
    </button>
  );
}

function QtyStepper({ value, onChange, size = "sm" }) {
  const h = size === "lg" ? "h-11 w-11" : "h-9 w-9";
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        aria-label="Restar una copia"
        className={`grid ${h} shrink-0 place-items-center rounded-md border cursor-pointer`}
        style={{
          borderColor: "hsl(var(--border))",
          color: "hsl(var(--foreground))",
        }}
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={1}
        max={MAX_COPIAS}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Cantidad de copias"
        className="h-9 w-14 rounded-md border text-center text-sm outline-none"
        style={{
          borderColor: "hsl(var(--border))",
          backgroundColor: "hsl(var(--card))",
          color: "hsl(var(--foreground))",
        }}
      />
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        aria-label="Sumar una copia"
        className={`grid ${h} shrink-0 place-items-center rounded-md border cursor-pointer`}
        style={{
          borderColor: "hsl(var(--border))",
          color: "hsl(var(--foreground))",
        }}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}

function FormatoOpcion({ seleccionado, onClick, titulo, descripcion }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-lg border p-3 text-left transition-colors cursor-pointer"
      style={{
        borderColor: seleccionado
          ? "hsl(var(--primary))"
          : "hsl(var(--border))",
        backgroundColor: seleccionado
          ? "hsl(var(--primary) / 0.08)"
          : "hsl(var(--card))",
      }}
    >
      <div className="mb-1 flex items-center gap-2">
        <span
          className="grid h-4 w-4 shrink-0 place-items-center rounded-full border"
          style={{
            borderColor: seleccionado
              ? "hsl(var(--primary))"
              : "hsl(var(--border))",
          }}
        >
          {seleccionado && (
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: "hsl(var(--primary))" }}
            />
          )}
        </span>
        <span
          className="text-sm font-semibold"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {titulo}
        </span>
      </div>
      <p
        className="text-[12.5px] leading-snug"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {descripcion}
      </p>
    </button>
  );
}

function DetalleSeleccion({ items, onCantidad, onQuitar }) {
  if (items.length === 0) return null;
  return (
    <div
      className="max-h-64 overflow-y-auto rounded-lg border"
      style={{
        borderColor: "hsl(var(--border))",
        backgroundColor: "hsl(var(--card))",
      }}
    >
      <ul className="divide-y" style={{ borderColor: "hsl(var(--border))" }}>
        {items.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
          >
            <div className="min-w-0">
              <p
                className="truncate text-sm font-medium"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {p.nombre}
              </p>
              <p
                className="truncate font-mono text-[11px]"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {p.referencia}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <QtyStepper
                value={p.cantidad}
                onChange={(v) => onCantidad(p.id, v)}
              />
              <button
                onClick={() => onQuitar(p.id)}
                aria-label={`Quitar ${p.nombre} de la selección`}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-md cursor-pointer"
                style={{ color: "hsl(var(--destructive))" }}
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p
        className="border-t px-3 py-2 text-[11px]"
        style={{
          borderColor: "hsl(var(--border))",
          color: "hsl(var(--muted-foreground))",
        }}
      >
        Máximo {MAX_COPIAS} copias por producto.
      </p>
    </div>
  );
}

function BannerOmitidos({ omitidos, onCerrar }) {
  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{
        backgroundColor: "hsl(var(--warning) / 0.08)",
        borderColor: "hsl(var(--warning) / 0.35)",
      }}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <p
          className="flex items-center gap-1.5 text-sm font-semibold"
          style={{ color: "hsl(var(--foreground))" }}
        >
          <AlertTriangle
            className="h-4 w-4 shrink-0"
            strokeWidth={1.75}
            style={{ color: "hsl(var(--warning))" }}
          />
          {omitidos.length} producto{omitidos.length === 1 ? "" : "s"} sin
          etiqueta
        </p>
        <button
          onClick={onCerrar}
          aria-label="Cerrar aviso"
          className="grid h-7 w-7 shrink-0 place-items-center rounded cursor-pointer"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
      <ul className="max-h-40 space-y-1 overflow-y-auto text-[12.5px]">
        {omitidos.map((o, i) => (
          <li key={i} style={{ color: "hsl(var(--muted-foreground))" }}>
            <span
              className="font-medium"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {o.nombre || "(sin nombre)"}
            </span>{" "}
            — {o.motivo}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Th({ children, width, right }) {
  return (
    <th
      style={{ width, color: "hsl(var(--muted-foreground))" }}
      className={
        "whitespace-nowrap border-b px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide " +
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
        "border-b px-3 py-2.5 align-middle text-sm " +
        (right ? "text-right" : "")
      }
      style={{ borderColor: "hsl(var(--border))" }}
    >
      {children}
    </td>
  );
}

function FilaProducto({
  producto: p,
  seleccionado,
  cantidad,
  onToggle,
  onCantidad,
}) {
  const habilitado = tieneReferencia(p);
  return (
    <tr
      style={{
        backgroundColor: seleccionado
          ? "hsl(var(--primary) / 0.06)"
          : "transparent",
      }}
    >
      <Td>
        <CheckBox
          checked={seleccionado}
          onClick={onToggle}
          ariaLabel={`Seleccionar ${p.nombre}`}
          deshabilitado={!habilitado}
        />
      </Td>
      <Td>
        <span
          className="font-mono text-[12.5px] font-medium"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {habilitado ? p.referencia : "Sin referencia"}
        </span>
      </Td>
      <Td>
        <div className="flex items-center gap-2">
          <Package
            className="h-3.5 w-3.5 shrink-0"
            strokeWidth={1.5}
            style={{ color: "hsl(var(--muted-foreground))" }}
          />
          <span style={{ color: "hsl(var(--foreground))" }}>{p.nombre}</span>
        </div>
        {!habilitado && (
          <span
            className="mt-0.5 block text-[11px]"
            style={{ color: "hsl(var(--warning))" }}
          >
            No se puede etiquetar: no tiene referencia
          </span>
        )}
      </Td>
      <Td>
        <span
          className="text-xs"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {p.categoria ?? "—"}
        </span>
      </Td>
      <Td right>
        {seleccionado ? (
          <div className="flex justify-end">
            <QtyStepper value={cantidad} onChange={onCantidad} />
          </div>
        ) : (
          <span style={{ color: "hsl(var(--muted-foreground))" }}>—</span>
        )}
      </Td>
    </tr>
  );
}

function TarjetaProducto({
  producto: p,
  seleccionado,
  cantidad,
  onToggle,
  onCantidad,
}) {
  const habilitado = tieneReferencia(p);
  return (
    <div
      className="w-full rounded-xl border px-4 py-3.5"
      style={{
        borderColor: "hsl(var(--border))",
        backgroundColor: seleccionado
          ? "hsl(var(--primary) / 0.06)"
          : "hsl(var(--card))",
      }}
    >
      <div className="flex items-start gap-3">
        <CheckBox
          checked={seleccionado}
          onClick={onToggle}
          ariaLabel={`Seleccionar ${p.nombre}`}
          deshabilitado={!habilitado}
        />
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-medium leading-tight"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {p.nombre}
          </p>
          <p
            className="mt-0.5 truncate font-mono text-[11px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {habilitado ? p.referencia : "Sin referencia"}
            {p.categoria ? ` · ${p.categoria}` : ""}
          </p>
          {!habilitado && (
            <span
              className="mt-1 block text-[11px]"
              style={{ color: "hsl(var(--warning))" }}
            >
              No se puede etiquetar: no tiene referencia
            </span>
          )}
        </div>
      </div>
      {seleccionado && (
        <div
          className="mt-3 flex items-center justify-between gap-2 border-t pt-3"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <span
            className="text-[11.5px] font-medium uppercase tracking-wide"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Copias
          </span>
          <QtyStepper value={cantidad} onChange={onCantidad} size="lg" />
        </div>
      )}
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2.5">
      {[...Array(6)].map((_, i) => (
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

function Empty({ conFiltro }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <div
        className="mb-4 grid h-14 w-14 place-items-center rounded-xl"
        style={{
          backgroundColor: "hsl(var(--muted) / 0.5)",
          color: "hsl(var(--muted-foreground))",
        }}
      >
        <QrCode className="h-7 w-7" strokeWidth={1.5} />
      </div>
      <p className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>
        Sin resultados
      </p>
      <p
        className="mt-1 text-sm"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {conFiltro
          ? "Ningún producto coincide con la búsqueda o la categoría."
          : "No hay productos activos en el catálogo."}
      </p>
    </div>
  );
}
