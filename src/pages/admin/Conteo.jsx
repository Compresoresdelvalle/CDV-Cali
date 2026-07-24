import { useState, useEffect, useRef, useMemo } from "react";
import {
  ClipboardCheck,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Target,
  Scale,
  Trash2,
  CalendarDays,
  RefreshCw,
  ListChecks,
  EyeOff,
  ScanLine,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatDate, formatCOP, safeError } from "../../lib/utils";
import { avisarOk, avisarError, avisarInfo } from "../../lib/notify";
import { applyKeywordSearch } from "../../lib/search";
import { SEDES } from "../../lib/constants";
import { SEDE_LABELS } from "../../lib/traspasos-ui";
import { useFiltros } from "../../hooks/useFiltros";
import BarraFiltros from "../../components/filtros/BarraFiltros";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import UbicacionChip from "../../components/ui/UbicacionChip";
import MapaBodega from "../../components/inventario/MapaBodega";
import QRScanner from "../../components/forms/QRScanner";
import {
  diferenciaToken,
  clasePillStyle,
  pillStyle,
  surfaceInputStyle,
} from "../../lib/admin-ops-ui";

const FILTROS = ["Todos", "Pendientes", "Aplicados"];
const VISTAS = ["Registros", "Plan"];
// Tamaño de página del historial de conteos. Antes se traían 100 y punto: con
// 446 conteos, la pestaña "Aplicados" mostraba 100 y no había forma de ver el
// resto ni de saber que existía.
const CONTEOS_PAGE = 25;

export default function Conteo() {
  const perfil = useAuthStore((s) => s.perfil);
  const isAdmin = perfil?.rol === "Admin";

  const [vista, setVista] = useState("Registros");
  const [conteos, setConteos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [filtro, setFiltro] = useState("Pendientes");
  // Paginación real: antes un `.limit(100)` escondía 346 de los 446 conteos sin
  // avisar (la pestaña "Aplicados" mostraba 100 y parecía que eso era todo).
  const [pageConteos, setPageConteos] = useState(0);
  const [totalConteos, setTotalConteos] = useState(0);
  const [hasMoreConteos, setHasMoreConteos] = useState(false);
  const [modalNuevo, setModalNuevo] = useState(false);

  // Filtros reales del historial de conteos: se cruzan con las pestañas
  // (Pendientes/Aplicados), así que se puede pedir "los conteos de CV de junio".
  // Sin texto a propósito: la única columna de texto propia es `observaciones`;
  // referencia y nombre del producto viven en un join y no se cruzan con un
  // ilike simple. Un buscador que solo mirara `observaciones` haría creer que
  // se busca por producto y devolvería vacío: mejor no ofrecerlo que mentir.
  const camposConteos = useMemo(
    () => [
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
        opciones: Object.values(SEDES).map((id) => ({
          v: id,
          l: SEDE_LABELS[id] ?? id,
        })),
      },
    ],
    [],
  );
  const fConteos = useFiltros({ clave: "conteos", campos: camposConteos });

  // Prellenado de la cola del plan: producto + sede + modo ciego ya
  // resueltos; si es null, el modal se abre en modo búsqueda normal.
  const [modalPrefill, setModalPrefill] = useState(null);
  const [aplicandoId, setAplicandoId] = useState(null);
  const [borrandoId, setBorrandoId] = useState(null);
  // Se incrementa tras registrar un conteo para que la pestaña Plan recargue
  // su progreso/cola sin acoplar ambos componentes directamente.
  const [planRefreshKey, setPlanRefreshKey] = useState(0);
  const mountedRef = useRef(true);
  const { confirm, ConfirmDialog } = useConfirm();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const cargar = async (reset = false) => {
    const myReq = fConteos.nuevoReqId();
    setLoading(true);
    setErrorMsg("");
    const paginaActual = reset ? 0 : pageConteos;
    try {
      let q = supabase.from("conteos").select(
        `id, fecha, stock_sistema, stock_fisico, diferencia, ajuste_aplicado, observaciones, sede_id,
           producto:producto_id(referencia, nombre, clasificacion, costo_promedio),
           sede:sede_id(nombre),
           contador:contado_por(nombre),
           aprobador:aprobado_por(nombre)`,
        { count: "exact" },
      );
      if (filtro === "Pendientes") q = q.eq("ajuste_aplicado", false);
      if (filtro === "Aplicados") q = q.eq("ajuste_aplicado", true);
      // Fecha y sede se resuelven en el servidor (ver `camposConteos`).
      q = fConteos.aplicar(q);
      q = q
        // Desempate: `fecha` no es única y sin él la paginación repite o salta.
        .order("fecha", { ascending: false })
        .order("id", { ascending: false })
        .range(
          paginaActual * CONTEOS_PAGE,
          (paginaActual + 1) * CONTEOS_PAGE - 1,
        );

      const { data, error, count } = await q;
      if (!mountedRef.current || !fConteos.esReqVigente(myReq)) return;
      if (error) throw error;
      const filas = data ?? [];
      if (reset) {
        setConteos(filas);
        setPageConteos(1);
      } else {
        setConteos((prev) => [...prev, ...filas]);
        setPageConteos((p) => p + 1);
      }
      const totalReal = count ?? 0;
      setTotalConteos(totalReal);
      setHasMoreConteos((paginaActual + 1) * CONTEOS_PAGE < totalReal);
    } catch (err) {
      if (!mountedRef.current || !fConteos.esReqVigente(myReq)) return;
      setErrorMsg(safeError(err, "Error al cargar conteos"));
    } finally {
      if (mountedRef.current && fConteos.esReqVigente(myReq)) setLoading(false);
    }
  };

  /**
   * Divergencias pendientes, preguntadas al servidor sobre TODO el universo
   * (respetando fecha/sede de la barra, pero NO la pestaña ni la paginación:
   * este número contesta "cuánto falta por ajustar", así que no puede depender
   * de en qué pestaña estés ni de cuántas páginas hayas cargado).
   */
  const cargarDivergencias = async () => {
    try {
      let q = supabase
        .from("conteos")
        .select(
          `id, fecha, stock_sistema, stock_fisico, diferencia, ajuste_aplicado, observaciones, sede_id,
           producto:producto_id(referencia, nombre, clasificacion, costo_promedio),
           sede:sede_id(nombre)`,
        )
        .eq("ajuste_aplicado", false)
        .neq("diferencia", 0);
      q = fConteos.aplicar(q);
      const { data, error } = await q
        .order("fecha", { ascending: false })
        .limit(500);
      if (!mountedRef.current || error) return;
      setDivPendientes(data ?? []);
    } catch {
      // Informativo: si falla, el listado principal sigue funcionando.
    }
  };

  useEffect(() => {
    // Todo cambio de filtro reinicia la paginación.
    cargar(true);
    cargarDivergencias();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro, fConteos.valoresAplicados]);

  const aplicarAjuste = async (conteo) => {
    const ok = await confirm({
      titulo: "Aplicar ajuste de inventario",
      mensaje: `Stock sistema: ${conteo.stock_sistema} → físico: ${conteo.stock_fisico} (diferencia: ${conteo.diferencia > 0 ? "+" : ""}${conteo.diferencia}). Se registrará un movimiento conteo_ajuste.`,
      confirmLabel: "Aplicar ajuste",
      danger: conteo.diferencia < 0,
    });
    if (!ok) return;
    setAplicandoId(conteo.id);
    try {
      const { error } = await supabase.rpc("fn_aplicar_ajuste_conteo", {
        p_conteo_id: conteo.id,
      });
      if (error) throw error;
      avisarOk("Ajuste aplicado correctamente");
      // reset=true: es un refresco tras una acción, no un "cargar más".
      await cargar(true);
      await cargarDivergencias();
    } catch (err) {
      avisarError(err, "Error al aplicar ajuste");
    } finally {
      setAplicandoId(null);
    }
  };

  // REQ6 — borrar un conteo PENDIENTE creado por error. El trigger
  // trg_before_delete_conteo blinda: solo pendientes y solo Admin.
  const borrarConteo = async (conteo) => {
    const ok = await confirm({
      titulo: "Eliminar conteo pendiente",
      mensaje: `Se eliminará el conteo de "${conteo.producto?.nombre ?? "producto"}" (sistema ${conteo.stock_sistema} → físico ${conteo.stock_fisico}). Esta acción no se puede deshacer. Solo aplica a conteos NO aplicados.`,
      confirmLabel: "Eliminar conteo",
      danger: true,
    });
    if (!ok) return;
    setBorrandoId(conteo.id);
    try {
      const { error } = await supabase
        .from("conteos")
        .delete()
        .eq("id", conteo.id)
        .eq("ajuste_aplicado", false);
      if (error) throw error;
      avisarOk("Conteo eliminado");
      await cargar(true);
      await cargarDivergencias();
    } catch (err) {
      avisarError(err, "No se pudo eliminar el conteo");
    } finally {
      setBorrandoId(null);
    }
  };

  // KPIs derivados de la vista actual (datos reales).
  const pendientes = conteos.filter((c) => !c.ajuste_aplicado).length;
  const aplicados = conteos.filter((c) => c.ajuste_aplicado).length;
  const divergencias = conteos.filter((c) => Number(c.diferencia) !== 0).length;

  // Divergencias por ajustar: conteos pendientes con diferencia ≠ 0.
  // Valor estimado = |diferencia| × costo_promedio real del producto.
  //
  // Se piden al SERVIDOR aparte, no se derivan de `conteos`: esa lista está
  // paginada, así que derivarlas de ahí mostraría solo las divergencias de la
  // página cargada y el valor total saldría corto sin avisar. Son la cola de
  // trabajo (0 hoy), así que caben de sobra en una consulta.
  const [divPendientes, setDivPendientes] = useState([]);
  const valorDivergencias = divPendientes.reduce(
    (acc, c) =>
      acc +
      Math.abs(Number(c.diferencia)) * Number(c.producto?.costo_promedio ?? 0),
    0,
  );

  // Precisión de inventario sobre la vista cargada: % de conteos cuadrados.
  const precision =
    conteos.length > 0
      ? ((conteos.length - divergencias) / conteos.length) * 100
      : null;

  return (
    <div className="flex flex-col gap-6 px-5 pb-8 pt-6 sm:px-7 animate-fade-in">
      {/* Page head */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="m-0 mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Admin · Auditoría de inventario
          </p>
          <h1
            className="m-0 text-[24px] font-semibold leading-tight tracking-[-0.018em]"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Conteo cíclico
          </h1>
          <p
            className="mt-1 text-[13px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Conciliación de stock físico vs. sistema con ajuste auditable.
          </p>
        </div>
        <button
          onClick={() => setModalNuevo(true)}
          className="inline-flex h-12 items-center gap-1.5 rounded-md px-4 text-[12.5px] font-semibold transition-opacity cursor-pointer hover:opacity-90"
          style={{
            backgroundColor: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
          }}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          Nuevo conteo
        </button>
      </div>

      {errorMsg && <Banner type="destructive">{errorMsg}</Banner>}

      {/* Tabs de nivel superior — Registros (todo lo existente) vs Plan (nuevo) */}
      <div
        className="flex flex-wrap items-center gap-1.5 border-b"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        {VISTAS.map((v) => {
          const on = v === vista;
          return (
            <button
              key={v}
              onClick={() => setVista(v)}
              className="inline-flex items-center gap-2 border-b-2 px-3.5 pb-2.5 pt-1 text-[13px] font-semibold transition-colors cursor-pointer"
              style={{
                borderColor: on ? "hsl(var(--primary))" : "transparent",
                color: on
                  ? "hsl(var(--foreground))"
                  : "hsl(var(--muted-foreground))",
              }}
            >
              {v}
            </button>
          );
        })}
      </div>

      {vista === "Plan" && (
        <PlanConteoTab
          perfil={perfil}
          isAdmin={isAdmin}
          refreshKey={planRefreshKey}
          onAbrirConteo={(prefill) => {
            setModalPrefill(prefill);
            setModalNuevo(true);
          }}
        />
      )}

      {vista === "Registros" && (
        <>
          {/* KPI strip (4 columnas estilo Lovable) */}
          <div
            className="grid grid-cols-2 gap-y-4 border-b pb-5 pt-1 md:grid-cols-4 md:gap-y-0"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <Kpi
              label="Conteos en vista"
              value={conteos.length}
              sub={`${aplicados} ya aplicados`}
              icon={ClipboardCheck}
            />
            <Kpi
              label="Pendientes de ajuste"
              value={pendientes}
              sub={`${divergencias} con divergencia`}
              token={pendientes > 0 ? "--warning" : "--muted-foreground"}
              icon={AlertTriangle}
            />
            <Kpi
              label="Valor divergencias"
              value={formatCOP(valorDivergencias)}
              sub="Pendiente de ajustar"
              token={valorDivergencias > 0 ? "--destructive" : "--success"}
              icon={Scale}
            />
            <Kpi
              last
              label="Precisión (vista)"
              value={precision === null ? "—" : `${precision.toFixed(1)} %`}
              sub="Conteos cuadrados"
              token={
                precision === null
                  ? "--muted-foreground"
                  : precision >= 98
                    ? "--success"
                    : "--warning"
              }
              icon={Target}
            />
          </div>

          {/* Tabs de filtro */}
          <div
            className="flex flex-wrap items-center gap-1.5 border-b"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            {FILTROS.map((f) => {
              const on = f === filtro;
              return (
                <button
                  key={f}
                  onClick={() => setFiltro(f)}
                  className="inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 pt-1 text-[12.5px] font-medium transition-colors cursor-pointer"
                  style={{
                    borderColor: on ? "hsl(var(--primary))" : "transparent",
                    color: on
                      ? "hsl(var(--foreground))"
                      : "hsl(var(--muted-foreground))",
                  }}
                >
                  {f}
                  {on && !loading && (
                    <span
                      className="grid h-[18px] min-w-[18px] place-items-center rounded-full px-1.5 font-mono text-[10.5px] tabular-nums"
                      style={{
                        backgroundColor: "hsl(var(--muted) / 0.6)",
                        color: "hsl(var(--muted-foreground))",
                      }}
                    >
                      {conteos.length}
                    </span>
                  )}
                </button>
              );
            })}
            {/* Conteo REAL del filtro (count exacto del servidor), no el de lo
                cargado: con 446 conteos, decir "100" era falso. */}
            <span
              className="ml-auto font-mono text-[10.5px] tracking-[0.04em]"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {loading
                ? "cargando…"
                : conteos.length === totalConteos
                  ? `${totalConteos} conteo(s)`
                  : `${conteos.length} de ${totalConteos} conteo(s)`}
            </span>
          </div>

          {/* Sin campo de texto (ver `camposConteos`): la barra solo ofrece
              fecha y sede, más los chips de lo que esté activo. */}
          <BarraFiltros filtros={fConteos} />

          {loading ? (
            <SkeletonList />
          ) : conteos.length === 0 ? (
            <Empty icon="📋">Sin conteos {filtro.toLowerCase()}</Empty>
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
                        "Producto",
                        "Sede · contó",
                        "Sistema",
                        "Físico",
                        "Δ",
                        "Estado",
                        "",
                      ].map((c, i) => (
                        <th
                          key={c || i}
                          className={`px-3 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] ${
                            i >= 2 && i <= 4 ? "text-right" : "text-left"
                          }`}
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {conteos.map((c) => {
                      const difToken = diferenciaToken(Number(c.diferencia));
                      return (
                        <tr
                          key={c.id}
                          className="border-t align-top"
                          style={{ borderColor: "hsl(var(--border) / 0.6)" }}
                        >
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <p
                                className="max-w-[220px] truncate text-[13px] font-medium"
                                style={{ color: "hsl(var(--foreground))" }}
                              >
                                {c.producto?.nombre}
                              </p>
                              <ClasePill clase={c.producto?.clasificacion} />
                            </div>
                            <p
                              className="font-mono text-[11px]"
                              style={{ color: "hsl(var(--muted-foreground))" }}
                            >
                              {c.producto?.referencia}
                            </p>
                            {c.observaciones && (
                              <p
                                className="mt-0.5 text-[11px] italic"
                                style={{
                                  color: "hsl(var(--muted-foreground))",
                                }}
                              >
                                {c.observaciones}
                              </p>
                            )}
                          </td>
                          <td
                            className="px-3 py-3 text-[12px]"
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          >
                            <span style={{ color: "hsl(var(--foreground))" }}>
                              {c.sede?.nombre ?? c.sede_id}
                            </span>
                            <br />
                            {formatDate(c.fecha)} · {c.contador?.nombre}
                            {c.aprobador && ` · Aprobó: ${c.aprobador.nombre}`}
                          </td>
                          <td
                            className="px-3 py-3 text-right font-mono text-[13px] tabular-nums"
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          >
                            {c.stock_sistema}
                          </td>
                          <td
                            className="px-3 py-3 text-right font-mono text-[13px] font-semibold tabular-nums"
                            style={{ color: "hsl(var(--foreground))" }}
                          >
                            {c.stock_fisico}
                          </td>
                          <td
                            className="px-3 py-3 text-right font-mono text-[13px] font-bold tabular-nums"
                            style={{ color: `hsl(var(${difToken}))` }}
                          >
                            {c.diferencia > 0 ? "+" : ""}
                            {c.diferencia}
                          </td>
                          <td className="px-3 py-3">
                            <EstadoBadge aplicado={c.ajuste_aplicado} />
                          </td>
                          <td className="px-3 py-3 text-right">
                            {!c.ajuste_aplicado && isAdmin && (
                              <div className="inline-flex items-center gap-2">
                                <button
                                  onClick={() => aplicarAjuste(c)}
                                  disabled={
                                    aplicandoId === c.id || borrandoId === c.id
                                  }
                                  className="inline-flex h-9 items-center rounded-md px-3 text-[12px] font-semibold transition-opacity cursor-pointer hover:opacity-90 disabled:opacity-50"
                                  style={{
                                    backgroundColor: "hsl(var(--primary))",
                                    color: "hsl(var(--primary-foreground))",
                                  }}
                                >
                                  {aplicandoId === c.id ? "…" : "Aplicar"}
                                </button>
                                <button
                                  onClick={() => borrarConteo(c)}
                                  disabled={
                                    aplicandoId === c.id || borrandoId === c.id
                                  }
                                  title="Eliminar conteo pendiente"
                                  aria-label="Eliminar conteo pendiente"
                                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors cursor-pointer disabled:opacity-50"
                                  style={{
                                    borderColor: "hsl(var(--border))",
                                    color: "hsl(var(--destructive))",
                                  }}
                                  onMouseEnter={(e) =>
                                    (e.currentTarget.style.backgroundColor =
                                      "hsl(var(--destructive) / 0.08)")
                                  }
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.backgroundColor = "")
                                  }
                                >
                                  <Trash2
                                    className="h-4 w-4"
                                    strokeWidth={1.75}
                                  />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <ul className="divide-y md:hidden" role="list">
                {conteos.map((c) => {
                  const difToken = diferenciaToken(Number(c.diferencia));
                  return (
                    <li
                      key={c.id}
                      className="px-4 py-3.5"
                      style={{ borderColor: "hsl(var(--border))" }}
                    >
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p
                              className="truncate text-sm font-semibold"
                              style={{ color: "hsl(var(--foreground))" }}
                            >
                              {c.producto?.nombre}
                            </p>
                            <ClasePill clase={c.producto?.clasificacion} />
                          </div>
                          <p
                            className="font-mono text-xs"
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          >
                            {c.producto?.referencia}
                          </p>
                        </div>
                        <EstadoBadge aplicado={c.ajuste_aplicado} />
                      </div>
                      <p
                        className="text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {c.sede?.nombre ?? c.sede_id} · {formatDate(c.fecha)} ·
                        Contó: {c.contador?.nombre}
                        {c.aprobador && ` · Aprobó: ${c.aprobador.nombre}`}
                      </p>
                      {c.observaciones && (
                        <p
                          className="mt-0.5 text-xs italic"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {c.observaciones}
                        </p>
                      )}
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-4 font-mono text-xs tabular-nums">
                          <span
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          >
                            Sistema {c.stock_sistema}
                          </span>
                          <span style={{ color: "hsl(var(--foreground))" }}>
                            Físico {c.stock_fisico}
                          </span>
                          <span
                            className="font-bold"
                            style={{ color: `hsl(var(${difToken}))` }}
                          >
                            Δ {c.diferencia > 0 ? "+" : ""}
                            {c.diferencia}
                          </span>
                        </div>
                        {!c.ajuste_aplicado && isAdmin && (
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              onClick={() => aplicarAjuste(c)}
                              disabled={
                                aplicandoId === c.id || borrandoId === c.id
                              }
                              className="h-11 rounded-lg px-4 text-xs font-semibold cursor-pointer disabled:opacity-50"
                              style={{
                                backgroundColor: "hsl(var(--primary))",
                                color: "hsl(var(--primary-foreground))",
                              }}
                            >
                              {aplicandoId === c.id ? "…" : "Aplicar"}
                            </button>
                            <button
                              onClick={() => borrarConteo(c)}
                              disabled={
                                aplicandoId === c.id || borrandoId === c.id
                              }
                              aria-label="Eliminar conteo pendiente"
                              className="grid h-11 w-11 place-items-center rounded-lg border cursor-pointer disabled:opacity-50"
                              style={{
                                borderColor: "hsl(var(--border))",
                                color: "hsl(var(--destructive))",
                              }}
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Cargar más: con 446 conteos y páginas de 25, sin esto el operario
              solo veía los primeros y nada le decía que había más. */}
          {!loading && hasMoreConteos && (
            <button
              onClick={() => cargar(false)}
              className="h-12 w-full rounded-lg border text-sm font-medium"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--foreground))",
              }}
            >
              Cargar más ({conteos.length} de {totalConteos})
            </button>
          )}

          {/* ── Divergencias por ajustar (derivado de conteos pendientes) ──── */}
          {!loading && divPendientes.length > 0 && (
            <DivergenciasSection
              items={divPendientes}
              valorTotal={valorDivergencias}
              isAdmin={isAdmin}
              aplicandoId={aplicandoId}
              onAplicar={aplicarAjuste}
            />
          )}
        </>
      )}

      {modalNuevo && (
        <ModalNuevoConteo
          perfil={perfil}
          productoInicial={modalPrefill?.producto ?? null}
          sedeInicial={modalPrefill?.sede ?? null}
          ciego={modalPrefill?.ciego ?? false}
          onClose={() => {
            setModalNuevo(false);
            setModalPrefill(null);
          }}
          onSaved={async () => {
            setModalNuevo(false);
            setModalPrefill(null);
            avisarOk("Conteo registrado");
            await cargar(true);
            await cargarDivergencias();
            setPlanRefreshKey((k) => k + 1);
          }}
        />
      )}
      <ConfirmDialog />
    </div>
  );
}

/* ── KPI con separadores punteados ────────────────────────────────────── */
function Kpi({ label, value, sub, token, last, icon: Icon }) {
  return (
    <div
      className={`flex flex-col gap-1.5 pr-7 md:pl-7 md:first:pl-0 ${
        last ? "" : "md:border-r md:border-dashed"
      }`}
      style={last ? undefined : { borderColor: "hsl(var(--border))" }}
    >
      <div
        className="flex items-center gap-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />}
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
      {sub && (
        <div
          className="text-[11.5px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function EstadoBadge({ aplicado }) {
  const token = aplicado ? "--success" : "--warning";
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-[3px] border px-1.5 py-0.5 font-mono text-[10.5px] font-semibold leading-[1.4]"
      style={pillStyle(token)}
    >
      {aplicado ? "Aplicado" : "Pendiente"}
    </span>
  );
}

/* Pill de clasificación ABC (clasificacion real del producto). */
function ClasePill({ clase }) {
  if (!clase) return null;
  return (
    <span
      className="inline-flex h-[20px] shrink-0 items-center rounded-[4px] border px-1.5 font-mono text-[10px] font-semibold leading-none"
      style={clasePillStyle(clase)}
    >
      Clase {clase}
    </span>
  );
}

/* ── Divergencias por ajustar (sección Lovable, datos reales) ──────────────
 * Lista los conteos pendientes con diferencia ≠ 0, con valor estimado real
 * (|Δ| × costo_promedio). El botón reutiliza el mismo flujo RPC server-side
 * (`fn_aplicar_ajuste_conteo`) que la tabla principal. */
function DivergenciasSection({
  items,
  valorTotal,
  isAdmin,
  aplicandoId,
  onAplicar,
}) {
  return (
    <section
      className="overflow-hidden rounded-[10px] border"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <header
        className="flex flex-wrap items-center justify-between gap-3 border-b px-[18px] py-3"
        style={{
          borderColor: "hsl(var(--border))",
          backgroundColor: "hsl(var(--muted) / 0.3)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-7 w-7 place-items-center rounded-md"
            style={{
              backgroundColor: "hsl(var(--warning) / 0.12)",
              color: "hsl(var(--warning))",
            }}
          >
            <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
          <div className="flex flex-col gap-0.5">
            <span
              className="text-[13px] font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Divergencias por ajustar
            </span>
            <span
              className="font-mono text-[10.5px] tracking-[0.04em]"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {items.length} producto(s) · valor estimado{" "}
              <span style={{ color: "hsl(var(--foreground))" }}>
                {formatCOP(valorTotal)}
              </span>
            </span>
          </div>
        </div>
      </header>

      {/* Desktop */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr
              className="text-left"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderBottom: "1px solid hsl(var(--border))",
              }}
            >
              {["Producto", "Sede", "Sistema", "Físico", "Δ", "Valor", ""].map(
                (c, i) => (
                  <th
                    key={c || i}
                    className={`px-3 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] ${
                      i >= 2 && i <= 5 ? "text-right" : "text-left"
                    }`}
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {c}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const delta = Number(c.diferencia);
              const difToken = diferenciaToken(delta);
              const valor =
                Math.abs(delta) * Number(c.producto?.costo_promedio ?? 0);
              return (
                <tr
                  key={c.id}
                  className="border-t"
                  style={{ borderColor: "hsl(var(--border) / 0.6)" }}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="max-w-[220px] truncate text-[12.5px]"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {c.producto?.nombre}
                      </span>
                      <ClasePill clase={c.producto?.clasificacion} />
                    </div>
                    <span
                      className="font-mono text-[10.5px]"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {c.producto?.referencia}
                    </span>
                  </td>
                  <td
                    className="px-3 py-2.5 text-[11.5px]"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {c.sede?.nombre ?? c.sede_id}
                  </td>
                  <td
                    className="px-3 py-2.5 text-right font-mono tabular-nums"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {c.stock_sistema}
                  </td>
                  <td
                    className="px-3 py-2.5 text-right font-mono tabular-nums"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {c.stock_fisico}
                  </td>
                  <td
                    className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums"
                    style={{ color: `hsl(var(${difToken}))` }}
                  >
                    {delta > 0 ? "+" : ""}
                    {delta}
                  </td>
                  <td
                    className="px-3 py-2.5 text-right font-mono tabular-nums"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {formatCOP(valor)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {isAdmin && (
                      <button
                        onClick={() => onAplicar(c)}
                        disabled={aplicandoId === c.id}
                        className="inline-flex h-9 items-center rounded-md px-3 text-[12px] font-semibold transition-opacity cursor-pointer hover:opacity-90 disabled:opacity-50"
                        style={{
                          backgroundColor: "hsl(var(--primary))",
                          color: "hsl(var(--primary-foreground))",
                        }}
                      >
                        {aplicandoId === c.id ? "…" : "Ajustar"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <ul className="divide-y md:hidden" role="list">
        {items.map((c) => {
          const delta = Number(c.diferencia);
          const difToken = diferenciaToken(delta);
          const valor =
            Math.abs(delta) * Number(c.producto?.costo_promedio ?? 0);
          return (
            <li
              key={c.id}
              className="px-4 py-3"
              style={{ borderColor: "hsl(var(--border))" }}
            >
              <div className="flex items-center gap-2">
                <p
                  className="truncate text-sm font-medium"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {c.producto?.nombre}
                </p>
                <ClasePill clase={c.producto?.clasificacion} />
              </div>
              <p
                className="font-mono text-xs"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {c.producto?.referencia} · {c.sede?.nombre ?? c.sede_id}
              </p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 font-mono text-xs tabular-nums">
                  <span style={{ color: "hsl(var(--muted-foreground))" }}>
                    {c.stock_sistema} → {c.stock_fisico}
                  </span>
                  <span
                    className="font-bold"
                    style={{ color: `hsl(var(${difToken}))` }}
                  >
                    Δ {delta > 0 ? "+" : ""}
                    {delta}
                  </span>
                  <span style={{ color: "hsl(var(--foreground))" }}>
                    {formatCOP(valor)}
                  </span>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => onAplicar(c)}
                    disabled={aplicandoId === c.id}
                    className="h-11 shrink-0 rounded-lg px-4 text-xs font-semibold cursor-pointer disabled:opacity-50"
                    style={{
                      backgroundColor: "hsl(var(--primary))",
                      color: "hsl(var(--primary-foreground))",
                    }}
                  >
                    {aplicandoId === c.id ? "…" : "Ajustar"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ── Pestaña "Plan" — conteo cíclico programado (Bloque C) ──────────────
 * Reparte el universo de productos con stock de una sede en semanas
 * (clase A cada 4-6 semanas, B/C una vez por ciclo) y expone una cola diaria
 * de "lo que toca contar hoy". Cualquier conteo registrado —desde aquí o
 * desde el flujo libre de Registros— avanza el plan solo (trigger backend).
 */
function PlanConteoTab({ perfil, isAdmin, refreshKey, onAbrirConteo }) {
  const [sede, setSede] = useState(perfil?.sede_id ?? SEDES.BODEGA);
  const [progreso, setProgreso] = useState(null);
  const [cola, setCola] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [horizonte, setHorizonte] = useState(90);
  const [ciegoForm, setCiegoForm] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [universoEstimado, setUniversoEstimado] = useState(null);
  const { confirm, ConfirmDialog } = useConfirm();

  const cargarPlan = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const [{ data: prog, error: e1 }, { data: colaData, error: e2 }] =
        await Promise.all([
          supabase.rpc("fn_progreso_plan", { p_sede_id: sede }),
          supabase.rpc("fn_cola_conteo_hoy", { p_sede_id: sede }),
        ]);
      if (e1) throw e1;
      if (e2) throw e2;
      setProgreso(prog ?? null);
      setCola(colaData ?? []);
    } catch (err) {
      setErrorMsg(safeError(err, "Error al cargar el plan de conteo"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarPlan();
    setMostrarForm(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sede, refreshKey]);

  // Estimación del universo de productos con stock en la sede (mismo criterio
  // que el backend: pool vendible o insumo según productos.vendible).
  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const { count, error } = await supabase
          .from("inventario")
          .select("producto_id, productos!inner(activo, vendible)", {
            count: "exact",
            head: true,
          })
          .eq("sede_id", sede)
          .eq("productos.activo", true)
          .or("cantidad.gt.0,cantidad_insumo.gt.0");
        if (!cancelado && !error) setUniversoEstimado(count ?? null);
      } catch {
        if (!cancelado) setUniversoEstimado(null);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [sede]);

  const generarPlan = async () => {
    setGenerando(true);
    try {
      const { error } = await supabase.rpc("fn_generar_plan_conteo", {
        p_sede_id: sede,
        p_horizonte_dias: horizonte,
        p_conteo_ciego: ciegoForm,
      });
      if (error) throw error;
      avisarOk("Plan de conteo generado correctamente");
      setMostrarForm(false);
      await cargarPlan();
    } catch (err) {
      avisarError(err, "Error al generar el plan");
    } finally {
      setGenerando(false);
    }
  };

  const regenerarPlan = async () => {
    const ok = await confirm({
      titulo: "Regenerar plan de conteo",
      mensaje:
        "Se descartará el progreso del plan actual (el historial se conserva) y se creará uno nuevo desde cero. ¿Continuar?",
      confirmLabel: "Regenerar plan",
      danger: true,
    });
    if (!ok) return;
    setMostrarForm(true);
  };

  const abrirDesdeQueue = (item) => {
    onAbrirConteo({
      producto: {
        id: item.producto_id,
        referencia: item.referencia,
        nombre: item.nombre,
        vendible: item.vendible,
        stock_sistema: item.stock_sistema,
        ubicacion_id: item.ubicacion_id,
      },
      sede,
      ciego: !!progreso?.conteo_ciego,
    });
  };

  const cobertura =
    progreso && progreso.total_items > 0
      ? (progreso.items_contados / progreso.total_items) * 100
      : 0;

  // Hallazgo B: BODEGA tiene ubicación asignada en ~48% de sus filas, pero
  // CV/CHV/L3 están prácticamente en 0%. Si forzamos "Sin ubicar" siempre,
  // en esas sedes el chip gris sale en cada fila de la cola y se vuelve
  // ruido que el operario aprende a ignorar. Solo lo activamos si AL MENOS
  // UNA fila de la cola YA cargada tiene ubicación: ahí sí vale la pena que
  // resalte la que falta.
  const haySedeConUbicaciones = useMemo(
    () => cola.some((item) => !!item.ubicacion_id),
    [cola],
  );

  return (
    <div className="flex flex-col gap-5">
      {errorMsg && <Banner type="destructive">{errorMsg}</Banner>}

      {/* Selector de sede: Admin elige, el resto ve su sede fija. */}
      <div className="flex items-center gap-3">
        <label
          className="text-xs font-medium"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Sede
        </label>
        {isAdmin ? (
          <select
            value={sede}
            onChange={(e) => setSede(e.target.value)}
            className="h-11 rounded-lg border px-3 text-sm"
            style={surfaceInputStyle}
          >
            {Object.values(SEDES).map((s) => (
              <option key={s} value={s}>
                {SEDE_LABELS[s] ?? s}
              </option>
            ))}
          </select>
        ) : (
          <div
            className="flex h-11 items-center rounded-lg border px-3 text-sm"
            style={{ ...surfaceInputStyle, opacity: 0.8 }}
          >
            {SEDE_LABELS[sede] ?? sede}
          </div>
        )}
      </div>

      {loading ? (
        <SkeletonList />
      ) : !progreso || mostrarForm ? (
        <GenerarPlanForm
          isAdmin={isAdmin}
          horizonte={horizonte}
          setHorizonte={setHorizonte}
          ciegoForm={ciegoForm}
          setCiegoForm={setCiegoForm}
          generando={generando}
          universoEstimado={universoEstimado}
          onGenerar={generarPlan}
          onCancelar={progreso ? () => setMostrarForm(false) : null}
        />
      ) : (
        <>
          {/* KPI strip del plan activo */}
          <div
            className="grid grid-cols-2 gap-y-4 border-b pb-5 pt-1 md:grid-cols-4 md:gap-y-0"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <Kpi
              label="Hoy por contar"
              value={progreso.pendientes_hoy}
              sub={
                progreso.atrasados > 0
                  ? `${progreso.atrasados} atrasado(s)`
                  : "Al día"
              }
              token={progreso.atrasados > 0 ? "--warning" : "--success"}
              icon={ListChecks}
            />
            <Kpi
              label="Cobertura del ciclo"
              value={`${cobertura.toFixed(0)} %`}
              sub={`${progreso.items_contados}/${progreso.total_items} ítems`}
              icon={CheckCircle2}
            />
            <Kpi
              label="Semana"
              value={`${progreso.semana_actual} / ${progreso.semanas_totales}`}
              sub={`Ciclo de ${progreso.horizonte_dias} días`}
              icon={CalendarDays}
            />
            <Kpi
              last
              label="Precisión del ciclo"
              value={
                progreso.precision_ciclo === null
                  ? "—"
                  : `${progreso.precision_ciclo} %`
              }
              sub="Ítems contados cuadrados"
              token={
                progreso.precision_ciclo === null
                  ? "--muted-foreground"
                  : progreso.precision_ciclo >= 98
                    ? "--success"
                    : "--warning"
              }
              icon={Target}
            />
          </div>

          {/* Barra de progreso visual */}
          <div>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full"
              style={{ backgroundColor: "hsl(var(--muted) / 0.5)" }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(cobertura, 100)}%`,
                  backgroundColor: "hsl(var(--primary))",
                }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <p
                className="font-mono text-[11px]"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {progreso.conteo_ciego && (
                  <span className="inline-flex items-center gap-1">
                    <EyeOff className="h-3 w-3" strokeWidth={1.75} />
                    Conteo ciego activo
                  </span>
                )}
              </p>
              {isAdmin && (
                <button
                  onClick={regenerarPlan}
                  className="inline-flex items-center gap-1.5 text-xs font-medium underline cursor-pointer"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Regenerar plan
                </button>
              )}
            </div>
          </div>

          {/* Cola de hoy */}
          {cola.length === 0 ? (
            <Empty icon="✅">
              No hay productos pendientes por contar hoy en esta sede.
            </Empty>
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
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr
                      className="text-left"
                      style={{
                        backgroundColor: "hsl(var(--muted) / 0.3)",
                        borderBottom: "1px solid hsl(var(--border))",
                      }}
                    >
                      {["Producto", "Semana", "Estado", ""].map((c, i) => (
                        <th
                          key={c || i}
                          className="px-3 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em]"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cola.map((item) => (
                      <tr
                        key={item.item_id}
                        className="border-t align-top"
                        style={{ borderColor: "hsl(var(--border) / 0.6)" }}
                      >
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <p
                              className="max-w-[260px] truncate text-[13px] font-medium"
                              style={{ color: "hsl(var(--foreground))" }}
                            >
                              {item.nombre}
                            </p>
                            <ClasePill clase={item.clasificacion} />
                            <UbicacionChip
                              codigo={item.ubicacion_id}
                              conMapa
                              mostrarVacio={haySedeConUbicaciones}
                            />
                          </div>
                          <p
                            className="font-mono text-[11px]"
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          >
                            {item.referencia}
                          </p>
                        </td>
                        <td
                          className="px-3 py-3 font-mono text-[12px] tabular-nums"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          Semana {item.semana_objetivo}
                        </td>
                        <td className="px-3 py-3">
                          {item.atrasado && (
                            <span
                              className="inline-flex shrink-0 items-center rounded-[3px] border px-1.5 py-0.5 font-mono text-[10.5px] font-semibold leading-[1.4]"
                              style={pillStyle("--warning")}
                            >
                              Atrasado
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button
                            onClick={() => abrirDesdeQueue(item)}
                            className="inline-flex h-11 items-center rounded-md px-4 text-[12.5px] font-semibold transition-opacity cursor-pointer hover:opacity-90"
                            style={{
                              backgroundColor: "hsl(var(--primary))",
                              color: "hsl(var(--primary-foreground))",
                            }}
                          >
                            Contar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <ul className="divide-y md:hidden" role="list">
                {cola.map((item) => (
                  <li
                    key={item.item_id}
                    className="px-4 py-3.5"
                    style={{ borderColor: "hsl(var(--border))" }}
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p
                            className="truncate text-sm font-semibold"
                            style={{ color: "hsl(var(--foreground))" }}
                          >
                            {item.nombre}
                          </p>
                          <ClasePill clase={item.clasificacion} />
                          <UbicacionChip
                            codigo={item.ubicacion_id}
                            conMapa
                            mostrarVacio={haySedeConUbicaciones}
                          />
                        </div>
                        <p
                          className="font-mono text-xs"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {item.referencia}
                        </p>
                      </div>
                      {item.atrasado && (
                        <span
                          className="inline-flex shrink-0 items-center rounded-[3px] border px-1.5 py-0.5 font-mono text-[10.5px] font-semibold leading-[1.4]"
                          style={pillStyle("--warning")}
                        >
                          Atrasado
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span
                        className="font-mono text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        Semana {item.semana_objetivo}
                      </span>
                      <button
                        onClick={() => abrirDesdeQueue(item)}
                        className="h-11 shrink-0 rounded-lg px-4 text-xs font-semibold cursor-pointer"
                        style={{
                          backgroundColor: "hsl(var(--primary))",
                          color: "hsl(var(--primary-foreground))",
                        }}
                      >
                        Contar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <ConfirmDialog />
    </div>
  );
}

/* Formulario de generación del plan (sin plan activo, o al regenerar). */
function GenerarPlanForm({
  isAdmin,
  horizonte,
  setHorizonte,
  ciegoForm,
  setCiegoForm,
  generando,
  universoEstimado,
  onGenerar,
  onCancelar,
}) {
  const semanas = horizonte === 30 ? 4 : 13;
  return (
    <div
      className="rounded-xl border p-5"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <p
        className="text-sm font-semibold"
        style={{ color: "hsl(var(--foreground))" }}
      >
        {onCancelar ? "Regenerar plan de conteo" : "Sin plan activo"}
      </p>
      <p
        className="mt-1 text-[13px]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        Genera un plan que reparte todos los productos con stock de la sede en
        semanas según su clase ABC: clase A cada 4-6 semanas, B y C una vez por
        ciclo.
      </p>

      <div className="mt-4 flex flex-col gap-2">
        <span
          className="text-xs font-medium"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Horizonte del plan
        </span>
        <div className="flex gap-2">
          {[
            { v: 30, label: "1 mes (4 semanas)" },
            { v: 90, label: "3 meses (13 semanas)" },
          ].map((opt) => {
            const on = horizonte === opt.v;
            return (
              <button
                key={opt.v}
                type="button"
                disabled={!isAdmin}
                onClick={() => setHorizonte(opt.v)}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-lg border text-[12.5px] font-medium cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                style={
                  on
                    ? {
                        backgroundColor: "hsl(var(--primary) / 0.12)",
                        borderColor: "hsl(var(--primary))",
                        color: "hsl(var(--primary))",
                      }
                    : surfaceInputStyle
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="mt-4 flex items-center gap-2.5 text-[13px]">
        <input
          type="checkbox"
          checked={ciegoForm}
          disabled={!isAdmin}
          onChange={(e) => setCiegoForm(e.target.checked)}
          className="h-5 w-5 cursor-pointer"
        />
        <span style={{ color: "hsl(var(--foreground))" }}>
          Conteo ciego (ocultar stock del sistema al contar)
        </span>
      </label>

      {universoEstimado !== null && (
        <p
          className="mt-3 font-mono text-[11.5px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          ~{universoEstimado} producto(s) con stock → ~
          {Math.round(universoEstimado / semanas)} por semana
        </p>
      )}

      <div className="mt-4 flex gap-2">
        {onCancelar && (
          <button
            onClick={onCancelar}
            disabled={generando}
            className="h-12 flex-1 cursor-pointer rounded-lg border text-sm font-medium disabled:opacity-50"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            Cancelar
          </button>
        )}
        {isAdmin && (
          <button
            onClick={onGenerar}
            disabled={generando}
            className="h-12 flex-1 cursor-pointer rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            {generando
              ? "Generando…"
              : onCancelar
                ? "Regenerar plan"
                : "Generar plan"}
          </button>
        )}
        {!isAdmin && !onCancelar && (
          <p
            className="text-xs"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Solo un Admin puede generar el plan de conteo.
          </p>
        )}
      </div>
    </div>
  );
}

function Empty({ icon, children }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 text-5xl">{icon}</div>
      <p style={{ color: "hsl(var(--muted-foreground))" }}>{children}</p>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className="h-20 animate-pulse rounded-xl border"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        />
      ))}
    </div>
  );
}

function ModalNuevoConteo({
  perfil,
  onClose,
  onSaved,
  productoInicial = null,
  sedeInicial = null,
  ciego = false,
}) {
  // #35: el Admin puede contar cualquier sede; el resto, la suya.
  const esAdmin = perfil?.rol === "Admin";
  // Prellenado desde la cola del plan (Bloque C): producto y sede ya
  // resueltos, sin pasar por la búsqueda ni por el selector de sede.
  const prellenado = !!productoInicial;
  const [sedeConteo, setSedeConteo] = useState(
    sedeInicial ?? perfil?.sede_id ?? SEDES.BODEGA,
  );
  const [search, setSearch] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [productoSel, setProductoSel] = useState(
    productoInicial
      ? { ...productoInicial, inventario_id: null, sinInventario: false }
      : null,
  );
  const [stockSistema, setStockSistema] = useState(
    productoInicial?.stock_sistema ?? 0,
  );
  const [stockFisico, setStockFisico] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Escáner del camino B (búsqueda manual): solo aplica antes de tener
  // producto seleccionado, así que no colisiona con `productoSel`.
  const [scannerOpen, setScannerOpen] = useState(false);
  // Bloque D1: asignar ubicación física desde el modal de conteo (opcional,
  // no bloquea el registro del conteo). Solo Admin/Bodeguero.
  const puedeAsignarUbicacion =
    perfil?.rol === "Admin" || perfil?.rol === "Bodeguero";
  const [ubicacionesSede, setUbicacionesSede] = useState([]);
  const [asignandoUbicacion, setAsignandoUbicacion] = useState(false);
  useEffect(() => {
    if (!puedeAsignarUbicacion) return;
    supabase
      .from("ubicaciones")
      .select("id, descripcion, prioridad_picking")
      .eq("sede_id", sedeConteo)
      .eq("activa", true)
      .order("prioridad_picking", { ascending: true, nullsFirst: false })
      .then(({ data }) => setUbicacionesSede(data ?? []));
  }, [sedeConteo, puedeAsignarUbicacion]);

  const asignarUbicacion = async (ubicacionId) => {
    if (!productoSel) return;
    setAsignandoUbicacion(true);
    try {
      const { error: err } = await supabase.rpc("fn_asignar_ubicacion", {
        p_producto_id: productoSel.id,
        p_sede_id: sedeConteo,
        p_ubicacion_id: ubicacionId || null,
      });
      if (err) throw err;
      setProductoSel((prev) => ({
        ...prev,
        ubicacion_id: ubicacionId || null,
      }));
      avisarOk("Ubicación asignada");
    } catch (err) {
      avisarError(err, "No se pudo asignar la ubicación");
    } finally {
      setAsignandoUbicacion(false);
    }
  };

  // Cambiar la sede reinicia la selección: el stock del sistema es por sede,
  // así que un conteo a medias dejaría de ser válido al cambiarla.
  const cambiarSede = (sede) => {
    setSedeConteo(sede);
    setProductoSel(null);
    setStockFisico("");
    setSearch("");
    setResultados([]);
    setError("");
  };

  // Búsqueda
  useEffect(() => {
    if (search.trim().length < 2 || productoSel) {
      setResultados([]);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        // #32: búsqueda por palabras clave en referencia/nombre.
        let pq = supabase
          .from("productos")
          .select(
            `id, referencia, nombre, vendible, inventario:inventario(id, cantidad, cantidad_insumo, sede_id, ubicacion_id)`,
          )
          .eq("activo", true);
        pq = applyKeywordSearch(pq, search, ["referencia", "nombre"]);
        const { data, error } = await pq.limit(1000);
        if (ac.signal.aborted) return;
        if (error) throw error;
        setResultados(data ?? []);
      } catch (err) {
        if (!ac.signal.aborted) setError(safeError(err, "Error buscando"));
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [search, productoSel]);

  const seleccionar = (p) => {
    const inv = (p.inventario ?? []).find((i) => i.sede_id === sedeConteo);
    setError("");
    if (!inv) {
      // La sede aún no tiene el producto: no bloqueamos. El RPC inicializa la
      // fila en 0 al guardar (empresa de toderos). Lo avisamos en el modal.
      setProductoSel({
        ...p,
        inventario_id: null,
        sinInventario: true,
        ubicacion_id: null,
      });
      setStockSistema(0);
      setSearch("");
      setResultados([]);
      return;
    }
    setProductoSel({
      ...p,
      inventario_id: inv.id,
      sinInventario: false,
      ubicacion_id: inv.ubicacion_id ?? null,
    });
    // Conteo consciente del pool: los productos insumo (vendible=false) cuentan
    // contra cantidad_insumo, no contra el stock vendible (LEDGER-01).
    setStockSistema(
      (p.vendible === false ? inv.cantidad_insumo : inv.cantidad) ?? 0,
    );
    setSearch("");
    setResultados([]);
  };

  // Escanear deja el producto seleccionado EXACTAMENTE como si viniera de la
  // lista del buscador: se reutiliza `seleccionar` (misma forma de objeto,
  // mismo cálculo de stock por sede) en vez de duplicar esa lógica. `onFound`
  // solo trae el id, así que se hace la consulta mínima con el mismo shape
  // que la búsqueda (`inventario` como array) para no romper `seleccionar`.
  const onQRFound = async (productoId) => {
    setScannerOpen(false);
    try {
      const { data, error } = await supabase
        .from("productos")
        .select(
          `id, referencia, nombre, vendible, inventario:inventario(id, cantidad, cantidad_insumo, sede_id, ubicacion_id)`,
        )
        .eq("id", productoId)
        .eq("activo", true)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        avisarError("No se pudo cargar el producto escaneado.");
        return;
      }
      const tieneInventarioEnSede = (data.inventario ?? []).some(
        (i) => i.sede_id === sedeConteo,
      );
      seleccionar(data);
      // El buscador ya deja contar igual sin inventario en la sede (se
      // inicializa en 0, ver el banner de `sinInventario` más abajo); acá
      // ADEMÁS avisamos con un toast porque tras escanear el operario ya se
      // movió al siguiente producto y podría no ver el aviso fijo del modal.
      // Informativo, no error: contar en cero un producto que el sistema
      // aún no tiene en esta sede es justo para lo que sirve el conteo
      // cíclico, no un fallo de la operación.
      if (!tieneInventarioEnSede) {
        avisarInfo(
          `"${data.nombre}" no tenía inventario en ${SEDE_LABELS[sedeConteo] ?? sedeConteo}. Se contará desde 0.`,
        );
      }
    } catch (err) {
      avisarError(err, "No se pudo cargar el producto escaneado");
    }
  };

  const guardar = async () => {
    if (!productoSel) {
      setError("Selecciona un producto");
      return;
    }
    const fisico = parseInt(stockFisico, 10);
    if (isNaN(fisico) || fisico < 0) {
      setError("Stock físico inválido");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // RPC server-side: lee stock_sistema con FOR UPDATE en el momento del
      // insert (anti-race), valida rol Admin/Bodeguero y sede, calcula diferencia.
      const { data, error } = await supabase.rpc("fn_registrar_conteo", {
        p_producto_id: productoSel.id,
        p_stock_fisico: fisico,
        p_observaciones: observaciones.trim() || null,
        p_sede_id: sedeConteo,
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error("No se pudo registrar el conteo");
      await onSaved();
    } catch (err) {
      avisarError(err, "Error al guardar conteo");
    } finally {
      setSaving(false);
    }
  };

  const dif = (parseInt(stockFisico, 10) || 0) - stockSistema;
  const difToken = diferenciaToken(dif);

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border p-5 sm:max-w-md sm:rounded-2xl"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          <h2
            className="mb-4 text-lg font-semibold"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Nuevo conteo cíclico
          </h2>

          {error && <Banner type="destructive">{error}</Banner>}

          {/* #35: sede a contar — el Admin elige cualquiera; otros, la suya.
            Prellenado desde el plan: la sede ya viene resuelta, sin selector. */}
          {!prellenado && (
            <div className="mb-3">
              <label
                className="mb-1 block text-xs font-medium"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Sede a contar
              </label>
              {esAdmin ? (
                <select
                  value={sedeConteo}
                  onChange={(e) => cambiarSede(e.target.value)}
                  className="h-12 w-full rounded-lg border px-3 text-sm"
                  style={surfaceInputStyle}
                >
                  {Object.values(SEDES).map((s) => (
                    <option key={s} value={s}>
                      {SEDE_LABELS[s] ?? s}
                    </option>
                  ))}
                </select>
              ) : (
                <div
                  className="flex h-12 items-center rounded-lg border px-3 text-sm"
                  style={{ ...surfaceInputStyle, opacity: 0.8 }}
                >
                  {SEDE_LABELS[sedeConteo] ?? sedeConteo}
                </div>
              )}
            </div>
          )}
          {prellenado && (
            <p
              className="mb-3 text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Sede: <strong>{SEDE_LABELS[sedeConteo] ?? sedeConteo}</strong>
            </p>
          )}

          {!productoSel ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar producto por nombre o referencia (mín 2 letras)…"
                  className="h-12 min-w-0 flex-1 rounded-lg border px-3 text-sm"
                  style={surfaceInputStyle}
                />
                {/* Escaneo del camino B: con miles de referencias parecidas
                  (bushings, racores, niples), teclear mientras se sostiene la
                  mercancía es lento y propenso a elegir mal. */}
                <button
                  type="button"
                  onClick={() => setScannerOpen(true)}
                  aria-label="Escanear código QR del producto"
                  title="Escanear código QR"
                  className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-lg border"
                  style={surfaceInputStyle}
                >
                  <ScanLine className="h-5 w-5" strokeWidth={1.75} />
                </button>
              </div>
              {buscando && (
                <p
                  className="text-xs"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Buscando…
                </p>
              )}
              {resultados.length > 0 && (
                <ul
                  className="max-h-60 overflow-y-auto overflow-hidden rounded-lg border"
                  style={{ borderColor: "hsl(var(--border))" }}
                >
                  {resultados.map((p) => (
                    <li key={p.id}>
                      <button
                        onClick={() => seleccionar(p)}
                        className="w-full cursor-pointer px-3 py-2.5 text-left transition-colors"
                        style={{
                          backgroundColor: "hsl(var(--card))",
                          borderBottom: "1px solid hsl(var(--border) / 0.5)",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.backgroundColor =
                            "hsl(var(--muted) / 0.4)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.backgroundColor =
                            "hsl(var(--card))")
                        }
                      >
                        <p
                          className="text-sm font-medium"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {p.nombre}
                        </p>
                        <p
                          className="font-mono text-xs"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {p.referencia}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div
                className="rounded-lg border p-3"
                style={{
                  backgroundColor: "hsl(var(--muted) / 0.3)",
                  borderColor: "hsl(var(--primary))",
                }}
              >
                <p
                  className="flex items-center gap-1.5 text-sm font-semibold"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {productoSel.nombre}
                  {/* Hallazgo B: este modal se abre tanto desde la cola del
                    plan (que sabe si la sede usa ubicaciones) como desde la
                    búsqueda manual de "Nuevo conteo" (cualquier sede, sin ese
                    contexto). Sin una forma confiable de saber aquí si la
                    sede en cuestión usa ubicaciones, se deja SIN mostrarVacio:
                    mejor no mostrar el chip gris que mostrarlo siempre. */}
                  <UbicacionChip codigo={productoSel.ubicacion_id} conMapa />
                </p>
                <p
                  className="font-mono text-xs"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {productoSel.referencia}
                </p>
                {!prellenado && (
                  <button
                    onClick={() => setProductoSel(null)}
                    className="mt-1 cursor-pointer text-xs underline"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    Cambiar
                  </button>
                )}
              </div>

              {/* Bloque D1: sin bloquear el conteo, Admin/Bodeguero pueden
                asignar la ubicación física si el producto aún no tiene. */}
              {puedeAsignarUbicacion && !productoSel.sinInventario && (
                <Field label="Asignar ubicación (opcional)">
                  <select
                    value={productoSel.ubicacion_id ?? ""}
                    onChange={(e) => asignarUbicacion(e.target.value)}
                    disabled={asignandoUbicacion}
                    className="h-12 w-full rounded-lg border px-3 text-sm disabled:opacity-60"
                    style={surfaceInputStyle}
                  >
                    <option value="">Sin ubicación</option>
                    {ubicacionesSede.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.id} — {u.descripcion}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {productoSel.ubicacion_id && (
                <div className="flex justify-center py-1">
                  <MapaBodega ubicacionId={productoSel.ubicacion_id} compact />
                </div>
              )}

              {ciego && (
                <p
                  className="text-xs italic"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Conteo ciego: el stock del sistema se oculta hasta registrar.
                </p>
              )}

              {productoSel.sinInventario && (
                <div
                  className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
                  style={{
                    backgroundColor: "hsl(var(--warning) / 0.1)",
                    borderColor: "hsl(var(--warning) / 0.4)",
                    color: "hsl(var(--foreground))",
                  }}
                >
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0"
                    strokeWidth={2}
                    style={{ color: "hsl(var(--warning))" }}
                  />
                  <span>
                    Esta sede aún no tenía este producto. Se inicializará en{" "}
                    <strong>0</strong> y se contará con el físico que registres.
                  </span>
                </div>
              )}

              <div className={ciego ? "" : "grid grid-cols-2 gap-3"}>
                {!ciego && (
                  <Field label="Stock sistema">
                    <input
                      type="number"
                      value={stockSistema}
                      disabled
                      className="h-12 w-full rounded-lg border px-3 text-sm tabular-nums"
                      style={{ ...surfaceInputStyle, opacity: 0.7 }}
                    />
                  </Field>
                )}
                <Field label="Stock físico contado *">
                  <input
                    type="number"
                    min="0"
                    value={stockFisico}
                    onChange={(e) => setStockFisico(e.target.value)}
                    autoFocus
                    className="h-12 w-full rounded-lg border px-3 text-sm font-bold tabular-nums"
                    style={surfaceInputStyle}
                  />
                </Field>
              </div>

              {/* Conteo ciego: NO se muestra el stock del sistema ni la
                diferencia — el RPC la calcula server-side igual. */}
              {!ciego && stockFisico !== "" && (
                <div
                  className="rounded-lg border p-3 text-center"
                  style={{
                    backgroundColor: `hsl(var(${difToken}) / 0.1)`,
                    borderColor: `hsl(var(${difToken}))`,
                  }}
                >
                  <p
                    className="text-xs"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    Diferencia
                  </p>
                  <p
                    className="text-2xl font-bold tabular-nums"
                    style={{ color: `hsl(var(${difToken}))` }}
                  >
                    {dif > 0 ? "+" : ""}
                    {dif} uds
                  </p>
                </div>
              )}

              <Field label="Observaciones">
                <textarea
                  rows={2}
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={surfaceInputStyle}
                />
              </Field>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={onClose}
                  disabled={saving}
                  className="h-12 flex-1 cursor-pointer rounded-lg border text-sm font-medium disabled:opacity-50"
                  style={{
                    borderColor: "hsl(var(--border))",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  Cancelar
                </button>
                <button
                  onClick={guardar}
                  disabled={saving || stockFisico === ""}
                  className="h-12 flex-1 cursor-pointer rounded-lg text-sm font-medium disabled:opacity-50"
                  style={{
                    backgroundColor: "hsl(var(--primary))",
                    color: "hsl(var(--primary-foreground))",
                  }}
                >
                  {saving ? "Guardando…" : "Registrar conteo"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* No continuo: contar es de a un producto, y el modal debe cerrarse al
        encontrarlo para escribir la cantidad contada. */}
      {scannerOpen && (
        <QRScanner onFound={onQRFound} onClose={() => setScannerOpen(false)} />
      )}
    </>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span
        className="mb-1.5 block text-xs font-medium"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Banner({ type, children }) {
  return (
    <div
      role={type === "destructive" ? "alert" : "status"}
      className="mb-3 rounded-lg border px-3 py-2 text-xs"
      style={{
        backgroundColor: `hsl(var(--${type}) / 0.08)`,
        borderColor: `hsl(var(--${type}) / 0.4)`,
        color: `hsl(var(--${type}))`,
      }}
    >
      {children}
    </div>
  );
}
