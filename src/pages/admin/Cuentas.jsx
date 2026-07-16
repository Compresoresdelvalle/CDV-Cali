import { useState, useEffect, useCallback } from "react";
import {
  Wallet,
  HandCoins,
  Receipt,
  FileText,
  CircleDollarSign,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import { estadoCuenta, sedeLabelCuenta } from "../../lib/cuentas-ui";
import PagoCuentaModal from "../../components/cuentas/PagoCuentaModal";

/**
 * B10 — Cuentas por cobrar (ventas a crédito) y por pagar (compras a crédito).
 * Solo Admin. Lee las vistas `v_cuentas_por_cobrar` / `v_cuentas_por_pagar`
 * (saldo ya neto de abonos de cotización) y registra cobros/pagos por modal.
 */
export default function Cuentas() {
  const [tab, setTab] = useState("cobrar"); // 'cobrar' | 'pagar'
  const [rows, setRows] = useState([]);
  // #S3-12: los KPIs de cartera se calculan sobre TODOS los documentos, no solo
  // sobre las 300 filas que se muestran en la lista (antes subestimaban en silencio).
  const [kpi, setKpi] = useState({ saldo: 0, total: 0, conSaldo: 0 });
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [modalCuenta, setModalCuenta] = useState(null);

  const esCobrar = tab === "cobrar";

  const cargar = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const vista = esCobrar ? "v_cuentas_por_cobrar" : "v_cuentas_por_pagar";
      let q = supabase
        .from(vista)
        .select("*")
        .order("fecha", { ascending: false })
        .limit(300);
      if (soloPendientes) q = q.gt("saldo", 0);
      const { data, error } = await q;
      if (error) throw error;
      setRows(data ?? []);

      // #S3-12: KPIs sobre el universo completo (solo columnas saldo/total, ligero).
      let kq = supabase.from(vista).select("saldo, total");
      if (soloPendientes) kq = kq.gt("saldo", 0);
      const { data: kdata, error: kerr } = await kq.limit(10000);
      if (!kerr && kdata) {
        setKpi({
          saldo: kdata.reduce((s, r) => s + Number(r.saldo ?? 0), 0),
          total: kdata.reduce((s, r) => s + Number(r.total ?? 0), 0),
          conSaldo: kdata.filter((r) => Number(r.saldo) > 0).length,
        });
      }
    } catch (err) {
      setErrorMsg(safeError(err, "Error al cargar cuentas"));
    } finally {
      setLoading(false);
    }
  }, [esCobrar, soloPendientes]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // #S3-12: KPIs desde el agregado completo (no desde las 300 filas mostradas).
  const totalSaldo = kpi.saldo;
  const totalDoc = kpi.total;
  const conSaldo = kpi.conSaldo;

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
        <button
          onClick={() => setSoloPendientes((v) => !v)}
          className="inline-flex h-12 items-center gap-1.5 rounded-md border px-4 text-[12.5px] font-medium transition-colors cursor-pointer"
          style={{
            backgroundColor: soloPendientes
              ? "hsl(var(--primary))"
              : "hsl(var(--card))",
            color: soloPendientes
              ? "hsl(var(--primary-foreground))"
              : "hsl(var(--muted-foreground))",
            borderColor: soloPendientes
              ? "hsl(var(--primary))"
              : "hsl(var(--border))",
          }}
        >
          {soloPendientes ? "Solo con saldo" : "Todas (saldadas incl.)"}
        </button>
      </div>

      {/* Tabs CxC / CxP */}
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
        ].map((t) => {
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
                backgroundColor: active ? "hsl(var(--card))" : "transparent",
                color: active
                  ? "hsl(var(--foreground))"
                  : "hsl(var(--muted-foreground))",
                boxShadow: active ? "0 1px 2px hsl(0 0% 0% / 0.08)" : "none",
              }}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              {t.label}
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
          sub={esCobrar ? "Saldo de clientes" : "Saldo a proveedores"}
          token={esCobrar ? "--success" : "--destructive"}
          icon={CircleDollarSign}
        />
        <Kpi
          label="Cuentas con saldo"
          value={loading ? "…" : conSaldo}
          sub={`${rows.length} documento(s) en vista`}
          icon={FileText}
        />
        <Kpi
          label="Valor documentos"
          value={loading ? "…" : formatCOP(totalDoc)}
          sub="Total facturado (vista)"
          icon={Wallet}
        />
      </div>

      {loading ? (
        <SkeletonList />
      ) : rows.length === 0 ? (
        <Empty icon="💸">
          Sin cuentas {esCobrar ? "por cobrar" : "por pagar"}
          {soloPendientes ? " con saldo" : ""}.
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

          <footer
            className="border-t px-[18px] py-3 font-mono text-[10.5px] tracking-[0.06em]"
            style={{
              borderColor: "hsl(var(--border))",
              backgroundColor: "hsl(var(--muted) / 0.3)",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            {rows.length} cuenta(s) · saldo total{" "}
            <span
              style={{
                color: esCobrar
                  ? "hsl(var(--success))"
                  : "hsl(var(--destructive))",
              }}
            >
              {formatCOP(totalSaldo)}
            </span>
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
