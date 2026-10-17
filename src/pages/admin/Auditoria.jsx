import { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Shield,
  Search,
  Filter,
  TrendingUp,
  TrendingDown,
  SlidersHorizontal,
  RotateCcw,
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  Hash,
  MapPin,
  Calendar,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatDate, safeError, sanitizeSearch } from "../../lib/utils";
import {
  movimientoToken,
  movimientoLabel,
  movimientoModulo,
  iniciales,
  pillStyle,
  surfaceInputStyle,
  ORIGEN_FUENTES,
  etiquetaOrigen,
  rutaOrigen,
  precioUnicoDeLineas,
  valorMovimiento,
  textoValorMovimiento,
  formatPesos,
} from "../../lib/admin-ops-ui";
import { rutaDestino, textoConversionDestino } from "../../lib/insumo-destino";

// Destino de una conversión → referencia_tipo cuyo documento hay que resolver.
const DESTINO_A_REF = {
  orden: "orden_servicio",
  ensamble: "ensamble",
  prestamo: "herramienta",
};

/**
 * Resuelve en lote, para una página de movimientos: el documento de origen en
 * palabras, el destino de las conversiones a insumo y el valor en pesos.
 * Una consulta `.in()` por tipo de documento, nunca una por fila.
 * Devuelve Map(movimiento_id → { origen, destino, valor }).
 */
async function enriquecerMovimientos(items) {
  const out = new Map();
  if (items.length === 0) return out;

  // 1) Destinos de las conversiones a insumo. Si la tabla todavía no existe
  //    (migración sin aplicar) se sigue sin destino en vez de romper la página.
  const convIds = items
    .filter((m) => m.tipo === "conversion_a_insumo")
    .map((m) => m.id);
  const destinos = new Map();
  let destinosOk = false;
  if (convIds.length > 0) {
    const { data, error } = await supabase
      .from("conversion_destino")
      .select(
        "movimiento_id, tipo, orden_id, ensamble_id, prestamo_id, nota, inferido",
      )
      .in("movimiento_id", convIds);
    if (!error) {
      destinosOk = true;
      for (const d of data ?? []) destinos.set(d.movimiento_id, d);
    }
  }

  // 2) Ids a resolver por tipo de documento (origen + destino).
  const ids = {};
  const agregar = (ref, id) => {
    if (!id || !ORIGEN_FUENTES[ref]) return;
    (ids[ref] ??= new Set()).add(id);
  };
  for (const m of items) agregar(m.referencia_tipo, m.referencia_id);
  for (const d of destinos.values()) {
    agregar(DESTINO_A_REF[d.tipo], d[`${d.tipo}_id`]);
  }

  // 3) Valor: líneas de las ventas/compras y costo promedio del resto.
  const ventaIds = [...(ids.venta ?? [])];
  const compraIds = [...(ids.compra ?? [])];
  const prodCosto = [
    ...new Set(
      items
        .filter(
          (m) =>
            m.referencia_tipo !== "venta" && m.referencia_tipo !== "compra",
        )
        .map((m) => m.producto_id)
        .filter(Boolean),
    ),
  ];

  const docs = {};
  const consultas = Object.entries(ids).map(async ([ref, set]) => {
    const f = ORIGEN_FUENTES[ref];
    const { data, error } = await supabase
      .from(f.tabla)
      .select(f.select)
      .in("id", [...set]);
    docs[ref] = new Map(error ? [] : (data ?? []).map((r) => [r.id, r]));
  });
  let lineasVenta = [];
  let lineasCompra = [];
  let lineasOrden = [];
  let costos = new Map();
  if (ventaIds.length > 0) {
    consultas.push(
      supabase
        .from("detalle_venta")
        .select("venta_id, producto_id, precio_unitario")
        .in("venta_id", ventaIds)
        .then(({ data, error }) => {
          if (!error) lineasVenta = data ?? [];
        }),
    );
  }
  if (compraIds.length > 0) {
    consultas.push(
      supabase
        .from("detalle_compra")
        .select("compra_id, producto_id, costo_unitario")
        .in("compra_id", compraIds)
        .then(({ data, error }) => {
          if (!error) lineasCompra = data ?? [];
        }),
    );
  }
  // Repuestos de OT: además del costo, el precio al que se le cobró al
  // cliente (detalle_orden.precio_unitario), para que el Admin elija cómo verlo.
  const ordenIds = [...(ids.orden_servicio ?? [])];
  if (ordenIds.length > 0) {
    consultas.push(
      supabase
        .from("detalle_orden")
        .select("orden_id, producto_id, precio_unitario")
        .in("orden_id", ordenIds)
        .then(({ data, error }) => {
          if (!error) lineasOrden = data ?? [];
        }),
    );
  }
  if (prodCosto.length > 0) {
    consultas.push(
      supabase
        .from("productos")
        .select("id, costo_promedio")
        .in("id", prodCosto)
        .then(({ data, error }) => {
          if (!error)
            costos = new Map((data ?? []).map((p) => [p.id, p.costo_promedio]));
        }),
    );
  }
  await Promise.all(consultas);

  // Etiquetas de los documentos de destino, por tipo de destino.
  const etiquetasDestino = {};
  for (const [tipo, ref] of Object.entries(DESTINO_A_REF)) {
    etiquetasDestino[tipo] = new Map(
      [...(docs[ref]?.values() ?? [])].map((r) => [
        r.id,
        etiquetaOrigen(ref, r),
      ]),
    );
  }

  for (const m of items) {
    const ref = m.referencia_tipo;
    const doc = m.referencia_id ? docs[ref]?.get(m.referencia_id) : null;
    const origen = ref
      ? {
          texto: etiquetaOrigen(ref, doc),
          ruta: rutaOrigen(ref, m.referencia_id),
        }
      : null;

    let destino = null;
    if (m.tipo === "conversion_a_insumo" && destinosOk) {
      const d = destinos.get(m.id);
      if (!d) {
        destino = { texto: "Sin destino", ruta: null, inferido: false };
      } else {
        destino = {
          texto: textoConversionDestino(d, etiquetasDestino),
          ruta: rutaDestino(d.tipo, d[`${d.tipo}_id`]),
          inferido: Boolean(d.inferido),
        };
      }
    }

    let valor = null;
    if (ref === "venta") {
      valor = valorMovimiento(
        m.cantidad,
        precioUnicoDeLineas(
          lineasVenta
            .filter(
              (l) =>
                l.venta_id === m.referencia_id &&
                l.producto_id === m.producto_id,
            )
            .map((l) => ({ precio: l.precio_unitario })),
        ),
      );
    } else if (ref === "compra") {
      valor = valorMovimiento(
        m.cantidad,
        precioUnicoDeLineas(
          lineasCompra
            .filter(
              (l) =>
                l.compra_id === m.referencia_id &&
                l.producto_id === m.producto_id,
            )
            .map((l) => ({ precio: l.costo_unitario })),
        ),
      );
    } else {
      valor = valorMovimiento(m.cantidad, costos.get(m.producto_id), {
        aCosto: true,
      });
    }

    let valorPrecio = null;
    if (ref === "orden_servicio") {
      valorPrecio = valorMovimiento(
        m.cantidad,
        precioUnicoDeLineas(
          lineasOrden
            .filter(
              (l) =>
                l.orden_id === m.referencia_id &&
                l.producto_id === m.producto_id,
            )
            .map((l) => ({ precio: l.precio_unitario })),
        ),
      );
    }

    out.set(m.id, { origen, destino, valor, valorPrecio });
  }
  return out;
}

// Debe cubrir TODOS los tipos reales de `movimientos`. Antes faltaban
// conversion_a_insumo, conversion_a_venta y garantia_salida (406 movimientos,
// ~8.8% del total), que quedaban inalcanzables por el filtro pese a que la
// pantalla se presenta como "registro de TODA la actividad de stock".
const TIPOS = [
  "Todos",
  "venta",
  "compra",
  "traspaso_salida",
  "traspaso_entrada",
  "ajuste",
  "conteo_ajuste",
  "ensamble_consumo",
  "ensamble_produccion",
  "orden_consumo",
  "conversion_a_insumo",
  "conversion_a_venta",
  "devolucion",
  "garantia_salida",
  "garantia_entrada",
];
const PAGE_SIZE = 50;

/** Solo se acepta YYYY-MM-DD: un ?desde= arbitrario no llega crudo a la query. */
const esFecha = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default function Auditoria() {
  const [movimientos, setMovimientos] = useState([]);
  // movimiento_id → { origen, destino, valor } (ver enriquecerMovimientos).
  const [extras, setExtras] = useState(() => new Map());
  // Repuestos de OT: "costo" (costo promedio) o "precio" (lo que se le cobró
  // al cliente). Se recuerda en este navegador.
  const [modoOT, setModoOT] = useState(() => {
    try {
      return localStorage.getItem("auditoria.modoOT") === "precio"
        ? "precio"
        : "costo";
    } catch {
      return "costo";
    }
  });
  const elegirModoOT = (m) => {
    setModoOT(m);
    try {
      localStorage.setItem("auditoria.modoOT", m);
    } catch {
      /* sin almacenamiento: solo dura esta visita */
    }
  };
  const valorDe = (extra) =>
    modoOT === "precio" && extra?.valorPrecio
      ? extra.valorPrecio
      : extra?.valor;
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  // Deep-link desde la campana de notificaciones: el aviso agrupado de
  // conversiones a insumo abre esta página ya filtrada por su día y sede.
  const [searchParams] = useSearchParams();
  const tipoParam = searchParams.get("tipo");
  const sedeParam = searchParams.get("sede");
  const desdeParam = searchParams.get("desde");
  const hastaParam = searchParams.get("hasta");

  // TIPOS es la lista blanca que ya existe en el archivo.
  const [tipo, setTipo] = useState(
    TIPOS.includes(tipoParam) ? tipoParam : "Todos",
  );
  const [sedeId, setSedeId] = useState(sedeParam ?? "");
  const [usuarioId, setUsuarioId] = useState("");
  const [search, setSearch] = useState("");
  const [fechaDesde, setFechaDesde] = useState(
    esFecha(desdeParam) ? desdeParam : "",
  );
  const [fechaHasta, setFechaHasta] = useState(
    esFecha(hastaParam) ? hastaParam : "",
  );
  // Si vino algo por URL, abrir el panel de filtros: si no, el usuario
  // aterriza con filtros puestos que no ve y la pantalla parece vacía sin
  // explicación.
  const [showFiltros, setShowFiltros] = useState(
    Boolean(tipoParam || sedeParam || desdeParam || hastaParam),
  );
  const [seleccionado, setSeleccionado] = useState(null);

  // Los inicializadores de arriba solo corren en el primer render. Si el
  // usuario YA está en esta página y pulsa otro aviso de la campana (otra sede
  // u otro día), React Router cambia la query sin remontar: sin este efecto se
  // quedarían los filtros del aviso anterior, mostrando datos de otro contexto
  // como si fueran los del aviso que acaba de tocar.
  useEffect(() => {
    if (!tipoParam && !sedeParam && !desdeParam && !hastaParam) return;
    setTipo(TIPOS.includes(tipoParam) ? tipoParam : "Todos");
    setSedeId(sedeParam ?? "");
    setFechaDesde(esFecha(desdeParam) ? desdeParam : "");
    setFechaHasta(esFecha(hastaParam) ? hastaParam : "");
    setShowFiltros(true);
  }, [tipoParam, sedeParam, desdeParam, hastaParam]);

  const [sedes, setSedes] = useState([]);
  const [usuarios, setUsuarios] = useState([]);

  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const mountedRef = useRef(true);
  // Token de secuencia: descarta respuestas de carga obsoletas.
  const reqIdRef = useRef(0);
  // Generación de filtros: cambia solo al recargar desde cero.
  const genRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Cargar selectores
  useEffect(() => {
    Promise.all([
      supabase.from("sedes").select("id, nombre").eq("activa", true),
      supabase.from("usuarios").select("id, nombre").eq("activo", true),
    ])
      .then(([s, u]) => {
        if (!mountedRef.current) return;
        if (s.error || u.error) {
          setErrorMsg("No se pudieron cargar los filtros de sede/usuario.");
          return;
        }
        setSedes(s.data ?? []);
        setUsuarios(u.data ?? []);
      })
      .catch((err) => {
        if (mountedRef.current)
          setErrorMsg(safeError(err, "Error al cargar filtros"));
      });
  }, []);

  const cargar = async (reset = false) => {
    const myReq = ++reqIdRef.current;
    if (reset) genRef.current += 1;
    const myGen = genRef.current;
    setLoading(true);
    setErrorMsg("");
    const currentPage = reset ? 0 : page;
    try {
      // Si hay búsqueda, filtramos productos primero y obtenemos sus IDs
      // (búsqueda server-side, no client-side sobre la página actual)
      let productoIds = null;
      const sq = sanitizeSearch(search.trim());
      if (sq) {
        const { data: prods } = await supabase
          .from("productos")
          .select("id")
          .or(`referencia.ilike.%${sq}%,nombre.ilike.%${sq}%`)
          .limit(500);
        productoIds = (prods ?? []).map((p) => p.id);
        if (productoIds.length === 0) {
          if (!mountedRef.current || myReq !== reqIdRef.current) return;
          if (reset) {
            setMovimientos([]);
            setSeleccionado(null);
            setPage(1);
          }
          setHasMore(false);
          return;
        }
      }

      let q = supabase
        .from("movimientos")
        .select(
          `id, tipo, cantidad, stock_anterior, stock_posterior, fecha, observaciones, sede_id, producto_id,
           referencia_id, referencia_tipo,
           producto:producto_id(referencia, nombre),
           usuario:usuario_id(nombre, rol),
           sede:sede_id(nombre)`,
        )
        .order("fecha", { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      if (tipo !== "Todos") q = q.eq("tipo", tipo);
      if (sedeId) q = q.eq("sede_id", sedeId);
      if (usuarioId) q = q.eq("usuario_id", usuarioId);
      if (fechaDesde) q = q.gte("fecha", `${fechaDesde}T00:00:00-05:00`);
      if (fechaHasta) q = q.lte("fecha", `${fechaHasta}T23:59:59-05:00`);
      if (productoIds) q = q.in("producto_id", productoIds);

      const { data, error } = await q;
      if (!mountedRef.current || myReq !== reqIdRef.current) return;
      if (error) throw error;

      const items = data ?? [];
      if (reset) {
        setMovimientos(items);
        setSeleccionado(items[0] ?? null);
        setPage(1);
        setExtras(new Map());
      } else {
        setMovimientos((p) => [...p, ...items]);
        setPage((p) => p + 1);
      }
      // Origen en palabras, destino y valor: llegan después, sin frenar la
      // lista. Si algo falla se queda en "—" (no se inventa nada).
      enriquecerMovimientos(items)
        .then((mapa) => {
          // Se descarta solo si cambió el filtro (otra generación), no por
          // haber pedido "Cargar más" mientras tanto.
          if (!mountedRef.current || myGen !== genRef.current) return;
          setExtras((prev) => new Map([...prev, ...mapa]));
        })
        .catch((err) => console.warn("Auditoría: no se pudo enriquecer", err));
      setHasMore(items.length === PAGE_SIZE);
    } catch (err) {
      if (!mountedRef.current || myReq !== reqIdRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar movimientos"));
    } finally {
      if (mountedRef.current && myReq === reqIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    setPage(0);
    setHasMore(true);
    const t = setTimeout(() => cargar(true), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, sedeId, usuarioId, fechaDesde, fechaHasta, search]);

  const limpiar = () => {
    setTipo("Todos");
    setSedeId("");
    setUsuarioId("");
    setSearch("");
    setFechaDesde("");
    setFechaHasta("");
  };

  const hayFiltros =
    tipo !== "Todos" ||
    sedeId ||
    usuarioId ||
    fechaDesde ||
    fechaHasta ||
    search;

  // KPIs derivados de la página cargada (datos reales en memoria).
  const totalCargados = movimientos.length;
  const entradas = movimientos.filter((m) => Number(m.cantidad) > 0).length;
  const salidas = movimientos.filter((m) => Number(m.cantidad) < 0).length;
  const ajustes = movimientos.filter(
    (m) => m.tipo === "ajuste" || m.tipo === "conteo_ajuste",
  ).length;

  return (
    <div className="flex flex-col gap-6 px-5 pb-8 pt-6 sm:px-7 animate-fade-in">
      {/* Page head */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="m-0 mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Admin · Auditoría
          </p>
          <h1
            className="m-0 text-[24px] font-semibold leading-tight tracking-[-0.018em]"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Bitácora de movimientos
          </h1>
          <p
            className="mt-1 text-[13px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Registro inmutable (append-only) de toda la actividad de stock.
          </p>
        </div>
        <button
          onClick={() => setShowFiltros((v) => !v)}
          className="inline-flex h-12 items-center gap-1.5 rounded-md border px-4 text-[12.5px] font-medium transition-colors cursor-pointer"
          style={{
            borderColor: showFiltros
              ? "hsl(var(--primary))"
              : "hsl(var(--border))",
            backgroundColor: "hsl(var(--card))",
            color: showFiltros
              ? "hsl(var(--primary))"
              : "hsl(var(--muted-foreground))",
          }}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
          Filtros avanzados
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className="text-[12.5px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Repuestos de OT:
        </span>
        <div
          role="group"
          aria-label="Cómo valorar los repuestos de OT"
          className="inline-flex overflow-hidden rounded-md border"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          {[
            ["costo", "A costo"],
            ["precio", "A precio cobrado"],
          ].map(([v, label]) => {
            const activo = modoOT === v;
            return (
              <button
                key={v}
                type="button"
                aria-pressed={activo}
                onClick={() => elegirModoOT(v)}
                className="h-12 px-4 text-[12.5px] font-medium cursor-pointer"
                style={{
                  backgroundColor: activo
                    ? "hsl(var(--primary))"
                    : "hsl(var(--card))",
                  color: activo
                    ? "hsl(var(--primary-foreground))"
                    : "hsl(var(--muted-foreground))",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

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

      {/* KPI cards (estilo Lovable) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Movimientos cargados"
          value={`${totalCargados}${hasMore ? "+" : ""}`}
          sub="En esta vista"
          icon={Shield}
        />
        {/* Estos tres cuentan solo sobre las filas YA cargadas (paginado), no
            sobre el total del filtro. El sufijo "+" y "en esta vista" lo hacen
            explícito para no leer "Ajustes: 3" cuando en la BD hay cientos. */}
        <KpiCard
          label="Entradas"
          value={`${entradas}${hasMore ? "+" : ""}`}
          sub="En esta vista"
          token="--success"
          icon={TrendingUp}
        />
        <KpiCard
          label="Salidas"
          value={`${salidas}${hasMore ? "+" : ""}`}
          sub="En esta vista"
          token="--destructive"
          icon={TrendingDown}
        />
        <KpiCard
          label="Ajustes"
          value={`${ajustes}${hasMore ? "+" : ""}`}
          sub="En esta vista"
          token={ajustes > 0 ? "--warning" : "--muted-foreground"}
          icon={SlidersHorizontal}
        />
      </div>

      {/* Toolbar: búsqueda + tipo + reset */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
            strokeWidth={1.5}
            style={{ color: "hsl(var(--muted-foreground))" }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por producto, nombre o referencia…"
            className="h-12 w-full rounded-md border pl-9 pr-3 text-[13px]"
            style={surfaceInputStyle}
          />
        </div>
        <div
          className="flex items-center gap-1 rounded-md border p-1"
          style={{
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--muted) / 0.4)",
          }}
        >
          <Filter
            className="ml-1 h-3.5 w-3.5"
            strokeWidth={1.5}
            style={{ color: "hsl(var(--muted-foreground))" }}
          />
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className="h-9 rounded bg-transparent px-2 text-[12px] outline-none cursor-pointer"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {TIPOS.map((t) => (
              <option
                key={t}
                value={t}
                style={{ backgroundColor: "hsl(var(--card))" }}
              >
                {t === "Todos" ? "Todos los tipos" : movimientoLabel(t)}
              </option>
            ))}
          </select>
        </div>
        {hayFiltros && (
          <button
            onClick={limpiar}
            className="inline-flex h-12 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium transition-colors cursor-pointer"
            style={{
              borderColor: "hsl(var(--border))",
              backgroundColor: "hsl(var(--card))",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
            Limpiar
          </button>
        )}
        <span
          className="ml-auto font-mono text-[11px] tracking-[0.04em]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {loading
            ? "cargando…"
            : `${totalCargados}${hasMore ? "+" : ""} eventos`}
        </span>
      </div>

      {/* Filtros avanzados (panel colapsable) */}
      {showFiltros && (
        <div
          className="grid gap-3 rounded-[10px] border p-4 sm:grid-cols-2 lg:grid-cols-4"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          <Select
            label="Sede"
            value={sedeId}
            onChange={setSedeId}
            options={[
              { value: "", label: "Todas" },
              ...sedes.map((s) => ({ value: s.id, label: s.nombre })),
            ]}
          />
          <Select
            label="Usuario"
            value={usuarioId}
            onChange={setUsuarioId}
            options={[
              { value: "", label: "Todos" },
              ...usuarios.map((u) => ({ value: u.id, label: u.nombre })),
            ]}
          />
          <Field label="Desde">
            <input
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              className="h-11 w-full rounded-lg border px-3 text-sm"
              style={surfaceInputStyle}
            />
          </Field>
          <Field label="Hasta">
            <input
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
              className="h-11 w-full rounded-lg border px-3 text-sm"
              style={surfaceInputStyle}
            />
          </Field>
        </div>
      )}

      {/* Grid: tabla + detalle (master-detail Lovable) */}
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        {/* ── Lista de eventos ───────────────────────────────────────── */}
        <section
          className="overflow-hidden rounded-[10px] border"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr
                  className="text-left"
                  style={{
                    backgroundColor: "hsl(var(--muted) / 0.3)",
                    borderBottom: "1px solid hsl(var(--border))",
                  }}
                >
                  {[
                    "Fecha · hora",
                    "Movimiento",
                    "Producto",
                    "Cantidad",
                    "Valor",
                    "Módulo",
                    "Usuario",
                  ].map((c, i) => (
                    <th
                      key={c}
                      className={`px-3 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] ${
                        i === 3 || i === 4 ? "text-right" : "text-left"
                      }`}
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m) => {
                  const positivo = Number(m.cantidad) > 0;
                  const activo = seleccionado?.id === m.id;
                  return (
                    <tr
                      key={m.id}
                      onClick={() => setSeleccionado(m)}
                      className="cursor-pointer border-t transition-colors"
                      style={{
                        borderColor: "hsl(var(--border) / 0.6)",
                        backgroundColor: activo
                          ? "hsl(var(--primary) / 0.08)"
                          : "transparent",
                      }}
                      onMouseEnter={(e) => {
                        if (!activo)
                          e.currentTarget.style.backgroundColor =
                            "hsl(var(--muted) / 0.4)";
                      }}
                      onMouseLeave={(e) => {
                        if (!activo)
                          e.currentTarget.style.backgroundColor = "transparent";
                      }}
                    >
                      <td className="px-3 py-3">
                        <div
                          className="text-[12px]"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {formatDate(m.fecha)}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <TipoBadge tipo={m.tipo} />
                      </td>
                      <td className="px-3 py-3">
                        <p
                          className="max-w-[200px] truncate text-[13px] font-medium"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {m.producto?.nombre}
                        </p>
                        <p
                          className="font-mono text-[11px]"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {m.producto?.referencia}
                        </p>
                      </td>
                      <td
                        className="px-3 py-3 text-right font-mono text-[13px] font-bold tabular-nums"
                        style={{
                          color: positivo
                            ? "hsl(var(--success))"
                            : "hsl(var(--destructive))",
                        }}
                      >
                        {positivo ? "+" : ""}
                        {m.cantidad}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <ValorCorto valor={valorDe(extras.get(m.id))} />
                      </td>
                      <td
                        className="px-3 py-3 text-[12px]"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {movimientoModulo(m.tipo)}
                        {extras.get(m.id)?.origen && (
                          <p
                            className="max-w-[180px] truncate text-[11px]"
                            style={{ color: "hsl(var(--foreground))" }}
                          >
                            {extras.get(m.id).origen.texto}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold"
                            style={{
                              backgroundColor: "hsl(var(--muted))",
                              color: "hsl(var(--foreground))",
                            }}
                          >
                            {iniciales(m.usuario?.nombre)}
                          </span>
                          <span
                            className="text-[12px]"
                            style={{ color: "hsl(var(--foreground))" }}
                          >
                            {m.usuario?.nombre ?? "—"}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {movimientos.length === 0 && !loading && (
              <p
                className="py-10 text-center text-sm"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Sin movimientos con esos filtros
              </p>
            )}
          </div>

          {/* Mobile cards */}
          <ul className="divide-y md:hidden" role="list">
            {movimientos.map((m) => {
              const positivo = Number(m.cantidad) > 0;
              const activo = seleccionado?.id === m.id;
              return (
                <li key={m.id} style={{ borderColor: "hsl(var(--border))" }}>
                  <button
                    onClick={() => setSeleccionado(m)}
                    className="w-full px-4 py-3 text-left cursor-pointer transition-colors"
                    style={{
                      backgroundColor: activo
                        ? "hsl(var(--primary) / 0.08)"
                        : "transparent",
                    }}
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <TipoBadge tipo={m.tipo} />
                      <p
                        className="font-mono text-sm font-bold tabular-nums"
                        style={{
                          color: positivo
                            ? "hsl(var(--success))"
                            : "hsl(var(--destructive))",
                        }}
                      >
                        {positivo ? "+" : ""}
                        {m.cantidad}
                      </p>
                    </div>
                    <p
                      className="truncate text-sm font-medium"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {m.producto?.nombre}
                    </p>
                    <p
                      className="font-mono text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {m.producto?.referencia}
                    </p>
                    <p
                      className="mt-1 text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {formatDate(m.fecha)} · {m.usuario?.nombre} ·{" "}
                      {m.sede?.nombre ?? m.sede_id}
                    </p>
                    <p
                      className="font-mono text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      Stock: {m.stock_anterior} → {m.stock_posterior}
                    </p>
                    {extras.get(m.id) && (
                      <p
                        className="mt-0.5 text-xs"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {extras.get(m.id).origen?.texto ?? "—"} ·{" "}
                        <ValorCorto valor={valorDe(extras.get(m.id))} />
                      </p>
                    )}
                  </button>
                </li>
              );
            })}
            {movimientos.length === 0 && !loading && (
              <li
                className="px-4 py-10 text-center text-sm"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Sin movimientos con esos filtros
              </li>
            )}
          </ul>

          {hasMore && !loading && (
            <div
              className="border-t p-3"
              style={{ borderColor: "hsl(var(--border))" }}
            >
              <button
                onClick={() => cargar(false)}
                className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-md border text-[13px] font-medium transition-colors cursor-pointer"
                style={{
                  borderColor: "hsl(var(--border))",
                  backgroundColor: "hsl(var(--card))",
                  color: "hsl(var(--muted-foreground))",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor =
                    "hsl(var(--muted) / 0.4)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "hsl(var(--card))")
                }
              >
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
                Cargar más
              </button>
            </div>
          )}
        </section>

        {/* ── Panel de detalle ───────────────────────────────────────── */}
        <DetallePanel
          mov={seleccionado}
          extra={seleccionado ? extras.get(seleccionado.id) : null}
          valor={seleccionado ? valorDe(extras.get(seleccionado.id)) : null}
        />
      </div>

      {/* Footer trazabilidad */}
      <div
        className="flex items-center gap-2 rounded-[10px] border px-4 py-3 text-[12px]"
        style={{
          borderColor: "hsl(var(--border))",
          backgroundColor: "hsl(var(--muted) / 0.3)",
          color: "hsl(var(--muted-foreground))",
        }}
      >
        <Shield
          className="h-3.5 w-3.5 shrink-0"
          strokeWidth={1.5}
          style={{ color: "hsl(var(--muted-foreground))" }}
        />
        Registro append-only: los movimientos quedan asociados a usuario, sede y
        fecha, y no pueden editarse ni borrarse.
      </div>
    </div>
  );
}

/* ── Panel de detalle (master-detail Lovable, datos reales) ───────────── */
function DetallePanel({ mov, extra, valor }) {
  if (!mov) {
    return (
      <aside
        className="rounded-[10px] border p-6 text-center text-[12px]"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
          color: "hsl(var(--muted-foreground))",
        }}
      >
        Selecciona un movimiento para ver el detalle
      </aside>
    );
  }

  const positivo = Number(mov.cantidad) > 0;
  const filas = [
    {
      label: "Fecha · hora",
      value: formatDate(mov.fecha),
      icon: Calendar,
    },
    {
      label: "Usuario",
      value: `${mov.usuario?.nombre ?? "—"}${mov.usuario?.rol ? ` (${mov.usuario.rol})` : ""}`,
    },
    {
      label: "Módulo",
      value: movimientoModulo(mov.tipo),
    },
    {
      label: "Sede",
      value: mov.sede?.nombre ?? mov.sede_id,
      icon: MapPin,
    },
    {
      label: "Origen",
      value: extra?.origen ? (
        <EnlaceDoc texto={extra.origen.texto} ruta={extra.origen.ruta} />
      ) : mov.referencia_tipo ? (
        // Aún sin resolver (o falló): el tipo en palabras, sin número.
        <EnlaceDoc
          texto={etiquetaOrigen(mov.referencia_tipo, null)}
          ruta={rutaOrigen(mov.referencia_tipo, mov.referencia_id)}
        />
      ) : (
        "—"
      ),
    },
    ...(mov.tipo === "conversion_a_insumo"
      ? [
          {
            label: "Para qué",
            value: extra?.destino ? (
              <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                <EnlaceDoc
                  texto={extra.destino.texto}
                  ruta={extra.destino.ruta}
                />
                {extra.destino.inferido && (
                  <span
                    className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
                    style={pillStyle("--warning")}
                    title="Amarrado después por cercanía en el tiempo con el consumo; no lo registró quien convirtió."
                  >
                    estimado
                  </span>
                )}
              </span>
            ) : (
              "—"
            ),
          },
        ]
      : []),
    {
      label: valor?.aCosto ? "Valor (a costo)" : "Valor",
      value: textoValorMovimiento(valor),
      mono: true,
    },
    {
      label: "Stock",
      value: `${mov.stock_anterior} → ${mov.stock_posterior}`,
      mono: true,
    },
  ];

  return (
    <aside
      className="self-start rounded-[10px] border"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      {/* Cabecera */}
      <div
        className="border-b p-4"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className="font-mono text-[11px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {String(mov.id).slice(0, 8)}…
          </span>
          <TipoBadge tipo={mov.tipo} />
        </div>
        <p
          className="mt-2 text-[14px] font-semibold"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {mov.producto?.nombre ?? "—"}
        </p>
        <p
          className="font-mono text-[11px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {mov.producto?.referencia}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <span
            className="grid h-7 w-7 place-items-center rounded-md"
            style={{
              backgroundColor: positivo
                ? "hsl(var(--success) / 0.12)"
                : "hsl(var(--destructive) / 0.12)",
              color: positivo
                ? "hsl(var(--success))"
                : "hsl(var(--destructive))",
            }}
          >
            {positivo ? (
              <ArrowDownToLine className="h-3.5 w-3.5" strokeWidth={1.75} />
            ) : (
              <ArrowUpFromLine className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
          </span>
          <span
            className="font-mono text-[20px] font-bold tabular-nums"
            style={{
              color: positivo
                ? "hsl(var(--success))"
                : "hsl(var(--destructive))",
            }}
          >
            {positivo ? "+" : ""}
            {mov.cantidad}
          </span>
          <span
            className="text-[12px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            unidades
          </span>
        </div>
      </div>

      {/* Filas de detalle (datos reales) */}
      <dl className="divide-y" style={{ borderColor: "hsl(var(--border))" }}>
        {filas.map((r) => {
          const Icon = r.icon;
          return (
            <div
              key={r.label}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12px]"
            >
              <dt
                className="flex items-center gap-1.5"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {Icon && <Icon className="h-3 w-3" strokeWidth={1.5} />}
                {r.label}
              </dt>
              <dd
                className={`text-right ${r.mono ? "font-mono text-[11.5px]" : ""}`}
                style={{ color: "hsl(var(--foreground))" }}
              >
                {r.value}
              </dd>
            </div>
          );
        })}
      </dl>

      {/* Observaciones */}
      {mov.observaciones && (
        <div
          className="border-t px-4 py-3"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <p
            className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.06em]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Observaciones
          </p>
          <p
            className="text-[12.5px] italic"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {mov.observaciones}
          </p>
        </div>
      )}

      {/* Nota de trazabilidad: firma/hash no rastreados (honesto, sin inventar) */}
      <div
        className="flex items-start gap-2 border-t px-4 py-3"
        style={{
          borderColor: "hsl(var(--border))",
          backgroundColor: "hsl(var(--muted) / 0.3)",
        }}
      >
        <Hash
          className="mt-0.5 h-3.5 w-3.5 shrink-0"
          strokeWidth={1.5}
          style={{ color: "hsl(var(--muted-foreground))" }}
        />
        <p
          className="text-[11px] leading-snug"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Inmutabilidad garantizada por trigger append-only en la base de datos.
          La firma criptográfica e IP de origen no se registran en esta versión.
        </p>
      </div>
    </aside>
  );
}

/* ── KPI card (estilo Lovable cockpit) ────────────────────────────────── */
function KpiCard({ label, value, sub, token, icon: Icon }) {
  return (
    <div
      className="rounded-[10px] border p-4"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <div
        className="flex items-center gap-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />}
        {label}
      </div>
      <div
        className="mt-2 font-mono text-[22px] font-semibold leading-tight tracking-[-0.02em] tabular-nums"
        style={{
          color: token ? `hsl(var(${token}))` : "hsl(var(--foreground))",
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="mt-0.5 text-[11px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span
        className="mb-1 block text-xs font-medium"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-lg border px-3 text-sm"
        style={surfaceInputStyle}
      >
        {options.map((o) => (
          <option key={o.value || "__all"} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Documento tocable (abre su pantalla) o texto plano si no tiene ruta. */
function EnlaceDoc({ texto, ruta }) {
  if (!ruta) return <span>{texto}</span>;
  return (
    <Link
      to={ruta}
      className="inline-flex min-h-[48px] items-center justify-end font-medium underline underline-offset-2"
      style={{ color: "hsl(var(--primary))" }}
    >
      {texto}
    </Link>
  );
}

/** Total en pesos de un movimiento ("$ 90.000", con "a costo" si aplica). */
function ValorCorto({ valor }) {
  if (!valor) {
    return (
      <span
        className="font-mono text-[12px]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        —
      </span>
    );
  }
  return (
    <span
      className="font-mono text-[12px] tabular-nums"
      style={{ color: "hsl(var(--foreground))" }}
    >
      {formatPesos(valor.total)}
      {valor.aCosto && (
        <span
          className="ml-1 font-sans text-[10px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          a costo
        </span>
      )}
    </span>
  );
}

function TipoBadge({ tipo }) {
  const token = movimientoToken(tipo);
  return (
    <span
      className="inline-flex items-center rounded-[3px] border px-1.5 py-0.5 font-mono text-[11px] font-medium leading-[1.4]"
      style={pillStyle(token)}
    >
      {movimientoLabel(tipo)}
    </span>
  );
}
