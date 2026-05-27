import { useState, useEffect, useRef } from "react";
import {
  ClipboardCheck,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Target,
  Scale,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import {
  formatDate,
  formatCOP,
  sanitizeSearch,
  safeError,
} from "../../lib/utils";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import {
  diferenciaToken,
  clasePillStyle,
  pillStyle,
  surfaceInputStyle,
} from "../../lib/admin-ops-ui";

const FILTROS = ["Todos", "Pendientes", "Aplicados"];

export default function Conteo() {
  const perfil = useAuthStore((s) => s.perfil);
  const isAdmin = perfil?.rol === "Admin";

  const [conteos, setConteos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [filtro, setFiltro] = useState("Pendientes");
  const [modalNuevo, setModalNuevo] = useState(false);
  const [aplicandoId, setAplicandoId] = useState(null);
  const mountedRef = useRef(true);
  const { confirm, ConfirmDialog } = useConfirm();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const cargar = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      let q = supabase
        .from("conteos")
        .select(
          `id, fecha, stock_sistema, stock_fisico, diferencia, ajuste_aplicado, observaciones, sede_id,
           producto:producto_id(referencia, nombre, clasificacion, costo_promedio),
           sede:sede_id(nombre),
           contador:contado_por(nombre),
           aprobador:aprobado_por(nombre)`,
        )
        .order("fecha", { ascending: false })
        .limit(100);
      if (filtro === "Pendientes") q = q.eq("ajuste_aplicado", false);
      if (filtro === "Aplicados") q = q.eq("ajuste_aplicado", true);

      const { data, error } = await q;
      if (!mountedRef.current) return;
      if (error) throw error;
      setConteos(data ?? []);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar conteos"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);

  const aplicarAjuste = async (conteo) => {
    const ok = await confirm({
      titulo: "Aplicar ajuste de inventario",
      mensaje: `Stock sistema: ${conteo.stock_sistema} → físico: ${conteo.stock_fisico} (diferencia: ${conteo.diferencia > 0 ? "+" : ""}${conteo.diferencia}). Se registrará un movimiento conteo_ajuste.`,
      confirmLabel: "Aplicar ajuste",
      danger: conteo.diferencia < 0,
    });
    if (!ok) return;
    setAplicandoId(conteo.id);
    setErrorMsg("");
    setOkMsg("");
    try {
      const { error } = await supabase.rpc("fn_aplicar_ajuste_conteo", {
        p_conteo_id: conteo.id,
      });
      if (error) throw error;
      setOkMsg("Ajuste aplicado correctamente");
      await cargar();
    } catch (err) {
      setErrorMsg(safeError(err, "Error al aplicar ajuste"));
    } finally {
      setAplicandoId(null);
    }
  };

  // KPIs derivados de la vista actual (datos reales).
  const pendientes = conteos.filter((c) => !c.ajuste_aplicado).length;
  const aplicados = conteos.filter((c) => c.ajuste_aplicado).length;
  const divergencias = conteos.filter((c) => Number(c.diferencia) !== 0).length;

  // Divergencias por ajustar: conteos pendientes con diferencia ≠ 0.
  // Valor estimado = |diferencia| × costo_promedio real del producto.
  const divPendientes = conteos.filter(
    (c) => !c.ajuste_aplicado && Number(c.diferencia) !== 0,
  );
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
      {okMsg && <Banner type="success">{okMsg}</Banner>}

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
        <span
          className="ml-auto font-mono text-[10.5px] tracking-[0.04em]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {loading ? "cargando…" : `${conteos.length} conteo(s)`}
        </span>
      </div>

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
                            style={{ color: "hsl(var(--muted-foreground))" }}
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
                          <button
                            onClick={() => aplicarAjuste(c)}
                            disabled={aplicandoId === c.id}
                            className="inline-flex h-9 items-center rounded-md px-3 text-[12px] font-semibold transition-opacity cursor-pointer hover:opacity-90 disabled:opacity-50"
                            style={{
                              backgroundColor: "hsl(var(--primary))",
                              color: "hsl(var(--primary-foreground))",
                            }}
                          >
                            {aplicandoId === c.id ? "…" : "Aplicar"}
                          </button>
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
                      <span style={{ color: "hsl(var(--muted-foreground))" }}>
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
                      <button
                        onClick={() => aplicarAjuste(c)}
                        disabled={aplicandoId === c.id}
                        className="h-11 shrink-0 rounded-lg px-4 text-xs font-semibold cursor-pointer disabled:opacity-50"
                        style={{
                          backgroundColor: "hsl(var(--primary))",
                          color: "hsl(var(--primary-foreground))",
                        }}
                      >
                        {aplicandoId === c.id ? "…" : "Aplicar"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
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

      {modalNuevo && (
        <ModalNuevoConteo
          perfil={perfil}
          onClose={() => setModalNuevo(false)}
          onSaved={async () => {
            setModalNuevo(false);
            setOkMsg("Conteo registrado");
            await cargar();
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

function ModalNuevoConteo({ perfil, onClose, onSaved }) {
  const [search, setSearch] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [productoSel, setProductoSel] = useState(null);
  const [stockSistema, setStockSistema] = useState(0);
  const [stockFisico, setStockFisico] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Búsqueda
  useEffect(() => {
    const q = sanitizeSearch(search);
    if (q.length < 2 || productoSel) {
      setResultados([]);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const { data, error } = await supabase
          .from("productos")
          .select(
            `id, referencia, nombre, inventario:inventario(id, cantidad, sede_id)`,
          )
          .eq("activo", true)
          .or(`referencia.ilike.%${q}%,nombre.ilike.%${q}%`)
          .limit(10);
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
    const inv = (p.inventario ?? []).find((i) => i.sede_id === perfil?.sede_id);
    if (!inv) {
      // Producto no tiene fila inventario en la sede del usuario.
      // Avisamos al operario en vez de continuar con stock=0 silencioso.
      setError(
        `"${p.nombre}" no tiene inventario en tu sede. Pídele a un Admin que lo agregue antes de contar.`,
      );
      return;
    }
    setError("");
    setProductoSel({ ...p, inventario_id: inv.id });
    setStockSistema(inv.cantidad ?? 0);
    setSearch("");
    setResultados([]);
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
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error("No se pudo registrar el conteo");
      await onSaved();
    } catch (err) {
      setError(safeError(err, "Error al guardar conteo"));
    } finally {
      setSaving(false);
    }
  };

  const dif = (parseInt(stockFisico, 10) || 0) - stockSistema;
  const difToken = diferenciaToken(dif);

  return (
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

        {!productoSel ? (
          <div className="space-y-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar producto por nombre o referencia (mín 2 letras)…"
              className="h-12 w-full rounded-lg border px-3 text-sm"
              style={surfaceInputStyle}
            />
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
                className="text-sm font-semibold"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {productoSel.nombre}
              </p>
              <p
                className="font-mono text-xs"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {productoSel.referencia}
              </p>
              <button
                onClick={() => setProductoSel(null)}
                className="mt-1 cursor-pointer text-xs underline"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Cambiar
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Stock sistema">
                <input
                  type="number"
                  value={stockSistema}
                  disabled
                  className="h-12 w-full rounded-lg border px-3 text-sm tabular-nums"
                  style={{ ...surfaceInputStyle, opacity: 0.7 }}
                />
              </Field>
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

            {stockFisico !== "" && (
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
