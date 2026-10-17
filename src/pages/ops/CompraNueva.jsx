import { useState, useCallback, useRef, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeftCircle,
  ArrowRight,
  Check,
  Info,
  MapPin,
  Plus,
  Search,
  ScanLine,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, sanitizeSearch } from "../../lib/utils";
import { carritoDesdeReorden, sedesDeSugerencias } from "../../lib/compras-ui";
import { SEDES } from "../../lib/constants";
import { SEDE_LABELS, sedeLabel } from "../../lib/traspasos-ui";
import { avisarOk, avisarError } from "../../lib/notify";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import UbicacionChip from "../../components/ui/UbicacionChip";
import QRScanner from "../../components/forms/QRScanner";
import NumeroInput from "../../components/forms/NumeroInput";
import MonedaInput from "../../components/forms/MonedaInput";
import BloqueRetenciones from "../../components/ventas/BloqueRetenciones";
import {
  calcularRetenciones,
  CLAVES_TARIFA_RETENCION,
} from "../../lib/retenciones";
import {
  METODOS_PAGO_PARTE,
  fraseResultadoPagos,
  netoAPagarCompra,
  nuevoPagoParte,
  pagosParaRpc,
  resumenPagosCompra,
  validarPagosCompra,
} from "../../lib/pagos-compra";

const IVA_DEFAULT = 19;
const IVA_PRESETS = [0, 19];

export default function CompraNueva() {
  const navigate = useNavigate();
  const location = useLocation();
  const perfil = useAuthStore((s) => s.perfil);
  // Al Vendedor nunca se le muestra/precarga el costo histórico del producto:
  // lo digita manualmente (arranca en 0).
  const esVendedor = perfil?.rol === "Vendedor";
  // Solo el Admin compra para cualquier sede (el servidor lo permite: las RPC
  // rechazan otra sede a quien no es Admin). Mismo patrón que Nueva Venta.
  // `null` = todavía no ha elegido → la sede de su perfil (que puede llegar
  // tarde, por eso no se fija en el useState).
  const esAdmin = perfil?.rol === "Admin";
  const [sedeElegida, setSedeElegida] = useState(null);
  const sedeCompra = esAdmin
    ? (sedeElegida ?? perfil?.sede_id)
    : perfil?.sede_id;

  const [modo, setModo] = useState("normal"); // #31: 'normal' | 'caja_menor'
  const [proveedor, setProveedor] = useState("");
  const [facturaProveedor, setFacturaProveedor] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [recibirAhora, setRecibirAhora] = useState(false);
  const [ivaPct, setIvaPct] = useState(IVA_DEFAULT);
  // B9 — forma de pago (incl. CRÉDITO), cuenta destino real y descuento $.
  const [metodoPago, setMetodoPago] = useState("Efectivo");
  const [cuentaBancaria, setCuentaBancaria] = useState("");
  const [descuentoValor, setDescuentoValor] = useState(0);
  const [cuentasBanco, setCuentasBanco] = useState([]);
  // Pagos hechos hoy sobre una compra a Crédito (pago en dos formas o
  // anticipo). Solo se mandan si la forma de pago es Crédito.
  const [pagosHoy, setPagosHoy] = useState([]);
  const pagoKeyRef = useRef(0);
  useEffect(() => {
    supabase
      .from("cuentas_bancarias")
      .select("id, banco, tipo, numero, titular")
      .eq("activo", true)
      .order("banco")
      .then(({ data }) => setCuentasBanco(data ?? []));
  }, []);
  // Retenciones: la empresa como agente retenedor, o sea le pagamos menos al
  // proveedor y consignamos la diferencia a la DIAN. Arrancan en CERO, nunca en
  // las tarifas sugeridas: si se precargaran solas bastaría abrir el bloque por
  // curiosidad para que el sistema diera por salidos $950.000 mientras del
  // cajón salió un millón, y el descuadre aparece al cerrar, cuando ya nadie se
  // acuerda de por qué.
  const [retenciones, setRetenciones] = useState({
    retefuentePct: 0,
    reteicaPct: 0,
    reteivaPct: 0,
  });
  // Las mismas tres claves que usa Nueva Venta: son las tarifas de ley, y
  // duplicarlas solo crearía un segundo sitio donde quedarse desactualizado.
  const [tarifasSugeridas, setTarifasSugeridas] = useState(null);
  useEffect(() => {
    supabase
      .from("parametros_sistema")
      .select("key, value")
      .in("key", Object.values(CLAVES_TARIFA_RETENCION))
      .then(({ data }) => {
        if (!data) return;
        const porClave = Object.fromEntries(
          data.map((p) => [p.key, Number(p.value) || 0]),
        );
        setTarifasSugeridas({
          retefuentePct: porClave[CLAVES_TARIFA_RETENCION.retefuentePct] ?? 0,
          reteicaPct: porClave[CLAVES_TARIFA_RETENCION.reteicaPct] ?? 0,
          reteivaPct: porClave[CLAVES_TARIFA_RETENCION.reteivaPct] ?? 0,
        });
      });
  }, []);
  const [concepto, setConcepto] = useState(""); // #31 caja menor
  // Categoría del gasto. Es lo que decide si esta plata resta del Resultado
  // del panel: sin ella el egreso cae a la bandeja de clasificación.
  const [categoriaGasto, setCategoriaGasto] = useState("");
  const [catsGasto, setCatsGasto] = useState([]);
  const [monto, setMonto] = useState(""); // #31 caja menor (total manual)
  // estado_compra removido del form: se asigna 'completada' en BD por default.
  // Las garantías se gestionarán desde la compra ya recibida (Fase 13).

  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false); // C-05: escáner QR

  const [carrito, setCarrito] = useState([]);

  // Sedes de las que venían las sugerencias de Reorden, para el aviso de que
  // la compra se registra en la sede del usuario y no en la de la sugerencia.
  const [sedesOrigen, setSedesOrigen] = useState([]);

  // Precarga del carrito desde Reorden ("Generar orden de compra").
  //
  // Catálogo de categorías de gasto, para el modo caja menor.
  useEffect(() => {
    let vivo = true;
    supabase
      .from("categorias_gasto")
      .select("id, nombre, afecta_resultado")
      .eq("activa", true)
      .order("orden")
      .then(({ data }) => {
        if (vivo) setCatsGasto(data ?? []);
      });
    return () => {
      vivo = false;
    };
  }, []);

  // Se hace una sola vez. Si el usuario ya empezó a armar el carrito no se le
  // pisa, y se limpia el state del historial para que un F5 no vuelva a
  // precargar encima de lo que ya haya.
  const precargaHecha = useRef(false);
  useEffect(() => {
    if (precargaHecha.current) return;
    const sug = location.state?.sugerenciasReorden;
    if (!Array.isArray(sug) || sug.length === 0) return;
    precargaHecha.current = true;

    setCarrito(carritoDesdeReorden(sug, { esVendedor }));
    setSedesOrigen(sedesDeSugerencias(sug));
    // Limpia el state DENTRO del router. Un `window.history.replaceState({}, "")`
    // borra también el `idx` y el `key` internos de react-router, y a partir de
    // ahí el índice del historial queda en NaN y no se recupera ni con F5.
    navigate(".", { replace: true, state: null });
  }, [location.state, esVendedor, navigate]);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const guardandoRef = useRef(false);
  // COMP-06: token de secuencia — una respuesta lenta de una búsqueda vieja
  // no debe pisar los resultados de una más nueva (mismo patrón del Historial).
  const busquedaReqRef = useRef(0);

  const buscarProductos = useCallback(
    async (q) => {
      const myReq = ++busquedaReqRef.current;
      if (!q || q.trim().length < 2) {
        setResultados([]);
        return;
      }
      setBuscando(true);
      try {
        const safe = sanitizeSearch(q.trim());
        const { data, error: e } = await supabase
          .from("productos")
          .select(
            "id, nombre, referencia, unidad_medida, vendible" +
              // S4-01: el costo es informacion de costo. Al Vendedor no se le
              // pide siquiera, porque ocultarlo solo en pantalla lo dejaba
              // viajando en la respuesta y visible desde el navegador.
              (esVendedor ? "" : ", costo_promedio"),
          )
          .eq("activo", true)
          .or(`nombre.ilike.%${safe}%,referencia.ilike.%${safe}%`)
          .limit(1000);
        if (e) throw e;
        // Ubicación física en la sede que recibe la compra (solo referencia
        // visual; no afecta la lógica de recepción).
        let ubicMap = {};
        if (data?.length && sedeCompra) {
          const { data: inv } = await supabase
            .from("inventario")
            .select("producto_id, ubicacion_id")
            .eq("sede_id", sedeCompra)
            .in(
              "producto_id",
              data.map((p) => p.id),
            );
          ubicMap = Object.fromEntries(
            (inv ?? []).map((i) => [i.producto_id, i.ubicacion_id]),
          );
        }
        if (myReq !== busquedaReqRef.current) return; // respuesta obsoleta
        setResultados(
          (data ?? []).map((p) => ({
            ...p,
            ubicacion_id: ubicMap[p.id] ?? null,
          })),
        );
      } catch {
        if (myReq === busquedaReqRef.current) setResultados([]);
      } finally {
        if (myReq === busquedaReqRef.current) setBuscando(false);
      }
    },
    [sedeCompra, esVendedor],
  );

  const buscarDebounced = useDebouncedCallback(buscarProductos, 400);

  const handleBusquedaChange = (e) => {
    const val = e.target.value;
    setBusqueda(val);
    buscarDebounced(val);
  };

  // C-05: escaneo QR para agregar un producto al pedido (como en Ventas).
  // #C2-1: antes un inactivo/inexistente o un error de red terminaban en el
  // mismo `return` mudo — el operario veía "Código encontrado" y no pasaba
  // nada. Ahora se distingue cada caso y se avisa (mismo criterio que
  // VentaNueva #S1-19). No se cierra el escáner aquí: en modo continuo lo
  // mantiene abierto el propio QRScanner para encadenar la siguiente lectura.
  const handleQRFound = useCallback(
    async (productoId) => {
      try {
        const { data, error: e } = await supabase
          .from("productos")
          .select(
            "id, nombre, referencia, unidad_medida, vendible" +
              (esVendedor ? "" : ", costo_promedio"),
          )
          .eq("id", productoId)
          .eq("activo", true)
          .maybeSingle();
        if (e) throw e;
        if (!data) {
          // Toast además del texto fijo: en modo continuo el escáner tapa toda
          // la pantalla, así que el `setError` de abajo no se ve hasta cerrarlo.
          const msg =
            "Ese código no corresponde a un producto activo (no existe o está inactivo).";
          setError(msg);
          avisarError(msg);
          return;
        }
        setError(null);
        agregarAlCarrito(data);
      } catch (err) {
        avisarError(
          err,
          "No se pudo leer el producto escaneado. Revisa la conexión e intenta de nuevo.",
        );
      }
      // `agregarAlCarrito` no está memoizado, de ahí la excepción; `esVendedor` sí
      // se declara porque decide si se pide la columna de costo al servidor.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [esVendedor],
  );

  const agregarAlCarrito = (prod) => {
    setBusqueda("");
    setResultados([]);
    setCarrito((prev) => {
      const idx = prev.findIndex((i) => i.producto_id === prod.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], cantidad: updated[idx].cantidad + 1 };
        return updated;
      }
      return [
        ...prev,
        {
          producto_id: prod.id,
          nombre: prod.nombre,
          referencia: prod.referencia,
          unidad: prod.unidad_medida,
          cantidad: 1,
          // Vendedor: nunca el costo histórico → arranca en 0 (manual).
          costo_unitario: esVendedor ? 0 : (prod.costo_promedio ?? 0),
          // Default inteligente: un producto no-vendible (insumo de catálogo)
          // entra como insumo; el resto, como stock de venta. Editable.
          destino: prod.vendible === false ? "insumo" : "venta",
        },
      ];
    });
  };

  const actualizarCantidad = (productoId, delta) => {
    setCarrito((prev) =>
      prev
        .map((i) => {
          if (i.producto_id !== productoId) return i;
          return { ...i, cantidad: Math.max(0, i.cantidad + delta) };
        })
        .filter((i) => i.cantidad > 0),
    );
  };

  const setCantidadDirecta = (productoId, valor) => {
    const n = parseInt(valor, 10);
    if (isNaN(n)) return;
    // Se clampa a [1, 100000]; teclear 0 NO elimina la fila (eso es la X).
    const clamped = Math.min(100000, Math.max(1, n));
    setCarrito((prev) =>
      prev.map((i) =>
        i.producto_id !== productoId ? i : { ...i, cantidad: clamped },
      ),
    );
  };

  const setCostoDirecto = (productoId, valor) => {
    const n = parseFloat(valor);
    if (isNaN(n) || n < 0 || n > 99999999) return;
    setCarrito((prev) =>
      prev.map((i) =>
        i.producto_id !== productoId ? i : { ...i, costo_unitario: n },
      ),
    );
  };

  const setDestino = (productoId, destino) => {
    setCarrito((prev) =>
      prev.map((i) => (i.producto_id !== productoId ? i : { ...i, destino })),
    );
  };

  const eliminarItem = (productoId) => {
    setCarrito((prev) => prev.filter((i) => i.producto_id !== productoId));
  };

  // Admin: cambiar la sede de la compra. Igual que en Nueva Venta, si ya hay
  // productos se confirma antes de vaciarlos (la compra es de una sola sede).
  const onChangeSede = (nuevaSede) => {
    if (carrito.length > 0) {
      const ok = window.confirm(
        `Cambiar de sede vaciará los ${carrito.length} producto(s) que ya agregaste a esta compra. ¿Continuar?`,
      );
      if (!ok) return; // el <select> vuelve solo a la sede anterior (controlado)
    }
    setSedeElegida(nuevaSede);
    setBusqueda("");
    setResultados([]);
    setCarrito([]);
  };

  const subtotal = carrito.reduce(
    (s, i) => s + i.cantidad * i.costo_unitario,
    0,
  );
  // B9: descuento en $ (clamp a [0, subtotal]); reduce la base gravable.
  const descuento = Math.min(Math.max(0, descuentoValor), subtotal);
  const iva = (subtotal - descuento) * (ivaPct / 100);
  const total = subtotal - descuento + iva;
  // Espejo exacto de las columnas generadas de `compras`: la base es el
  // subtotal menos el descuento y el reteIVA va sobre el IVA. Si esta fórmula y
  // la del servidor divergen, la pantalla promete un neto distinto del que va a
  // salir del cajón.
  const retencionesCalculadas = calcularRetenciones({
    base: subtotal - descuento,
    iva,
    total,
    retefuentePct: retenciones.retefuentePct,
    reteicaPct: retenciones.reteicaPct,
    reteivaPct: retenciones.reteivaPct,
  });
  const totalItems = carrito.reduce((s, i) => s + i.cantidad, 0);

  // Lo que se le debe al proveedor con el redondeo EXACTO del servidor: la
  // suma de los pagos de hoy se compara contra este número allá.
  const netoServidor = netoAPagarCompra({
    subtotal,
    descuento,
    ivaPct,
    retefuentePct: retenciones.retefuentePct,
    reteicaPct: retenciones.reteicaPct,
    reteivaPct: retenciones.reteivaPct,
  }).neto;
  const esCredito = metodoPago === "Crédito";
  const resumenPagos = resumenPagosCompra({
    neto: netoServidor,
    pagos: esCredito ? pagosHoy : [],
  });

  const agregarPagoHoy = () => {
    pagoKeyRef.current += 1;
    // El primer renglón se precarga con lo que se debe: el caso más común es
    // "pagué todo, pero en dos formas", y así solo hay que bajar el monto.
    const restante = Math.max(0, Math.round(resumenPagos.saldo));
    setPagosHoy((prev) => [
      ...prev,
      {
        ...nuevoPagoParte(pagoKeyRef.current),
        monto: restante > 0 ? String(restante) : "",
      },
    ]);
  };
  const cambiarPagoHoy = (key, cambios) =>
    setPagosHoy((prev) =>
      prev.map((p) => (p.key === key ? { ...p, ...cambios } : p)),
    );
  const quitarPagoHoy = (key) =>
    setPagosHoy((prev) => prev.filter((p) => p.key !== key));

  // Quién puede contar la recepción: los mismos dos roles que acepta
  // fn_procesar_picking_compra. La vendedora sigue registrando y recibiendo
  // como siempre — sus compras son casi todas caja menor sin productos, y
  // meterle fricción por algo que no le toca sería castigarla.
  const puedeContar = ["Admin", "Bodeguero"].includes(perfil?.rol);
  const ofreceConteo = puedeContar && carrito.length > 0;

  // Pasos del wizard: el paso "Proveedor" se considera completo cuando hay
  // nombre; "Productos" activo cuando hay al menos un item; el envío final
  // (registrar) hace las veces del paso "Confirmación".
  const pasoProveedor = proveedor.trim().length > 0;
  const pasoProductos = carrito.length > 0;

  const guardarCompra = async () => {
    if (!proveedor.trim()) {
      setError("El proveedor es obligatorio.");
      return;
    }
    if (carrito.length === 0) {
      setError("Agrega al menos un producto.");
      return;
    }
    // B9: en pagos electrónicos la cuenta destino es obligatoria.
    if (
      (metodoPago === "Transferencia" || metodoPago === "Tarjeta") &&
      !cuentaBancaria
    ) {
      setError("Selecciona la cuenta bancaria desde donde se pagó.");
      return;
    }
    // Espeja el bloqueo del servidor, para no mandar al operador contra un
    // error del backend cuando la pantalla ya sabe que no va a pasar.
    if (retencionesCalculadas.total > total) {
      setError(
        `Las retenciones (${formatCOP(retencionesCalculadas.total)}) se pasan del total (${formatCOP(total)}). Revisa los porcentajes: si querías 2,5% escribe 2,5, no 25.`,
      );
      return;
    }
    // Pagos de hoy sobre la compra a crédito: mismas reglas que el servidor.
    if (esCredito) {
      const errPagos = validarPagosCompra({
        neto: netoServidor,
        pagos: pagosHoy,
      });
      if (errPagos) {
        setError(errPagos);
        return;
      }
    }
    // Guard síncrono: el `disabled` de React no evita el doble-clic veloz.
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setError(null);
    setGuardando(true);
    try {
      // RPC server-authoritative: registra compra + detalle en una sola
      // transacción, fija `registrado_por` y recalcula los totales.
      const { data: creada, error: rpcErr } = await supabase.rpc(
        "fn_registrar_compra",
        {
          p_sede_id: sedeCompra,
          p_proveedor: proveedor.trim(),
          p_factura_proveedor: facturaProveedor.trim() || null,
          p_observaciones: observaciones.trim() || null,
          p_recibir: recibirAhora,
          p_items: carrito.map((i) => ({
            producto_id: i.producto_id,
            cantidad: i.cantidad,
            costo_unitario: i.costo_unitario,
            destino: i.destino ?? "venta",
          })),
          p_iva_pct: ivaPct,
          p_metodo_pago: metodoPago,
          p_cuenta_bancaria: cuentaBancaria || null,
          p_descuento_valor: descuento,
          p_retefuente_pct: retenciones.retefuentePct,
          p_reteica_pct: retenciones.reteicaPct,
          p_reteiva_pct: retenciones.reteivaPct,
          p_pagos: esCredito ? pagosParaRpc(pagosHoy) : null,
        },
      );
      if (rpcErr) throw new Error(rpcErr.message);

      // Lo que dice el servidor, no lo que calculó la pantalla.
      const huboPagos = esCredito && Number(creada?.pagado ?? 0) > 0;
      const sufijoPagos = huboPagos
        ? Number(creada?.saldo ?? 0) <= 0.01
          ? " Quedó pagada completa."
          : ` Pagado hoy ${formatCOP(Number(creada.pagado))}, queda debiendo ${formatCOP(Number(creada.saldo))}.`
        : "";

      // La mercancía ya está en el mostrador cuando digitan la factura: de 737
      // compras no hay ninguna pendiente, y 713 de 729 se registran y reciben
      // en el mismo segundo. Por eso el conteo se ofrece AQUÍ y no esperando a
      // que alguien entre al detalle de una compra pendiente, por donde no
      // llegaría nadie.
      //
      // Solo si hay productos que contar y si quien registra puede contarlos.
      // Una compra de caja menor (un recibo de transporte) no se cuenta, y a la
      // vendedora no se le mete fricción por algo que no le toca.
      if (!recibirAhora && puedeContar && carrito.length > 0) {
        avisarOk(
          `Compra #${creada?.numero} registrada.${sufijoPagos} Ahora cuenta lo que llegó.`,
        );
        navigate(`/ops/compras/${creada?.compra_id}/picking`);
        return;
      }

      avisarOk(
        (recibirAhora
          ? "Compra registrada y recibida."
          : "Compra registrada.") + sufijoPagos,
      );
      navigate("/ops/compras");
    } catch (e) {
      avisarError(e, "Error al guardar la compra");
    } finally {
      setGuardando(false);
      guardandoRef.current = false;
    }
  };

  // #31 — registrar una compra de CAJA MENOR (concepto + monto, no inventariable).
  const guardarCajaMenor = async () => {
    const m = Number(monto);
    if (!concepto.trim()) {
      setError("El concepto es obligatorio.");
      return;
    }
    if (!categoriaGasto) {
      setError(
        "Elige la categoría del egreso: es lo que decide si esta plata resta del resultado del mes.",
      );
      return;
    }
    if (!m || m <= 0) {
      setError("Ingresa un monto mayor a 0.");
      return;
    }
    // S6-E: caja menor con método real (antes siempre quedaba 'Efectivo').
    const esElectronico = ["Transferencia", "Tarjeta"].includes(metodoPago);
    if (esElectronico && !cuentaBancaria) {
      setError("Selecciona la cuenta bancaria para pagos electrónicos.");
      return;
    }
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setError(null);
    setGuardando(true);
    try {
      const { error: rpcErr } = await supabase.rpc("fn_registrar_caja_menor", {
        p_sede_id: sedeCompra,
        p_concepto: concepto.trim(),
        p_monto: m,
        p_proveedor: proveedor.trim() || null,
        p_observaciones: observaciones.trim() || null,
        p_metodo_pago: metodoPago,
        p_cuenta_bancaria: esElectronico ? cuentaBancaria : null,
        p_categoria_gasto_id: Number(categoriaGasto),
      });
      if (rpcErr) throw new Error(rpcErr.message);
      avisarOk(
        metodoPago === "Crédito"
          ? "Gasto registrado a crédito: queda en Cuentas por pagar."
          : "Gasto de caja menor registrado.",
      );
      navigate("/ops/compras");
    } catch (e) {
      avisarError(e, "Error al registrar la caja menor");
    } finally {
      setGuardando(false);
      guardandoRef.current = false;
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 px-4 pb-14 pt-5 sm:px-7 animate-fade-in">
      <button
        onClick={() => navigate("/ops/compras")}
        className="back-btn inline-flex w-fit items-center gap-1.5"
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver a Compras
      </button>

      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-end justify-between gap-4 border-b pb-3.5"
        style={{ borderColor: "var(--n-100)" }}
      >
        <div>
          <h1
            className="m-0 text-[22px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--n-950)" }}
          >
            Nueva compra
          </h1>
          <div className="mt-1 text-[13px]" style={{ color: "var(--n-500)" }}>
            Sede destino{" "}
            <b className="font-medium" style={{ color: "var(--n-700)" }}>
              {sedeCompra ?? "—"}
            </b>{" "}
            · IVA {ivaPct}%{ivaPct === 0 ? " (exento)" : ""}
          </div>
        </div>
        <button
          onClick={() => navigate("/ops/compras")}
          className="btn btn-out"
          style={{ height: 48 }}
        >
          Cancelar
        </button>
      </div>

      {/* ── Sede de la compra (solo Admin) ──────────────────────────────
          Vendedor y Bodeguero compran siempre para su sede: no ven esto. */}
      {esAdmin && (
        <div className="flex flex-wrap items-center gap-2.5">
          <div
            className="inline-flex h-12 items-center gap-2 rounded-[10px] border px-3"
            style={{
              borderColor: "var(--n-200)",
              backgroundColor: "var(--n-0)",
            }}
          >
            <MapPin
              className="h-4 w-4 shrink-0"
              strokeWidth={1.6}
              style={{ color: "var(--n-500)" }}
            />
            <label
              htmlFor="sede-compra"
              className="text-[12px]"
              style={{ color: "var(--n-500)" }}
            >
              Sede
            </label>
            <select
              id="sede-compra"
              value={sedeCompra ?? ""}
              onChange={(e) => onChangeSede(e.target.value)}
              className="h-full cursor-pointer border-none bg-transparent text-[13px] font-medium outline-none"
              style={{ color: "var(--n-950)" }}
            >
              {Object.values(SEDES).map((sd) => (
                <option key={sd} value={sd}>
                  {SEDE_LABELS[sd] ?? sd}
                </option>
              ))}
            </select>
          </div>
          <span className="text-[11.5px]" style={{ color: "var(--n-500)" }}>
            {modo === "caja_menor"
              ? `El gasto se registrará en ${sedeLabel(sedeCompra)}`
              : `La compra se registrará en ${sedeLabel(sedeCompra)}`}
          </span>
        </div>
      )}

      {/* ── Aviso de sede al venir desde Reorden ─────────────────────────
          La compra se registra SIEMPRE en la sede del usuario (fn_registrar_compra
          recibe una sola sede). Si las sugerencias venían de otras sedes, la
          mercancía va a quedar aquí y hay que traspasarla: mejor decirlo ahora
          que dejar que la busquen donde no está. */}
      {sedesOrigen.some((s) => s !== sedeCompra) && (
        <div
          className="flex items-start gap-2.5 rounded-[10px] border px-4 py-3"
          style={{
            backgroundColor: "var(--info-50)",
            borderColor: "var(--info-border)",
          }}
        >
          <Info
            className="mt-0.5 h-4 w-4 shrink-0"
            strokeWidth={1.75}
            style={{ color: "var(--info-600)" }}
            aria-hidden="true"
          />
          <p className="m-0 text-sm" style={{ color: "var(--info-700)" }}>
            Esta compra se registrará en{" "}
            <b className="font-semibold">{sedeCompra ?? "—"}</b>. Las
            sugerencias venían de{" "}
            <b className="font-semibold">{sedesOrigen.join(", ")}</b>: cuando
            llegue la mercancía habrá que traspasarla.
            {esAdmin &&
              " Si debe quedar allá, cambia la sede arriba (cambiarla vacía la lista de productos)."}
          </p>
        </div>
      )}

      {/* ── Selector de tipo de compra (#31) ─────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {[
          { v: "normal", t: "Compra normal" },
          { v: "caja_menor", t: "Caja menor" },
        ].map((m) => {
          const on = modo === m.v;
          return (
            <button
              key={m.v}
              type="button"
              // Las dos formas aceptan Crédito (la caja menor desde el Bloque
              // 3.2: gasto que se debe), así que la forma de pago se conserva.
              // Los pagos de hoy solo viajan con la compra normal.
              onClick={() => setModo(m.v)}
              className="rounded-lg border px-3.5 text-[13px] font-medium transition-colors"
              style={{
                minHeight: 48,
                borderColor: on ? "var(--p-500)" : "var(--n-200)",
                backgroundColor: on ? "var(--p-600)" : "var(--n-0)",
                color: on ? "#fff" : "var(--n-700)",
              }}
            >
              {m.t}
            </button>
          );
        })}
      </div>

      {/* ── Stepper (solo compra normal) ─────────────────────────────── */}
      {modo === "normal" && (
        <div className="stepper">
          <Step
            n={1}
            label="Proveedor"
            state={pasoProveedor ? "done" : "active"}
          />
          <Line done={pasoProveedor} />
          <Step
            n={2}
            label="Productos"
            state={pasoProductos ? "done" : pasoProveedor ? "active" : "todo"}
          />
          <Line done={pasoProductos} />
          <Step
            n={3}
            label="Confirmación"
            state={pasoProveedor && pasoProductos ? "active" : "todo"}
          />
        </div>
      )}

      {/* ── Wizard grid ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_340px]">
        {/* ── Columna principal ─────────────────────────────────────── */}
        <div className="flex flex-col gap-3.5">
          {/* Proveedor */}
          <div className="iblock flex flex-col gap-3.5">
            <div className="ib-head">
              <div className="ib-ico">
                <Truck className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Datos del proveedor</div>
            </div>
            <div className="grid grid-cols-1 gap-3 gap-x-3.5 sm:grid-cols-2">
              <Field label="Proveedor" req={modo === "normal"}>
                <input
                  type="text"
                  value={proveedor}
                  onChange={(e) => setProveedor(e.target.value)}
                  placeholder={
                    modo === "normal"
                      ? "Nombre del proveedor"
                      : "Opcional (caja menor)"
                  }
                  className="finput sans"
                  style={{ height: 48 }}
                />
              </Field>
              <Field label="N° factura del proveedor">
                <input
                  type="text"
                  value={facturaProveedor}
                  onChange={(e) => setFacturaProveedor(e.target.value)}
                  placeholder="Opcional"
                  className="finput sans"
                  style={{ height: 48 }}
                />
              </Field>
            </div>
          </div>

          {/* Productos (solo compra normal) */}
          {modo === "normal" && (
            <div className="iblock flex flex-col gap-3.5">
              <div className="ib-head">
                <div className="ib-ico">
                  <Search className="h-3.5 w-3.5" strokeWidth={2} />
                </div>
                <div className="ib-title">Productos a ordenar</div>
                <div className="ib-aux">{carrito.length} en la orden</div>
              </div>

              {/* Búsqueda. C2-3: el botón de escanear era de 32x32 (h-8 w-8);
                  CLAUDE.md exige mínimo 48px por uso con guantes. Se saca del
                  buscador a un botón hermano de 48x48, igual que en
                  TraspasoNuevo/EnsambleNuevo, para no apretarlo dentro de una
                  fila de 44px. */}
              <div className="flex items-center gap-2">
                <div
                  className="flex h-12 flex-1 items-center gap-2.5 rounded-[10px] border px-3.5"
                  style={{
                    borderColor: "var(--n-150)",
                    backgroundColor: "var(--n-0)",
                  }}
                >
                  <Search
                    className="h-4 w-4 shrink-0"
                    strokeWidth={1.5}
                    style={{ color: "var(--n-300)" }}
                  />
                  <input
                    type="text"
                    value={busqueda}
                    onChange={handleBusquedaChange}
                    placeholder="Buscar por nombre o referencia del catálogo…"
                    className="flex-1 border-none bg-transparent text-[14px] outline-none"
                    style={{ color: "var(--n-700)" }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setScannerOpen(true)}
                  aria-label="Escanear código QR"
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border transition-colors"
                  style={{
                    borderColor: "var(--n-150)",
                    backgroundColor: "var(--n-0)",
                    color: "var(--p-700)",
                  }}
                >
                  <ScanLine className="h-5 w-5" strokeWidth={1.8} />
                </button>
              </div>

              {buscando && (
                <p className="text-xs" style={{ color: "var(--n-500)" }}>
                  Buscando…
                </p>
              )}

              {resultados.length > 0 && (
                <div
                  className="max-h-80 overflow-y-auto rounded-lg border"
                  style={{ borderColor: "var(--n-150)" }}
                >
                  {resultados.map((r, idx) => (
                    <button
                      key={r.id}
                      onClick={() => agregarAlCarrito(r)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors"
                      style={{
                        borderTop:
                          idx === 0 ? "none" : "1px solid var(--n-100)",
                        backgroundColor: "var(--n-0)",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor = "var(--n-50)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = "var(--n-0)")
                      }
                    >
                      <div>
                        <p
                          className="flex items-center gap-1.5 text-sm font-medium"
                          style={{ color: "var(--n-950)" }}
                        >
                          {r.nombre}
                          <UbicacionChip codigo={r.ubicacion_id} />
                        </p>
                        <p
                          className="font-mono text-[11px]"
                          style={{ color: "var(--n-500)" }}
                        >
                          {r.referencia} · {r.unidad_medida}
                        </p>
                      </div>
                      <span
                        className="text-xs"
                        style={{ color: "var(--p-600)" }}
                      >
                        + Agregar
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Carrito */}
              {carrito.length === 0 ? (
                <p
                  className="rounded-[10px] border border-dashed py-10 text-center text-sm"
                  style={{
                    borderColor: "var(--n-200)",
                    backgroundColor: "var(--n-25)",
                    color: "var(--n-500)",
                  }}
                >
                  Busca y agrega productos a la orden de compra
                </p>
              ) : (
                <>
                  {/* Desktop: tabla */}
                  <div
                    className="hidden overflow-hidden rounded-[10px] border md:block"
                    style={{ borderColor: "var(--n-150)" }}
                  >
                    <table className="prod-tbl w-full">
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th style={{ width: 168 }}>Destino</th>
                          <th className="r" style={{ width: 130 }}>
                            Cantidad
                          </th>
                          <th className="r" style={{ width: 140 }}>
                            Costo unit
                          </th>
                          <th className="r" style={{ width: 120 }}>
                            Subtotal
                          </th>
                          <th style={{ width: 42 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {carrito.map((item) => (
                          <tr key={item.producto_id}>
                            <td>
                              <p
                                className="text-[12.5px] font-medium leading-tight"
                                style={{ color: "var(--n-950)" }}
                              >
                                {item.nombre}
                              </p>
                              <p
                                className="font-mono text-[11px]"
                                style={{ color: "var(--n-500)" }}
                              >
                                {item.referencia}
                              </p>
                              {item.desglose?.length > 1 && (
                                <p
                                  className="m-0 text-[10.5px]"
                                  style={{ color: "var(--info-700)" }}
                                  title="Esta cantidad es la suma de lo que Reorden sugiere para cada sede."
                                >
                                  Suma de{" "}
                                  {item.desglose
                                    .map((d) => `${d.sede_id} ${d.cantidad}`)
                                    .join(" + ")}
                                </p>
                              )}
                            </td>
                            <td>
                              <DestinoToggle
                                value={item.destino}
                                onChange={(d) =>
                                  setDestino(item.producto_id, d)
                                }
                              />
                            </td>
                            <td className="text-right">
                              <div className="inline-flex items-center gap-1">
                                <QtyBtn
                                  onClick={() =>
                                    actualizarCantidad(item.producto_id, -1)
                                  }
                                >
                                  −
                                </QtyBtn>
                                <NumeroInput
                                  min={1}
                                  max={100000}
                                  value={item.cantidad}
                                  onChange={(n) =>
                                    setCantidadDirecta(item.producto_id, n)
                                  }
                                  className="w-12 rounded-lg border py-1 text-center font-mono text-sm font-semibold outline-none"
                                  style={{
                                    borderColor: "var(--n-150)",
                                    color: "var(--n-950)",
                                    backgroundColor: "var(--n-0)",
                                  }}
                                />
                                <QtyBtn
                                  onClick={() =>
                                    actualizarCantidad(item.producto_id, 1)
                                  }
                                >
                                  +
                                </QtyBtn>
                              </div>
                            </td>
                            <td className="text-right">
                              <NumeroInput
                                min={0}
                                max={99999999}
                                step="100"
                                value={item.costo_unitario}
                                onChange={(n) =>
                                  setCostoDirecto(item.producto_id, n)
                                }
                                className="w-32 rounded-lg border px-3 py-1.5 text-right font-mono text-sm outline-none"
                                style={{
                                  borderColor: "var(--n-150)",
                                  color: "var(--n-950)",
                                  backgroundColor: "var(--n-0)",
                                }}
                              />
                            </td>
                            <td className="text-right">
                              <span
                                className="font-mono text-sm font-semibold tabular-nums"
                                style={{ color: "var(--n-950)" }}
                              >
                                {formatCOP(item.cantidad * item.costo_unitario)}
                              </span>
                            </td>
                            <td>
                              <button
                                onClick={() => eliminarItem(item.producto_id)}
                                className="grid h-8 w-8 place-items-center rounded-lg transition-colors"
                                style={{ color: "var(--n-500)" }}
                                onMouseEnter={(e) =>
                                  (e.currentTarget.style.color =
                                    "var(--dang-600)")
                                }
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.color = "var(--n-500)")
                                }
                                aria-label="Eliminar producto"
                              >
                                <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile: cards */}
                  <div className="space-y-2.5 md:hidden">
                    {carrito.map((item) => (
                      <div
                        key={item.producto_id}
                        className="space-y-2 rounded-[10px] border p-3"
                        style={{
                          backgroundColor: "var(--n-0)",
                          borderColor: "var(--n-150)",
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p
                              className="truncate text-sm font-medium"
                              style={{ color: "var(--n-950)" }}
                            >
                              {item.nombre}
                            </p>
                            <p
                              className="font-mono text-[11px]"
                              style={{ color: "var(--n-500)" }}
                            >
                              {item.referencia}
                            </p>
                            {item.desglose?.length > 1 && (
                              <p
                                className="m-0 text-[10.5px]"
                                style={{ color: "var(--info-700)" }}
                              >
                                Suma de{" "}
                                {item.desglose
                                  .map((d) => `${d.sede_id} ${d.cantidad}`)
                                  .join(" + ")}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => eliminarItem(item.producto_id)}
                            className="shrink-0"
                            style={{ color: "var(--n-500)" }}
                            aria-label="Eliminar producto"
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                          </button>
                        </div>
                        <DestinoToggle
                          value={item.destino}
                          onChange={(d) => setDestino(item.producto_id, d)}
                        />
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex items-center gap-1">
                            <QtyBtn
                              onClick={() =>
                                actualizarCantidad(item.producto_id, -1)
                              }
                            >
                              −
                            </QtyBtn>
                            <NumeroInput
                              min={1}
                              max={100000}
                              value={item.cantidad}
                              onChange={(n) =>
                                setCantidadDirecta(item.producto_id, n)
                              }
                              className="w-14 rounded-lg border py-1.5 text-center font-mono text-sm font-semibold outline-none"
                              style={{
                                borderColor: "var(--n-150)",
                                color: "var(--n-950)",
                                backgroundColor: "var(--n-0)",
                              }}
                            />
                            <QtyBtn
                              onClick={() =>
                                actualizarCantidad(item.producto_id, 1)
                              }
                            >
                              +
                            </QtyBtn>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span
                              className="text-xs"
                              style={{ color: "var(--n-500)" }}
                            >
                              $
                            </span>
                            <NumeroInput
                              min={0}
                              max={99999999}
                              step="100"
                              value={item.costo_unitario}
                              onChange={(n) =>
                                setCostoDirecto(item.producto_id, n)
                              }
                              className="w-28 rounded-lg border px-2 py-1.5 font-mono text-sm outline-none"
                              style={{
                                borderColor: "var(--n-150)",
                                color: "var(--n-950)",
                                backgroundColor: "var(--n-0)",
                              }}
                            />
                          </div>
                          <span
                            className="ml-auto font-mono text-sm font-bold tabular-nums"
                            style={{ color: "var(--n-950)" }}
                          >
                            {formatCOP(item.cantidad * item.costo_unitario)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* IVA de la compra (solo compra normal) — paridad con Ventas */}
          {modo === "normal" && (
            <div className="iblock flex flex-col gap-3">
              <div className="ib-head">
                <div className="ib-title">IVA de la compra</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {IVA_PRESETS.map((p) => {
                  const on = ivaPct === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setIvaPct(p)}
                      className="rounded-md border px-3 text-[13px] font-medium transition-colors"
                      style={{
                        minHeight: 36,
                        borderColor: on ? "var(--p-400)" : "var(--n-200)",
                        backgroundColor: on ? "var(--p-600)" : "var(--n-0)",
                        color: on ? "#fff" : "var(--n-700)",
                      }}
                    >
                      {p === 0 ? "Exento (0%)" : `${p}%`}
                    </button>
                  );
                })}
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={ivaPct}
                  onChange={(e) =>
                    setIvaPct(
                      Math.min(100, Math.max(0, Number(e.target.value))),
                    )
                  }
                  className="finput"
                  style={{ width: 80, textAlign: "center" }}
                  aria-label="IVA porcentaje"
                />
              </div>
            </div>
          )}

          {/* B9 — Forma de pago + cuenta + descuento (solo compra normal) */}
          {modo === "normal" && (
            <div className="iblock flex flex-col gap-3.5">
              <div className="ib-head">
                <div className="ib-title">Pago de la compra</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {["Efectivo", "Transferencia", "Tarjeta", "Crédito"].map(
                  (m) => {
                    const on = metodoPago === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setMetodoPago(m);
                          if (m === "Efectivo" || m === "Crédito")
                            setCuentaBancaria("");
                        }}
                        className="rounded-md border px-3 text-[13px] font-medium transition-colors"
                        style={{
                          minHeight: 48,
                          borderColor: on ? "var(--p-400)" : "var(--n-200)",
                          backgroundColor: on ? "var(--p-600)" : "var(--n-0)",
                          color: on ? "#fff" : "var(--n-700)",
                        }}
                      >
                        {m}
                      </button>
                    );
                  },
                )}
              </div>
              {esCredito && (
                <PagosHoyCredito
                  pagos={pagosHoy}
                  resumen={resumenPagos}
                  cuentasBanco={cuentasBanco}
                  esVendedor={esVendedor}
                  onAgregar={agregarPagoHoy}
                  onCambiar={cambiarPagoHoy}
                  onQuitar={quitarPagoHoy}
                />
              )}

              {(metodoPago === "Transferencia" || metodoPago === "Tarjeta") && (
                <div className="flex flex-wrap items-center gap-2.5">
                  <label
                    htmlFor="compra-cuenta"
                    className="text-sm"
                    style={{ color: "var(--n-500)" }}
                  >
                    Cuenta bancaria
                    <span style={{ color: "var(--dang-700)" }}> *</span>
                  </label>
                  <select
                    id="compra-cuenta"
                    value={cuentaBancaria}
                    onChange={(e) => setCuentaBancaria(e.target.value)}
                    className="h-12 cursor-pointer rounded-[10px] border bg-transparent px-3 text-[13px] font-medium outline-none"
                    style={{
                      borderColor: "var(--n-200)",
                      color: "var(--n-950)",
                    }}
                  >
                    <option value="">Sin especificar</option>
                    {cuentasBanco.map((c) => {
                      const ref = `${c.banco} ${c.tipo} ${c.numero}${c.titular ? " · " + c.titular : ""}`;
                      return (
                        <option key={c.id} value={ref}>
                          {ref}
                        </option>
                      );
                    })}
                  </select>
                  {!cuentaBancaria && (
                    <span
                      className="text-[11.5px]"
                      style={{ color: "var(--dang-700)" }}
                    >
                      {cuentasBanco.length === 0
                        ? "No hay cuentas activas. El Admin debe crearlas en Configuración."
                        : "Obligatorio: indica desde qué cuenta se pagó"}
                    </span>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm" style={{ color: "var(--n-500)" }}>
                  Descuento $
                </label>
                <NumeroInput
                  min={0}
                  step="1000"
                  value={descuentoValor}
                  onChange={(n) => setDescuentoValor(Math.max(0, n))}
                  className="finput"
                  style={{ width: 140, textAlign: "center" }}
                  aria-label="Descuento en pesos"
                />
                <span
                  className="text-[11.5px]"
                  style={{ color: "var(--n-500)" }}
                >
                  Se resta del subtotal antes del IVA.
                </span>
              </div>
            </div>
          )}

          {/* Retenciones: nosotros como agente retenedor. Solo en orden de
              compra — un recibo de caja menor no lleva retención, y además se
              guarda por otro camino (guardarCajaMenor). */}
          {modo === "normal" && (
            <BloqueRetenciones
              modo="compra"
              base={subtotal - descuento}
              iva={iva}
              total={total}
              valores={retenciones}
              onChange={setRetenciones}
              sugeridas={tarifasSugeridas}
            />
          )}

          {/* #31 — Caja menor: concepto + monto (no inventariable) */}
          {modo === "caja_menor" && (
            <div className="iblock flex flex-col gap-3.5">
              <div className="ib-head">
                <div className="ib-ico">
                  <Truck className="h-3.5 w-3.5" strokeWidth={2} />
                </div>
                <div className="ib-title">Gasto de caja menor</div>
              </div>
              <div className="grid grid-cols-1 gap-3 gap-x-3.5 sm:grid-cols-2">
                <Field label="Concepto" req>
                  <input
                    type="text"
                    value={concepto}
                    onChange={(e) => setConcepto(e.target.value)}
                    placeholder="Ej: transporte, papelería, refrigerio…"
                    className="finput sans"
                    style={{ height: 48 }}
                  />
                </Field>
                <Field label="Monto" req>
                  {/* Separador de miles mientras se escribe ("$ 647.185");
                      `monto` sigue guardando solo los dígitos. */}
                  <MonedaInput
                    value={monto}
                    onChange={setMonto}
                    placeholder="$ 0"
                    className="finput"
                    style={{ height: 48 }}
                    aria-label="Monto del gasto en pesos"
                  />
                </Field>
                <Field label="Categoría" req>
                  <select
                    value={categoriaGasto}
                    onChange={(e) => setCategoriaGasto(e.target.value)}
                    className="finput sans"
                    style={{ height: 48 }}
                  >
                    <option value="">Elige una…</option>
                    {catsGasto
                      .filter((c) => c.afecta_resultado)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nombre}
                        </option>
                      ))}
                    {/* Estas NO restan del resultado: pagan mercancía ya contada
                        en el costo, o mueven plata de un lado a otro. Van
                        aparte para que nadie las elija creyendo que es un gasto. */}
                    <optgroup label="No son gasto del periodo">
                      {catsGasto
                        .filter((c) => !c.afecta_resultado)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nombre}
                          </option>
                        ))}
                    </optgroup>
                  </select>
                </Field>
              </div>

              {/* S6-E: método de pago del gasto (antes siempre quedaba Efectivo). */}
              <div>
                <p
                  className="mb-1.5 text-xs font-medium"
                  style={{ color: "var(--n-500)" }}
                >
                  ¿Cómo se pagó?
                </p>
                <div className="flex flex-wrap gap-2">
                  {["Efectivo", "Transferencia", "Tarjeta", "Crédito"].map(
                    (m) => {
                      const on = metodoPago === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            setMetodoPago(m);
                            if (m === "Efectivo" || m === "Crédito")
                              setCuentaBancaria("");
                          }}
                          className="rounded-md border px-3 text-[13px] font-medium transition-colors"
                          style={{
                            minHeight: 48,
                            borderColor: on ? "var(--p-400)" : "var(--n-200)",
                            backgroundColor: on ? "var(--p-600)" : "var(--n-0)",
                            color: on
                              ? "var(--p-contrast, #fff)"
                              : "var(--n-700)",
                          }}
                        >
                          {m}
                        </button>
                      );
                    },
                  )}
                </div>
                {(metodoPago === "Transferencia" ||
                  metodoPago === "Tarjeta") && (
                  <div className="mt-2 flex flex-wrap items-center gap-2.5">
                    <label
                      htmlFor="cm-cuenta"
                      className="text-sm"
                      style={{ color: "var(--n-500)" }}
                    >
                      Cuenta bancaria
                      <span style={{ color: "var(--dang-700)" }}> *</span>
                    </label>
                    <select
                      id="cm-cuenta"
                      value={cuentaBancaria}
                      onChange={(e) => setCuentaBancaria(e.target.value)}
                      className="h-12 cursor-pointer rounded-[10px] border bg-transparent px-3 text-[13px] font-medium outline-none"
                      style={{
                        borderColor: "var(--n-200)",
                        color: "var(--n-950)",
                      }}
                    >
                      <option value="">Sin especificar</option>
                      {cuentasBanco.map((c) => {
                        const ref = `${c.banco} ${c.tipo} ${c.numero}${c.titular ? " · " + c.titular : ""}`;
                        return (
                          <option key={c.id} value={ref}>
                            {ref}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}
                {metodoPago === "Crédito" && (
                  <p
                    className="mt-2 text-xs"
                    style={{ color: "var(--warn-700)" }}
                  >
                    Queda en Cuentas por pagar; hoy no sale plata. Se paga
                    después desde Cuentas por pagar
                    {esVendedor
                      ? " (lo registra bodega o el administrador)"
                      : ""}
                    .
                  </p>
                )}
              </div>

              <p className="text-xs" style={{ color: "var(--n-500)" }}>
                La caja menor NO afecta el inventario. El monto es el total (sin
                IVA).
              </p>
            </div>
          )}

          {/* Observaciones */}
          <div className="iblock flex flex-col gap-3">
            <div className="ib-head">
              <div className="ib-title">Observaciones</div>
            </div>
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Observaciones internas (opcional)"
              rows={2}
              className="ftextarea"
            />
          </div>

          {/* Recibir ahora (solo compra normal) */}
          {modo === "normal" && (
            <label
              className="flex cursor-pointer select-none items-center gap-3 rounded-[10px] border p-4"
              style={{
                backgroundColor: "var(--n-0)",
                borderColor: recibirAhora ? "var(--p-500)" : "var(--n-150)",
              }}
            >
              <input
                type="checkbox"
                checked={recibirAhora}
                onChange={(e) => setRecibirAhora(e.target.checked)}
                className="h-5 w-5 cursor-pointer rounded"
                style={{ accentColor: "var(--p-600)" }}
              />
              <div>
                <p
                  className="text-sm font-semibold"
                  style={{ color: "var(--n-950)" }}
                >
                  {ofreceConteo
                    ? "Recibir sin contar"
                    : "Marcar como recibida ahora"}
                </p>
                {/* La advertencia dice el daño CONCRETO, con las unidades de
                    esta compra, no un genérico. Un faltante que nadie contó no
                    aparece como algo que el proveedor debía: aparece semanas
                    después como pérdida de bodega, cuando ya no hay a quién
                    reclamarle. */}
                <p className="text-xs" style={{ color: "var(--n-500)" }}>
                  {ofreceConteo
                    ? recibirAhora
                      ? `El inventario va a decir que llegaron ${totalItems} unidades aunque hayan llegado menos, y cualquier faltante quedará como pérdida de bodega, no como algo que el proveedor debía.`
                      : "Déjalo sin marcar y al guardar pasas a contar lo que llegó."
                    : "El stock se sumará automáticamente al confirmar"}
                </p>
              </div>
            </label>
          )}

          {error && (
            <div
              className="rounded-[10px] border px-4 py-3"
              style={{
                backgroundColor: "var(--dang-50)",
                borderColor: "var(--dang-border)",
              }}
            >
              <p className="text-sm" style={{ color: "var(--dang-700)" }}>
                {error}
              </p>
            </div>
          )}
        </div>

        {/* ── Resumen (sticky) ──────────────────────────────────────── */}
        <aside className="cart">
          <span className="cart-eyebrow">
            {modo === "caja_menor"
              ? "Resumen de caja menor"
              : "Resumen de la compra"}
          </span>
          {modo === "normal" ? (
            <>
              <div className="text-[12px]" style={{ color: "var(--n-500)" }}>
                {totalItems} items · {carrito.length} productos
              </div>
              <div className="cart-line">
                <span>Subtotal</span>
                <span className="v">{formatCOP(subtotal)}</span>
              </div>
              {descuento > 0 && (
                <div className="cart-line" style={{ color: "var(--warn-700)" }}>
                  <span>Descuento</span>
                  <span className="v" style={{ color: "var(--warn-700)" }}>
                    −{formatCOP(descuento)}
                  </span>
                </div>
              )}
              <div className="cart-line">
                <span>
                  IVA {ivaPct}%{ivaPct === 0 ? " (exento)" : ""}
                </span>
                <span className="v">{formatCOP(iva)}</span>
              </div>
              <div className="cart-line tot">
                <span>Total estimado</span>
                <span className="v">{formatCOP(total)}</span>
              </div>
              {/* Se usan las clases locales de esta tarjeta (cart-line, tot,
                  var(--warn-700)) porque es lo que ya usa para el descuento;
                  mezclar aquí los tokens del sistema de diseño se vería como un
                  parche. */}
              {retencionesCalculadas.hay && (
                <>
                  <div
                    className="cart-line"
                    style={{ color: "var(--warn-700)" }}
                  >
                    <span>Retenciones</span>
                    <span className="v" style={{ color: "var(--warn-700)" }}>
                      −{formatCOP(retencionesCalculadas.total)}
                    </span>
                  </div>
                  <div className="cart-line tot">
                    <span>Neto a pagar</span>
                    <span className="v">
                      {formatCOP(retencionesCalculadas.neto)}
                    </span>
                  </div>
                </>
              )}
              <div className="text-[11.5px]" style={{ color: "var(--n-500)" }}>
                Pago: {metodoPago}
                {esCredito && resumenPagos.nPagos === 0 ? " (pendiente)" : ""}
              </div>
              {esCredito && resumenPagos.nPagos > 0 && (
                <>
                  <div className="cart-line">
                    <span>Pagado hoy</span>
                    <span className="v">{formatCOP(resumenPagos.pagado)}</span>
                  </div>
                  <div
                    className="cart-line"
                    style={{
                      color: resumenPagos.completa
                        ? "var(--succ-700)"
                        : "var(--warn-700)",
                    }}
                  >
                    <span>Queda debiendo</span>
                    <span
                      className="v"
                      style={{
                        color: resumenPagos.completa
                          ? "var(--succ-700)"
                          : "var(--warn-700)",
                      }}
                    >
                      {formatCOP(resumenPagos.saldo)}
                    </span>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="text-[12px]" style={{ color: "var(--n-500)" }}>
                Gasto no inventariable
              </div>
              <div className="cart-line tot">
                <span>Total</span>
                <span className="v">{formatCOP(Number(monto) || 0)}</span>
              </div>
              {metodoPago === "Crédito" && (
                <div
                  className="text-[11.5px]"
                  style={{ color: "var(--warn-700)" }}
                >
                  A crédito: hoy no sale plata.
                </div>
              )}
            </>
          )}
          <button
            onClick={modo === "caja_menor" ? guardarCajaMenor : guardarCompra}
            disabled={
              guardando ||
              (modo === "normal"
                ? carrito.length === 0 || !proveedor.trim()
                : !concepto.trim() || !categoriaGasto || !(Number(monto) > 0))
            }
            className="btn btn-pri mt-2 w-full justify-center disabled:opacity-40"
            style={{ height: 48 }}
          >
            {guardando ? (
              "Guardando…"
            ) : modo === "caja_menor" ? (
              <>
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                Registrar caja menor
              </>
            ) : recibirAhora ? (
              <>
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                Registrar y recibir
              </>
            ) : ofreceConteo ? (
              <>
                Registrar y contar
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
              </>
            ) : (
              <>
                Registrar compra
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
              </>
            )}
          </button>
        </aside>
      </div>
      {scannerOpen && (
        <QRScanner
          onFound={handleQRFound}
          onClose={() => setScannerOpen(false)}
          continuo
        />
      )}
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function Step({ n, label, state }) {
  return (
    <div className={`step ${state}`}>
      <div className="step-dot">
        {state === "done" ? <Check className="h-3 w-3" strokeWidth={3} /> : n}
      </div>
      <div className="step-lbl">{label}</div>
    </div>
  );
}

function Line({ done }) {
  return <div className={`step-line ${done ? "done" : ""}`} />;
}

function Field({ label, req, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flbl">
        {label}
        {req && <span className="req">*</span>}
      </label>
      {children}
    </div>
  );
}

function QtyBtn({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="grid h-8 w-8 place-items-center rounded-lg border text-lg font-bold transition-colors disabled:opacity-40"
      style={{
        borderColor: "var(--n-150)",
        color: "var(--n-700)",
        backgroundColor: "var(--n-0)",
      }}
    >
      {children}
    </button>
  );
}

/** Selector Venta/Insumo por producto del carrito (a qué stock entra). */
function DestinoToggle({ value, onChange }) {
  const opts = [
    { v: "venta", t: "Venta" },
    { v: "insumo", t: "Insumo" },
  ];
  return (
    <div
      className="inline-flex overflow-hidden rounded-lg border"
      style={{ borderColor: "var(--n-150)" }}
      role="group"
      aria-label="Destino del stock"
    >
      {opts.map((o) => {
        const on = (value ?? "venta") === o.v;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            aria-pressed={on}
            // C-06: tap target táctil (>=40px) — antes py-1 quedaba en ~24px.
            className="min-h-[40px] px-3 py-2 text-[11px] font-semibold transition-colors"
            style={{
              backgroundColor: on ? "var(--p-600)" : "var(--n-0)",
              color: on ? "var(--p-contrast, #fff)" : "var(--n-500)",
            }}
          >
            {o.t}
          </button>
        );
      })}
    </div>
  );
}

/**
 * "¿Le pagaste algo hoy?" — pagos hechos el mismo día sobre una compra a
 * Crédito. Así se paga una compra en dos formas (parte efectivo, parte
 * transferencia) o se deja un anticipo; cada renglón queda como un pago a la
 * compra en Cuentas por pagar y el cierre lo cuenta por su forma de pago.
 * Pensado para el celular: cada renglón apila forma, cuenta y monto.
 */
function PagosHoyCredito({
  pagos,
  resumen,
  cuentasBanco,
  esVendedor,
  onAgregar,
  onCambiar,
  onQuitar,
}) {
  const tono = resumen.excedido
    ? "dang"
    : resumen.completa
      ? "succ"
      : resumen.nPagos > 0
        ? "warn"
        : "n";
  return (
    <div
      className="flex flex-col gap-3 rounded-[10px] border p-3"
      style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-25)" }}
    >
      <div>
        <p
          className="m-0 text-[13.5px] font-semibold"
          style={{ color: "var(--n-950)" }}
        >
          ¿Le pagaste algo hoy?
        </p>
        <p
          className="m-0 mt-0.5 text-[12px] leading-[1.45]"
          style={{ color: "var(--n-500)" }}
        >
          Si pagaste la compra en dos formas (por ejemplo, una parte en efectivo
          y otra por transferencia) o dejaste un anticipo, anota aquí cada pago.
          Lo que quede debiendo se paga después desde Cuentas por pagar
          {esVendedor ? " (lo registra bodega o el administrador)" : ""}.
        </p>
      </div>

      {pagos.map((p, i) => {
        const electronico =
          p.metodo_pago === "Transferencia" || p.metodo_pago === "Tarjeta";
        return (
          <div
            key={p.key}
            className="flex flex-col gap-2 rounded-[10px] border p-2.5"
            style={{
              borderColor: "var(--n-150)",
              backgroundColor: "var(--n-0)",
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
                style={{ color: "var(--n-500)" }}
              >
                Pago {i + 1}
              </span>
              <button
                type="button"
                onClick={() => onQuitar(p.key)}
                aria-label={`Quitar el pago ${i + 1}`}
                className="grid h-12 w-12 shrink-0 place-items-center rounded-lg transition-colors"
                style={{ color: "var(--n-500)" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.color = "var(--dang-600)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color = "var(--n-500)")
                }
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
            <div
              className="flex gap-1.5"
              role="group"
              aria-label={`Forma del pago ${i + 1}`}
            >
              {METODOS_PAGO_PARTE.map((m) => {
                const on = p.metodo_pago === m;
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      onCambiar(p.key, {
                        metodo_pago: m,
                        ...(m === "Efectivo" ? { cuenta_bancaria: "" } : {}),
                      })
                    }
                    className="min-w-0 flex-1 rounded-md border px-1 text-[12.5px] font-medium transition-colors"
                    style={{
                      minHeight: 48,
                      borderColor: on ? "var(--p-400)" : "var(--n-200)",
                      backgroundColor: on ? "var(--p-600)" : "var(--n-0)",
                      color: on ? "var(--p-contrast, #fff)" : "var(--n-700)",
                    }}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
            {electronico && (
              <select
                value={p.cuenta_bancaria}
                onChange={(e) =>
                  onCambiar(p.key, { cuenta_bancaria: e.target.value })
                }
                aria-label={`Cuenta bancaria del pago ${i + 1}`}
                className="h-12 w-full cursor-pointer rounded-[10px] border bg-transparent px-3 text-[13px] font-medium outline-none"
                style={{
                  borderColor: p.cuenta_bancaria
                    ? "var(--n-200)"
                    : "var(--dang-border)",
                  color: "var(--n-950)",
                }}
              >
                <option value="">
                  {cuentasBanco.length === 0
                    ? "No hay cuentas activas (el Admin las crea en Configuración)"
                    : "¿De qué cuenta salió?"}
                </option>
                {cuentasBanco.map((c) => {
                  const ref = `${c.banco} ${c.tipo} ${c.numero}${c.titular ? " · " + c.titular : ""}`;
                  return (
                    <option key={c.id} value={ref}>
                      {ref}
                    </option>
                  );
                })}
              </select>
            )}
            <MonedaInput
              value={p.monto}
              onChange={(v) => onCambiar(p.key, { monto: v })}
              placeholder="$ 0"
              className="finput"
              style={{ height: 48 }}
              aria-label={`Monto del pago ${i + 1} en pesos`}
            />
          </div>
        );
      })}

      <button
        type="button"
        onClick={onAgregar}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-dashed text-[13px] font-medium transition-colors"
        style={{
          minHeight: 48,
          borderColor: "var(--p-400)",
          color: "var(--p-700)",
          backgroundColor: "var(--n-0)",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.backgroundColor = "var(--p-50)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.backgroundColor = "var(--n-0)")
        }
      >
        <Plus className="h-4 w-4" strokeWidth={2} />
        {pagos.length === 0 ? "Sí, anotar un pago" : "Agregar otro pago"}
      </button>

      <div
        className="flex flex-col gap-1 rounded-[10px] border px-3 py-2.5 text-[13px]"
        style={{
          borderColor: tono === "n" ? "var(--n-150)" : `var(--${tono}-border)`,
          backgroundColor: tono === "n" ? "var(--n-0)" : `var(--${tono}-50)`,
        }}
      >
        <FilaMonto label="Neto a pagar" valor={resumen.neto} />
        <FilaMonto label="Pagado hoy" valor={resumen.pagado} />
        <FilaMonto label="Queda debiendo" valor={resumen.saldo} />
        <p
          className="m-0 mt-1 text-[12.5px] font-semibold"
          style={{
            color: tono === "n" ? "var(--n-700)" : `var(--${tono}-700)`,
          }}
        >
          {resumen.excedido
            ? `Los pagos se pasan del neto por ${formatCOP(resumen.pagado - resumen.neto)}. Baja algún monto.`
            : fraseResultadoPagos(resumen)}
        </p>
      </div>
    </div>
  );
}

function FilaMonto({ label, valor }) {
  return (
    <div className="flex justify-between gap-2">
      <span style={{ color: "var(--n-600)" }}>{label}</span>
      <b className="font-mono tabular-nums" style={{ color: "var(--n-950)" }}>
        {formatCOP(valor)}
      </b>
    </div>
  );
}
