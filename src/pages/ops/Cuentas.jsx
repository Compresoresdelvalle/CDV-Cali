import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Wallet,
  HandCoins,
  Receipt,
  FileText,
  CircleDollarSign,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../stores/authStore";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import {
  estadoCuenta,
  sedeLabelCuenta,
  SEDE_LABELS_CUENTAS,
} from "../../lib/cuentas-ui";
import PagoCuentaModal from "../../components/cuentas/PagoCuentaModal";
import { useFiltros } from "../../hooks/useFiltros";
import BarraFiltros from "../../components/filtros/BarraFiltros";

/**
 * B10 — Cuentas por cobrar (ventas a crédito) y por pagar (compras a crédito).
 * Solo Admin. Lee las vistas `v_cuentas_por_cobrar` / `v_cuentas_por_pagar`
 * (saldo ya neto de abonos de cotización) y registra cobros/pagos por modal.
 */

const PAGE_SIZE = 50;
/** Tope del agregado de dinero. Si se alcanza, el KPI se rotula como parcial. */
const KPI_CAP = 5000;

const SEDES_OPCIONES = Object.entries(SEDE_LABELS_CUENTAS).map(([v, l]) => ({
  v,
  l,
}));

/**
 * Estado de cuenta: NO es una columna, se deriva de saldo vs total. Como
 * `saldo = total - abonado` en ambas vistas, "parcial" equivale a "abonado > 0",
 * y eso sí se puede preguntar en el servidor sin comparar columna contra columna
 * (PostgREST no sabe hacerlo). Mismos umbrales que `estadoCuenta()`.
 */
const ESTADOS_CUENTA = [
  { v: "conSaldo", l: "Con saldo" },
  { v: "pendiente", l: "Pendiente" },
  { v: "parcial", l: "Parcial" },
  { v: "saldada", l: "Saldada" },
  { v: "todas", l: "Todas" },
];

function aplicarEstadoCuenta(q, estado, esCobrar) {
  switch (estado) {
    case "conSaldo":
      return q.gt("saldo", 0);
    case "saldada":
      return q.lte("saldo", 0.01);
    case "pendiente":
      // Sin un solo peso abonado.
      return esCobrar
        ? q
            .gt("saldo", 0.01)
            .lte("abonos_cotizacion", 0.01)
            .lte("pagos_directos", 0.01)
        : q.gt("saldo", 0.01).lte("pagos", 0.01);
    case "parcial":
      // Algo abonado, pero todavía debe.
      return esCobrar
        ? q
            .gt("saldo", 0.01)
            .or("abonos_cotizacion.gt.0.01,pagos_directos.gt.0.01")
        : q.gt("saldo", 0.01).gt("pagos", 0.01);
    default:
      return q; // 'todas'
  }
}

export default function Cuentas() {
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";
  const esBodeguero = perfil?.rol === "Bodeguero";
  /** Qué pestañas ve cada rol. No es cosmético: el servidor rechaza a un
   *  vendedor que intente registrar un pago a proveedor y a un bodeguero que
   *  intente un cobro, así que enseñar la pestaña que no toca sería ofrecer
   *  algo que va a fallar. El caso por defecto es "cobrar" —lo del vendedor—
   *  porque RoleGuard ya impide que llegue aquí cualquier otro rol. */
  const tabsPermitidos = esAdmin
    ? ["cobrar", "pagar"]
    : esBodeguero
      ? ["pagar"]
      : ["cobrar"];

  const [tab, setTab] = useState(tabsPermitidos[0]); // 'cobrar' | 'pagar'
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0); // count exacto del filtro
  // #S3-12: los KPIs de cartera se calculan sobre TODOS los documentos del
  // filtro, no solo sobre la página que se muestra (antes subestimaban en silencio).
  const [kpi, setKpi] = useState({ saldo: 0, total: 0, parcial: false });
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [estadoCta, setEstadoCta] = useState("conSaldo");
  const [modalCuenta, setModalCuenta] = useState(null);
  const [page, setPage] = useState(0);

  const esCobrar = tab === "cobrar";

  // Dos juegos de filtros: las vistas no son simétricas (cliente_nombre/sede_id
  // contra proveedor/sede_destino_id), y así cada pestaña recuerda lo suyo.
  //
  // `campos` DEBE ir memoizado. useFiltros deriva de él `visibles` -> `aplicar`
  // -> y la pantalla mete `f.aplicar` en las dependencias de `cargar`. Con un
  // array literal nuevo en cada render, `aplicar` cambia de referencia siempre,
  // `cargar` también, y el useEffect([cargar]) se dispara en bucle infinito:
  // la carga nunca se asienta y la pantalla queda congelada en "…". Es la misma
  // trampa que ya advierten CotizacionHistorial y DevolucionHistorial.
  const camposCobrar = useMemo(
    () => [
      {
        id: "q",
        tipo: "texto",
        label: "Buscar",
        columnas: ["cliente_nombre"],
        numericoA: "numero",
      },
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
        opciones: SEDES_OPCIONES,
      },
    ],
    [],
  );
  const fCobrar = useFiltros({ clave: "cuentas-cobrar", campos: camposCobrar });

  const camposPagar = useMemo(
    () => [
      {
        id: "q",
        tipo: "texto",
        label: "Buscar",
        columnas: ["proveedor"],
        numericoA: "numero",
      },
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
        columna: "sede_destino_id",
        opciones: SEDES_OPCIONES,
      },
    ],
    [],
  );
  const fPagar = useFiltros({ clave: "cuentas-pagar", campos: camposPagar });

  const f = esCobrar ? fCobrar : fPagar;
  const fOtra = esCobrar ? fPagar : fCobrar;

  // Resetear la página en CADA cambio de filtro, pestaña o estado, sin disparar
  // un fetch de más (patrón "ajustar estado durante el render" de React).
  const filtroKey = useMemo(
    () => JSON.stringify([tab, estadoCta, f.valoresAplicados]),
    [tab, estadoCta, f.valoresAplicados],
  );
  const [filtroKeyPrev, setFiltroKeyPrev] = useState(filtroKey);
  if (filtroKeyPrev !== filtroKey) {
    setFiltroKeyPrev(filtroKey);
    setPage(0);
  }

  const cargar = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    const reqId = f.nuevoReqId();
    // Cada pestaña tiene su propio token de secuencia, así que una respuesta en
    // vuelo de la OTRA pestaña seguiría pasando su propio `esReqVigente` y
    // pintaría filas del tab equivocado (con el id de la otra vista). Al cambiar
    // de pestaña se invalida también lo que quedó en vuelo allá.
    fOtra.nuevoReqId();
    try {
      const vista = esCobrar ? "v_cuentas_por_cobrar" : "v_cuentas_por_pagar";
      const desde = page * PAGE_SIZE;

      let q = supabase.from(vista).select("*", { count: "exact" });
      q = f.aplicar(q);
      q = aplicarEstadoCuenta(q, estadoCta, esCobrar);
      q = q
        .order("fecha", { ascending: false })
        .order("numero", { ascending: false })
        .range(desde, desde + PAGE_SIZE - 1);
      const { data, error, count } = await q;
      if (error) throw error;
      if (!f.esReqVigente(reqId)) return;
      setRows(data ?? []);
      setTotal(count ?? 0);

      // KPIs sobre el universo del filtro (solo saldo/total, ligero).
      let kq = supabase.from(vista).select("saldo, total");
      kq = f.aplicar(kq);
      kq = aplicarEstadoCuenta(kq, estadoCta, esCobrar);
      const { data: kdata, error: kerr } = await kq.limit(KPI_CAP);
      if (!f.esReqVigente(reqId)) return;
      if (!kerr && kdata) {
        setKpi({
          saldo: kdata.reduce((s, r) => s + Number(r.saldo ?? 0), 0),
          total: kdata.reduce((s, r) => s + Number(r.total ?? 0), 0),
          parcial: kdata.length >= KPI_CAP,
        });
      }
    } catch (err) {
      if (!f.esReqVigente(reqId)) return;
      setErrorMsg(safeError(err, "Error al cargar cuentas"));
    } finally {
      setLoading(false);
    }
    // `filtroKey` representa tab/estado/valores aplicados: es la dependencia real.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filtroKey,
    page,
    f.aplicar,
    f.nuevoReqId,
    f.esReqVigente,
    fOtra.nuevoReqId,
  ]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const totalSaldo = kpi.saldo;
  const totalDoc = kpi.total;
  const paginas = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const abrirModal = (r) => {
    setModalCuenta({
      tipo: esCobrar ? "cobro" : "pago",
      refId: esCobrar ? r.venta_id : r.compra_id,
      numero: r.numero,
      contraparte: esCobrar ? r.cliente_nombre : r.proveedor,
      total: Number(r.total ?? 0),
      abonosCotizacion: esCobrar ? Number(r.abonos_cotizacion ?? 0) : 0,
    });
  };

  return (
    <div className="flex flex-col gap-6 px-5 pb-8 pt-6 sm:px-7 animate-fade-in">
      {/* Page head */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="m-0 mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Admin · Cartera
          </p>
          <h1
            className="m-0 text-[24px] font-semibold leading-tight tracking-[-0.018em]"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Cuentas por cobrar y pagar
          </h1>
          <p
            className="mt-1 text-[13px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Ventas y compras a crédito pendientes de saldar.
          </p>
        </div>
      </div>

      {/* Tabs CxC / CxP — con una sola pestaña permitida no se dibujan:
          una pestaña única es ruido, no información. */}
      {tabsPermitidos.length > 1 && (
        <div
          className="inline-flex w-full max-w-md rounded-lg border p-1"
          style={{
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--muted) / 0.3)",
          }}
          role="tablist"
        >
          {[
            { id: "cobrar", label: "Por cobrar", icon: HandCoins },
            { id: "pagar", label: "Por pagar", icon: Receipt },
          ]
            .filter((t) => tabsPermitidos.includes(t.id))
            .map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md text-[13px] font-semibold transition-colors cursor-pointer"
                  style={{
                    backgroundColor: active
                      ? "hsl(var(--card))"
                      : "transparent",
                    color: active
                      ? "hsl(var(--foreground))"
                      : "hsl(var(--muted-foreground))",
                    boxShadow: active
                      ? "0 1px 2px hsl(0 0% 0% / 0.08)"
                      : "none",
                  }}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                  {t.label}
                </button>
              );
            })}
        </div>
      )}

      {/* Búsqueda + filtros cruzables (server-side) */}
      <BarraFiltros
        key={tab}
        filtros={f}
        placeholder={esCobrar ? "Buscar # o cliente…" : "Buscar # o proveedor…"}
      />

      {/* Estado de cuenta — derivado de saldo vs total, aplicado en el servidor */}
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label="Estado de cuenta"
      >
        {ESTADOS_CUENTA.map((e) => {
          const active = estadoCta === e.v;
          return (
            <button
              key={e.v}
              type="button"
              aria-pressed={active}
              onClick={() => setEstadoCta(e.v)}
              className="inline-flex h-11 items-center rounded-full border px-4 text-[12.5px] font-medium transition-colors cursor-pointer"
              style={{
                backgroundColor: active
                  ? "hsl(var(--primary))"
                  : "hsl(var(--card))",
                color: active
                  ? "hsl(var(--primary-foreground))"
                  : "hsl(var(--muted-foreground))",
                borderColor: active
                  ? "hsl(var(--primary))"
                  : "hsl(var(--border))",
              }}
            >
              {e.l}
            </button>
          );
        })}
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

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi
          label={esCobrar ? "Total por cobrar" : "Total por pagar"}
          value={loading ? "…" : formatCOP(totalSaldo)}
          sub={
            (esCobrar ? "Saldo de clientes" : "Saldo a proveedores") +
            (kpi.parcial ? ` · primeros ${KPI_CAP}` : "")
          }
          token={esCobrar ? "--success" : "--destructive"}
          icon={CircleDollarSign}
        />
        <Kpi
          label="Documentos"
          value={loading ? "…" : total}
          sub="Total del filtro"
          icon={FileText}
        />
        <Kpi
          label="Valor documentos"
          value={loading ? "…" : formatCOP(totalDoc)}
          sub={
            "Total facturado del filtro" +
            (kpi.parcial ? ` · primeros ${KPI_CAP}` : "")
          }
          icon={Wallet}
        />
      </div>

      {loading ? (
        <SkeletonList />
      ) : rows.length === 0 ? (
        <Empty icon="💸">
          {f.hayFiltros || estadoCta !== "todas"
            ? "Ningún documento coincide con los filtros."
            : `Sin cuentas ${esCobrar ? "por cobrar" : "por pagar"}.`}
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
                  {[
                    esCobrar ? "Venta" : "Compra",
                    esCobrar ? "Cliente" : "Proveedor",
                    "Sede",
                    "Fecha",
                    "Total",
                    "Saldo",
                    "Estado",
                    "",
                  ].map((c, i) => (
                    <th
                      key={c || i}
                      className={`px-3 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] ${
                        i === 4 || i === 5 ? "text-right" : "text-left"
                      }`}
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const est = estadoCuenta(r.saldo, r.total);
                  const id = esCobrar ? r.venta_id : r.compra_id;
                  const sede = esCobrar ? r.sede_id : r.sede_destino_id;
                  return (
                    <tr
                      key={id}
                      className="border-t"
                      style={{ borderColor: "hsl(var(--border) / 0.6)" }}
                    >
                      <td
                        className="px-3 py-3 font-mono text-[12px] font-semibold"
                        style={{ color: "hsl(var(--primary))" }}
                      >
                        #{r.numero}
                      </td>
                      <td className="px-3 py-3">
                        <p
                          className="text-[13px] font-medium"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {(esCobrar ? r.cliente_nombre : r.proveedor) || "—"}
                        </p>
                      </td>
                      <td
                        className="px-3 py-3 text-[12px]"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {sedeLabelCuenta(sede)}
                      </td>
                      <td
                        className="px-3 py-3 font-mono text-[11.5px]"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {formatDate(r.fecha)}
                      </td>
                      <td
                        className="px-3 py-3 text-right font-mono text-[12px] tabular-nums"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {formatCOP(r.total)}
                      </td>
                      <td
                        className="px-3 py-3 text-right font-mono text-[13px] font-bold tabular-nums"
                        style={{
                          color:
                            Number(r.saldo) > 0
                              ? "hsl(var(--foreground))"
                              : "hsl(var(--muted-foreground))",
                        }}
                      >
                        {formatCOP(r.saldo)}
                      </td>
                      <td className="px-3 py-3">
                        <EstadoBadge est={est} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          onClick={() => abrirModal(r)}
                          className="inline-flex h-9 items-center gap-1 rounded-md border px-3 text-[12px] font-semibold cursor-pointer transition-colors"
                          style={{
                            borderColor: "hsl(var(--primary) / 0.4)",
                            color: "hsl(var(--primary))",
                          }}
                        >
                          {esCobrar ? "Cobrar" : "Pagar"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="divide-y md:hidden" role="list">
            {rows.map((r) => {
              const est = estadoCuenta(r.saldo, r.total);
              const id = esCobrar ? r.venta_id : r.compra_id;
              const sede = esCobrar ? r.sede_id : r.sede_destino_id;
              return (
                <li
                  key={id}
                  className="px-4 py-3.5"
                  style={{ borderColor: "hsl(var(--border))" }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p
                          className="font-mono text-sm font-bold"
                          style={{ color: "hsl(var(--primary))" }}
                        >
                          #{r.numero}
                        </p>
                        <EstadoBadge est={est} />
                      </div>
                      <p
                        className="text-sm font-medium"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {(esCobrar ? r.cliente_nombre : r.proveedor) || "—"}
                      </p>
                      <p
                        className="text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {sedeLabelCuenta(sede)} · {formatDate(r.fecha)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className="text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        Total: {formatCOP(r.total)}
                      </p>
                      <p
                        className="font-mono text-base font-bold tabular-nums"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {formatCOP(r.saldo)}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => abrirModal(r)}
                    className="mt-2.5 flex h-11 w-full items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold cursor-pointer"
                    style={{
                      backgroundColor: "hsl(var(--primary))",
                      color: "hsl(var(--primary-foreground))",
                    }}
                  >
                    {esCobrar ? "Registrar cobro" : "Registrar pago"}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Conteo honesto: lo que se ve, sobre el total real del filtro. */}
          <footer
            className="flex flex-wrap items-center justify-between gap-3 border-t px-[18px] py-3 font-mono text-[10.5px] tracking-[0.06em]"
            style={{
              borderColor: "hsl(var(--border))",
              backgroundColor: "hsl(var(--muted) / 0.3)",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            <span>
              {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + rows.length} de {total}{" "}
              cuenta(s) · saldo del filtro{" "}
              <span
                style={{
                  color: esCobrar
                    ? "hsl(var(--success))"
                    : "hsl(var(--destructive))",
                }}
              >
                {formatCOP(totalSaldo)}
              </span>
              {kpi.parcial && ` (primeros ${KPI_CAP})`}
            </span>

            {paginas > 1 && (
              <span className="flex items-center gap-2">
                <PagerBtn
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  Anterior
                </PagerBtn>
                <span>
                  {page + 1} / {paginas}
                </span>
                <PagerBtn
                  onClick={() => setPage((p) => Math.min(paginas - 1, p + 1))}
                  disabled={page >= paginas - 1}
                >
                  Siguiente
                </PagerBtn>
              </span>
            )}
          </footer>
        </section>
      )}

      {modalCuenta && (
        <PagoCuentaModal
          cuenta={modalCuenta}
          onClose={() => setModalCuenta(null)}
          onChanged={cargar}
        />
      )}
    </div>
  );
}

/* ── Subcomponentes ───────────────────────────────────────────────────── */

/**
 * Botón de paginación (Anterior / Siguiente).
 *
 * Se usaba sin estar definido: la pantalla reventaba al aparecer la segunda
 * página. Ni ESLint ni el build lo detectan (un componente JSX sin definir solo
 * falla en tiempo de ejecución), así que el error solo se veía usando la app.
 */
function PagerBtn({ onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-12 min-w-[48px] items-center rounded-lg border px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
        color: "hsl(var(--foreground))",
      }}
    >
      {children}
    </button>
  );
}

function EstadoBadge({ est }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
      style={{
        backgroundColor: `hsl(var(${est.token}) / 0.12)`,
        color: `hsl(var(${est.token}))`,
      }}
    >
      {est.label}
    </span>
  );
}

function Kpi({ label, value, sub, token, icon: Icon }) {
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
        className="mt-2 truncate font-mono text-[20px] font-semibold leading-tight tracking-[-0.02em] tabular-nums"
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
      {[...Array(5)].map((_, i) => (
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
