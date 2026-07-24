import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Printer,
  X,
  Search,
  Trash2,
  Plus,
  Minus,
  User,
  Phone,
  Hash,
  Wrench,
  Package,
  ShieldCheck,
  Wallet,
  Activity,
  ChevronDown,
  ChevronRight,
  Check,
  AlertTriangle,
  Lock,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import {
  formatCOP,
  formatDate,
  safeError,
  sanitizeSearch,
} from "../../lib/utils";
import { avisarOk, avisarError } from "../../lib/notify";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import { construirHistorialOT } from "../../lib/ordenes-ui";
import { cuentaBancariaLabel } from "../../lib/cuentas-ui";
import ClientePicker from "../../components/forms/ClientePicker";
import UbicacionChip from "../../components/ui/UbicacionChip";
import ChecklistRecepcion from "../../components/ot/ChecklistRecepcion";
import OrdenStepper from "../../components/ot/OrdenStepper";
import { generarOrdenPDF } from "../../lib/pdf/ordenPDF";
import { generarVentaPOS } from "../../lib/pdf/ventaPOS";
import {
  PASOS,
  pasoActual,
  SIGUIENTE_ESTADO,
  otCerrada,
  calcularMontos,
  gateCumplido,
  mensajeGate,
  estadoEstilo,
  SEDE_LABEL,
  METODO_PAGO,
  puedeManipular,
  puedeAnular,
  TX,
} from "../../lib/ot-flujo";

/* ───────────────────────────── Helpers de estilo ──────────────────────────── */

const card = {
  backgroundColor: "hsl(var(--card))",
  borderColor: "hsl(var(--border))",
};
const sectionHeaderBg = { backgroundColor: "hsl(var(--muted) / 0.3)" };

// Input base con tokens del sistema de diseño.
const inputStyle = {
  backgroundColor: "hsl(var(--background))",
  borderColor: "hsl(var(--border))",
  color: "hsl(var(--foreground))",
};

function PrimaryButton({
  children,
  disabled,
  onClick,
  type = "button",
  style,
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        minHeight: 48,
        backgroundColor: "hsl(var(--primary))",
        color: "hsl(var(--primary-foreground))",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function OutlineButton({ children, disabled, onClick, tone, style }) {
  const color = tone ? `hsl(var(--${tone}))` : "hsl(var(--foreground))";
  const border = tone ? `hsl(var(--${tone}) / 0.4)` : "hsl(var(--border))";
  const bg = tone ? `hsl(var(--${tone}) / 0.08)` : "hsl(var(--card))";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        minHeight: 48,
        color,
        borderColor: border,
        backgroundColor: bg,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, children, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1.5">
      <span
        className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

/** ¿El método de pago mueve dinero por banco (y por tanto tiene cuenta)? */
const esPagoElectronico = (m) => m === "transferencia" || m === "tarjeta";

/**
 * Selector de cuenta bancaria del abono. Solo aparece en pagos electrónicos:
 * sin la cuenta, el Cierre agrupa el abono bajo "sin cuenta" y el desglose por
 * cuenta queda incompleto. Compartido por el anticipo (Autorización) y el pago
 * final (Entrega), que antes duplicaban el formulario.
 */
function CuentaAbonoField({ metodo, cuenta, setCuenta, disabled }) {
  const [cuentas, setCuentas] = useState([]);

  useEffect(() => {
    if (!esPagoElectronico(metodo)) return;
    supabase
      .from("cuentas_bancarias")
      .select("id, banco, tipo, numero, titular")
      .eq("activo", true)
      .order("banco")
      .then(({ data }) => setCuentas(data ?? []));
  }, [metodo]);

  if (!esPagoElectronico(metodo)) return null;

  return (
    <Field label="Cuenta bancaria *">
      <select
        value={cuenta}
        onChange={(e) => setCuenta(e.target.value)}
        disabled={disabled}
        className="h-12 rounded-lg border px-3 text-sm outline-none disabled:opacity-60"
        style={inputStyle}
      >
        <option value="">Selecciona la cuenta…</option>
        {cuentas.map((c) => (
          <option key={c.id} value={cuentaBancariaLabel(c)}>
            {cuentaBancariaLabel(c)}
          </option>
        ))}
      </select>
    </Field>
  );
}

/* ─────────────────────────────── Componente ───────────────────────────────── */

export default function OrdenDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [orden, setOrden] = useState(null);
  const [detalles, setDetalles] = useState([]);
  const [abonos, setAbonos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  // Paso abierto en el acordeón (por defecto el activo).
  const [pasoAbierto, setPasoAbierto] = useState(null);
  const [checklistTocado, setChecklistTocado] = useState(false);
  // #S2-13: si el checklist ya fue diligenciado en una sesión anterior, el paso
  // de Recepción debe contar como cumplido al reabrir la OT (antes dependía solo
  // de un flag de sesión y la orden quedaba trabada para otro usuario/pestaña).
  const [checklistYaMarcado, setChecklistYaMarcado] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    supabase
      .from("ot_checklist")
      .select("id", { count: "exact", head: true })
      .eq("orden_id", id)
      .eq("marcado", true)
      .then(({ count }) => {
        if (alive) setChecklistYaMarcado((count ?? 0) > 0);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  /* ── Carga ──────────────────────────────────────────────────────────── */
  const cargar = useCallback(async () => {
    setErrorMsg("");
    try {
      const { data: o, error: e1 } = await supabase
        .from("ordenes_servicio")
        .select("*, tecnico:tecnico_id(nombre, rol)")
        .eq("id", id)
        .maybeSingle();
      if (e1) throw e1;
      if (!o) {
        setOrden(null);
        setErrorMsg("Orden no encontrada");
        return;
      }
      setOrden(o);

      const { data: d, error: e2 } = await supabase
        .from("detalle_orden")
        .select(
          "id, cantidad, costo_unitario, precio_unitario, subtotal, producto:producto_id(id, referencia, nombre)",
        )
        .eq("orden_id", id)
        .order("created_at", { ascending: true });
      if (e2) throw e2;
      setDetalles(d ?? []);

      const { data: ab, error: e3 } = await supabase
        .from("abonos")
        .select("id, monto, metodo_pago, fecha")
        .eq("orden_id", id)
        .order("fecha", { ascending: true });
      if (e3) throw e3;
      setAbonos(ab ?? []);
    } catch (err) {
      console.error("[OrdenDetalle] cargar:", err);
      setErrorMsg(safeError(err, "Error al cargar la orden"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    cargar();
  }, [cargar]);

  // Abrir por defecto el paso activo al cargar.
  const activo = pasoActual(orden);
  useEffect(() => {
    if (orden && pasoAbierto == null) setPasoAbierto(activo);
  }, [orden, activo, pasoAbierto]);

  /* ── Derivados ──────────────────────────────────────────────────────── */
  const ro = !puedeManipular(perfil, orden);
  const cerrada = otCerrada(orden);

  // En cotización el total se calcula con el draft (líneas no descargadas);
  // ya descargado se usa detalle_orden. calcularMontos acepta ambos formatos.
  const draft = useMemo(
    () =>
      Array.isArray(orden?.cotizacion_draft) ? orden.cotizacion_draft : [],
    [orden],
  );
  const draftComoDetalles = useMemo(
    () =>
      draft.map((l) => ({
        cantidad: l.cantidad,
        precio_unitario: l.precio,
        subtotal: Number(l.precio) * Number(l.cantidad),
      })),
    [draft],
  );

  // Montos: si aún hay líneas en draft (cotización/autorización) se usan;
  // si no, se usan las líneas ya descargadas (detalle_orden).
  const baseLineas = draft.length > 0 ? draftComoDetalles : detalles;
  const montos = useMemo(
    () => calcularMontos(orden ?? {}, baseLineas, abonos),
    [orden, baseLineas, abonos],
  );

  // descargado: hay líneas reales y el draft quedó vacío.
  const descargado = detalles.length > 0 && draft.length === 0;

  // #S2-13: el paso de Recepción se considera cumplido si el checklist se tocó
  // en esta sesión, o ya venía marcado de antes, o la OT ya avanzó de 'recepcion'.
  const checklistListo =
    checklistTocado ||
    checklistYaMarcado ||
    Boolean(orden?.estado && orden.estado !== "recepcion");
  const ctx = {
    orden,
    detalles,
    montos,
    checklistTocado: checklistListo,
    descargado,
    draft,
  };

  const historial = useMemo(
    () => (orden ? construirHistorialOT(orden, formatDate) : []),
    [orden],
  );

  /* ── Mutaciones genéricas ───────────────────────────────────────────── */
  const updateOrden = useCallback(
    async (patch, { refrescar = true } = {}) => {
      const { error } = await supabase
        .from("ordenes_servicio")
        .update(patch)
        .eq("id", id);
      if (error) throw error;
      if (refrescar) await cargar();
    },
    [id, cargar],
  );

  // Avanzar al siguiente estado del paso i (Continuar).
  const continuar = useCallback(
    async (i) => {
      if (busyRef.current || ro) return;
      const next = SIGUIENTE_ESTADO[i];
      if (!next) return;
      busyRef.current = true;
      setErrorMsg("");
      try {
        await updateOrden({ estado: next });
        setPasoAbierto(i + 1);
        avisarOk(TX.guardado);
      } catch (err) {
        avisarError(err, "No se pudo avanzar de paso");
      } finally {
        busyRef.current = false;
      }
    },
    [ro, updateOrden],
  );

  /* ── Estados de carga / error ───────────────────────────────────────── */
  if (loading) {
    return (
      <div
        className="p-4 sm:p-6 space-y-4 animate-fade-in"
        style={{ backgroundColor: "hsl(var(--background))" }}
      >
        <div
          className="h-9 w-1/3 animate-pulse rounded-lg"
          style={{ backgroundColor: "hsl(var(--muted))" }}
        />
        <div
          className="h-40 animate-pulse rounded-xl border"
          style={{ ...card }}
        />
      </div>
    );
  }

  if (!orden) {
    return (
      <div
        className="p-4 sm:p-6 space-y-4 animate-fade-in"
        style={{ backgroundColor: "hsl(var(--background))" }}
      >
        <p className="text-sm" style={{ color: "hsl(var(--destructive))" }}>
          {errorMsg || "Orden no encontrada"}
        </p>
        <OutlineButton onClick={() => navigate("/ops/ordenes")}>
          <ArrowLeft className="h-4 w-4" /> {TX.volverTablero}
        </OutlineButton>
      </div>
    );
  }

  const est = estadoEstilo(orden.estado);

  /* ── Imprimir constancia de recepción ───────────────────────────────── */
  // Checklist real de recepción (qué trajo el equipo) para la constancia.
  const cargarChecklistPDF = async () => {
    const { data } = await supabase
      .from("ot_checklist")
      .select("marcado, componente:componente_id!inner(nombre, orden, activo)")
      .eq("orden_id", id)
      .eq("componente.activo", true);
    return (data ?? [])
      .slice()
      .sort((a, b) => (a.componente?.orden ?? 0) - (b.componente?.orden ?? 0))
      .map((r) => ({
        marcado: r.marcado,
        nombre: r.componente?.nombre ?? "—",
      }));
  };

  const imprimirConstancia = async () => {
    try {
      const checklist = await cargarChecklistPDF();
      generarOrdenPDF({
        orden,
        checklist,
        tecnico: orden.tecnico?.nombre ?? "-",
        incluirCostos: false,
        modo: "recepcion",
      }).print();
    } catch (err) {
      avisarError(err, "No se pudo generar la constancia");
    }
  };

  // Recibo de la venta generada por la OT: EL MISMO documento POS del módulo
  // de Ventas (precio de venta, repuestos + mano de obra, consistente). Sirve
  // tanto al convertir como para reimprimir una OT ya entregada.
  const imprimirReciboVenta = async (ventaId) => {
    const vid = ventaId ?? orden.venta_id;
    if (!vid) {
      setErrorMsg("Esta OT aún no tiene venta generada.");
      return;
    }
    try {
      const [{ data: v }, { data: items }] = await Promise.all([
        supabase
          .from("ventas")
          .select("*, vendedor:vendedor_id(nombre)")
          .eq("id", vid)
          .single(),
        supabase
          .from("detalle_venta")
          .select("*, producto:producto_id(nombre, referencia, unidad_medida)")
          .eq("venta_id", vid),
      ]);
      generarVentaPOS({
        venta: v,
        items: items ?? [],
        vendedor: v?.vendedor?.nombre ?? "—",
      }).print();
    } catch (err) {
      avisarError(err, "No se pudo generar el recibo de venta");
    }
  };

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      {/* Volver */}
      <button
        onClick={() => navigate("/ops/ordenes")}
        className="inline-flex items-center gap-1.5 text-sm font-medium"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        <ArrowLeft className="h-4 w-4" /> {TX.volverTablero}
      </button>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <Header
        orden={orden}
        est={est}
        montos={montos}
        perfil={perfil}
        onImprimir={imprimirConstancia}
        onError={setErrorMsg}
        onRefresh={cargar}
      />

      {/* Banner solo lectura */}
      {ro && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border px-4 py-3 text-sm"
          style={{
            backgroundColor: "hsl(var(--warning) / 0.1)",
            borderColor: "hsl(var(--warning) / 0.3)",
            color: "hsl(var(--foreground))",
          }}
        >
          <Lock
            className="mt-0.5 h-4 w-4 shrink-0"
            style={{ color: "hsl(var(--warning))" }}
          />
          {TX.soloLectura(SEDE_LABEL[orden.sede_id] ?? orden.sede_id)}
        </div>
      )}

      {/* Errores fijos (carga y validación). Los resultados de acción saltan
          como pop-up. */}
      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border px-4 py-3 text-sm"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.1)",
            borderColor: "hsl(var(--destructive) / 0.3)",
            color: "hsl(var(--destructive))",
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* Stepper */}
      <div className="rounded-xl border p-4" style={card}>
        <OrdenStepper
          pasos={PASOS}
          actual={activo}
          reachableUntil={orden.estado === "terminada" ? 6 : activo}
          onGo={(i) => setPasoAbierto(i)}
        />
      </div>

      {/* ── Grid: acordeón + sidebar ──────────────────────────────────── */}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_340px]">
        {/* Acordeón de pasos */}
        <div className="space-y-3">
          {PASOS.map((paso) => (
            <PasoAcordeon
              key={paso.key}
              paso={paso}
              actual={activo}
              reachableUntil={orden.estado === "terminada" ? 6 : activo}
              abierto={pasoAbierto === paso.i}
              onToggle={() =>
                setPasoAbierto((cur) => (cur === paso.i ? null : paso.i))
              }
              ctx={ctx}
              ro={ro}
            >
              <PasoBody
                paso={paso}
                orden={orden}
                detalles={detalles}
                abonos={abonos}
                draft={draft}
                montos={montos}
                ctx={ctx}
                ro={ro}
                perfil={perfil}
                id={id}
                cargar={cargar}
                updateOrden={updateOrden}
                continuar={continuar}
                setPasoAbierto={setPasoAbierto}
                setErrorMsg={setErrorMsg}
                setChecklistTocado={setChecklistTocado}
                imprimirConstancia={imprimirConstancia}
                imprimirReciboVenta={imprimirReciboVenta}
              />
            </PasoAcordeon>
          ))}
        </div>

        {/* Sidebar */}
        <Sidebar
          orden={orden}
          montos={montos}
          historial={historial}
          cerrada={cerrada}
          updateOrden={updateOrden}
          ro={ro}
        />
      </div>
    </div>
  );
}

/* ════════════════════════════════ HEADER ═══════════════════════════════════ */

function Header({
  orden,
  est,
  montos,
  perfil,
  onImprimir,
  onError,
  onRefresh,
}) {
  const [anulando, setAnulando] = useState(false);
  const puede = puedeAnular(perfil, orden);
  const tieneAnticipos = montos.anticipos > 0;

  const anular = async () => {
    // #S2-01: si hay anticipos cobrados, NO se puede anular hasta registrar la
    // devolución (el backend también lo bloquea). Antes el mensaje ofrecía un
    // "¿Continuar de todos modos?" engañoso que igual dejaba el dinero huérfano.
    if (tieneAnticipos) {
      window.alert(
        `No se puede anular esta OT: tiene anticipos cobrados por ${formatCOP(
          montos.anticipos,
        )}.\n\n` +
          "Primero registra la devolución del dinero al cliente y luego cancela la OT.\n\n" +
          "Así el dinero recibido no queda sin rastro en la caja.",
      );
      return;
    }
    if (
      !window.confirm(
        "¿Seguro que deseas anular esta OT? Se devolverán al inventario los repuestos consumidos.",
      )
    )
      return;
    setAnulando(true);
    onError("");
    try {
      const { error } = await supabase.rpc("fn_cancelar_orden", {
        p_orden_id: orden.id,
      });
      if (error) throw error;
      await onRefresh();
    } catch (err) {
      onError(safeError(err, "No se pudo anular la orden"));
    } finally {
      setAnulando(false);
    }
  };

  const saldoCubierto = (montos.saldo ?? 0) <= 0;

  return (
    <div className="rounded-xl border overflow-hidden" style={card}>
      <div className="flex flex-col gap-4 p-4 sm:p-5 md:flex-row md:items-start md:justify-between">
        {/* Identidad */}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="text-lg font-bold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              OT-{orden.numero}
            </span>
            {/* Píldora de estado */}
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{
                backgroundColor: est.bg,
                color: est.fg,
                border: `1px solid ${est.border}`,
              }}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: est.dot }}
              />
              {est.label}
            </span>
            {/* Badge de sede */}
            <span
              className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
              style={{
                backgroundColor: "hsl(var(--muted) / 0.5)",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              {SEDE_LABEL[orden.sede_id] ?? orden.sede_id}
            </span>
          </div>
          <div
            className="text-sm font-medium"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {orden.cliente_nombre || "Sin cliente"}
          </div>
          <div
            className="text-sm"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {orden.equipo_descripcion || "Sin equipo"}
            {orden.equipo_serie && (
              <>
                {" · "}
                <span className="font-mono">Serie {orden.equipo_serie}</span>
              </>
            )}
          </div>
          <EquipoUbicacion
            orden={orden}
            perfil={perfil}
            onRefresh={onRefresh}
          />
        </div>

        {/* Total / Saldo */}
        <div className="flex items-center gap-6 md:gap-5">
          <div className="text-right">
            <div
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {TX.total}
            </div>
            <div
              className="text-lg font-bold tabular-nums"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {formatCOP(montos.total)}
            </div>
          </div>
          <div className="text-right">
            <div
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {TX.saldo}
            </div>
            <div
              className="text-lg font-bold tabular-nums"
              style={{
                color: saldoCubierto
                  ? "hsl(var(--success))"
                  : "hsl(var(--foreground))",
              }}
            >
              {formatCOP(montos.saldo)}
            </div>
          </div>
        </div>
      </div>

      {/* Acciones */}
      <div
        className="flex flex-wrap gap-2 border-t px-4 py-3 sm:px-5"
        style={{ borderColor: "hsl(var(--border))", ...sectionHeaderBg }}
      >
        <OutlineButton onClick={onImprimir}>
          <Printer className="h-4 w-4" /> {TX.imprimirConstancia}
        </OutlineButton>
        {puede && (
          <OutlineButton
            tone="destructive"
            disabled={anulando}
            onClick={anular}
          >
            <X className="h-4 w-4" />
            {anulando ? "Anulando…" : TX.anularOT}
          </OutlineButton>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════ ACORDEÓN DE PASO ══════════════════════════════ */

function PasoAcordeon({
  paso,
  actual,
  reachableUntil,
  abierto,
  onToggle,
  ctx,
  children,
}) {
  const completado = paso.i < actual;
  const esActivo = paso.i === actual;
  // Un paso es alcanzable hasta `reachableUntil` (mismo criterio que el stepper).
  // Clave en estado "terminada": permite abrir el paso de Entrega (i=6) aunque
  // `actual` sea 5; sin esto el acordeón decía "aún no disponible" (callejón).
  const alcanzable = paso.i <= (reachableUntil ?? actual);
  const cumplido = gateCumplido(paso.i, ctx);

  const accent = completado
    ? "hsl(var(--success))"
    : esActivo
      ? "hsl(var(--primary))"
      : "hsl(var(--muted-foreground))";

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        ...card,
        borderColor: esActivo
          ? "hsl(var(--primary) / 0.4)"
          : "hsl(var(--border))",
      }}
    >
      {/* Cabecera */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
        style={{ minHeight: 56 }}
      >
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold"
          style={{
            backgroundColor: completado
              ? "hsl(var(--success))"
              : esActivo
                ? "hsl(var(--primary))"
                : "hsl(var(--muted))",
            color:
              completado || esActivo
                ? "hsl(var(--primary-foreground))"
                : "hsl(var(--muted-foreground))",
          }}
        >
          {completado ? (
            <Check className="h-4 w-4" strokeWidth={3} />
          ) : (
            paso.i + 1
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="text-sm font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {paso.titulo}
            </span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: "hsl(var(--muted) / 0.5)",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              {paso.rol}
            </span>
          </div>
          <div
            className="truncate text-xs"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {paso.sub}
          </div>
        </div>
        {completado && (
          <span className="text-xs font-medium" style={{ color: accent }}>
            Completado
          </span>
        )}
        {abierto ? (
          <ChevronDown
            className="h-4 w-4 shrink-0"
            style={{ color: "hsl(var(--muted-foreground))" }}
          />
        ) : (
          <ChevronRight
            className="h-4 w-4 shrink-0"
            style={{ color: "hsl(var(--muted-foreground))" }}
          />
        )}
      </button>

      {/* Cuerpo */}
      {abierto && (
        <div className="border-t" style={{ borderColor: "hsl(var(--border))" }}>
          {!alcanzable ? (
            <div
              className="px-4 py-5 text-sm"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Este paso aún no está disponible. Completa los pasos anteriores
              primero.
            </div>
          ) : (
            <div className="space-y-4 p-4">
              {children}
              {/* Pie: mensaje de gate */}
              <div
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium"
                style={{
                  backgroundColor: cumplido
                    ? "hsl(var(--success) / 0.1)"
                    : "hsl(var(--muted) / 0.4)",
                  color: cumplido
                    ? "hsl(var(--success))"
                    : "hsl(var(--muted-foreground))",
                }}
              >
                {cumplido ? (
                  <Check className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                )}
                {mensajeGate(paso.i, ctx)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════ CUERPO POR PASO ═══════════════════════════════ */

function PasoBody(props) {
  const { paso } = props;
  switch (paso.i) {
    case 0:
      return <PasoRecepcion {...props} />;
    case 1:
      return <PasoDiagnostico {...props} />;
    case 2:
      return <PasoCotizacion {...props} />;
    case 3:
      return <PasoAutorizacion {...props} />;
    case 4:
      return <PasoTrabajo {...props} />;
    case 5:
      return <PasoTerminado {...props} />;
    case 6:
      return <PasoEntrega {...props} />;
    default:
      return null;
  }
}

/* ── Custodia del equipo del cliente ─────────────────────────────────────
   Muestra dónde quedó guardado el equipo mientras el cliente no lo recoge y
   permite mandarlo a otra sede (típicamente a Bodega) o traerlo de vuelta.
   El equipo es del CLIENTE: esto no toca inventario ni plata, solo custodia. */
function EquipoUbicacion({ orden, perfil, onRefresh }) {
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const enOtraSede = !!orden.sede_equipo_id;
  const sedeActual = orden.sede_equipo_id ?? orden.sede_id;
  // Por defecto se propone Bodega; si ya está en Bodega, se propone devolverlo.
  const [destino, setDestino] = useState(
    sedeActual === "BODEGA" ? orden.sede_id : "BODEGA",
  );
  const [nota, setNota] = useState("");

  const readOnly = !puedeManipular(perfil, orden);
  const opciones = Object.keys(SEDE_LABEL).filter((s) => s !== sedeActual);
  const vuelveASuSede = destino === orden.sede_id;

  const confirmar = async () => {
    if (guardando) return;
    setGuardando(true);
    try {
      const { error } = await supabase.rpc("fn_mover_equipo_orden", {
        p_orden_id: orden.id,
        // Volver a la sede de la orden se manda como null: el servidor lo
        // interpreta como "el equipo está en su sitio" y limpia los campos.
        p_sede_destino: vuelveASuSede ? null : destino,
        p_nota: vuelveASuSede ? null : nota || null,
      });
      if (error) throw error;
      avisarOk(
        vuelveASuSede
          ? "El equipo volvió a la sede de la orden."
          : `El equipo quedó guardado en ${SEDE_LABEL[destino] ?? destino}.`,
      );
      setAbierto(false);
      setNota("");
      await onRefresh();
    } catch (err) {
      avisarError(err, "No se pudo mover el equipo");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      {enOtraSede && (
        <span
          className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium"
          style={{
            backgroundColor: "hsl(var(--warning) / 0.12)",
            borderColor: "hsl(var(--warning) / 0.4)",
            color: "hsl(var(--warning))",
          }}
          title="El equipo del cliente no está en la sede de la orden"
        >
          <Package className="h-3.5 w-3.5" strokeWidth={1.8} />
          Equipo guardado en{" "}
          {SEDE_LABEL[orden.sede_equipo_id] ?? orden.sede_equipo_id}
          {orden.equipo_ubicacion_nota
            ? ` · ${orden.equipo_ubicacion_nota}`
            : ""}
        </span>
      )}

      {!readOnly &&
        (abierto ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              disabled={guardando}
              className="rounded-md border px-2 text-xs"
              style={{
                height: 34,
                borderColor: "hsl(var(--border))",
                backgroundColor: "hsl(var(--card))",
                color: "hsl(var(--foreground))",
              }}
            >
              {opciones.map((s) => (
                <option key={s} value={s}>
                  {s === orden.sede_id
                    ? `Devolver a ${SEDE_LABEL[s]}`
                    : SEDE_LABEL[s]}
                </option>
              ))}
            </select>
            {!vuelveASuSede && (
              <input
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                disabled={guardando}
                placeholder="¿Dónde exactamente? (opcional)"
                className="rounded-md border px-2 text-xs"
                style={{
                  height: 34,
                  width: 190,
                  borderColor: "hsl(var(--border))",
                  backgroundColor: "hsl(var(--card))",
                  color: "hsl(var(--foreground))",
                }}
              />
            )}
            <button
              onClick={confirmar}
              disabled={guardando}
              className="rounded-md px-2.5 text-xs font-semibold text-white disabled:opacity-50"
              style={{ height: 34, backgroundColor: "hsl(var(--primary))" }}
            >
              {guardando ? "Guardando…" : "Guardar"}
            </button>
            <button
              onClick={() => setAbierto(false)}
              disabled={guardando}
              className="rounded-md px-2 text-xs font-medium disabled:opacity-50"
              style={{ height: 34, color: "hsl(var(--muted-foreground))" }}
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAbierto(true)}
            className="text-xs font-medium underline-offset-2 hover:underline"
            style={{ color: "hsl(var(--primary))" }}
          >
            {enOtraSede
              ? "Mover o traer de vuelta"
              : "Guardar equipo en otra sede"}
          </button>
        ))}
    </div>
  );
}

/* Botón "Continuar" reutilizable: habilitado solo si gate cumplido y no readOnly. */
function ContinuarBtn({ paso, ctx, ro, continuar, label = TX.continuar }) {
  const ok = gateCumplido(paso.i, ctx) && !ro;
  // El último paso no usa este botón (se entrega vía RPC).
  if (paso.i >= SIGUIENTE_ESTADO.length) return null;
  return (
    <PrimaryButton
      disabled={!ok}
      onClick={() => continuar(paso.i)}
      style={{ width: "100%" }}
    >
      {label}
    </PrimaryButton>
  );
}

/* ── PASO 1 · Recepción ─────────────────────────────────────────────────── */
function PasoRecepcion({
  orden,
  id,
  ro,
  ctx,
  continuar,
  updateOrden,
  setChecklistTocado,
  imprimirConstancia,
}) {
  const [nombre, setNombre] = useState(orden.cliente_nombre ?? "");
  const [, setClienteId] = useState(orden.cliente_id ?? null);
  const [telefono, setTelefono] = useState(orden.cliente_telefono ?? "");
  const [equipo, setEquipo] = useState(orden.equipo_descripcion ?? "");
  const [serie, setSerie] = useState(orden.equipo_serie ?? "");

  const guardarCampo = async (patch) => {
    if (ro) return;
    try {
      await updateOrden(patch);
    } catch (err) {
      avisarError(err, "No se pudo guardar");
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cliente" htmlFor="ot-cliente">
          <ClientePicker
            id="ot-cliente"
            value={nombre}
            onChange={setNombre}
            onSelect={(c) => {
              setClienteId(c.id);
              setNombre(c.nombre ?? "");
              setTelefono(c.telefono ?? "");
              if (!ro)
                guardarCampo({
                  cliente_id: c.id,
                  cliente_nombre: c.nombre ?? "",
                  cliente_telefono: c.telefono ?? null,
                });
            }}
          />
        </Field>
        <Field label="Teléfono" htmlFor="ot-tel">
          <input
            id="ot-tel"
            value={telefono}
            disabled={ro}
            inputMode="tel"
            onChange={(e) => setTelefono(e.target.value)}
            onBlur={() => guardarCampo({ cliente_telefono: telefono || null })}
            className="h-12 rounded-lg border px-3 text-sm outline-none disabled:opacity-60"
            style={inputStyle}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Equipo / descripción" htmlFor="ot-equipo">
          <input
            id="ot-equipo"
            value={equipo}
            disabled={ro}
            onChange={(e) => setEquipo(e.target.value)}
            onBlur={() => guardarCampo({ equipo_descripcion: equipo })}
            placeholder="Ej. Compresor 2HP tanque 50L"
            className="h-12 rounded-lg border px-3 text-sm outline-none disabled:opacity-60"
            style={inputStyle}
          />
        </Field>
        <Field label="Serie (opcional)" htmlFor="ot-serie">
          <input
            id="ot-serie"
            value={serie}
            disabled={ro}
            onChange={(e) => setSerie(e.target.value)}
            onBlur={() => guardarCampo({ equipo_serie: serie || null })}
            className="h-12 rounded-lg border px-3 font-mono text-sm outline-none disabled:opacity-60"
            style={inputStyle}
          />
        </Field>
      </div>

      {/* Checklist */}
      <div className="rounded-xl border overflow-hidden" style={card}>
        <div
          className="px-4 py-3 border-b"
          style={{ borderColor: "hsl(var(--border))", ...sectionHeaderBg }}
        >
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Checklist de recepción
          </p>
        </div>
        <div className="p-4">
          <ChecklistRecepcion
            ordenId={id}
            readOnly={ro}
            onChange={() => setChecklistTocado(true)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <OutlineButton onClick={imprimirConstancia} style={{ flex: 1 }}>
          <Printer className="h-4 w-4" /> {TX.imprimirConstancia}
        </OutlineButton>
        <div style={{ flex: 1 }}>
          <ContinuarBtn
            paso={PASOS[0]}
            ctx={ctx}
            ro={ro}
            continuar={continuar}
          />
        </div>
      </div>
    </div>
  );
}

/* ── PASO 2 · Diagnóstico ───────────────────────────────────────────────── */
function PasoDiagnostico({ orden, ro, ctx, continuar, updateOrden }) {
  const [tecnicos, setTecnicos] = useState([]);
  const [diagnostico, setDiagnostico] = useState(orden.diagnostico ?? "");

  useEffect(() => {
    supabase
      .from("usuarios")
      .select("id, nombre, rol, sede_id")
      .eq("activo", true)
      .in("rol", ["Tecnico", "Admin"])
      .order("nombre")
      .then(({ data }) => setTecnicos(data ?? []));
  }, []);

  const guardar = async (patch) => {
    if (ro) return;
    try {
      await updateOrden(patch);
    } catch (err) {
      avisarError(err, "No se pudo guardar");
    }
  };

  return (
    <div className="space-y-4">
      <Field label="Técnico asignado" htmlFor="ot-tecnico">
        <select
          id="ot-tecnico"
          disabled={ro}
          value={orden.tecnico_id ?? ""}
          onChange={(e) => guardar({ tecnico_id: e.target.value || null })}
          className="h-12 rounded-lg border px-3 text-sm outline-none disabled:opacity-60"
          style={inputStyle}
        >
          <option value="">— Sin asignar —</option>
          {tecnicos.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre} ({t.rol})
            </option>
          ))}
        </select>
      </Field>

      <Field label="Diagnóstico" htmlFor="ot-diag">
        <textarea
          id="ot-diag"
          rows={4}
          disabled={ro}
          value={diagnostico}
          onChange={(e) => setDiagnostico(e.target.value)}
          onBlur={() => guardar({ diagnostico: diagnostico || null })}
          placeholder="¿Qué tiene el equipo y qué hay que hacer?"
          className="rounded-lg border px-3 py-2 text-sm outline-none disabled:opacity-60"
          style={inputStyle}
        />
      </Field>

      <ContinuarBtn paso={PASOS[1]} ctx={ctx} ro={ro} continuar={continuar} />
    </div>
  );
}

/* ── Stock de los repuestos cotizados ───────────────────────────────────── */

/**
 * Inventario de los repuestos del borrador, en la sede de la OT y en las demás.
 *
 * Existe porque el stock solo se veía en el desplegable del buscador, y ese
 * desplegable se borra en cuanto se toca el producto (ver `agregar`). De ahí en
 * adelante la vendedora cotizaba a ciegas y el problema aparecía dos pasos
 * después, al descargar, con la cotización ya aprobada por el cliente y a veces
 * con anticipo recibido (reporte de la clienta, OT 149).
 *
 * Se consultan TODAS las sedes en una sola llamada —el borrador tiene pocas
 * líneas— porque así se responden las dos preguntas que importan: cuánto hay
 * aquí y, si no alcanza, a qué sede pedirle un traspaso.
 */
const MAPA_VACIO = new Map();

function useStockSedes(productoIds, sedeId) {
  const clave = productoIds.join(",");
  const [estado, setEstado] = useState({ mapa: new Map(), cargado: false });
  // Convertir a insumo o descargar media cotización cambia estos números; sin
  // esto los chips quedarían mostrando el stock de antes de la operación.
  const [refresco, setRefresco] = useState(0);
  const recargar = useCallback(() => setRefresco((n) => n + 1), []);

  // Sin líneas o sin sede no hay nada que consultar: se resuelve al devolver,
  // no dentro del efecto (un setState síncrono ahí encadena renders).
  const vacio = !clave || !sedeId;

  useEffect(() => {
    if (vacio) return;
    const ids = clave.split(",");
    let vivo = true;
    (async () => {
      const { data, error } = await supabase
        .from("inventario")
        .select("producto_id, sede_id, cantidad, cantidad_insumo")
        .in("producto_id", ids);
      if (!vivo) return;
      if (error) {
        // Que falle el dato de stock no puede tumbar la cotización: se omiten
        // los chips y el paso 5 sigue validando contra la BD como siempre.
        console.error("[useStockSedes]", error);
        setEstado({ mapa: new Map(), cargado: false });
        return;
      }
      const mapa = new Map();
      (data ?? []).forEach((r) => {
        const e = mapa.get(r.producto_id) ?? { venta: 0, insumo: 0, otras: [] };
        if (r.sede_id === sedeId) {
          e.venta = Number(r.cantidad) || 0;
          e.insumo = Number(r.cantidad_insumo) || 0;
        } else {
          // En las OTRAS sedes cuentan los dos bolsillos: un traspaso puede
          // mover tanto venta como insumo (`detalle_traspaso.es_insumo`), así
          // que mirar solo `cantidad` diría "no hay en ninguna sede" con
          // unidades apartadas disponibles al lado.
          const total =
            (Number(r.cantidad) || 0) + (Number(r.cantidad_insumo) || 0);
          if (total > 0) e.otras.push({ sede_id: r.sede_id, cantidad: total });
        }
        mapa.set(r.producto_id, e);
      });
      mapa.forEach((e) => e.otras.sort((a, b) => b.cantidad - a.cantidad));
      setEstado({ mapa, cargado: true });
    })();
    return () => {
      vivo = false;
    };
  }, [clave, sedeId, refresco, vacio]);

  return vacio
    ? { mapa: MAPA_VACIO, cargado: true, recargar }
    : { ...estado, recargar };
}

/** "Bodega Principal (6) · Almacén CV (17)" — a quién pedirle el traspaso. */
const listarOtrasSedes = (otras = []) =>
  otras
    .map((o) => `${SEDE_LABEL[o.sede_id] ?? o.sede_id} (${o.cantidad})`)
    .join(" · ");

/**
 * Cuánto falta apartar para poder descargar una línea, y si eso se puede
 * resolver dentro de la sede o hace falta un traspaso.
 *
 * La OT consume `cantidad_insumo`, nunca `cantidad` (stock de venta): por eso
 * "hay 7 unidades" y "no se puede descargar" son ciertas a la vez, que es justo
 * lo que confunde al operario.
 */
const evaluarStockLinea = (info, cantidad) => {
  const venta = info?.venta ?? 0;
  const insumo = info?.insumo ?? 0;
  const faltaApartar = Math.max((Number(cantidad) || 0) - insumo, 0);
  return {
    venta,
    insumo,
    otras: info?.otras ?? [],
    faltaApartar,
    // Convertir venta → insumo solo es posible si la sede tiene ese stock de
    // venta; si no, ofrecer el botón es mandar al operario a un callejón sin
    // salida, porque el RPC va a rechazarlo igual.
    alcanzaConVenta: faltaApartar <= venta,
  };
};

/**
 * Chip de stock + aviso de una línea de la cotización.
 *
 * Tres situaciones, y en las tres se dice el porqué y el siguiente paso:
 *   - el insumo apartado alcanza  → solo el chip;
 *   - falta apartar y hay venta   → aviso naranja: al descargar habrá que
 *     convertir (el botón sigue siendo manual, a propósito);
 *   - no alcanza ni con la venta  → aviso rojo con las sedes donde sí hay,
 *     porque la salida real es un traspaso, no el botón de convertir.
 */
function StockLinea({ info, cantidad, sedeId, cargado }) {
  if (!cargado) return null;
  const { venta, insumo, otras, faltaApartar, alcanzaConVenta } =
    evaluarStockLinea(info, cantidad);
  const faltanUnidades = faltaApartar - venta;

  return (
    <div className="mt-1.5 space-y-1">
      <span
        className="inline-block rounded px-1.5 py-0.5 font-mono text-[11px]"
        style={{
          backgroundColor: "hsl(var(--muted) / 0.6)",
          color: "hsl(var(--muted-foreground))",
        }}
      >
        {sedeId}: {venta} venta · {insumo} insumo
      </span>

      {faltaApartar > 0 && (
        <p
          className="flex items-start gap-1.5 rounded px-1.5 py-1 text-[11px] leading-snug"
          style={{
            backgroundColor: alcanzaConVenta
              ? "hsl(var(--warning) / 0.12)"
              : "hsl(var(--destructive) / 0.12)",
            color: "hsl(var(--foreground))",
          }}
        >
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          <span>
            {alcanzaConVenta
              ? `${insumo === 0 ? "No hay unidades apartadas" : `Solo hay ${insumo} apartada(s)`} para reparación: al descargar tendrás que convertir ${faltaApartar} de venta a insumo.`
              : otras.length
                ? `En ${sedeId} no alcanza, faltan ${faltanUnidades}. Hay en ${listarOtrasSedes(otras)}: pide un traspaso antes de descargar.`
                : `Faltan ${faltanUnidades} y las otras sedes tampoco tienen. Hay que comprarlo.`}
          </span>
        </p>
      )}
    </div>
  );
}

/* ── PASO 3 · Cotización (borrador) ─────────────────────────────────────── */
function PasoCotizacion({
  orden,
  ro,
  ctx,
  draft,
  detalles = [],
  montos,
  continuar,
  updateOrden,
}) {
  const [search, setSearch] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [mano, setMano] = useState(String(orden.costo_mano_obra ?? 0));
  const [desc, setDesc] = useState(String(orden.descuento_valor ?? 0));

  // Stock de cada repuesto cotizado, para no dejarla cotizar a ciegas.
  const idsDraft = useMemo(
    () => draft.map((l) => l.producto_id).sort(),
    [draft],
  );
  const { mapa: stockSedes, cargado: stockCargado } = useStockSedes(
    idsDraft,
    orden.sede_id,
  );

  const persistirDraft = async (nuevo) => {
    if (ro) return;
    try {
      // Además del borrador, refleja el total de repuestos cotizados en
      // valor_repuestos para que el backend recalcule el total (y "Sugerir 50%"
      // del paso 4 no sea rechazado por el tope de abonos).
      const totalRepuestos = nuevo.reduce(
        (s, l) => s + (Number(l.precio) || 0) * (Number(l.cantidad) || 0),
        0,
      );
      await updateOrden({
        cotizacion_draft: nuevo,
        valor_repuestos: totalRepuestos,
      });
    } catch (err) {
      avisarError(err, "No se pudo guardar la cotización");
    }
  };

  const buscar = useCallback(
    async (q) => {
      const term = (q ?? "").trim();
      if (term.length < 2) {
        setResultados([]);
        setBuscando(false);
        return;
      }
      setBuscando(true);
      try {
        const safe = sanitizeSearch(term);
        const { data: prods, error } = await supabase
          .from("productos")
          .select("id, referencia, nombre, precio_venta, costo_promedio")
          .eq("activo", true)
          .or(`referencia.ilike.%${safe}%,nombre.ilike.%${safe}%`)
          .limit(40);
        if (error) throw error;
        const ids = (prods ?? []).map((p) => p.id);
        let stockMap = new Map();
        if (ids.length) {
          const { data: inv } = await supabase
            .from("inventario")
            .select("producto_id, cantidad, cantidad_insumo, ubicacion_id")
            .in("producto_id", ids)
            .eq("sede_id", orden.sede_id);
          (inv ?? []).forEach((r) => stockMap.set(r.producto_id, r));
        }
        setResultados(
          (prods ?? []).map((p) => ({
            ...p,
            venta: stockMap.get(p.id)?.cantidad ?? 0,
            insumo: stockMap.get(p.id)?.cantidad_insumo ?? 0,
            ubicacion_id: stockMap.get(p.id)?.ubicacion_id ?? null,
          })),
        );
      } catch (err) {
        console.error("[PasoCotizacion] buscar:", err);
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    },
    [orden.sede_id],
  );

  const buscarDebounced = useDebouncedCallback(buscar, 400);

  const agregar = (p) => {
    if (ro) return;
    const idx = draft.findIndex((l) => l.producto_id === p.id);
    let nuevo;
    if (idx >= 0) {
      nuevo = draft.map((l, i) =>
        i === idx ? { ...l, cantidad: Number(l.cantidad) + 1 } : l,
      );
    } else {
      nuevo = [
        ...draft,
        {
          producto_id: p.id,
          referencia: p.referencia,
          nombre: p.nombre,
          cantidad: 1,
          precio: Number(p.precio_venta) || 0,
          costo: Number(p.costo_promedio) || 0,
        },
      ];
    }
    persistirDraft(nuevo);
    setSearch("");
    setResultados([]);
  };

  const cambiarCantidad = (producto_id, delta) => {
    if (ro) return;
    const nuevo = draft
      .map((l) =>
        l.producto_id === producto_id
          ? { ...l, cantidad: Math.max(0, Number(l.cantidad) + delta) }
          : l,
      )
      .filter((l) => Number(l.cantidad) > 0);
    persistirDraft(nuevo);
  };

  /**
   * Cantidad escrita a mano.
   *
   * Antes la cantidad era un texto fijo y solo se podía mover con + y −: para
   * cotizar 12 unidades había que pulsar + once veces. Con cotizaciones de
   * muchos repuestos eso es inviable, y es justo lo que reportó la clienta.
   *
   * Espeja `setCantidadDirecta` de VentaNueva (misma semántica que el equipo ya
   * conoce del carrito de ventas): un valor no numérico se ignora — así el
   * campo se puede borrar para reescribirlo sin que la línea desaparezca — y 0
   * quita la línea, igual que bajar con −.
   */
  const fijarCantidad = (producto_id, valor) => {
    if (ro) return;
    const n = parseInt(valor, 10);
    if (isNaN(n)) return;
    const nuevo = draft
      .map((l) =>
        l.producto_id === producto_id ? { ...l, cantidad: Math.max(0, n) } : l,
      )
      .filter((l) => Number(l.cantidad) > 0);
    persistirDraft(nuevo);
  };

  const quitar = (producto_id) => {
    if (ro) return;
    persistirDraft(draft.filter((l) => l.producto_id !== producto_id));
  };

  return (
    <div className="space-y-4">
      {/* Buscador */}
      <Field label="Agregar repuesto (precio de venta)">
        <div
          className="flex h-12 items-center gap-2.5 rounded-lg border px-3.5"
          style={inputStyle}
        >
          <Search
            className="h-4 w-4 shrink-0"
            style={{ color: "hsl(var(--muted-foreground))" }}
          />
          <input
            value={search}
            disabled={ro}
            onChange={(e) => {
              setSearch(e.target.value);
              buscarDebounced(e.target.value);
            }}
            placeholder="Buscar por referencia o nombre (mín 2)…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            style={{ color: "hsl(var(--foreground))" }}
          />
        </div>
      </Field>

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
          className="max-h-64 divide-y overflow-y-auto rounded-lg border"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          {resultados.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={ro}
                onClick={() => agregar(p)}
                className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left disabled:opacity-50"
                style={{ backgroundColor: "hsl(var(--card))" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor =
                    "hsl(var(--muted) / 0.4)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "hsl(var(--card))")
                }
              >
                <div className="min-w-0 flex-1">
                  <p
                    className="flex items-center gap-1.5 truncate text-sm font-medium"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {p.nombre}
                    <UbicacionChip codigo={p.ubicacion_id} />
                  </p>
                  <p
                    className="font-mono text-xs"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {p.referencia} · Venta: {p.venta} · Insumo: {p.insumo}
                  </p>
                </div>
                <span
                  className="shrink-0 font-mono text-sm font-medium tabular-nums"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {formatCOP(p.precio_venta)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Líneas del borrador (o, si ya se descargaron, las líneas reales) */}
      {draft.length === 0 ? (
        detalles.length > 0 ? (
          <div className="space-y-2">
            <p
              className="text-xs font-medium"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Repuestos ya descargados del inventario:
            </p>
            <ul className="space-y-2" role="list">
              {detalles.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
                  style={card}
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-sm font-medium"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {d.producto?.nombre ?? "—"}
                    </p>
                    <p
                      className="font-mono text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {d.producto?.referencia ?? "?"} ·{" "}
                      {formatCOP(d.precio_unitario)} × {d.cantidad}
                    </p>
                  </div>
                  <span
                    className="font-mono text-sm font-semibold tabular-nums"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {formatCOP(d.subtotal)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p
            className="text-xs italic"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Aún no hay repuestos en la cotización.
          </p>
        )
      ) : (
        <ul className="space-y-2" role="list">
          {draft.map((l) => (
            <li
              key={l.producto_id}
              className="rounded-lg border px-3 py-2.5"
              style={card}
            >
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-medium"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {l.nombre}
                  </p>
                  <p
                    className="font-mono text-xs"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {l.referencia} · {formatCOP(l.precio)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={ro}
                    onClick={() => cambiarCantidad(l.producto_id, -1)}
                    className="grid h-9 w-9 place-items-center rounded-lg border disabled:opacity-50"
                    style={{
                      borderColor: "hsl(var(--border))",
                      color: "hsl(var(--foreground))",
                    }}
                    aria-label="Disminuir"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  {/* Editable: con muchos repuestos, llegar a 12 a punta de "+"
                    no es viable (reporte de la clienta). Mismo comportamiento
                    que el carrito de Ventas. */}
                  <input
                    type="number"
                    min="1"
                    inputMode="numeric"
                    disabled={ro}
                    value={l.cantidad}
                    onChange={(e) =>
                      fijarCantidad(l.producto_id, e.target.value)
                    }
                    onFocus={(e) => e.target.select()}
                    aria-label={`Cantidad de ${l.nombre ?? "repuesto"}`}
                    className="h-9 w-14 rounded-lg border bg-transparent text-center font-mono text-sm font-semibold tabular-nums outline-none disabled:opacity-50"
                    style={{
                      borderColor: "hsl(var(--border))",
                      color: "hsl(var(--foreground))",
                    }}
                  />
                  <button
                    type="button"
                    disabled={ro}
                    onClick={() => cambiarCantidad(l.producto_id, 1)}
                    className="grid h-9 w-9 place-items-center rounded-lg border disabled:opacity-50"
                    style={{
                      borderColor: "hsl(var(--border))",
                      color: "hsl(var(--foreground))",
                    }}
                    aria-label="Aumentar"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={ro}
                    onClick={() => quitar(l.producto_id)}
                    className="grid h-9 w-9 place-items-center rounded-lg disabled:opacity-50"
                    style={{ color: "hsl(var(--destructive))" }}
                    aria-label="Quitar"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <StockLinea
                info={stockSedes.get(l.producto_id)}
                cantidad={l.cantidad}
                sedeId={orden.sede_id}
                cargado={stockCargado}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Mano de obra / descuento / IVA */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Mano de obra" htmlFor="ot-mano">
          <input
            id="ot-mano"
            inputMode="numeric"
            disabled={ro}
            value={mano}
            onChange={(e) => setMano(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={() =>
              updateOrden({ costo_mano_obra: Number(mano) || 0 }).catch((err) =>
                avisarError(err),
              )
            }
            className="h-12 rounded-lg border px-3 text-sm outline-none disabled:opacity-60"
            style={inputStyle}
          />
        </Field>
        <Field label="Descuento" htmlFor="ot-desc">
          <input
            id="ot-desc"
            inputMode="numeric"
            disabled={ro}
            value={desc}
            onChange={(e) => setDesc(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={() =>
              updateOrden({ descuento_valor: Number(desc) || 0 }).catch((err) =>
                avisarError(err),
              )
            }
            className="h-12 rounded-lg border px-3 text-sm outline-none disabled:opacity-60"
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="IVA">
        <div className="flex gap-2">
          {[0, 19].map((pct) => {
            const sel = Number(orden.iva_pct) === pct;
            return (
              <button
                key={pct}
                type="button"
                disabled={ro}
                onClick={() =>
                  updateOrden({ iva_pct: pct }).catch((err) => avisarError(err))
                }
                className="flex-1 rounded-lg border text-sm font-medium disabled:opacity-50"
                style={{
                  minHeight: 48,
                  backgroundColor: sel
                    ? "hsl(var(--primary))"
                    : "hsl(var(--card))",
                  color: sel
                    ? "hsl(var(--primary-foreground))"
                    : "hsl(var(--foreground))",
                  borderColor: sel
                    ? "hsl(var(--primary))"
                    : "hsl(var(--border))",
                }}
              >
                {pct === 0 ? "Sin IVA (0%)" : "IVA 19%"}
              </button>
            );
          })}
        </div>
      </Field>

      {/* Resumen */}
      <ResumenMini montos={montos} />

      {/* Cotizar es opcional: si el cliente no va a autorizar, se continúa sin
          repuestos/mano de obra y solo se cobra la revisión en el paso siguiente. */}
      <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
        ¿El cliente no va a autorizar la reparación? Puedes continuar sin
        cotizar: en el paso siguiente marcas “No autoriza” y cobras solo la
        revisión.
      </p>

      <ContinuarBtn paso={PASOS[2]} ctx={ctx} ro={ro} continuar={continuar} />
    </div>
  );
}

/* ── PASO 4 · Autorización ──────────────────────────────────────────────── */
function PasoAutorizacion({
  orden,
  id,
  ro,
  ctx,
  abonos,
  montos,
  perfil,
  continuar,
  updateOrden,
  cargar,
  setErrorMsg,
}) {
  const [valorRev, setValorRev] = useState(String(orden.valor_revision ?? 0));
  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState("efectivo");
  const [cuenta, setCuenta] = useState("");
  const [guardando, setGuardando] = useState(false);

  const autoriza = orden.estado_autorizacion === "autorizado";
  const noAutoriza = orden.estado_autorizacion === "no_autorizado";

  const setAutorizado = async () => {
    if (ro) return;
    try {
      await updateOrden({
        estado_autorizacion: "autorizado",
        valor_revision: null,
      });
    } catch (err) {
      avisarError(err, "No se pudo guardar");
    }
  };
  const setNoAutorizado = async () => {
    if (ro) return;
    try {
      await updateOrden({ estado_autorizacion: "no_autorizado" });
    } catch (err) {
      avisarError(err, "No se pudo guardar");
    }
  };

  const registrarAnticipo = async () => {
    if (ro) return;
    const m = Number(monto) || 0;
    if (m <= 0) {
      setErrorMsg("Ingresa un monto de anticipo válido");
      return;
    }
    if (esPagoElectronico(metodo) && !cuenta) {
      setErrorMsg(
        "Selecciona la cuenta bancaria a la que entró el dinero. Sin esto, el cierre de caja no puede desglosar el anticipo por cuenta.",
      );
      return;
    }
    setGuardando(true);
    setErrorMsg("");
    try {
      const { error } = await supabase.from("abonos").insert({
        orden_id: id,
        monto: m,
        metodo_pago: metodo,
        cuenta_bancaria: esPagoElectronico(metodo) ? cuenta : null,
        registrado_por: perfil.id,
      });
      if (error) throw error;
      setMonto("");
      setCuenta("");
      await cargar();
    } catch (err) {
      avisarError(err, "No se pudo registrar el anticipo");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Dos opciones excluyentes */}
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={ro}
          onClick={setAutorizado}
          className="rounded-lg border px-3 py-3 text-sm font-medium disabled:opacity-50"
          style={{
            minHeight: 48,
            backgroundColor: autoriza
              ? "hsl(var(--success) / 0.12)"
              : "hsl(var(--card))",
            borderColor: autoriza
              ? "hsl(var(--success))"
              : "hsl(var(--border))",
            color: autoriza ? "hsl(var(--success))" : "hsl(var(--foreground))",
          }}
        >
          {TX.clienteAprobo}
        </button>
        <button
          type="button"
          disabled={ro}
          onClick={setNoAutorizado}
          className="rounded-lg border px-3 py-3 text-sm font-medium disabled:opacity-50"
          style={{
            minHeight: 48,
            backgroundColor: noAutoriza
              ? "hsl(var(--warning) / 0.12)"
              : "hsl(var(--card))",
            borderColor: noAutoriza
              ? "hsl(var(--warning))"
              : "hsl(var(--border))",
            color: noAutoriza
              ? "hsl(var(--warning))"
              : "hsl(var(--foreground))",
          }}
        >
          {TX.clienteNoAutoriza}
        </button>
      </div>

      {/* No autoriza: valor de revisión */}
      {noAutoriza && (
        <Field label={TX.cobroRevision} htmlFor="ot-rev">
          <input
            id="ot-rev"
            inputMode="numeric"
            disabled={ro}
            value={valorRev}
            onChange={(e) => setValorRev(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={() =>
              updateOrden({ valor_revision: Number(valorRev) || 0 }).catch(
                (err) => avisarError(err),
              )
            }
            className="h-12 rounded-lg border px-3 text-sm outline-none disabled:opacity-60"
            style={inputStyle}
          />
          <span
            className="text-xs"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {TX.cobroRevisionAyuda}
          </span>
        </Field>
      )}

      {/* Autoriza: anticipo */}
      {autoriza && (
        <div className="rounded-xl border overflow-hidden" style={card}>
          <div
            className="px-4 py-3 border-b"
            style={{ borderColor: "hsl(var(--border))", ...sectionHeaderBg }}
          >
            <p
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Anticipo del cliente
            </p>
          </div>
          <div className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Monto" htmlFor="ot-ant">
                <input
                  id="ot-ant"
                  inputMode="numeric"
                  disabled={ro}
                  value={monto}
                  onChange={(e) =>
                    setMonto(e.target.value.replace(/[^\d]/g, ""))
                  }
                  placeholder="0"
                  className="h-12 rounded-lg border px-3 text-sm outline-none disabled:opacity-60"
                  style={inputStyle}
                />
              </Field>
              <Field label="Método" htmlFor="ot-met">
                <select
                  id="ot-met"
                  disabled={ro}
                  value={metodo}
                  onChange={(e) => setMetodo(e.target.value)}
                  className="h-12 rounded-lg border px-3 text-sm outline-none disabled:opacity-60"
                  style={inputStyle}
                >
                  {METODO_PAGO.map((m) => (
                    <option key={m.v} value={m.v}>
                      {m.l}
                    </option>
                  ))}
                </select>
              </Field>
              <CuentaAbonoField
                metodo={metodo}
                cuenta={cuenta}
                setCuenta={setCuenta}
                disabled={ro || guardando}
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <OutlineButton
                disabled={ro}
                onClick={() => setMonto(String(Math.round(montos.total * 0.5)))}
                style={{ flex: 1 }}
              >
                {TX.sugerir50}
              </OutlineButton>
              <PrimaryButton
                disabled={ro || guardando}
                onClick={registrarAnticipo}
                style={{ flex: 1 }}
              >
                {guardando ? "Registrando…" : TX.registrar}
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}

      {/* Lista de anticipos + saldo en vivo */}
      {abonos.length > 0 && (
        <div className="space-y-1.5">
          {abonos.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
              style={card}
            >
              <span style={{ color: "hsl(var(--muted-foreground))" }}>
                {formatDate(a.fecha)} · {a.metodo_pago}
              </span>
              <span
                className="font-mono font-medium tabular-nums"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {formatCOP(a.monto)}
              </span>
            </div>
          ))}
        </div>
      )}
      <ResumenMini montos={montos} />

      <ContinuarBtn paso={PASOS[3]} ctx={ctx} ro={ro} continuar={continuar} />
    </div>
  );
}

/* ── PASO 5 · Descarga + trabajo ────────────────────────────────────────── */
function PasoTrabajo({
  orden,
  id,
  ro,
  draft,
  updateOrden,
  setPasoAbierto,
  setErrorMsg,
}) {
  // Si el cliente NO autorizó, no hay descarga de repuestos: la OT se cierra
  // cobrando solo la revisión/diagnóstico y la cotización (borrador) se descarta
  // sin tocar el inventario.
  const noAutoriza = orden.estado_autorizacion === "no_autorizado";
  const [descargando, setDescargando] = useState(false);
  // { producto_id, nombre, faltante, venta, insumo, otras, alcanzaConVenta }
  const [conv, setConv] = useState(null);
  const [trabajo, setTrabajo] = useState(
    orden.trabajo_realizado ??
      (noAutoriza
        ? "El cliente no autorizó la reparación; se cobra solo la revisión/diagnóstico."
        : ""),
  );
  const [terminando, setTerminando] = useState(false);
  const esperando = orden.estado === "esperando_repuesto";

  // Mismo stock que en el paso 3: justo antes de pulsar "Descargar" tiene que
  // seguir a la vista qué línea va a exigir conversión y cuál no se puede.
  const idsDraft = useMemo(
    () => (draft ?? []).map((l) => l.producto_id).sort(),
    [draft],
  );
  const {
    mapa: stockSedes,
    cargado: stockCargado,
    recargar: recargarStock,
  } = useStockSedes(idsDraft, orden.sede_id);

  // Habilitar "Marcar como terminado": editable y con descripción. Si el cliente
  // autorizó, además no deben quedar repuestos pendientes en el borrador; si NO
  // autorizó, el borrador se descarta al terminar (no se exige vaciarlo antes).
  const puedeTerminar =
    !ro &&
    (noAutoriza || (draft?.length ?? 0) === 0) &&
    Boolean((trabajo || "").trim());

  const guardarTrabajo = async () => {
    if (ro) return;
    try {
      await updateOrden({ trabajo_realizado: trabajo || null });
    } catch (err) {
      avisarError(err, "No se pudo guardar");
    }
  };

  // Marca terminado escribiendo el trabajo en el MISMO update (el backend exige
  // trabajo_realizado no vacío para la transición a 'terminada').
  const marcarTerminado = async () => {
    if (!puedeTerminar || terminando) return;
    setTerminando(true);
    setErrorMsg("");
    try {
      const payload = {
        estado: "terminada",
        trabajo_realizado: trabajo || null,
      };
      // Cliente no autorizó: descarta la cotización (borrador) SIN descargar
      // inventario; esos repuestos nunca se usaron.
      if (noAutoriza && (draft?.length ?? 0) > 0) payload.cotizacion_draft = [];
      await updateOrden(payload);
      avisarOk("OT marcada como terminada.");
      setPasoAbierto?.(5);
    } catch (err) {
      avisarError(err, "No se pudo marcar como terminada");
    } finally {
      setTerminando(false);
    }
  };

  const descargar = async () => {
    if (ro || descargando) return;
    setDescargando(true);
    setErrorMsg("");
    try {
      // Procesa el draft como cola de PENDIENTES: por cada línea insertada con
      // éxito se elimina del draft y se persiste el resto. Así, si una línea
      // falla por insumo y luego se reintenta tras convertir, no se reinserta lo
      // ya descargado (evita duplicados). No se toca valor_repuestos aquí: el
      // trigger de detalle_orden lo mantiene.
      let pendientes = [...draft];
      while (pendientes.length > 0) {
        const l = pendientes[0];
        const { error } = await supabase.from("detalle_orden").insert({
          orden_id: id,
          producto_id: l.producto_id,
          cantidad: l.cantidad,
          precio_unitario: l.precio,
          costo_unitario: l.costo,
        });
        if (error) {
          // Insumo insuficiente → abortar, dejando esta línea (y las siguientes)
          // pendientes en el draft. Se convierte solo el DÉFICIT (cantidad −
          // insumo disponible), no la cantidad completa, para no exigir más
          // stock de venta del necesario.
          //
          // Se consulta el inventario del producto en TODAS las sedes, no solo
          // en la de la OT: si aquí no hay stock de venta que convertir, el
          // botón "Convertir venta → insumo" va a fallar igual y ofrecerlo deja
          // al operario sin salida (reporte de la clienta, OT 149). En ese caso
          // la salida real es un traspaso, y hay que decirle desde dónde.
          if ((error.message ?? "").toLowerCase().includes("insumo")) {
            const { data: filas, error: errStock } = await supabase
              .from("inventario")
              .select("sede_id, cantidad, cantidad_insumo")
              .eq("producto_id", l.producto_id);
            // Si no se pudo leer el inventario NO se puede afirmar nada: decir
            // "no hay en ninguna sede" por una consulta caída sería mandarlos a
            // comprar algo que quizá tienen al lado. Se cae al mensaje del
            // trigger, que sí es cierto.
            if (errStock) {
              console.error("[descargar] stock:", errStock);
              setConv(null);
              avisarError(error, "Stock de insumo insuficiente");
              setDescargando(false);
              return;
            }
            const aqui = (filas ?? []).find((r) => r.sede_id === orden.sede_id);
            const { venta, insumo, faltaApartar } = evaluarStockLinea(
              {
                venta: Number(aqui?.cantidad) || 0,
                insumo: Number(aqui?.cantidad_insumo) || 0,
              },
              l.cantidad,
            );
            // Mínimo 1: si el insert falló pese a que el insumo parecía
            // alcanzar (otro usuario lo consumió entremedio), igual hay que
            // apartar al menos una unidad. Se ofrece convertir solo si esa
            // cantidad exacta cabe en el stock de venta.
            const faltante = Math.max(faltaApartar, 1);
            const alcanzaConVenta = faltante <= venta;
            // Los dos bolsillos cuentan para un traspaso (ver `useStockSedes`).
            const otras = (filas ?? [])
              .filter((r) => r.sede_id !== orden.sede_id)
              .map((r) => ({
                sede_id: r.sede_id,
                cantidad:
                  (Number(r.cantidad) || 0) + (Number(r.cantidad_insumo) || 0),
              }))
              .filter((r) => r.cantidad > 0)
              .sort((a, b) => b.cantidad - a.cantidad);
            setConv({
              producto_id: l.producto_id,
              nombre: l.nombre,
              faltante,
              venta,
              insumo,
              otras,
              alcanzaConVenta,
            });
            avisarError(
              alcanzaConVenta
                ? error
                : `${l.nombre ?? "El repuesto"} no se puede descargar: no hay unidades suficientes en ${SEDE_LABEL[orden.sede_id] ?? orden.sede_id}.`,
              "Stock de insumo insuficiente",
            );
            setDescargando(false);
            return;
          }
          throw error;
        }
        // Línea insertada → quitarla de la cola y persistir el draft restante.
        pendientes = pendientes.slice(1);
        await updateOrden({ cotizacion_draft: pendientes });
      }
      avisarOk("Repuestos descargados del inventario.");
    } catch (err) {
      avisarError(err, "No se pudo descargar el inventario");
    } finally {
      recargarStock();
      setDescargando(false);
    }
  };

  const convertir = async () => {
    if (!conv) return;
    setErrorMsg("");
    try {
      const { error } = await supabase.rpc("fn_convertir_a_insumo", {
        p_producto_id: conv.producto_id,
        p_sede_id: orden.sede_id,
        p_cantidad: conv.faltante,
      });
      if (error) throw error;
      setConv(null);
      await descargar(); // reintenta el lote completo
    } catch (err) {
      avisarError(err, "No se pudo convertir a insumo");
    }
  };

  const togglePausa = async () => {
    if (ro) return;
    try {
      await updateOrden({
        estado: esperando ? "en_proceso" : "esperando_repuesto",
      });
    } catch (err) {
      avisarError(err, "No se pudo cambiar el estado");
    }
  };

  return (
    <div className="space-y-4">
      {/* Cliente no autorizó: nota; si autorizó, líneas pendientes de descargar */}
      {noAutoriza ? (
        <div
          className="rounded-lg border px-4 py-3"
          style={{
            backgroundColor: "hsl(var(--info) / 0.1)",
            borderColor: "hsl(var(--info) / 0.3)",
          }}
        >
          <p className="text-sm" style={{ color: "hsl(var(--foreground))" }}>
            El cliente <strong>no autorizó</strong> la reparación. Los repuestos
            cotizados <strong>no se descargan del inventario</strong>: solo se
            cobra la revisión / diagnóstico. Al marcar como terminado se
            descarta la cotización sin afectar el stock.
          </p>
        </div>
      ) : draft.length > 0 ? (
        <div className="rounded-xl border overflow-hidden" style={card}>
          <div
            className="px-4 py-3 border-b"
            style={{ borderColor: "hsl(var(--border))", ...sectionHeaderBg }}
          >
            <p
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Pendiente de descargar
            </p>
          </div>
          <ul
            className="divide-y"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            {draft.map((l) => (
              <li key={l.producto_id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm font-medium"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {l.nombre}
                    </p>
                    <p
                      className="font-mono text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {l.referencia}
                    </p>
                  </div>
                  <span
                    className="font-mono text-sm tabular-nums"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    ×{l.cantidad}
                  </span>
                </div>
                <StockLinea
                  info={stockSedes.get(l.producto_id)}
                  cantidad={l.cantidad}
                  sedeId={orden.sede_id}
                  cargado={stockCargado}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p
          className="text-xs italic"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          No hay líneas pendientes de descargar.
        </p>
      )}

      {/* Por qué no se pudo descargar, y qué hacer al respecto.
          Si la sede tiene stock de venta, la salida es convertir (manual, con
          su movimiento de auditoría). Si no lo tiene, convertir es imposible:
          se explica el porqué y se indica a qué sede pedirle el traspaso, en
          vez de ofrecer un botón que va a fallar. */}
      {conv && (
        <div
          className="space-y-2 rounded-lg border px-4 py-3"
          style={{
            backgroundColor: conv.alcanzaConVenta
              ? "hsl(var(--warning) / 0.1)"
              : "hsl(var(--destructive) / 0.1)",
            borderColor: conv.alcanzaConVenta
              ? "hsl(var(--warning) / 0.3)"
              : "hsl(var(--destructive) / 0.3)",
          }}
        >
          {conv.alcanzaConVenta ? (
            <>
              <p
                className="text-sm"
                style={{ color: "hsl(var(--foreground))" }}
              >
                <strong>{conv.nombre}</strong>{" "}
                {conv.insumo === 0
                  ? "no tiene unidades apartadas para reparación"
                  : `solo tiene ${conv.insumo} apartada(s) para reparación`}{" "}
                en {SEDE_LABEL[orden.sede_id] ?? orden.sede_id}. Una orden
                descuenta del stock apartado, no del de venta: hay{" "}
                <strong>{conv.venta} de venta</strong> y faltan{" "}
                <strong>{conv.faltante}</strong> por apartar. Conviértelas para
                poder descargarlo.
              </p>
              <PrimaryButton onClick={convertir} style={{ width: "100%" }}>
                {TX.convertirInsumo}
              </PrimaryButton>
            </>
          ) : (
            <p className="text-sm" style={{ color: "hsl(var(--foreground))" }}>
              <strong>{conv.nombre}</strong> no se puede descargar en{" "}
              {SEDE_LABEL[orden.sede_id] ?? orden.sede_id}: se necesitan{" "}
              <strong>{conv.faltante}</strong> y solo hay{" "}
              <strong>{conv.venta}</strong>. Por eso tampoco se puede convertir
              a insumo, porque no hay qué convertir.{" "}
              {conv.otras?.length ? (
                <>
                  Hay unidades en{" "}
                  <strong>{listarOtrasSedes(conv.otras)}</strong>: solicita un
                  traspaso y vuelve a descargar. Si no puedes esperar, quita el
                  repuesto de la cotización en el paso Cotización.
                </>
              ) : (
                <>
                  Las otras sedes tampoco tienen unidades: hay que comprarlo, o
                  quitar el repuesto de la cotización en el paso Cotización.
                </>
              )}
            </p>
          )}
        </div>
      )}

      {!noAutoriza && (
        <div className="flex flex-col gap-2 sm:flex-row">
          {draft.length > 0 && (
            <PrimaryButton
              disabled={ro || descargando}
              onClick={descargar}
              style={{ flex: 1 }}
            >
              <Package className="h-4 w-4" />
              {descargando ? "Descargando…" : TX.descargarInventario}
            </PrimaryButton>
          )}
          <OutlineButton
            tone="warning"
            disabled={ro}
            onClick={togglePausa}
            style={{ flex: 1 }}
          >
            {esperando ? TX.reanudar : TX.pausarEsperando}
          </OutlineButton>
        </div>
      )}

      <Field
        label={noAutoriza ? "Observación" : "Trabajo realizado"}
        htmlFor="ot-trab"
      >
        <textarea
          id="ot-trab"
          rows={4}
          disabled={ro}
          value={trabajo}
          onChange={(e) => setTrabajo(e.target.value)}
          onBlur={guardarTrabajo}
          placeholder={
            noAutoriza
              ? "Motivo por el que el cliente no autorizó / observaciones"
              : "Describe lo que se hizo en el equipo"
          }
          className="rounded-lg border px-3 py-2 text-sm outline-none disabled:opacity-60"
          style={inputStyle}
        />
      </Field>

      <PrimaryButton
        disabled={!puedeTerminar || terminando}
        onClick={marcarTerminado}
        style={{ width: "100%" }}
      >
        {terminando ? "Guardando…" : TX.marcarTerminado}
      </PrimaryButton>
    </div>
  );
}

/* ── PASO 6 · Terminado ─────────────────────────────────────────────────── */
function PasoTerminado({ orden, setPasoAbierto }) {
  // Confirmación breve: el trabajo ya se registró en el paso anterior. Este
  // botón SOLO navega a la entrega (no cambia estado: la entrega real ocurre
  // en el paso 7 vía fn_generar_venta_ot).
  return (
    <div className="space-y-4">
      <div
        className="rounded-lg border px-4 py-3"
        style={{
          backgroundColor: "hsl(var(--success) / 0.1)",
          borderColor: "hsl(var(--success) / 0.3)",
        }}
      >
        <p
          className="text-sm font-medium"
          style={{ color: "hsl(var(--foreground))" }}
        >
          Equipo terminado, listo para la entrega.
        </p>
      </div>

      <Field label="Trabajo realizado">
        <p
          className="whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm"
          style={{
            color: "hsl(var(--foreground))",
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--muted) / 0.3)",
          }}
        >
          {(orden.trabajo_realizado || "").trim() || "—"}
        </p>
      </Field>

      <PrimaryButton
        onClick={() => setPasoAbierto?.(6)}
        style={{ width: "100%" }}
      >
        Ir a la entrega
      </PrimaryButton>
    </div>
  );
}

/* ── PASO 7 · Recogida → venta ──────────────────────────────────────────── */
function PasoEntrega({
  orden,
  id,
  ro,
  montos,
  perfil,
  cargar,
  setErrorMsg,
  imprimirReciboVenta,
}) {
  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState("efectivo");
  const [cuenta, setCuenta] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [generando, setGenerando] = useState(false);

  const saldoCubierto = (montos.saldo ?? 0) <= 0;
  const entregada = orden.estado === "entregada";

  const registrarSaldo = async () => {
    if (ro) return;
    const m = Number(monto) || 0;
    if (m <= 0) {
      setErrorMsg("Ingresa un monto válido");
      return;
    }
    if (esPagoElectronico(metodo) && !cuenta) {
      setErrorMsg(
        "Selecciona la cuenta bancaria a la que entró el dinero. Sin esto, el cierre de caja no puede desglosar el pago por cuenta.",
      );
      return;
    }
    setGuardando(true);
    setErrorMsg("");
    try {
      const { error } = await supabase.from("abonos").insert({
        orden_id: id,
        monto: m,
        metodo_pago: metodo,
        cuenta_bancaria: esPagoElectronico(metodo) ? cuenta : null,
        registrado_por: perfil.id,
      });
      if (error) throw error;
      setMonto("");
      setCuenta("");
      await cargar();
    } catch (err) {
      avisarError(err, "No se pudo registrar el pago");
    } finally {
      setGuardando(false);
    }
  };

  const convertirAVenta = async () => {
    if (ro || generando || !saldoCubierto) return;

    // La OT solo se puede facturar con saldo en cero, así que a esta altura el
    // cliente YA pagó (todo o parte en abonos). El riesgo real de operación es
    // volver a cobrarle en el mostrador al ver la factura nueva, y también
    // explica por qué la plata "parece" contarse dos veces: entró como abono y
    // ahora aparece como venta, pero es el MISMO dinero.
    const yaPagado = (montos.anticipos ?? 0) > 0;
    const avisoPago = yaPagado
      ? `\n\n⚠️ NO LE COBRES AL CLIENTE.\nYa pagó ${formatCOP(
          montos.anticipos,
        )} en abonos durante esta orden. Ese dinero YA entró a caja: la factura solo formaliza la entrega, no es un cobro nuevo.`
      : "";

    // #S2-17: acción irreversible (genera la venta, cierra garantías y congela
    // la OT). Confirmar explicando la consecuencia antes de ejecutar.
    if (
      !window.confirm(
        `Vas a facturar y entregar la OT-${orden.numero} por ${formatCOP(
          montos.total,
        )}.${avisoPago}\n\nEsto genera la venta y cierra la orden; no se puede deshacer. ¿Continuar?`,
      )
    )
      return;
    setGenerando(true);
    setErrorMsg("");
    try {
      const { data, error } = await supabase.rpc("fn_generar_venta_ot", {
        p_orden_id: id,
      });
      if (error) throw error;
      await cargar();
      avisarOk("OT convertida a venta. Generando recibo…");
      // Recibo = el MISMO documento POS del módulo de Ventas (precio de venta).
      await imprimirReciboVenta?.(data?.venta_id);
    } catch (err) {
      avisarError(err, "No se pudo convertir a venta");
    } finally {
      setGenerando(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Totales grandes */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { l: TX.total, v: montos.total, color: "hsl(var(--foreground))" },
          {
            l: TX.anticipos,
            v: montos.anticipos,
            color: "hsl(var(--foreground))",
          },
          {
            l: TX.saldo,
            v: montos.saldo,
            color: saldoCubierto
              ? "hsl(var(--success))"
              : "hsl(var(--destructive))",
          },
        ].map((b) => (
          <div
            key={b.l}
            className="rounded-xl border p-3 text-center"
            style={card}
          >
            <div
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {b.l}
            </div>
            <div
              className="mt-1 text-base font-bold tabular-nums"
              style={{ color: b.color }}
            >
              {formatCOP(b.v)}
            </div>
          </div>
        ))}
      </div>

      {/* Pago del saldo */}
      {!saldoCubierto && !entregada && (
        <div className="rounded-xl border overflow-hidden" style={card}>
          <div
            className="px-4 py-3 border-b"
            style={{ borderColor: "hsl(var(--border))", ...sectionHeaderBg }}
          >
            <p
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Pago del saldo
            </p>
          </div>
          <div className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Monto" htmlFor="ot-saldo">
                <input
                  id="ot-saldo"
                  inputMode="numeric"
                  disabled={ro}
                  value={monto}
                  onChange={(e) =>
                    setMonto(e.target.value.replace(/[^\d]/g, ""))
                  }
                  placeholder="0"
                  className="h-12 rounded-lg border px-3 text-sm outline-none disabled:opacity-60"
                  style={inputStyle}
                />
              </Field>
              <Field label="Método" htmlFor="ot-saldo-met">
                <select
                  id="ot-saldo-met"
                  disabled={ro}
                  value={metodo}
                  onChange={(e) => setMetodo(e.target.value)}
                  className="h-12 rounded-lg border px-3 text-sm outline-none disabled:opacity-60"
                  style={inputStyle}
                >
                  {METODO_PAGO.map((m) => (
                    <option key={m.v} value={m.v}>
                      {m.l}
                    </option>
                  ))}
                </select>
              </Field>
              <CuentaAbonoField
                metodo={metodo}
                cuenta={cuenta}
                setCuenta={setCuenta}
                disabled={ro || guardando}
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <OutlineButton
                disabled={ro}
                onClick={() => setMonto(String(Math.round(montos.saldo)))}
                style={{ flex: 1 }}
              >
                Saldo completo
              </OutlineButton>
              <PrimaryButton
                disabled={ro || guardando}
                onClick={registrarSaldo}
                style={{ flex: 1 }}
              >
                {guardando ? "Registrando…" : TX.registrar}
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}

      {!entregada ? (
        <div className="space-y-2">
          {/* Aviso EN PANTALLA (no solo en el pop-up de confirmación): el dinero
              de esta OT ya está en caja como abonos. Sin esto, al ver la factura
              nueva es fácil cobrarle otra vez al cliente. */}
          {saldoCubierto && (montos.anticipos ?? 0) > 0 && (
            <div
              className="rounded-lg border px-3 py-2.5"
              style={{
                backgroundColor: "hsl(var(--warning) / 0.1)",
                borderColor: "hsl(var(--warning) / 0.4)",
              }}
            >
              <p
                className="text-[12.5px] font-semibold"
                style={{ color: "hsl(var(--foreground))" }}
              >
                No le cobres al cliente
              </p>
              <p
                className="mt-0.5 text-[11.5px] leading-relaxed"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Ya pagó {formatCOP(montos.anticipos)} en abonos. Ese dinero ya
                entró a caja: la factura solo formaliza la entrega.
              </p>
            </div>
          )}
          <PrimaryButton
            disabled={ro || !saldoCubierto || generando}
            onClick={convertirAVenta}
            style={{ width: "100%" }}
          >
            <ShieldCheck className="h-4 w-4" />
            {generando ? "Generando…" : TX.convertirVenta}
          </PrimaryButton>
        </div>
      ) : (
        <div className="space-y-3">
          <div
            className="flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold"
            style={{
              backgroundColor: "hsl(var(--success) / 0.12)",
              color: "hsl(var(--success))",
            }}
          >
            <Check className="h-4 w-4" /> OT entregada y convertida a venta.
          </div>
          <OutlineButton
            onClick={() => imprimirReciboVenta?.()}
            style={{ width: "100%" }}
          >
            <Printer className="h-4 w-4" /> Reimprimir recibo de venta
          </OutlineButton>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Resumen económico mini ───────────────────────── */
function ResumenMini({ montos }) {
  const rows = [
    ["Repuestos", montos.repuestos],
    ["Mano de obra", montos.mano],
    montos.revision > 0 ? ["Valor revisión", montos.revision] : null,
    montos.descuento > 0 ? ["Descuento", -montos.descuento] : null,
    montos.iva > 0 ? [`IVA ${montos.ivaPct}%`, montos.iva] : null,
  ].filter(Boolean);
  return (
    <div className="rounded-lg border px-4 py-3 space-y-1.5" style={card}>
      {rows.map(([l, v]) => (
        <div key={l} className="flex justify-between text-sm">
          <span style={{ color: "hsl(var(--muted-foreground))" }}>{l}</span>
          <span
            className="font-mono tabular-nums"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {formatCOP(v)}
          </span>
        </div>
      ))}
      <div
        className="flex justify-between border-t pt-1.5 text-sm font-semibold"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <span style={{ color: "hsl(var(--foreground))" }}>{TX.total}</span>
        <span
          className="font-mono tabular-nums"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {formatCOP(montos.total)}
        </span>
      </div>
    </div>
  );
}

/* ════════════════════════════════ SIDEBAR ══════════════════════════════════ */

/**
 * Bloque lateral de Técnico. Editable (selector) mientras la OT no esté
 * cerrada (ro=false); si no, muestra el nombre en solo lectura. Permite
 * asignar/reasignar el técnico desde cualquier punto, no solo en el paso
 * de Diagnóstico.
 */
function TecnicoSidebarBlock({ orden, updateOrden, ro }) {
  const [tecnicos, setTecnicos] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    supabase
      .from("usuarios")
      .select("id, nombre, rol")
      .eq("activo", true)
      .in("rol", ["Tecnico", "Admin"])
      .order("nombre")
      .then(({ data }) => setTecnicos(data ?? []));
  }, []);

  const cambiar = async (val) => {
    setSaving(true);
    setErr("");
    try {
      await updateOrden({ tecnico_id: val || null });
    } catch (e) {
      setErr(safeError(e, "No se pudo asignar el técnico"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border overflow-hidden" style={card}>
      <div
        className="px-4 py-3 border-b"
        style={{ borderColor: "hsl(var(--border))", ...sectionHeaderBg }}
      >
        <p
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Técnico asignado
        </p>
      </div>
      <div className="p-4">
        {ro ? (
          <p className="text-sm" style={{ color: "hsl(var(--foreground))" }}>
            {orden.tecnico?.nombre ?? "Sin asignar"}
            {orden.tecnico?.rol && (
              <span style={{ color: "hsl(var(--muted-foreground))" }}>
                {" "}
                · {orden.tecnico.rol}
              </span>
            )}
          </p>
        ) : (
          <>
            <select
              value={orden.tecnico_id ?? ""}
              disabled={saving}
              onChange={(e) => cambiar(e.target.value)}
              className="h-11 w-full rounded-lg border px-3 text-sm outline-none disabled:opacity-60"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--foreground))",
              }}
            >
              <option value="">— Sin asignar —</option>
              {tecnicos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre} ({t.rol})
                </option>
              ))}
            </select>
            {err && (
              <p
                className="mt-1.5 text-xs"
                style={{ color: "hsl(var(--destructive))" }}
              >
                {err}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Sidebar({ orden, montos, historial, updateOrden, ro }) {
  const saldoCubierto = (montos.saldo ?? 0) <= 0;
  return (
    <aside className="space-y-3 lg:sticky lg:top-4 self-start">
      {/* Resumen económico */}
      <div className="rounded-xl border overflow-hidden" style={card}>
        <div
          className="px-4 py-3 border-b"
          style={{ borderColor: "hsl(var(--border))", ...sectionHeaderBg }}
        >
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Resumen económico
          </p>
        </div>
        <div className="space-y-1.5 p-4">
          {[
            ["Repuestos", montos.repuestos],
            ["Mano de obra", montos.mano],
            montos.revision > 0 ? ["Valor revisión", montos.revision] : null,
            montos.descuento > 0 ? ["Descuento", -montos.descuento] : null,
            montos.iva > 0 ? [`IVA ${montos.ivaPct}%`, montos.iva] : null,
          ]
            .filter(Boolean)
            .map(([l, v]) => (
              <div key={l} className="flex justify-between text-sm">
                <span style={{ color: "hsl(var(--muted-foreground))" }}>
                  {l}
                </span>
                <span
                  className="font-mono tabular-nums"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {formatCOP(v)}
                </span>
              </div>
            ))}
          <div
            className="flex justify-between border-t pt-1.5 text-sm font-semibold"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <span style={{ color: "hsl(var(--foreground))" }}>{TX.total}</span>
            <span
              className="font-mono tabular-nums"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {formatCOP(montos.total)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span style={{ color: "hsl(var(--muted-foreground))" }}>
              {TX.anticipos}
            </span>
            <span
              className="font-mono tabular-nums"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {formatCOP(montos.anticipos)}
            </span>
          </div>
          <div className="flex justify-between text-sm font-semibold">
            <span style={{ color: "hsl(var(--foreground))" }}>{TX.saldo}</span>
            <span
              className="font-mono tabular-nums"
              style={{
                color: saldoCubierto
                  ? "hsl(var(--success))"
                  : "hsl(var(--foreground))",
              }}
            >
              {formatCOP(montos.saldo)}
            </span>
          </div>
        </div>
      </div>

      {/* Cliente / equipo */}
      <div className="rounded-xl border overflow-hidden" style={card}>
        <div
          className="px-4 py-3 border-b"
          style={{ borderColor: "hsl(var(--border))", ...sectionHeaderBg }}
        >
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Cliente y equipo
          </p>
        </div>
        <div className="space-y-2 p-4 text-sm">
          <div
            className="flex items-center gap-2"
            style={{ color: "hsl(var(--foreground))" }}
          >
            <User
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: "hsl(var(--muted-foreground))" }}
            />
            <span className="font-medium">{orden.cliente_nombre || "—"}</span>
          </div>
          {orden.cliente_telefono && (
            <div
              className="flex items-center gap-2 font-mono text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              <Phone className="h-3.5 w-3.5 shrink-0" />
              {orden.cliente_telefono}
            </div>
          )}
          <div
            className="flex items-center gap-2"
            style={{ color: "hsl(var(--foreground))" }}
          >
            <Wrench
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: "hsl(var(--muted-foreground))" }}
            />
            <span>{orden.equipo_descripcion || "—"}</span>
          </div>
          {orden.equipo_serie && (
            <div
              className="flex items-center gap-2 font-mono text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              <Hash className="h-3.5 w-3.5 shrink-0" />
              {orden.equipo_serie}
            </div>
          )}
        </div>
      </div>

      {/* Técnico */}
      <TecnicoSidebarBlock orden={orden} updateOrden={updateOrden} ro={ro} />

      {/* Historial */}
      <div className="rounded-xl border overflow-hidden" style={card}>
        <div
          className="px-4 py-3 border-b flex items-center gap-2"
          style={{ borderColor: "hsl(var(--border))", ...sectionHeaderBg }}
        >
          <Activity
            className="h-3.5 w-3.5"
            style={{ color: "hsl(var(--muted-foreground))" }}
          />
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Historial
          </p>
        </div>
        <div className="p-4">
          {historial.length === 0 ? (
            <p
              className="text-xs italic"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Sin eventos registrados
            </p>
          ) : (
            <ul className="space-y-2.5">
              {historial.map((h, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        h.tone === "succ"
                          ? "hsl(var(--success))"
                          : h.tone === "info"
                            ? "hsl(var(--info))"
                            : "hsl(var(--muted-foreground))",
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className="font-medium"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {h.act}
                    </div>
                    {h.meta && (
                      <div
                        className="truncate text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {h.meta}
                      </div>
                    )}
                    {h.time && (
                      <div
                        className="text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {h.time}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
