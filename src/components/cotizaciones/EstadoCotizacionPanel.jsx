import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { formatDate } from "../../lib/utils";
import { useConfirm } from "../ui/ConfirmDialog";
import FeedbackBanners from "../ui/FeedbackBanners";
import { avisarOk, avisarError } from "../../lib/notify";

/**
 * Banner contextual del estado de una cotizacion (Fase 11.5).
 *
 * Muestra acciones segun el estado y registra la transicion via RPC
 * `fn_cambiar_estado_cotizacion`. La cotizacion ya convertida en venta
 * (venta_id != null) queda bloqueada — el panel renderiza solo lectura.
 *
 * Props:
 *   - cotizacion: objeto con { id, estado, venta_id, fecha, vigencia_dias,
 *                              enviada_at, aprobada_at, nota_aprobacion,
 *                              rechazada_at, razon_rechazo, vencida_at }
 *   - rolUsuario: rol del usuario actual (para mostrar "Revertir" solo a Admin)
 *   - onChange: () => void — callback tras transicion exitosa
 */
export default function EstadoCotizacionPanel({
  cotizacion,
  rolUsuario,
  onChange,
}) {
  const { confirm, ConfirmDialog } = useConfirm();
  const [nota, setNota] = useState("");
  const [razon, setRazon] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);

  if (!cotizacion) return null;

  const { estado, venta_id } = cotizacion;
  const esAdmin = rolUsuario === "Admin";

  const cambiar = async (nuevo, opts = {}) => {
    setErrorMsg("");
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc(
        "fn_cambiar_estado_cotizacion",
        {
          p_cotizacion_id: cotizacion.id,
          p_nuevo_estado: nuevo,
          p_nota: opts.nota ?? null,
          p_razon: opts.razon ?? null,
        },
      );
      if (error) throw error;
      avisarOk(`Estado actualizado: ${data?.estado ?? nuevo}`);
      setNota("");
      setRazon("");
      onChange?.();
    } catch (err) {
      avisarError(err, "Error al actualizar estado");
    } finally {
      setLoading(false);
    }
  };

  const enviar = async () => {
    if (
      !(await confirm({
        titulo: "Marcar como enviada",
        mensaje:
          "Confirma que ya generaste el PDF y lo entregaste al cliente (WhatsApp, email, físico). Una vez enviada no se puede editar.",
        confirmLabel: "Sí, marcar enviada",
      }))
    )
      return;
    cambiar("enviada");
  };

  const aprobar = async () => {
    if (
      !(await confirm({
        titulo: "Cliente aprobó",
        mensaje:
          "Registra que el cliente confirmó. Después podrás convertir a venta.",
        confirmLabel: "Sí, aprobar",
      }))
    )
      return;
    cambiar("aprobada", { nota: nota.trim() || null });
  };

  const rechazar = async () => {
    if (!razon.trim()) {
      setErrorMsg("Razón obligatoria para rechazar");
      return;
    }
    if (
      !(await confirm({
        titulo: "Cliente rechazó",
        mensaje:
          "Esta acción es definitiva. La cotización quedará en solo lectura.",
        confirmLabel: "Sí, rechazar",
        danger: true,
      }))
    )
      return;
    cambiar("rechazada", { razon: razon.trim() });
  };

  const descartar = async () => {
    if (
      !(await confirm({
        titulo: "Descartar borrador",
        mensaje:
          "La cotización quedará rechazada (interno) y no se enviará al cliente.",
        confirmLabel: "Sí, descartar",
        danger: true,
      }))
    )
      return;
    cambiar("rechazada", { razon: "Descartado antes de enviar (interno)" });
  };

  const revertir = async () => {
    if (
      !(await confirm({
        titulo: "Revertir a enviada",
        mensaje:
          "Solo Admin. La cotización vuelve a 'enviada' y se podrá re-aprobar o re-rechazar. Si estaba vencida, se renueva la vigencia desde hoy.",
        confirmLabel: "Sí, revertir",
      }))
    )
      return;
    cambiar("enviada");
  };

  // ── Bloqueado: ya convertida en venta ──
  if (venta_id) {
    return (
      <Card tone="success" titulo="🛒 Convertida a venta">
        <p
          style={{ color: "hsl(var(--muted-foreground))" }}
          className="text-sm"
        >
          Esta cotización ya fue convertida y queda inmutable. El estado interno
          permanece como referencia histórica.
        </p>
      </Card>
    );
  }

  // ── Render por estado ──
  return (
    <>
      <FeedbackBanners errorMsg={errorMsg} />

      {estado === "borrador" && (
        <Card tone="muted" titulo="📝 Borrador">
          <p
            className="text-sm mb-3"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Esta cotización aún no se ha enviado al cliente. Mientras esté en
            borrador podés editarla libremente.
          </p>
          <div className="flex flex-wrap gap-2">
            <BtnPrimary disabled={loading} onClick={enviar}>
              📤 Marcar como enviada
            </BtnPrimary>
            <BtnDanger disabled={loading} onClick={descartar}>
              🗑️ Descartar
            </BtnDanger>
          </div>
        </Card>
      )}

      {estado === "enviada" && (
        <Card tone="info" titulo="📤 Enviada — esperando respuesta">
          <p
            className="text-sm mb-2"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Enviada {cotizacion.enviada_at && formatDate(cotizacion.enviada_at)}{" "}
            · vigencia {cotizacion.vigencia_dias ?? 15} días desde la fecha.
          </p>
          <div className="space-y-2 mt-3">
            <div>
              <label
                className="text-xs"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Nota de aprobación (opcional — cómo respondió el cliente)
              </label>
              <input
                type="text"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Ej. WhatsApp 4pm, llamada, en persona..."
                className="w-full mt-1 px-3 py-2 rounded-lg border text-sm min-h-[44px]"
                style={{
                  backgroundColor: "hsl(var(--background))",
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
              />
            </div>
            <div>
              <label
                className="text-xs"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Razón de rechazo (obligatoria si rechaza)
              </label>
              <input
                type="text"
                value={razon}
                onChange={(e) => setRazon(e.target.value)}
                placeholder="Ej. precio, cambió proveedor, no contesta..."
                className="w-full mt-1 px-3 py-2 rounded-lg border text-sm min-h-[44px]"
                style={{
                  backgroundColor: "hsl(var(--background))",
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
              />
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <BtnSuccess disabled={loading} onClick={aprobar}>
                ✅ Cliente aprobó
              </BtnSuccess>
              <BtnDanger disabled={loading} onClick={rechazar}>
                ❌ Cliente rechazó
              </BtnDanger>
            </div>
          </div>
        </Card>
      )}

      {estado === "aprobada" && (
        <Card tone="success" titulo="✅ Aprobada">
          <p
            className="text-sm mb-1"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Aprobada{" "}
            {cotizacion.aprobada_at && formatDate(cotizacion.aprobada_at)}
          </p>
          {cotizacion.nota_aprobacion && (
            <p
              className="text-sm italic mb-3"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Nota: "{cotizacion.nota_aprobacion}"
            </p>
          )}
          <p
            className="text-sm mb-3"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Lista para convertirse en venta o asociarse a una OT.
          </p>
          {esAdmin && (
            <BtnSecondary disabled={loading} onClick={revertir}>
              ↩️ Revertir aprobación (Admin)
            </BtnSecondary>
          )}
        </Card>
      )}

      {estado === "rechazada" && (
        <Card tone="destructive" titulo="❌ Rechazada">
          {cotizacion.razon_rechazo && (
            <p
              className="text-sm mb-2"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Razón: <strong>{cotizacion.razon_rechazo}</strong>
            </p>
          )}
          <p
            className="text-sm"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Rechazada{" "}
            {cotizacion.rechazada_at && formatDate(cotizacion.rechazada_at)}.
            Solo lectura.
          </p>
        </Card>
      )}

      {estado === "vencida" && (
        <Card tone="warning" titulo="⏰ Vencida">
          <p
            className="text-sm mb-3"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Pasó la vigencia (
            {cotizacion.vencida_at && formatDate(cotizacion.vencida_at)}). Solo
            lectura.
          </p>
          {esAdmin && (
            <BtnSecondary disabled={loading} onClick={revertir}>
              ↻ Reactivar (renueva vigencia)
            </BtnSecondary>
          )}
        </Card>
      )}

      <ConfirmDialog />
    </>
  );
}

// ── Subcomponentes ──────────────────────────────────────────────────────────
function Card({ tone, titulo, children }) {
  return (
    <div
      className="rounded-xl border p-4 space-y-1"
      style={{
        backgroundColor: `hsl(var(--${tone}) / 0.06)`,
        borderColor: `hsl(var(--${tone}) / 0.4)`,
      }}
    >
      <h3
        className="text-sm font-semibold"
        style={{ color: `hsl(var(--${tone}))` }}
      >
        {titulo}
      </h3>
      {children}
    </div>
  );
}

function BtnPrimary({ children, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-sm px-4 py-2 rounded-lg cursor-pointer min-h-[48px] disabled:opacity-50"
      style={{
        backgroundColor: "hsl(var(--primary))",
        color: "hsl(var(--primary-foreground))",
      }}
    >
      {children}
    </button>
  );
}

function BtnSuccess({ children, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-sm px-4 py-2 rounded-lg cursor-pointer min-h-[48px] disabled:opacity-50"
      style={{
        backgroundColor: "hsl(var(--success))",
        color: "hsl(var(--primary-foreground))",
      }}
    >
      {children}
    </button>
  );
}

function BtnDanger({ children, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-sm px-4 py-2 rounded-lg border cursor-pointer min-h-[48px] disabled:opacity-50"
      style={{
        borderColor: "hsl(var(--destructive))",
        color: "hsl(var(--destructive))",
        backgroundColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}

function BtnSecondary({ children, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-sm px-4 py-2 rounded-lg border cursor-pointer min-h-[44px] disabled:opacity-50"
      style={{
        borderColor: "hsl(var(--border))",
        color: "hsl(var(--muted-foreground))",
        backgroundColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}
