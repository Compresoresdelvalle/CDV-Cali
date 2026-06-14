import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeftCircle,
  Printer,
  ShieldCheck,
  Wallet,
  ClipboardCheck,
  FileText,
  Wrench,
  Search,
  X,
  Trash2,
  User,
  Phone,
  Hash,
  Package,
  Save,
  Activity,
  Info,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import { applyKeywordSearch } from "../../lib/search";
import {
  ordenEstadoPill,
  autorizacionPill,
  tecnicoAvatar,
  OT_ESTADO_LABELS,
  diasEnEstado,
  construirHistorialOT,
} from "../../lib/ordenes-ui";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import ChecklistRecepcion from "../../components/ot/ChecklistRecepcion";
import { SEDES } from "../../lib/constants";
import { SEDE_LABELS } from "../../lib/traspasos-ui";
import AbonosPanel from "../../components/ot/AbonosPanel";
import AutorizacionPanel from "../../components/ot/AutorizacionPanel";
import CotizacionesAsociadasOT from "../../components/ot/CotizacionesAsociadasOT";
import ModalAbrirGarantiaVenta from "../../components/garantias/ModalAbrirGarantiaVenta";
import { generarOrdenPDF } from "../../lib/pdf/ordenPDF";

const ESTADOS = [
  "abierta",
  "en_proceso",
  "esperando_repuesto",
  "completada",
  "pendiente_recogida",
  "entregada",
];

// Transiciones permitidas (debe coincidir con trg_orden_validar_transicion en BD)
const TRANSICIONES_VALIDAS = {
  abierta: ["en_proceso", "esperando_repuesto"],
  en_proceso: ["esperando_repuesto", "completada"],
  esperando_repuesto: ["en_proceso", "completada"],
  completada: ["pendiente_recogida", "entregada"],
  pendiente_recogida: ["entregada"],
  entregada: [],
};

export default function OrdenDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const { confirm, ConfirmDialog } = useConfirm();

  const [orden, setOrden] = useState(null);
  const [detalles, setDetalles] = useState([]);
  const [abonado, setAbonado] = useState(0);
  // Cotizaciones vinculadas — alimenta el banner de "cierre de ciclo" y las
  // vinculaciones del aside. CotizacionesAsociadasOT mantiene su propia lista
  // editable; aquí solo guardamos un resumen para presentación.
  const [vinculos, setVinculos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [trabajoRealizado, setTrabajoRealizado] = useState("");
  const [savingTrabajo, setSavingTrabajo] = useState(false);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);
  const [modalGarantia, setModalGarantia] = useState(false);
  const [modalSegunda, setModalSegunda] = useState(false); // B7: inventario 2da
  const [imprimiendo, setImprimiendo] = useState(false);
  // Ítem 5 — asignar/reasignar técnico en revisión (2º momento, no en recepción).
  const [tecnicosList, setTecnicosList] = useState([]);
  const [asignandoTecnico, setAsignandoTecnico] = useState(false);
  const [cancelando, setCancelando] = useState(false); // B1: cancelar OT (Admin)
  const agregandoRef = useRef(false);
  const cambiandoRef = useRef(false);

  // Lista de técnicos/admins disponibles para asignar a la OT.
  useEffect(() => {
    supabase
      .from("usuarios")
      .select("id, nombre, rol")
      .eq("activo", true)
      .in("rol", ["Tecnico", "Admin"])
      .order("nombre")
      .then(({ data }) => setTecnicosList(data ?? []));
  }, []);

  // Guard anti doble-click: imprime la OT una sola vez por tap
  const imprimirOT = async () => {
    if (imprimiendo) return;
    setImprimiendo(true);
    try {
      // #24: cargar el checklist de recepción para incluirlo en el PDF.
      const { data: ck } = await supabase
        .from("ot_checklist")
        .select(
          "marcado, componente:componente_id!inner(nombre, orden, activo)",
        )
        .eq("orden_id", id)
        .eq("componente.activo", true);
      const checklist = (ck ?? [])
        .map((r) => ({
          nombre: r.componente?.nombre ?? "—",
          marcado: !!r.marcado,
          orden: r.componente?.orden ?? 0,
        }))
        .sort((a, b) => a.orden - b.orden);
      // Abonos del cliente: se imprimen en el PDF para todos los roles.
      const { data: ab } = await supabase
        .from("abonos")
        .select("fecha, monto, metodo_pago, observaciones")
        .eq("orden_id", id)
        .order("fecha", { ascending: true });
      generarOrdenPDF({
        orden,
        repuestos: detalles,
        tecnico: orden.tecnico?.nombre ?? "—",
        checklist,
        abonos: ab ?? [],
        // Solo el Admin ve el desglose de COSTOS; el total a pagar, los abonos
        // y el saldo se imprimen para todos los roles.
        incluirCostos: isAdmin,
      }).print();
    } catch (err) {
      console.error("[OrdenDetalle] imprimir:", err);
      setErrorMsg(safeError(err, "No se pudo generar el PDF de la orden"));
    } finally {
      setTimeout(() => setImprimiendo(false), 1500);
    }
  };

  // Repuesto picker state
  const [search, setSearch] = useState("");
  const [modoGlobal, setModoGlobal] = useState(false); // false = solo insumos
  const [aviso, setAviso] = useState(""); // aviso verde (p.ej. "se notificó al Admin")
  const [convProd, setConvProd] = useState(null); // producto a convertir+agregar
  const [convCant, setConvCant] = useState("1");
  const [convSaving, setConvSaving] = useState(false);
  const [cantAgregar, setCantAgregar] = useState(1); // #25 — cantidad a agregar
  const [convError, setConvError] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [agregando, setAgregando] = useState(false);

  const cargar = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const { data: o, error: e1 } = await supabase
        .from("ordenes_servicio")
        .select(
          `*, tecnico:tecnico_id(nombre, rol), creador:creado_por(nombre, rol)`,
        )
        .eq("id", id)
        .maybeSingle();
      if (e1) throw e1;
      if (!o) {
        setErrorMsg("Orden no encontrada");
        setLoading(false);
        return;
      }
      setOrden(o);
      setTrabajoRealizado(o.trabajo_realizado ?? "");

      const { data: d, error: e2 } = await supabase
        .from("detalle_orden")
        .select(
          `id, cantidad, costo_unitario, subtotal,
           producto:producto_id(id, referencia, nombre)`,
        )
        .eq("orden_id", id)
        .order("created_at", { ascending: true });
      if (e2) throw e2;
      setDetalles(d ?? []);

      // Suma de abonos para el saldo del header (solo presentación).
      const { data: ab } = await supabase
        .from("abonos")
        .select("monto")
        .eq("orden_id", id);
      setAbonado((ab ?? []).reduce((s, a) => s + (Number(a.monto) || 0), 0));

      // Resumen de cotizaciones vinculadas (para banner de ciclo + vínculos).
      const { data: cots } = await supabase
        .from("cotizaciones")
        .select("id, numero, estado")
        .eq("ot_id", id)
        .order("fecha", { ascending: false });
      setVinculos(cots ?? []);
    } catch (err) {
      console.error("[OrdenDetalle]", err);
      setErrorMsg(safeError(err, "Error al cargar"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Buscar productos para agregar repuesto
  // Depende solo de search y sede_id (estable) para evitar abortar al refrescar orden
  const sedeOrden = orden?.sede_id;
  useEffect(() => {
    if (!sedeOrden) return;
    if (search.trim().length < 2) {
      setResultados([]);
      setBuscando(false);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        // Búsqueda por nombre/referencia; luego inventario en la sede de la orden.
        // Traemos todos los activos que coincidan y filtramos por modo más abajo.
        // #32: búsqueda por palabras clave en referencia/nombre.
        let pq = supabase
          .from("productos")
          .select(
            "id, referencia, nombre, precio_venta, costo_promedio, vendible",
          )
          .eq("activo", true);
        pq = applyKeywordSearch(pq, search, ["referencia", "nombre"]);
        const { data: prods, error: e1 } = await pq.limit(1000);
        if (ac.signal.aborted) return;
        if (e1) throw e1;

        if (!prods || prods.length === 0) {
          setResultados([]);
          return;
        }

        const ids = prods.map((p) => p.id);
        const { data: inv, error: e2 } = await supabase
          .from("inventario")
          .select("producto_id, cantidad, cantidad_insumo")
          .in("producto_id", ids)
          .eq("sede_id", sedeOrden);
        if (ac.signal.aborted) return;
        if (e2) throw e2;

        const byProd = new Map();
        (inv ?? []).forEach((r) => byProd.set(r.producto_id, r));

        // Se muestran TODOS (incl. insumo 0) para poder convertir y no parar la
        // operación. `insumo` = stock de insumo en la sede de la OT; `venta` = el
        // stock de venta disponible para convertir.
        const enriched = prods.map((p) => ({
          ...p,
          insumo: byProd.get(p.id)?.cantidad_insumo ?? 0,
          venta: byProd.get(p.id)?.cantidad ?? 0,
        }));
        // "Solo insumos": designados insumo (vendible=false) O cualquiera que ya
        // tenga stock de insumo en esta sede (p.ej. un vendible convertido).
        // "Inventario global": todo el catálogo activo.
        const visibles = modoGlobal
          ? enriched
          : enriched.filter((p) => p.vendible === false || (p.insumo ?? 0) > 0);
        setResultados(visibles);
      } catch (err) {
        if (!ac.signal.aborted) {
          console.error("[OrdenDetalle] search:", err);
          setResultados([]);
        }
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [search, sedeOrden, modoGlobal]);

  const agregarRepuesto = async (producto, cantidad = 1) => {
    // Guard síncrono: un doble-tap insertaría el repuesto dos veces
    // (doble fila en detalle_orden + doble descuento de stock vía trigger).
    if (agregandoRef.current) return;
    const qty = Math.max(1, Math.trunc(Number(cantidad) || 1));
    agregandoRef.current = true;
    setAgregando(true);
    setErrorMsg("");
    try {
      const stockInsumo = producto.insumo ?? 0;
      if (stockInsumo < qty) {
        setErrorMsg(
          `Solo hay ${stockInsumo} de insumo de "${producto.nombre}" en esta sede (pediste ${qty}).`,
        );
        return;
      }
      // Para reportes de margen: el COSTO de un repuesto consumido es
      // costo_promedio (lo que costó adquirirlo), no precio_venta.
      // Si el cliente paga por la mano de obra + repuestos, el cargo se
      // hace aparte en costo_mano_obra.
      const costo = producto.costo_promedio || producto.precio_venta || 0;
      const { error } = await supabase.from("detalle_orden").insert({
        orden_id: id,
        producto_id: producto.id,
        cantidad: qty, // #25: cantidad elegida (el trigger consume NEW.cantidad)
        costo_unitario: costo,
        subtotal: costo * qty,
      });
      if (error) throw error;
      // Los totales se recalculan automáticamente vía trigger BD
      setSearch("");
      setResultados([]);
      setCantAgregar(1);
      await cargar();
    } catch (err) {
      console.error("[OrdenDetalle] agregar:", err);
      setErrorMsg(safeError(err, "Error al agregar repuesto"));
    } finally {
      setAgregando(false);
      agregandoRef.current = false;
    }
  };

  // Al elegir un repuesto: usa la cantidad elegida. Si hay insumo suficiente se
  // agrega; si no, se ofrece convertir el faltante desde el stock de venta.
  const onSelectRepuesto = (p) => {
    setErrorMsg("");
    setAviso("");
    const qty = Math.max(1, Math.trunc(Number(cantAgregar) || 1));
    const insumo = p.insumo ?? 0;
    const venta = p.venta ?? 0;
    if (insumo >= qty) {
      agregarRepuesto(p, qty);
    } else if (insumo + venta >= qty) {
      // Faltante a convertir de venta → insumo.
      setConvCant(String(qty - insumo));
      setConvError("");
      setConvProd(p);
    } else {
      setErrorMsg(
        `"${p.nombre}" no tiene suficiente stock (insumo ${insumo} + venta ${venta}) para ${qty} en esta sede. Pide un traspaso o una compra.`,
      );
    }
  };

  // Convierte N de venta→insumo (en la sede de la OT) y luego agrega el repuesto.
  // Avisa al Admin (la RPC inserta la notificación si no eres Admin).
  const convertirYAgregar = async () => {
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
        p_sede_id: sedeOrden,
        p_cantidad: n,
      });
      if (error) throw error;
      const prod = { ...convProd, insumo: (convProd.insumo ?? 0) + n };
      setConvProd(null);
      await agregarRepuesto(prod, cantAgregar);
      setAviso(
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

  const quitarRepuesto = async (detalleId) => {
    const ok = await confirm({
      titulo: "Eliminar repuesto",
      mensaje:
        "El stock del componente será restaurado automáticamente. Esta acción registra un movimiento de devolución en BD.",
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    setErrorMsg("");
    try {
      const { error } = await supabase
        .from("detalle_orden")
        .delete()
        .eq("id", detalleId);
      if (error) throw error;
      // El trigger BD repone stock y recalcula totales automáticamente
      await cargar();
    } catch (err) {
      console.error("[OrdenDetalle] quitar:", err);
      setErrorMsg(safeError(err, "Error al eliminar repuesto"));
    }
  };

  const cambiarEstado = async (nuevoEstado) => {
    if (cambiandoRef.current) return;
    cambiandoRef.current = true;
    setCambiandoEstado(true);
    setErrorMsg("");
    try {
      const update = { estado: nuevoEstado };
      if (nuevoEstado === "entregada")
        update.fecha_entrega = new Date().toISOString();
      // Guard optimista: solo aplica si la OT sigue en el estado que la UI
      // cree (otra pestaña/usuario pudo haberlo cambiado).
      const { data, error } = await supabase
        .from("ordenes_servicio")
        .update(update)
        .eq("id", id)
        .eq("estado", orden.estado)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        setErrorMsg(
          "El estado de la orden cambió mientras tanto. Se recargó la información.",
        );
      }
      await cargar();
    } catch (err) {
      console.error("[OrdenDetalle] estado:", err);
      setErrorMsg(safeError(err, "Error al cambiar estado"));
    } finally {
      setCambiandoEstado(false);
      cambiandoRef.current = false;
    }
  };

  // B1 — Cancelar la OT (solo Admin). Devuelve los repuestos consumidos al
  // inventario (la RPC borra los detalles y el trigger restaura el insumo).
  const cancelarOrden = async () => {
    const ok = await confirm({
      titulo: "Cancelar orden de trabajo",
      mensaje:
        "Se cancelará la OT y se devolverán al inventario los repuestos consumidos. Esta acción no se puede deshacer.",
      confirmLabel: "Cancelar OT",
      danger: true,
    });
    if (!ok) return;
    setCancelando(true);
    setErrorMsg("");
    try {
      const { error } = await supabase.rpc("fn_cancelar_orden", {
        p_orden_id: id,
      });
      if (error) throw error;
      await cargar();
    } catch (err) {
      console.error("[OrdenDetalle] cancelar:", err);
      setErrorMsg(safeError(err, "No se pudo cancelar la orden"));
    } finally {
      setCancelando(false);
    }
  };

  // Ítem 5 — asignar/reasignar el técnico responsable (segundo momento).
  const asignarTecnico = async (nuevoTecnicoId) => {
    setAsignandoTecnico(true);
    setErrorMsg("");
    try {
      const { error } = await supabase
        .from("ordenes_servicio")
        .update({ tecnico_id: nuevoTecnicoId || null })
        .eq("id", id);
      if (error) throw error;
      await cargar();
    } catch (err) {
      console.error("[OrdenDetalle] asignar tecnico:", err);
      setErrorMsg(safeError(err, "Error al asignar técnico"));
    } finally {
      setAsignandoTecnico(false);
    }
  };

  const guardarTrabajo = async () => {
    setSavingTrabajo(true);
    setErrorMsg("");
    try {
      const { error } = await supabase
        .from("ordenes_servicio")
        .update({ trabajo_realizado: trabajoRealizado || null })
        .eq("id", id);
      if (error) throw error;
    } catch (err) {
      console.error("[OrdenDetalle] trabajo:", err);
      setErrorMsg(safeError(err, "Error al guardar"));
    } finally {
      setSavingTrabajo(false);
    }
  };

  if (loading)
    return (
      <div className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-7 sm:py-6">
        <div
          className="h-8 w-1/3 animate-pulse rounded-lg"
          style={{ backgroundColor: "var(--n-100)" }}
        />
        <div
          className="mt-4 space-y-3 rounded-[10px] border p-5"
          style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
        >
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-4 w-3/4 animate-pulse rounded"
              style={{ backgroundColor: "var(--n-100)" }}
            />
          ))}
        </div>
      </div>
    );

  if (!orden)
    return (
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-7">
        <p className="text-sm" style={{ color: "var(--dang-700)" }}>
          {errorMsg || "No encontrada"}
        </p>
        <button
          onClick={() => navigate("/ops/ordenes")}
          className="back-btn mt-4 inline-flex items-center gap-1.5"
        >
          <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
          Volver a Órdenes
        </button>
      </div>
    );

  const editable = orden.estado !== "entregada" && orden.estado !== "cancelada";
  const isAdmin = perfil?.rol === "Admin";
  const esVendedor = perfil?.rol === "Vendedor";
  // Solo Admin, el técnico ASIGNADO específicamente, o un Vendedor pueden editar.
  // Bloque 1 (#6): el Vendedor gestiona la OT como un técnico; la RLS os_update
  // ya lo limita a OT no entregadas de su sede. Borrar OT sigue solo-Admin.
  // B1: el Vendedor ve OT de todas las sedes pero solo EDITA las de su sede
  // (coincide con os_update). El técnico asignado edita la suya; Admin todo.
  const puedeEditar =
    isAdmin ||
    orden.tecnico_id === perfil?.id ||
    (esVendedor && orden.sede_id === perfil?.sede_id);

  // B7: generar inventario de SEGUNDA desde una OT terminada (Admin/Bodeguero/
  // técnico asignado). El RPC revalida rol + sede + estado.
  const puedeGenerarSegunda =
    ["completada", "pendiente_recogida", "entregada"].includes(orden.estado) &&
    (isAdmin || perfil?.rol === "Bodeguero" || orden.tecnico_id === perfil?.id);

  const pill = ordenEstadoPill(orden.estado);
  const aPill = autorizacionPill(orden.estado_autorizacion);
  const tec = tecnicoAvatar(orden.tecnico?.nombre);
  // `total` ya incluye mano de obra + repuestos + valor_revision (canónico en BD,
  // migración 20260610000033). No re-sumar valor_revision aquí o se duplicaría.
  const totalOT = Number(orden.total ?? 0);
  const saldo = Math.max(0, totalOT - abonado);
  // Días en taller (derivado de la recepción real) y línea de tiempo de eventos.
  const diasTaller = diasEnEstado(orden);
  const historial = construirHistorialOT(orden, formatDate);
  // "Cierre de ciclo": la OT cierra una cadena cotización → OT cuando tiene
  // cotizaciones vinculadas (dato real). Honra el banner del diseño Lovable
  // adaptándolo a las vinculaciones que SÍ existen en el backend.
  const tieneCiclo = vinculos.length > 0;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-7 sm:py-6 animate-fade-in">
      <button
        onClick={() => navigate("/ops/ordenes")}
        className="back-btn inline-flex items-center gap-1.5"
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver a Órdenes
      </button>

      {/* ── Banner de cierre de ciclo (si hay cotización vinculada) ──── */}
      {tieneCiclo && (
        <div className="banner-info mt-4">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          <div className="body">
            Esta orden cierra un ciclo comercial. Vinculada a{" "}
            {vinculos.map((v, i) => (
              <span key={v.id}>
                {i > 0 && " · "}
                <button
                  onClick={() => navigate(`/ops/cotizaciones/${v.id}`)}
                  className="font-medium underline underline-offset-2"
                  style={{ color: "var(--p-700)" }}
                >
                  Cot-{v.numero}
                </button>
              </span>
            ))}{" "}
            → <b>OT-{orden.numero}</b>.
          </div>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div
        className="mt-4 flex flex-col items-start gap-4 border-b pb-4 md:flex-row md:gap-6"
        style={{ borderColor: "var(--n-150)" }}
      >
        <div className="min-w-0 flex-1">
          <div className="ph-eyebrow">Orden de trabajo</div>
          <div className="ph-num">#{orden.numero}</div>
          <div className="ph-client">{orden.cliente_nombre}</div>
          <div className="ph-sub">
            {orden.equipo_descripcion}
            {orden.equipo_serie && (
              <>
                {" "}
                · Serie{" "}
                <span
                  className="font-mono font-medium"
                  style={{ color: "var(--n-900)" }}
                >
                  {orden.equipo_serie}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 md:items-end">
          <div className="flex flex-wrap items-center gap-2">
            {diasTaller.vencida && <span className="bdg-vencida">VENCIDA</span>}
            <span className={pill.cls}>
              <span className="dot" />
              {pill.label}
            </span>
            {orden.tipo === "garantia" && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
                style={{
                  backgroundColor: "var(--warn-50)",
                  color: "var(--warn-700)",
                }}
              >
                <ShieldCheck className="h-3 w-3" strokeWidth={1.8} />
                Garantía
              </span>
            )}
          </div>
          <div className="saldo-box md:items-end">
            <span className="lbl">Saldo</span>
            <span className="val">{formatCOP(saldo)}</span>
          </div>
        </div>
      </div>

      {/* ── Action bar ─────────────────────────────────────────────── */}
      <div className="action-bar mt-4">
        <button
          onClick={imprimirOT}
          disabled={imprimiendo}
          className="btn btn-out disabled:opacity-50"
          style={{ height: 48 }}
        >
          <Printer className="h-3.5 w-3.5" strokeWidth={1.7} />
          {imprimiendo ? "Generando…" : "Imprimir OT"}
        </button>
        {isAdmin && editable && (
          <button
            onClick={cancelarOrden}
            disabled={cancelando}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium disabled:opacity-50"
            style={{
              height: 48,
              borderColor: "var(--dang-border)",
              color: "var(--dang-700)",
              backgroundColor: "var(--dang-50)",
            }}
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.7} />
            {cancelando ? "Cancelando…" : "Cancelar OT"}
          </button>
        )}
        {orden.estado === "entregada" && orden.tipo !== "garantia" && (
          <button
            onClick={() => setModalGarantia(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium"
            style={{
              height: 48,
              borderColor: "var(--warn-500)",
              color: "var(--warn-700)",
              backgroundColor: "var(--warn-50)",
            }}
          >
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.7} />
            Cliente reclama garantía
          </button>
        )}
        {puedeGenerarSegunda && (
          <button
            onClick={() => setModalSegunda(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium"
            style={{
              height: 48,
              borderColor: "var(--p-400)",
              color: "var(--p-700)",
              backgroundColor: "var(--p-50)",
            }}
          >
            <Package className="h-3.5 w-3.5" strokeWidth={1.7} />
            Generar inventario de segunda
          </button>
        )}
      </div>

      {modalGarantia && (
        <ModalAbrirGarantiaVenta
          origen={{
            tipo: "ot",
            id: orden.id,
            cliente_nombre: orden.cliente_nombre,
            sede_id: orden.sede_id,
          }}
          onClose={() => setModalGarantia(false)}
          onCreated={(gid) => {
            setModalGarantia(false);
            navigate(`/ops/garantias/venta/${gid}`);
          }}
        />
      )}

      {modalSegunda && (
        <ModalGenerarSegunda
          orden={orden}
          onClose={() => setModalSegunda(false)}
          onCreated={(prodId) => {
            setModalSegunda(false);
            navigate(`/ops/inventario?producto=${prodId}`);
          }}
        />
      )}

      {errorMsg && (
        <div
          role="alert"
          className="mt-4 rounded-[10px] border px-4 py-3 text-sm"
          style={{
            backgroundColor: "var(--dang-50)",
            borderColor: "var(--dang-border)",
            color: "var(--dang-700)",
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* ── Grid principal ─────────────────────────────────────────── */}
      <div className="mt-4 grid items-start gap-3 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-3">
          {/* Estado / máquina de estados */}
          {puedeEditar && editable && (
            <div className="iblock">
              <div className="ib-head">
                <div className="ib-ico">
                  <Wrench className="h-3.5 w-3.5" strokeWidth={1.7} />
                </div>
                <div className="ib-title">Cambiar estado</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {ESTADOS.map((e) => {
                  const esActual = orden.estado === e;
                  // Excepción: no_autorizado puede saltar abierta → completada
                  // (debe coincidir con trg_orden_validar_transicion en BD)
                  const excepcionNoAutorizado =
                    orden.estado === "abierta" &&
                    e === "completada" &&
                    orden.estado_autorizacion === "no_autorizado";
                  const permitido =
                    esActual ||
                    TRANSICIONES_VALIDAS[orden.estado]?.includes(e) ||
                    excepcionNoAutorizado;
                  return (
                    <button
                      key={e}
                      onClick={() => permitido && !esActual && cambiarEstado(e)}
                      disabled={cambiandoEstado || esActual || !permitido}
                      title={
                        !permitido && !esActual
                          ? `Transición ${orden.estado} → ${e} no permitida`
                          : undefined
                      }
                      className="rounded-lg border px-3 text-[12.5px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40"
                      style={
                        esActual
                          ? {
                              minHeight: 48,
                              backgroundColor: "var(--p-600)",
                              color: "#fff",
                              borderColor: "var(--p-600)",
                            }
                          : {
                              minHeight: 48,
                              backgroundColor: "var(--n-0)",
                              color: "var(--n-700)",
                              borderColor: "var(--n-200)",
                            }
                      }
                    >
                      {OT_ESTADO_LABELS[e]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Diagnóstico */}
          {orden.diagnostico && (
            <div className="iblock">
              <div className="ib-head">
                <div className="ib-ico">
                  <FileText className="h-3.5 w-3.5" strokeWidth={1.7} />
                </div>
                <div className="ib-title">Diagnóstico</div>
              </div>
              <p
                className="text-[13px] leading-[1.55]"
                style={{ color: "var(--n-800)" }}
              >
                {orden.diagnostico}
              </p>
            </div>
          )}

          {/* Autorización del cliente */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico succ">
                <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.7} />
              </div>
              <div className="ib-title">Autorización del cliente</div>
              <span className={aPill.cls}>
                <span className="dot" />
                {aPill.label}
              </span>
            </div>
            <AutorizacionPanel
              ordenId={orden.id}
              estadoAutorizacion={orden.estado_autorizacion}
              valorRevision={orden.valor_revision}
              readOnly={!editable || !puedeEditar}
              onChange={cargar}
            />
          </div>

          {/* Abonos / anticipos */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <Wallet className="h-3.5 w-3.5" strokeWidth={1.7} />
              </div>
              <div className="ib-title">Abonos y anticipos</div>
            </div>
            <AbonosPanel
              ordenId={orden.id}
              readOnly={!editable}
              onChange={cargar}
              totalOT={totalOT}
            />
          </div>

          {/* Repuestos consumidos */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <Package className="h-3.5 w-3.5" strokeWidth={1.7} />
              </div>
              <div className="ib-title">Repuestos consumidos</div>
              {/* El costo de los repuestos es información sensible: solo Admin. */}
              {isAdmin && (
                <div className="ib-aux">
                  {formatCOP(orden.costo_repuestos ?? 0)}
                </div>
              )}
            </div>

            {detalles.length === 0 ? (
              <p className="text-xs italic" style={{ color: "var(--n-500)" }}>
                Aún no hay repuestos
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="prod-tbl">
                  <tbody>
                    {detalles.map((d) => (
                      <tr key={d.id}>
                        <td style={{ width: 140 }}>
                          <span className="p-sku">
                            {d.producto?.referencia ?? "—"}
                          </span>
                        </td>
                        <td>
                          <div className="p-nm">
                            {d.producto?.nombre ?? "—"}
                          </div>
                        </td>
                        <td className="p-pr" style={{ width: 160 }}>
                          ×{d.cantidad}
                          {isAdmin && <> · {formatCOP(d.costo_unitario)}</>}
                        </td>
                        {isAdmin && (
                          <td className="p-sub" style={{ width: 120 }}>
                            {formatCOP(d.subtotal)}
                          </td>
                        )}
                        {puedeEditar && editable && (
                          <td style={{ width: 48 }}>
                            <button
                              onClick={() => quitarRepuesto(d.id)}
                              aria-label="Quitar repuesto"
                              className="grid place-items-center rounded-lg"
                              style={{
                                width: 36,
                                height: 36,
                                color: "var(--dang-700)",
                              }}
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Picker de repuestos */}
            {puedeEditar && editable && (
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
                    placeholder="Buscar repuesto por nombre o referencia (mín 2)…"
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

                {/* Toggle: solo insumos vs inventario global */}
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
                      backgroundColor: modoGlobal
                        ? "var(--p-700)"
                        : "var(--n-100)",
                      color: modoGlobal ? "#fff" : "var(--n-500)",
                    }}
                  >
                    Inventario global
                  </button>
                  <span style={{ color: "var(--n-500)" }}>
                    {modoGlobal
                      ? "Todo el inventario (al elegir, convierte a insumo)"
                      : "Solo insumos (elige aunque tenga 0 y conviértelo)"}
                  </span>
                </div>

                {/* #25 — cantidad a agregar (se aplica al tocar un repuesto) */}
                <div className="flex items-center gap-2 text-xs">
                  <span style={{ color: "var(--n-500)" }}>
                    Cantidad a agregar
                  </span>
                  <div
                    className="inline-flex h-9 items-center overflow-hidden rounded-md border"
                    style={{
                      borderColor: "var(--n-200)",
                      backgroundColor: "var(--n-0)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setCantAgregar((q) => Math.max(1, q - 1))}
                      className="grid h-full w-8 place-items-center text-base"
                      style={{ color: "var(--n-700)" }}
                      aria-label="Disminuir cantidad"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={cantAgregar}
                      onChange={(e) =>
                        setCantAgregar(
                          Math.max(1, Math.trunc(Number(e.target.value) || 1)),
                        )
                      }
                      className="w-12 border-0 bg-transparent text-center font-mono text-sm font-medium outline-none"
                      style={{ color: "var(--n-950)" }}
                      aria-label="Cantidad a agregar"
                    />
                    <button
                      type="button"
                      onClick={() => setCantAgregar((q) => q + 1)}
                      className="grid h-full w-8 place-items-center text-base"
                      style={{ color: "var(--n-700)" }}
                      aria-label="Aumentar cantidad"
                    >
                      +
                    </button>
                  </div>
                </div>

                {aviso && (
                  <p
                    className="rounded-md px-3 py-2 text-xs"
                    style={{
                      backgroundColor: "var(--succ-50)",
                      color: "var(--succ-700)",
                    }}
                  >
                    {aviso}
                  </p>
                )}
                {buscando && (
                  <p className="text-xs" style={{ color: "var(--n-500)" }}>
                    Buscando…
                  </p>
                )}
                {resultados.length > 0 && (
                  <ul
                    className="max-h-64 divide-y overflow-y-auto rounded-lg border"
                    style={{ borderColor: "var(--n-150)" }}
                  >
                    {resultados.map((p) => {
                      const insumo = p.insumo ?? 0;
                      const venta = p.venta ?? 0;
                      const sinNada = insumo < 1 && venta < 1;
                      return (
                        <li key={p.id}>
                          <button
                            onClick={() => !sinNada && onSelectRepuesto(p)}
                            disabled={agregando || sinNada}
                            className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                            style={{ backgroundColor: "var(--n-0)" }}
                            onMouseEnter={(e) => {
                              if (!sinNada)
                                e.currentTarget.style.backgroundColor =
                                  "var(--n-50)";
                            }}
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.backgroundColor =
                                "var(--n-0)")
                            }
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
                                {p.referencia} ·{" "}
                                <span
                                  style={{
                                    color:
                                      insumo > 0
                                        ? "var(--succ-700)"
                                        : "var(--n-500)",
                                  }}
                                >
                                  Insumo: {insumo}
                                </span>
                                {insumo < 1 &&
                                  (venta >= 1 ? (
                                    <span style={{ color: "var(--warn-700)" }}>
                                      {" "}
                                      · convertir (venta: {venta})
                                    </span>
                                  ) : (
                                    <span style={{ color: "var(--dang-700)" }}>
                                      {" "}
                                      · sin stock
                                    </span>
                                  ))}
                              </p>
                            </div>
                            <p
                              className="shrink-0 font-mono text-sm font-medium tabular-nums"
                              style={{ color: "var(--n-900)" }}
                            >
                              {formatCOP(p.precio_venta)}
                            </p>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Trabajo realizado */}
          {puedeEditar && editable && (
            <div className="iblock">
              <div className="ib-head">
                <div className="ib-ico">
                  <FileText className="h-3.5 w-3.5" strokeWidth={1.7} />
                </div>
                <div className="ib-title">Trabajo realizado</div>
              </div>
              <textarea
                value={trabajoRealizado}
                onChange={(e) => setTrabajoRealizado(e.target.value)}
                rows={3}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  backgroundColor: "var(--n-0)",
                  borderColor: "var(--n-200)",
                  color: "var(--n-950)",
                }}
              />
              <button
                onClick={guardarTrabajo}
                disabled={savingTrabajo}
                className="btn btn-out mt-2.5 disabled:opacity-50"
                style={{ height: 48 }}
              >
                <Save className="h-3.5 w-3.5" strokeWidth={1.7} />
                {savingTrabajo ? "Guardando…" : "Guardar trabajo"}
              </button>
            </div>
          )}

          {/* Checklist de recepción */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <ClipboardCheck className="h-3.5 w-3.5" strokeWidth={1.7} />
              </div>
              <div className="ib-title">Checklist de recepción</div>
            </div>
            <ChecklistRecepcion
              ordenId={orden.id}
              readOnly={!editable || !puedeEditar}
            />
          </div>

          {/* Cotizaciones asociadas */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <FileText className="h-3.5 w-3.5" strokeWidth={1.7} />
              </div>
              <div className="ib-title">Cotizaciones asociadas</div>
            </div>
            <CotizacionesAsociadasOT
              ordenId={orden.id}
              readOnly={!editable || !puedeEditar}
              sedeId={orden.sede_id}
              onChange={cargar}
            />
          </div>

          {/* Historial de eventos (derivado de timestamps reales de la OT) */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <Activity className="h-3.5 w-3.5" strokeWidth={1.7} />
              </div>
              <div className="ib-title">Historial de eventos</div>
            </div>
            {historial.length === 0 ? (
              <p className="text-xs italic" style={{ color: "var(--n-500)" }}>
                Sin eventos registrados
              </p>
            ) : (
              <div className="timeline">
                {historial.map((h, i) => (
                  <div className="tl-row" key={i}>
                    <span className={`tl-dot ${h.tone}`} />
                    <div>
                      <div className="tl-act">{h.act}</div>
                      {h.meta && <div className="tl-meta">{h.meta}</div>}
                    </div>
                    {h.time && <span className="tl-time">{h.time}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Side column ──────────────────────────────────────────── */}
        <aside className="iblock sticky top-4 self-start !p-5">
          <div className="side-block">
            <div className="eyebrow">
              <User className="h-3 w-3" strokeWidth={1.8} />
              Cliente
            </div>
            <div className="name">{orden.cliente_nombre}</div>
            {orden.cliente_telefono && (
              <div className="row mono">
                <Phone className="h-3 w-3" strokeWidth={1.8} />
                {orden.cliente_telefono}
              </div>
            )}
          </div>

          <div className="side-block">
            <div className="eyebrow">
              <Wrench className="h-3 w-3" strokeWidth={1.8} />
              Equipo
            </div>
            <div className="name">{orden.equipo_descripcion}</div>
            {orden.equipo_serie && (
              <div className="row mono">
                <Hash className="h-3 w-3" strokeWidth={1.8} />
                <span className="val">{orden.equipo_serie}</span>
              </div>
            )}
          </div>

          <div className="side-block">
            <div className="eyebrow">Asignación</div>
            <div className="row" style={{ gap: 8 }}>
              <span className={`av-tec ${tec.variant}`}>{tec.ini}</span>
              <span className="val text-[13px]">
                {orden.tecnico?.nombre ?? "Sin asignar"}
              </span>
            </div>
            {puedeEditar && editable && (
              <select
                value={orden.tecnico_id ?? ""}
                onChange={(e) => asignarTecnico(e.target.value)}
                disabled={asignandoTecnico}
                aria-label="Asignar técnico"
                className="mt-2 w-full rounded-lg border px-2 text-[13px] outline-none disabled:opacity-50"
                style={{
                  minHeight: 44,
                  backgroundColor: "var(--n-0)",
                  borderColor: "var(--n-200)",
                  color: "var(--n-950)",
                }}
              >
                <option value="">— Sin asignar —</option>
                {tecnicosList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre} ({t.rol})
                  </option>
                ))}
              </select>
            )}
            {/* B7: quién creó la OT (independiente del técnico asignado). */}
            <div className="row mono">
              Creada por:{" "}
              <span className="val">{orden.creador?.nombre ?? "—"}</span>
            </div>
            <div className="row mono">
              Recepción: <span className="val">{formatDate(orden.fecha)}</span>
            </div>
            {orden.fecha_entrega ? (
              <div className="row mono">
                Entrega:{" "}
                <span className="val">{formatDate(orden.fecha_entrega)}</span>
              </div>
            ) : (
              diasTaller.dias != null && (
                <div className="row mono">
                  En taller:{" "}
                  <span
                    className={
                      "val " +
                      (diasTaller.tone === "warn"
                        ? "days-warn"
                        : diasTaller.tone === "dang"
                          ? "days-dang"
                          : "")
                    }
                  >
                    {diasTaller.label}
                  </span>
                </div>
              )
            )}
          </div>

          {/* Vinculaciones (cadena comercial — solo si existen) */}
          {tieneCiclo && (
            <div className="side-block">
              <div className="eyebrow">Vinculaciones</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {vinculos.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => navigate(`/ops/cotizaciones/${v.id}`)}
                    className="link-pill cot"
                    style={{ cursor: "pointer" }}
                  >
                    Cot-{v.numero}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isAdmin && (
            <div className="side-block">
              <div className="eyebrow">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: "var(--p-500)" }}
                />
                Costos · Solo Admin
              </div>
              <div className="cost-row">
                <span>Revisión servicio</span>
                <span className="v">
                  {formatCOP(orden.costo_mano_obra ?? 0)}
                </span>
              </div>
              <div className="cost-row">
                <span>Repuestos</span>
                <span className="v">
                  {formatCOP(orden.costo_repuestos ?? 0)}
                </span>
              </div>
              {Number(orden.valor_revision ?? 0) > 0 && (
                <div className="cost-row">
                  <span>Valor por revisión</span>
                  <span className="v">{formatCOP(orden.valor_revision)}</span>
                </div>
              )}
              <div className="cost-row tot">
                <span>Total</span>
                <span className="v">{formatCOP(totalOT)}</span>
              </div>
              <div className="cost-row">
                <span>Abonado</span>
                <span className="v">{formatCOP(abonado)}</span>
              </div>
              <div className="cost-row saldo">
                <span>Saldo</span>
                <span className="v">{formatCOP(saldo)}</span>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Modal: convertir venta→insumo desde la OT (cualquier rol; avisa al Admin) */}
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
              <strong>{convProd.nombre}</strong> no tiene stock de insumo en
              esta sede. Convierte desde el stock de venta (disponible:{" "}
              {convProd.venta ?? 0}) para poder usarlo en la orden.
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
                onClick={convertirYAgregar}
                disabled={convSaving}
                className="min-h-[44px] rounded-lg px-5 py-2 text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: "var(--p-700)", color: "#fff" }}
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

/* ───────────── B7 · Generar producto de SEGUNDA desde la OT ───────────── */

function ModalGenerarSegunda({ orden, onClose, onCreated }) {
  const [nombre, setNombre] = useState(orden.equipo_descripcion ?? "");
  const [categoria, setCategoria] = useState("COMPRESORES");
  const [categorias, setCategorias] = useState([]);
  const [precio, setPrecio] = useState("");
  const [costo, setCosto] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [sede, setSede] = useState(orden.sede_id ?? "");
  const [referencia, setReferencia] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    supabase
      .from("productos")
      .select("categoria")
      .eq("activo", true)
      .then(({ data }) => {
        const set = [
          ...new Set((data ?? []).map((p) => p.categoria).filter(Boolean)),
        ].sort();
        setCategorias(set);
      });
  }, []);

  const soloDigitos = (v) => Number(String(v).replace(/[^\d]/g, "")) || 0;

  const generar = async () => {
    const n = soloDigitos(cantidad);
    if (!nombre.trim()) return setErr("El nombre es obligatorio.");
    if (!categoria.trim()) return setErr("La categoría es obligatoria.");
    if (!n || n <= 0) return setErr("La cantidad debe ser mayor a 0.");
    setErr(null);
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc(
        "fn_generar_producto_segunda_ot",
        {
          p_orden_id: orden.id,
          p_nombre: nombre.trim(),
          p_categoria: categoria.trim(),
          p_precio: soloDigitos(precio),
          p_costo: soloDigitos(costo),
          p_cantidad: n,
          p_sede: sede || null,
          p_referencia: referencia.trim() || null,
        },
      );
      if (error) throw new Error(error.message);
      onCreated(data?.producto_id);
    } catch (e) {
      setErr(safeError(e, "No se pudo generar el inventario de segunda"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={() => !saving && onClose()}
    >
      <div
        className="w-full max-w-md space-y-3 rounded-xl border p-5"
        style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-200)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold" style={{ color: "var(--n-950)" }}>
          Generar inventario de segunda
        </h3>
        <p className="text-xs" style={{ color: "var(--n-500)" }}>
          Crea un producto <b>de segunda mano</b> a partir de la OT #
          {orden.numero} y le da stock en la sede elegida.
        </p>

        {err && (
          <div
            role="alert"
            className="rounded-lg border px-3 py-2 text-xs"
            style={{
              backgroundColor: "var(--dang-50)",
              borderColor: "var(--dang-200)",
              color: "var(--dang-700)",
            }}
          >
            {err}
          </div>
        )}

        <div className="space-y-2.5">
          <FieldS label="Nombre del producto">
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="finput sans"
              placeholder="Ej. Compresor 2HP (segunda)"
            />
          </FieldS>
          <div className="grid grid-cols-2 gap-2.5">
            <FieldS label="Categoría">
              <input
                list="cats-segunda"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className="finput sans"
              />
              <datalist id="cats-segunda">
                {categorias.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </FieldS>
            <FieldS label="Sede destino">
              <select
                value={sede}
                onChange={(e) => setSede(e.target.value)}
                className="finput"
              >
                {Object.values(SEDES).map((s) => (
                  <option key={s} value={s}>
                    {SEDE_LABELS[s] ?? s}
                  </option>
                ))}
              </select>
            </FieldS>
            <FieldS label="Precio de venta $">
              <input
                inputMode="numeric"
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                className="finput"
                placeholder="0"
              />
            </FieldS>
            <FieldS label="Costo $">
              <input
                inputMode="numeric"
                value={costo}
                onChange={(e) => setCosto(e.target.value)}
                className="finput"
                placeholder="0"
              />
            </FieldS>
            <FieldS label="Cantidad">
              <input
                inputMode="numeric"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                className="finput"
              />
            </FieldS>
            <FieldS label="Referencia (opcional)">
              <input
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
                className="finput sans"
                placeholder="Auto si se deja vacío"
              />
            </FieldS>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="min-h-[44px] rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
            style={{ borderColor: "var(--n-200)", color: "var(--n-500)" }}
          >
            Cancelar
          </button>
          <button
            onClick={generar}
            disabled={saving}
            className="min-h-[44px] rounded-lg px-5 py-2 text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: "var(--p-700)", color: "#fff" }}
          >
            {saving ? "Generando…" : "Generar producto"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldS({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span
        className="font-mono text-[10.5px] uppercase tracking-[0.08em]"
        style={{ color: "var(--n-500)" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
