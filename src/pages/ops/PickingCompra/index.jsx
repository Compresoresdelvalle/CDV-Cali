import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ScanLine, AlertTriangle, LayoutList, Rows3 } from "lucide-react";
import { useAuthStore } from "../../../stores/authStore";
import { supabase } from "../../../lib/supabase";
import { formatDate, safeError } from "../../../lib/utils";
import { avisarInfo, avisarOk, avisarError } from "../../../lib/notify";
import PageHeader from "../../../components/layout/PageHeader";
import QRScanner from "../../../components/forms/QRScanner";
import { useConfirm } from "../../../components/ui/ConfirmDialog";
import {
  lineaNueva,
  METODO,
  resumen as calcularResumen,
  construirPayload,
} from "../../../lib/picking-compras";
import LineaEnfoque from "./LineaEnfoque";
import LineaListaCard, { LineaListaFila } from "./LineaLista";
import ModalConfirmar from "./ModalConfirmar";

/**
 * Picking de recepción de compras (Task 8 a 10 del plan).
 *
 * Cuenta lo que de verdad llegó ANTES de recibir la compra. Modo enfoque
 * (celular, un producto por pantalla) y modo lista (tablet/escritorio, todas
 * las líneas a la vez) comparten el mismo estado y la misma aritmética
 * (`derivar`/`resumen` de picking-compras.js): cambiar de modo nunca pierde
 * ni recalcula distinto el conteo.
 */

const claveBorrador = (id) => `picking:${id}`;
const claveModo = "picking-modo";
const clampEntero = (v) => Math.max(0, Math.round(Number(v) || 0));

/**
 * Valor inicial del conmutador Enfoque/Lista.
 *
 * Se lee la preferencia guardada primero; si nunca se eligió, se decide por
 * el ancho de pantalla en el momento de montar (celular → enfoque, tablet o
 * más ancho → lista), no preguntando. A propósito NO hay un listener de
 * resize: rotar la tablet a mitad de un conteo no debe saltar de modo solo —
 * el conteo (estado de `lineas`) es el mismo en los dos modos, así que nada
 * se pierde, pero cambiar de vista sin que el operario lo pida sería más
 * confuso que útil a mitad de tarea. El cambio explícito sigue disponible en
 * el conmutador y esa elección sí se recuerda.
 */
function modoInicial() {
  try {
    const guardado = localStorage.getItem(claveModo);
    if (guardado === "enfoque" || guardado === "lista") return guardado;
  } catch {
    /* localStorage no disponible: se decide por ancho */
  }
  return typeof window !== "undefined" && window.innerWidth >= 768
    ? "lista"
    : "enfoque";
}

function haceTiempo(ts) {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return "hace un momento";
  if (mins === 1) return "hace 1 minuto";
  if (mins < 60) return `hace ${mins} minutos`;
  const horas = Math.round(mins / 60);
  return horas <= 1 ? "hace 1 hora" : `hace ${horas} horas`;
}

export default function PickingCompra() {
  const { id } = useParams();
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const { confirm, ConfirmDialog } = useConfirm();

  const [compra, setCompra] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lineas, setLineas] = useState([]);
  // Borrador recuperado de localStorage, pendiente de que el operario decida
  // si lo retoma o empieza de nuevo. Mientras no haya tocado nada no se
  // persiste, para que "Retomar" no compita contra una escritura a mitad de
  // camino; pero en cuanto cuenta una línea sí se guarda, aunque el banner
  // siga arriba (ver el efecto de guardado más abajo).
  const [borrador, setBorrador] = useState(null);
  const [index, setIndex] = useState(0);
  const [scannerOpen, setScannerOpen] = useState(false);
  // Más de una línea de esta compra comparte la misma referencia escaneada
  // (p. ej. el mismo producto pedido para venta Y como insumo): se pregunta
  // en vez de adivinar cuál sumar.
  const [desambiguar, setDesambiguar] = useState(null);
  const [modo, setModo] = useState(modoInicial);
  const [confirmarOpen, setConfirmarOpen] = useState(false);
  const [procesando, setProcesando] = useState(false);

  const cambiarModo = useCallback((m) => {
    setModo(m);
    try {
      localStorage.setItem(claveModo, m);
    } catch {
      /* preferencia no persistida: sigue funcionando solo en esta sesión */
    }
  }, []);

  /* ── Cargar la compra ─────────────────────────────────────── */
  useEffect(() => {
    let cancelado = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: err } = await supabase
          .from("compras")
          .select(
            `id, numero, proveedor, factura_proveedor, sede_destino_id,
             total, recibida, fecha_recepcion, estado,
             detalle_compra ( id, producto_id, cantidad, costo_unitario, destino,
                              producto:producto_id ( referencia, nombre ) )`,
          )
          .eq("id", id)
          .maybeSingle();
        if (err) throw err;
        if (cancelado) return;

        setCompra(data);
        const lineasCompra = data?.detalle_compra ?? [];
        setLineas(lineasCompra.map(lineaNueva));
        setIndex(0);

        // Ofrecer el borrador solo si el CONJUNTO de líneas coincide (ver
        // comentario largo en picking-recepcion-compras.md Task 8 Step 2):
        // si alguien editó la compra entre el borrador y la vuelta, aplicar
        // conteos guardados sobre líneas que ya no son las mismas es peor que
        // perder el borrador.
        try {
          const crudo = localStorage.getItem(claveBorrador(id));
          if (crudo) {
            const { ts, lineas: guardadas } = JSON.parse(crudo);
            const idsAhora = new Set(lineasCompra.map((det) => det.id));
            const mismasLineas =
              Array.isArray(guardadas) &&
              guardadas.length === idsAhora.size &&
              guardadas.every((g) => idsAhora.has(g.detalle_id));
            if (mismasLineas) setBorrador({ ts, lineas: guardadas });
            else localStorage.removeItem(claveBorrador(id));
          }
        } catch {
          localStorage.removeItem(claveBorrador(id));
        }
      } catch (e) {
        if (!cancelado) setError(safeError(e, "No se pudo cargar la compra"));
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [id]);

  /* ── Persistir el conteo en cada cambio ───────────────────────
   * Sin esto, la primera vez que se apague un celular en la línea 38 de 40 no
   * vuelven a contar nunca. Perder el borrador (modo privado, cuota llena) no
   * puede tumbar la pantalla — de ahí el try/catch mudo.
   */
  useEffect(() => {
    // Ojo con `borrador`: NO se puede saltar el guardado solo porque el banner
    // de "retomar" siga en pantalla. Nada impide contar con el banner puesto, y
    // un operario que lo ignora porque va a contar de cero perdia todo su
    // trabajo en silencio si se le apagaba el celular. Solo se salta mientras
    // no haya tocado nada: en cuanto hay una linea contada, se persiste.
    const hayConteo = lineas.some((l) => l.contada);
    if (loading || lineas.length === 0) return;
    if (borrador && !hayConteo) return;
    try {
      localStorage.setItem(
        claveBorrador(id),
        JSON.stringify({ ts: Date.now(), lineas }),
      );
    } catch {
      /* modo privado o cuota llena: se sigue contando sin persistir */
    }
  }, [id, lineas, loading, borrador]);

  // Si el mismo conteo se abre en otra pestaña del mismo navegador, no hay
  // bloqueo entre ambas: la última que escriba gana y la otra pierde sus
  // conteos en silencio. Este listener no lo evita (mezclar los dos estados
  // en caliente sería peor), pero al menos avisa para que el operario no siga
  // contando a ciegas sobre una copia que ya quedó vieja.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== claveBorrador(id) || !e.newValue) return;
      avisarInfo(
        "Este conteo se actualizó desde otra pestaña. Antes de seguir, recarga esta página para no perder trabajo.",
        { duration: 8000 },
      );
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [id]);

  const lineasCompra = compra?.detalle_compra ?? [];

  /* ── Guardas — antes de pintar nada ───────────────────────────
   * Cada una con su mensaje y su salida: nunca una pantalla en blanco ni un
   * "no autorizado" pelado.
   */
  const bloqueo = useMemo(() => {
    // RoleGuard ya garantiza sesión + rol antes de montar esta pantalla; este
    // chequeo es solo una red de seguridad para no reventar contra `perfil`
    // en el instante improbable de un logout a mitad de carga.
    if (!perfil) return { txt: "Tu sesión cambió. Vuelve a entrar.", a: "/login" };
    if (!compra) return { txt: "Esa compra no existe o fue eliminada.", a: "/ops/compras" };
    if (compra.estado === "cancelada")
      return {
        txt: `La compra #${compra.numero} está cancelada: no hay nada que recibir.`,
        a: `/ops/compras/${id}`,
      };
    if (compra.recibida)
      return {
        txt: `La compra #${compra.numero} ya se recibió el ${formatDate(compra.fecha_recepcion)}.`,
        a: `/ops/compras/${id}`,
      };
    if (lineasCompra.length === 0)
      return {
        txt: `La compra #${compra.numero} no tiene productos que contar. Recíbela directamente desde su detalle.`,
        a: `/ops/compras/${id}`,
      };
    if (perfil.rol !== "Admin" && compra.sede_destino_id !== perfil.sede_id)
      return {
        txt: `Esta compra es de la sede ${compra.sede_destino_id} y tú estás en ${perfil.sede_id}. Pídesela a quien reciba allí o a Maritza.`,
        a: `/ops/compras/${id}`,
      };
    return null;
  }, [compra, lineasCompra.length, perfil, id]);

  /* ── Handlers de conteo ───────────────────────────────────── */
  const actualizarCantidad = useCallback((detalleId, valor) => {
    const n = clampEntero(valor);
    setLineas((prev) =>
      prev.map((l) =>
        l.detalle_id === detalleId
          ? {
              ...l,
              llegaron: n,
              // Las dañadas se recortan AQUI, no solo al pintar. Si no, bajar
              // "llegaron" y volver a subirlo resucitaba un conteo viejo de
              // dañadas sobre unidades distintas, y eso si llega al reclamo
              // que se le manda al proveedor.
              danadas: Math.min(l.danadas ?? 0, n),
              contada: true,
              metodo: METODO.MANUAL,
            }
          : l,
      ),
    );
  }, []);

  const actualizarDanadas = useCallback((detalleId, valor) => {
    const n = clampEntero(valor);
    setLineas((prev) =>
      prev.map((l) => (l.detalle_id === detalleId ? { ...l, danadas: n } : l)),
    );
  }, []);

  const marcarCompleto = useCallback((detalleId, pedido) => {
    setLineas((prev) =>
      prev.map((l) =>
        l.detalle_id === detalleId
          ? { ...l, llegaron: pedido, contada: true, metodo: METODO.COMPLETO }
          : l,
      ),
    );
  }, []);

  const marcarNada = useCallback(
    async (detalleId) => {
      const ok = await confirm({
        titulo: "¿No llegó nada de este producto?",
        mensaje:
          "Esa línea se borra de la factura: no queda nada que ajustar ni reclamar por separado, porque no llegó ni una unidad.",
        confirmLabel: "Sí, no llegó nada",
        cancelLabel: "Cancelar",
        danger: true,
      });
      if (!ok) return;
      setLineas((prev) =>
        prev.map((l) =>
          l.detalle_id === detalleId
            ? {
                ...l,
                llegaron: 0,
                danadas: 0,
                contada: true,
                metodo: METODO.NADA,
                faltante_accion: null,
                sobrante_accion: null,
              }
            : l,
        ),
      );
    },
    [confirm],
  );

  const elegirFaltante = useCallback((detalleId, accion) => {
    setLineas((prev) =>
      prev.map((l) =>
        l.detalle_id === detalleId ? { ...l, faltante_accion: accion } : l,
      ),
    );
  }, []);

  const elegirSobrante = useCallback((detalleId, accion) => {
    setLineas((prev) =>
      prev.map((l) =>
        l.detalle_id === detalleId ? { ...l, sobrante_accion: accion } : l,
      ),
    );
  }, []);

  const sumarUno = useCallback((detalleId, metodo) => {
    setLineas((prev) =>
      prev.map((l) =>
        l.detalle_id === detalleId
          ? { ...l, llegaron: l.llegaron + 1, contada: true, metodo }
          : l,
      ),
    );
  }, []);

  const irALinea = useCallback(
    (detalleId) => {
      const idx = lineas.findIndex((l) => l.detalle_id === detalleId);
      if (idx !== -1) setIndex(idx);
    },
    [lineas],
  );

  /* ── Escáner (Task 9) ─────────────────────────────────────────
   * OJO: QRScanner entrega el `id` del producto (uuid), NUNCA el texto crudo
   * leído — lo valida y lo resuelve él mismo contra `productos` antes de
   * llamar a onFound (ver src/components/forms/QRScanner.jsx). Por eso se
   * compara contra `producto_id`, no contra `referencia`.
   */
  const handleScanFound = useCallback(
    (productoId) => {
      const coincidencias = lineas.filter((l) => l.producto_id === productoId);
      if (coincidencias.length === 0) {
        avisarInfo(
          `Ese producto no está en la compra #${compra?.numero ?? ""}.`,
        );
      } else if (coincidencias.length === 1) {
        sumarUno(coincidencias[0].detalle_id, METODO.ESCANER);
        irALinea(coincidencias[0].detalle_id);
      } else {
        // Se cierra el escaner: los dos overlays viven en z-50 sin portal, y
        // el del escaner se pinta despues en el DOM, asi que ganaba el y el
        // dialogo quedaba montado pero invisible. El operario veia que "no
        // paso nada" al escanear y no tenia con que interactuar.
        setScannerOpen(false);
        setDesambiguar(coincidencias);
      }
    },
    [lineas, compra, sumarUno, irALinea],
  );

  const elegirDesambiguacion = (detalleId) => {
    sumarUno(detalleId, METODO.ESCANER);
    irALinea(detalleId);
    setDesambiguar(null);
  };

  const retomarBorrador = () => {
    setLineas(borrador.lineas);
    setBorrador(null);
  };

  const empezarDeNuevo = () => {
    try {
      localStorage.removeItem(claveBorrador(id));
    } catch {
      /* nada que limpiar si ya falló guardar */
    }
    setBorrador(null);
  };

  /* ── Resumen y confirmación (Task 10) ─────────────────────────
   * `resumen()` vive en picking-compras.js y es la MISMA función que decide
   * el badge de cada línea (vía `derivar`): la barra fija de abajo y el modal
   * de confirmación nunca pueden contradecir lo que ya se ve en pantalla.
   */
  const r = useMemo(() => calcularResumen(lineas), [lineas]);

  const confirmarPicking = useCallback(async () => {
    setProcesando(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc(
        "fn_procesar_picking_compra",
        {
          p_compra_id: id,
          p_lineas: construirPayload(lineas),
          p_omitido: false,
        },
      );
      if (rpcErr) throw rpcErr;

      // Solo se limpia el borrador CUANDO el servidor confirmó — si algo
      // falla a mitad de camino (red, o la compra ya la recibieron desde
      // otro dispositivo), el conteo sigue guardado y el operario puede
      // reintentar sin volver a contar nada.
      try {
        localStorage.removeItem(claveBorrador(id));
      } catch {
        /* nada que limpiar si ya falló guardar */
      }
      avisarOk(
        data?.reclamadas > 0
          ? `Compra #${data.numero ?? compra?.numero} recibida · ${data.reclamadas} unidad${data.reclamadas === 1 ? "" : "es"} para reclamar`
          : `Compra #${data?.numero ?? compra?.numero} recibida`,
      );
      navigate(`/ops/compras/${id}`);
      return true;
    } catch (e) {
      // safeError conserva el mensaje P0001 tal cual lo redactó la RPC (el
      // "por qué" y qué hacer) — no se reemplaza por un texto genérico.
      avisarError(e, "No se pudo recibir la compra");

      // Si el rechazo vino de que otro dispositivo ya recibió o canceló esta
      // compra mientras se contaba, reintentar va a fallar exactamente igual, y
      // la regla del proyecto es no dejar en pantalla un botón que no puede
      // funcionar. Se relee el estado: si ya no se puede recibir, `bloqueo`
      // recalcula solo y la pantalla pasa a explicarlo con salida.
      //
      // No es paranoia: en bodega es normal tener la tablet y el celular
      // abiertos a la vez, y el conteo puede durar veinte minutos.
      try {
        const { data: fresca } = await supabase
          .from("compras")
          .select("recibida, fecha_recepcion, estado")
          .eq("id", id)
          .maybeSingle();
        if (fresca && (fresca.recibida || fresca.estado === "cancelada")) {
          setCompra((prev) => (prev ? { ...prev, ...fresca } : prev));
        }
      } catch {
        // Si ni siquiera se puede releer (red caída), se deja la pantalla como
        // está: el operario conserva su conteo y puede reintentar más tarde.
      }
      return false;
    } finally {
      setProcesando(false);
    }
  }, [id, lineas, navigate, compra]);

  /* ── Render ───────────────────────────────────────────────── */
  if (loading) {
    return (
      <div
        className="p-4 sm:p-6 space-y-4 animate-fade-in"
        style={{ backgroundColor: "hsl(var(--background))" }}
      >
        <div className="flex items-center justify-center py-24">
          <div
            className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin"
            style={{
              borderColor: "hsl(var(--primary))",
              borderTopColor: "transparent",
            }}
          />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="p-4 sm:p-6 space-y-4 animate-fade-in"
        style={{ backgroundColor: "hsl(var(--background))" }}
      >
        <AvisoBloqueo texto={error} volverA="/ops/compras" />
      </div>
    );
  }

  if (bloqueo) {
    return (
      <div
        className="p-4 sm:p-6 space-y-4 animate-fade-in"
        style={{ backgroundColor: "hsl(var(--background))" }}
      >
        <AvisoBloqueo texto={bloqueo.txt} volverA={bloqueo.a} />
      </div>
    );
  }

  const total = lineas.length;
  const contadas = lineas.filter((l) => l.contada).length;
  // Primera linea sin contar, para poder saltar directo a lo que falta en vez
  // de hacer que el operario recorra de a una buscandola.
  const indiceSinContar = lineas.findIndex((l) => !l.contada);
  const pct = total > 0 ? (contadas / total) * 100 : 0;
  const lineaActual = lineas[index] ?? null;

  return (
    <div
      // pb extra: deja espacio para la barra de resumen fija de abajo (ver
      // más adelante) — el mismo patrón que ya usan RecepcionTraspaso y
      // EtiquetasImprimir para no repetir el bug de FALLA 6 (botón tapado por
      // el bottom-nav móvil).
      className="p-4 sm:p-6 pb-36 lg:pb-28 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title={`Contar compra #${compra.numero}`}
        description={
          compra.factura_proveedor
            ? `${compra.proveedor} · Factura ${compra.factura_proveedor}`
            : compra.proveedor
        }
        actions={
          <div className="flex items-center gap-2">
            <ModoSwitch modo={modo} onChange={cambiarModo} />
            <Link
              to={`/ops/compras/${id}`}
              className="inline-flex items-center gap-2 rounded-lg border px-4 text-sm font-medium"
              style={{
                minHeight: 48,
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              <ArrowLeft className="h-4 w-4" />
              Volver
            </Link>
          </div>
        }
      />

      {borrador && (
        <div
          className="rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center gap-3"
          style={{
            borderColor: "hsl(var(--info) / 0.4)",
            backgroundColor: "hsl(var(--info) / 0.08)",
          }}
        >
          <p
            className="text-sm flex-1"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Tienes un conteo sin terminar de {haceTiempo(borrador.ts)}, ¿lo
            retomo?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={empezarDeNuevo}
              className="rounded-lg border px-4 text-sm font-medium"
              style={{
                minHeight: 48,
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              Empezar de nuevo
            </button>
            <button
              type="button"
              onClick={retomarBorrador}
              className="rounded-lg px-4 text-sm font-semibold"
              style={{
                minHeight: 48,
                backgroundColor: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
              }}
            >
              Retomar
            </button>
          </div>
        </div>
      )}

      {/* Progreso */}
      <div
        className="rounded-xl border p-4"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div className="flex items-center justify-between text-sm mb-2">
          {/* "Producto X de N" solo tiene sentido en enfoque: en lista no hay
              una línea "actual", se ven todas a la vez. */}
          {modo === "enfoque" ? (
            <span style={{ color: "hsl(var(--foreground))" }}>
              Producto {index + 1} de {total}
            </span>
          ) : (
            <span style={{ color: "hsl(var(--foreground))" }}>
              {total} producto{total === 1 ? "" : "s"} en esta compra
            </span>
          )}
          <span
            className="tabular-nums"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {contadas} de {total} contados
          </span>
        </div>
        <div
          className="h-2 rounded-full overflow-hidden"
          style={{ backgroundColor: "hsl(var(--muted))" }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: "hsl(var(--primary))" }}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => setScannerOpen(true)}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl font-semibold text-sm"
        style={{
          minHeight: 48,
          backgroundColor: "hsl(var(--primary) / 0.1)",
          color: "hsl(var(--primary))",
          border: "1px solid hsl(var(--primary) / 0.35)",
        }}
      >
        <ScanLine className="h-4 w-4" />
        Escanear producto
      </button>

      {modo === "enfoque" ? (
        <>
          {lineaActual && (
            <LineaEnfoque
              linea={lineaActual}
              onCantidad={actualizarCantidad}
              onDanadas={actualizarDanadas}
              onCompleto={marcarCompleto}
              onNada={marcarNada}
              onFaltanteAccion={elegirFaltante}
              onSobranteAccion={elegirSobrante}
            />
          )}

          {/* En la ultima linea NO se pinta "Siguiente": tener dos botones de
              avanzar (uno que no lleva a ningun lado y otro que recibe la
              compra) confunde, y lo reporto el dueño probandolo. Si quedan
              lineas sin contar, el boton lleva a la primera que falta en vez de
              avanzar de a una. */}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              className="flex-1 rounded-lg border text-sm font-medium disabled:opacity-40"
              style={{
                minHeight: 48,
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--foreground))",
              }}
            >
              Anterior
            </button>
            {index < total - 1 ? (
              <button
                type="button"
                onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
                className="flex-1 rounded-lg border text-sm font-medium"
                style={{
                  minHeight: 48,
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
              >
                Siguiente
              </button>
            ) : indiceSinContar >= 0 ? (
              <button
                type="button"
                onClick={() => setIndex(indiceSinContar)}
                className="flex-1 rounded-lg border text-sm font-medium"
                style={{
                  minHeight: 48,
                  borderColor: "hsl(var(--warning) / 0.5)",
                  backgroundColor: "hsl(var(--warning) / 0.08)",
                  color: "hsl(var(--warning))",
                }}
              >
                Ir a lo que falta
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <>
          {/* Regla #5 — desktop tabla / mobile cards. Aquí el corte es `lg`
              (no `md`) porque el conmutador ya deja "Enfoque" como la opción
              de celular; "Lista" se usa desde tablet hacia arriba y hasta
              ahí sigue rindiendo mejor como tarjetas de una columna. */}
          <div
            className="hidden lg:block overflow-x-auto rounded-xl border"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <table className="w-full border-collapse">
              <thead>
                <tr
                  className="text-left text-xs font-semibold uppercase tracking-wide border-b"
                  style={{
                    color: "hsl(var(--muted-foreground))",
                    borderColor: "hsl(var(--border))",
                    backgroundColor: "hsl(var(--muted) / 0.3)",
                  }}
                >
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2 text-center">Pedido</th>
                  <th className="px-3 py-2">Llegaron</th>
                  <th className="px-3 py-2">Dañadas</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Decisión</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => (
                  <LineaListaFila
                    key={l.detalle_id}
                    linea={l}
                    onCantidad={actualizarCantidad}
                    onDanadas={actualizarDanadas}
                    onCompleto={marcarCompleto}
                    onNada={marcarNada}
                    onFaltanteAccion={elegirFaltante}
                    onSobranteAccion={elegirSobrante}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <ul className="lg:hidden space-y-2.5" role="list">
            {lineas.map((l) => (
              <li key={l.detalle_id}>
                <LineaListaCard
                  linea={l}
                  onCantidad={actualizarCantidad}
                  onDanadas={actualizarDanadas}
                  onCompleto={marcarCompleto}
                  onNada={marcarNada}
                  onFaltanteAccion={elegirFaltante}
                  onSobranteAccion={elegirSobrante}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {desambiguar && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => setDesambiguar(null)}
        >
          <div
            className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-3"
            style={{ backgroundColor: "hsl(var(--card))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              className="text-base font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Este producto está en más de una línea. ¿Cuál sumas?
            </h3>
            <div className="space-y-2">
              {desambiguar.map((l) => (
                <button
                  key={l.detalle_id}
                  type="button"
                  onClick={() => elegirDesambiguacion(l.detalle_id)}
                  className="w-full text-left rounded-lg border px-4 py-3"
                  style={{
                    minHeight: 56,
                    borderColor: "hsl(var(--border))",
                    backgroundColor: "hsl(var(--background))",
                  }}
                >
                  <p
                    className="text-sm font-medium"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {l.nombre} · {l.destino === "insumo" ? "Insumo" : "Venta"}
                  </p>
                  <p
                    className="text-xs tabular-nums"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    Llevaba {l.llegaron} de {l.pedido}
                  </p>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setDesambiguar(null)}
              className="w-full rounded-lg border text-sm font-medium"
              style={{
                minHeight: 48,
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {scannerOpen && (
        <QRScanner
          onFound={handleScanFound}
          onClose={() => setScannerOpen(false)}
          continuo
        />
      )}

      {/* Barra de resumen — fija y por encima del bottom-nav móvil. Mismo
          truco que RecepcionTraspaso (FALLA 6, botón antes tapado por el
          bottom-nav): offset de 5rem + safe-area en móvil, `lg:bottom-0`
          porque en escritorio no hay bottom-nav debajo. */}
      <div
        className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-0 right-0 z-40 border-t p-4 lg:bottom-0"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div className="mx-auto max-w-3xl flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p
              className="text-sm font-medium tabular-nums truncate"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {r.contadas === r.total
                ? `Ya contaste las ${r.total} línea${r.total === 1 ? "" : "s"}`
                : `Llevas ${r.contadas} de ${r.total} línea${r.total === 1 ? "" : "s"}`}
              {r.aReclamar > 0 &&
                ` · ${r.aReclamar} unidad${r.aReclamar === 1 ? "" : "es"} para reclamarle al proveedor`}
              {r.deMas > 0 &&
                ` · ${r.deMas} de más que entran al inventario`}
            </p>
            {r.motivoBloqueo && (
              <p
                className="text-xs"
                style={{ color: "hsl(var(--warning))" }}
              >
                {r.motivoBloqueo}
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={!r.listo || procesando}
            onClick={() => setConfirmarOpen(true)}
            className="rounded-xl font-semibold text-sm px-6 disabled:opacity-50 shrink-0"
            style={{
              minHeight: 48,
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            Confirmar recepción
          </button>
        </div>
      </div>

      {confirmarOpen && (
        <ModalConfirmar
          compra={compra}
          lineas={lineas}
          resumen={r}
          onConfirm={confirmarPicking}
          onClose={() => setConfirmarOpen(false)}
        />
      )}

      <ConfirmDialog />
    </div>
  );
}

function ModoSwitch({ modo, onChange }) {
  return (
    <div
      className="inline-flex rounded-lg border p-0.5"
      style={{ borderColor: "hsl(var(--border))" }}
      role="tablist"
      aria-label="Modo de conteo"
    >
      <button
        type="button"
        role="tab"
        aria-selected={modo === "enfoque"}
        onClick={() => onChange("enfoque")}
        className="inline-flex items-center gap-1.5 rounded-md px-3 text-xs font-medium"
        style={{
          minHeight: 48,
          backgroundColor:
            modo === "enfoque" ? "hsl(var(--primary) / 0.12)" : "transparent",
          color:
            modo === "enfoque"
              ? "hsl(var(--primary))"
              : "hsl(var(--muted-foreground))",
        }}
      >
        <Rows3 className="h-3.5 w-3.5" />
        Enfoque
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={modo === "lista"}
        onClick={() => onChange("lista")}
        className="inline-flex items-center gap-1.5 rounded-md px-3 text-xs font-medium"
        style={{
          minHeight: 48,
          backgroundColor:
            modo === "lista" ? "hsl(var(--primary) / 0.12)" : "transparent",
          color:
            modo === "lista"
              ? "hsl(var(--primary))"
              : "hsl(var(--muted-foreground))",
        }}
      >
        <LayoutList className="h-3.5 w-3.5" />
        Lista
      </button>
    </div>
  );
}

function AvisoBloqueo({ texto, volverA }) {
  const navigate = useNavigate();
  return (
    <div
      className="rounded-xl border p-6 flex flex-col items-center text-center gap-3 max-w-md mx-auto mt-12"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <AlertTriangle className="h-8 w-8" style={{ color: "hsl(var(--warning))" }} />
      <p className="text-sm" style={{ color: "hsl(var(--foreground))" }}>
        {texto}
      </p>
      <button
        type="button"
        onClick={() => navigate(volverA)}
        className="rounded-lg px-5 text-sm font-semibold"
        style={{
          minHeight: 48,
          backgroundColor: "hsl(var(--primary))",
          color: "hsl(var(--primary-foreground))",
        }}
      >
        Volver
      </button>
    </div>
  );
}
