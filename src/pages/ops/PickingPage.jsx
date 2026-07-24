import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { X, Check, SkipForward, ScanLine } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { safeError } from "../../lib/utils";
import UbicacionChip from "../../components/ui/UbicacionChip";
import QRScanner from "../../components/forms/QRScanner";
import { avisarOk, avisarError } from "../../lib/notify";

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

  // Escáner de VERIFICACIÓN (no de búsqueda): el producto esperado ya se
  // conoce, el escaneo solo confirma si lo que el operario tiene en la mano
  // es lo que la pantalla pide. `resultadoScan` guarda el veredicto del
  // último escaneo contra el ítem ACTUAL — ver el efecto de abajo, que lo
  // limpia al cambiar de ítem para que un aviso no se arrastre a otro producto.
  const [scannerOpen, setScannerOpen] = useState(false);
  const [resultadoScan, setResultadoScan] = useState(null);

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
                `id, producto_id, cantidad_solicitada, cantidad_enviada, picking_completado, es_insumo,
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
  // Nota: no muestra el aviso de resultado — eso lo decide cada llamador según
  // si es un autosave en segundo plano (banner fijo) o el resultado de pulsar
  // un botón (toast). La lógica/RPC es la misma en ambos casos.
  const guardarProgreso = useCallback(
    async (localSnapshot) => {
      if (!items.length) return { ok: true };
      setGuardando(true);
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
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          mensaje: safeError(e, "No se pudo guardar el picking"),
        };
      } finally {
        setGuardando(false);
      }
    },
    [id, items],
  );

  const scheduleAutoSave = useCallback(
    (nextLocal) => {
      clearTimeout(autoSaveRef.current);
      autoSaveRef.current = setTimeout(() => {
        // Limpiar el ref al dispararse: así `autoSaveRef.current` significa
        // "hay un autosave PENDIENTE", no "alguna vez hubo uno" (la X lo usa
        // para decidir si debe hacer flush antes de salir).
        autoSaveRef.current = null;
        guardarProgreso(nextLocal).then((res) => {
          if (!res.ok) setError(res.mensaje);
        });
      }, 1500);
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
    // Techo DURO: no se puede recoger más de lo solicitado (decisión del dueño
    // 2026-07-16; ya había pasado 2 veces que salía de más). El backend también
    // lo rechaza — este tope evita que el operario se entere tarde.
    const solicitada =
      items.find((i) => i.id === itemId)?.cantidad_solicitada ?? 1;
    const num = Math.min(solicitada, Math.max(1, parseInt(value, 10) || 1));
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
    const res = await guardarProgreso(local);
    // Si el guardado falló, quedarse en la pantalla con el error visible.
    // Antes se navegaba igual y el trabajo se perdía en silencio (S7-C).
    if (!res.ok) {
      avisarError(res.mensaje);
      return;
    }
    // B6: el picking ya no requiere verificación por un tercero. Volvemos al
    // detalle, donde el mismo picker confirma el envío (picking → en tránsito).
    avisarOk("Picking finalizado");
    navigate(`/ops/traspasos/${id}`);
  };

  // Salir con la X: despacha el autosave pendiente antes de irse para no
  // perder los últimos cambios (el debounce de 1500ms podía quedar en el aire).
  // Si el flush FALLA, no se navega: el error queda visible y el operario puede
  // reintentar — navegar igual habría perdido el trabajo en silencio.
  const handleSalir = async () => {
    if (autoSaveRef.current) {
      clearTimeout(autoSaveRef.current);
      autoSaveRef.current = null;
      const res = await guardarProgreso(local);
      if (!res.ok) {
        avisarError(res.mensaje);
        return;
      }
    }
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

  // El chip "Sin ubicar" solo informa donde la sede SÍ ubica productos (hoy
  // BODEGA); en CV/CHV/L3, que casi no usan ubicaciones, saldría en cada
  // ítem y el operario aprendería a ignorarlo. Se auto-ajusta por traspaso:
  // si al menos un ítem de esta lista tiene ubicación, mostrar el chip
  // vacío en los demás es información real; si ninguno la tiene, el chip
  // desaparece — y vuelve a aparecer solo el día que esa sede empiece a
  // ubicar, sin tocar código.
  const alMenosUnaUbicacion = useMemo(
    () => items.some((i) => i.ubicacion_id),
    [items],
  );

  // El veredicto de una verificación pertenece al ítem que estaba en pantalla
  // en ese momento. Sin este efecto, si el operario escaneaba mal, marcaba
  // "Recogido" (avanza de ítem) y volvía a escanear el nuevo producto, el
  // aviso viejo seguía visible un instante mezclado con el nuevo — confuso
  // justo en la pantalla cuya función es dar certeza.
  useEffect(() => {
    setResultadoScan(null);
  }, [index]);

  // Ref al id del ítem vigente (no al índice: la lista puede reordenarse).
  // handleScanVerificacion la usa para saber, cuando una consulta async
  // resuelve, si el operario ya saltó a otro ítem mientras esperaba — con
  // señal débil de bodega la respuesta puede llegar después de "Saltar".
  const itemActualIdRef = useRef(null);
  useEffect(() => {
    itemActualIdRef.current = item?.id ?? null;
  }, [item?.id]);

  // Ir directo a otro ítem de la lista cuando el escáner detecta que el
  // producto en mano corresponde a un ítem distinto al que se está mostrando.
  const irAItem = (idx) => {
    setResultadoScan(null);
    setIndex(idx);
  };

  // Escáner de VERIFICACIÓN: juzga el código leído contra `item` (el ítem
  // actual), NO busca productos nuevos. Se define aquí, después de calcular
  // `item`, para no depender de él antes de su inicialización.
  const handleScanVerificacion = async (productoId) => {
    setScannerOpen(false);
    if (!item) return;

    if (productoId === item.producto_id) {
      setResultadoScan({ tipo: "match" });
      return;
    }

    // ¿El producto escaneado es OTRO ítem de esta misma lista? Caso real:
    // el operario recoge en el orden que le resulta cómodo, no en el de la
    // pantalla. Esto NO es un error — es información útil para saltar.
    //
    // Un mismo producto puede aparecer en dos líneas del traspaso (no hay
    // UNIQUE por producto en detalle_traspaso). Se prefiere la línea que
    // todavía está pendiente: mandar al operario a una que ya recogió lo
    // dejaría mirando "Ya marcado como recogido" con la pieza en la mano.
    const pendienteIndex = items.findIndex(
      (i) => i.producto_id === productoId && !local[i.id]?.picking_completado,
    );
    const otroIndex =
      pendienteIndex !== -1
        ? pendienteIndex
        : items.findIndex((i) => i.producto_id === productoId);
    if (otroIndex !== -1) {
      setResultadoScan({
        tipo: "otro-item",
        index: otroIndex,
        producto: items[otroIndex].producto,
        // Si no hubo línea pendiente, es porque TODAS las líneas de ese
        // producto (puede repetirse sin UNIQUE) ya se recogieron — no hay
        // nada a lo que "saltar", solo informar que ya está hecho.
        yaRecogido: pendienteIndex === -1,
      });
      return;
    }

    // No es el esperado ni pertenece a esta lista: hay que decir QUÉ se
    // escaneó de verdad — es el corazón de esta función. El QRScanner ya
    // validó que el producto existe y está activo; solo falta traer
    // nombre/referencia para mostrarlos en el aviso.
    // Se captura el id del ítem vigente ANTES del await: la consulta puede
    // tardar (señal débil de bodega) y el operario puede pulsar "Saltar"
    // mientras viaja. Si al resolver el ítem ya cambió, el aviso pertenece a
    // un producto que ya no está en pantalla — se descarta en silencio para
    // no pintarlo sobre un ítem que no tiene nada que ver.
    const itemIdAlEscanear = item.id;
    try {
      const { data } = await supabase
        .from("productos")
        .select("nombre, referencia")
        .eq("id", productoId)
        .maybeSingle();
      if (itemActualIdRef.current !== itemIdAlEscanear) return;
      setResultadoScan({ tipo: "mismatch", producto: data });
    } catch (e) {
      // Guarda ANTES de avisar: si el operario ya saltó de ítem, ni el toast
      // ni el resultado deben salir — quedarían huérfanos de un producto que
      // ya no está en pantalla (ver el comentario de más arriba).
      if (itemActualIdRef.current !== itemIdAlEscanear) return;
      safeError(e, "No se pudo identificar el producto escaneado");
      setResultadoScan({ tipo: "mismatch", producto: null });
    }
  };

  if (loading) return <LoadingView />;

  return (
    <div className="pk min-h-screen">
      {/* Header sin chrome */}
      <header className="pk-header">
        <button
          className="pk-close"
          aria-label="Salir del picking"
          onClick={handleSalir}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <span className="pk-ctx">
          Picking · Traspaso #{traspaso?.numero ?? "—"}
        </span>
        {item && (
          <span className="pk-loc hidden items-center gap-1.5 sm:inline-flex">
            {ubicCode}
            <UbicacionChip
              codigo={item.ubicacion_id}
              conMapa
              mostrarVacio={alMenosUnaUbicacion}
            />
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
              {item.es_insumo && (
                <span className="stk-pill i">Insumo (no vendible)</span>
              )}
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
                <UbicacionChip
                  codigo={item.ubicacion_id}
                  conMapa
                  mostrarVacio={alMenosUnaUbicacion}
                />
              </p>
              {estadoItem.picking_completado && (
                <span className="pill pill-success">
                  <span className="dot" />
                  Ya marcado como recogido
                </span>
              )}

              {/* Escáner de VERIFICACIÓN, no de búsqueda: el producto esperado
                  ya se conoce, esto solo confirma que lo que el operario tiene
                  en la mano es lo que la pantalla pide. Ayuda opcional — nunca
                  bloquea el botón "Recogido" de abajo. */}
              <button
                type="button"
                className="pk-scan-btn"
                onClick={() => setScannerOpen(true)}
              >
                <ScanLine className="h-[18px] w-[18px]" strokeWidth={1.8} />
                Verificar con escáner
              </button>

              {resultadoScan?.tipo === "match" && (
                <div
                  className="w-full max-w-[420px] rounded-lg border px-4 py-3 text-center text-[14px] font-semibold"
                  style={{
                    backgroundColor: "var(--succ-50)",
                    borderColor: "var(--succ-border)",
                    color: "var(--succ-700)",
                  }}
                >
                  ✓ Coincide — {item.producto?.referencia} ·{" "}
                  {item.producto?.nombre}
                </div>
              )}

              {resultadoScan?.tipo === "mismatch" && (
                <div
                  className="w-full max-w-[420px] rounded-lg border px-4 py-3 text-[14px]"
                  style={{
                    backgroundColor: "var(--dang-50)",
                    borderColor: "var(--dang-border)",
                    color: "var(--dang-700)",
                  }}
                >
                  <p className="font-bold">⚠ Producto equivocado</p>
                  <p className="mt-1">
                    Escaneaste:{" "}
                    <strong>
                      {resultadoScan.producto?.referencia ??
                        "referencia desconocida"}
                    </strong>{" "}
                    ·{" "}
                    {resultadoScan.producto?.nombre ??
                      "producto no identificado"}
                  </p>
                  <p className="mt-1">
                    Se esperaba: <strong>{item.producto?.referencia}</strong> ·{" "}
                    {item.producto?.nombre}
                  </p>
                </div>
              )}

              {resultadoScan?.tipo === "otro-item" && (
                <div
                  className="w-full max-w-[420px] rounded-lg border px-4 py-3 text-[14px]"
                  style={{
                    backgroundColor: "var(--info-50)",
                    borderColor: "var(--info-border)",
                    color: "var(--info-700)",
                  }}
                >
                  {resultadoScan.yaRecogido ? (
                    // Ambas líneas de este producto ya se recogieron: no hay
                    // nada pendiente a lo que "saltar", solo confirmar.
                    <p>
                      Ese producto (
                      <strong>{resultadoScan.producto?.referencia}</strong> ·{" "}
                      {resultadoScan.producto?.nombre}) ya fue recogido en esta
                      lista.
                    </p>
                  ) : (
                    <>
                      <p>
                        Ese producto es el ítem{" "}
                        <strong>{resultadoScan.index + 1}</strong> de esta
                        lista:{" "}
                        <strong>{resultadoScan.producto?.referencia}</strong> ·{" "}
                        {resultadoScan.producto?.nombre}
                      </p>
                      <button
                        type="button"
                        className="mt-2 font-semibold underline underline-offset-4"
                        onClick={() => irAItem(resultadoScan.index)}
                      >
                        Ir a ese ítem
                      </button>
                    </>
                  )}
                </div>
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
              style={
                resultadoScan?.tipo === "match"
                  ? { boxShadow: "0 0 0 3px var(--succ-border)" }
                  : undefined
              }
            >
              <Check className="h-[18px] w-[18px]" strokeWidth={2.5} />
              Recogido
            </button>
          </div>
        </>
      )}

      {scannerOpen && (
        <QRScanner
          onFound={handleScanVerificacion}
          onClose={() => setScannerOpen(false)}
        />
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
