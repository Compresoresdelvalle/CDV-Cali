import { useState, useEffect, useRef, useMemo } from "react";
import {
  Plus,
  Printer,
  Search,
  Wrench,
  UserCheck,
  Hammer,
  Activity,
  AlertTriangle,
  Check,
  ChevronRight,
  MessageCircle,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatDate, sanitizeSearch, safeError } from "../../lib/utils";
import { avisarOk, avisarError } from "../../lib/notify";
import {
  prestamoVencido,
  estadoPill,
  prestamoTono,
  tonoPillCls,
  tonoLabel,
  tonoTextVar,
  sedeLabel,
  diasEnUsoTexto,
  diasVencida,
  agruparPrestamos,
  puedeDevolverHerramienta,
  STATUS_FILTERS,
} from "../../lib/herramientas-ui";
import {
  ToolIcon,
  UserAvatar,
  Pill,
} from "../../components/herramientas/HerramientasBits";
import HerramientaDetalle from "../../components/herramientas/HerramientaDetalle";
import {
  ModalPrestar,
  ModalNueva,
  ModalAgregarUnidades,
  ModalCantidadPrestamo,
} from "../../components/herramientas/HerramientaModales";

/* Selección de columnas REAL — sin cambios respecto a la versión funcional. */
const SELECT_COLS = `
  id, herramienta_nombre, herramienta_codigo, estado, prestada_a,
  fecha_prestamo, fecha_devolucion_esperada, fecha_devolucion_real,
  sede_id, observaciones, estado_prestamo, producto_id, activo,
  usuario:prestada_a(nombre, rol)
`;

const TABS = [
  { id: "activos", label: "Préstamos activos", Icon: UserCheck },
  { id: "catalogo", label: "Catálogo completo", Icon: Hammer },
  { id: "historial", label: "Historial", Icon: Activity },
];

export default function Herramientas() {
  const perfil = useAuthStore((s) => s.perfil);
  const isAdmin = perfil?.rol === "Admin";
  /** Decisión de la clienta (2026-08-26): bodega pasa a SOLO LECTURA en
   *  herramientas. Ve las cuatro sedes, pero no opera ninguna. La capacidad
   *  operativa por ROL queda solo en el Admin.
   *
   *  Se conserva como variable con nombre —en vez de escribir `isAdmin` suelto
   *  por todas partes— porque devolverle la capacidad a bodega es cambiar esta
   *  única línea, y porque el nombre dice POR QUÉ se puede, no QUIÉN eres. */
  const puedeOperarRol = isAdmin;
  /** Prestar es la excepción: lo conservan las vendedoras además del Admin.
   *  Va aparte de `puedeOperarRol` a propósito — no basta con la sede, porque
   *  el servidor (fn_prestar_herramientas_lote) deja prestar a CUALQUIER rol en
   *  su propia sede, incluido bodega. Sin esta condición, un bodeguero seguiría
   *  viendo "Prestar" en BODEGA y el servidor se lo permitiría, rompiendo el
   *  solo-lectura que pidió la clienta.
   *  Recibir NO está aquí: fn_devolver_herramienta rechaza a las vendedoras,
   *  así que solo el Admin registra devoluciones. */
  const puedePrestarRol = isAdmin || perfil?.rol === "Vendedor";
  const puedeCrear = isAdmin;
  const miSede = perfil?.sede_id;
  /** Las funciones del servidor solo dejan actuar sobre la sede propia, salvo
   *  al Admin. Ahora que la lista muestra herramientas de las cuatro sedes, el
   *  permiso ya no depende solo del rol: depende de CADA herramienta. Sin esto
   *  aparecerían botones que el servidor rechaza con "No tienes permiso sobre
   *  herramientas de esta sede". */
  const puedeOperarEn = (sedeId) => isAdmin || sedeId === miSede;

  const [herramientas, setHerramientas] = useState([]);
  // Historial aparte: son 417 filas inactivas que no hacen falta salvo que se
  // abra esa pestaña. `null` = todavía no se ha pedido.
  const [devueltas, setDevueltas] = useState(null);
  const [historialTruncado, setHistorialTruncado] = useState(false);
  const [historialError, setHistorialError] = useState("");
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("activos");
  const [filtroEstado, setFiltroEstado] = useState("todas");
  const [search, setSearch] = useState("");
  const [accionando, setAccionando] = useState(null);
  // Solo el error de CARGA de la lista (estado persistente) va en un banner fijo.
  // Los resultados de acción (devolver/consumir/extraviar…) saltan como pop-up.
  const [errorMsg, setErrorMsg] = useState("");

  const [modalPrestar, setModalPrestar] = useState(null);
  const [modalNueva, setModalNueva] = useState(false);
  const [modalAgregar, setModalAgregar] = useState(null); // herramienta a la que sumar unidades
  // Devolver / dar de baja parte de un préstamo de varias unidades: { grupo, accion }
  const [modalCantidad, setModalCantidad] = useState(null);
  const [detalleId, setDetalleId] = useState(null);

  const mountedRef = useRef(true);
  const accionandoRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* ── Carga (consulta REAL con RBAC por sede + búsqueda server-side) ───── */
  const cargarHerramientas = async (signal) => {
    setLoading(true);
    setErrorMsg("");
    try {
      // Solo las ACTIVAS: alimentan Catálogo y Préstamos activos.
      //
      // El Historial se carga en su propia consulta (cargarHistorial) y solo
      // cuando se abre esa pestaña. Antes todo salía de una sola consulta sin
      // filtro de `activo` para no perder el historial de las herramientas
      // regresadas a insumo — el problema real que documentaba el comentario
      // anterior (171 devoluciones, solo 3 visibles). Ese arreglo se conserva:
      // el historial sigue viendo las inactivas, solo que por separado.
      //
      // Motivo del cambio: al abrir la vista a las cuatro sedes, esta consulta
      // pasó de traer 3 filas a 529 para una vendedora. Separando, el caso
      // común baja a 112 (las activas) y las 417 históricas solo viajan cuando
      // alguien entra al Historial.
      let query = supabase
        .from("herramientas_prestamo")
        .select(SELECT_COLS)
        .eq("activo", true)
        .order("herramienta_nombre", { ascending: true });

      // Sin filtro por sede a propósito: las herramientas viajan entre sedes y
      // nadie podía saber dónde quedó una sin llamar por teléfono. Lo que sigue
      // acotado por sede son las ACCIONES, que se deciden fila por fila con
      // `puedeOperarEn` — ver la nota junto a su definición.
      const q = sanitizeSearch(search.trim());
      if (q)
        query = query.or(
          `herramienta_nombre.ilike.%${q}%,herramienta_codigo.ilike.%${q}%`,
        );

      const { data, error } = await query;
      if (signal?.aborted || !mountedRef.current) return;
      if (error) throw error;
      setHerramientas(data ?? []);
    } catch (err) {
      if (signal?.aborted || !mountedRef.current) return;
      console.error("[Herramientas] cargar:", err);
      setErrorMsg(safeError(err, "Error al cargar herramientas"));
      setHerramientas([]);
    } finally {
      if (!signal?.aborted && mountedRef.current) setLoading(false);
    }
  };

  /** Historial de devoluciones. Se pide solo al abrir esa pestaña, e incluye
   *  las herramientas INACTIVAS (una inventariable devuelta sale del catálogo
   *  pero su devolución ocurrió). Tope explícito: si alguna vez se alcanza, la
   *  pantalla lo dice en vez de recortar en silencio. */
  const cargarHistorial = async (signal) => {
    setHistorialError("");
    try {
      let q = supabase
        .from("herramientas_prestamo")
        .select(SELECT_COLS)
        .eq("estado_prestamo", "devuelto")
        .not("fecha_devolucion_real", "is", null)
        .order("fecha_devolucion_real", { ascending: false })
        .limit(1000);
      const t = sanitizeSearch(search.trim());
      if (t)
        q = q.or(
          `herramienta_nombre.ilike.%${t}%,herramienta_codigo.ilike.%${t}%`,
        );
      const { data, error } = await q;
      // `signal` además de mountedRef: al teclear en el buscador se lanzan
      // varias cargas y una respuesta vieja puede llegar después de la nueva.
      // mountedRef solo protege del desmontaje, no del desorden.
      if (signal?.aborted || !mountedRef.current) return;
      if (error) throw error;
      setDevueltas(data ?? []);
      setHistorialTruncado((data ?? []).length >= 1000);
    } catch (err) {
      if (signal?.aborted || !mountedRef.current) return;
      console.error("[Herramientas] historial:", err);
      // Antes se dejaba la lista vacía y la pantalla decía "Sin historial de
      // devoluciones": un fallo de red se leía como "no hay nada", que es una
      // mentira tranquilizadora. Ahora se dice que falló.
      setDevueltas([]);
      setHistorialError(safeError(err, "No se pudo cargar el historial"));
    }
  };

  const cargarUsuarios = async () => {
    try {
      let q = supabase
        .from("usuarios")
        .select("id, nombre, rol, sede_id")
        .eq("activo", true)
        .order("nombre");
      if (perfil?.rol !== "Admin" && perfil?.sede_id)
        q = q.eq("sede_id", perfil.sede_id);
      const { data, error } = await q;
      if (error) throw error;
      setUsuarios(data ?? []);
    } catch (err) {
      console.error("[Herramientas] usuarios:", err);
    }
  };

  useEffect(() => {
    cargarUsuarios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil?.sede_id, perfil?.rol]);

  useEffect(() => {
    if (tab !== "historial") return;
    const ac = new AbortController();
    const t = setTimeout(() => cargarHistorial(ac.signal), 300);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, search]);

  useEffect(() => {
    const ac = new AbortController();
    const t = setTimeout(() => cargarHerramientas(ac.signal), 300);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, perfil?.sede_id]);

  /* ── Acción: devolver (RPC server-authoritative) ─────────────────────────
     fn_devolver_herramienta resuelve atómicamente el caso según el tipo:
       · Manual (producto_id null): vuelve a 'disponible'.
       · Inventariable: regresa 1 al stock de insumo y retira la herramienta
         (activo=false), por lo que desaparece del catálogo tras recargar.
     La función valida permiso (Admin o misma sede) y estado con FOR UPDATE. */
  const devolver = async (h, cantidad = 1, yaConfirmado = false) => {
    if (accionandoRef.current) return;
    // Devolver una MANUAL es inocuo (vuelve a 'disponible' y se puede volver a
    // prestar). Devolver una INVENTARIABLE retira la herramienta del catálogo
    // para siempre: es tan irreversible como consumir, así que se pregunta igual
    // que allí. Sin esto, un tap de más borraba una herramienta del catálogo.
    // Si viene del modal de cantidad, ese modal ya explicó y confirmó.
    if (h.producto_id && !yaConfirmado) {
      const ok = window.confirm(
        `¿Regresar “${h.herramienta_nombre}” al stock de insumo de ${sedeLabel(h.sede_id)}?\n\n` +
          `Su unidad vuelve al inventario y la herramienta sale del catálogo. Esta acción no se puede deshacer.`,
      );
      if (!ok) return;
    }
    accionandoRef.current = true;
    setAccionando(h.id);
    try {
      // Lote server-authoritative: resuelve las N unidades del MISMO préstamo y
      // delega en la función de una unidad. Con cantidad=1 equivale a devolver
      // una sola, así que este es el único camino (sin lógica duplicada).
      const { data, error } = await supabase.rpc(
        "fn_devolver_herramientas_lote",
        { p_herramienta_id: h.id, p_cantidad: cantidad },
      );
      if (error) throw error;
      setDetalleId(null);
      // #H-1: antes no había ninguna confirmación; una herramienta inventariable
      // se devolvía al insumo y desaparecía de la lista (activo=false), y parecía
      // que "no la devolvía". Ahora salta un aviso que dice qué pasó.
      const n = Number(data?.devueltas ?? cantidad);
      const uds = `${n} unidad${n === 1 ? "" : "es"}`;
      if (data?.inventariable) {
        avisarOk(
          `${uds} de “${h.herramienta_nombre}” ${n === 1 ? "regresó" : "regresaron"} al stock de insumo` +
            (data.cantidad_insumo != null
              ? ` (ahora hay ${data.cantidad_insumo} en ${sedeLabel(h.sede_id)})`
              : "") +
            ".",
        );
      } else {
        avisarOk(
          `${uds} de “${h.herramienta_nombre}” ${n === 1 ? "quedó disponible" : "quedaron disponibles"} de nuevo.`,
        );
      }
      await cargarHerramientas();
    } catch (err) {
      avisarError(err, "Error al devolver herramienta");
    } finally {
      setAccionando(null);
      accionandoRef.current = false;
    }
  };

  /* ── B11 — Acción: consumir (NO regresa al inventario; desaparece) ──── */
  const consumir = async (h, cantidad = 1) => {
    if (accionandoRef.current) return;
    accionandoRef.current = true;
    setAccionando(h.id);
    try {
      const { data, error } = await supabase.rpc(
        "fn_consumir_herramientas_lote",
        { p_herramienta_id: h.id, p_cantidad: cantidad },
      );
      if (error) throw error;
      setDetalleId(null);
      const n = Number(data?.consumidas ?? cantidad);
      avisarOk(
        `${n} unidad${n === 1 ? "" : "es"} de “${h.herramienta_nombre}” se ${n === 1 ? "dio" : "dieron"} de baja (no ${n === 1 ? "regresa" : "regresan"} al insumo).`,
      );
      await cargarHerramientas();
    } catch (err) {
      avisarError(err, "Error al consumir herramienta");
    } finally {
      setAccionando(null);
      accionandoRef.current = false;
    }
  };

  /* ── Extravío y mantenimiento ─────────────────────────────────────────
     Estos dos estados existían en la app (filtros, badges, textos) pero
     NINGUNA función del backend los escribía: no había forma de marcar una
     herramienta como perdida. Las cuatro RPC son server-authoritative (validan
     rol, sede y estado de origen) y registran su evento en el historial.
     Ninguna toca inventario: la unidad ya salió del insumo al crearse la
     herramienta, así que descontar otra vez sería contarla dos veces. */
  const accionEstado = async (h, rpc, confirmar, exito) => {
    if (accionandoRef.current) return;
    if (confirmar && !window.confirm(confirmar)) return;
    accionandoRef.current = true;
    setAccionando(h.id);
    try {
      const { error } = await supabase.rpc(rpc, {
        p_herramienta_id: h.id,
        p_observaciones: null,
      });
      if (error) throw error;
      setDetalleId(null);
      avisarOk(exito);
      await cargarHerramientas();
    } catch (err) {
      avisarError(err, "No se pudo cambiar el estado");
    } finally {
      setAccionando(null);
      accionandoRef.current = false;
    }
  };

  const extraviar = (h) =>
    accionEstado(
      h,
      "fn_marcar_herramienta_extraviada",
      `¿Reportar “${h.herramienta_nombre}” como EXTRAVIADA?\n\n` +
        (h.estado === "prestada"
          ? `Queda registrado que se perdió en manos de ${h.usuario?.nombre ?? "quien la tenía"}. `
          : "") +
        `Si aparece después, se puede recuperar.`,
      `“${h.herramienta_nombre}” quedó reportada como extraviada.`,
    );

  const recuperar = (h) =>
    accionEstado(
      h,
      "fn_recuperar_herramienta",
      null,
      `“${h.herramienta_nombre}” volvió al catálogo como disponible.`,
    );

  const mandarAMantenimiento = (h) =>
    accionEstado(
      h,
      "fn_enviar_herramienta_mantenimiento",
      `¿Mandar “${h.herramienta_nombre}” a mantenimiento?\n\nSale del catálogo mientras se repara. No se puede prestar hasta que vuelva.`,
      `“${h.herramienta_nombre}” quedó en mantenimiento.`,
    );

  const finalizarMantenimiento = (h) =>
    accionEstado(
      h,
      "fn_finalizar_mantenimiento",
      null,
      `“${h.herramienta_nombre}” quedó disponible de nuevo.`,
    );

  /* ── Derivaciones de presentación (todas sobre datos reales) ─────────── */

  // Herramientas vigentes en el catálogo. Las regresadas a insumo (activo=false)
  // ya no son herramientas, así que no cuentan para el Catálogo ni para los
  // préstamos — pero SÍ para el Historial: la devolución ocurrió igual.
  const activas = useMemo(
    () => herramientas.filter((h) => h.activo !== false),
    [herramientas],
  );

  // Los atrasados van primero, y dentro de cada grupo el más viejo arriba.
  // Antes solo se distinguían por color: en una lista larga, un préstamo vencido
  // hace dos meses quedaba enterrado entre los que están al día.
  const prestadas = useMemo(
    () =>
      activas
        .filter((h) => h.estado === "prestada")
        .sort((a, b) => {
          const va = prestamoVencido(a) ? 0 : 1;
          const vb = prestamoVencido(b) ? 0 : 1;
          if (va !== vb) return va - vb;
          return (
            new Date(a.fecha_devolucion_esperada ?? 0) -
            new Date(b.fecha_devolucion_esperada ?? 0)
          );
        }),
    [activas],
  );
  // Un préstamo real puede abarcar varias unidades de la misma herramienta (una
  // fila por unidad física). Se agrupan para no pintar 6 tarjetas idénticas de
  // un solo préstamo, y para poder devolver/dar de baja por cantidades.
  const gruposPrestados = useMemo(
    () => agruparPrestamos(prestadas),
    [prestadas],
  );
  const atrasadas = useMemo(
    () => activas.filter((h) => prestamoVencido(h)),
    [activas],
  );
  const disponibles = useMemo(
    () => activas.filter((h) => h.estado === "disponible"),
    [activas],
  );
  const enMantenimiento = useMemo(
    () => activas.filter((h) => h.estado === "en_mantenimiento"),
    [activas],
  );
  // El historial ya no se deriva de `herramientas`: viene de su propia
  // consulta (cargarHistorial), que sí incluye las inactivas y ordena por
  // fecha de devolución en el servidor.

  const catalogoFiltrado = useMemo(() => {
    if (filtroEstado === "todas") return activas;
    return activas.filter((h) => h.estado === filtroEstado);
  }, [activas, filtroEstado]);

  const conteoEstado = useMemo(() => {
    const c = {
      todas: activas.length,
      disponible: disponibles.length,
      prestada: prestadas.length,
      en_mantenimiento: enMantenimiento.length,
      extraviada: activas.filter((h) => h.estado === "extraviada").length,
    };
    return c;
  }, [activas, disponibles, prestadas, enMantenimiento]);

  // Busca en las dos listas: el detalle de un ítem del Historial ya no está
  // en `herramientas`, que ahora solo trae las activas.
  const detalle = detalleId
    ? (herramientas.find((h) => h.id === detalleId) ??
      (devueltas ?? []).find((h) => h.id === detalleId) ??
      null)
    : null;

  return (
    <div className="flex h-full flex-col animate-fade-in">
      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-start gap-4 border-b px-4 pb-4 pt-5 sm:px-7 sm:pt-6"
        style={{ borderColor: "var(--n-100)", backgroundColor: "var(--n-0)" }}
      >
        <div className="min-w-0 flex-1">
          <p
            className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em]"
            style={{ color: "var(--n-500)" }}
          >
            Operaciones · Taller y soporte
          </p>
          <h1
            className="m-0 text-[22px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--n-950)" }}
          >
            Herramientas
          </h1>
          <p
            className="mt-1.5 text-[13px] leading-[1.5]"
            style={{ color: "var(--n-500)" }}
          >
            {loading && herramientas.length === 0 ? (
              "Cargando…"
            ) : (
              <>
                {/* `activas`, no `herramientas`: la consulta trae también las
                    retiradas (para el Historial), y contarlas aquí decía "181
                    herramientas" cuando en el catálogo solo hay 13. */}
                <Stat>{activas.length}</Stat> herramientas ·{" "}
                <Stat>{prestadas.length}</Stat> prestadas
                {atrasadas.length > 0 && (
                  <>
                    {" · "}
                    <Stat danger>{atrasadas.length}</Stat> atrasada
                    {atrasadas.length === 1 ? "" : "s"}
                  </>
                )}
                {enMantenimiento.length > 0 && (
                  <>
                    {" · "}
                    <Stat>{enMantenimiento.length}</Stat> en mantenimiento
                  </>
                )}
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {puedeCrear && (
            <button
              onClick={() => setModalNueva(true)}
              className="btn btn-pri inline-flex items-center gap-1.5"
              style={{ height: 48 }}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} /> Nueva herramienta
            </button>
          )}
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────── */}
      <div
        className="border-b px-4 sm:px-7"
        style={{ borderColor: "var(--n-100)", backgroundColor: "var(--n-0)" }}
      >
        <div className="flex items-end overflow-x-auto">
          {TABS.map((t) => {
            const active = tab === t.id;
            const Icon = t.Icon;
            const count =
              t.id === "activos"
                ? // Préstamos REALES, no unidades: prestar 6 rollos de teflón
                  // de una vez es UN préstamo, no seis.
                  gruposPrestados.length
                : t.id === "catalogo"
                  ? // `activas`, no `herramientas`: el catálogo son las vigentes
                    // (13), no las 181 que incluyen retiradas. Coincide con el
                    // encabezado y con el pill "Todas" de esta misma pestaña.
                    activas.length
                  : (devueltas?.length ?? 0);
            const danger = t.id === "activos" && atrasadas.length > 0;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="relative -mb-px flex h-12 items-center gap-2 whitespace-nowrap border-b-2 px-4 text-[13px] font-medium transition-colors"
                style={
                  active
                    ? {
                        borderColor: "var(--p-600)",
                        color: "var(--p-700)",
                        backgroundColor: "var(--p-50)",
                        fontWeight: 600,
                      }
                    : {
                        borderColor: "transparent",
                        color: "var(--n-500)",
                      }
                }
              >
                <Icon className="h-4 w-4" strokeWidth={1.8} />
                {t.label}
                <span
                  className="ml-1 inline-flex h-[18px] min-w-[22px] items-center justify-center rounded-full px-1.5 font-mono text-[11px] font-medium"
                  style={
                    danger
                      ? {
                          backgroundColor: "var(--dang-50)",
                          color: "var(--dang-700)",
                        }
                      : active
                        ? {
                            backgroundColor: "var(--p-100)",
                            color: "var(--p-700)",
                          }
                        : {
                            backgroundColor: "var(--n-100)",
                            color: "var(--n-500)",
                          }
                  }
                >
                  {count}
                </span>
                {danger && (
                  <span
                    className="ml-1 font-mono text-[11px] font-medium"
                    style={{ color: "var(--dang-700)" }}
                  >
                    · {atrasadas.length} atrasada
                    {atrasadas.length === 1 ? "" : "s"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Contenido ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-4 pb-14 pt-5 sm:px-7">
        {errorMsg && (
          <div
            role="alert"
            className="mb-4 rounded-[10px] border px-4 py-3 text-sm"
            style={{
              backgroundColor: "var(--dang-50)",
              borderColor: "var(--dang-border)",
              color: "var(--dang-700)",
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* El buscador vive FUERA de los tabs: antes estaba dentro del Catálogo
            y era invisible en Préstamos activos e Historial, justo donde el
            operario necesita encontrar una herramienta concreta. La consulta es
            server-side, así que busca sobre todo, no sobre lo que se ve. */}
        <BuscadorHerramientas search={search} setSearch={setSearch} />

        {loading && herramientas.length === 0 ? (
          <SkeletonGrid />
        ) : tab === "activos" ? (
          <TabActivos
            grupos={gruposPrestados}
            unidadesPrestadas={prestadas.length}
            atrasadas={atrasadas}
            disponiblesCount={disponibles.length}
            accionando={accionando}
            esAdmin={isAdmin}
            puedeOperarRol={puedeOperarRol}
            puedeOperarEn={puedeOperarEn}
            onOpen={setDetalleId}
            onAccion={(grupo, accion) => setModalCantidad({ grupo, accion })}
          />
        ) : tab === "catalogo" ? (
          <TabCatalogo
            tools={catalogoFiltrado}
            filtroEstado={filtroEstado}
            setFiltroEstado={setFiltroEstado}
            conteoEstado={conteoEstado}
            onOpen={setDetalleId}
          />
        ) : (
          <TabHistorial
            devueltas={devueltas}
            truncado={historialTruncado}
            error={historialError}
            onOpen={setDetalleId}
          />
        )}
      </div>

      {/* ── Detalle (overlay) ───────────────────────────────────────── */}
      {detalle && (
        <HerramientaDetalle
          herramienta={detalle}
          accionando={accionando === detalle.id}
          esAdmin={isAdmin}
          puedeOperarRol={puedeOperarRol}
          puedeOperar={puedeOperarEn(detalle.sede_id)}
          puedePrestar={puedePrestarRol && puedeOperarEn(detalle.sede_id)}
          onClose={() => setDetalleId(null)}
          onDevolver={() => devolver(detalle)}
          onConsumir={() => consumir(detalle)}
          onExtraviar={() => extraviar(detalle)}
          onRecuperar={() => recuperar(detalle)}
          onMantenimiento={() => mandarAMantenimiento(detalle)}
          onFinalizarMantenimiento={() => finalizarMantenimiento(detalle)}
          onPrestar={() => {
            setDetalleId(null);
            setModalPrestar(detalle);
          }}
          onAgregarUnidades={
            puedeCrear
              ? () => {
                  setDetalleId(null);
                  setModalAgregar(detalle);
                }
              : undefined
          }
        />
      )}

      {/* ── Modales ─────────────────────────────────────────────────── */}
      {modalPrestar && (
        <ModalPrestar
          herramienta={modalPrestar}
          usuarios={usuarios}
          onClose={() => setModalPrestar(null)}
          onRefrescar={cargarHerramientas}
          onSaved={async () => {
            const nombre = modalPrestar?.herramienta_nombre;
            setModalPrestar(null);
            avisarOk(`“${nombre}” quedó prestada.`);
            await cargarHerramientas();
          }}
        />
      )}
      {modalNueva && (
        <ModalNueva
          sedeDefault={perfil?.sede_id ?? "BODEGA"}
          onClose={() => setModalNueva(false)}
          onSaved={async () => {
            setModalNueva(false);
            avisarOk("Herramienta agregada al catálogo.");
            await cargarHerramientas();
          }}
        />
      )}
      {modalCantidad && (
        <ModalCantidadPrestamo
          grupo={modalCantidad.grupo}
          accion={modalCantidad.accion}
          onClose={() => setModalCantidad(null)}
          onConfirmar={async (n) => {
            const { grupo, accion } = modalCantidad;
            // El modal ya explicó y confirmó: no se vuelve a preguntar. Se cierra
            // DESPUÉS de terminar para que se vea el estado "Procesando…" y para
            // no dejar el modal desmontado a mitad de la acción.
            if (accion === "consumir") await consumir(grupo.anchor, n);
            else await devolver(grupo.anchor, n, true);
            setModalCantidad(null);
          }}
        />
      )}
      {modalAgregar && (
        <ModalAgregarUnidades
          herramienta={modalAgregar}
          onClose={() => setModalAgregar(null)}
          onSaved={async (n) => {
            const nombre = modalAgregar?.herramienta_nombre;
            setModalAgregar(null);
            avisarOk(
              `Se ${n === 1 ? "agregó 1 unidad" : `agregaron ${n} unidades`} de “${nombre}”.`,
            );
            await cargarHerramientas();
          }}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── TAB · Préstamos activos ───────────────────── */

function TabActivos({
  grupos,
  unidadesPrestadas,
  atrasadas,
  disponiblesCount,
  accionando,
  esAdmin,
  puedeOperarRol,
  puedeOperarEn,
  onOpen,
  onAccion,
}) {
  if (grupos.length === 0) {
    return (
      <EmptyState
        title="Sin préstamos activos"
        sub="Cuando prestes una herramienta del catálogo aparecerá aquí."
      />
    );
  }
  const atrasada = atrasadas[0];
  return (
    <>
      {/* Banner de atraso (solo si hay herramientas vencidas) */}
      {atrasadas.length > 0 && atrasada && (
        <div
          className="mb-4 flex items-start gap-3 rounded-xl border p-4"
          style={{
            borderColor: "var(--warn-border)",
            backgroundColor: "var(--warn-50)",
          }}
        >
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0"
            strokeWidth={1.8}
            style={{ color: "var(--warn-700)" }}
          />
          <div className="flex-1 text-[12.5px] leading-[1.5]">
            <div
              className="mb-0.5 text-[13px] font-semibold"
              style={{ color: "var(--warn-700)" }}
            >
              {atrasadas.length} herramienta
              {atrasadas.length === 1 ? "" : "s"} atrasada
              {atrasadas.length === 1 ? "" : "s"}
            </div>
            <div style={{ color: "var(--warn-700)" }}>
              <b className="font-medium">{atrasada.herramienta_nombre}</b>{" "}
              prestada a{" "}
              <b className="font-medium">{atrasada.usuario?.nombre ?? "—"}</b> ·{" "}
              <b className="font-medium">{sedeLabel(atrasada.sede_id)}</b> ·
              venció hace{" "}
              <span className="font-mono font-medium">
                {diasVencida(atrasada) ?? 0} día
                {diasVencida(atrasada) === 1 ? "" : "s"}
              </span>
              .
            </div>
            <div className="mt-2.5 flex gap-2">
              <button
                onClick={() => onOpen(atrasada.id)}
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium"
                style={{
                  color: "var(--warn-700)",
                  borderColor: "var(--warn-border)",
                  backgroundColor: "var(--n-0)",
                }}
              >
                <ChevronRight className="h-3 w-3" strokeWidth={2} /> Ver
                préstamo
              </button>
              {/* "Enviar recordatorio" de Lovable: sin backend de mensajería. */}
              <button
                disabled
                title="Disponible en una próxima fase"
                className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium"
                style={{ color: "var(--warn-700)", opacity: 0.55 }}
              >
                <MessageCircle className="h-3 w-3" strokeWidth={2} /> Enviar
                recordatorio
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Desktop: tabla rica */}
      <div
        className="hidden overflow-x-auto rounded-xl border md:block"
        style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
      >
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr style={{ backgroundColor: "var(--n-50)" }}>
              {[
                "Herramienta",
                "Código",
                "Prestada a",
                "Fecha préstamo",
                "Devolución esperada",
                "Días en uso",
                "Estado",
                "",
              ].map((th, i) => (
                <th
                  key={i}
                  className="border-b px-3.5 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] whitespace-nowrap"
                  style={{
                    borderColor: "var(--n-150)",
                    color: "var(--n-500)",
                    textAlign: i === 7 ? "right" : "left",
                  }}
                >
                  {th}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <LoanRow
                key={g.clave}
                g={g}
                accionando={g.unidades.some((u) => u.id === accionando)}
                esAdmin={esAdmin}
                puedeOperarRol={puedeOperarRol}
                puedeOperar={puedeOperarEn(g.anchor.sede_id)}
                onOpen={() => onOpen(g.anchor.id)}
                onAccion={(accion) => onAccion(g, accion)}
              />
            ))}
          </tbody>
        </table>
        <div
          className="flex flex-wrap justify-between gap-2 border-t px-4 py-2.5 font-mono text-[11.5px]"
          style={{
            borderColor: "var(--n-150)",
            backgroundColor: "var(--n-25)",
            color: "var(--n-500)",
          }}
        >
          <span>
            Mostrando <Stat>{grupos.length}</Stat> préstamo
            {grupos.length === 1 ? "" : "s"} activo
            {grupos.length === 1 ? "" : "s"}
            {unidadesPrestadas !== grupos.length && (
              <>
                {" ("}
                <Stat>{unidadesPrestadas}</Stat> unidades{")"}
              </>
            )}{" "}
            · <Stat>{atrasadas.length}</Stat> atrasada
            {atrasadas.length === 1 ? "" : "s"} ·{" "}
            <Stat>{disponiblesCount}</Stat> disponible
            {disponiblesCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {/* Mobile: cards */}
      <ul className="space-y-2.5 md:hidden" role="list">
        {grupos.map((g) => (
          <li key={g.clave}>
            <LoanCard
              g={g}
              accionando={g.unidades.some((u) => u.id === accionando)}
              esAdmin={esAdmin}
              puedeOperarRol={puedeOperarRol}
              puedeOperar={puedeOperarEn(g.anchor.sede_id)}
              onOpen={() => onOpen(g.anchor.id)}
              onAccion={(accion) => onAccion(g, accion)}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

function LoanRow({
  g,
  accionando,
  esAdmin,
  puedeOperarRol,
  puedeOperar,
  onOpen,
  onAccion,
}) {
  // Todas las unidades del grupo comparten herramienta, responsable y fechas:
  // el ancla las representa. Solo el código puede variar entre unidades.
  const h = g.anchor;
  const tono = prestamoTono(h);
  const dang = tono === "danger";
  // Solo Admin o Bodega pueden devolver. Una inventariable la regresa al insumo
  // (retiro) → solo Admin. Dar de baja (consumir) es solo Admin.
  // El rol dice QUÉ se puede hacer; la sede, DÓNDE. Las dos condiciones
  // tienen que cumplirse o el servidor rechaza la acción.
  const puedeDevolver = puedeDevolverHerramienta(h, {
    esAdmin,
    puedeOperarRol,
    puedeOperar,
  });
  const codigo = g.unidades.every(
    (u) => u.herramienta_codigo === h.herramienta_codigo,
  )
    ? h.herramienta_codigo
    : "varios";
  return (
    <tr
      className={dang ? "hrm-row-dang" : undefined}
      style={{ height: 64, borderBottom: "1px solid var(--n-100)" }}
      onMouseEnter={(e) => {
        if (!dang) e.currentTarget.style.backgroundColor = "var(--n-50)";
      }}
      onMouseLeave={(e) => {
        if (!dang) e.currentTarget.style.backgroundColor = "";
      }}
    >
      <td className="px-3.5">
        <div className="flex items-center gap-3">
          <ToolIcon />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <button
                onClick={onOpen}
                className="block text-left text-[13px] font-medium leading-tight hover:underline"
                style={{ color: "var(--n-950)" }}
              >
                {h.herramienta_nombre}
              </button>
              {g.cantidad > 1 && <UnidadesPill n={g.cantidad} />}
            </div>
            <div
              className="mt-0.5 text-[11px]"
              style={{ color: "var(--n-500)" }}
            >
              {sedeLabel(h.sede_id)}
            </div>
          </div>
        </div>
      </td>
      <td
        className="px-3.5 font-mono text-[12.5px] font-medium"
        style={{ color: "var(--n-900)" }}
      >
        {codigo || "—"}
      </td>
      <td className="px-3.5">
        <div className="flex items-center gap-2.5">
          <UserAvatar nombre={h.usuario?.nombre} />
          <div>
            <div
              className="text-[13px] font-medium leading-tight"
              style={{ color: "var(--n-950)" }}
            >
              {h.usuario?.nombre ?? "—"}
            </div>
            {h.usuario?.rol && (
              <div
                className="mt-0.5 text-[11px]"
                style={{ color: "var(--n-500)" }}
              >
                {h.usuario.rol}
              </div>
            )}
          </div>
        </div>
      </td>
      <td
        className="px-3.5 font-mono text-[11.5px]"
        style={{ color: "var(--n-500)" }}
      >
        {h.fecha_prestamo ? formatDate(h.fecha_prestamo) : "—"}
      </td>
      <td
        className="px-3.5 font-mono text-[11.5px] font-semibold"
        style={{ color: tonoTextVar(tono) }}
      >
        {h.fecha_devolucion_esperada
          ? formatDate(h.fecha_devolucion_esperada)
          : "—"}
      </td>
      <td
        className="px-3.5 font-mono text-[12.5px] font-semibold"
        style={{ color: tonoTextVar(tono) }}
      >
        {diasEnUsoTexto(h)}
      </td>
      <td className="px-3.5">
        <Pill cls={tonoPillCls(tono)} label={tonoLabel(tono)} pulse={dang} />
      </td>
      <td className="px-3.5">
        <div className="flex items-center justify-end gap-1.5">
          {puedeDevolver ? (
            <button
              onClick={() => onAccion("devolver")}
              disabled={accionando}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[12px] font-medium disabled:opacity-50"
              style={{
                borderColor: "var(--succ-border)",
                color: "var(--succ-700)",
                backgroundColor: "var(--n-0)",
              }}
            >
              <Check className="h-3 w-3" strokeWidth={2} />
              {accionando
                ? "…"
                : g.cantidad > 1
                  ? "Devolver…"
                  : "Marcar devuelta"}
            </button>
          ) : (
            <span
              className="text-[11px] italic"
              style={{ color: "var(--n-400)" }}
              title={
                !puedeOperar
                  ? `Esta herramienta es de ${sedeLabel(h.sede_id)}. Solo esa sede o el Admin puede devolverla.`
                  : h.producto_id
                    ? "Regresar una herramienta inventariable al insumo solo lo hace el Admin"
                    : "La devolución la registra el Admin"
              }
            >
              {/* Desde que se ven las cuatro sedes hay DOS motivos posibles de
                  bloqueo, y el texto solo contaba uno. Decir "Devuelve Admin"
                  cuando el problema es la sede manda a la persona a buscar al
                  Admin para nada. */}
              {!puedeOperar
                ? `Es de ${sedeLabel(h.sede_id)}`
                : "Devuelve Admin"}
            </span>
          )}
          {esAdmin && (
            <button
              onClick={() => onAccion("consumir")}
              disabled={accionando}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[12px] font-medium disabled:opacity-50"
              style={{
                borderColor: "var(--dang-border)",
                color: "var(--dang-700)",
                backgroundColor: "var(--n-0)",
              }}
              title="Dar de baja: no regresa al stock de insumo"
            >
              <Trash2 className="h-3 w-3" strokeWidth={2} />
              Baja
            </button>
          )}
          <button
            onClick={onOpen}
            className="flex h-7 w-7 items-center justify-center rounded-md"
            style={{ color: "var(--n-500)" }}
            aria-label="Ver detalle"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function LoanCard({
  g,
  accionando,
  esAdmin,
  puedeOperarRol,
  puedeOperar,
  onOpen,
  onAccion,
}) {
  // El ancla representa al grupo: comparten herramienta, responsable y fechas.
  const h = g.anchor;
  const tono = prestamoTono(h);
  const dang = tono === "danger";
  // El rol dice QUÉ se puede hacer; la sede, DÓNDE. Las dos condiciones
  // tienen que cumplirse o el servidor rechaza la acción.
  const puedeDevolver = puedeDevolverHerramienta(h, {
    esAdmin,
    puedeOperarRol,
    puedeOperar,
  });
  return (
    <div
      className="rounded-xl border px-4 py-4"
      style={{
        backgroundColor: "var(--n-0)",
        borderColor: dang ? "var(--dang-500)" : "var(--n-150)",
      }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <button
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <ToolIcon />
          <div className="min-w-0">
            <p
              className="truncate text-sm font-semibold"
              style={{ color: "var(--n-950)" }}
            >
              {h.herramienta_nombre}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {g.cantidad > 1 && <UnidadesPill n={g.cantidad} />}
              {h.herramienta_codigo && (
                <span
                  className="font-mono text-xs"
                  style={{ color: "var(--n-500)" }}
                >
                  {h.herramienta_codigo}
                </span>
              )}
              {/* La sede ya se veía en la tabla de escritorio y en el catálogo,
                  pero no aquí. Ahora que la lista trae las cuatro sedes, sin
                  esto el móvil mezcla herramientas sin decir de dónde son. */}
              <span
                className="font-mono text-xs"
                style={{ color: "var(--n-500)" }}
              >
                · {sedeLabel(h.sede_id)}
              </span>
            </div>
          </div>
        </button>
        <Pill cls={tonoPillCls(tono)} label={tonoLabel(tono)} pulse={dang} />
      </div>

      <div className="mb-3 flex items-center gap-2.5">
        <UserAvatar nombre={h.usuario?.nombre} size="sm" />
        <span className="text-xs" style={{ color: "var(--n-700)" }}>
          {h.usuario?.nombre ?? "—"}
          {h.usuario?.rol ? ` · ${h.usuario.rol}` : ""}
        </span>
      </div>

      <div
        className="mb-3 grid grid-cols-2 gap-2 text-[11.5px]"
        style={{ color: "var(--n-500)" }}
      >
        <span>
          Días en uso:{" "}
          <b className="font-mono" style={{ color: tonoTextVar(tono) }}>
            {diasEnUsoTexto(h)}
          </b>
        </span>
        {h.fecha_devolucion_esperada && (
          <span style={{ color: dang ? "var(--dang-700)" : undefined }}>
            {dang ? "Venció:" : "Devolver:"}{" "}
            <b className="font-mono">
              {formatDate(h.fecha_devolucion_esperada)}
            </b>
          </span>
        )}
      </div>

      <div className="flex gap-2">
        {puedeDevolver ? (
          <button
            onClick={() => onAccion("devolver")}
            disabled={accionando}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium disabled:opacity-50"
            style={{
              height: 48,
              borderColor: "var(--succ-border)",
              color: "var(--succ-700)",
              backgroundColor: "var(--succ-50)",
            }}
          >
            <Check className="h-4 w-4" strokeWidth={2} />
            {accionando
              ? "Procesando…"
              : g.cantidad > 1
                ? "Devolver…"
                : "Marcar devuelta"}
          </button>
        ) : (
          <p
            className="flex-1 text-center text-[11.5px] italic"
            style={{ color: "var(--n-400)" }}
          >
            {!puedeOperar
              ? `Es de ${sedeLabel(h.sede_id)}: solo esa sede o el Admin puede devolverla.`
              : h.producto_id
                ? "La devolución de esta herramienta (regresa al insumo) la registra el Admin."
                : "La devolución la registra el Admin."}
          </p>
        )}
        {esAdmin && (
          <button
            onClick={() => onAccion("consumir")}
            disabled={accionando}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium disabled:opacity-50"
            style={{
              height: 48,
              borderColor: "var(--dang-border)",
              color: "var(--dang-700)",
              backgroundColor: "var(--dang-50)",
            }}
            title="Dar de baja: no regresa al stock de insumo"
          >
            <Trash2 className="h-4 w-4" strokeWidth={2} />
            Baja
          </button>
        )}
      </div>
    </div>
  );
}

/** Cuántas unidades de la misma herramienta abarca un préstamo.
    Mismo lenguaje visual que el `×N` del catálogo (CatalogCard). */
function UnidadesPill({ n }) {
  return (
    <span
      className="shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[11px] font-semibold"
      style={{ backgroundColor: "var(--p-50)", color: "var(--p-700)" }}
      title={`${n} unidades en este préstamo`}
    >
      ×{n}
    </span>
  );
}

/* ────────────────────────────── TAB · Catálogo ─────────────────────────── */

/** Buscador compartido por los 3 tabs (ver comentario en el render). */
function BuscadorHerramientas({ search, setSearch }) {
  return (
    <div
      className="mb-4 flex h-12 max-w-[360px] items-center gap-2.5 rounded-lg border px-3.5"
      style={{ borderColor: "var(--n-200)", backgroundColor: "var(--n-0)" }}
    >
      <Search
        className="h-4 w-4 shrink-0"
        strokeWidth={1.5}
        style={{ color: "var(--n-500)" }}
      />
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por nombre o código…"
        className="flex-1 border-none bg-transparent text-[14px] outline-none"
        style={{ color: "var(--n-950)" }}
      />
    </div>
  );
}

function TabCatalogo({
  tools,
  filtroEstado,
  setFiltroEstado,
  conteoEstado,
  onOpen,
}) {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => {
            const active = filtroEstado === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFiltroEstado(f.id)}
                className={`pill ${f.cls}`}
                style={{
                  cursor: "pointer",
                  height: 28,
                  outline: active ? "2px solid var(--p-400)" : "none",
                  outlineOffset: 1,
                }}
              >
                {f.id !== "todas" && <span className="dot" />}
                {f.label}{" "}
                <span className="ml-1 font-mono">
                  {conteoEstado[f.estado ?? "todas"] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {tools.length === 0 ? (
        <EmptyState
          title="Sin herramientas"
          sub="No hay herramientas que coincidan con el filtro o la búsqueda."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {/* #H-2: las unidades idénticas se agrupan en una sola tarjeta. */}
          {agruparHerramientas(tools).map((g) => (
            <CatalogCard
              key={g.key}
              grupo={g}
              onOpen={() => onOpen(g.rep.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

/* #H-2: agrupa unidades idénticas (mismo producto, o mismo nombre+código en las
   manuales) dentro de una sede, para no llenar el catálogo de N tarjetas iguales.
   El préstamo por lote ya opera por grupo, así que esto es solo presentación.
   El representante se prefiere disponible (para poder prestar/agregar desde él). */
function agruparHerramientas(tools) {
  const map = new Map();
  for (const h of tools) {
    const key = h.producto_id
      ? `p:${h.producto_id}:${h.sede_id}`
      : `m:${(h.herramienta_nombre || "").trim().toLowerCase()}|${(
          h.herramienta_codigo || ""
        )
          .trim()
          .toLowerCase()}:${h.sede_id}`;
    let g = map.get(key);
    if (!g) {
      g = { key, rep: h, unidades: [], counts: {} };
      map.set(key, g);
    }
    g.unidades.push(h);
    g.counts[h.estado] = (g.counts[h.estado] || 0) + 1;
    if (h.estado === "disponible" && g.rep.estado !== "disponible") g.rep = h;
  }
  return [...map.values()];
}

function CatalogCard({ grupo, onOpen }) {
  const { rep, unidades, counts } = grupo;
  const total = unidades.length;
  const disp = counts.disponible || 0;
  const prest = counts.prestada || 0;
  // La píldora principal refleja "hay disponibles" si las hay; si no, el estado
  // del representante (p.ej. todas prestadas).
  const pill = estadoPill(disp > 0 ? "disponible" : rep.estado);
  return (
    <button onClick={onOpen} className="hrm-cat-card text-left">
      <ToolIcon size="lg" />
      <div>
        <div
          className="flex items-center gap-1.5 text-[14px] font-medium leading-tight"
          style={{ color: "var(--n-950)" }}
        >
          <span className="min-w-0 truncate">{rep.herramienta_nombre}</span>
          {total > 1 && (
            <span
              className="shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[11px] font-semibold"
              style={{
                backgroundColor: "var(--p-50)",
                color: "var(--p-700)",
              }}
            >
              ×{total}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11.5px]" style={{ color: "var(--n-500)" }}>
          {sedeLabel(rep.sede_id)}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span
          className="font-mono text-[11.5px] font-medium"
          style={{ color: "var(--n-700)" }}
        >
          {rep.herramienta_codigo || "Sin código"}
        </span>
        <Pill cls={pill.cls} label={pill.label} small />
      </div>
      <div
        className="mt-1.5 flex items-center justify-between border-t pt-2.5"
        style={{ borderColor: "var(--n-100)" }}
      >
        <span className="text-[11px]" style={{ color: "var(--n-500)" }}>
          {total > 1
            ? `${disp} disponible${disp === 1 ? "" : "s"}` +
              (prest > 0 ? ` · ${prest} prestada${prest === 1 ? "" : "s"}` : "")
            : rep.estado === "prestada" && rep.usuario?.nombre
              ? `Con ${rep.usuario.nombre}`
              : sedeLabel(rep.sede_id)}
        </span>
        <ChevronRight
          className="h-3.5 w-3.5"
          style={{ color: "var(--n-400)" }}
        />
      </div>
    </button>
  );
}

/* ────────────────────────────── TAB · Historial ────────────────────────── */

function TabHistorial({ devueltas, truncado, error, onOpen }) {
  // El error va ANTES del caso vacío: si la carga falló, la lista está en []
  // y sin esto se leería como "no hay devoluciones", que no es lo que pasó.
  if (error) {
    return (
      <EmptyState
        title="No se pudo cargar el historial"
        sub={`${error} · Revisa la conexión y vuelve a entrar a esta pestaña.`}
      />
    );
  }
  // `null` = todavía no se ha pedido: el historial se carga al abrir la
  // pestaña, no con el resto de la pantalla.
  if (devueltas === null) {
    return <SkeletonGrid />;
  }
  if (devueltas.length === 0) {
    return (
      <EmptyState
        title="Sin historial de devoluciones"
        sub="Las herramientas que se devuelvan aparecerán aquí con su fecha de devolución."
      />
    );
  }
  return (
    <>
      <p
        className="mb-3 font-mono text-[11.5px]"
        style={{ color: "var(--n-500)" }}
      >
        <Stat>{devueltas.length}</Stat> devolución
        {devueltas.length === 1 ? "" : "es"} registrada
        {devueltas.length === 1 ? "" : "s"} · derivado de los préstamos cerrados
        de todas las sedes
        {truncado && (
          // Nunca recortar en silencio: si se llegó al tope, se dice.
          <span style={{ color: "var(--warn-700)" }}>
            {" "}
            · mostrando las más recientes
          </span>
        )}
      </p>
      <div
        className="overflow-hidden rounded-xl border"
        style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
      >
        {devueltas.map((h, i) => (
          <button
            key={h.id}
            onClick={() => onOpen(h.id)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
            style={{
              borderBottom:
                i === devueltas.length - 1 ? "none" : "1px solid var(--n-100)",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = "var(--n-25)")
            }
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
          >
            <ToolIcon />
            <div className="min-w-0 flex-1">
              <div
                className="truncate text-[13px] font-medium"
                style={{ color: "var(--n-950)" }}
              >
                {h.herramienta_nombre}
              </div>
              <div
                className="mt-0.5 font-mono text-[11px]"
                style={{ color: "var(--n-500)" }}
              >
                {h.herramienta_codigo || "Sin código"} · {sedeLabel(h.sede_id)}
                {/* La herramienta ya no está en el catálogo. Se dice por qué: si
                    no, el operario la ve en el historial, la busca en el
                    catálogo y no la encuentra. `activo=false` NO alcanza para
                    saber a dónde fue: lo ponen tanto consumir (se dio de baja,
                    no regresa nada) como devolver a insumo. Distinguir por
                    `estado` es lo único honesto. */}
                {h.estado === "consumido"
                  ? " · Dada de baja"
                  : h.activo === false && " · Regresada a insumo"}
              </div>
            </div>
            <div className="text-right">
              <Pill
                cls={h.activo === false ? "pill-neutral" : "pill-success"}
                label={
                  h.estado === "consumido"
                    ? "De baja"
                    : h.activo === false
                      ? "A insumo"
                      : "Devuelta"
                }
                small
              />
              <div
                className="mt-1 font-mono text-[11px]"
                style={{ color: "var(--n-500)" }}
              >
                {formatDate(h.fecha_devolucion_real)}
              </div>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

/* ───────────────────────────── Helpers UI ─────────────────────────────── */

function Stat({ children, danger }) {
  return (
    <b
      className="font-mono font-medium"
      style={{ color: danger ? "var(--dang-700)" : "var(--n-900)" }}
    >
      {children}
    </b>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-3.5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
      {[...Array(8)].map((_, i) => (
        <div
          key={i}
          className="h-36 animate-pulse rounded-xl border p-4"
          style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
        >
          <div
            className="mb-3 h-10 w-10 rounded-lg"
            style={{ backgroundColor: "var(--n-100)" }}
          />
          <div
            className="mb-2 h-4 w-2/3 rounded"
            style={{ backgroundColor: "var(--n-100)" }}
          />
          <div
            className="h-3 w-1/2 rounded"
            style={{ backgroundColor: "var(--n-100)" }}
          />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, sub }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="hrm-tool-ico xl mb-4" aria-hidden>
        <Wrench className="h-8 w-8" strokeWidth={1.5} />
      </div>
      <p className="font-semibold" style={{ color: "var(--n-950)" }}>
        {title}
      </p>
      <p className="mt-1 max-w-sm text-sm" style={{ color: "var(--n-500)" }}>
        {sub}
      </p>
    </div>
  );
}
