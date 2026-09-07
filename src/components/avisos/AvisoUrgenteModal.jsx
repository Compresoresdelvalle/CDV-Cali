import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { formatDate } from "../../lib/utils";

/**
 * Modal bloqueante para los escalamientos.
 *
 * Solo lo ve el Admin y solo para `tipo === 'escalamiento'`: las notificaciones
 * normales siguen tranquilas en la campana. Se apoya en que
 * `useNotificaciones` ya carga las NO LEIDAS al montar, así que si el Admin no
 * estaba conectado cuando le avisaron, esto es lo primero que ve al abrir la
 * app sin necesidad de nada extra.
 *
 * Si hay varios sin leer se muestran en cola, uno por uno.
 *
 * Props:
 *   items     : notificaciones del hook (ya filtradas por para_rol)
 *   perfil    : usuario en sesión
 *   onMarcar  : (id) => Promise<void>  — el `marcarUna` del hook
 */
// z-200 y no z-100: ConfirmDialog (que se usa en toda la app),
// AnularGarantiaModal, Clientes y VentaNueva ya viven en z-[100]. Con empate
// decide el orden del DOM, y éste es justamente el aviso que NO se puede perder
// debajo de otra cosa.
const Z_ENCIMA_DE_TODO =
  "fixed inset-0 z-[200] flex items-center justify-center p-4";

export default function AvisoUrgenteModal({ items, perfil, onMarcar }) {
  const navigate = useNavigate();

  const pendientes = useMemo(
    () => (items ?? []).filter((n) => n.tipo === "escalamiento" && !n.leida),
    [items],
  );

  if (perfil?.rol !== "Admin" || pendientes.length === 0) return null;

  const n = pendientes[0];
  const ruta = n.data?.ruta ?? null;
  const numero = n.data?.numero ?? null;

  const entendido = async () => {
    await onMarcar?.(n.id);
  };

  const irAlDocumento = async () => {
    await onMarcar?.(n.id);
    if (ruta) navigate(ruta);
  };

  return (
    <div
      className={Z_ENCIMA_DE_TODO}
      style={{ backgroundColor: "rgba(0,0,0,0.72)" }}
      role="alertdialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg space-y-4 rounded-xl border p-6"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--warning) / 0.5)",
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg"
            style={{ backgroundColor: "hsl(var(--warning) / 0.15)" }}
          >
            <AlertTriangle
              className="h-5 w-5"
              style={{ color: "hsl(var(--warning))" }}
            />
          </div>
          <div className="flex-1">
            <h2
              className="text-lg font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {n.titulo}
            </h2>
            <p
              className="mt-0.5 text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {n.data?.usuario_nombre ?? "Un operario"}
              {n.data?.sede_id ? ` · ${n.data.sede_id}` : ""} ·{" "}
              {formatDate(n.created_at)}
            </p>
          </div>
        </div>

        <p
          className="whitespace-pre-line rounded-lg border px-4 py-3 text-sm"
          style={{
            backgroundColor: "hsl(var(--muted) / 0.3)",
            borderColor: "hsl(var(--border))",
            color: "hsl(var(--foreground))",
          }}
        >
          {n.mensaje}
        </p>

        {pendientes.length > 1 && (
          <p
            className="text-xs"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Hay {pendientes.length - 1} aviso
            {pendientes.length - 1 === 1 ? "" : "s"} más esperando.
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          {ruta && (
            <button
              type="button"
              onClick={irAlDocumento}
              className="flex-1 rounded-lg text-sm font-medium text-white"
              style={{ minHeight: 48, backgroundColor: "hsl(var(--primary))" }}
            >
              Ir a la compra{numero ? ` #${numero}` : ""}
            </button>
          )}
          <button
            type="button"
            onClick={entendido}
            className="flex-1 rounded-lg border text-sm font-medium"
            style={{
              minHeight: 48,
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
