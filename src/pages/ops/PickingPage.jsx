import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { X, Check, SkipForward } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { safeError } from "../../lib/utils";
import UbicacionChip from "../../components/ui/UbicacionChip";

/**
 * Picking · Modo tarea pantalla completa (diseño Lovable `pk-*`).
 *
 * Recorre los items uno a uno, optimizado para uso en bodega con guantes
 * (botones de 64px). Conserva la lógica real:
 *   - Solo el picker asignado (o Admin) accede; estado debe ser 'picking'.
 *   - Orden por prioridad_picking ASC.
 *   - Autosave debounce 1500ms vía RPC fn_procesar_traspaso (actualizar_items).
 *   - Finalizar guarda el progreso y vuelve al detalle, donde el MISMO picker
 *     (o personal de la sede origen) confirma el envío — B6: sin verificación
 *     por un tercero.
 */
export default function PickingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [traspaso, setTraspaso] = useState(null);
  const [items, setItems] = useState([]);
  const [local, setLocal] = useState({});
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const autoSaveRef = useRef(null);

  /* ── Cargar datos ─────────────────────────────────────────── */
  useEffect(() => {
    const cargar = async () => {
      setLoading(true);
      try {
        const [{ data: t, error: errT }, { data: d, error: errD }] =
          await Promise.all([
            supabase
              .from("traspasos")
              .select("id, numero, estado, picker_id, sede_origen_id")
              .eq("id", id)
              .single(),
            supabase
              .from("detalle_traspaso")
              .select(
                `id, producto_id, cantidad_solicitada, cantidad_enviada, picking_completado,
                 producto:producto_id(nombre, referencia, unidad_medida),
                 ubicacion:ubicacion_origen_id(pasillo, estante, nivel, prioridad_picking)`,
              )
              .eq("traspaso_id", id),
          ]);

        if (errT || !t) throw new Error("Traspaso no encontrado");
        if (errD) throw new Error(errD.message);

        // Solo el picker asignado (o Admin) puede hacer picking
        if (t.picker_id !== perfil?.id && perfil?.rol !== "Admin") {
          navigate(`/ops/traspasos/${id}`, { replace: true });
          return;
        }

        // Solo tiene sentido pickear un traspaso En Picking.
        if (t.estado !== "picking") {
          navigate(`/ops/traspasos/${id}`, { replace: true });
          return;
        }

        // Bloque D1: la ubicación física real hoy vive en inventario.ubicacion_id
        // (ubicacion_origen_id de detalle_traspaso aún no se puebla en ningún
        // flujo). La resolvemos por producto en la sede origen y la usamos
        // tanto para el chip 📍 como para reforzar el orden de recorrido.
        let ubicPorProducto = {};
        let prioridadPorUbicacion = {};
        const productoIds = (d ?? []).map((i) => i.producto_id).filter(Boolean);
        if (productoIds.length) {
          const [{ data: inv }, { data: ubics }] = await Promise.all([
            supabase
              .from("inventario")
              .select("producto_id, ubicacion_id")
              .eq("sede_id", t.sede_origen_id)
              .in("producto_id", productoIds),
            supabase
              .from("ubicaciones")
              .select("id, prioridad_picking")
              .eq("sede_id", t.sede_origen_id),
          ]);
          ubicPorProducto = Object.fromEntries(
            (inv ?? []).map((r) => [r.producto_id, r.ubicacion_id]),
          );
          prioridadPorUbicacion = Object.fromEntries(
            (ubics ?? []).map((u) => [u.id, u.prioridad_picking]),
          );
        }

        const conUbicacion = (d ?? []).map((item) => {
          const ubicacion_id = ubicPorProducto[item.producto_id] ?? null;
          const prioridad =
            prioridadPorUbicacion[ubicacion_id] ??
            item.ubicacion?.prioridad_picking ??
            9999;
          return { ...item, ubicacion_id, prioridad_picking: prioridad };
        });

        // Ordenar por prioridad_picking ASC, nulls last
        const sorted = [...conUbicacion].sort(
          (a, b) => a.prioridad_picking - b.prioridad_picking,
        );

        setTraspaso(t);
        setItems(sorted);

        // Estado local inicializado desde BD
        const init = {};
        for (const item of sorted) {
          init[item.id] = {
            picking_completado: item.picking_completado ?? false,
            // La columna cantidad_enviada tiene DEFAULT 0; `0 ?? x` deja 0
            // (?? solo cae en null/undefined). Tratamos 0 como "aún sin
            // pickear" y arrancamos en lo solicitado.
            cantidad_enviada:
              item.cantidad_enviada > 0
                ? item.cantidad_enviada
                : (item.cantidad_solicitada ?? 1),
          };
        }
        setLocal(init);

        // Empezar en el primer item NO pickeado (continuar donde quedó)
        const firstPending = sorted.findIndex((i) => !i.picking_completado);
        setIndex(firstPending === -1 ? sorted.length : firstPending);
      } catch (e) {
        setError(safeError(e, "Error en picking"));
      } finally {
        setLoading(false);
      }
    };

    cargar();
    return () => clearTimeout(autoSaveRef.current);
    // Deps primitivas: depender del objeto `perfil` completo re-disparaba el
    // fetch ante cualquier cambio del store y descartaba el picking en curso.
  }, [id, perfil?.id, perfil?.rol, navigate]);

  /* ── Guardar progreso vía RPC ─────────────────────────────── */
  const guardarProgreso = useCallback(
    async (localSnapshot) => {
      if (!items.length) return;
      setGuardando(true);
      setError(null);
      try {
        const p_items = items.map((item) => ({
          detalle_id: item.id,
          // `||` (no `??`) para que un 0 heredado caiga a lo solicitado.
          cantidad_enviada:
            localSnapshot[item.id]?.cantidad_enviada ||
            item.cantidad_solicitada ||
            1,
          picking_completado:
            localSnapshot[item.id]?.picking_completado ?? false,
        }));

        const { error: rpcErr } = await supabase.rpc("fn_procesar_traspaso", {
          p_traspaso_id: id,
          p_accion: "actualizar_items",
          p_items,
        });
        if (rpcErr) throw new Error(rpcErr.message);
      } catch (e) {
        setError(safeError(e, "Error en picking"));
      } finally {
        setGuardando(false);
      }
    },
    [id, items],
  );

  const scheduleAutoSave = useCallback(
    (nextLocal) => {
      clearTimeout(autoSaveRef.current);
      autoSaveRef.current = setTimeout(() => guardarProgreso(nextLocal), 1500);
    },
    [guardarProgreso],
  );

  /* ── Handlers ─────────────────────────────────────────────── */
  const marcarRecogido = (itemId) => {
    setLocal((prev) => {
      const next = {
        ...prev,
        [itemId]: { ...prev[itemId], picking_completado: true },
      };
      scheduleAutoSave(next);
      return next;
    });
    setIndex((i) => Math.min(i + 1, items.length));
  };

  const saltar = () => setIndex((i) => Math.min(i + 1, items.length));

  const setCantidad = (itemId, value) => {
    const num = Math.min(100000, Math.max(1, parseInt(value, 10) || 1));
    setLocal((prev) => {
      const next = {
        ...prev,
        [itemId]: { ...prev[itemId], cantidad_enviada: num },
      };
      scheduleAutoSave(next);
      return next;
    });
  };

  const handleFinalizar = async () => {
    clearTimeout(autoSaveRef.current);
    await guardarProgreso(local);
    // B6: el picking ya no requiere verificación por un tercero. Volvemos al
    // detalle, donde el mismo picker confirma el envío (picking → en tránsito).
    navigate(`/ops/traspasos/${id}`);
  };

  /* ── Cálculos ─────────────────────────────────────────────── */
  const total = items.length;
  const pickedCount = items.filter(
    (i) => local[i.id]?.picking_completado,
  ).length;
  const done = index >= total && total > 0;
  const pct = total > 0 ? (pickedCount / total) * 100 : 0;
  const item = done || total === 0 ? null : items[index];
  const estadoItem = item ? local[item.id] : null;
  const loc = item?.ubicacion;
  const ubicCode = loc ? `${loc.pasillo}-${loc.estante}-${loc.nivel}` : "—";

  if (loading) return <LoadingView />;

  return (
    <div className="pk min-h-screen">
      {/* Header sin chrome */}
      <header className="pk-header">
        <button
          className="pk-close"
          aria-label="Salir del picking"
          onClick={() => navigate(`/ops/traspasos/${id}`)}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <span className="pk-ctx">
          Picking · Traspaso #{traspaso?.numero ?? "—"}
        </span>
        {item && (
          <span className="pk-loc hidden items-center gap-1.5 sm:inline-flex">
            {ubicCode}
            <UbicacionChip codigo={item.ubicacion_id} conMapa />
          </span>
        )}
      </header>

      {/* Barra de progreso */}
      <div className="pk-prog">
        <div className="pk-prog-bar">
          <div className="pk-prog-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="pk-prog-count">
          {pickedCount} de {total}
        </span>
      </div>

      {error && (
        <div
          className="mx-5 mt-3 rounded-lg border px-3.5 py-2.5 text-[13px]"
          style={{
            backgroundColor: "var(--dang-50)",
            borderColor: "var(--dang-border)",
            color: "var(--dang-700)",
          }}
        >
          {error}
        </div>
      )}

      {done ? (
        <div className="pk-done">
          <div className="pk-done-check">
            <Check className="h-8 w-8" strokeWidth={2.5} />
          </div>
          <h2 className="pk-done-title">
            {pickedCount} de {total} completados
          </h2>
          <p className="pk-done-sub">
            {pickedCount === total
              ? `Traspaso #${traspaso?.numero ?? ""} listo para enviar`
              : `${total - pickedCount} item(s) sin recoger — puedes revisarlos antes de finalizar`}
          </p>
          <button
            onClick={handleFinalizar}
            disabled={guardando}
            className="pk-done-btn disabled:opacity-60"
            style={{ lineHeight: "64px" }}
          >
            {guardando ? "Guardando…" : "Finalizar picking"}
          </button>
          {index > 0 && (
            <button
              onClick={() => setIndex(0)}
              className="text-[13px] font-medium underline underline-offset-4"
              style={{ color: "var(--n-500)" }}
            >
              Volver a revisar items
            </button>
          )}
        </div>
      ) : total === 0 ? (
        <div className="pk-done">
          <p className="pk-done-sub">Este traspaso no tiene productos.</p>
          <button
            onClick={() => navigate(`/ops/traspasos/${id}`)}
            className="pk-done-btn"
            style={{ lineHeight: "64px" }}
          >
            Volver al detalle
          </button>
        </div>
      ) : (
        <>
          <div className="pk-desktop-wrap">
            <div className="pk-desktop-center">
              <span className="pk-step">
                Producto {index + 1} de {total}
              </span>
              <span className="pk-sku">{item.producto?.referencia ?? "—"}</span>
              <h1 className="pk-name">{item.producto?.nombre ?? "—"}</h1>
              {item.producto?.unidad_medida && (
                <p className="pk-model">{item.producto.unidad_medida}</p>
              )}

              {/* Cantidad a recoger (editable — guantes) */}
              <div className="pk-qty" style={{ width: 260 }}>
                <span className="pk-qty-lbl">Cantidad a recoger</span>
                <div className="flex items-center gap-3">
                  <QtyBtn
                    onClick={() =>
                      setCantidad(item.id, estadoItem.cantidad_enviada - 1)
                    }
                  >
                    −
                  </QtyBtn>
                  <input
                    type="number"
                    value={estadoItem.cantidad_enviada}
                    onChange={(e) => setCantidad(item.id, e.target.value)}
                    min={1}
                    className="pk-qty-num w-24 border-none bg-transparent text-center outline-none"
                    aria-label="Cantidad a recoger"
                  />
                  <QtyBtn
                    onClick={() =>
                      setCantidad(item.id, estadoItem.cantidad_enviada + 1)
                    }
                  >
                    +
                  </QtyBtn>
                </div>
                <span
                  className="font-mono text-[11px]"
                  style={{ color: "var(--n-500)" }}
                >
                  Solicitado: {item.cantidad_solicitada}
                </span>
              </div>

              <p className="pk-loc-inline flex items-center gap-1.5">
                Ubicación:<span className="code">{ubicCode}</span>
                <UbicacionChip codigo={item.ubicacion_id} conMapa />
              </p>
              {estadoItem.picking_completado && (
                <span className="pill pill-success">
                  <span className="dot" />
                  Ya marcado como recogido
                </span>
              )}
            </div>
          </div>

          {/* Acciones — botones de 64px */}
          <div className="pk-actions mx-auto w-full max-w-[600px]">
            <button className="pk-btn pk-btn-skip" onClick={saltar}>
              <SkipForward className="h-[18px] w-[18px]" strokeWidth={1.7} />
              Saltar
            </button>
            <button
              className="pk-btn pk-btn-pick"
              onClick={() => marcarRecogido(item.id)}
            >
              <Check className="h-[18px] w-[18px]" strokeWidth={2.5} />
              Recogido
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function QtyBtn({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center rounded-lg border font-bold"
      style={{
        width: 48,
        height: 48,
        fontSize: 22,
        borderColor: "var(--n-200)",
        backgroundColor: "var(--n-0)",
        color: "var(--n-700)",
      }}
    >
      {children}
    </button>
  );
}

function LoadingView() {
  return (
    <div className="pk min-h-screen">
      <header className="pk-header">
        <div
          className="h-8 w-8 animate-pulse rounded-full"
          style={{ backgroundColor: "var(--n-100)" }}
        />
        <div
          className="h-3 w-40 animate-pulse rounded"
          style={{ backgroundColor: "var(--n-100)" }}
        />
      </header>
      <div className="pk-desktop-wrap">
        <div className="pk-desktop-center w-full">
          <div
            className="h-8 w-3/4 animate-pulse rounded"
            style={{ backgroundColor: "var(--n-100)" }}
          />
          <div
            className="mt-4 h-32 w-64 animate-pulse rounded-lg"
            style={{ backgroundColor: "var(--n-100)" }}
          />
        </div>
      </div>
    </div>
  );
}
