import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { useAuthStore } from "../../../stores/authStore";
import { supabase } from "../../../lib/supabase";
import { formatDate, safeError } from "../../../lib/utils";
import PageHeader from "../../../components/layout/PageHeader";
import { lineaNueva } from "../../../lib/picking-compras";

/**
 * Picking de recepción de compras — esqueleto (Task 8 del plan).
 *
 * Carga la compra, aplica las guardas y ofrece retomar un conteo sin
 * terminar. El modo enfoque (Task 9), el modo lista y la confirmación contra
 * `fn_procesar_picking_compra` (Task 10) llegan después: esta pantalla
 * todavía no escribe nada en Supabase.
 */

const claveBorrador = (id) => `picking:${id}`;

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

      {/* Placeholder de la línea actual — el modo enfoque real llega en la
          Task 9 (LineaEnfoque + escáner). Por ahora solo confirma que la
          carga y el recorrido funcionan. */}
      {lineaActual && (
        <div
          className="rounded-xl border p-5"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          <p
            className="font-mono text-xs"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {lineaActual.referencia || "Sin referencia"}
          </p>
          <p
            className="text-lg font-bold"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {lineaActual.nombre || "Producto sin nombre"}
          </p>
          <p
            className="text-xs tabular-nums"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Pedido: {lineaActual.pedido}
          </p>
        </div>
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
