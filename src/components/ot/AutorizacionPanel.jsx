import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { formatCOP, safeError } from "../../lib/utils";
import FeedbackBanners from "../ui/FeedbackBanners";

const ESTADOS = [
  { id: "pendiente", label: "⏳ Pendiente", color: "warning" },
  { id: "autorizado", label: "✅ Autorizado", color: "success" },
  { id: "no_autorizado", label: "❌ No autorizado", color: "destructive" },
];

/**
 * Panel de autorización del cliente para una OT (Fase 10 §10.2).
 *
 * - Cliente AUTORIZA → debe pagar anticipo para iniciar (validado por trigger BD).
 * - Cliente NO AUTORIZA → se cobra valor por revisión (manual por OT).
 * - Pendiente → estado inicial mientras el cliente decide.
 *
 * Props:
 *   - ordenId: UUID de la OT
 *   - estadoAutorizacion: valor actual (pendiente | autorizado | no_autorizado)
 *   - valorRevision: numeric o null
 *   - readOnly: boolean
 *   - onChange: callback opcional tras guardar
 */
export default function AutorizacionPanel({
  ordenId,
  estadoAutorizacion,
  valorRevision,
  readOnly = false,
  onChange,
}) {
  const [estado, setEstado] = useState(estadoAutorizacion ?? "pendiente");
  const [valor, setValor] = useState(valorRevision ?? "");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");

  useEffect(() => {
    setEstado(estadoAutorizacion ?? "pendiente");
    setValor(valorRevision ?? "");
  }, [estadoAutorizacion, valorRevision]);

  const dirty =
    estado !== (estadoAutorizacion ?? "pendiente") ||
    String(valor) !== String(valorRevision ?? "");

  const guardar = async () => {
    setErrorMsg("");
    setOkMsg("");
    let payload = { estado_autorizacion: estado };
    if (estado === "no_autorizado") {
      const raw = String(valor).trim();
      if (raw === "") {
        setErrorMsg(
          "Debes ingresar el valor por revisión que se le cobrará al cliente",
        );
        return;
      }
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) {
        setErrorMsg("Valor por revisión debe ser un número ≥ 0");
        return;
      }
      payload.valor_revision = v;
    } else {
      payload.valor_revision = null;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("ordenes_servicio")
        .update(payload)
        .eq("id", ordenId);
      if (error) throw error;
      setOkMsg("Autorización actualizada");
      onChange?.();
    } catch (err) {
      setErrorMsg(safeError(err, "Error al guardar"));
    } finally {
      setSaving(false);
    }
  };

  const meta = ESTADOS.find((e) => e.id === estado) ?? ESTADOS[0];

  return (
    <div className="space-y-3">
      <FeedbackBanners errorMsg={errorMsg} okMsg={okMsg} />

      <div className="grid grid-cols-3 gap-2">
        {ESTADOS.map((e) => {
          const active = estado === e.id;
          return (
            <button
              key={e.id}
              onClick={() => !readOnly && setEstado(e.id)}
              disabled={readOnly}
              className="rounded-lg border-2 px-3 py-3 text-sm font-semibold cursor-pointer min-h-[48px] disabled:opacity-50 transition-all"
              style={{
                backgroundColor: active
                  ? `hsl(var(--${e.color}) / 0.18)`
                  : "hsl(var(--card))",
                borderColor: active
                  ? `hsl(var(--${e.color}))`
                  : "hsl(var(--muted-foreground) / 0.3)",
                color: active
                  ? `hsl(var(--${e.color}))`
                  : "hsl(var(--muted-foreground))",
              }}
            >
              {e.label}
            </button>
          );
        })}
      </div>

      {estado === "autorizado" && (
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            backgroundColor: "hsl(var(--info) / 0.08)",
            borderColor: "hsl(var(--info) / 0.4)",
            color: "hsl(var(--info))",
          }}
        >
          ℹ️ El cliente autorizó. Para iniciar el trabajo se requiere al menos
          un anticipo registrado (panel de abonos).
        </div>
      )}

      {estado === "no_autorizado" && (
        <div className="space-y-2">
          <div
            className="rounded-lg border px-3 py-2 text-xs"
            style={{
              backgroundColor: "hsl(var(--warning) / 0.08)",
              borderColor: "hsl(var(--warning) / 0.4)",
              color: "hsl(var(--warning))",
            }}
          >
            ⚠️ Cliente no autoriza. Cobrar valor por revisión al cierre. Se
            facturará como servicio normal.
          </div>
          <label className="block">
            <span
              className="block text-xs font-medium mb-1"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Valor por revisión (COP)
            </span>
            <input
              type="number"
              step="1000"
              min="0"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              disabled={readOnly || saving}
              className="w-full px-3 py-2 rounded-lg border text-sm font-mono min-h-[48px]"
              style={{
                backgroundColor: "hsl(var(--background))",
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--foreground))",
              }}
              placeholder="50000"
            />
          </label>
        </div>
      )}

      {valorRevision != null && estadoAutorizacion === "no_autorizado" && (
        <p
          className="text-xs"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Actual: <strong>{formatCOP(valorRevision)}</strong>
        </p>
      )}

      {!readOnly && (
        <div className="flex items-center justify-end gap-2">
          <span
            className="text-[10px] font-mono"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Estado:{" "}
            <strong style={{ color: `hsl(var(--${meta.color}))` }}>
              {meta.label}
            </strong>
          </span>
          <button
            onClick={guardar}
            disabled={!dirty || saving}
            className="text-sm px-4 py-2 rounded-lg cursor-pointer min-h-[48px] disabled:opacity-50"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            {saving ? "Guardando…" : "Guardar autorización"}
          </button>
        </div>
      )}
    </div>
  );
}
