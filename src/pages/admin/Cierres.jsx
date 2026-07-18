import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Calendar,
  DollarSign,
  ShieldCheck,
  Receipt,
  CheckCircle2,
  Circle,
  Lock,
  FileText,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import { avisarOk, avisarError } from "../../lib/notify";
import FeedbackBanners from "../../components/ui/FeedbackBanners";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import { useAuthStore } from "../../stores/authStore";
import { useFiltros } from "../../hooks/useFiltros";
import BarraFiltros from "../../components/filtros/BarraFiltros";

// Los tres valores REALES de `cierres.tipo` (CHECK: diario|periodo|complementario).
// Los complementarios existían en la base pero no había forma de aislarlos en el
// histórico: solo se veían mezclados dentro de "Todos".
const TABS_HIST = [
  { id: "todos", label: "Todos", tipo: null },
  { id: "diario", label: "Diarios", tipo: "diario" },
  { id: "periodo", label: "Periodo", tipo: "periodo" },
  { id: "complementario", label: "Complementarios", tipo: "complementario" },
];

const PAGE_SIZE = 20;
// Tope del muestreo de los KPIs globales. Los cierres son pocos (uno por día como
// mucho), así que en la práctica nunca se alcanza; si se alcanzara, el KPI se
// rotula como parcial en vez de mentir.
const KPI_CAP = 1000;

const METODO_LABELS = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  crédito: "Crédito",
  varios: "Varios",
  otro: "Otro",
};

const metodoLabel = (m) => METODO_LABELS[m] ?? m ?? "—";
const cuentaLabel = (c) => c || "Sin cuenta / efectivo";

// Día de hoy en zona Colombia, formato YYYY-MM-DD (en-CA → ISO).
const hoyBogota = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

// Formatea una columna DATE ("YYYY-MM-DD") sin conversión de zona horaria.
const fmtFecha = (s) => {
  if (!s) return "";
  const [y, m, d] = String(s).slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

export default function Cierres() {
  // Solo Admin GENERA cierres; los demás roles con acceso (Bodega/caja) los
  // CONSULTAN en solo-lectura: ven totales, arqueo e histórico, sin firmar nada.
  const perfil = useAuthStore((s) => s.perfil);
  const readOnly = perfil?.rol !== "Admin";
  const hoy = hoyBogota();
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [tipo, setTipo] = useState("diario");
  const [observaciones, setObservaciones] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [arqueo, setArqueo] = useState({}); // sede_id -> efectivo contado (string)

  const [historial, setHistorial] = useState([]);
  const [loadingHist, setLoadingHist] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [tabHist, setTabHist] = useState("todos");
  const [page, setPage] = useState(0);
  const [totalHist, setTotalHist] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [responsables, setResponsables] = useState([]);
  // KPIs del cockpit: GLOBALES y ajenos al filtro del histórico. Se calculaban
  // sumando el array cargado, así que con paginación mentirían.
  const [kpis, setKpis] = useState({
    total: 0,
    margenPeriodo: 0,
    ultimo: null,
    aprox: false,
  });

  const [errorMsg, setErrorMsg] = useState("");
  const mountedRef = useRef(true);
  const generandoRef = useRef(false); // guard síncrono anti doble-submit
  const previewSeqRef = useRef(0); // token de secuencia anti preview obsoleto
  const { confirm, ConfirmDialog } = useConfirm();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Responsables REALES: se derivan de los cierres existentes, no de la lista de
  // usuarios. Un Admin desactivado sigue apareciendo en sus cierres firmados y
  // debe poder filtrarse.
  const cargarResponsables = useCallback(async () => {
    const { data, error } = await supabase
      .from("cierres")
      .select("cerrado_por, resp:usuarios(nombre)")
      .not("cerrado_por", "is", null)
      .limit(KPI_CAP);
    if (!mountedRef.current || error) return;
    const map = new Map();
    for (const r of data ?? []) {
      if (r.cerrado_por && !map.has(r.cerrado_por)) {
        map.set(r.cerrado_por, r.resp?.nombre ?? "Sin nombre");
      }
    }
    setResponsables(
      [...map]
        .map(([id, nombre]) => ({ id, nombre }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    );
  }, []);

  // KPIs globales: el conteo sale de `count: 'exact'` (no del array cargado) y
  // el margen de un muestreo acotado que se rotula si llegara al tope.
  const cargarKpis = useCallback(async () => {
    const { data, error, count } = await supabase
      .from("cierres")
      .select(
        "numero, tipo, margen, fecha_hasta, cerrado_por:usuarios(nombre)",
        {
          count: "exact",
        },
      )
      .order("numero", { ascending: false })
      .limit(KPI_CAP);
    if (!mountedRef.current || error) return;
    const filas = data ?? [];
    setKpis({
      total: count ?? filas.length,
      margenPeriodo: filas
        .filter((c) => c.tipo === "periodo")
        .reduce((acc, c) => acc + Number(c.margen ?? 0), 0),
      ultimo: filas[0] ?? null,
      aprox: filas.length === KPI_CAP,
    });
  }, []);

  // Campos MEMOIZADOS: `useFiltros` deriva `valoresAplicados` de ellos y, si el
  // array se recreara en cada render, el efecto de carga entraría en bucle.
  const campos = useMemo(
    () => [
      {
        id: "q",
        tipo: "texto",
        label: "Buscar",
        // `numero` es integer: escribir "7" busca EL cierre #7 (un ilike contra
        // integer revienta en Postgres). El texto libre cae sobre la única
        // columna de texto del cierre.
        columnas: ["observaciones"],
        numericoA: "numero",
        debounce: 400,
      },
      {
        id: "rango",
        tipo: "fecha",
        label: "Periodo cerrado",
        // `fecha_hasta` es DATE: el instante de Bogotá se castea al día sin
        // corrimiento de zona. Es el periodo que CUBRE el cierre, no `created_at`
        // (cuándo se firmó) — el operario busca por lo primero.
        columna: "fecha_hasta",
        presets: ["hoy", "semana", "mes", "mesPasado"],
      },
      {
        id: "responsable",
        tipo: "opciones",
        label: "Responsable",
        columna: "cerrado_por",
        opciones: responsables.map((r) => ({ v: r.id, l: r.nombre })),
      },
    ],
    [responsables],
  );

  const f = useFiltros({ clave: "cierres-hist", campos });

  const cargarHistorial = async (reset = false) => {
    const myReq = f.nuevoReqId();
    setLoadingHist(true);
    const actual = reset ? 0 : page;
    try {
      let q = supabase
        .from("cierres")
        .select("*, cerrado_por:usuarios(nombre)", { count: "exact" });
      q = f.aplicar(q);
      // El tab de tipo es un filtro más y se CRUZA con el resto (antes filtraba
      // en memoria lo ya cargado y los complementarios no se podían aislar).
      const tipoTab = TABS_HIST.find((t) => t.id === tabHist)?.tipo;
      if (tipoTab) q = q.eq("tipo", tipoTab);
      // `numero` es único y descendente: orden total, sin filas repetidas ni
      // saltadas entre páginas.
      const { data, error, count } = await q
        .order("numero", { ascending: false })
        .range(actual * PAGE_SIZE, (actual + 1) * PAGE_SIZE - 1);
      if (!mountedRef.current || !f.esReqVigente(myReq)) return;
      if (error) throw error;
      const filas = data ?? [];
      if (reset) {
        setHistorial(filas);
        setPage(1);
      } else {
        setHistorial((prev) => [...prev, ...filas]);
        setPage((p) => p + 1);
      }
      const totalReal = count ?? 0;
      setTotalHist(totalReal);
      setHasMore((actual + 1) * PAGE_SIZE < totalReal);
    } catch (err) {
      if (!mountedRef.current || !f.esReqVigente(myReq)) return;
      setErrorMsg(safeError(err, "Error al cargar el histórico de cierres"));
    } finally {
      if (mountedRef.current && f.esReqVigente(myReq)) setLoadingHist(false);
    }
  };

  // Cualquier cambio de filtro o de tab vuelve a la página 0 (reset = true).
  useEffect(() => {
    cargarHistorial(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.valoresAplicados, tabHist]);

  useEffect(() => {
    cargarKpis();
    cargarResponsables();
  }, [cargarKpis, cargarResponsables]);

  // Invalida cualquier previsualización en vuelo y descarta la mostrada.
  const invalidarPreview = () => {
    previewSeqRef.current += 1;
    setPreview(null);
    setArqueo({});
  };

  // Mantiene hasta = desde cuando el cierre es diario.
  const onTipo = (t) => {
    setTipo(t);
    invalidarPreview();
    if (t === "diario") setHasta(desde);
  };
  const onDesde = (v) => {
    setDesde(v);
    invalidarPreview();
    if (tipo === "diario") setHasta(v);
    else if (hasta < v) setHasta(v);
  };
  const onHasta = (v) => {
    setHasta(v);
    invalidarPreview();
  };

  const previsualizar = async () => {
    setErrorMsg("");
    setPreview(null);
    if (!desde || !hasta) {
      setErrorMsg("Debes indicar fecha desde y hasta");
      return;
    }
    if (hasta < desde) {
      setErrorMsg("La fecha hasta no puede ser anterior a la fecha desde");
      return;
    }
    if (desde > hoy || hasta > hoy) {
      setErrorMsg("No se puede cerrar un periodo con fechas futuras");
      return;
    }
    // Token de secuencia: si las fechas cambian mientras el RPC está en
    // vuelo, esta respuesta se descarta y no contamina el preview mostrado.
    const myReq = (previewSeqRef.current += 1);
    setPreviewing(true);
    try {
      const { data, error } = await supabase.rpc("fn_preview_cierre", {
        p_desde: desde,
        p_hasta: hasta,
      });
      if (!mountedRef.current || myReq !== previewSeqRef.current) return;
      if (error) throw error;
      setPreview(data);
    } catch (err) {
      if (!mountedRef.current || myReq !== previewSeqRef.current) return;
      setErrorMsg(safeError(err, "Error al previsualizar el cierre"));
    } finally {
      if (mountedRef.current && myReq === previewSeqRef.current) {
        setPreviewing(false);
      }
    }
  };

  const generar = async () => {
    if (!preview || preview.ya_cubierto) return;
    // Guard síncrono: el `await confirm` abre una ventana donde el `disabled`
    // del botón aún no aplica — un doble-tap dispararía dos cierres.
    if (generandoRef.current) return;
    generandoRef.current = true;
    // #S3-01: avisar si se cierra un día que aún no ha terminado — las ventas
    // posteriores no quedarían en este cierre (habría que hacer uno complementario).
    const cerrandoHoy = hasta >= hoy;
    const ok = await confirm({
      titulo: "Generar cierre",
      mensaje:
        `Se generará un cierre ${tipo} del ${fmtFecha(desde)} al ${fmtFecha(
          hasta,
        )} por ${formatCOP(Number(preview.ingresos_total))}. Una vez guardado es inmutable y no podrá editarse ni borrarse.` +
        (cerrandoHoy
          ? "\n\nOjo: el día de hoy aún no ha terminado. Las ventas o cobros que entren después NO quedarán en este cierre. Si eso pasa, luego podrás generar un “cierre complementario” para incluirlos."
          : ""),
      confirmLabel: "Generar cierre",
    });
    if (!ok) {
      generandoRef.current = false;
      return;
    }
    setGenerating(true);
    try {
      const arqueoArr = (preview.detalle?.arqueo_esperado ?? [])
        .filter(
          (e) => arqueo[e.sede_id] !== undefined && arqueo[e.sede_id] !== "",
        )
        .map((e) => ({
          sede_id: e.sede_id,
          efectivo_contado: Number(arqueo[e.sede_id]) || 0,
        }));
      const { data, error } = await supabase.rpc("fn_generar_cierre", {
        p_desde: desde,
        p_hasta: hasta,
        p_tipo: tipo,
        p_observaciones: observaciones.trim() || null,
        p_arqueo: arqueoArr.length ? arqueoArr : null,
      });
      if (!mountedRef.current) return;
      if (error) throw error;
      avisarOk(`Cierre #${data?.numero ?? ""} generado correctamente`);
      setPreview(null);
      setArqueo({});
      setObservaciones("");
      await cargarHistorial();
    } catch (err) {
      if (mountedRef.current) {
        avisarError(err, "Error al generar el cierre");
      }
    } finally {
      generandoRef.current = false;
      if (mountedRef.current) setGenerating(false);
    }
  };

  // #S3-01: cierre COMPLEMENTARIO — registra lo que entró (o se anuló) DESPUÉS de
  // que un periodo ya fue cerrado, sin tocar el cierre inmutable. Captura el delta.
  const generarComplementario = async () => {
    if (!preview) return;
    if (generandoRef.current) return;
    generandoRef.current = true;
    const ok = await confirm({
      titulo: "Cierre complementario",
      mensaje: `Se generará un cierre complementario del ${fmtFecha(
        desde,
      )} al ${fmtFecha(
        hasta,
      )} que registra SOLO los movimientos nuevos o anulados desde el cierre ya existente. También es inmutable.`,
      confirmLabel: "Generar complementario",
    });
    if (!ok) {
      generandoRef.current = false;
      return;
    }
    setGenerating(true);
    try {
      const { data, error } = await supabase.rpc(
        "fn_generar_cierre_complementario",
        {
          p_desde: desde,
          p_hasta: hasta,
          p_sede: null,
          p_observaciones: observaciones.trim() || null,
        },
      );
      if (!mountedRef.current) return;
      if (error) throw error;
      avisarOk(
        `Cierre complementario${data?.numero ? ` #${data.numero}` : ""} generado correctamente`,
      );
      setPreview(null);
      setArqueo({});
      setObservaciones("");
      await cargarHistorial();
    } catch (err) {
      if (mountedRef.current) {
        avisarError(err, "Error al generar el cierre complementario");
      }
    } finally {
      generandoRef.current = false;
      if (mountedRef.current) setGenerating(false);
    }
  };

  // Los KPIs del cockpit (total, margen de periodo, último cierre) salen de
  // `kpis` — count:'exact' + muestreo acotado — y NO del array paginado, que
  // solo tiene la página cargada. La pestaña de tipo ya se aplica en el servidor
  // (`cargarHistorial`), así que `historial` ya viene filtrado por tab.

  // Checklist de conciliación previo al cierre — cada ítem refleja un dato
  // REAL del preview (no inventado). Sin preview, el checklist está en
  // espera honesta (estado vacío). Los ítems sin backend (firma, traspasos
  // en tránsito) se rotulan como tales en vez de fingir datos.
  const checklist = construirChecklist(preview);
  const checklistDone = checklist.filter((i) => i.done).length;
  const progreso =
    checklist.length > 0
      ? Math.round((checklistDone / checklist.length) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-6 px-5 pb-8 pt-6 sm:px-7 animate-fade-in">
      {/* Page head */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="m-0 mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Admin · Cierres
          </p>
          <h1
            className="m-0 text-[24px] font-semibold leading-tight tracking-[-0.018em]"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Cierres de caja y periodo
          </h1>
          <p
            className="mt-1 text-[13px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Verificación previa al cierre: revisa ingresos, egresos y margen por
            sede antes de sellar. Cada cierre es inmutable.
          </p>
        </div>
      </div>

      <FeedbackBanners errorMsg={errorMsg} />

      {/* KPI strip */}
      <div
        className="grid grid-cols-2 gap-y-4 border-b pb-5 pt-1 md:grid-cols-4 md:gap-y-0"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <Kpi
          label="Periodo seleccionado"
          value={tipo === "diario" ? fmtFecha(desde) : `${fmtFecha(desde)} →`}
          sub={tipo === "diario" ? "Cierre diario" : `hasta ${fmtFecha(hasta)}`}
          icon={Calendar}
        />
        <Kpi
          label="Cierres registrados"
          value={loadingHist ? "…" : kpis.total}
          sub="Histórico inmutable"
          icon={Receipt}
        />
        <Kpi
          label="Margen acumulado periodo"
          value={
            loadingHist
              ? "…"
              : `${kpis.aprox ? "≈ " : ""}${formatCOP(kpis.margenPeriodo)}`
          }
          token={kpis.margenPeriodo < 0 ? "--destructive" : "--success"}
          sub="Cierres tipo periodo"
          icon={DollarSign}
        />
        <Kpi
          last
          label="Último cierre"
          value={kpis.ultimo ? `#${kpis.ultimo.numero}` : "—"}
          sub={
            kpis.ultimo
              ? `${fmtFecha(kpis.ultimo.fecha_hasta)} · ${kpis.ultimo.cerrado_por?.nombre ?? "—"}`
              : "Sin cierres aún"
          }
          icon={ShieldCheck}
        />
      </div>

      {/* ── Generador + checklist (master-detail Lovable) ────────────── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <SectionCard
            title={
              readOnly ? "Consultar cierre (solo lectura)" : "Generar cierre"
            }
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="Tipo de cierre">
                <select
                  value={tipo}
                  onChange={(e) => onTipo(e.target.value)}
                  className="w-full px-3 rounded-lg border text-sm min-h-[48px]"
                  style={inputStyle}
                >
                  <option value="diario">Diario</option>
                  <option value="periodo">Periodo</option>
                </select>
              </Field>
              <Field label="Desde">
                <input
                  type="date"
                  value={desde}
                  onChange={(e) => onDesde(e.target.value)}
                  className="w-full px-3 rounded-lg border text-sm min-h-[48px]"
                  style={inputStyle}
                />
              </Field>
              <Field label="Hasta">
                <input
                  type="date"
                  value={hasta}
                  min={desde}
                  disabled={tipo === "diario"}
                  onChange={(e) => onHasta(e.target.value)}
                  className="w-full px-3 rounded-lg border text-sm min-h-[48px] disabled:opacity-50"
                  style={inputStyle}
                />
              </Field>
              <Field label="Observaciones (opcional)">
                <input
                  type="text"
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Nota del cierre"
                  className="w-full px-3 rounded-lg border text-sm min-h-[48px]"
                  style={inputStyle}
                />
              </Field>
            </div>
            <div className="flex justify-end pt-3">
              <button
                onClick={previsualizar}
                disabled={previewing}
                className="h-12 px-5 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
                style={{
                  backgroundColor: "hsl(var(--primary))",
                  color: "hsl(var(--primary-foreground))",
                }}
              >
                {previewing ? "Calculando…" : "Previsualizar"}
              </button>
            </div>
          </SectionCard>

          {/* ── Vista previa ──────────────────────────────────────────── */}
          {preview && (
            <SectionCard
              title={`Vista previa — ${fmtFecha(preview.fecha_desde)} a ${fmtFecha(
                preview.fecha_hasta,
              )}`}
            >
              {preview.ya_cubierto && (
                <div
                  role="alert"
                  className="rounded-lg border px-3 py-2 text-xs mb-3"
                  style={{
                    backgroundColor: "hsl(var(--warning) / 0.1)",
                    borderColor: "hsl(var(--warning) / 0.4)",
                    color: "hsl(var(--warning))",
                  }}
                >
                  Este rango ya tiene el/los cierre(s){" "}
                  {(preview.solapamiento ?? []).map((n) => `#${n}`).join(", ")}.
                  No se puede generar un cierre normal, pero si entraron ventas
                  o cobros (o hubo anulaciones) después de cerrarlo, genera un{" "}
                  <b>cierre complementario</b> para registrar esa diferencia.
                </div>
              )}

              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <Stat
                  label="Ingresos productos"
                  value={formatCOP(Number(preview.ingresos_productos))}
                  sub={`${preview.count_ventas} venta(s)`}
                />
                <Stat
                  label="Ingresos servicios"
                  value={formatCOP(Number(preview.ingresos_servicios))}
                  sub={`${preview.count_abonos} abono(s)`}
                />
                <Stat
                  label="Ingresos total"
                  value={formatCOP(Number(preview.ingresos_total))}
                  tone="primary"
                />
                <Stat
                  label="Egresos"
                  value={formatCOP(Number(preview.egresos))}
                  sub={`${preview.count_compras} compra(s)`}
                />
                <Stat
                  label="Margen"
                  value={formatCOP(Number(preview.margen))}
                  tone={Number(preview.margen) < 0 ? "danger" : "success"}
                />
              </div>

              {preview.detalle && (
                <div className="mt-4">
                  <DetalleCierreAvanzado detalle={preview.detalle} />
                </div>
              )}

              {preview.detalle?.arqueo_esperado?.length > 0 && (
                <div className="mt-4">
                  <ArqueoCaptura
                    esperado={preview.detalle.arqueo_esperado}
                    arqueo={arqueo}
                    setArqueo={setArqueo}
                  />
                </div>
              )}

              {!readOnly && (
                <div className="flex justify-end pt-4">
                  {preview.ya_cubierto ? (
                    // #S3-01: rango ya cerrado → ofrecer el complementario.
                    <button
                      onClick={generarComplementario}
                      disabled={generating}
                      className="h-12 px-5 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
                      style={{
                        backgroundColor: "hsl(var(--warning))",
                        color: "hsl(var(--primary-foreground))",
                      }}
                    >
                      {generating
                        ? "Generando…"
                        : "Generar cierre complementario"}
                    </button>
                  ) : (
                    <button
                      onClick={generar}
                      disabled={generating}
                      className="h-12 px-5 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
                      style={{
                        backgroundColor: "hsl(var(--primary))",
                        color: "hsl(var(--primary-foreground))",
                      }}
                    >
                      {generating ? "Generando…" : "Generar cierre"}
                    </button>
                  )}
                </div>
              )}
            </SectionCard>
          )}
        </div>

        {/* ── Checklist de conciliación (derivado del preview real) ───── */}
        <ChecklistCierre
          preview={preview}
          checklist={checklist}
          done={checklistDone}
          progreso={progreso}
        />
      </div>

      {/* ── Histórico ─────────────────────────────────────────────── */}
      <SectionCard
        title={`Histórico de cierres${loadingHist ? "" : ` (${kpis.total})`}`}
      >
        {/* Tabs de filtro del histórico (Lovable) */}
        {!loadingHist && historial.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {TABS_HIST.map((t) => {
              const on = t === tabHist;
              return (
                <button
                  key={t}
                  onClick={() => setTabHist(t)}
                  className="rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer"
                  style={{
                    backgroundColor: on ? "hsl(var(--primary))" : "transparent",
                    color: on
                      ? "hsl(var(--primary-foreground))"
                      : "hsl(var(--muted-foreground))",
                  }}
                >
                  {t}
                </button>
              );
            })}
            <span
              className="ml-auto font-mono text-[11px]"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {historial.length} cierre(s)
            </span>
          </div>
        )}
        {loadingHist ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="rounded-lg animate-pulse h-12"
                style={{ backgroundColor: "hsl(var(--muted) / 0.4)" }}
              />
            ))}
          </div>
        ) : historial.length === 0 ? (
          <p
            className="text-center text-xs italic py-6"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Aún no se ha generado ningún cierre
          </p>
        ) : (
          <>
            {/* Desktop */}
            <div
              className="hidden md:block overflow-x-auto rounded-lg border"
              style={{ borderColor: "hsl(var(--border))" }}
            >
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr
                    style={{
                      backgroundColor: "hsl(var(--muted) / 0.3)",
                      color: "hsl(var(--muted-foreground))",
                    }}
                  >
                    <Th>#</Th>
                    <Th>Tipo</Th>
                    <Th>Periodo</Th>
                    <Th right>Productos</Th>
                    <Th right>Servicios</Th>
                    <Th right>Egresos</Th>
                    <Th right>Margen</Th>
                    <Th>Cerrado por</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {historial.map((c) => (
                    <CierreRow
                      key={c.id}
                      c={c}
                      expanded={expandedId === c.id}
                      onToggle={() =>
                        setExpandedId(expandedId === c.id ? null : c.id)
                      }
                    />
                  ))}
                </tbody>
              </table>
              {historial.length === 0 && (
                <p
                  className="py-6 text-center text-xs italic"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Sin cierres de tipo {tabHist.toLowerCase()}
                </p>
              )}
            </div>

            {/* Mobile */}
            <ul className="md:hidden space-y-2.5" role="list">
              {historial.map((c) => (
                <li key={c.id}>
                  <CierreCard
                    c={c}
                    expanded={expandedId === c.id}
                    onToggle={() =>
                      setExpandedId(expandedId === c.id ? null : c.id)
                    }
                  />
                </li>
              ))}
              {historial.length === 0 && (
                <li
                  className="py-6 text-center text-xs italic"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Sin cierres de tipo {tabHist.toLowerCase()}
                </li>
              )}
            </ul>

            {/* Paginación real: sin esto solo se veía la primera página y el
                histórico "terminaba" antes de tiempo. */}
            {hasMore && (
              <button
                onClick={() => cargarHistorial(false)}
                disabled={loadingHist}
                className="btn btn-out mt-4 w-full justify-center disabled:opacity-50"
                style={{ height: 48 }}
              >
                {loadingHist
                  ? "Cargando…"
                  : `Cargar más (${historial.length} de ${totalHist})`}
              </button>
            )}
          </>
        )}
      </SectionCard>

      <ConfirmDialog />
    </div>
  );
}

/* ── Componentes ──────────────────────────────────────────────────── */

const inputStyle = {
  backgroundColor: "hsl(var(--background))",
  borderColor: "hsl(var(--border))",
  color: "hsl(var(--foreground))",
};

/**
 * Checklist de conciliación previo al cierre. Cada ítem se deriva de un dato
 * REAL del preview server-authoritative (`fn_preview_cierre`). Sin preview
 * devuelve []. Los ítems sin respaldo en backend (firma del responsable) se
 * marcan `manual: true` para rotularlos honestamente, no para fingir datos.
 * @param {object|null} preview
 * @returns {Array<{ id: string, label: string, done: boolean, meta?: string, manual?: boolean }>}
 */
function construirChecklist(preview) {
  if (!preview) return [];
  const ventas = Number(preview.count_ventas ?? 0);
  const abonos = Number(preview.count_abonos ?? 0);
  const compras = Number(preview.count_compras ?? 0);
  const ingresos = Number(preview.ingresos_total ?? 0);
  const margen = Number(preview.margen ?? 0);
  const rangoLibre = !preview.ya_cubierto;
  return [
    {
      id: "ventas",
      label: "Ventas del periodo conciliadas",
      done: ventas > 0,
      meta:
        ventas > 0
          ? `${ventas} venta(s) · ${formatCOP(Number(preview.ingresos_productos ?? 0))}`
          : "Sin ventas en el rango",
    },
    {
      id: "servicios",
      label: "Abonos de servicios incluidos",
      done: abonos > 0,
      meta:
        abonos > 0
          ? `${abonos} abono(s) · ${formatCOP(Number(preview.ingresos_servicios ?? 0))}`
          : "Sin abonos en el rango",
    },
    {
      id: "egresos",
      label: "Compras / egresos registrados",
      done: compras > 0,
      meta:
        compras > 0
          ? `${compras} compra(s) · ${formatCOP(Number(preview.egresos ?? 0))}`
          : "Sin compras en el rango",
    },
    {
      id: "margen",
      label: "Margen calculado",
      done: ingresos > 0,
      meta: `${formatCOP(margen)} (${margen < 0 ? "negativo" : "positivo"})`,
    },
    {
      id: "rango",
      label: "Rango sin solapamiento con cierres previos",
      done: rangoLibre,
      meta: rangoLibre
        ? "Periodo disponible"
        : `Solapa ${(preview.solapamiento ?? []).map((n) => `#${n}`).join(", ")}`,
    },
    {
      id: "firma",
      label: "Firma del responsable",
      done: false,
      manual: true,
      meta: "Se registra al generar el cierre",
    },
  ];
}

/* ── Checklist de cierre (sidebar, layout Lovable) ─────────────────────── */
function ChecklistCierre({ preview, checklist, done, progreso }) {
  return (
    <aside
      className="self-start rounded-xl border overflow-hidden"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <div
        className="border-b p-4"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <p
              className="text-[11px] uppercase tracking-wide"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Verificación previa
            </p>
            <p
              className="mt-0.5 text-[15px] font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {preview ? `Progreso ${progreso}%` : "En espera"}
            </p>
          </div>
          {preview && (
            <span
              className="font-mono text-[13px] tabular-nums"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {done}/{checklist.length}
            </span>
          )}
        </div>
        {preview && (
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full"
            style={{ backgroundColor: "hsl(var(--muted) / 0.6)" }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progreso}%`,
                backgroundColor: "hsl(var(--primary))",
              }}
            />
          </div>
        )}
      </div>

      {!preview ? (
        <div
          className="flex flex-col items-center gap-2 px-4 py-10 text-center"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          <FileText className="h-7 w-7" strokeWidth={1.25} />
          <p className="text-[12.5px]">
            Previsualiza un periodo para revisar sus partidas antes de cerrar.
            Esta lista no es un botón: se completa sola con los datos del
            periodo y el cierre se firma al pulsar “Generar cierre”.
          </p>
        </div>
      ) : (
        <ul className="divide-y" style={{ borderColor: "hsl(var(--border))" }}>
          {checklist.map((i) => (
            <li key={i.id} className="flex items-start gap-3 px-4 py-3">
              <span className="mt-0.5 shrink-0">
                {i.done ? (
                  <CheckCircle2
                    className="h-4 w-4"
                    strokeWidth={2}
                    style={{ color: "hsl(var(--success))" }}
                  />
                ) : (
                  <Circle
                    className="h-4 w-4"
                    strokeWidth={1.75}
                    style={{
                      color: i.manual
                        ? "hsl(var(--muted-foreground))"
                        : "hsl(var(--warning))",
                    }}
                  />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className="text-[13px]"
                  style={{
                    color: i.done
                      ? "hsl(var(--muted-foreground))"
                      : "hsl(var(--foreground))",
                    textDecoration: i.done ? "line-through" : "none",
                  }}
                >
                  {i.label}
                </p>
                {i.meta && (
                  <p
                    className="mt-0.5 text-[11px]"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {i.meta}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <div
          className="flex items-start gap-2 border-t px-4 py-3"
          style={{
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--muted) / 0.3)",
          }}
        >
          <Lock
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            strokeWidth={1.5}
            style={{ color: "hsl(var(--muted-foreground))" }}
          />
          <p
            className="text-[11px] leading-snug"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Al generar, el cierre queda firmado por el responsable, sellado con
            fecha y bloqueado contra ediciones.
          </p>
        </div>
      )}
    </aside>
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
        className="font-mono text-[17px] sm:text-[20px] font-semibold leading-tight tracking-[-0.02em] tabular-nums break-words"
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

function SectionCard({ title, children }) {
  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <div
        className="px-4 py-3 border-b"
        style={{
          borderColor: "hsl(var(--border))",
          backgroundColor: "hsl(var(--muted) / 0.3)",
        }}
      >
        <p
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {title}
        </p>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span
        className="block text-xs font-medium mb-1"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Stat({ label, value, sub, tone }) {
  const color =
    tone === "danger"
      ? "hsl(var(--destructive))"
      : tone === "success"
        ? "hsl(var(--success))"
        : tone === "primary"
          ? "hsl(var(--primary))"
          : "hsl(var(--foreground))";
  return (
    <div
      className="rounded-lg border p-3"
      style={{
        backgroundColor: "hsl(var(--muted) / 0.3)",
        borderColor: "hsl(var(--border))",
      }}
    >
      <p
        className="text-xs font-medium uppercase tracking-wide"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </p>
      <p
        className="mt-0.5 text-sm sm:text-[15px] font-bold tabular-nums leading-tight break-words"
        style={{ color }}
      >
        {value}
      </p>
      {sub && (
        <p
          className="text-[10px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

function Th({ children, right }) {
  return (
    <th
      className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
        right ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

/* Pill de tipo de cierre con icono (Diario / Periodo) — estilo Lovable. */
function TipoCierrePill({ tipo }) {
  const esDiario = tipo === "diario";
  const Icon = esDiario ? Calendar : FileText;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium capitalize"
      style={{
        backgroundColor: "hsl(var(--muted) / 0.5)",
        color: "hsl(var(--muted-foreground))",
      }}
    >
      <Icon className="h-3 w-3" strokeWidth={1.5} />
      {tipo}
    </span>
  );
}

function CierreRow({ c, expanded, onToggle }) {
  const margenColor =
    Number(c.margen) < 0 ? "hsl(var(--destructive))" : "hsl(var(--success))";
  return (
    <>
      <tr
        className="border-t cursor-pointer"
        style={{ borderColor: "hsl(var(--border))" }}
        onClick={onToggle}
        aria-expanded={expanded}
        onMouseEnter={(e) =>
          (e.currentTarget.style.backgroundColor = "hsl(var(--muted) / 0.4)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
      >
        <td
          className="px-3 py-2 font-semibold tabular-nums"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {c.numero}
        </td>
        <td className="px-3 py-2">
          <TipoCierrePill tipo={c.tipo} />
        </td>
        <td className="px-3 py-2" style={{ color: "hsl(var(--foreground))" }}>
          {fmtFecha(c.fecha_desde)} – {fmtFecha(c.fecha_hasta)}
        </td>
        <td
          className="px-3 py-2 text-right tabular-nums"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {formatCOP(Number(c.ingresos_productos))}
        </td>
        <td
          className="px-3 py-2 text-right tabular-nums"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {formatCOP(Number(c.ingresos_servicios))}
        </td>
        <td
          className="px-3 py-2 text-right tabular-nums"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {formatCOP(Number(c.egresos))}
        </td>
        <td
          className="px-3 py-2 text-right tabular-nums font-semibold"
          style={{ color: margenColor }}
        >
          {formatCOP(Number(c.margen))}
        </td>
        <td
          className="px-3 py-2"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {c.cerrado_por?.nombre ?? "—"}
        </td>
        <td
          className="px-3 py-2 text-right"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {expanded ? "▲" : "▼"}
        </td>
      </tr>
      {expanded && (
        <tr style={{ backgroundColor: "hsl(var(--muted) / 0.2)" }}>
          <td colSpan={9} className="px-4 py-3">
            <CierreMeta c={c} />
            <DetalleCierreAvanzado detalle={c.detalle} />
          </td>
        </tr>
      )}
    </>
  );
}

function CierreCard({ c, expanded, onToggle }) {
  const margenColor =
    Number(c.margen) < 0 ? "hsl(var(--destructive))" : "hsl(var(--success))";
  return (
    <div
      className="rounded-xl border"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full text-left px-4 py-4 cursor-pointer"
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className="text-sm font-semibold"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Cierre #{c.numero}
            <span
              className="ml-2 text-xs font-normal capitalize"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {c.tipo}
            </span>
          </span>
          <span style={{ color: "hsl(var(--muted-foreground))" }}>
            {expanded ? "▲" : "▼"}
          </span>
        </div>
        <p
          className="text-xs mt-0.5"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {fmtFecha(c.fecha_desde)} – {fmtFecha(c.fecha_hasta)}
        </p>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <MiniStat label="Total" value={formatCOP(Number(c.ingresos_total))} />
          <MiniStat
            label="Margen"
            value={formatCOP(Number(c.margen))}
            color={margenColor}
          />
        </div>
      </button>
      {expanded && (
        <div
          className="px-4 pb-4 border-t pt-3"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <CierreMeta c={c} />
          <DetalleCierreAvanzado detalle={c.detalle} />
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, color }) {
  return (
    <div>
      <p
        className="text-[10px] uppercase tracking-wide"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </p>
      <p
        className="text-sm font-bold tabular-nums"
        style={{ color: color ?? "hsl(var(--foreground))" }}
      >
        {value}
      </p>
    </div>
  );
}

function CierreMeta({ c }) {
  return (
    <p
      className="text-xs mb-2"
      style={{ color: "hsl(var(--muted-foreground))" }}
    >
      Generado {formatDate(c.created_at)}
      {c.cerrado_por?.nombre ? ` por ${c.cerrado_por.nombre}` : ""}
      {c.observaciones ? ` · ${c.observaciones}` : ""}
    </p>
  );
}

/**
 * Captura del arqueo de caja por sede en la vista previa. El "esperado" es
 * server-authoritative (solo lectura); el usuario digita el "contado" y se ve
 * la diferencia en vivo. Es opcional: lo que no se llene no se envía.
 */
function ArqueoCaptura({ esperado, arqueo, setArqueo }) {
  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: "hsl(var(--border))" }}
    >
      <p
        className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide border-b"
        style={{
          color: "hsl(var(--muted-foreground))",
          borderColor: "hsl(var(--border))",
          backgroundColor: "hsl(var(--muted) / 0.3)",
        }}
      >
        Arqueo de caja · efectivo esperado vs. contado (opcional)
      </p>
      <div className="divide-y" style={{ borderColor: "hsl(var(--border))" }}>
        {esperado.map((e) => {
          const esp = Number(e.efectivo_esperado);
          const raw = arqueo[e.sede_id];
          const tiene = raw !== undefined && raw !== "";
          const dif = tiene ? Number(raw || 0) - esp : null;
          return (
            <div
              key={e.sede_id}
              className="grid grid-cols-2 sm:grid-cols-4 items-center gap-2 px-3 py-2.5"
            >
              <span
                className="truncate text-[13px] font-medium"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {e.sede_nombre}
              </span>
              <span
                className="text-right text-[12px] tabular-nums sm:text-left"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Esperado: {formatCOP(esp)}
              </span>
              <input
                type="number"
                inputMode="numeric"
                value={raw ?? ""}
                onChange={(ev) =>
                  setArqueo((prev) => ({
                    ...prev,
                    [e.sede_id]: ev.target.value,
                  }))
                }
                placeholder="Efectivo contado"
                className="w-full px-3 rounded-lg border text-sm min-h-[48px]"
                style={inputStyle}
              />
              <span
                title={
                  dif === null
                    ? "Pendiente de contar"
                    : dif === 0
                      ? "Cuadra"
                      : dif > 0
                        ? "Sobrante"
                        : "Faltante"
                }
                className="text-right text-[12px] font-semibold tabular-nums"
                style={{
                  color:
                    dif === null
                      ? "hsl(var(--muted-foreground))"
                      : dif === 0
                        ? "hsl(var(--success))"
                        : "hsl(var(--destructive))",
                }}
              >
                {dif === null ? "—" : `${dif > 0 ? "+" : ""}${formatCOP(dif)}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const DETALLE_TABS = [
  { id: "sede", label: "Por sede" },
  { id: "cuentas", label: "Cuentas" },
  { id: "egresos", label: "Egresos" },
  { id: "productos", label: "Productos" },
  { id: "arqueo", label: "Arqueo" },
];

/**
 * Vista avanzada del detalle de un cierre (preview o histórico). Renderiza el
 * jsonb `detalle` con tabs. Cada tab se muestra solo si tiene datos, de modo
 * que los cierres viejos (sin los campos nuevos) caen al tab "Por sede" legacy.
 */
function DetalleCierreAvanzado({ detalle }) {
  const porSede = detalle?.por_sede ?? [];
  const porSedeMetodo = detalle?.por_sede_metodo ?? [];
  const porCuenta = detalle?.por_cuenta ?? [];
  const egresosDet = detalle?.egresos_detalle ?? [];
  const porProducto = detalle?.por_producto ?? [];
  const arqueo = detalle?.arqueo ?? [];

  const disponibles = DETALLE_TABS.filter((t) => {
    if (t.id === "sede") return porSede.length > 0 || porSedeMetodo.length > 0;
    if (t.id === "cuentas") return porCuenta.length > 0;
    if (t.id === "egresos") return egresosDet.length > 0;
    if (t.id === "productos") return porProducto.length > 0;
    if (t.id === "arqueo") return arqueo.length > 0;
    return false;
  });

  const [tab, setTab] = useState(disponibles[0]?.id ?? "sede");
  if (disponibles.length === 0) return null;
  const activo = disponibles.some((t) => t.id === tab)
    ? tab
    : disponibles[0].id;

  return (
    <div className="flex flex-col gap-3">
      <div
        className="inline-flex flex-wrap items-center gap-0.5 self-start rounded-lg p-[3px]"
        style={{ backgroundColor: "hsl(var(--muted) / 0.6)" }}
      >
        {disponibles.map((t) => {
          const on = t.id === activo;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-pressed={on}
              className="rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer"
              style={{
                backgroundColor: on ? "hsl(var(--card))" : "transparent",
                color: on
                  ? "hsl(var(--foreground))"
                  : "hsl(var(--muted-foreground))",
                boxShadow: on ? "0 1px 2px rgba(14,16,24,.08)" : "none",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {activo === "sede" && (
        <MatrizSedeMetodo porSedeMetodo={porSedeMetodo} porSede={porSede} />
      )}
      {activo === "cuentas" && (
        <MiniTable
          titulo="Por cuenta bancaria"
          cols={["Sede", "Cuenta", "Ingresos", "Egresos"]}
          align={["left", "left", "right", "right"]}
          rows={porCuenta.map((r) => [
            r.sede_nombre,
            cuentaLabel(r.cuenta),
            formatCOP(Number(r.ingresos)),
            formatCOP(Number(r.egresos)),
          ])}
        />
      )}
      {activo === "egresos" && (
        <MiniTable
          titulo="Egresos — en qué se fue el dinero"
          cols={["Sede", "Detalle", "Método", "Cuenta", "Total"]}
          align={["left", "left", "left", "left", "right"]}
          rows={egresosDet.map((e) => [
            e.sede_nombre,
            e.es_caja_menor
              ? `Caja menor: ${e.concepto || "—"}`
              : e.proveedor +
                (e.factura ? ` · ${e.factura}` : "") +
                (e.concepto ? ` · ${e.concepto}` : ""),
            metodoLabel(e.metodo),
            cuentaLabel(e.cuenta),
            formatCOP(Number(e.total)),
          ])}
        />
      )}
      {activo === "productos" && (
        <MiniTable
          titulo="Productos vendidos por sede"
          cols={["Sede", "Referencia", "Producto", "Unidades", "Ingreso"]}
          align={["left", "left", "left", "right", "right"]}
          rows={porProducto.map((p) => [
            p.sede_nombre,
            p.referencia,
            p.nombre,
            String(p.unidades),
            formatCOP(Number(p.ingreso)),
          ])}
        />
      )}
      {activo === "arqueo" && (
        <MiniTable
          titulo="Arqueo de caja"
          cols={["Sede", "Esperado", "Contado", "Diferencia"]}
          rows={arqueo.map((a) => [
            a.sede_nombre,
            formatCOP(Number(a.efectivo_esperado)),
            formatCOP(Number(a.efectivo_contado)),
            `${Number(a.diferencia) > 0 ? "+" : ""}${formatCOP(Number(a.diferencia))}`,
          ])}
        />
      )}
    </div>
  );
}

/**
 * Matriz sede × método: filas=sede, columnas=métodos presentes (ingresos) +
 * Egresos. Si no hay desglose por método (cierre viejo) cae a la tabla legacy
 * productos/servicios/egresos.
 */
function MatrizSedeMetodo({ porSedeMetodo, porSede }) {
  if (porSedeMetodo.length === 0) {
    if (porSede.length === 0) return null;
    return (
      <MiniTable
        titulo="Por sede"
        cols={["Sede", "Productos", "Servicios", "Egresos"]}
        rows={porSede.map((s) => [
          s.sede_nombre,
          formatCOP(Number(s.productos)),
          formatCOP(Number(s.servicios)),
          formatCOP(Number(s.egresos)),
        ])}
      />
    );
  }
  const metodos = [...new Set(porSedeMetodo.map((r) => r.metodo))].sort();
  const sedesMap = new Map();
  for (const r of porSedeMetodo) {
    if (!sedesMap.has(r.sede_id)) {
      sedesMap.set(r.sede_id, {
        nombre: r.sede_nombre,
        ing: {},
        egr: 0,
      });
    }
    const e = sedesMap.get(r.sede_id);
    e.ing[r.metodo] = (e.ing[r.metodo] ?? 0) + Number(r.ingresos);
    e.egr += Number(r.egresos);
  }
  const cols = ["Sede", ...metodos.map((m) => metodoLabel(m)), "Egresos"];
  const rows = [...sedesMap.values()].map((s) => [
    s.nombre,
    ...metodos.map((m) => formatCOP(Number(s.ing[m] ?? 0))),
    formatCOP(s.egr),
  ]);
  return (
    <MiniTable titulo="Por sede × método de pago" cols={cols} rows={rows} />
  );
}

function MiniTable({ titulo, cols, rows, align }) {
  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: "hsl(var(--border))" }}
    >
      <p
        className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide border-b"
        style={{
          color: "hsl(var(--muted-foreground))",
          borderColor: "hsl(var(--border))",
          backgroundColor: "hsl(var(--muted) / 0.3)",
        }}
      >
        {titulo}
      </p>
      <div className="overflow-auto" style={{ maxHeight: 420 }}>
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr
              style={{
                color: "hsl(var(--muted-foreground))",
                backgroundColor: "hsl(var(--card))",
                boxShadow: "inset 0 -1px 0 hsl(var(--border))",
              }}
            >
              {cols.map((col, i) => (
                <th
                  key={col}
                  className={`px-3 py-1.5 font-medium whitespace-nowrap ${
                    alineacion(align, i, cols.length) === "left"
                      ? "text-left"
                      : "text-right"
                  } ${i === 0 ? "sticky left-0 z-20" : ""}`}
                  style={
                    i === 0
                      ? { backgroundColor: "hsl(var(--card))" }
                      : undefined
                  }
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={cols.length}
                  className="px-3 py-3 text-center italic"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Sin movimientos
                </td>
              </tr>
            ) : (
              rows.map((row, ri) => (
                <tr
                  key={ri}
                  className="border-t"
                  style={{ borderColor: "hsl(var(--border))" }}
                >
                  {row.map((cell, ci) => {
                    const left = alineacion(align, ci, cols.length) === "left";
                    return (
                      <td
                        key={ci}
                        className={`px-3 py-1.5 tabular-nums ${
                          left ? "text-left" : "text-right"
                        } ${ci === 0 ? "sticky left-0 z-10" : ""}`}
                        style={{
                          color: left
                            ? "hsl(var(--foreground))"
                            : "hsl(var(--muted-foreground))",
                          ...(ci === 0
                            ? { backgroundColor: "hsl(var(--card))" }
                            : null),
                        }}
                      >
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Alineación de columna: usa `align` (array 'left'|'right') si se pasa; por
// defecto la primera columna a la izquierda y el resto a la derecha (números).
function alineacion(align, i) {
  if (Array.isArray(align) && align[i]) return align[i];
  return i === 0 ? "left" : "right";
}
