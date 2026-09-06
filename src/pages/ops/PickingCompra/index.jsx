import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ScanLine, AlertTriangle } from "lucide-react";
import { useAuthStore } from "../../../stores/authStore";
import { supabase } from "../../../lib/supabase";
import { formatDate, safeError } from "../../../lib/utils";
import { avisarInfo } from "../../../lib/notify";
import PageHeader from "../../../components/layout/PageHeader";
import QRScanner from "../../../components/forms/QRScanner";
import { useConfirm } from "../../../components/ui/ConfirmDialog";
import { lineaNueva, METODO } from "../../../lib/picking-compras";
import LineaEnfoque from "./LineaEnfoque";

/**
 * Picking de recepción de compras — modo enfoque (Task 8 + Task 9 del plan).
 *
 * Cuenta lo que de verdad llegó ANTES de recibir la compra. El modo lista, el
 * resumen bloqueante y la confirmación contra `fn_procesar_picking_compra`
 * quedan para la Task 10: esta pantalla todavía no escribe nada en Supabase.
 */

const claveBorrador = (id) => `picking:${id}`;
const clampEntero = (v) => Math.max(0, Math.round(Number(v) || 0));

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
  const perfil = useAuthStore((s) => s.perfil);
  const { confirm, ConfirmDialog } = useConfirm();

  const [compra, setCompra] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lineas, setLineas] = useState([]);
  // Borrador recuperado de localStorage, pendiente de que el operario decida
  // si lo retoma o empieza de nuevo. Mientras esté sin decidir NO se persiste
  // (ver el efecto de guardado más abajo): así "Retomar" nunca compite contra
  // una escritura a mitad de camino.
  const [borrador, setBorrador] = useState(null);
  const [index, setIndex] = useState(0);
  const [scannerOpen, setScannerOpen] = useState(false);
  // Más de una línea de esta compra comparte la misma referencia escaneada
  // (p. ej. el mismo producto pedido para venta Y como insumo): se pregunta
  // en vez de adivinar cuál sumar.
  const [desambiguar, setDesambiguar] = useState(null);

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
    if (loading || borrador || lineas.length === 0) return;
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
          ? { ...l, llegaron: n, contada: true, metodo: METODO.MANUAL }
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
  const pct = total > 0 ? (contadas / total) * 100 : 0;
  const lineaActual = lineas[index] ?? null;

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
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
          <span style={{ color: "hsl(var(--foreground))" }}>
            Producto {index + 1} de {total}
          </span>
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
        <button
          type="button"
          disabled={index >= total - 1}
          onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
          className="flex-1 rounded-lg border text-sm font-medium disabled:opacity-40"
          style={{
            minHeight: 48,
            borderColor: "hsl(var(--border))",
            color: "hsl(var(--foreground))",
          }}
        >
          Siguiente
        </button>
      </div>

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

      <ConfirmDialog />
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
