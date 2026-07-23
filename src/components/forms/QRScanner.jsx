import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { supabase } from "../../lib/supabase";

const SCANNER_ID = "qr-scanner-viewport";

// Cuánto se muestra la confirmación/aviso de cada lectura en modo continuo antes
// de volver a aceptar el siguiente código.
const PAUSA_CONTINUO_MS = 1000;

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

// continuo=true habilita el "modo escaneo en cadena": tras cada lectura válida
// no se cierra el modal ni se detiene la cámara, para no pagar 1-2s de arranque
// por cada línea de una compra/traspaso de muchos ítems.
export default function QRScanner({ onFound, onClose, continuo = false }) {
  const scannerRef = useRef(null);
  const [status, setStatus] = useState("starting");
  const [errorMsg, setErrorMsg] = useState("");
  const [intento, setIntento] = useState(0);
  const [linternaDisponible, setLinternaDisponible] = useState(false);
  const [linternaOn, setLinternaOn] = useState(false);

  // Estado propio del modo continuo: contador de la sesión y aviso breve
  // (éxito o error) que se superpone al video sin detener el escaneo.
  const [contador, setContador] = useState(0);
  const [aviso, setAviso] = useState(null); // { tipo: "ok" | "error", texto }

  // `procesandoRef` reemplaza al viejo doble uso de `cancelled`: antes esa
  // variable servía tanto para "el componente se desmontó" como para "ya
  // encontré un código, ignora el resto" — y en modo continuo esas dos cosas
  // deben poder ser falsas/verdaderas de forma independiente. Aquí
  // `procesandoRef` SOLO significa "hay una lectura en curso (consultando o
  // mostrando el aviso)"; el desmontaje se maneja con la variable local
  // `desmontado` dentro del efecto.
  const procesandoRef = useRef(false);
  // Último texto decodificado y aceptado, para el anti-rebote en modo continuo
  // (la cámara decodifica el mismo QR muchas veces por segundo mientras el
  // operario todavía lo tiene enfocado). Solo se libera cuando el código sale
  // del cuadro (ver `fallosRef`), NO por tiempo: como agregar el mismo
  // producto otra vez suma una unidad al carrito, soltarlo por temporizador
  // haría que dejar el celular apuntando a la etiqueta sumara unidades solo.
  const ultimoTextoRef = useRef(null);
  // Frames seguidos en los que no se decodificó nada: así sabemos que el QR
  // ya salió del cuadro y se puede volver a aceptar el mismo código.
  const fallosRef = useRef(0);
  // Timer que reanuda el escaneo tras la pausa visual en modo continuo.
  const resumeTimerRef = useRef(null);

  // El escáner en modo continuo vive muchos segundos, pero el efecto que
  // registra el callback de lectura solo corre al montar: guardamos `onFound`
  // en un ref para llamar SIEMPRE al handler del último render. Sin esto, toda
  // la cadena de lecturas usaría el handler capturado al abrir el modal, con
  // el estado de la pantalla congelado en ese instante (p. ej. la lista de
  // componentes de Ensambles, que dejaría de detectar repetidos).
  const onFoundRef = useRef(onFound);
  useEffect(() => {
    onFoundRef.current = onFound;
  });

  useEffect(() => {
    let desmontado = false;
    let scanner = null;

    // Cada intento (mount o Reintentar) arranca una lectura limpia: si venía
    // bloqueado de un intento anterior, aquí se libera.
    procesandoRef.current = false;
    ultimoTextoRef.current = null;
    fallosRef.current = 0;
    clearTimeout(resumeTimerRef.current);

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

    // html5-qrcode llama a este callback en CADA frame en el que no encuentra
    // código: es la única señal de que el QR ya salió del cuadro.
    //
    // El umbral se mide en frames seguidos SIN decodificar. A 10 fps, exigir 10
    // equivale a un segundo entero sin ver ninguna etiqueta. Se eligió alto a
    // propósito: con un umbral corto (3 frames = 0,3s) bastaba un reflejo o un
    // temblor de mano para que la etiqueta "desapareciera" un instante estando
    // todavía enfrente, se liberara el anti-rebote y el mismo producto se
    // sumara dos veces al carrito. Equivocarse hacia el lado lento solo obliga
    // a apartar la cámara un segundo para repetir un producto; equivocarse
    // hacia el lado rápido mete unidades fantasma en una compra.
    const FRAMES_SIN_CODIGO_PARA_LIBERAR = 10;

    const onNoDecoded = () => {
      if (!continuo || desmontado || ultimoTextoRef.current === null) return;
      fallosRef.current += 1;
      if (fallosRef.current >= FRAMES_SIN_CODIGO_PARA_LIBERAR) {
        fallosRef.current = 0;
        ultimoTextoRef.current = null;
      }
    };

    const onDecoded = async (decodedText) => {
      if (desmontado) return;
      fallosRef.current = 0;
      // Bloquea re-entradas mientras se procesa la lectura anterior (consulta
      // en curso o mostrando el aviso/confirmación).
      if (procesandoRef.current) return;

      const texto = decodedText.trim();

      // Anti-rebote: en modo continuo, mientras el mismo código siga en cuadro
      // la cámara lo vuelve a decodificar varias veces por segundo. Ignorar
      // repeticiones del último código aceptado.
      if (continuo && texto === ultimoTextoRef.current) return;

      procesandoRef.current = true;
      if (continuo) ultimoTextoRef.current = texto;

      if (!continuo) {
        // Modo clásico: una sola lectura y se cierra la cámara de inmediato.
        setStatus("found");
        detener(scanner);
      }

      // No filtramos por activo aquí para poder distinguir "no existe" de
      // "existe pero está desactivado" y dar un mensaje claro al operador.
      // El try/catch no es decorativo: si la consulta reventara (fetch abortado
      // al perder la red), la excepción dejaría `procesandoRef` en true para
      // siempre y el escáner quedaría mudo el resto de la sesión.
      let data = null;
      let error = null;
      try {
        ({ data, error } = await supabase
          .from("productos")
          .select("id, activo")
          .eq("referencia", texto)
          .maybeSingle());
      } catch (e) {
        error = e;
      }

      if (desmontado) return;

      let mensaje = null;
      let encontrado = false;
      if (error) {
        // BUG real corregido: antes se descartaba `error` y una falla de red
        // (sin señal en el fondo de la bodega) terminaba mostrando "Referencia
        // no encontrada", culpando a la etiqueta cuando el problema era la
        // conexión. Mismo criterio y mensaje que VentaNueva.jsx (#S1-19).
        mensaje =
          "No se pudo consultar el producto. Revisa la conexión e intenta de nuevo.";
      } else if (data?.id && data.activo) {
        encontrado = true;
      } else if (data?.id && !data.activo) {
        mensaje = `Este producto está desactivado: ${texto}`;
      } else {
        mensaje = `Referencia no encontrada: ${texto}`;
      }

      if (!continuo) {
        if (encontrado) {
          onFoundRef.current(data.id);
        } else {
          setStatus("error");
          setErrorMsg(mensaje);
        }
        return;
      }

      // --- Desde aquí, modo continuo ---
      // Un "no encontrada" o un error de red NO debe matar la sesión: se
      // muestra el aviso y se sigue escaneando.
      if (encontrado) {
        onFoundRef.current(data.id);
        setContador((n) => n + 1);
        setAviso({ tipo: "ok", texto });
      } else {
        setAviso({ tipo: "error", texto: mensaje });
      }

      resumeTimerRef.current = setTimeout(() => {
        if (desmontado) return;
        procesandoRef.current = false;
        setAviso(null);
      }, PAUSA_CONTINUO_MS);
    };

    // StrictMode (dev) monta→desmonta→monta el componente de forma síncrona.
    // Diferir el arranque un tick hace que el montaje descartado limpie su
    // timer ANTES de que dispare → solo se crea UN scanner: sin pelea por la
    // cámara ni dobles llamadas a getUserMedia.
    const timer = setTimeout(async () => {
      // La cámara necesita un contexto seguro (HTTPS/localhost) y soporte de
      // mediaDevices en el navegador.
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!desmontado) {
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
        if (desmontado) return;
        setStatus("error");
        setErrorMsg(traducirError(err));
        return;
      }
      if (desmontado) return;

      // Con el permiso ya concedido, arrancar html5-qrcode.
      try {
        // `formatsToSupport` va en el CONSTRUCTOR (Html5QrcodeFullConfig), no
        // en `start()` — ahí es donde la librería arma el decodificador
        // interno (ver getSupportedFormats en html5-qrcode.js). Se restringe
        // a QR_CODE porque la app solo sabe buscar por referencia: sin este
        // filtro, html5-qrcode también intenta decodificar ~17 formatos de
        // código de barras 1D (EAN, UPC, CODE_128...) y cualquier etiqueta de
        // fábrica ajena solo produce un falso "Referencia no encontrada",
        // además de gastar CPU/batería de más a 10fps en tablets baratas.
        // El día que se quiera soportar códigos de barras de fábrica, es aquí
        // donde se amplía la lista.
        scanner = new Html5Qrcode(SCANNER_ID, {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          verbose: false,
        });
        scannerRef.current = scanner;
      } catch (err) {
        if (!desmontado) {
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
          onNoDecoded,
        )
        .then(() => {
          // Si se desmontó mientras la cámara arrancaba, detener de inmediato.
          if (desmontado) {
            detener(scanner);
            return;
          }
          setStatus("scanning");
          // Detectar soporte de linterna (torch). No todos los navegadores lo
          // exponen (iOS Safari típicamente no) — si falla, el botón
          // simplemente no se pinta, nunca debe reventar el escáner.
          try {
            const soportaTorch = scanner
              .getRunningTrackCameraCapabilities()
              .torchFeature()
              .isSupported();
            setLinternaDisponible(!!soportaTorch);
          } catch {
            /* sin soporte de torch: el botón no se pinta */
          }
        })
        .catch((err) => {
          if (desmontado) return;
          setStatus("error");
          setErrorMsg(traducirError(err));
        });
    }, 0);

    return () => {
      desmontado = true;
      clearTimeout(timer);
      clearTimeout(resumeTimerRef.current);
      detener(scanner);
    };
  }, [intento]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enciende/apaga la linterna del track activo. Es un extra: si el
  // dispositivo o navegador no coopera, se falla en silencio y no se rompe
  // el escaneo.
  const alternarLinterna = async () => {
    const sc = scannerRef.current;
    if (!sc) return;
    try {
      const torch = sc.getRunningTrackCameraCapabilities().torchFeature();
      if (!torch.isSupported()) return;
      const nuevoEstado = !linternaOn;
      await torch.apply(nuevoEstado);
      setLinternaOn(nuevoEstado);
    } catch {
      /* la linterna es un extra: si falla, seguimos sin ella */
    }
  };

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
          <div className="flex items-center gap-1">
            {status === "scanning" && linternaDisponible && (
              <button
                onClick={alternarLinterna}
                className="w-12 h-12 flex items-center justify-center rounded-xl transition-colors cursor-pointer"
                style={{
                  color: linternaOn
                    ? "hsl(var(--warning))"
                    : "hsl(var(--muted-foreground))",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "hsl(var(--muted))";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "";
                }}
                aria-label={
                  linternaOn ? "Apagar linterna" : "Encender linterna"
                }
                title={linternaOn ? "Apagar linterna" : "Encender linterna"}
              >
                <FlashIcon on={linternaOn} />
              </button>
            )}
            <button
              onClick={onClose}
              className="w-12 h-12 flex items-center justify-center rounded-xl transition-colors cursor-pointer"
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

          {/* Modo continuo: contador de la sesión, siempre visible mientras se escanea. */}
          {continuo && status === "scanning" && (
            <div
              className="absolute top-2 right-2 px-2.5 py-1 rounded-full text-xs font-semibold"
              style={{
                backgroundColor: "hsl(var(--card) / 0.9)",
                color: "hsl(var(--foreground))",
              }}
            >
              {contador} escaneado{contador === 1 ? "" : "s"}
            </div>
          )}

          {/* Modo continuo: confirmación/aviso breve por cada lectura, sin
              detener la cámara ni cerrar el modal. */}
          {continuo && aviso && (
            <div
              className="absolute inset-0 flex items-center justify-center px-4 text-center"
              style={{
                backgroundColor:
                  aviso.tipo === "ok"
                    ? "hsl(var(--success) / 0.85)"
                    : "hsl(var(--destructive) / 0.85)",
              }}
            >
              <div className="flex flex-col items-center gap-2 text-white">
                {aviso.tipo === "ok" && (
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: "rgba(255,255,255,0.2)" }}
                  >
                    <CheckIcon />
                  </div>
                )}
                {/* "Leído" y no "Agregado": el escáner solo sabe que la
                    referencia existe y está activa; quien decide si entra al
                    carrito es la pantalla (puede rechazarla por insumo, por
                    sede o por falta de stock, y avisa con su propio toast). */}
                <p className="text-sm font-medium">
                  {aviso.tipo === "ok" ? `Leído: ${aviso.texto}` : aviso.texto}
                </p>
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
                setLinternaDisponible(false);
                setLinternaOn(false);
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
            <p
              className="text-xs text-center"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              También puedes cerrar el escáner y escribir la referencia en el
              buscador.
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

function FlashIcon({ on }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={on ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
    </svg>
  );
}
