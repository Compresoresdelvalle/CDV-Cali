import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { formatCOP, safeError } from "../../lib/utils";
import {
  METODOS_ELECTRONICOS,
  cuentaBancariaLabel,
} from "../../lib/cuentas-ui";

/**
 * Modal de conversión cotización → venta con captura del pago del saldo
 * (S3-05 / COT-D-E). La venta nace a Crédito (su total NO entra al cierre
 * el día de la conversión); el dinero cuenta el día que entra:
 *   - los abonos previos de la cotización, el día en que se cobraron;
 *   - el saldo, hoy, si el cliente lo paga en el acto (se registra el cobro
 *     real en pagos_cuenta con su método), o después vía Cuentas por Cobrar.
 *
 * Props:
 *   - cotizacion: { id, numero, total }
 *   - onClose: () => void
 *   - onDone: (ventaId) => void
 */
export default function ConvertirCotizacionModal({
  cotizacion,
  onClose,
  onDone,
}) {
  const [abonado, setAbonado] = useState(null); // null = cargando
  const [loadError, setLoadError] = useState(false);
  const [cuentasBanco, setCuentasBanco] = useState([]);
  // 'credito' | 'Efectivo' | 'Transferencia' | 'Tarjeta'
  const [metodo, setMetodo] = useState("credito");
  const [cuentaBancaria, setCuentaBancaria] = useState("");
  const [err, setErr] = useState("");
  const [convirtiendo, setConvirtiendo] = useState(false);
  const convirtiendoRef = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      // El saldo se calcula contra los abonos reales; si la consulta falla no
      // se puede convertir a ciegas (se cobraría un saldo posiblemente falso).
      const { data, error } = await supabase
        .from("abonos_cotizacion")
        .select("monto")
        .eq("cotizacion_id", cotizacion.id);
      if (!alive) return;
      if (error) {
        setLoadError(true);
        return;
      }
      setLoadError(false);
      setAbonado((data ?? []).reduce((s, a) => s + Number(a.monto ?? 0), 0));
    })();
    supabase
      .from("cuentas_bancarias")
      .select("id, banco, tipo, numero, titular")
      .eq("activo", true)
      .order("banco")
      .then(({ data }) => {
        if (alive) setCuentasBanco(data ?? []);
      });
    return () => {
      alive = false;
    };
  }, [cotizacion.id]);

  const total = Number(cotizacion.total ?? 0);
  const saldo = abonado == null ? null : Math.max(0, total - abonado);
  const hayPagoAhora = saldo > 0 && metodo !== "credito";
  const esElectronico = hayPagoAhora && METODOS_ELECTRONICOS.includes(metodo);

  const convertir = async () => {
    if (convirtiendoRef.current) return;
    if (esElectronico && !cuentaBancaria) {
      setErr("Selecciona la cuenta bancaria para pagos electrónicos.");
      return;
    }
    convirtiendoRef.current = true;
    setConvirtiendo(true);
    setErr("");
    try {
      const { data, error: rpcErr } = await supabase.rpc(
        "fn_convertir_cotizacion",
        {
          p_cotizacion_id: cotizacion.id,
          p_pago_metodo: hayPagoAhora ? metodo : null,
          p_pago_cuenta_bancaria: esElectronico ? cuentaBancaria : null,
        },
      );
      if (rpcErr) throw new Error(rpcErr.message);
      onDone?.(data.venta_id);
    } catch (e) {
      setErr(safeError(e, "Error al convertir la cotización"));
      setConvirtiendo(false);
      convirtiendoRef.current = false;
    }
  };

  const OPCIONES =
    saldo > 0
      ? [
          { v: "Efectivo", l: "Efectivo" },
          { v: "Transferencia", l: "Transferencia" },
          { v: "Tarjeta", l: "Tarjeta" },
          { v: "credito", l: "Crédito (cobrar después)" },
        ]
      : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={() => !convirtiendo && onClose?.()}
    >
      <div
        className="w-full max-w-md space-y-3 rounded-xl border p-5"
        style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-200)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold" style={{ color: "var(--n-950)" }}>
          Convertir cotización #{cotizacion.numero ?? "?"} en venta
        </h3>

        {loadError ? (
          <p className="text-sm" style={{ color: "var(--dang-700)" }}>
            No se pudieron cargar los abonos de la cotización. Cierra e intenta
            de nuevo.
          </p>
        ) : abonado == null ? (
          <p className="text-sm" style={{ color: "var(--n-500)" }}>
            Cargando abonos…
          </p>
        ) : (
          <>
            <div
              className="space-y-1 rounded-lg border px-3 py-2.5 text-[13px]"
              style={{
                borderColor: "var(--n-150)",
                backgroundColor: "var(--n-50)",
                color: "var(--n-700)",
              }}
            >
              <div className="flex justify-between">
                <span>Total cotizado</span>
                <b className="font-mono">{formatCOP(total)}</b>
              </div>
              {abonado > 0 && (
                <div className="flex justify-between">
                  <span>Ya abonado</span>
                  <b className="font-mono">−{formatCOP(abonado)}</b>
                </div>
              )}
              <div
                className="flex justify-between border-t pt-1"
                style={{ borderColor: "var(--n-150)" }}
              >
                <span>Saldo a cobrar</span>
                <b className="font-mono" style={{ color: "var(--n-950)" }}>
                  {formatCOP(saldo)}
                </b>
              </div>
            </div>

            {saldo > 0 ? (
              <div>
                <p
                  className="mb-1.5 text-xs font-medium"
                  style={{ color: "var(--n-500)" }}
                >
                  ¿Cómo paga el cliente el saldo?
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {OPCIONES.map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => {
                        setMetodo(o.v);
                        if (!METODOS_ELECTRONICOS.includes(o.v))
                          setCuentaBancaria("");
                      }}
                      disabled={convirtiendo}
                      className="min-h-[44px] rounded-lg border px-3 py-2 text-sm font-medium"
                      style={
                        metodo === o.v
                          ? {
                              borderColor: "var(--p-500)",
                              backgroundColor: "var(--p-50)",
                              color: "var(--p-700)",
                            }
                          : {
                              borderColor: "var(--n-200)",
                              color: "var(--n-700)",
                            }
                      }
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
                {esElectronico && (
                  <select
                    value={cuentaBancaria}
                    onChange={(e) => setCuentaBancaria(e.target.value)}
                    disabled={convirtiendo}
                    className="mt-2 min-h-[44px] w-full rounded-lg border px-3 py-2 text-sm"
                    style={{
                      backgroundColor: "var(--n-0)",
                      borderColor: "var(--n-200)",
                      color: "var(--n-900)",
                    }}
                  >
                    <option value="">Selecciona la cuenta bancaria…</option>
                    {cuentasBanco.map((c) => (
                      <option key={c.id} value={cuentaBancariaLabel(c)}>
                        {cuentaBancariaLabel(c)}
                      </option>
                    ))}
                  </select>
                )}
                {metodo === "credito" && (
                  <p className="mt-2 text-xs" style={{ color: "var(--n-500)" }}>
                    El saldo quedará pendiente en Cuentas por Cobrar.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs" style={{ color: "var(--n-500)" }}>
                La cotización ya está abonada al 100%; la venta quedará saldada.
              </p>
            )}

            <p className="text-xs" style={{ color: "var(--warn-700)" }}>
              Esta acción descuenta stock del inventario y no se puede deshacer
              fácilmente.
            </p>
          </>
        )}

        {err && (
          <div
            role="alert"
            className="rounded-lg border px-3 py-2 text-xs"
            style={{
              backgroundColor: "var(--dang-50)",
              borderColor: "var(--dang-200)",
              color: "var(--dang-700)",
            }}
          >
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            disabled={convirtiendo}
            className="min-h-[44px] rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
            style={{ borderColor: "var(--n-200)", color: "var(--n-500)" }}
          >
            Cancelar
          </button>
          <button
            onClick={convertir}
            disabled={convirtiendo || loadError || abonado == null}
            className="min-h-[44px] rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            style={{
              backgroundColor: "var(--p-600)",
              color: "var(--p-contrast, #fff)",
            }}
          >
            {convirtiendo ? "Convirtiendo…" : "Convertir en venta"}
          </button>
        </div>
      </div>
    </div>
  );
}
