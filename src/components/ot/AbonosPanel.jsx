import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { formatCOP, safeError } from "../../lib/utils";
import { useAuthStore } from "../../stores/authStore";
import { useConfirm } from "../ui/ConfirmDialog";

const METODOS = [
  { id: "efectivo", label: "Efectivo" },
  { id: "transferencia", label: "Transferencia" },
  { id: "tarjeta", label: "Tarjeta" },
  { id: "otro", label: "Otro" },
];

/**
 * Panel de abonos múltiples por OT (Fase 10 §10.3).
 * Lista abonos previos + formulario para registrar nuevos.
 *
 * Props:
 *   - ordenId: UUID de la OT
 *   - readOnly: boolean (default false) — OT entregada/inmutable
 *   - onChange: callback opcional (se llama tras agregar/borrar abono)
 */
export default function AbonosPanel({ ordenId, readOnly = false, onChange }) {
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
    if (!METODOS.find((m) => m.id === form.metodo_pago)) {
      setErrorMsg("Método de pago inválido");
      return;
    }
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
      if (mountedRef.current) setSaving(false);
    }
  };

  const eliminar = async (a) => {
    const ok = await confirm({
      titulo: "Eliminar abono",
      mensaje: `Eliminar el abono de ${formatCOP(a.monto)} del ${new Date(a.fecha).toLocaleString("es-CO")}? Esta acción no se puede deshacer.`,
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

  const total = abonos.reduce((s, a) => s + Number(a.monto), 0);

  return (
    <div className="space-y-3">
      {errorMsg && (
        <div
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
      {okMsg && (
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            backgroundColor: "hsl(var(--success) / 0.08)",
            borderColor: "hsl(var(--success) / 0.4)",
            color: "hsl(var(--success))",
          }}
        >
          {okMsg}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p
            className="text-xs"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {loading ? "Cargando…" : `${abonos.length} abono(s) — Total:`}
          </p>
          <p
            className="text-lg font-bold tabular-nums"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {formatCOP(total)}
          </p>
        </div>
        {!readOnly && !agregando && (
          <button
            onClick={() => setAgregando(true)}
            className="text-xs px-3 py-2 rounded-lg cursor-pointer min-h-[48px]"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            + Registrar abono
          </button>
        )}
      </div>

      {agregando && (
        <div
          className="rounded-lg border p-3 space-y-2"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--primary))",
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span
                className="block text-xs font-medium mb-1"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Monto (COP)
              </span>
              <input
                type="number"
                step="1000"
                min="1"
                value={form.monto}
                onChange={(e) => setForm({ ...form, monto: e.target.value })}
                disabled={saving}
                className="w-full px-3 py-2 rounded-lg border text-sm font-mono min-h-[48px]"
                style={{
                  backgroundColor: "hsl(var(--background))",
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
                placeholder="100000"
              />
            </label>
            <label className="block">
              <span
                className="block text-xs font-medium mb-1"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Método de pago
              </span>
              <select
                value={form.metodo_pago}
                onChange={(e) =>
                  setForm({ ...form, metodo_pago: e.target.value })
                }
                disabled={saving}
                className="w-full px-3 py-2 rounded-lg border text-sm min-h-[48px]"
                style={{
                  backgroundColor: "hsl(var(--background))",
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
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
              className="block text-xs font-medium mb-1"
              style={{ color: "hsl(var(--muted-foreground))" }}
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
              className="w-full px-3 py-2 rounded-lg border text-sm min-h-[48px]"
              style={{
                backgroundColor: "hsl(var(--background))",
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--foreground))",
              }}
              placeholder="Ref: transferencia 1234"
            />
          </label>
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
              className="text-sm px-4 py-2 rounded-lg border cursor-pointer min-h-[48px] disabled:opacity-50"
              style={{
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              Cancelar
            </button>
            <button
              onClick={guardar}
              disabled={saving || !form.monto}
              className="text-sm px-4 py-2 rounded-lg cursor-pointer min-h-[48px] disabled:opacity-50"
              style={{
                backgroundColor: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
              }}
            >
              {saving ? "Registrando…" : "Registrar"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => (
            <div
              key={i}
              className="rounded-lg p-3 animate-pulse border h-14"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            />
          ))}
        </div>
      ) : abonos.length === 0 ? (
        <p
          className="text-center text-xs py-4"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Sin abonos registrados
        </p>
      ) : (
        <ul className="space-y-1.5" role="list">
          {abonos.map((a) => (
            <li
              key={a.id}
              className="rounded-lg border px-3 py-2 flex items-center justify-between gap-2"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            >
              <div className="min-w-0 flex-1">
                <p
                  className="text-sm font-bold tabular-nums"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {formatCOP(a.monto)}
                  <span
                    className="ml-2 text-xs font-normal"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {METODOS.find((m) => m.id === a.metodo_pago)?.label ??
                      a.metodo_pago}
                  </span>
                </p>
                <p
                  className="text-[10px] font-mono"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {new Date(a.fecha).toLocaleString("es-CO", {
                    timeZone: "America/Bogota",
                  })}
                  {a.registrado_por?.nombre
                    ? ` · ${a.registrado_por.nombre}`
                    : ""}
                </p>
                {a.observaciones && (
                  <p
                    className="text-xs mt-0.5"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {a.observaciones}
                  </p>
                )}
              </div>
              {!readOnly && perfil?.rol === "Admin" && (
                <button
                  onClick={() => eliminar(a)}
                  className="text-xs px-2 py-1.5 rounded-lg border cursor-pointer min-h-[44px]"
                  style={{
                    borderColor: "hsl(var(--destructive))",
                    color: "hsl(var(--destructive))",
                  }}
                >
                  Eliminar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog />
    </div>
  );
}
