import { useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { avisarError } from "../../lib/notify";

/**
 * Escala una situación al Admin desde donde el operario esté trabajando.
 *
 * El tope de avisos NO se lleva aquí: lo cuenta la RPC contra `dedupe_key`. Si
 * viviera en este estado, recargar la página lo reiniciaría. Lo que sí hace el
 * componente es reflejar lo que la RPC le responde.
 *
 * Props:
 *   origen    : "compra"
 *   origenId  : uuid del documento
 *   className : clases extra opcionales
 */
export default function BotonAvisarAdmin({ origen, origenId, className = "" }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(null); // { admin_nombre, restantes }

  const enviar = async () => {
    if (enviando) return;
    setEnviando(true);
    try {
      const { data, error } = await supabase.rpc("fn_escalar_a_admin", {
        p_origen: origen,
        p_origen_id: origenId,
        p_motivo: motivo,
      });
      if (error) throw error;
      setEnviado(data);
      setAbierto(false);
      setMotivo("");
    } catch (err) {
      avisarError(err, "No se pudo avisar");
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <div
        className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${className}`}
        style={{
          borderColor: "hsl(var(--success) / 0.35)",
          backgroundColor: "hsl(var(--success) / 0.08)",
          color: "hsl(var(--foreground))",
        }}
        role="status"
      >
        <Check
          className="mt-0.5 h-3.5 w-3.5 shrink-0"
          style={{ color: "hsl(var(--success))" }}
        />
        <span>
          Ya se le avisó a <strong>{enviado.admin_nombre}</strong>.{" "}
          {enviado.restantes > 0
            ? `Queda ${enviado.restantes} aviso si la cosa sigue.`
            : "No quedan más avisos: si es urgente, búscala directamente."}
        </span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium ${className}`}
        style={{
          minHeight: 48,
          borderColor: "hsl(var(--warning) / 0.4)",
          backgroundColor: "hsl(var(--warning) / 0.08)",
          color: "hsl(var(--warning))",
        }}
      >
        <AlertTriangle className="h-4 w-4" />
        Avisar al administrador
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => !enviando && setAbierto(false)}
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
              ¿Qué está pasando?
            </h3>
            <p
              className="text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Escríbelo corto y concreto. Le va a salir en pantalla apenas abra
              la aplicación, así que entre más claro, menos llamadas.
            </p>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              autoFocus
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                backgroundColor: "hsl(var(--background))",
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--foreground))",
              }}
              placeholder="Llegaron 3 cajas rotas y no sé si recibirlas"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAbierto(false)}
                disabled={enviando}
                className="flex-1 rounded-lg border text-sm"
                style={{
                  minHeight: 48,
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={enviar}
                disabled={enviando || motivo.trim().length < 5}
                className="flex-1 rounded-lg text-sm font-medium text-white disabled:opacity-40"
                style={{
                  minHeight: 48,
                  backgroundColor: "hsl(var(--warning))",
                }}
              >
                {enviando ? "Avisando…" : "Avisar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
