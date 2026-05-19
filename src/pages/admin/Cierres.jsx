import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import FeedbackBanners from "../../components/ui/FeedbackBanners";
import { useConfirm } from "../../components/ui/ConfirmDialog";

const METODO_LABELS = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  otro: "Otro",
};

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
  const hoy = hoyBogota();
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [tipo, setTipo] = useState("diario");
  const [observaciones, setObservaciones] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [historial, setHistorial] = useState([]);
  const [loadingHist, setLoadingHist] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
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

  const cargarHistorial = async () => {
    setLoadingHist(true);
    try {
      const { data, error } = await supabase
        .from("cierres")
        .select("*, cerrado_por:usuarios(nombre)")
        .order("numero", { ascending: false });
      if (!mountedRef.current) return;
      if (error) throw error;
      setHistorial(data ?? []);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar el histórico de cierres"));
    } finally {
      if (mountedRef.current) setLoadingHist(false);
    }
  };

  useEffect(() => {
    cargarHistorial();
  }, []);

  // Invalida cualquier previsualización en vuelo y descarta la mostrada.
  const invalidarPreview = () => {
    previewSeqRef.current += 1;
    setPreview(null);
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
    setOkMsg("");
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
    const ok = await confirm({
      titulo: "Generar cierre",
      mensaje: `Se generará un cierre ${tipo} del ${fmtFecha(desde)} al ${fmtFecha(
        hasta,
      )} por ${formatCOP(Number(preview.ingresos_total))}. Una vez guardado es inmutable y no podrá editarse ni borrarse.`,
      confirmLabel: "Generar cierre",
    });
    if (!ok) {
      generandoRef.current = false;
      return;
    }
    setErrorMsg("");
    setOkMsg("");
    setGenerating(true);
    try {
      const { data, error } = await supabase.rpc("fn_generar_cierre", {
        p_desde: desde,
        p_hasta: hasta,
        p_tipo: tipo,
        p_observaciones: observaciones.trim() || null,
      });
      if (!mountedRef.current) return;
      if (error) throw error;
      setOkMsg(`Cierre #${data?.numero ?? ""} generado correctamente`);
      setPreview(null);
      setObservaciones("");
      await cargarHistorial();
    } catch (err) {
      if (mountedRef.current) {
        setErrorMsg(safeError(err, "Error al generar el cierre"));
      }
    } finally {
      generandoRef.current = false;
      if (mountedRef.current) setGenerating(false);
    }
  };

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Cierres"
        description="Cierre de caja diario o por periodo — ingresos, egresos y margen del negocio"
      />

      <FeedbackBanners errorMsg={errorMsg} okMsg={okMsg} />

      {/* ── Generador ─────────────────────────────────────────────── */}
      <SectionCard title="Generar cierre">
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
                backgroundColor: "hsl(var(--destructive) / 0.08)",
                borderColor: "hsl(var(--destructive) / 0.4)",
                color: "hsl(var(--destructive))",
              }}
            >
              Este rango solapa el/los cierre(s){" "}
              {(preview.solapamiento ?? []).map((n) => `#${n}`).join(", ")}. No
              puede generarse un cierre con fechas ya cubiertas.
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

          {preview.detalle?.por_sede?.length > 0 && (
            <div className="mt-4">
              <DetalleCierre detalle={preview.detalle} />
            </div>
          )}

          <div className="flex justify-end pt-4">
            <button
              onClick={generar}
              disabled={generating || preview.ya_cubierto}
              className="h-12 px-5 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
              style={{
                backgroundColor: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
              }}
            >
              {generating ? "Generando…" : "Generar cierre"}
            </button>
          </div>
        </SectionCard>
      )}

      {/* ── Histórico ─────────────────────────────────────────────── */}
      <SectionCard
        title={`Histórico de cierres${
          loadingHist ? "" : ` (${historial.length})`
        }`}
      >
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
            </ul>
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
        className="text-base font-bold tabular-nums truncate"
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
        <td
          className="px-3 py-2 capitalize"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {c.tipo}
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
            <DetalleCierre detalle={c.detalle} />
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
          <DetalleCierre detalle={c.detalle} />
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

function DetalleCierre({ detalle }) {
  const porSede = detalle?.por_sede ?? [];
  const porMetodo = detalle?.por_metodo_pago ?? [];
  if (porSede.length === 0 && porMetodo.length === 0) return null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {porSede.length > 0 && (
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
      )}
      {porMetodo.length > 0 && (
        <MiniTable
          titulo="Por método de pago"
          cols={["Método", "Productos", "Servicios"]}
          rows={porMetodo.map((m) => [
            METODO_LABELS[m.metodo] ?? m.metodo,
            formatCOP(Number(m.productos)),
            formatCOP(Number(m.servicios)),
          ])}
        />
      )}
    </div>
  );
}

function MiniTable({ titulo, cols, rows }) {
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
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr style={{ color: "hsl(var(--muted-foreground))" }}>
            {cols.map((col, i) => (
              <th
                key={col}
                className={`px-3 py-1.5 font-medium ${
                  i === 0 ? "text-left" : "text-right"
                }`}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              className="border-t"
              style={{ borderColor: "hsl(var(--border))" }}
            >
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={`px-3 py-1.5 tabular-nums ${
                    ci === 0 ? "text-left" : "text-right"
                  }`}
                  style={{
                    color:
                      ci === 0
                        ? "hsl(var(--foreground))"
                        : "hsl(var(--muted-foreground))",
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
