import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeftCircle,
  Search,
  X,
  Trash2,
  Check,
  Hammer,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, sanitizeSearch, safeError } from "../../lib/utils";
import { avisarOk, avisarError } from "../../lib/notify";
import { ensambleEstadoPill } from "../../lib/ordenes-ui";
import { useConfirm } from "../../components/ui/ConfirmDialog";

/**
 * Detalle de un ensamble (flujo nuevo: en_proceso → terminado → completado).
 *  - Editar la receta (agregar/quitar insumos) mientras NO esté completado.
 *    Los insumos se restan al agregar y se devuelven al quitar (triggers BD).
 *  - Técnico asignado (o Admin) marca "Ensamble terminado".
 *  - Creador/Vendedor (o Admin) "Completa" → suma el producto al stock.
 *  - Admin puede eliminar (devuelve insumos y quita el producido).
 */
export default function EnsambleDetalle() {
  const { ensambleId } = useParams();
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const { confirm, ConfirmDialog } = useConfirm();

  const [ens, setEns] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  // Solo el error de CARGA queda como estado (lo muestra la vista "no
  // encontrado"). Los resultados de acción saltan como pop-up.
  const [errorMsg, setErrorMsg] = useState("");
  const [accion, setAccion] = useState(false); // bloqueo durante acciones de estado

  // Picker de insumos
  const [search, setSearch] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [modoGlobal, setModoGlobal] = useState(false);
  const agregandoRef = useRef(false);

  // Conversión venta→insumo
  const [convProd, setConvProd] = useState(null);
  const [convCant, setConvCant] = useState("1");
  const [convSaving, setConvSaving] = useState(false);
  const [convError, setConvError] = useState("");

  const cargar = useCallback(async () => {
    setErrorMsg("");
    const { data: e, error } = await supabase
      .from("ensambles")
      .select(
        `id, numero, fecha, cantidad_producida, completado, terminado, costo_total,
         sede_id, realizado_por, tecnico_id,
         producto:producto_resultado_id(id, nombre, referencia),
         tecnico:tecnico_id(nombre), realizador:realizado_por(nombre)`,
      )
      .eq("id", ensambleId)
      .single();
    if (error) {
      setErrorMsg(safeError(error, "No se pudo cargar el ensamble"));
      setLoading(false);
      return;
    }
    setEns(e);
    const { data: det } = await supabase
      .from("detalle_ensamble")
      .select(
        "id, cantidad, costo_unitario, producto:producto_id(id, nombre, referencia)",
      )
      .eq("ensamble_id", ensambleId);
    setItems(det ?? []);
    setLoading(false);
  }, [ensambleId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const sede = ens?.sede_id;
  const editable = ens && !ens.completado;
  const esAdmin = perfil?.rol === "Admin";
  /** Costo de materiales del ensamble.
   *
   *  Ya se calculaba, pero solo dentro del diálogo de confirmación de
   *  "Completar": había que pulsar el botón para ver el número que sirve para
   *  decidir si pulsarlo. Ahora vive en la página.
   *
   *  Antes de completar se estima desde los insumos; al completar, el trigger
   *  `trg_ensamble_stock` guarda el definitivo en `ensambles.costo_total` y
   *  propaga el costo al producto resultante por promedio ponderado. Por eso,
   *  una vez completado se muestra el guardado y no el recalculado: es el que
   *  de verdad se usó. */
  const costoMaterialesVista = ens?.completado
    ? Number(ens.costo_total ?? 0)
    : items.reduce(
        (acc, i) => acc + (i.costo_unitario ?? 0) * (i.cantidad ?? 0),
        0,
      );
  const esTecnicoAsignado =
    perfil?.rol === "Tecnico" && ens?.tecnico_id === perfil?.id;
  const esCreador = ens?.realizado_por === perfil?.id;
  // La receta se CONGELA al marcar terminado (el equipo físico ya está armado;
  // seguir moviendo insumos digitales ya no corresponde a nada real). Para
  // corregir hay que "Reabrir" explícitamente.
  const puedeEditarReceta =
    editable && !ens?.terminado && (esAdmin || esCreador);
  // Sin técnico asignado (lo armó el propio creador), el creador es quien
  // marca terminado — si no, el flujo quedaba atascado sin botón (P1 verif S8).
  const puedeTerminar =
    ens &&
    !ens.terminado &&
    !ens.completado &&
    (esAdmin || esTecnicoAsignado || (esCreador && !ens.tecnico_id));
  const puedeReabrir =
    ens &&
    ens.terminado &&
    !ens.completado &&
    (esAdmin || esCreador || esTecnicoAsignado);
  const puedeCompletar =
    ens && ens.terminado && !ens.completado && (esAdmin || esCreador);

  // Buscar insumos para agregar a la receta
  useEffect(() => {
    const q = sanitizeSearch(search);
    if (q.length < 2 || !sede) {
      setResultados([]);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const { data: prods, error: e1 } = await supabase
          .from("productos")
          .select("id, referencia, nombre, costo_promedio, vendible")
          .eq("activo", true)
          .or(`referencia.ilike.%${q}%,nombre.ilike.%${q}%`)
          .limit(1000);
        if (ac.signal.aborted) return;
        if (e1) throw e1;
        const ids = (prods ?? []).map((p) => p.id);
        const { data: inv } = ids.length
          ? await supabase
              .from("inventario")
              .select("producto_id, cantidad, cantidad_insumo")
              .in("producto_id", ids)
              .eq("sede_id", sede)
          : { data: [] };
        const byProd = new Map();
        (inv ?? []).forEach((r) => byProd.set(r.producto_id, r));
        const enriched = (prods ?? []).map((p) => ({
          ...p,
          insumo: byProd.get(p.id)?.cantidad_insumo ?? 0,
          venta: byProd.get(p.id)?.cantidad ?? 0,
        }));
        const visibles = modoGlobal
          ? enriched
          : enriched.filter((p) => p.vendible === false || (p.insumo ?? 0) > 0);
        setResultados(visibles);
      } catch {
        /* ignore */
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [search, sede, modoGlobal]);

  const agregarInsumo = async (p, cantidad = 1) => {
    if (agregandoRef.current) return;
    agregandoRef.current = true;
    try {
      // S8: toda escritura va por la RPC (la tabla quedó blindada por REST).
      const { error } = await supabase.rpc("fn_ensamble_receta", {
        p_ensamble_id: ensambleId,
        p_accion: "agregar",
        p_producto_id: p.id,
        p_cantidad: cantidad,
      });
      if (error) throw error; // el trigger valida insumo suficiente
      setSearch("");
      setResultados([]);
      await cargar();
    } catch (err) {
      avisarError(err, "Error al agregar insumo");
    } finally {
      agregandoRef.current = false;
    }
  };

  const onSelectInsumo = (p) => {
    if ((p.insumo ?? 0) >= 1) {
      agregarInsumo(p, 1);
    } else if ((p.venta ?? 0) >= 1) {
      setConvCant("1");
      setConvError("");
      setConvProd(p);
    } else {
      avisarError(
        `"${p.nombre}" no tiene insumo ni stock de venta en esta sede. Pide traspaso o compra.`,
      );
    }
  };

  const convertir = async () => {
    if (!convProd) return;
    setConvError("");
    const n = Number(convCant);
    if (!Number.isInteger(n) || n < 1) {
      setConvError("La cantidad debe ser un entero mayor a 0");
      return;
    }
    if (n > (convProd.venta ?? 0)) {
      setConvError(`Máximo de venta disponible: ${convProd.venta ?? 0}`);
      return;
    }
    setConvSaving(true);
    try {
      const { data, error } = await supabase.rpc("fn_convertir_a_insumo", {
        p_producto_id: convProd.id,
        p_sede_id: sede,
        p_cantidad: n,
      });
      if (error) throw error;
      const prod = convProd;
      setConvProd(null);
      await agregarInsumo(prod, 1);
      avisarOk(
        data?.notificado_admin
          ? "Convertido a insumo. Se notificó al Admin."
          : "Convertido a insumo.",
      );
    } catch (err) {
      setConvError(safeError(err, "Error al convertir a insumo"));
    } finally {
      setConvSaving(false);
    }
  };

  const cambiarCantidad = async (item, val) => {
    const n = Math.max(1, parseInt(val, 10) || 1);
    if (n === item.cantidad) return;
    setErrorMsg("");
    try {
      const { error } = await supabase.rpc("fn_ensamble_receta", {
        p_ensamble_id: ensambleId,
        p_accion: "editar",
        p_producto_id: item.producto?.id,
        p_cantidad: n,
      });
      if (error) throw error; // trigger ajusta el insumo
      await cargar();
    } catch (err) {
      avisarError(err, "Error al cambiar la cantidad");
      // Re-sincroniza el input con lo que quedó en la BD: si el cambio fue
      // rechazado (p.ej. insumo insuficiente), el número en pantalla mentía.
      await cargar();
    }
  };

  const quitarInsumo = async (item) => {
    setErrorMsg("");
    try {
      const { error } = await supabase.rpc("fn_ensamble_receta", {
        p_ensamble_id: ensambleId,
        p_accion: "quitar",
        p_producto_id: item.producto?.id,
      });
      if (error) throw error; // trigger devuelve el insumo
      await cargar();
    } catch (err) {
      avisarError(err, "Error al quitar el insumo");
    }
  };

  const marcarTerminado = async () => {
    if (accion) return;
    setAccion(true);
    setErrorMsg("");
    try {
      const { error } = await supabase.rpc("fn_ensamble_estado", {
        p_ensamble_id: ensambleId,
        p_accion: "terminar",
      });
      if (error) throw error;
      await cargar();
      avisarOk(
        "Marcado como terminado. La receta queda congelada; quien lo creó puede completarlo.",
      );
    } catch (err) {
      avisarError(err, "Error al marcar terminado");
    } finally {
      setAccion(false);
    }
  };

  const reabrir = async () => {
    if (accion) return;
    setAccion(true);
    setErrorMsg("");
    try {
      const { error } = await supabase.rpc("fn_ensamble_estado", {
        p_ensamble_id: ensambleId,
        p_accion: "reabrir",
      });
      if (error) throw error;
      await cargar();
      avisarOk("Ensamble reabierto: la receta se puede corregir de nuevo.");
    } catch (err) {
      avisarError(err, "Error al reabrir");
    } finally {
      setAccion(false);
    }
  };

  const completar = async () => {
    if (accion) return;
    // Resumen honesto de lo que va a pasar con el inventario (UX ENS-05).
    const totalInsumos = items.reduce((s, i) => s + (i.cantidad ?? 0), 0);
    // Mismo número que muestra la página: si divergieran, el diálogo diría
    // una cosa y la pantalla otra justo en el momento de decidir.
    const costoMateriales = costoMaterialesVista;
    const ok = await confirm({
      titulo: "Completar ensamble",
      mensaje:
        `Entra al inventario de venta: ${ens.cantidad_producida} × ${ens.producto?.nombre ?? "producto"}. ` +
        `Se consumieron ${totalInsumos} insumo(s)` +
        (esAdmin
          ? ` por ${formatCOP(costoMateriales)} en materiales (el costo del producto se actualizará solo).`
          : ".") +
        " Esta acción no se puede deshacer desde aquí.",
      confirmLabel: "Sí, completar",
    });
    if (!ok) return;
    setAccion(true);
    setErrorMsg("");
    try {
      const { error } = await supabase.rpc("fn_ensamble_estado", {
        p_ensamble_id: ensambleId,
        p_accion: "completar",
      });
      if (error) throw error; // trigger produce el resultado + notifica
      avisarOk(
        `Ensamble completado: ${ens.cantidad_producida} × ${ens.producto?.nombre ?? "producto"} entró al inventario.`,
      );
      navigate("/ops/ensambles");
    } catch (err) {
      avisarError(err, "Error al completar");
      setAccion(false);
    }
  };

  const eliminar = async () => {
    const ok = await confirm({
      titulo: "Eliminar ensamble",
      mensaje:
        "Se intentará devolver los insumos al pool y, si estaba completado, quitar el producto del stock. Solo es posible si el producido sigue completo en stock: si ya se vendió o trasladó parte, la eliminación se rechazará. ¿Confirmar?",
      confirmLabel: "Sí, eliminar",
    });
    if (!ok) return;
    setAccion(true);
    try {
      const { error } = await supabase.rpc("fn_eliminar_ensamble", {
        p_ensamble_id: ensambleId,
      });
      if (error) throw error;
      avisarOk("Ensamble eliminado.");
      navigate("/ops/ensambles");
    } catch (err) {
      avisarError(err, "Error al eliminar");
      setAccion(false);
    }
  };

  if (loading)
    return (
      <p className="p-6 text-sm" style={{ color: "var(--n-500)" }}>
        Cargando…
      </p>
    );
  if (!ens)
    return (
      <p className="p-6 text-sm" style={{ color: "var(--dang-700)" }}>
        {errorMsg || "Ensamble no encontrado"}
      </p>
    );

  const pill = ensambleEstadoPill(ens);

  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4 px-4 py-5 sm:px-7 sm:py-6 animate-fade-in">
      <button
        onClick={() => navigate("/ops/ensambles")}
        className="back-btn inline-flex items-center gap-1.5"
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver a Ensambles
      </button>

      <div
        className="flex flex-wrap items-start justify-between gap-3 border-b pb-4"
        style={{ borderColor: "var(--n-100)" }}
      >
        <div className="min-w-0">
          <div className="ph-eyebrow">Ensamble #{ens.numero}</div>
          <h1 className="ph-client" style={{ marginBottom: 0 }}>
            {ens.producto?.nombre ?? "—"}
          </h1>
          <p className="ph-sub mt-1.5">
            {ens.producto?.referencia} · ×{ens.cantidad_producida} · técnico:{" "}
            {ens.tecnico?.nombre ?? "—"} · creó: {ens.realizador?.nombre ?? "—"}
          </p>
        </div>
        <span className={pill.cls}>
          <span className="dot" />
          {pill.label}
        </span>
      </div>

      {/* Insumos de la receta */}
      <div className="iblock">
        <div className="ib-head">
          <div className="ib-ico">
            <Hammer className="h-3.5 w-3.5" strokeWidth={1.7} />
          </div>
          <div className="ib-title">Insumos de la receta</div>
          <div className="ib-aux">{items.length} comp.</div>
        </div>

        {items.length === 0 ? (
          <p
            className="px-1 py-2 text-xs italic"
            style={{ color: "var(--n-500)" }}
          >
            Sin insumos.
          </p>
        ) : (
          <ul className="space-y-2" role="list">
            {items.map((it) => (
              <li
                key={it.id}
                className="flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5"
                style={{
                  borderColor: "var(--n-150)",
                  backgroundColor: "var(--n-0)",
                }}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-medium"
                    style={{ color: "var(--n-950)" }}
                  >
                    {it.producto?.nombre ?? "—"}
                  </p>
                  <p
                    className="font-mono text-xs"
                    style={{ color: "var(--n-500)" }}
                  >
                    {it.producto?.referencia}
                    {/* Costo: solo Admin */}
                    {esAdmin && <> · {formatCOP(it.costo_unitario)} c/u</>}
                  </p>
                </div>
                {puedeEditarReceta ? (
                  <input
                    type="number"
                    min="1"
                    step="1"
                    /* key con la cantidad: si la BD rechaza el cambio y
                       cargar() re-trae el valor real, el input NO controlado
                       se re-monta y deja de mostrar el número rechazado. */
                    key={`${it.id}-${it.cantidad}`}
                    defaultValue={it.cantidad}
                    onBlur={(e) => cambiarCantidad(it, e.target.value)}
                    className="min-h-[44px] w-16 rounded-lg border px-2 text-center font-mono text-sm tabular-nums outline-none"
                    style={{
                      backgroundColor: "var(--n-0)",
                      borderColor: "var(--n-200)",
                      color: "var(--n-950)",
                    }}
                  />
                ) : (
                  <span
                    className="font-mono text-sm tabular-nums"
                    style={{ color: "var(--n-900)" }}
                  >
                    ×{it.cantidad}
                  </span>
                )}
                {puedeEditarReceta && (
                  <button
                    onClick={() => quitarInsumo(it)}
                    aria-label="Quitar insumo"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-md"
                    style={{ color: "var(--dang-700)" }}
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Costo de materiales: solo Admin, y en la PÁGINA — antes solo salía
            dentro del cuadro de confirmación al pulsar Completar. */}
        {esAdmin && items.length > 0 && (
          <div
            className="mt-3 flex items-center justify-between rounded-lg border px-3.5 py-3"
            style={{
              borderColor: "var(--p-200)",
              backgroundColor: "var(--n-0)",
            }}
          >
            <div>
              <p
                className="font-mono text-[10px] uppercase tracking-[0.08em]"
                style={{ color: "var(--n-300)" }}
              >
                {ens.completado
                  ? "Costo de materiales"
                  : "Costo estimado de materiales"}
              </p>
              {ens.cantidad_producida > 1 && (
                <p className="text-[11.5px]" style={{ color: "var(--n-500)" }}>
                  {formatCOP(
                    Math.round(
                      costoMaterialesVista / (ens.cantidad_producida || 1),
                    ),
                  )}{" "}
                  por unidad · {ens.cantidad_producida} unidades
                </p>
              )}
            </div>
            <p
              className="font-mono text-[20px] font-medium tabular-nums"
              style={{ color: "var(--p-700)" }}
            >
              {formatCOP(costoMaterialesVista)}
            </p>
          </div>
        )}

        {/* Agregar insumo (solo si editable) */}
        {puedeEditarReceta && (
          <div className="mt-3 space-y-2">
            <div
              className="flex h-12 items-center gap-2.5 rounded-lg border px-3.5"
              style={{
                borderColor: "var(--n-200)",
                backgroundColor: "var(--n-0)",
              }}
            >
              <Search
                className="h-4 w-4 shrink-0"
                strokeWidth={1.5}
                style={{ color: "var(--n-500)" }}
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Agregar insumo (mín 2 letras)…"
                className="min-w-0 flex-1 border-none bg-transparent text-sm outline-none"
                style={{ color: "var(--n-950)" }}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  aria-label="Limpiar"
                  className="grid h-6 w-6 place-items-center rounded"
                  style={{ color: "var(--n-500)" }}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setModoGlobal(false)}
                className="rounded-md px-2.5 py-1 font-medium"
                style={{
                  backgroundColor: !modoGlobal
                    ? "var(--p-700)"
                    : "var(--n-100)",
                  color: !modoGlobal ? "#fff" : "var(--n-500)",
                }}
              >
                Solo insumos
              </button>
              <button
                type="button"
                onClick={() => setModoGlobal(true)}
                className="rounded-md px-2.5 py-1 font-medium"
                style={{
                  backgroundColor: modoGlobal ? "var(--p-700)" : "var(--n-100)",
                  color: modoGlobal ? "#fff" : "var(--n-500)",
                }}
              >
                Inventario global
              </button>
            </div>
            {buscando && (
              <p className="text-xs" style={{ color: "var(--n-500)" }}>
                Buscando…
              </p>
            )}
            {resultados.length > 0 && (
              <ul
                className="max-h-56 divide-y overflow-y-auto rounded-lg border"
                style={{ borderColor: "var(--n-150)" }}
              >
                {resultados.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => onSelectInsumo(p)}
                      className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left"
                      style={{ backgroundColor: "var(--n-0)" }}
                    >
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-sm font-medium"
                          style={{ color: "var(--n-950)" }}
                        >
                          {p.nombre}
                        </p>
                        <p
                          className="font-mono text-xs"
                          style={{ color: "var(--n-500)" }}
                        >
                          {p.referencia} · insumo: {p.insumo ?? 0}
                          {(p.insumo ?? 0) < 1 && (
                            <span style={{ color: "var(--warn-700)" }}>
                              {" "}
                              · venta: {p.venta ?? 0}
                            </span>
                          )}
                        </p>
                      </div>
                      <span
                        className="shrink-0 text-xs font-medium"
                        style={{ color: "var(--p-700)" }}
                      >
                        + Agregar
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Acciones de estado */}
      <div className="flex flex-wrap gap-2.5">
        {puedeTerminar && (
          <button
            onClick={marcarTerminado}
            disabled={accion}
            className="flex-1 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ height: 48, backgroundColor: "var(--info-600, #0284c7)" }}
          >
            <Check className="mr-1 inline h-4 w-4" strokeWidth={2} />
            Ensamble terminado
          </button>
        )}
        {puedeReabrir && (
          <button
            onClick={reabrir}
            disabled={accion}
            className="rounded-lg border px-4 text-sm font-medium disabled:opacity-50"
            style={{
              height: 48,
              borderColor: "var(--n-200)",
              color: "var(--n-700)",
              backgroundColor: "var(--n-0)",
            }}
          >
            Reabrir para corregir
          </button>
        )}
        {puedeCompletar && (
          <button
            onClick={completar}
            disabled={accion}
            className="flex-1 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ height: 48, backgroundColor: "var(--p-600)" }}
          >
            Completar ensamble
          </button>
        )}
        {!ens.completado &&
          ens.terminado &&
          !puedeCompletar &&
          !puedeReabrir && (
            <p
              className="flex-1 rounded-lg border px-3 py-3 text-center text-xs"
              style={{ borderColor: "var(--n-200)", color: "var(--n-500)" }}
            >
              Terminado por el técnico. Falta que quien lo creó lo complete.
            </p>
          )}
        {/* Observador sin acciones en un ensamble en proceso: decirle qué
            está pasando en vez de una pantalla muda (UX ENS-04). */}
        {!ens.completado &&
          !ens.terminado &&
          !puedeTerminar &&
          !puedeEditarReceta && (
            <p
              className="flex-1 rounded-lg border px-3 py-3 text-center text-xs"
              style={{ borderColor: "var(--n-200)", color: "var(--n-500)" }}
            >
              En proceso:{" "}
              {ens.tecnico?.nombre ?? ens.realizador?.nombre ?? "el taller"}{" "}
              está armando el equipo. Cuando lo marque terminado, quien lo creó
              podrá completarlo.
            </p>
          )}
        {esAdmin && (
          <button
            onClick={eliminar}
            disabled={accion}
            className="rounded-lg border px-4 text-sm font-medium disabled:opacity-50"
            style={{
              height: 48,
              borderColor: "var(--dang-200)",
              color: "var(--dang-700)",
              backgroundColor: "var(--n-0)",
            }}
          >
            <Trash2 className="mr-1 inline h-4 w-4" strokeWidth={1.7} />
            Eliminar
          </button>
        )}
      </div>

      {/* Modal: convertir venta→insumo */}
      {convProd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => !convSaving && setConvProd(null)}
        >
          <div
            className="w-full max-w-md space-y-3 rounded-xl border p-5"
            style={{
              backgroundColor: "var(--n-0)",
              borderColor: "var(--n-200)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              className="text-lg font-semibold"
              style={{ color: "var(--n-950)" }}
            >
              Convertir a insumo
            </h3>
            <p className="text-xs" style={{ color: "var(--n-500)" }}>
              <strong>{convProd.nombre}</strong> · insumo:{" "}
              {convProd.insumo ?? 0} · venta disponible: {convProd.venta ?? 0}
            </p>
            <p
              className="rounded-md px-3 py-2 text-xs"
              style={{
                backgroundColor: "var(--warn-50)",
                color: "var(--warn-700)",
              }}
            >
              ¿Seguro que deseas convertir? Al confirmar, se notificará al
              Admin.
            </p>
            {convError && (
              <div
                role="alert"
                className="rounded-lg border px-3 py-2 text-xs"
                style={{
                  backgroundColor: "var(--dang-50)",
                  borderColor: "var(--dang-200)",
                  color: "var(--dang-700)",
                }}
              >
                {convError}
              </div>
            )}
            <div>
              <label className="text-xs" style={{ color: "var(--n-500)" }}>
                Cantidad a convertir (máx. {convProd.venta ?? 0})
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={convCant}
                onChange={(e) => setConvCant(e.target.value)}
                disabled={convSaving}
                autoFocus
                className="mt-1 min-h-[44px] w-full rounded-lg border px-3 py-2 text-sm"
                style={{
                  backgroundColor: "var(--n-0)",
                  borderColor: "var(--n-200)",
                  color: "var(--n-900)",
                }}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setConvProd(null)}
                disabled={convSaving}
                className="min-h-[44px] rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
                style={{ borderColor: "var(--n-200)", color: "var(--n-500)" }}
              >
                Cancelar
              </button>
              <button
                onClick={convertir}
                disabled={convSaving}
                className="min-h-[44px] rounded-lg px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: "var(--p-700)" }}
              >
                {convSaving ? "Convirtiendo…" : "Sí, convertir y agregar"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog />
    </div>
  );
}
