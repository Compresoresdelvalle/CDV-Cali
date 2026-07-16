import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { supabase } from "../../lib/supabase";

const SCANNER_ID = "qr-scanner-viewport";

// Traduce el error real de getUserMedia (DOMException) a un mensaje accionable.
// html5-qrcode convierte sus errores en string y pierde `err.name`; por eso
// pedimos el permiso de cámara nosotros mismos para obtener el error original.
function traducirError(err) {
  const name = err?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return 'El navegador tiene bloqueada la cámara. Toca el ícono de cámara (o el candado) en la barra de direcciones, elige "Permitir cámara" y pulsa Reintentar.';
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return "No se encontró ninguna cámara en este dispositivo.";
  if (name === "NotReadableError" || name === "TrackStartError")
    return "La cámara está siendo usada por otra aplicación. Ciérrala y pulsa Reintentar.";
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError")
    return "La cámara del dispositivo no es compatible con el escáner.";
  if (location.protocol !== "https:" && location.hostname !== "localhost")
    return "La cámara solo funciona en sitios HTTPS o en localhost.";
  return "No se pudo acceder a la cámara. Pulsa Reintentar.";
}

export default function QRScanner({ onFound, onClose }) {
  const scannerRef = useRef(null);
  const [status, setStatus] = useState("starting");
  const [errorMsg, setErrorMsg] = useState("");
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let scanner = null;

    // Detiene y limpia el scanner de forma SEGURA.
    // OJO: html5-qrcode `stop()` lanza una excepción SÍNCRONA (no una promesa
    // rechazable) si el scanner todavía no está escaneando — un `.catch()`
    // encadenado NO atrapa un throw síncrono, hay que envolverlo en try/catch.
    const detener = (sc) => {
      if (!sc) return;
      try {
        const p = sc.stop();
        if (p && typeof p.then === "function") {
          p.catch(() => {}).finally(() => {
            try {
              sc.clear();
            } catch {
              /* ignore */
            }
          });
          return;
        }
      } catch {
        /* el scanner no estaba escaneando — ignorar */
      }
      try {
        sc.clear();
      } catch {
        /* ignore */
      }
    };

    const onDecoded = async (decodedText) => {
      if (cancelled) return;
      cancelled = true;
      setStatus("found");
      detener(scanner);

      // No filtramos por activo aquí para poder distinguir "no existe" de
      // "existe pero está desactivado" y dar un mensaje claro al operador.
      const { data } = await supabase
        .from("productos")
        .select("id, activo")
        .eq("referencia", decodedText.trim())
        .maybeSingle();

      if (data?.id && data.activo) {
        onFound(data.id);
      } else if (data?.id && !data.activo) {
        setStatus("error");
        setErrorMsg(`Este producto está desactivado: ${decodedText}`);
      } else {
        setStatus("error");
        setErrorMsg(`Referencia no encontrada: ${decodedText}`);
      }
    };

    // StrictMode (dev) monta→desmonta→monta el componente de forma síncrona.
    // Diferir el arranque un tick hace que el montaje descartado limpie su
    // timer ANTES de que dispare → solo se crea UN scanner: sin pelea por la
    // cámara ni dobles llamadas a getUserMedia.
    const timer = setTimeout(async () => {
      // La cámara necesita un contexto seguro (HTTPS/localhost) y soporte de
      // mediaDevices en el navegador.
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(
            location.protocol !== "https:" && location.hostname !== "localhost"
              ? "La cámara solo funciona en sitios HTTPS o en localhost."
              : "Este navegador no permite el acceso a la cámara.",
          );
        }
        return;
      }

      // Pedir permiso de cámara EXPLÍCITAMENTE: esto dispara el prompt del
      // navegador (si el permiso está sin decidir) y nos da el error REAL
      // — html5-qrcode lo convierte en string y se pierde `err.name`.
      // El stream de prueba se libera enseguida; html5-qrcode abrirá el suyo.
      try {
        const probe = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        probe.getTracks().forEach((t) => t.stop());
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(traducirError(err));
        return;
      }
      if (cancelled) return;

      // Con el permiso ya concedido, arrancar html5-qrcode.
      try {
        scanner = new Html5Qrcode(SCANNER_ID);
        scannerRef.current = scanner;
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(traducirError(err));
        }
        return;
      }
      scanner
        .start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          onDecoded,
          () => {},
        )
        .then(() => {
          // Si se desmontó mientras la cámara arrancaba, detener de inmediato.
          if (cancelled) detener(scanner);
          else setStatus("scanning");
        })
        .catch((err) => {
          if (cancelled) return;
          setStatus("error");
          setErrorMsg(traducirError(err));
        });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      detener(scanner);
    };
  }, [intento]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full sm:w-auto sm:min-w-[360px] rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden animate-fade-up"
        style={{ backgroundColor: "hsl(var(--card))" }}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: "hsl(var(--primary) / 0.1)" }}
            >
              <QRIcon />
            </div>
            <div>
              <p
                className="font-semibold text-sm"
                style={{ color: "hsl(var(--foreground))" }}
              >
                Escáner QR
              </p>
              <p
                className="text-xs"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {status === "scanning"
                  ? "Apunta al código QR del producto"
                  : status === "found"
                    ? "Código encontrado"
                    : status === "error"
                      ? "Error al escanear"
                      : "Iniciando cámara..."}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors cursor-pointer"
            style={{ color: "hsl(var(--muted-foreground))" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "hsl(var(--muted))";
              e.currentTarget.style.color = "hsl(var(--foreground))";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "";
              e.currentTarget.style.color = "hsl(var(--muted-foreground))";
            }}
            aria-label="Cerrar escáner"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="relative bg-black" style={{ height: 300 }}>
          <div id={SCANNER_ID} className="w-full h-full" />

          {status === "starting" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <div className="flex flex-col items-center gap-3 text-white">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <p className="text-sm">Iniciando cámara…</p>
              </div>
            </div>
          )}

          {status === "found" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <div className="flex flex-col items-center gap-2 text-white">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: "hsl(var(--success))" }}
                >
                  <CheckIcon />
                </div>
                <p className="text-sm font-medium">Buscando producto…</p>
              </div>
            </div>
          )}
        </div>

        {status === "error" && (
          <div
            className="px-5 py-4 border-t space-y-3"
            style={{
              backgroundColor: "hsl(var(--destructive) / 0.05)",
              borderColor: "hsl(var(--destructive) / 0.2)",
            }}
          >
            <p
              className="text-sm font-medium"
              style={{ color: "hsl(var(--destructive))" }}
            >
              {errorMsg}
            </p>
            <button
              onClick={() => {
                setErrorMsg("");
                setStatus("starting");
                setIntento((n) => n + 1);
              }}
              className="w-full py-2.5 rounded-xl text-sm font-semibold cursor-pointer min-h-[44px]"
              style={{
                backgroundColor: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
              }}
            >
              Reintentar
            </button>
          </div>
        )}

        <div
          className="px-5 py-4 border-t"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl text-sm font-semibold transition-colors cursor-pointer min-h-[48px]"
            style={{
              backgroundColor: "hsl(var(--muted) / 0.5)",
              color: "hsl(var(--muted-foreground))",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = "hsl(var(--muted))")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor =
                "hsl(var(--muted) / 0.5)")
            }
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function QRIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ color: "hsl(var(--primary))" }}
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h.01M18 14h.01M14 18h.01M18 18h.01M14 14v4h4v-4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.5 4.5 13.5 13.5M13.5 4.5 4.5 13.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 13l4 4L19 7"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
