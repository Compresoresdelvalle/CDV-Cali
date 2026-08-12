import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Wallet,
  RefreshCw,
  Landmark,
  Package,
  ArrowDownCircle,
  Info,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import { useAuthStore } from "../../stores/authStore";
import { PRESETS_FECHA } from "../../lib/filtros";
import { SEDE_LABEL } from "../../lib/ot-flujo";

/**
 * Cierre de caja para VENDEDORAS — solo lectura, solo SU sede.
 *
 * Reusa `fn_preview_cierre`, que para el rol Vendedor fuerza la sede a la suya
 * (no puede ver otras aunque manipule el parámetro). No sella nada, no captura
 * arqueo: es para que vea "cuánto debería tener" en efectivo y el detalle de
 * los movimientos del periodo. Generar/sellar sigue siendo solo del Admin.
 */
const PRESETS = [
  { id: "hoy", label: "Hoy" },
  { id: "semana", label: "Esta semana" },
  { id: "mes", label: "Este mes" },
];

const METODO_LABEL = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  otro: "Otro",
};

export default function CierreCajaVendedor() {
  const perfil = useAuthStore((s) => s.perfil);
  const sedeNombre =
    SEDE_LABEL[perfil?.sede_id] ?? perfil?.sede_id ?? "tu sede";

  const [preset, setPreset] = useState("hoy");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const rango = useMemo(() => {
    const { desdeDia, hastaDia } = PRESETS_FECHA[preset].calcular();
    return { desde: desdeDia, hasta: hastaDia };
  }, [preset]);

  const cargar = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      // El backend fuerza la sede de la vendedora; no se manda p_sede.
      const { data: r, error } = await supabase.rpc("fn_preview_cierre", {
        p_desde: rango.desde,
        p_hasta: rango.hasta,
      });
      if (error) throw error;
      setData(r);
    } catch (err) {
      setErrorMsg(safeError(err, "No se pudo cargar el cierre de tu sede"));
    } finally {
      setLoading(false);
    }
  }, [rango]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const d = data?.detalle ?? {};
  const efectivoEsperado = (d.arqueo_esperado ?? []).reduce(
    (s, a) => s + Number(a.efectivo_esperado || 0),
    0,
  );
  const porMetodo = d.por_metodo_pago ?? [];
  const egresos = d.egresos_detalle ?? [];
  const productos = d.por_producto ?? [];

  const num = (v) => Number(v || 0);

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 py-5 sm:px-7 sm:py-6">
      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p
            className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em]"
            style={{ color: "var(--n-500)" }}
          >
            Caja · {sedeNombre}
          </p>
          <h1
            className="m-0 text-[22px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--n-950)" }}
          >
            Cierre de caja
          </h1>
        </div>
        <button
          onClick={cargar}
          disabled={loading}
          className="btn btn-out shrink-0 disabled:opacity-50"
          style={{ height: 44 }}
        >
          <RefreshCw
            className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            strokeWidth={2}
          />
          Actualizar
        </button>
      </div>

      {/* Aviso solo-lectura */}
      <div
        className="mt-3 flex items-start gap-2 rounded-[10px] border px-4 py-2.5 text-[12.5px]"
        style={{
          backgroundColor: "var(--n-25)",
          borderColor: "var(--n-150)",
          color: "var(--n-700)",
        }}
      >
        <Info
          className="mt-0.5 h-4 w-4 shrink-0"
          style={{ color: "var(--p-600)" }}
        />
        <span>
          Solo lectura: aquí ves cuánto <b>deberías tener</b> y los movimientos
          de <b>{sedeNombre}</b>. El cierre lo sella la Administración.
        </span>
      </div>

      {/* Presets de fecha */}
      <div className="mt-4 flex gap-1.5">
        {PRESETS.map((p) => {
          const on = preset === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className="h-10 rounded-lg border px-3.5 text-[13px] font-medium cursor-pointer transition-colors"
              style={{
                borderColor: on ? "var(--p-600)" : "var(--n-150)",
                backgroundColor: on ? "var(--p-600)" : "transparent",
                color: on ? "#fff" : "var(--n-700)",
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="mt-4 rounded-[10px] border px-4 py-3 text-sm"
          style={{
            backgroundColor: "var(--dang-50)",
            borderColor: "var(--dang-border)",
            color: "var(--dang-700)",
          }}
        >
          {errorMsg}
        </div>
      )}

      {loading && !data ? (
        <div className="mt-4 space-y-3">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-[10px] border"
              style={{
                backgroundColor: "var(--n-0)",
                borderColor: "var(--n-150)",
              }}
            />
          ))}
        </div>
      ) : (
        data && (
          <>
            {/* ── Efectivo que deberías tener ─────────────────────────── */}
            <div
              className="mt-4 rounded-[12px] border p-5"
              style={{
                backgroundColor: "var(--succ-50, var(--n-25))",
                borderColor: "var(--succ-border, var(--n-150))",
              }}
            >
              <div className="flex items-center gap-2">
                <Wallet
                  className="h-4 w-4"
                  style={{ color: "var(--succ-700)" }}
                />
                <span
                  className="font-mono text-[11px] font-medium uppercase tracking-[0.08em]"
                  style={{ color: "var(--succ-700)" }}
                >
                  Efectivo que deberías tener en caja
                </span>
              </div>
              <p
                className="mt-1.5 font-mono text-[30px] font-semibold leading-none tabular-nums"
                style={{ color: "var(--succ-700)" }}
              >
                {formatCOP(efectivoEsperado)}
              </p>
              <p className="mt-2 text-[12px]" style={{ color: "var(--n-500)" }}>
                Es el efectivo del periodo que aún no se ha cerrado. Con esto
                cuadras físicamente la caja.
              </p>
            </div>

            {/* ── KPIs del periodo ────────────────────────────────────── */}
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
              <Kpi label="Ingresos totales" valor={num(data.ingresos_total)} />
              <Kpi
                label="Ventas (productos)"
                valor={num(data.ingresos_productos)}
              />
              <Kpi
                label="Servicios (OT)"
                valor={num(data.ingresos_servicios)}
              />
              <Kpi
                label="Anticipos recibidos"
                valor={num(data.anticipos_recibidos)}
              />
              <Kpi label="Egresos" valor={num(data.egresos)} tono="warn" />
              <Kpi label="Margen" valor={num(data.margen)} />
            </div>

            {/* ── Por método de pago ──────────────────────────────────── */}
            <Section icon={Landmark} titulo="Ingresos por método de pago">
              {porMetodo.length === 0 ? (
                <Vacio>Sin ingresos en el periodo.</Vacio>
              ) : (
                <Tabla
                  cols={["Método", "Productos", "Servicios", "Total"]}
                  right={[false, true, true, true]}
                  filas={porMetodo.map((m) => [
                    METODO_LABEL[m.metodo] ?? m.metodo,
                    formatCOP(num(m.productos)),
                    formatCOP(num(m.servicios)),
                    formatCOP(num(m.productos) + num(m.servicios)),
                  ])}
                />
              )}
            </Section>

            {/* ── Egresos ─────────────────────────────────────────────── */}
            <Section
              icon={ArrowDownCircle}
              titulo="Egresos (compras y caja menor)"
            >
              {egresos.length === 0 ? (
                <Vacio>Sin egresos en el periodo.</Vacio>
              ) : (
                <Tabla
                  cols={["Fecha", "Proveedor / concepto", "Método", "Total"]}
                  right={[false, false, false, true]}
                  filas={egresos.map((e) => [
                    formatDate(e.fecha),
                    e.proveedor || e.concepto || "—",
                    (METODO_LABEL[e.metodo] ?? e.metodo ?? "—") +
                      (e.es_caja_menor ? " · caja menor" : ""),
                    formatCOP(num(e.total)),
                  ])}
                />
              )}
            </Section>

            {/* ── Productos vendidos ──────────────────────────────────── */}
            <Section icon={Package} titulo="Productos vendidos">
              {productos.length === 0 ? (
                <Vacio>Sin productos vendidos en el periodo.</Vacio>
              ) : (
                <Tabla
                  cols={["Producto", "Unid.", "Ingreso"]}
                  right={[false, true, true]}
                  filas={productos.map((p) => [
                    `${p.nombre}${p.referencia ? ` · ${p.referencia}` : ""}`,
                    String(num(p.unidades)),
                    formatCOP(num(p.ingreso)),
                  ])}
                />
              )}
            </Section>
          </>
        )
      )}
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function Kpi({ label, valor, tono }) {
  const color = tono === "warn" ? "var(--warn-700)" : "var(--n-950)";
  return (
    <div
      className="rounded-[10px] border p-3.5"
      style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
    >
      <p
        className="font-mono text-[10.5px] font-medium uppercase tracking-[0.06em]"
        style={{ color: "var(--n-500)" }}
      >
        {label}
      </p>
      <p
        className="mt-1 font-mono text-[16px] font-semibold tabular-nums"
        style={{ color }}
      >
        {formatCOP(valor)}
      </p>
    </div>
  );
}

function Section({ icon: Icon, titulo, children }) {
  return (
    <section
      className="mt-4 overflow-hidden rounded-[10px] border"
      style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
    >
      <div
        className="flex items-center gap-2 border-b px-4 py-2.5"
        style={{ borderColor: "var(--n-150)" }}
      >
        <Icon className="h-3.5 w-3.5" style={{ color: "var(--n-500)" }} />
        <span
          className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
          style={{ color: "var(--n-500)" }}
        >
          {titulo}
        </span>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Tabla({ cols, right = [], filas }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th
                key={c}
                className={`whitespace-nowrap px-2.5 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.08em] ${
                  right[i] ? "text-right" : "text-left"
                }`}
                style={{ color: "var(--n-500)" }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, ri) => (
            <tr
              key={ri}
              className="border-t"
              style={{ borderColor: "var(--n-100)" }}
            >
              {f.map((celda, ci) => (
                <td
                  key={ci}
                  className={`px-2.5 py-2 align-top ${
                    right[ci]
                      ? "text-right font-mono tabular-nums"
                      : "text-left"
                  }`}
                  style={{
                    color: right[ci] ? "var(--n-900)" : "var(--n-700)",
                  }}
                >
                  {celda}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Vacio({ children }) {
  return (
    <p
      className="px-1 py-3 text-center text-[12.5px]"
      style={{ color: "var(--n-400)" }}
    >
      {children}
    </p>
  );
}
