import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Cog, List, LayoutGrid, Trash2 } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import { useFiltros } from "../../hooks/useFiltros";
import BarraFiltros from "../../components/filtros/BarraFiltros";
import { esNumeroPuro } from "../../lib/filtros";
import { keywordTerms } from "../../lib/search";
import { useSedes } from "../../hooks/useSedes";
import {
  ensambleEstadoPill,
  tecnicoAvatar,
  ENSAMBLE_TABS,
  ENSAMBLE_KANBAN_COLS,
} from "../../lib/ordenes-ui";

const PAGE_SIZE = 20;

export default function EnsambleHistorial() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [ensambles, setEnsambles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState(null); // null | 'en_proceso' | 'terminado' | 'completado'
  const [view, setView] = useState("lista"); // 'lista' | 'tablero'
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(null); // total REAL del filtro (count exacto)
  const [errorMsg, setErrorMsg] = useState("");
  const esAdmin = perfil?.rol === "Admin";
  const esTecnico = perfil?.rol === "Tecnico";
  const { confirm, ConfirmDialog } = useConfirm();
  const mountedRef = useRef(true);

  // Realizadores: la lista de gente que puede aparecer en "Realizado por".
  // Se lee de `usuarios` (RLS permite leerla a cualquier autenticado) en vez de
  // sacarla de lo cargado, que solo mostraría a quien alcanzó a salir en la
  // primera página.
  const { sedes } = useSedes();
  const [realizadores, setRealizadores] = useState([]);
  useEffect(() => {
    let vigente = true;
    supabase
      .from("usuarios")
      .select("id, nombre")
      .eq("activo", true)
      .order("nombre")
      .then(({ data }) => {
        if (vigente && data) {
          setRealizadores(data.map((u) => ({ v: u.id, l: u.nombre })));
        }
      });
    return () => {
      vigente = false;
    };
  }, []);

  const campos = useMemo(
    () => [
      {
        id: "q",
        tipo: "texto",
        label: "Buscar",
        // Sin `columnas`: el nombre/referencia del producto viven en una tabla
        // embebida y PostgREST no admite un `or` de nivel superior contra ella.
        // El hook resuelve el caso "#873" (numero exacto) y el debounce; la
        // búsqueda por producto se aplica abajo con `referencedTable`.
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
        id: "realizador",
        tipo: "opciones",
        label: "Realizado por",
        columna: "realizado_por",
        opciones: realizadores,
        // El técnico solo ve sus propios ensambles: filtrar por realizador no
        // le agrega nada.
        visible: !esTecnico,
      },
      {
        id: "sede",
        tipo: "opciones",
        label: "Sede",
        columna: "sede_id",
        opciones: sedes.map((s) => ({ v: s.id, l: s.nombre })),
        visible: esAdmin, // al resto ya lo ata la RLS
      },
    ],
    [realizadores, sedes, esAdmin, esTecnico],
  );

  const f = useFiltros({ clave: "ensambles", campos });

  const eliminar = async (e) => {
    const ok = await confirm({
      titulo: "Eliminar ensamble",
      mensaje: `Se eliminará el ensamble #${e.numero} de "${
        e.producto?.nombre ?? ""
      }". Si está completado, se intentará devolver los insumos al pool y quitar el producto del stock; solo es posible si el producido sigue completo (si ya se vendió o trasladó parte, se rechazará). ¿Confirmar?`,
      confirmLabel: "Sí, eliminar",
    });
    if (!ok) return;
    try {
      const { error } = await supabase.rpc("fn_eliminar_ensamble", {
        p_ensamble_id: e.id,
      });
      if (error) throw error;
      setEnsambles((prev) => prev.filter((x) => x.id !== e.id));
    } catch (err) {
      setErrorMsg(safeError(err, "Error al eliminar ensamble"));
    }
  };
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const cargar = async (pageToLoad, append) => {
    if (!mountedRef.current) return;
    const myReq = f.nuevoReqId();
    setLoading(true);
    setErrorMsg("");
    try {
      // Búsqueda por producto: nombre y referencia viven en la tabla embebida.
      // PostgREST solo filtra la fila padre por un embed si el join es `!inner`,
      // así que el `!inner` se pone SOLO cuando hay texto a buscar: dejarlo fijo
      // escondería los ensambles sin producto resultado.
      const texto = f.valoresAplicados.q ?? "";
      const terminosProducto =
        esNumeroPuro(texto) == null ? keywordTerms(texto) : [];
      const buscaProducto = terminosProducto.length > 0;

      let query = supabase.from("ensambles").select(
        `id, numero, fecha, cantidad_producida, completado, terminado, costo_total,
           producto:producto_resultado_id${buscaProducto ? "!inner" : ""}(referencia, nombre),
           realizador:realizado_por(nombre),
           tecnico:tecnico_id(nombre)`,
        { count: "exact" },
      );

      // Texto "#873" (numero exacto), rango de fechas, realizador y sede.
      query = f.aplicar(query);
      // Cada palabra debe aparecer en el nombre o la referencia del producto:
      // PostgREST une los distintos `or=(...)` con AND.
      for (const t of terminosProducto) {
        query = query.or(`nombre.ilike.%${t}%,referencia.ilike.%${t}%`, {
          referencedTable: "producto",
        });
      }

      // El técnico ve solo los ensambles asignados a él; el resto (no Admin) por sede.
      if (esTecnico) query = query.eq("tecnico_id", perfil.id);
      else if (!esAdmin && perfil?.sede_id)
        query = query.eq("sede_id", perfil.sede_id);
      if (filtro === "en_proceso")
        query = query.eq("completado", false).eq("terminado", false);
      else if (filtro === "terminado")
        query = query.eq("terminado", true).eq("completado", false);
      else if (filtro === "completado") query = query.eq("completado", true);

      query = query
        .order("fecha", { ascending: false })
        .order("numero", { ascending: false })
        .range(pageToLoad * PAGE_SIZE, (pageToLoad + 1) * PAGE_SIZE - 1);

      // Timeout duro 15s para evitar UI atorada si la red se cuelga
      const { data, error, count } = await Promise.race([
        query,
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(new Error("Timeout: la red está lenta o sin respuesta")),
            15000,
          ),
        ),
      ]);
      // Descarta respuestas que llegan fuera de orden.
      if (!mountedRef.current || !f.esReqVigente(myReq)) return;
      if (error) throw error;

      const filas = data ?? [];
      setEnsambles((prev) => (append ? [...prev, ...filas] : filas));
      setPage(pageToLoad);
      setTotal(count ?? null);
      setHasMore((pageToLoad + 1) * PAGE_SIZE < (count ?? 0));
    } catch (err) {
      if (!mountedRef.current || !f.esReqVigente(myReq)) return;
      setErrorMsg(safeError(err, "Error al cargar ensambles"));
    } finally {
      // Solo la petición más reciente controla el loading.
      if (mountedRef.current && f.esReqVigente(myReq)) setLoading(false);
    }
  };

  // Cualquier cambio de filtro (texto ya con debounce, fecha, realizador, sede
  // o pestaña de estado) vuelve a la página 0: paginar sobre un filtro viejo
  // mezcla resultados de dos consultas distintas.
  useEffect(() => {
    cargar(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.valoresAplicados, filtro, perfil?.id, perfil?.rol, perfil?.sede_id]);

  // Conteos de la página cargada. NO son el total del filtro (eso es `total`),
  // por eso van rotulados "en vista".
  const kpis = useMemo(() => {
    const pendientes = ensambles.filter((e) => !e.completado).length;
    const completados = ensambles.length - pendientes;
    return { pendientes, completados };
  }, [ensambles]);

  const hayFiltros = f.hayFiltros || filtro != null;

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-[18px] px-4 py-5 sm:px-7 sm:py-6 animate-fade-in">
      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.08em]"
            style={{ color: "var(--n-300)" }}
          >
            Operaciones · Producción ·{" "}
            {loading && total == null
              ? "cargando…"
              : `${total ?? 0} ${total === 1 ? "registro" : "registros"}${
                  hayFiltros ? " (filtrado)" : ""
                }`}
          </p>
          <h1
            className="text-[22px] font-semibold tracking-[-0.018em] sm:text-[24px]"
            style={{ color: "var(--n-950)" }}
          >
            Ensambles
          </h1>
          <p
            className="mt-1.5 text-[13px] leading-[1.5]"
            style={{ color: "var(--n-500)" }}
          >
            <b className="font-medium" style={{ color: "var(--n-950)" }}>
              {kpis.pendientes} pendiente{kpis.pendientes === 1 ? "" : "s"}
            </b>{" "}
            · {kpis.completados} completado{kpis.completados === 1 ? "" : "s"}{" "}
            en vista
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="viewtog">
            <button
              className={view === "lista" ? "on" : ""}
              onClick={() => setView("lista")}
            >
              <List className="h-3 w-3" /> Lista
            </button>
            <button
              className={view === "tablero" ? "on" : ""}
              onClick={() => setView("tablero")}
            >
              <LayoutGrid className="h-3 w-3" /> Tablero
            </button>
          </div>
          <button
            onClick={() => navigate("/ops/ensambles/nuevo")}
            className="btn btn-pri"
            style={{ height: 48 }}
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            Nuevo ensamble
          </button>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-[10px] border px-4 py-3 text-sm"
          style={{
            backgroundColor: "var(--dang-50)",
            borderColor: "var(--dang-border)",
            color: "var(--dang-700)",
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* ── Filtros ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* `tab`, no `f`: `f` es el objeto de filtros de esta pantalla. */}
        {ENSAMBLE_TABS.map((tab) => {
          const on = filtro === tab.key;
          return (
            <button
              key={tab.v}
              onClick={() => setFiltro(tab.key)}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors"
              style={
                on
                  ? { backgroundColor: "var(--n-100)", color: "var(--n-950)" }
                  : { backgroundColor: "transparent", color: "var(--n-500)" }
              }
              onMouseEnter={(e) => {
                if (!on) e.currentTarget.style.backgroundColor = "var(--n-50)";
              }}
              onMouseLeave={(e) => {
                if (!on) e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              {tab.v}
            </button>
          );
        })}
      </div>

      {/* ── Búsqueda y filtros ──────────────────────────────────────── */}
      {/* Visible también en tablero: esconder la barra con filtros puestos es
          exactamente lo que hace leer un filtro activo como "faltan datos". */}
      <BarraFiltros
        filtros={f}
        placeholder="Buscar #número, producto o referencia…"
        legacy
      />

      {/* ── Contenido ───────────────────────────────────────────────── */}
      {loading && ensambles.length === 0 ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-[10px] border"
              style={{
                backgroundColor: "var(--n-0)",
                borderColor: "var(--n-150)",
              }}
            />
          ))}
        </div>
      ) : ensambles.length === 0 ? (
        <Empty q={f.valoresAplicados.q} hayFiltros={hayFiltros} />
      ) : view === "lista" ? (
        <ListView rows={ensambles} esAdmin={esAdmin} onEliminar={eliminar} />
      ) : (
        <KanbanView rows={ensambles} esAdmin={esAdmin} />
      )}

      {hasMore && !loading && (
        <button
          onClick={() => cargar(page + 1, true)}
          className="w-full rounded-[10px] border py-3 text-sm font-medium"
          style={{
            borderColor: "var(--n-200)",
            color: "var(--n-500)",
            backgroundColor: "var(--n-0)",
          }}
        >
          Cargar más
        </button>
      )}

      <ConfirmDialog />
    </div>
  );
}

/* ─────────────────────────── Vista lista (desktop tabla / mobile cards) ── */

function ListView({ rows, esAdmin, onEliminar }) {
  return (
    <>
      {/* Móvil: cards */}
      <ul className="space-y-2.5 md:hidden" role="list">
        {rows.map((e) => (
          <li key={e.id}>
            <EnsambleCard
              ensamble={e}
              esAdmin={esAdmin}
              onEliminar={onEliminar}
            />
          </li>
        ))}
      </ul>

      {/* Desktop: tabla */}
      <div
        className="hidden overflow-hidden rounded-[10px] border md:block"
        style={{
          borderColor: "var(--n-150)",
          backgroundColor: "var(--n-0)",
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th width={90}>#</Th>
                <Th>Producto</Th>
                <Th width={160}>Realizado por</Th>
                <Th width={150}>Fecha</Th>
                <Th width={90} right>
                  Cant.
                </Th>
                <Th width={150}>Estado</Th>
                {/* Columna Costo: solo Admin */}
                {esAdmin && (
                  <Th width={140} right>
                    Costo
                  </Th>
                )}
                {esAdmin && <Th width={70} />}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <EnsambleFila
                  key={e.id}
                  ensamble={e}
                  esAdmin={esAdmin}
                  onEliminar={onEliminar}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

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
        "whitespace-nowrap border-b px-3 py-2.5 align-middle text-[13px] " +
        (right ? "text-right" : "text-left")
      }
      style={{ borderColor: "var(--n-100)" }}
    >
      {children}
    </td>
  );
}

function EnsambleFila({ ensamble: e, esAdmin, onEliminar }) {
  const navigate = useNavigate();
  const pill = ensambleEstadoPill(e);
  const av = tecnicoAvatar(e.realizador?.nombre);
  return (
    <tr
      onClick={() => navigate(`/ops/ensambles/${e.id}`)}
      className="cursor-pointer"
      style={{ transition: "background-color .12s" }}
      onMouseEnter={(ev) =>
        (ev.currentTarget.style.backgroundColor = "var(--n-50)")
      }
      onMouseLeave={(ev) => (ev.currentTarget.style.backgroundColor = "")}
    >
      <Td>
        <span
          className="font-mono text-[12.5px] font-medium"
          style={{ color: "var(--n-950)" }}
        >
          #{e.numero}
        </span>
      </Td>
      <Td>
        <div className="flex min-w-0 flex-col leading-tight">
          <span
            className="text-[13px] font-medium"
            style={{ color: "var(--n-950)" }}
          >
            {e.producto?.nombre ?? "—"}
          </span>
          {e.producto?.referencia && (
            <span
              className="font-mono text-[11.5px]"
              style={{ color: "var(--n-500)" }}
            >
              {e.producto.referencia}
            </span>
          )}
        </div>
      </Td>
      <Td>
        {e.realizador?.nombre ? (
          <span
            className="inline-flex items-center gap-2 text-[12.5px]"
            style={{ color: "var(--n-800)" }}
          >
            <span className={`av-tec ${av.variant}`}>{av.ini}</span>
            {e.realizador.nombre}
          </span>
        ) : (
          <span style={{ color: "var(--n-300)" }}>—</span>
        )}
      </Td>
      <Td>
        <span
          className="font-mono text-[12px]"
          style={{ color: "var(--n-500)" }}
        >
          {formatDate(e.fecha)}
        </span>
      </Td>
      <Td right>
        <span
          className="font-mono text-[13px] tabular-nums"
          style={{ color: "var(--n-900)" }}
        >
          ×{e.cantidad_producida}
        </span>
      </Td>
      <Td>
        <span className={pill.cls}>
          <span className="dot" />
          {pill.label}
        </span>
      </Td>
      {esAdmin && (
        <Td right>
          <span
            className="font-mono text-[13.5px] font-medium tabular-nums"
            style={{ color: "var(--n-950)" }}
          >
            {formatCOP(e.costo_total ?? 0)}
          </span>
        </Td>
      )}
      {esAdmin && (
        <Td right>
          <button
            onClick={(ev) => {
              ev.stopPropagation();
              onEliminar(e);
            }}
            aria-label="Eliminar ensamble"
            title="Eliminar ensamble (devuelve insumos y quita el producto)"
            className="grid h-8 w-8 place-items-center rounded-md"
            style={{ color: "var(--dang-700)" }}
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </Td>
      )}
    </tr>
  );
}

/* ─────────────────────────── Card (mobile) ────────────────────────────── */

function EnsambleCard({ ensamble: e, esAdmin, onEliminar }) {
  const navigate = useNavigate();
  const pill = ensambleEstadoPill(e);
  const av = tecnicoAvatar(e.realizador?.nombre);
  return (
    <div
      onClick={() => navigate(`/ops/ensambles/${e.id}`)}
      className="cursor-pointer rounded-[10px] border px-4 py-3.5 shadow-sm"
      style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span
              className="font-mono text-[11px] font-semibold"
              style={{ color: "var(--p-600)" }}
            >
              #{e.numero}
            </span>
            <span className={pill.cls}>
              <span className="dot" />
              {pill.label}
            </span>
          </div>
          <p
            className="truncate text-[14px] font-medium leading-tight"
            style={{ color: "var(--n-950)" }}
          >
            {e.producto?.nombre ?? "—"}{" "}
            <span
              className="font-mono text-xs"
              style={{ color: "var(--n-500)" }}
            >
              ({e.producto?.referencia})
            </span>
          </p>
          <p
            className="mt-0.5 flex items-center gap-1.5 text-[11.5px]"
            style={{ color: "var(--n-500)" }}
          >
            {e.realizador?.nombre && (
              <span className={`av-tec ${av.variant}`}>{av.ini}</span>
            )}
            {formatDate(e.fecha)} · ×{e.cantidad_producida}
          </p>
        </div>
        {esAdmin && (
          <p
            className="shrink-0 font-mono text-[15px] font-semibold tabular-nums"
            style={{ color: "var(--n-950)" }}
          >
            {formatCOP(e.costo_total ?? 0)}
          </p>
        )}
      </div>
      {esAdmin && (
        <div className="mt-2 flex justify-end">
          <button
            onClick={(ev) => {
              ev.stopPropagation();
              onEliminar(e);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium"
            style={{ borderColor: "var(--dang-200)", color: "var(--dang-700)" }}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
            Eliminar
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Vista tablero (kanban) ────────────────────── */

function KanbanView({ rows, esAdmin }) {
  const navigate = useNavigate();
  return (
    <div className="kanban" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
      {ENSAMBLE_KANBAN_COLS.map((col) => {
        const items = rows.filter(col.match);
        return (
          <div key={col.id} className="kcol">
            <div className="kcol-h">
              <div className="ttl">
                <span
                  className={`kdot ${col.pulse ? "pulse" : ""}`}
                  style={{ background: col.dot }}
                />
                {col.label}
              </div>
              <span className="kct">{items.length}</span>
            </div>
            {items.map((e) => {
              const av = tecnicoAvatar(e.realizador?.nombre);
              return (
                <div
                  key={e.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/ops/ensambles/${e.id}`)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      navigate(`/ops/ensambles/${e.id}`);
                    }
                  }}
                  className={"kcard" + (e.completado ? " done" : "")}
                  style={{ cursor: "pointer" }}
                >
                  <div className="ktop">
                    <span className="knum">#{e.numero}</span>
                    {esAdmin && (
                      <span
                        className="font-mono text-[10.5px] tabular-nums"
                        style={{ color: "var(--n-500)" }}
                      >
                        {formatCOP(e.costo_total ?? 0)}
                      </span>
                    )}
                  </div>
                  <div className="kcli">{e.producto?.nombre ?? "—"}</div>
                  <div className="keqp">
                    {e.producto?.referencia ?? ""} · ×{e.cantidad_producida}
                  </div>
                  <div className="kft">
                    {e.realizador?.nombre && (
                      <span className={`av-tec ${av.variant}`}>{av.ini}</span>
                    )}
                    <span className="nm">
                      {e.realizador?.nombre ?? "Sin asignar"}
                    </span>
                  </div>
                </div>
              );
            })}
            {items.length === 0 && (
              <div
                className="rounded-md border border-dashed p-4 text-center text-[11px]"
                style={{ borderColor: "var(--n-200)", color: "var(--n-500)" }}
              >
                Sin ensambles
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── Estado vacío ─────────────────────────────── */

function Empty({ q }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <div
        className="mb-4 grid h-14 w-14 place-items-center rounded-[12px]"
        style={{ backgroundColor: "var(--p-50)", color: "var(--p-600)" }}
      >
        <Cog className="h-7 w-7" strokeWidth={1.5} />
      </div>
      <p className="font-semibold" style={{ color: "var(--n-950)" }}>
        {q ? "Sin resultados" : "Sin ensambles registrados"}
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--n-500)" }}>
        {q
          ? `No se encontraron ensambles para "${q}"`
          : 'Crea el primero con "Nuevo ensamble"'}
      </p>
    </div>
  );
}
