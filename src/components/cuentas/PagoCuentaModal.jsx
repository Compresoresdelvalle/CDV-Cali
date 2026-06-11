import { useState, useEffect, useCallback } from "react";
import { X, Trash2, Wallet, CheckCircle2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import {
  METODOS_PAGO_CUENTA,
  METODOS_ELECTRONICOS,
  cuentaBancariaLabel,
} from "../../lib/cuentas-ui";

/**
 * Modal para registrar cobros (CxC) o pagos (CxP) contra una venta/compra a
 * crédito. Muestra el historial de `pagos_cuenta`, permite registrar abonos
 * parciales o "saldar todo", y eliminar pagos (solo Admin). Recalcula el saldo
 * en vivo a partir de los pagos cargados + los abonos de cotización (CxC).
 *
 * Props:
 *   - cuenta: { tipo:'cobro'|'pago', refId:uuid, numero, contraparte:string,
 *               total:number, abonosCotizacion?:number }
 *   - onClose: () => void
 *   - onChanged: () => void   // se llama tras registrar/eliminar para refrescar la lista
 */
export default function PagoCuentaModal({ cuenta, onClose, onChanged }) {
  const esCobro = cuenta.tipo === "cobro";
  const refKey = esCobro ? "venta_id" : "compra_id";

  const [pagos, setPagos] = useState([]);
  const [cuentasBanco, setCuentasBanco] = useState([]);
  const [loading, setLoading] = useState(true);

  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState("Efectivo");
  const [cuentaBancaria, setCuentaBancaria] = useState("");
  const [obs, setObs] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState("");

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from("pagos_cuenta")
      .select("id, fecha, monto, metodo_pago, cuenta_bancaria, observaciones")
      .eq(refKey, cuenta.refId)
      .eq("tipo", cuenta.tipo)
      .eq("anulado", false)
      .order("fecha", { ascending: true });
    setPagos(data ?? []);
    setLoading(false);
  }, [refKey, cuenta.refId, cuenta.tipo]);

  useEffect(() => {
    cargar();
    supabase
      .from("cuentas_bancarias")
      .select("id, banco, tipo, numero, titular")
      .eq("activo", true)
      .order("banco")
      .then(({ data }) => setCuentasBanco(data ?? []));
  }, [cargar]);

  const abonosCotiz = Number(cuenta.abonosCotizacion ?? 0);
  const pagado = pagos.reduce((s, p) => s + Number(p.monto ?? 0), 0);
  const total = Number(cuenta.total ?? 0);
  const saldo = Math.max(0, total - abonosCotiz - pagado);
  const esElectronico = METODOS_ELECTRONICOS.includes(metodo);

  const elegirMetodo = (m) => {
    setMetodo(m);
    if (!METODOS_ELECTRONICOS.includes(m)) setCuentaBancaria("");
  };

  const saldarTodo = () => {
    setErr("");
    setMonto(String(Math.round(saldo)));
  };

  const registrar = async () => {
    const n = Number(String(monto).replace(/[^\d]/g, ""));
    if (!n || n <= 0) {
      setErr("Ingresa un monto válido mayor a 0.");
      return;
    }
    if (esElectronico && !cuentaBancaria) {
      setErr("Selecciona la cuenta bancaria para pagos electrónicos.");
      return;
    }
    setErr("");
    setGuardando(true);
    try {
      const { error } = await supabase.rpc("fn_registrar_pago_cuenta", {
        p_payload: {
          tipo: cuenta.tipo,
          [refKey]: cuenta.refId,
          monto: n,
          metodo_pago: metodo,
          cuenta_bancaria: cuentaBancaria || null,
          observaciones: obs || null,
        },
      });
      if (error) throw new Error(error.message);
      setMonto("");
      setObs("");
      await cargar();
      onChanged?.();
    } catch (e) {
      setErr(safeError(e, "No se pudo registrar el movimiento"));
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (id) => {
    setErr("");
    try {
      const { error } = await supabase.rpc("fn_eliminar_pago_cuenta", {
        p_id: id,
      });
      if (error) throw new Error(error.message);
      await cargar();
      onChanged?.();
    } catch (e) {
      setErr(safeError(e, "No se pudo eliminar el movimiento"));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ backgroundColor: "hsl(0 0% 0% / 0.45)" }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border shadow-xl animate-fade-in"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
          maxHeight: "90vh",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between gap-3 border-b px-4 py-3"
          style={{
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--muted) / 0.3)",
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
              style={{
                backgroundColor: "hsl(var(--primary) / 0.12)",
                color: "hsl(var(--primary))",
              }}
            >
              <Wallet className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <p
                className="truncate text-sm font-semibold"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {esCobro ? "Cobro" : "Pago"} · {esCobro ? "Venta" : "Compra"} #
                {cuenta.numero}
              </p>
              <p
                className="truncate text-xs"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {cuenta.contraparte || "—"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md cursor-pointer"
            style={{ color: "hsl(var(--muted-foreground))" }}
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <div
          className="overflow-y-auto px-4 py-4"
          style={{ maxHeight: "70vh" }}
        >
          {/* Resumen de saldo */}
          <div
            className="mb-4 grid grid-cols-3 gap-2 rounded-lg border p-3 text-center"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <Resumen label="Total" value={formatCOP(total)} />
            <Resumen
              label={esCobro ? "Abonado" : "Pagado"}
              value={formatCOP(abonosCotiz + pagado)}
              token="--success"
            />
            <Resumen
              label="Saldo"
              value={formatCOP(saldo)}
              token={saldo > 0 ? "--destructive" : "--success"}
            />
          </div>

          {esCobro && abonosCotiz > 0 && (
            <p
              className="mb-3 rounded-lg border px-3 py-2 text-[12px]"
              style={{
                backgroundColor: "hsl(var(--info) / 0.08)",
                borderColor: "hsl(var(--info) / 0.35)",
                color: "hsl(var(--info))",
              }}
            >
              Incluye {formatCOP(abonosCotiz)} de abonos de la cotización de
              origen.
            </p>
          )}

          {/* Historial de pagos */}
          {loading ? (
            <p
              className="py-2 text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Cargando…
            </p>
          ) : pagos.length > 0 ? (
            <ul className="mb-4 space-y-1.5" role="list">
              {pagos.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2"
                  style={{ borderColor: "hsl(var(--border))" }}
                >
                  <span
                    className="font-mono text-[11px]"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {formatDate(p.fecha)}
                  </span>
                  <span
                    className="font-mono text-[13px] font-semibold tabular-nums"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {formatCOP(p.monto)}
                  </span>
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: "hsl(var(--muted) / 0.5)",
                      color: "hsl(var(--muted-foreground))",
                    }}
                  >
                    {p.metodo_pago}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-[11px] italic"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {p.cuenta_bancaria || p.observaciones || ""}
                  </span>
                  <button
                    onClick={() => eliminar(p.id)}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md cursor-pointer"
                    style={{ color: "hsl(var(--destructive))" }}
                    aria-label="Eliminar movimiento"
                    title="Eliminar"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p
              className="mb-4 text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Sin {esCobro ? "cobros" : "pagos"} registrados.
            </p>
          )}

          {/* Form registrar */}
          {saldo > 0 ? (
            <div
              className="border-t pt-3"
              style={{ borderColor: "hsl(var(--border))" }}
            >
              <div className="mb-2 flex items-center justify-between">
                <span
                  className="font-mono text-[10.5px] uppercase tracking-[0.08em]"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Registrar {esCobro ? "cobro" : "pago"}
                </span>
                <button
                  onClick={saldarTodo}
                  className="text-[11.5px] font-semibold cursor-pointer hover:underline"
                  style={{ color: "hsl(var(--primary))" }}
                >
                  Saldar todo ({formatCOP(saldo)})
                </button>
              </div>

              <div className="flex items-end gap-2">
                <label className="flex flex-col gap-1">
                  <span
                    className="text-[11px]"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    Monto $
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={monto}
                    onChange={(e) => setMonto(e.target.value)}
                    placeholder="0"
                    className="h-11 rounded-[10px] border bg-transparent px-3 text-right text-[14px] font-semibold outline-none"
                    style={{
                      width: 130,
                      borderColor: "hsl(var(--border))",
                      color: "hsl(var(--foreground))",
                    }}
                  />
                </label>
                <div className="flex flex-1 flex-col gap-1">
                  <span
                    className="text-[11px]"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    Método
                  </span>
                  <div className="flex gap-1.5">
                    {METODOS_PAGO_CUENTA.map((m) => {
                      const active = metodo === m;
                      return (
                        <button
                          key={m}
                          onClick={() => elegirMetodo(m)}
                          className="h-11 flex-1 rounded-[10px] border px-2 text-[12px] font-medium transition-colors cursor-pointer"
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
                          {m}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {esElectronico && (
                <label className="mt-2 flex flex-col gap-1">
                  <span
                    className="text-[11px]"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    Cuenta bancaria
                  </span>
                  <select
                    value={cuentaBancaria}
                    onChange={(e) => setCuentaBancaria(e.target.value)}
                    className="h-11 cursor-pointer rounded-[10px] border bg-transparent px-3 text-[13px] outline-none"
                    style={{
                      borderColor: cuentaBancaria
                        ? "hsl(var(--border))"
                        : "hsl(var(--destructive) / 0.6)",
                      color: "hsl(var(--foreground))",
                    }}
                  >
                    <option value="">Selecciona…</option>
                    {cuentasBanco.map((c) => {
                      const ref = cuentaBancariaLabel(c);
                      return (
                        <option key={c.id} value={ref}>
                          {ref}
                        </option>
                      );
                    })}
                  </select>
                </label>
              )}

              <input
                type="text"
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                placeholder="Nota / referencia (opcional)"
                className="mt-2 h-11 w-full rounded-[10px] border bg-transparent px-3 text-[13px] outline-none"
                style={{
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
              />

              {err && (
                <p
                  className="mt-2 text-[12px]"
                  style={{ color: "hsl(var(--destructive))" }}
                >
                  {err}
                </p>
              )}

              <button
                onClick={registrar}
                disabled={guardando}
                className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-[10px] text-[14px] font-semibold transition-colors cursor-pointer disabled:opacity-40"
                style={{
                  backgroundColor: "hsl(var(--primary))",
                  color: "hsl(var(--primary-foreground))",
                }}
              >
                <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                {guardando
                  ? "Guardando…"
                  : `Registrar ${esCobro ? "cobro" : "pago"}`}
              </button>
            </div>
          ) : (
            <div
              className="flex items-center justify-center gap-2 rounded-lg border py-3 text-[13px] font-semibold"
              style={{
                borderColor: "hsl(var(--success) / 0.4)",
                backgroundColor: "hsl(var(--success) / 0.08)",
                color: "hsl(var(--success))",
              }}
            >
              <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
              Cuenta saldada
            </div>
          )}

          {err && saldo <= 0 && (
            <p
              className="mt-2 text-[12px]"
              style={{ color: "hsl(var(--destructive))" }}
            >
              {err}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Resumen({ label, value, token }) {
  return (
    <div>
      <p
        className="font-mono text-[10px] uppercase tracking-[0.06em]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </p>
      <p
        className="mt-0.5 font-mono text-[14px] font-bold tabular-nums"
        style={{
          color: token ? `hsl(var(${token}))` : "hsl(var(--foreground))",
        }}
      >
        {value}
      </p>
    </div>
  );
}
