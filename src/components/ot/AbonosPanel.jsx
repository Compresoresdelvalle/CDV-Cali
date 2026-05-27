import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCOP, safeError } from "../../lib/utils";
import { useAuthStore } from "../../stores/authStore";
import { useConfirm } from "../ui/ConfirmDialog";
import { METODO_PAGO_LABELS } from "../../lib/ordenes-ui";
import FeedbackBanners from "../ui/FeedbackBanners";

const METODOS = [
  { id: "efectivo", label: "Efectivo" },
  { id: "transferencia", label: "Transferencia" },
  { id: "tarjeta", label: "Tarjeta" },
  { id: "otro", label: "Otro" },
];

const metodoLabel = (m) => METODO_PAGO_LABELS[m] ?? m;

// Fecha/hora en zona Colombia (texto compacto para tabla/cards).
const fmtFecha = (f) =>
  new Date(f).toLocaleString("es-CO", { timeZone: "America/Bogota" });

/**
 * Panel de abonos múltiples por OT (Fase 10 §10.3).
 * Lista abonos previos + formulario para registrar nuevos.
 *
 * Props:
 *   - ordenId: UUID de la OT
 *   - readOnly: boolean (default false) — OT entregada/inmutable
 *   - onChange: callback opcional (se llama tras agregar/borrar abono)
 */
export default function AbonosPanel({
  ordenId,
  readOnly = false,
  onChange,
  totalOT = 0,
}) {
  const perfil = useAuthStore((s) => s.perfil);
  const [abonos, setAbonos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [agregando, setAgregando] = useState(false);
  const [form, setForm] = useState({
    monto: "",
    metodo_pago: "efectivo",
    observaciones: "",
  });
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  const { confirm, ConfirmDialog } = useConfirm();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const cargar = async () => {
    if (!ordenId) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const { data, error } = await supabase
        .from("abonos")
        .select(
          "id, fecha, monto, metodo_pago, observaciones, registrado_por:registrado_por(id, nombre)",
        )
        .eq("orden_id", ordenId)
        .order("fecha", { ascending: false });
      if (!mountedRef.current) return;
      if (error) throw error;
      setAbonos(data ?? []);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar abonos"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordenId]);

  const guardar = async () => {
    const monto = Number(form.monto);
    if (!Number.isFinite(monto) || monto <= 0) {
      setErrorMsg("Monto debe ser mayor a 0");
      return;
    }
    if (monto > 9999999999.99) {
      setErrorMsg("Monto excede el máximo permitido");
      return;
    }
    if (!METODOS.find((m) => m.id === form.metodo_pago)) {
      setErrorMsg("Método de pago inválido");
      return;
    }
    // Confirm dialog si excede saldo pendiente
    if (totalOT > 0 && monto > saldoPendiente) {
      const ok = await confirm({
        titulo: "Abono mayor al saldo pendiente",
        mensaje: `El abono de ${formatCOP(monto)} excede el saldo pendiente de ${formatCOP(saldoPendiente)}. ¿Estás seguro? (Esto solo aplica si es un pago adelantado por buena fe.)`,
        confirmLabel: "Sí, registrar igual",
        danger: true,
      });
      if (!ok) return;
    }
    // Guard síncrono contra doble-submit (registraría dos abonos).
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setErrorMsg("");
    setOkMsg("");
    try {
      const { error } = await supabase.from("abonos").insert({
        orden_id: ordenId,
        monto,
        metodo_pago: form.metodo_pago,
        observaciones: form.observaciones?.trim() || null,
        registrado_por: perfil?.id,
      });
      if (error) throw error;
      setOkMsg(`Abono de ${formatCOP(monto)} registrado`);
      setForm({ monto: "", metodo_pago: "efectivo", observaciones: "" });
      setAgregando(false);
      await cargar();
      onChange?.();
    } catch (err) {
      setErrorMsg(safeError(err, "Error al registrar abono"));
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const eliminar = async (a) => {
    const ok = await confirm({
      titulo: "Eliminar abono",
      mensaje: `Eliminar el abono de ${formatCOP(a.monto)} del ${fmtFecha(a.fecha)}? Esta acción no se puede deshacer.`,
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    setErrorMsg("");
    try {
      const { error } = await supabase.from("abonos").delete().eq("id", a.id);
      if (error) throw error;
      setOkMsg("Abono eliminado");
      await cargar();
      onChange?.();
    } catch (err) {
      setErrorMsg(safeError(err, "Error al eliminar"));
    }
  };

  const total = abonos.reduce((s, a) => s + (Number(a.monto) || 0), 0);
  const saldoPendiente = Math.max(0, Number(totalOT) - total);
  const montoActual = Number(form.monto) || 0;
  const excedeAbono =
    totalOT > 0 && montoActual > saldoPendiente && montoActual > 0;
  const puedeEliminar = !readOnly && perfil?.rol === "Admin";

  return (
    <div className="space-y-3">
      <FeedbackBanners errorMsg={errorMsg} okMsg={okMsg} />

      {/* Resumen abonado / saldo */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="font-mono text-[10px] uppercase tracking-[0.08em]"
            style={{ color: "var(--n-300)" }}
          >
            {loading ? "Cargando…" : `${abonos.length} abono(s)`}
          </p>
          <p
            className="font-mono text-[22px] font-medium tabular-nums leading-tight"
            style={{ color: "var(--n-900)" }}
          >
            {formatCOP(total)}
            {totalOT > 0 && (
              <span
                className="ml-2 text-[13px] font-normal"
                style={{
                  color:
                    saldoPendiente === 0 ? "var(--succ-700)" : "var(--n-500)",
                }}
              >
                · Saldo {formatCOP(saldoPendiente)}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Formulario nuevo abono */}
      {agregando && (
        <div
          className="space-y-2.5 rounded-lg border p-3.5"
          style={{ backgroundColor: "var(--n-0)", borderColor: "var(--p-200)" }}
        >
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <label className="block">
              <span
                className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.08em]"
                style={{ color: "var(--n-500)" }}
              >
                Monto (COP)
              </span>
              <input
                type="number"
                step="1000"
                min="1"
                max="9999999999.99"
                value={form.monto}
                onChange={(e) => setForm({ ...form, monto: e.target.value })}
                disabled={saving}
                className="w-full rounded-lg border px-3 font-mono text-sm outline-none"
                style={{ ...fieldStyle, minHeight: 48 }}
                placeholder="100000"
              />
            </label>
            <label className="block">
              <span
                className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.08em]"
                style={{ color: "var(--n-500)" }}
              >
                Método de pago
              </span>
              <select
                value={form.metodo_pago}
                onChange={(e) =>
                  setForm({ ...form, metodo_pago: e.target.value })
                }
                disabled={saving}
                className="w-full rounded-lg border px-3 text-sm outline-none"
                style={{ ...fieldStyle, minHeight: 48 }}
              >
                {METODOS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span
              className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.08em]"
              style={{ color: "var(--n-500)" }}
            >
              Observaciones (opcional)
            </span>
            <input
              type="text"
              value={form.observaciones}
              onChange={(e) =>
                setForm({ ...form, observaciones: e.target.value })
              }
              disabled={saving}
              className="w-full rounded-lg border px-3 text-sm outline-none"
              style={{ ...fieldStyle, minHeight: 48 }}
              placeholder="Ref: transferencia 1234"
            />
          </label>
          {excedeAbono && (
            <div
              className="flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs"
              style={{
                backgroundColor: "var(--warn-50)",
                borderColor: "var(--warn-500)",
                color: "var(--warn-700)",
              }}
            >
              <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              El abono ({formatCOP(montoActual)}) excede el saldo pendiente (
              {formatCOP(saldoPendiente)}). Puedes continuar si es un pago
              adelantado, pero verifica.
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => {
                setAgregando(false);
                setForm({
                  monto: "",
                  metodo_pago: "efectivo",
                  observaciones: "",
                });
              }}
              disabled={saving}
              className="rounded-lg border px-4 text-sm font-medium disabled:opacity-50"
              style={{
                height: 48,
                borderColor: "var(--n-200)",
                color: "var(--n-700)",
                backgroundColor: "var(--n-0)",
              }}
            >
              Cancelar
            </button>
            <button
              onClick={guardar}
              disabled={saving || !form.monto}
              className="btn btn-pri disabled:opacity-50"
              style={{ height: 48 }}
            >
              {saving ? "Registrando…" : "Registrar"}
            </button>
          </div>
        </div>
      )}

      {/* Lista de abonos */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg border"
              style={{
                backgroundColor: "var(--n-0)",
                borderColor: "var(--n-150)",
              }}
            />
          ))}
        </div>
      ) : abonos.length === 0 ? (
        <p
          className="py-4 text-center text-xs"
          style={{ color: "var(--n-500)" }}
        >
          Sin abonos registrados
        </p>
      ) : (
        <>
          {/* Desktop: tabla */}
          <div
            className="hidden overflow-hidden rounded-lg border md:block"
            style={{ borderColor: "var(--n-150)" }}
          >
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr style={{ backgroundColor: "var(--n-50)" }}>
                  <ATh>Fecha</ATh>
                  <ATh>Monto</ATh>
                  <ATh>Método</ATh>
                  <ATh>Nota</ATh>
                  {puedeEliminar && <ATh right>Acción</ATh>}
                </tr>
              </thead>
              <tbody>
                {abonos.map((a) => (
                  <tr
                    key={a.id}
                    className="border-t"
                    style={{ borderColor: "var(--n-100)" }}
                  >
                    <td
                      className="px-3 py-2.5 font-mono text-[11.5px]"
                      style={{ color: "var(--n-500)" }}
                    >
                      {fmtFecha(a.fecha)}
                    </td>
                    <td
                      className="px-3 py-2.5 font-mono text-[13px] font-medium tabular-nums"
                      style={{ color: "var(--n-900)" }}
                    >
                      {formatCOP(a.monto)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]"
                        style={{
                          backgroundColor: "var(--info-50)",
                          borderColor: "#c8dffc",
                          color: "var(--info-700)",
                        }}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: "currentColor", opacity: 0.7 }}
                        />
                        {metodoLabel(a.metodo_pago)}
                      </span>
                    </td>
                    <td
                      className="px-3 py-2.5 text-[12.5px]"
                      style={{ color: "var(--n-700)" }}
                    >
                      {a.observaciones || "—"}
                      {a.registrado_por?.nombre && (
                        <span
                          className="ml-1 font-mono text-[10.5px]"
                          style={{ color: "var(--n-300)" }}
                        >
                          · {a.registrado_por.nombre}
                        </span>
                      )}
                    </td>
                    {puedeEliminar && (
                      <td className="px-3 py-2.5 text-right">
                        <button
                          onClick={() => eliminar(a)}
                          aria-label="Eliminar abono"
                          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium"
                          style={{
                            minHeight: 44,
                            borderColor: "var(--dang-border)",
                            color: "var(--dang-700)",
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Móvil: cards */}
          <ul className="space-y-1.5 md:hidden" role="list">
            {abonos.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5"
                style={{
                  backgroundColor: "var(--n-0)",
                  borderColor: "var(--n-150)",
                }}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className="font-mono text-sm font-medium tabular-nums"
                    style={{ color: "var(--n-900)" }}
                  >
                    {formatCOP(a.monto)}
                    <span
                      className="ml-2 text-xs font-normal"
                      style={{ color: "var(--n-500)" }}
                    >
                      {metodoLabel(a.metodo_pago)}
                    </span>
                  </p>
                  <p
                    className="font-mono text-[10px]"
                    style={{ color: "var(--n-300)" }}
                  >
                    {fmtFecha(a.fecha)}
                    {a.registrado_por?.nombre
                      ? ` · ${a.registrado_por.nombre}`
                      : ""}
                  </p>
                  {a.observaciones && (
                    <p
                      className="mt-0.5 text-xs"
                      style={{ color: "var(--n-700)" }}
                    >
                      {a.observaciones}
                    </p>
                  )}
                </div>
                {puedeEliminar && (
                  <button
                    onClick={() => eliminar(a)}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium"
                    style={{
                      minHeight: 44,
                      borderColor: "var(--dang-border)",
                      color: "var(--dang-700)",
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                    Eliminar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* CTA registrar abono (dashed full width, como en Lovable) */}
      {!readOnly && !agregando && (
        <button
          onClick={() => setAgregando(true)}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-2.5 text-[12.5px] font-medium transition-colors"
          style={{
            minHeight: 48,
            borderColor: "var(--n-200)",
            backgroundColor: "var(--n-25)",
            color: "var(--n-500)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--n-50)";
            e.currentTarget.style.color = "var(--n-900)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "var(--n-25)";
            e.currentTarget.style.color = "var(--n-500)";
          }}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
          Registrar abono
        </button>
      )}

      <ConfirmDialog />
    </div>
  );
}

const fieldStyle = {
  backgroundColor: "var(--n-0)",
  borderColor: "var(--n-200)",
  color: "var(--n-950)",
};

function ATh({ children, right }) {
  return (
    <th
      className={
        "px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] " +
        (right ? "text-right" : "text-left")
      }
      style={{ color: "var(--n-500)" }}
    >
      {children}
    </th>
  );
}
