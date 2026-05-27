import { useState, useEffect, useRef } from "react";
import {
  Clock,
  CheckCircle2,
  XCircle,
  Info,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCOP, safeError } from "../../lib/utils";
import FeedbackBanners from "../ui/FeedbackBanners";

// Estados de autorización reales (pendiente | autorizado | no_autorizado).
// `tone` mapea a los tokens --p-*/--succ-*/--dang-*/--warn-* del diseño Lovable.
const ESTADOS = [
  { id: "pendiente", label: "Pendiente", Icon: Clock, tone: "warn" },
  { id: "autorizado", label: "Autorizado", Icon: CheckCircle2, tone: "succ" },
  { id: "no_autorizado", label: "No autorizado", Icon: XCircle, tone: "dang" },
];

// Estilos por tono activo/inactivo usando variables del diseño Lovable.
const TONE = {
  warn: { fg: "var(--warn-700)", bg: "var(--warn-50)", br: "var(--warn-500)" },
  succ: { fg: "var(--succ-700)", bg: "var(--succ-50)", br: "var(--succ-500)" },
  dang: {
    fg: "var(--dang-700)",
    bg: "var(--dang-50)",
    br: "var(--dang-border)",
  },
};

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
  const savingRef = useRef(false);

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
    if (savingRef.current) return;
    savingRef.current = true;
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
      savingRef.current = false;
    }
  };

  const meta = ESTADOS.find((e) => e.id === estado) ?? ESTADOS[0];

  return (
    <div className="space-y-3">
      <FeedbackBanners errorMsg={errorMsg} okMsg={okMsg} />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {ESTADOS.map((e) => {
          const active = estado === e.id;
          const t = TONE[e.tone];
          const Icon = e.Icon;
          return (
            <button
              key={e.id}
              onClick={() => !readOnly && setEstado(e.id)}
              disabled={readOnly}
              className="inline-flex items-center justify-center gap-2 rounded-lg border-2 px-3 text-[13px] font-medium transition-all disabled:opacity-50"
              style={{
                minHeight: 48,
                backgroundColor: active ? t.bg : "var(--n-0)",
                borderColor: active ? t.br : "var(--n-200)",
                color: active ? t.fg : "var(--n-500)",
              }}
            >
              <Icon className="h-4 w-4" strokeWidth={1.7} />
              {e.label}
            </button>
          );
        })}
      </div>

      {estado === "autorizado" && (
        <div className="banner-info">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          <div className="body">
            <b className="font-medium">El cliente autorizó.</b> Para iniciar el
            trabajo se requiere al menos un anticipo registrado (panel de
            abonos).
          </div>
        </div>
      )}

      {estado === "no_autorizado" && (
        <div className="space-y-2">
          <div
            className="flex items-center gap-3 rounded-lg border px-3.5 py-3 text-[12.5px] leading-[1.5]"
            style={{
              backgroundColor: "var(--warn-50)",
              borderColor: "var(--warn-border, var(--warn-500))",
              color: "var(--warn-700)",
            }}
          >
            <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.8} />
            <span>
              Cliente no autoriza. Cobrar valor por revisión al cierre. Se
              facturará como servicio normal.
            </span>
          </div>
          <label className="block">
            <span
              className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.08em]"
              style={{ color: "var(--n-500)" }}
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
              className="w-full rounded-lg border px-3 font-mono text-sm outline-none"
              style={{
                minHeight: 48,
                backgroundColor: "var(--n-0)",
                borderColor: "var(--n-200)",
                color: "var(--n-950)",
              }}
              placeholder="50000"
            />
          </label>
        </div>
      )}

      {valorRevision != null && estadoAutorizacion === "no_autorizado" && (
        <p className="text-xs" style={{ color: "var(--n-500)" }}>
          Actual:{" "}
          <strong style={{ color: "var(--n-900)" }}>
            {formatCOP(valorRevision)}
          </strong>
        </p>
      )}

      {!readOnly && (
        <div className="flex items-center justify-end gap-3">
          <span
            className="font-mono text-[10px] uppercase tracking-[0.06em]"
            style={{ color: "var(--n-500)" }}
          >
            Estado:{" "}
            <strong style={{ color: TONE[meta.tone].fg }}>{meta.label}</strong>
          </span>
          <button
            onClick={guardar}
            disabled={!dirty || saving}
            className="btn btn-pri disabled:opacity-50"
            style={{ height: 48 }}
          >
            {saving ? "Guardando…" : "Guardar autorización"}
          </button>
        </div>
      )}
    </div>
  );
}
