import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";

/**
 * Modal para aplicar una nota crédito de proveedor contra una compra a crédito
 * del mismo proveedor (S6 · COMPRAS-04). Registra un "pago" con método
 * 'Nota crédito' que baja el saldo de Cuentas por Pagar sin salida de caja, y
 * descuenta el saldo de la nota. Todo vía fn_aplicar_nota_credito.
 *
 * Props:
 *   - nota: { id, numero, proveedor, saldo_restante }
 *   - onClose: () => void
 *   - onDone: () => void
 */
export default function AplicarNotaCreditoModal({ nota, onClose, onDone }) {
  const [compras, setCompras] = useState(null); // null = cargando
  const [loadError, setLoadError] = useState(false);
  const [compraId, setCompraId] = useState("");
  const [monto, setMonto] = useState("");
  const [err, setErr] = useState("");
  const [guardando, setGuardando] = useState(false);
  const guardandoRef = useRef(false);

  const saldoNota = Number(nota.saldo_restante ?? 0);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Compras a crédito del mismo proveedor con saldo pendiente.
      const { data, error } = await supabase
        .from("v_cuentas_por_pagar")
        .select("compra_id, numero, fecha, proveedor, total, saldo")
        .ilike("proveedor", (nota.proveedor ?? "").trim())
        .gt("saldo", 0)
        .order("fecha", { ascending: true });
      if (!alive) return;
      if (error) {
        setLoadError(true);
        return;
      }
      setLoadError(false);
      setCompras(data ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [nota.proveedor]);

  const compraSel = (compras ?? []).find((c) => c.compra_id === compraId);
  const saldoCompra = compraSel ? Number(compraSel.saldo) : 0;
  const maxAplicable = Math.min(saldoNota, saldoCompra);

  const elegir = (id) => {
    setCompraId(id);
    const c = (compras ?? []).find((x) => x.compra_id === id);
    if (c) setMonto(String(Math.round(Math.min(saldoNota, Number(c.saldo)))));
  };

  const aplicar = async () => {
    if (guardandoRef.current) return;
    const n = Number(String(monto).replace(/[^\d]/g, ""));
    if (!compraId) {
      setErr("Selecciona la compra a la que aplicar la nota.");
      return;
    }
    if (!n || n <= 0) {
      setErr("Ingresa un monto mayor a 0.");
      return;
    }
    if (n > maxAplicable) {
      setErr(
        `El monto no puede superar ${formatCOP(maxAplicable)} (mín. entre el saldo de la nota y el de la compra).`,
      );
      return;
    }
    guardandoRef.current = true;
    setGuardando(true);
    setErr("");
    try {
      const { error } = await supabase.rpc("fn_aplicar_nota_credito", {
        p_nota_id: nota.id,
        p_compra_id: compraId,
        p_monto: n,
      });
      if (error) throw error;
      onDone?.();
    } catch (e) {
      setErr(safeError(e, "No se pudo aplicar la nota crédito"));
      setGuardando(false);
      guardandoRef.current = false;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={() => !guardando && onClose?.()}
    >
      <div
        className="w-full max-w-md space-y-3 rounded-xl border p-5"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          className="text-lg font-semibold"
          style={{ color: "hsl(var(--foreground))" }}
        >
          Aplicar NC #{nota.numero}
        </h3>
        <p
          className="text-xs"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {nota.proveedor} · saldo disponible{" "}
          <b style={{ color: "hsl(var(--success))" }}>{formatCOP(saldoNota)}</b>
        </p>

        {loadError ? (
          <p className="text-sm" style={{ color: "hsl(var(--destructive))" }}>
            No se pudieron cargar las compras del proveedor. Cierra e intenta de
            nuevo.
          </p>
        ) : compras == null ? (
          <p
            className="text-sm"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Cargando compras a crédito…
          </p>
        ) : compras.length === 0 ? (
          <p
            className="text-sm"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Este proveedor no tiene compras a crédito con saldo pendiente. La
            nota queda disponible para una compra futura.
          </p>
        ) : (
          <>
            <div>
              <label
                className="mb-1 block text-xs font-medium"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Compra a crédito
              </label>
              <select
                value={compraId}
                onChange={(e) => elegir(e.target.value)}
                disabled={guardando}
                className="min-h-[44px] w-full rounded-lg border px-3 text-sm"
                style={{
                  backgroundColor: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
              >
                <option value="">Selecciona una compra…</option>
                {compras.map((c) => (
                  <option key={c.compra_id} value={c.compra_id}>
                    #{c.numero} · {formatDate(c.fecha)} · saldo{" "}
                    {formatCOP(c.saldo)}
                  </option>
                ))}
              </select>
            </div>

            {compraSel && (
              <div>
                <label
                  className="mb-1 block text-xs font-medium"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Monto a aplicar (máx. {formatCOP(maxAplicable)})
                </label>
                <input
                  type="number"
                  min="0"
                  max={maxAplicable}
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  disabled={guardando}
                  className="min-h-[44px] w-full rounded-lg border px-3 text-sm"
                  style={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    color: "hsl(var(--foreground))",
                  }}
                />
              </div>
            )}
          </>
        )}

        {err && (
          <div
            role="alert"
            className="rounded-lg border px-3 py-2 text-xs"
            style={{
              backgroundColor: "hsl(var(--destructive) / 0.08)",
              borderColor: "hsl(var(--destructive) / 0.4)",
              color: "hsl(var(--destructive))",
            }}
          >
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={guardando}
            className="min-h-[44px] rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            Cerrar
          </button>
          <button
            onClick={aplicar}
            disabled={guardando || !compraId}
            className="min-h-[44px] rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            {guardando ? "Aplicando…" : "Aplicar nota"}
          </button>
        </div>
      </div>
    </div>
  );
}
