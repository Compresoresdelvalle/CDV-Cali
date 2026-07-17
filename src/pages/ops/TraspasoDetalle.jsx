import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeftCircle,
  ArrowRight,
  Truck,
  Package,
  Shield,
  Activity,
  Check,
  AlertTriangle,
  PlayCircle,
  Printer,
  PackageCheck,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatDate, formatCOP, safeError } from "../../lib/utils";
import {
  sedeLabel,
  traspasoEstadoPill,
  traspasoBadge,
  TRASPASO_FLUJO,
  flujoIndex,
} from "../../lib/traspasos-ui";
import {
  Avatar,
  Pill,
  TipoBadge,
} from "../../components/traspasos/TraspasoBits";
import { useConfirm } from "../../components/ui/ConfirmDialog";

/* Estado real → kind del Pill de Lovable. */
const PILL_KIND = {
  borrador: "neut",
  picking: "info",
  verificado: "prog",
  en_transito: "warn",
  recibido: "succ",
  con_diferencia: "dang",
  cancelado: "dang",
};

export default function TraspasoDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [traspaso, setTraspaso] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [accionando, setAccionando] = useState(false);
  const [error, setError] = useState(null);
  const { confirm, ConfirmDialog } = useConfirm();

  const esAdmin = perfil?.rol === "Admin";
  const accionandoRef = useRef(false);

  // `silent`: re-fetch en segundo plano (Realtime) sin parpadear el skeleton
  // ni pisar la pantalla con un error de un refresco de fondo.
  const cargar = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [{ data: t, error: errT }, { data: d, error: errD }] =
        await Promise.all([
          supabase
            .from("traspasos")
            .select(
              `*,
               solicitante:solicitado_por(nombre),
               picker:picker_id(nombre),
               verificador:verificado_por(nombre),
               receptor:recibido_por(nombre)`,
            )
            .eq("id", id)
            .single(),
          supabase
            .from("detalle_traspaso")
            .select(
              `*, producto:producto_id(nombre, referencia, unidad_medida, precio_venta),
               ubicacion:ubicacion_origen_id(pasillo, estante, nivel, prioridad_picking)`,
            )
            .eq("traspaso_id", id)
            .order("created_at"),
        ]);
      if (errT) throw errT;
      setTraspaso(t);
      setItems(d ?? []);
      if (!silent && errD)
        setError("No se pudo cargar el detalle de productos.");
    } catch (e) {
      if (!silent) setError(safeError(e, "Error al cargar el traspaso"));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Realtime: refresca en vivo cuando otro usuario avanza el flujo
  // (picker → verificador → envío → recepción), sin necesidad de F5.
  useEffect(() => {
    if (!id) return;
    let t = null;
    const refrescar = () => {
      clearTimeout(t);
      t = setTimeout(() => cargar(true), 300);
    };
    const channel = supabase
      .channel(`traspaso-${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "traspasos",
          filter: `id=eq.${id}`,
        },
        refrescar,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "detalle_traspaso",
          filter: `traspaso_id=eq.${id}`,
        },
        refrescar,
      )
      .subscribe();
    return () => {
      clearTimeout(t);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── Acción: iniciar picking ───────────────────────────────
  const iniciarPicking = async () => {
    if (accionandoRef.current) return;
    accionandoRef.current = true;
    setError(null);
    setAccionando(true);
    try {
      const { error: rpcErr } = await supabase.rpc("fn_procesar_traspaso", {
        p_traspaso_id: id,
        p_accion: "iniciar_picking",
        p_items: null,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      navigate(`/ops/traspasos/${id}/picking`);
    } catch (e) {
      setError(safeError(e, "Error en operación de traspaso"));
    } finally {
      setAccionando(false);
      accionandoRef.current = false;
    }
  };

  // ── Acción: enviar (verificado → en_transito) ────────────
  const enviarTraspaso = async () => {
    if (accionandoRef.current) return;
    accionandoRef.current = true;
    setError(null);
    setAccionando(true);
    try {
      const { error: rpcErr } = await supabase.rpc("fn_procesar_traspaso", {
        p_traspaso_id: id,
        p_accion: "enviar",
        p_items: null,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      await cargar();
    } catch (e) {
      setError(safeError(e, "Error en operación de traspaso"));
    } finally {
      setAccionando(false);
      accionandoRef.current = false;
    }
  };

  // ── Acción: cancelar traspaso (#5 · solo Admin · solo no recibido) ──
  const cancelarTraspaso = async () => {
    if (accionandoRef.current) return;
    // Modal propio, no window.prompt: el prompt nativo se ve fuera del sistema
    // de diseño y algunos WebView/PWA directamente lo bloquean.
    const motivo = await confirm({
      titulo: "Cancelar traspaso",
      mensaje:
        "El traspaso quedará cancelado y no se moverá stock. Puedes anotar el motivo (opcional).",
      confirmLabel: "Cancelar traspaso",
      cancelLabel: "Volver",
      danger: true,
      input: { placeholder: "Motivo de la cancelación (opcional)…" },
    });
    if (motivo === false) return; // el Admin cerró el modal
    accionandoRef.current = true;
    setError(null);
    setAccionando(true);
    try {
      const { error: rpcErr } = await supabase.rpc("fn_cancelar_traspaso", {
        p_traspaso_id: id,
        p_motivo: motivo.trim() || null,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      await cargar();
    } catch (e) {
      setError(safeError(e, "Error al cancelar el traspaso"));
    } finally {
      setAccionando(false);
      accionandoRef.current = false;
    }
  };

  if (loading) return <LoadingView />;
  if (!traspaso)
    return <NotFoundView onBack={() => navigate("/ops/traspasos")} />;

  const yoSoyPicker = traspaso.picker_id === perfil?.id;
  const yoSoyDeSedeDestino =
    perfil?.sede_id === traspaso.sede_destino_id || esAdmin;
  // B6: en tiendas con un solo vendedor, el personal de la sede ORIGEN (incluido
  // el Vendedor) hace todo el lado de salida: iniciar picking, pickear y enviar.
  const yoSoyDeSedeOrigen =
    perfil?.sede_id === traspaso.sede_origen_id || esAdmin;

  const totalItems = items.length;
  const itemsCompletos = items.filter((i) => i.picking_completado).length;
  const pickingCompleto = totalItems > 0 && itemsCompletos === totalItems;

  const estado = traspaso.estado;
  const pill = traspasoEstadoPill(estado);
  const pillKind = PILL_KIND[estado] ?? "neut";
  const badge = traspasoBadge(traspaso.tipo);
  // Valor de la mercancía que se mueve (idea robada del prototipo): a precio de
  // venta × cantidad (enviada si ya salió, si no la solicitada).
  const valorMercancia = items.reduce(
    (s, it) =>
      s +
      (it.producto?.precio_venta ?? 0) *
        (it.cantidad_enviada ?? it.cantidad_solicitada ?? 0),
    0,
  );

  return (
    <div className="flex h-full flex-col gap-4 px-4 pb-14 pt-5 sm:px-7 sm:pt-6 animate-fade-in">
      <button
        onClick={() => navigate("/ops/traspasos")}
        className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-medium transition-colors"
        style={{ color: "var(--n-500)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--n-700)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--n-500)")}
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} /> Volver a
        Traspasos
      </button>

      {/* ── Cabecera ────────────────────────────────────────────────── */}
      <div
        className="flex items-start gap-5 border-b pb-4"
        style={{ borderColor: "var(--n-100)" }}
      >
        <div className="flex-1">
          <div
            className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em]"
            style={{ color: "var(--n-400)" }}
          >
            Traspaso entre sedes
          </div>
          <div
            className="mb-2 flex items-center gap-2 font-mono text-[28px] font-medium leading-[1.05] tracking-[-0.01em]"
            style={{ color: "var(--n-950)" }}
          >
            #{traspaso.numero}
            <TipoBadge badge={badge} />
          </div>
          <div
            className="flex flex-wrap items-center gap-2 text-[14px]"
            style={{ color: "var(--n-500)" }}
          >
            <span>
              Creado{" "}
              <b
                className="font-mono font-medium"
                style={{ color: "var(--n-700)" }}
              >
                {formatDate(traspaso.fecha)}
              </b>
            </span>
            {traspaso.fecha_recepcion && (
              <>
                <span>·</span>
                <span>
                  Recibido{" "}
                  <b
                    className="font-mono font-medium"
                    style={{ color: "var(--n-700)" }}
                  >
                    {formatDate(traspaso.fecha_recepcion)}
                  </b>
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2.5">
          <Pill kind={pillKind} label={pill.label} />
          {valorMercancia > 0 && (
            <div className="text-right">
              <div
                className="font-mono text-[10px] uppercase tracking-[0.1em]"
                style={{ color: "var(--n-400)" }}
              >
                Valor mercancía
              </div>
              <div
                className="font-mono text-[15px] font-semibold leading-tight"
                style={{ color: "var(--n-900)" }}
              >
                {formatCOP(valorMercancia)}
              </div>
            </div>
          )}
          <button
            onClick={() => window.print()}
            className="btn btn-out"
            style={{ height: 36 }}
          >
            <Printer className="h-3.5 w-3.5" strokeWidth={2} /> Imprimir guía
          </button>
        </div>
      </div>

      {estado !== "cancelado" && <TraspasoStepper estado={estado} />}

      {error && (
        <div
          role="alert"
          className="rounded-[10px] border px-4 py-3 text-sm"
          style={{
            backgroundColor: "var(--dang-50)",
            borderColor: "var(--dang-border)",
            color: "var(--dang-700)",
          }}
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* ── Columna izquierda ──────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-4">
          {/* Ruta */}
          <Block
            icon={<Truck className="h-3.5 w-3.5" strokeWidth={2} />}
            title="Ruta del traspaso"
          >
            <div className="grid grid-cols-[1fr_60px_1fr] items-stretch gap-2.5">
              <RouteBox
                kind="origen"
                wh={sedeLabel(traspaso.sede_origen_id)}
                nombre={traspaso.solicitante?.nombre}
                metaLabel="Solicitó"
                time={formatDate(traspaso.fecha)}
              />
              <div className="relative flex items-center justify-center">
                <div
                  className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2"
                  style={{
                    background:
                      "repeating-linear-gradient(90deg,var(--warn-border) 0 6px,transparent 6px 12px)",
                  }}
                />
                <div
                  className="relative z-[1] grid h-8 w-8 place-items-center rounded-full border-2"
                  style={{
                    borderColor: "var(--warn-border)",
                    backgroundColor: "var(--warn-50)",
                    color: "var(--warn-700)",
                  }}
                >
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                </div>
              </div>
              <RouteBox
                kind="destino"
                wh={sedeLabel(traspaso.sede_destino_id)}
                nombre={traspaso.receptor?.nombre}
                metaLabel={traspaso.receptor?.nombre ? "Recibió" : null}
                time={
                  traspaso.fecha_recepcion
                    ? formatDate(traspaso.fecha_recepcion)
                    : "Pendiente de recepción"
                }
              />
            </div>
          </Block>

          {/* Motivo */}
          {traspaso.observaciones && (
            <Block
              icon={<Shield className="h-3.5 w-3.5" strokeWidth={2} />}
              title="Motivo del traspaso"
            >
              {badge && (
                <div className="mb-2.5 flex items-center gap-2">
                  <TipoBadge badge={badge} />
                </div>
              )}
              <div
                className="text-[13px] leading-[1.55]"
                style={{ color: "var(--n-700)" }}
              >
                {traspaso.observaciones}
              </div>
            </Block>
          )}

          {/* Productos */}
          <Block
            icon={<Package className="h-3.5 w-3.5" strokeWidth={2} />}
            title={`Productos (${items.length})`}
          >
            {items.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--n-500)" }}>
                Sin productos.
              </p>
            ) : (
              <div className="flex flex-col">
                {items.map((l, i) => (
                  <ProductoRow
                    key={l.id}
                    item={l}
                    estado={estado}
                    last={i === items.length - 1}
                  />
                ))}
              </div>
            )}
          </Block>

          {/* Línea de tiempo */}
          <Block
            icon={<Activity className="h-3.5 w-3.5" strokeWidth={2} />}
            title="Línea de tiempo"
          >
            <Timeline traspaso={traspaso} />
          </Block>
        </div>

        {/* ── Columna derecha · panel de acción sticky ──────────────── */}
        <div className="lg:sticky lg:top-5 lg:self-start">
          <AccionPanel
            estado={estado}
            traspaso={traspaso}
            itemsCompletos={itemsCompletos}
            totalItems={totalItems}
            pickingCompleto={pickingCompleto}
            yoSoyPicker={yoSoyPicker}
            yoSoyDeSedeDestino={yoSoyDeSedeDestino}
            esAdmin={esAdmin}
            yoSoyDeSedeOrigen={yoSoyDeSedeOrigen}
            accionando={accionando}
            onIniciarPicking={iniciarPicking}
            onEnviar={enviarTraspaso}
            onIrPicking={() => navigate(`/ops/traspasos/${id}/picking`)}
            onRecibir={() => navigate(`/ops/traspasos/${id}/recibir`)}
            onCancelar={cancelarTraspaso}
          />
        </div>
      </div>

      <ConfirmDialog />
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

/**
 * Stepper horizontal del flujo (idea robada del prototipo): da sensación de
 * progreso "voy en el paso 2 de 4". Puramente visual, no cambia ninguna acción.
 */
function TraspasoStepper({ estado }) {
  const cur = flujoIndex(estado);
  return (
    <div
      className="shrink-0 overflow-x-auto overflow-y-hidden rounded-[10px] border p-3.5"
      style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
    >
      <div className="flex items-start" style={{ minWidth: 460 }}>
        {TRASPASO_FLUJO.map((paso, i) => {
          const done = cur > i;
          const active = cur === i;
          const dotBg = done
            ? "var(--succ-600)"
            : active
              ? "var(--p-600)"
              : "var(--n-0)";
          const dotBd = done
            ? "var(--succ-600)"
            : active
              ? "var(--p-600)"
              : "var(--n-200)";
          const dotFg = done || active ? "#fff" : "var(--n-400)";
          return (
            <div
              key={paso.key}
              className="flex flex-1 items-start"
              style={{ minWidth: 0 }}
            >
              <div
                className="flex flex-col items-center gap-1.5"
                style={{ width: 92, flexShrink: 0 }}
              >
                <span
                  className="flex items-center justify-center rounded-full font-mono text-[13px] font-semibold"
                  style={{
                    width: 32,
                    height: 32,
                    background: dotBg,
                    border: `2px solid ${dotBd}`,
                    color: dotFg,
                  }}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span
                  className="text-center text-[11.5px] leading-tight"
                  style={{
                    color: active ? "var(--n-900)" : "var(--n-500)",
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {paso.label}
                </span>
              </div>
              {i < TRASPASO_FLUJO.length - 1 && (
                <div
                  className="mt-4 h-[2px] flex-1 rounded"
                  style={{
                    background: cur > i ? "var(--succ-500)" : "var(--n-150)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Block({ icon, title, children }) {
  return (
    <div
      className="rounded-[10px] border p-4"
      style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
    >
      <div className="mb-3.5 flex items-center gap-2.5">
        <span
          className="grid h-[26px] w-[26px] place-items-center rounded-md"
          style={{ backgroundColor: "var(--n-50)", color: "var(--n-700)" }}
        >
          {icon}
        </span>
        <span
          className="flex-1 text-[13.5px] font-medium"
          style={{ color: "var(--n-950)" }}
        >
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function RouteBox({ kind, wh, nombre, metaLabel, time }) {
  const esOrigen = kind === "origen";
  return (
    <div
      className="flex flex-col gap-2 rounded-[10px] border p-3.5"
      style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-25)" }}
    >
      <div
        className="font-mono text-[10px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--n-400)" }}
      >
        {esOrigen ? "Origen" : "Destino"}
      </div>
      <div
        className="inline-flex items-center gap-1.5 font-mono text-[13px] font-medium"
        style={{ color: "var(--n-950)" }}
      >
        <Truck
          className="h-3.5 w-3.5"
          strokeWidth={2}
          style={{ color: esOrigen ? "var(--succ-600)" : "var(--info-600)" }}
        />
        {wh}
      </div>
      <div
        className="flex items-center gap-1.5 text-[12px]"
        style={{ color: "var(--n-700)" }}
      >
        <Avatar nombre={nombre} size={20} />
        {metaLabel ? `${metaLabel} ${nombre ?? "—"}` : "Sin asignar"}
      </div>
      <div className="font-mono text-[11px]" style={{ color: "var(--n-500)" }}>
        {time}
      </div>
    </div>
  );
}

function ProductoRow({ item, estado, last }) {
  const mostrarEnviado = [
    "picking",
    "verificado",
    "en_transito",
    "recibido",
    "con_diferencia",
  ].includes(estado);
  const mostrarRecibido = ["recibido", "con_diferencia"].includes(estado);
  const precio = item.producto?.precio_venta ?? 0;
  const qty = item.cantidad_enviada ?? item.cantidad_solicitada ?? 0;
  const recDiff =
    mostrarRecibido &&
    item.cantidad_recibida != null &&
    item.cantidad_recibida !== (item.cantidad_enviada ?? 0);

  return (
    <div
      className="grid grid-cols-[1fr_auto_auto] items-center gap-3.5 py-2.5"
      style={{ borderBottom: last ? "none" : "1px solid var(--n-100)" }}
    >
      <div className="flex min-w-0 flex-col leading-[1.3]">
        <span
          className="truncate text-[13px] font-medium"
          style={{ color: "var(--n-950)" }}
        >
          {item.producto?.nombre ?? "—"}
          {item.es_insumo && <span className="stk-pill i ml-1.5">Insumo</span>}
        </span>
        <span
          className="font-mono text-[11px]"
          style={{ color: "var(--n-500)" }}
        >
          {item.producto?.referencia ?? "—"}
        </span>
      </div>
      <div className="text-right">
        <span
          className="font-mono text-[13px] font-medium"
          style={{ color: "var(--n-950)" }}
        >
          ×{item.cantidad_solicitada}
        </span>
        {mostrarEnviado && (
          <span
            className="ml-2 font-mono text-[11px]"
            style={{ color: "var(--n-500)" }}
          >
            env. {item.cantidad_enviada ?? 0}
          </span>
        )}
        {mostrarRecibido && (
          <span
            className="ml-2 font-mono text-[11px] font-semibold"
            style={{ color: recDiff ? "var(--dang-700)" : "var(--succ-700)" }}
          >
            rec. {item.cantidad_recibida ?? 0}
          </span>
        )}
      </div>
      <span
        className="text-right font-mono text-[12.5px]"
        style={{ color: "var(--n-700)" }}
      >
        {formatCOP(precio * qty)}
      </span>
    </div>
  );
}

/**
 * Línea de tiempo derivada de los timestamps reales del traspaso.
 * Cada hito existe solo si su dato real está presente.
 */
function Timeline({ traspaso }) {
  const eventos = [];
  eventos.push({
    dot: "neut",
    act: "Traspaso creado",
    meta: `${sedeLabel(traspaso.sede_origen_id)} · ${
      traspaso.solicitante?.nombre ?? "—"
    }`,
    t: formatDate(traspaso.fecha),
  });
  if (traspaso.picker?.nombre) {
    eventos.push({
      dot: "info",
      act: "Picking",
      meta: `Picker: ${traspaso.picker.nombre}`,
      t: null,
    });
  }
  if (traspaso.verificador?.nombre) {
    eventos.push({
      dot: "prog",
      act: "Verificado",
      meta: `Verificó: ${traspaso.verificador.nombre}`,
      t: null,
    });
  }
  if (traspaso.estado === "en_transito") {
    eventos.push({
      dot: "warn",
      act: `En tránsito hacia ${sedeLabel(traspaso.sede_destino_id)}`,
      meta: "Esperando confirmación de recepción",
      t: null,
    });
  }
  if (traspaso.fecha_recepcion) {
    eventos.push({
      dot: traspaso.estado === "con_diferencia" ? "dang" : "succ",
      act:
        traspaso.estado === "con_diferencia"
          ? "Recibido con diferencias"
          : "Recibido",
      meta: traspaso.receptor?.nombre
        ? `Recibió: ${traspaso.receptor.nombre}`
        : sedeLabel(traspaso.sede_destino_id),
      t: formatDate(traspaso.fecha_recepcion),
    });
  }

  const dotColor = {
    neut: "var(--n-300)",
    info: "var(--info-500)",
    prog: "var(--prog-500)",
    warn: "var(--warn-500)",
    succ: "var(--succ-500)",
    dang: "var(--dang-500)",
  };

  return (
    <div className="flex flex-col pl-1.5">
      {eventos.map((e, i) => (
        <div
          key={i}
          className="relative grid grid-cols-[14px_1fr_auto] items-start gap-3 py-2"
        >
          {i < eventos.length - 1 && (
            <span
              className="absolute left-[6px] top-[18px] -bottom-1 w-px"
              style={{ backgroundColor: "var(--n-150)" }}
            />
          )}
          <span
            className="mt-[3px] h-[13px] w-[13px] rounded-full border-[2.5px]"
            style={{
              borderColor: "var(--n-0)",
              background: dotColor[e.dot],
              boxShadow: "0 0 0 1px var(--n-150)",
            }}
          />
          <div>
            <div
              className="text-[13px] font-medium"
              style={{ color: "var(--n-950)" }}
            >
              {e.act}
            </div>
            <div
              className="mt-0.5 font-mono text-[11px]"
              style={{ color: "var(--n-500)" }}
            >
              {e.meta}
            </div>
          </div>
          {e.t && (
            <div
              className="text-right font-mono text-[11px]"
              style={{ color: "var(--n-500)" }}
            >
              {e.t}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Panel de acción sticky — reproduce el lenguaje visual del panel de recepción
 * de Lovable (card con borde primario y header con gradiente), pero adapta su
 * contenido a la máquina de estados REAL del backend.
 */
function AccionPanel(props) {
  const {
    estado,
    traspaso,
    itemsCompletos,
    totalItems,
    pickingCompleto,
    yoSoyPicker,
    yoSoyDeSedeDestino,
    esAdmin,
    yoSoyDeSedeOrigen,
    accionando,
    onIniciarPicking,
    onEnviar,
    onIrPicking,
    onRecibir,
    onCancelar,
  } = props;

  const config = construirConfig({
    estado,
    traspaso,
    itemsCompletos,
    totalItems,
    pickingCompleto,
    yoSoyPicker,
    yoSoyDeSedeDestino,
    esAdmin,
    yoSoyDeSedeOrigen,
    accionando,
    onIniciarPicking,
    onEnviar,
    onIrPicking,
    onRecibir,
  });

  const headBg =
    config.tone === "danger"
      ? "linear-gradient(180deg,var(--dang-50),transparent)"
      : config.tone === "success"
        ? "linear-gradient(180deg,var(--succ-50),transparent)"
        : "linear-gradient(180deg,var(--prog-50),transparent)";
  const borderColor =
    config.tone === "danger"
      ? "var(--dang-border)"
      : config.tone === "success"
        ? "var(--succ-border)"
        : "var(--p-cta)";
  const iconBg =
    config.tone === "danger"
      ? "var(--dang-600)"
      : config.tone === "success"
        ? "var(--succ-600)"
        : "var(--p-cta)";

  return (
    <div
      className="flex flex-col overflow-hidden rounded-[14px] border-2"
      style={{
        borderColor,
        backgroundColor: "var(--n-0)",
        boxShadow: "0 4px 12px rgba(45,60,229,.10)",
      }}
    >
      <header
        className="flex items-center gap-3 border-b px-5 py-4"
        style={{ borderColor: "var(--n-100)", background: headBg }}
      >
        <div
          className="grid h-9 w-9 place-items-center rounded-[9px] text-white"
          style={{ backgroundColor: iconBg }}
        >
          {config.icon}
        </div>
        <div className="flex-1">
          <div
            className="text-[14px] font-semibold"
            style={{ color: "var(--n-950)" }}
          >
            {config.title}
          </div>
          <div
            className="mt-0.5 text-[12px] leading-[1.4]"
            style={{ color: "var(--n-500)" }}
          >
            {config.desc}
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-3 px-5 py-4">
        {config.progreso != null && (
          <div className="flex flex-col gap-1.5">
            <div
              className="flex items-center justify-between font-mono text-[11.5px]"
              style={{ color: "var(--n-500)" }}
            >
              <span>
                {itemsCompletos} de {totalItems} pickeados
              </span>
              <span>{Math.round(config.progreso)}%</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full"
              style={{ backgroundColor: "var(--n-100)" }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${config.progreso}%`,
                  backgroundColor: "var(--p-cta)",
                }}
              />
            </div>
          </div>
        )}

        {config.actions.length > 0 ? (
          config.actions.map((a, i) => (
            <button
              key={i}
              onClick={a.onClick}
              disabled={a.disabled}
              className="inline-flex items-center justify-center gap-1.5 rounded-[10px] text-[13.5px] font-medium transition-opacity disabled:opacity-40"
              style={{
                height: 48,
                ...(a.variant === "primary"
                  ? { backgroundColor: "var(--p-cta)", color: "#fff" }
                  : {
                      border: "1px solid var(--n-150)",
                      backgroundColor: "var(--n-0)",
                      color: "var(--n-700)",
                    }),
              }}
              onMouseEnter={(e) => {
                if (!a.disabled) e.currentTarget.style.opacity = "0.9";
              }}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              {a.icon}
              {a.label}
            </button>
          ))
        ) : (
          <p
            className="text-center text-[12.5px]"
            style={{ color: "var(--n-400)" }}
          >
            Sin acciones pendientes en este momento.
          </p>
        )}

        {esAdmin &&
          ["borrador", "picking", "verificado", "en_transito"].includes(
            estado,
          ) && (
            <button
              onClick={onCancelar}
              disabled={accionando}
              className="inline-flex items-center justify-center gap-1.5 rounded-[10px] text-[13.5px] font-medium transition-opacity disabled:opacity-40"
              style={{
                height: 48,
                border: "1px solid var(--dang-border)",
                backgroundColor: "var(--n-0)",
                color: "var(--dang-600)",
              }}
              onMouseEnter={(e) => {
                if (!accionando) e.currentTarget.style.opacity = "0.9";
              }}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
              {accionando ? "Cancelando…" : "Cancelar traspaso"}
            </button>
          )}
      </div>
    </div>
  );
}

/** Construye la configuración del panel según estado real + permisos. */
function construirConfig(p) {
  const {
    estado,
    traspaso,
    itemsCompletos,
    totalItems,
    pickingCompleto,
    yoSoyPicker,
    yoSoyDeSedeDestino,
    yoSoyDeSedeOrigen,
    accionando,
    onIniciarPicking,
    onEnviar,
    onIrPicking,
    onRecibir,
  } = p;
  const pctPicking = totalItems > 0 ? (itemsCompletos / totalItems) * 100 : 0;

  if (estado === "borrador" && yoSoyDeSedeOrigen) {
    return {
      icon: <Package className="h-4 w-4" strokeWidth={2} />,
      title: "Iniciar picking",
      desc: "Asígnate como picker y comienza a recoger los productos de bodega.",
      progreso: null,
      actions: [
        {
          label: accionando ? "Iniciando…" : "Iniciar picking",
          onClick: onIniciarPicking,
          disabled: accionando,
          variant: "primary",
          icon: <PlayCircle className="h-3.5 w-3.5" strokeWidth={2} />,
        },
      ],
    };
  }
  if (estado === "picking" && yoSoyPicker && !pickingCompleto) {
    return {
      icon: <Package className="h-4 w-4" strokeWidth={2} />,
      title: "Continuar picking",
      desc: `${itemsCompletos} de ${totalItems} ítems completados.`,
      progreso: pctPicking,
      actions: [
        {
          label: "Ir al picking",
          onClick: onIrPicking,
          variant: "primary",
          icon: <PlayCircle className="h-3.5 w-3.5" strokeWidth={2} />,
        },
      ],
    };
  }
  // B6: simplificado — sin verificación por un tercero. El picker (o Admin /
  // Bodeguero de la sede origen) envía directo cuando el picking está completo.
  if (
    estado === "picking" &&
    pickingCompleto &&
    (yoSoyPicker || yoSoyDeSedeOrigen)
  ) {
    return {
      icon: <Truck className="h-4 w-4" strokeWidth={2} />,
      title: "Enviar traspaso",
      desc: "Picking completo. Al confirmar el envío, el stock saldrá de la sede origen.",
      progreso: 100,
      actions: [
        {
          label: "Revisar picking",
          onClick: onIrPicking,
          variant: "outline",
          icon: <PlayCircle className="h-3.5 w-3.5" strokeWidth={2} />,
        },
        {
          label: accionando ? "Enviando…" : "Confirmar envío",
          onClick: onEnviar,
          disabled: accionando,
          variant: "primary",
          icon: <Truck className="h-3.5 w-3.5" strokeWidth={2} />,
        },
      ],
    };
  }
  if (estado === "picking" && !yoSoyPicker && yoSoyDeSedeOrigen) {
    return {
      icon: <Package className="h-4 w-4" strokeWidth={2} />,
      title: "Picking en progreso",
      desc: `Picking en progreso: ${itemsCompletos}/${totalItems} ítems.`,
      progreso: pctPicking,
      actions: [],
    };
  }
  if (estado === "verificado" && yoSoyDeSedeOrigen) {
    return {
      icon: <Truck className="h-4 w-4" strokeWidth={2} />,
      title: "Enviar traspaso",
      desc: "El traspaso fue verificado. Al confirmar el envío, el stock saldrá de la sede origen.",
      progreso: null,
      actions: [
        {
          label: accionando ? "Enviando…" : "Confirmar envío",
          onClick: onEnviar,
          disabled: accionando,
          variant: "primary",
          icon: <Truck className="h-3.5 w-3.5" strokeWidth={2} />,
        },
      ],
    };
  }
  if (estado === "en_transito" && yoSoyDeSedeDestino) {
    return {
      icon: <PackageCheck className="h-4 w-4" strokeWidth={2} />,
      title: `Recepción en ${sedeLabel(traspaso.sede_destino_id)}`,
      desc: "El traspaso está en camino. Confirma las cantidades recibidas en tu sede.",
      progreso: null,
      actions: [
        {
          label: "Confirmar recepción",
          onClick: onRecibir,
          variant: "primary",
          icon: <Check className="h-3.5 w-3.5" strokeWidth={2.5} />,
        },
      ],
    };
  }
  if (estado === "con_diferencia") {
    return {
      icon: <AlertTriangle className="h-4 w-4" strokeWidth={2} />,
      title: "Recibido con diferencias",
      desc: "Las cantidades recibidas no coinciden con las enviadas. Revisa el detalle de productos.",
      progreso: null,
      tone: "danger",
      actions: [],
    };
  }
  if (estado === "recibido") {
    return {
      icon: <Check className="h-4 w-4" strokeWidth={2} />,
      title: "Traspaso completado",
      desc: "El stock fue recibido en la sede destino sin diferencias.",
      progreso: null,
      tone: "success",
      actions: [],
    };
  }
  if (estado === "cancelado") {
    return {
      icon: <AlertTriangle className="h-4 w-4" strokeWidth={2} />,
      title: "Traspaso cancelado",
      desc: "Un Admin canceló este traspaso. Si ya estaba en tránsito, el stock se devolvió a la sede origen.",
      progreso: null,
      tone: "danger",
      actions: [],
    };
  }
  // Guía pasiva — sede DESTINO: aún se prepara en origen, solo hay que esperar.
  if (
    ["borrador", "picking", "verificado"].includes(estado) &&
    yoSoyDeSedeDestino
  ) {
    return {
      icon: <Clock className="h-4 w-4" strokeWidth={2} />,
      title: "En preparación en origen",
      desc: `${sedeLabel(traspaso.sede_origen_id)} está preparando este traspaso. Podrás confirmar la recepción cuando llegue a tu sede.`,
      progreso: null,
      actions: [],
    };
  }
  // Guía pasiva — sede ORIGEN: ya se envió, espera la confirmación de recepción.
  if (estado === "en_transito" && yoSoyDeSedeOrigen) {
    return {
      icon: <Truck className="h-4 w-4" strokeWidth={2} />,
      title: "En camino a destino",
      desc: `Enviado. Esperando que ${sedeLabel(traspaso.sede_destino_id)} confirme la recepción.`,
      progreso: null,
      actions: [],
    };
  }
  return {
    icon: <Clock className="h-4 w-4" strokeWidth={2} />,
    title: "Sin acciones disponibles",
    desc: "No tienes acciones pendientes para este traspaso en su estado actual.",
    progreso: null,
    actions: [],
  };
}

function LoadingView() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-5 sm:px-7 sm:py-6">
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-[10px]"
            style={{ backgroundColor: "var(--n-100)" }}
          />
        ))}
      </div>
    </div>
  );
}

function NotFoundView({ onBack }) {
  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-3 px-4 py-5 sm:px-7 sm:py-6">
      <p style={{ color: "var(--dang-700)" }}>Traspaso no encontrado</p>
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium"
        style={{ color: "var(--n-500)" }}
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} /> Volver a
        Traspasos
      </button>
    </div>
  );
}
