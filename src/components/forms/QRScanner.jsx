import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { supabase } from "../../lib/supabase";

const SCANNER_ID = "qr-scanner-viewport";

export default function QRScanner({ onFound, onClose }) {
  const scannerRef = useRef(null);
  const [status, setStatus] = useState("starting");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let scanner = null;
    let stopped = false;

    const startScanner = async () => {
      try {
        scanner = new Html5Qrcode(SCANNER_ID);
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          async (decodedText) => {
            if (stopped) return;
            stopped = true;
            setStatus("found");

            try {
              await scanner.stop();
            } catch {
              /* ignore */
            }

            const { data } = await supabase
              .from("productos")
              .select("id")
              .eq("referencia", decodedText.trim())
              .eq("activo", true)
              .maybeSingle();

            if (data?.id) {
              onFound(data.id);
            } else {
              setStatus("error");
              setErrorMsg(`Referencia no encontrada: ${decodedText}`);
            }
          },
          () => {},
        );
        if (!stopped) setStatus("scanning");
      } catch (err) {
        setStatus("error");
        // Mensaje específico según el error de permisos
        if (err?.name === "NotAllowedError") {
          setErrorMsg(
            "Permiso de cámara denegado. Habilítalo en la configuración del navegador.",
          );
        } else if (err?.name === "NotFoundError") {
          setErrorMsg("No se detectó cámara en este dispositivo.");
        } else if (
          location.protocol !== "https:" &&
          location.hostname !== "localhost"
        ) {
          setErrorMsg("La cámara solo funciona en HTTPS o localhost.");
        } else {
          setErrorMsg(err?.message ?? "No se pudo acceder a la cámara");
        }
      }
    };

    startScanner();

    // Cleanup robusto: stop() + clear() siempre que exista la instancia,
    // independiente de isScanning (puede estar en estado "starting" si el
    // componente se desmonta antes de que start() resuelva).
    return () => {
      stopped = true;
      const sc = scannerRef.current;
      if (!sc) return;
      sc.stop()
        .catch(() => {}) // no estaba scanning
        .finally(() => {
          sc.clear().catch(() => {}); // libera el video element y los tracks
        });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
            className="px-5 py-4 border-t"
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
            <p
              className="text-xs mt-1"
              style={{ color: "hsl(var(--destructive) / 0.7)" }}
            >
              Verifica que el QR corresponda a un producto del sistema.
            </p>
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
