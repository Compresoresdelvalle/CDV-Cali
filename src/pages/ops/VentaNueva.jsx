import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftCircle,
  Search,
  ScanLine,
  Trash2,
  Minus,
  Plus,
  Star,
  AlertTriangle,
  ChevronRight,
  MapPin,
  Wrench,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import { applyKeywordSearch } from "../../lib/search";
import QRScanner from "../../components/forms/QRScanner";
import ClientePicker from "../../components/forms/ClientePicker";
import UbicacionChip from "../../components/ui/UbicacionChip";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import { metodoPagoClass } from "../../lib/ventas-ui";
import { SEDE_LABELS, sedeLabel } from "../../lib/traspasos-ui";
import { SEDES } from "../../lib/constants";
import { upsertCliente } from "../../lib/clientes";

const METODOS_PAGO = [
  "Efectivo",
  "Transferencia",
  "Tarjeta",
  "Crédito",
  "Mixto",
];
const IVA_DEFAULT = 19;
const IVA_PRESETS = [0, 19];
const SEDE_IDS = Object.values(SEDES); // BODEGA, CV, L3, CHV

export default function VentaNueva() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [carrito, setCarrito] = useState([]);
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteNit, setClienteNit] = useState("");
  // Datos adicionales del cliente (al elegir uno existente). Se reutilizan en el
  // upsert para conservarlos; la venta solo persiste nombre + nit vía RPC.
  const [clienteTelefono, setClienteTelefono] = useState("");
  const [clienteEmail, setClienteEmail] = useState("");
  const [clienteDireccion, setClienteDireccion] = useState("");
  // #S1-03: nombre del cliente realmente seleccionado del picker. Si el usuario
  // luego edita el nombre a mano y deja de coincidir, se descartan sus datos de
  // contacto ocultos para no atribuírselos a otro cliente distinto.
  const [clienteSelNombre, setClienteSelNombre] = useState("");
  const [metodoPago, setMetodoPago] = useState("Efectivo");
  const [cuentaBancaria, setCuentaBancaria] = useState(""); // #13
  // Pago mixto (#2): montos por forma de pago sobre una sola factura.
  const [pagoEfectivo, setPagoEfectivo] = useState("");
  const [pagoTransfer, setPagoTransfer] = useState("");
  // B1 (ít 6): cuentas bancarias reales para elegir la cuenta destino del pago.
  const [cuentasBanco, setCuentasBanco] = useState([]);
  useEffect(() => {
    supabase
      .from("cuentas_bancarias")
      .select("id, banco, tipo, numero, titular")
      .eq("activo", true)
      .order("banco")
      .then(({ data }) => setCuentasBanco(data ?? []));
  }, []);
  // B3 (vender servicio): catálogo de servicios activos para agregar al carrito.
  const [servicios, setServicios] = useState([]);
  useEffect(() => {
    supabase
      .from("servicios")
      .select("id, nombre, precio, iva_pct")
      .eq("activo", true)
      .order("nombre")
      .then(({ data }) => setServicios(data ?? []));
  }, []);
  const [descuentoValor, setDescuentoValor] = useState(0); // B3: descuento en $
  const [domicilio, setDomicilio] = useState(0); // B3: valor de domicilio en $
  const [ivaPct, setIvaPct] = useState(IVA_DEFAULT);
  const [observaciones, setObservaciones] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState(null);
  const [historialCliente, setHistorialCliente] = useState(null);

  // #11 — Sede a consultar (de qué almacén veo el stock). Default: la mía.
  const esVendedor = perfil?.rol === "Vendedor";
  const [sedeConsulta, setSedeConsulta] = useState(
    () => perfil?.sede_id || SEDES.BODEGA,
  );
  const [bloqueoSede, setBloqueoSede] = useState(false);
  // La venta SALE de: Admin → la sede elegida; Vendedor → siempre su sede.
  const sedeVenta = esVendedor ? perfil?.sede_id : sedeConsulta;
  // El vendedor está mirando una sede que NO es la suya (solo consulta).
  const consultandoOtraSede = esVendedor && sedeConsulta !== perfil?.sede_id;

  // #S1-16: guardia anti-carrera — descarta respuestas de búsquedas viejas que
  // resuelven después de una más reciente (evita pisar resultados correctos).
  const buscarReqRef = useRef(0);
  const buscarProductos = useCallback(
    async (q) => {
      if (!q || q.trim().length < 2 || !sedeConsulta) {
        buscarReqRef.current++;
        setResultados([]);
        return;
      }
      const myReq = ++buscarReqRef.current;
      setBuscando(true);
      try {
        let pq = supabase
          .from("productos")
          .select("id, nombre, referencia, precio_venta, unidad_medida")
          .eq("activo", true)
          .eq("vendible", true); // Bloque 2: los insumos no se venden
        // #32: búsqueda por palabras clave.
        pq = applyKeywordSearch(pq, q, ["nombre", "referencia"]);
        const { data: prods, error: e1 } = await pq.limit(1000);
        if (myReq !== buscarReqRef.current) return;
        if (e1) throw e1;
        if (!prods?.length) {
          setResultados([]);
          return;
        }

        const ids = prods.map((p) => p.id);
        // #11: stock de la sede consultada. #12: NO filtramos por cantidad>0,
        // mostramos TODOS (los sin stock con su badge).
        const { data: inv, error: e2 } = await supabase
          .from("inventario")
          .select("producto_id, cantidad, ubicacion_id")
          .eq("sede_id", sedeConsulta)
          .in("producto_id", ids);
        if (myReq !== buscarReqRef.current) return;
        if (e2) throw e2;

        const stockMap = Object.fromEntries(
          (inv ?? []).map((i) => [i.producto_id, i.cantidad]),
        );
        const ubicMap = Object.fromEntries(
          (inv ?? []).map((i) => [i.producto_id, i.ubicacion_id]),
        );
        const merged = prods.map((p) => ({
          ...p,
          stock_disponible: stockMap[p.id] ?? 0,
          ubicacion_id: ubicMap[p.id] ?? null,
        }));

        setResultados(merged.slice(0, 8));
      } catch {
        if (myReq === buscarReqRef.current) setResultados([]);
      } finally {
        if (myReq === buscarReqRef.current) setBuscando(false);
      }
    },
    [sedeConsulta],
  );

  const buscarDebounced = useDebouncedCallback(buscarProductos, 400);

  const handleBusquedaChange = (e) => {
    const val = e.target.value;
    setBusqueda(val);
    buscarDebounced(val);
  };

  // Lookup read-only del historial del cliente (banner "cliente recurrente").
  // Cuenta ventas previas no anuladas con ese nombre exacto. NO escribe nada.
  const buscarHistorialCliente = useDebouncedCallback(async (nombre) => {
    const n = (nombre || "").trim();
    if (n.length < 3) {
      setHistorialCliente(null);
      return;
    }
    try {
      const { data, error: e } = await supabase
        .from("ventas")
        .select("total, fecha")
        .eq("cliente_nombre", n)
        .eq("anulada", false)
        .order("fecha", { ascending: false })
        .limit(50);
      if (e) throw e;
      if (!data || data.length === 0) {
        setHistorialCliente(null);
        return;
      }
      setHistorialCliente({
        compras: data.length,
        ultimaFecha: data[0]?.fecha ?? null,
        ultimoTotal: Number(data[0]?.total ?? 0),
      });
    } catch {
      setHistorialCliente(null);
    }
  }, 500);

  const handleQRFound = useCallback(
    async (productoId) => {
      setScannerOpen(false);
      try {
        const [{ data: prod }, { data: inv }] = await Promise.all([
          supabase
            .from("productos")
            .select("id, nombre, referencia, precio_venta, unidad_medida")
            .eq("id", productoId)
            .eq("activo", true)
            .eq("vendible", true) // Bloque 2: los insumos no se venden
            .maybeSingle(),
          supabase
            .from("inventario")
            .select("cantidad")
            .eq("sede_id", sedeConsulta)
            .eq("producto_id", productoId)
            .maybeSingle(),
        ]);
        // #12: aunque no haya stock se agrega (con aviso). Solo exigimos que el
        // producto exista y sea vendible.
        // #S1-19: si no es vendible/no existe, decirlo en vez de no hacer nada.
        if (!prod) {
          setError(
            "Ese código no corresponde a un producto vendible (puede ser un insumo o estar inactivo).",
          );
          return;
        }
        setError(null);
        agregarAlCarrito({ ...prod, stock_disponible: inv?.cantidad ?? 0 });
      } catch (e) {
        // #S1-19: un error real (red/permisos) ya no se traga en silencio.
        setError(
          safeError(
            e,
            "No se pudo leer el producto escaneado. Revisa la conexión e intenta de nuevo.",
          ),
        );
      }
    },
    [sedeConsulta],
  );

  // Identidad de cada línea del carrito (producto o servicio). Se usa como key
  // de React y para localizar la línea en los handlers de cantidad/precio.
  const lineKey = (i) =>
    i.tipo === "servicio" ? `s:${i.servicio_id}` : `p:${i.producto_id}`;

  const agregarAlCarrito = (prod) => {
    // #11: el vendedor solo vende desde su sede. Si está consultando otra,
    // no deja agregar y muestra el popup informativo.
    if (consultandoOtraSede) {
      setBloqueoSede(true);
      return;
    }
    setBusqueda("");
    setResultados([]);
    setCarrito((prev) => {
      const idx = prev.findIndex(
        (i) => i.tipo !== "servicio" && i.producto_id === prod.id,
      );
      if (idx >= 0) {
        const updated = [...prev];
        const item = { ...updated[idx] };
        // #12: sin tope por stock (puede quedar negativo; el RPC lo gobierna).
        item.cantidad += 1;
        updated[idx] = item;
        return updated;
      }
      return [
        ...prev,
        {
          tipo: "producto",
          producto_id: prod.id,
          nombre: prod.nombre,
          referencia: prod.referencia,
          precio_unitario: prod.precio_venta,
          unidad: prod.unidad_medida,
          stock_disponible: prod.stock_disponible,
          cantidad: 1,
        },
      ];
    });
  };

  // B3 (vender servicio): los servicios no dependen de sede ni de stock.
  const agregarServicioAlCarrito = (serv) => {
    const vacio = carrito.length === 0;
    setCarrito((prev) => {
      const idx = prev.findIndex(
        (i) => i.tipo === "servicio" && i.servicio_id === serv.id,
      );
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], cantidad: updated[idx].cantidad + 1 };
        return updated;
      }
      return [
        ...prev,
        {
          tipo: "servicio",
          servicio_id: serv.id,
          nombre: serv.nombre,
          precio_unitario: Number(serv.precio) || 0,
          cantidad: 1,
        },
      ];
    });
    // Conveniencia: si el carrito estaba vacío, alinear el IVA de la venta al
    // del servicio (el IVA sigue siendo a nivel de venta, igual que productos).
    if (vacio && serv.iva_pct != null) {
      setIvaPct(Math.min(100, Math.max(0, Number(serv.iva_pct))));
    }
  };

  const actualizarCantidad = (key, delta) => {
    // #12: sin tope por stock (la venta puede exceder el disponible → negativo).
    setCarrito((prev) =>
      prev
        .map((i) => {
          if (lineKey(i) !== key) return i;
          return { ...i, cantidad: Math.max(0, i.cantidad + delta) };
        })
        .filter((i) => i.cantidad > 0),
    );
  };

  const setCantidadDirecta = (key, valor) => {
    const n = parseInt(valor, 10);
    if (isNaN(n)) return;
    setCarrito((prev) =>
      prev
        .map((i) => {
          if (lineKey(i) !== key) return i;
          return { ...i, cantidad: Math.max(0, n) };
        })
        .filter((i) => i.cantidad > 0),
    );
  };

  // #9: editar el precio de venta por línea. Solo dígitos; vacío = 0.
  const setPrecioDirecto = (key, valor) => {
    const limpio = String(valor).replace(/[^\d]/g, "");
    const n = limpio === "" ? 0 : Number(limpio);
    if (isNaN(n) || n < 0) return;
    setCarrito((prev) =>
      prev.map((i) => (lineKey(i) === key ? { ...i, precio_unitario: n } : i)),
    );
  };

  const eliminarItem = (key) => {
    setCarrito((prev) => prev.filter((i) => lineKey(i) !== key));
  };

  // #11: cambiar la sede a consultar. Limpia la búsqueda; si el Admin cambia la
  // sede de la venta, vacía el carrito (la venta es de una sola sede).
  // #S1-11: si ya hay productos agregados, confirmar antes de vaciarlos (un
  // click accidental borraba todo el carrito sin aviso).
  const onChangeSede = (nuevaSede) => {
    if (!esVendedor && carrito.length > 0) {
      const ok = window.confirm(
        `Cambiar de sede vaciará los ${carrito.length} producto(s) que ya agregaste a esta venta. ¿Continuar?`,
      );
      if (!ok) return; // el <select> vuelve solo a la sede anterior (controlado)
    }
    setSedeConsulta(nuevaSede);
    setBusqueda("");
    setResultados([]);
    if (!esVendedor) setCarrito([]);
  };

  // Misma fórmula que el trigger trg_recalcular_total_venta del servidor:
  // total = subtotal * (1 - desc/100) * (1 + iva/100)
  // Esto evita drifts de 1-2 COP por orden de operaciones distinto.
  const subtotal = carrito.reduce(
    (s, i) => s + i.cantidad * i.precio_unitario,
    0,
  );
  // B3: descuento en valor absoluto ($), clamp a [0, subtotal]. El domicilio se
  // suma DESPUÉS del IVA (no se grava). Debe coincidir con trg_recalcular_total_venta.
  const descuento = Math.min(Math.max(0, descuentoValor), subtotal);
  const baseIva = subtotal - descuento;
  const iva = baseIva * (ivaPct / 100);
  // Redondeo a pesos enteros (sin centavos), igual que el servidor.
  const total = Math.round(
    baseIva * (1 + ivaPct / 100) + Math.max(0, domicilio),
  );

  // Pago mixto: la suma de las formas debe igualar el total (COP, tolerancia 1).
  const totalRedondeado = Math.round(total);
  const sumaMixto =
    Math.round(Number(pagoEfectivo) || 0) +
    Math.round(Number(pagoTransfer) || 0);
  const mixtoCuadra =
    metodoPago !== "Mixto" || Math.abs(sumaMixto - totalRedondeado) <= 1;

  // Paso activo del stepper, derivado del estado real de la venta en curso.
  const pasoActivo = useMemo(() => {
    if (confirmando) return 3;
    if (carrito.length === 0) return 1;
    return 2;
  }, [carrito.length, confirmando]);

  const confirmarVenta = async () => {
    if (carrito.length === 0) return;
    // B1 (ít 6): la cuenta destino es obligatoria en pagos electrónicos
    // (Transferencia/Tarjeta). En Efectivo y Crédito no aplica.
    if (
      (metodoPago === "Transferencia" || metodoPago === "Tarjeta") &&
      !cuentaBancaria
    ) {
      setError("Selecciona la cuenta bancaria donde entró el pago.");
      return;
    }
    // Pago mixto: la suma de efectivo + transferencia debe igualar el total.
    if (metodoPago === "Mixto") {
      if (!mixtoCuadra) {
        setError(
          `La suma de los pagos (${formatCOP(sumaMixto)}) no coincide con el total (${formatCOP(totalRedondeado)}).`,
        );
        return;
      }
      if (Math.round(Number(pagoTransfer) || 0) > 0 && !cuentaBancaria) {
        setError("Indica la cuenta bancaria de la parte por transferencia.");
        return;
      }
    }
    // #S1-09: una venta a crédito necesita un cliente identificable; si no,
    // queda una cuenta por cobrar sin dueño (no se sabe a quién cobrarle).
    if (metodoPago === "Crédito" && !clienteNombre.trim()) {
      setError(
        "Una venta a crédito necesita el nombre del cliente para poder cobrarla.",
      );
      return;
    }
    // B3: NO se permite vender sin stock. Bloquear si algún PRODUCTO excede lo
    // disponible (los servicios no tienen stock). Antes solo se avisaba después.
    const sinStock = carrito.filter(
      (i) => i.tipo !== "servicio" && i.cantidad > i.stock_disponible,
    );
    if (sinStock.length > 0) {
      setError(
        `Sin stock suficiente: ${sinStock
          .map((i) => i.nombre ?? i.referencia ?? "producto")
          .join(", ")}. Ajusta las cantidades antes de vender.`,
      );
      return;
    }
    setError(null);
    setConfirmando(true);
    try {
      const { error: rpcErr } = await supabase.rpc("fn_registrar_venta", {
        p_sede_id: sedeVenta,
        p_cliente_nombre: clienteNombre || null,
        p_cliente_nit: clienteNit || null,
        p_metodo_pago: metodoPago,
        p_descuento_valor: descuento,
        p_domicilio: Math.max(0, domicilio),
        p_iva_pct: ivaPct,
        p_cuenta_bancaria:
          metodoPago === "Mixto" ? null : cuentaBancaria || null,
        p_pagos:
          metodoPago === "Mixto"
            ? [
                ...(Math.round(Number(pagoEfectivo) || 0) > 0
                  ? [
                      {
                        metodo_pago: "Efectivo",
                        monto: Math.round(Number(pagoEfectivo)),
                      },
                    ]
                  : []),
                ...(Math.round(Number(pagoTransfer) || 0) > 0
                  ? [
                      {
                        metodo_pago: "Transferencia",
                        monto: Math.round(Number(pagoTransfer)),
                        cuenta_bancaria: cuentaBancaria || null,
                      },
                    ]
                  : []),
              ]
            : null,
        p_observaciones: observaciones || null,
        p_items: carrito.map((i) =>
          i.tipo === "servicio"
            ? {
                servicio_id: i.servicio_id,
                cantidad: i.cantidad,
                precio_unitario: i.precio_unitario,
              }
            : {
                producto_id: i.producto_id,
                cantidad: i.cantidad,
                precio_unitario: i.precio_unitario,
              },
        ),
      });
      if (rpcErr) throw new Error(rpcErr.message);
      // Bloque 0 #2: guardar/reutilizar cliente para el autocompletado. NO toca
      // la venta (cliente_id se omite a propósito por RLS) y nunca rompe el flujo.
      if (clienteNombre.trim()) {
        await upsertCliente({
          nombre: clienteNombre,
          identificacion: clienteNit,
          telefono: clienteTelefono,
          email: clienteEmail,
          direccion: clienteDireccion,
        });
      }
      navigate("/ops/ventas");
    } catch (e) {
      setError(safeError(e, "Error al registrar la venta"));
    } finally {
      setConfirmando(false);
    }
  };

  return (
    <div className="px-4 pb-16 pt-5 sm:px-7 animate-fade-in">
      <button
        onClick={() => navigate("/ops/ventas")}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium transition-colors"
        style={{ color: "var(--n-500)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--n-700)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--n-500)")}
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver a Ventas
      </button>

      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <div
        className="mt-4 flex flex-wrap items-end justify-between gap-4 border-b pb-4"
        style={{ borderColor: "var(--n-150)" }}
      >
        <div>
          <h1
            className="m-0 text-[22px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--n-950)" }}
          >
            Nueva venta
          </h1>
          <p className="mt-1.5 text-[13px]" style={{ color: "var(--n-500)" }}>
            Vendedor ·{" "}
            <b
              className="font-mono font-medium"
              style={{ color: "var(--n-700)" }}
            >
              {perfil?.nombre ?? "—"}
            </b>{" "}
            · Sede{" "}
            <b
              className="font-mono font-medium"
              style={{ color: "var(--n-700)" }}
            >
              {perfil?.sede_id ?? "—"}
            </b>
          </p>
        </div>
        <button
          onClick={() => navigate("/ops/ventas")}
          className="btn btn-out"
          style={{ height: 48 }}
        >
          Cancelar
        </button>
      </div>

      {/* ── Stepper ─────────────────────────────────────────────────── */}
      <div className="stepper mt-5">
        <Step n={1} label="Cliente y productos" estado={pasoActivo} />
        <div className={`step-line ${pasoActivo > 1 ? "done" : ""}`} />
        <Step n={2} label="Pago" estado={pasoActivo} />
        <div className={`step-line ${pasoActivo > 2 ? "done" : ""}`} />
        <Step n={3} label="Confirmar" estado={pasoActivo} />
      </div>

      {/* ── Banner cliente recurrente (derivado real, solo si existe) ── */}
      {historialCliente && historialCliente.compras > 0 && (
        <div className="banner-info mt-4">
          <Star className="size-4 shrink-0" strokeWidth={2} />
          <div className="body">
            <b>{clienteNombre.trim()}</b> tiene{" "}
            <b>{historialCliente.compras}</b> compra
            {historialCliente.compras !== 1 ? "s" : ""} previa
            {historialCliente.compras !== 1 ? "s" : ""}
            {historialCliente.ultimaFecha && (
              <>
                . Última compra el{" "}
                <b>{formatDate(historialCliente.ultimaFecha)}</b> por{" "}
                <b>{formatCOP(historialCliente.ultimoTotal)}</b>
              </>
            )}
            .<sub>Cliente recurrente en esta sede</sub>
          </div>
        </div>
      )}

      {/* ── Grid ────────────────────────────────────────────────────── */}
      <div className="mt-4 grid items-start gap-5 lg:grid-cols-[1fr_340px]">
        {/* ── Columna principal ─────────────────────────────────────── */}
        <div className="iblock space-y-4">
          <div>
            <div
              className="font-mono text-[11px] uppercase tracking-[0.1em]"
              style={{ color: "var(--n-500)" }}
            >
              Datos del cliente
            </div>
            <h2
              className="mt-1 text-[17px] font-medium"
              style={{ color: "var(--n-950)" }}
            >
              Cliente y productos
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Cliente (opcional)" full>
              <ClientePicker
                value={clienteNombre}
                onChange={(v) => {
                  setClienteNombre(v);
                  buscarHistorialCliente(v);
                  // #S1-03: al editar el nombre a mano, si deja de coincidir con
                  // el cliente elegido, descartar sus datos de contacto ocultos.
                  if (v.trim() !== clienteSelNombre.trim()) {
                    setClienteTelefono("");
                    setClienteEmail("");
                    setClienteDireccion("");
                    setClienteSelNombre("");
                  }
                }}
                onSelect={(c) => {
                  setClienteNombre(c.nombre ?? "");
                  setClienteSelNombre(c.nombre ?? "");
                  buscarHistorialCliente(c.nombre ?? "");
                  if (c.identificacion) setClienteNit(c.identificacion);
                  setClienteTelefono(c.telefono ?? "");
                  setClienteEmail(c.email ?? "");
                  setClienteDireccion(c.direccion ?? "");
                }}
                placeholder="Buscar o escribir cliente…"
              />
            </Field>
            <Field label="NIT o Cédula">
              <input
                value={clienteNit}
                onChange={(e) => setClienteNit(e.target.value)}
                placeholder="NIT o Cédula"
                className="finput"
              />
            </Field>
            <Field label="Notas">
              <input
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Observaciones (opcional)"
                className="finput sans"
              />
            </Field>
          </div>

          <div className="h-px" style={{ backgroundColor: "var(--n-150)" }} />

          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em]"
            style={{ color: "var(--n-500)" }}
          >
            Productos a vender
          </div>

          {/* #11 — Sede a consultar (de qué almacén se ve el stock) */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div
              className="inline-flex h-10 items-center gap-2 rounded-[10px] border px-3"
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
                htmlFor="sede-venta"
                className="text-[12px]"
                style={{ color: "var(--n-500)" }}
              >
                Sede
              </label>
              <select
                id="sede-venta"
                value={sedeConsulta}
                onChange={(e) => onChangeSede(e.target.value)}
                className="cursor-pointer border-none bg-transparent text-[13px] font-medium outline-none"
                style={{ color: "var(--n-950)" }}
              >
                {SEDE_IDS.map((s) => (
                  <option key={s} value={s}>
                    {SEDE_LABELS[s] ?? s}
                  </option>
                ))}
              </select>
            </div>
            {consultandoOtraSede ? (
              <span
                className="inline-flex items-center gap-1.5 text-[11.5px]"
                style={{ color: "var(--warn-700)" }}
              >
                <AlertTriangle className="size-3.5" /> Solo consulta · vendes
                desde {sedeLabel(perfil?.sede_id)}
              </span>
            ) : !esVendedor ? (
              <span className="text-[11.5px]" style={{ color: "var(--n-500)" }}>
                La venta se registrará en {sedeLabel(sedeVenta)}
              </span>
            ) : null}
          </div>

          {/* Buscador de productos + QR */}
          <div className="flex items-stretch">
            <div
              className="flex h-12 flex-1 items-center gap-2.5 rounded-l-[10px] border border-r-0 px-3.5"
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
                value={busqueda}
                onChange={handleBusquedaChange}
                placeholder="Buscar nombre, referencia o escanea QR…"
                className="min-w-0 flex-1 border-none bg-transparent text-[14px] outline-none"
                style={{ color: "var(--n-950)" }}
              />
            </div>
            <button
              onClick={() => setScannerOpen(true)}
              className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-l-none rounded-r-[10px] px-4 text-white"
              style={{ backgroundColor: "var(--p-600)" }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = "var(--p-700)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "var(--p-600)")
              }
              aria-label="Escanear QR"
            >
              <ScanLine className="h-4 w-4" strokeWidth={1.7} />
              <span className="hidden sm:inline">Escanear QR</span>
            </button>
          </div>

          {/* B3 — Agregar un servicio (catálogo que solo crea el Admin). El
              servicio no depende de sede ni stock; su precio es editable por
              línea, igual que un producto. */}
          {servicios.length > 0 && (
            <div className="flex flex-wrap items-center gap-2.5">
              <label
                htmlFor="serv-add"
                className="inline-flex items-center gap-1.5 text-[12px]"
                style={{ color: "var(--n-500)" }}
              >
                <Wrench className="h-3.5 w-3.5" strokeWidth={1.7} />
                Servicio
              </label>
              <select
                id="serv-add"
                value=""
                onChange={(e) => {
                  const s = servicios.find(
                    (x) => String(x.id) === e.target.value,
                  );
                  if (s) agregarServicioAlCarrito(s);
                }}
                className="h-10 min-w-[220px] cursor-pointer rounded-[10px] border bg-transparent px-3 text-[13px] font-medium outline-none"
                style={{ borderColor: "var(--n-200)", color: "var(--n-950)" }}
              >
                <option value="">Agregar un servicio…</option>
                {servicios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre} · {formatCOP(s.precio)}
                  </option>
                ))}
              </select>
            </div>
          )}

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
                    borderTop: idx === 0 ? "none" : "1px solid var(--n-100)",
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
                      <UbicacionChip codigo={r.ubicacion_id} conMapa />
                    </p>
                    <p
                      className="font-mono text-[11px]"
                      style={{ color: "var(--n-500)" }}
                    >
                      {r.referencia} ·{" "}
                      {r.stock_disponible > 0 ? (
                        <>Stock: {r.stock_disponible}</>
                      ) : (
                        <span
                          className="font-semibold"
                          style={{ color: "var(--warn-700)" }}
                        >
                          Sin stock
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className="font-mono text-sm font-semibold"
                      style={{ color: "var(--n-950)" }}
                    >
                      {formatCOP(r.precio_venta)}
                    </p>
                    <p className="text-xs" style={{ color: "var(--n-500)" }}>
                      {r.unidad_medida}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* #S1-24: sin resultados — antes la pantalla no decía nada y el
              usuario no sabía si estaba buscando, escribió mal o no existe. */}
          {!buscando &&
            busqueda.trim().length >= 2 &&
            resultados.length === 0 && (
              <div
                className="rounded-lg border border-dashed px-4 py-6 text-center text-sm"
                style={{ borderColor: "var(--n-200)", color: "var(--n-500)" }}
              >
                No se encontraron productos para “{busqueda.trim()}”. Prueba con
                otra palabra o la referencia.
              </div>
            )}

          {/* Tabla de productos del carrito (estilo Lovable prod-tbl) */}
          {carrito.length === 0 ? (
            <div
              className="rounded-[10px] border border-dashed px-4 py-10 text-center text-sm"
              style={{ borderColor: "var(--n-200)", color: "var(--n-500)" }}
            >
              Busca o escanea productos para agregarlos a la venta
            </div>
          ) : (
            <div
              className="overflow-hidden rounded-[10px] border"
              style={{ borderColor: "var(--n-150)" }}
            >
              <table className="prod-tbl">
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>Ref.</th>
                    <th>Producto</th>
                    <th className="r" style={{ width: 132 }}>
                      Cant
                    </th>
                    <th className="r" style={{ width: 110 }}>
                      Unit
                    </th>
                    <th className="r" style={{ width: 120 }}>
                      Subtotal
                    </th>
                    <th style={{ width: 42 }} />
                  </tr>
                </thead>
                <tbody>
                  {carrito.map((item) => {
                    const key = lineKey(item);
                    const esServicio = item.tipo === "servicio";
                    // #12: los productos no topan por stock; avisamos si está
                    // sin stock o si excede (quedará negativo). Servicios: nunca.
                    const sinStock = !esServicio && item.stock_disponible <= 0;
                    const excede =
                      !esServicio && item.cantidad > item.stock_disponible;
                    const aviso = sinStock || excede;
                    return (
                      <tr key={key}>
                        <td>
                          {esServicio ? (
                            <>
                              <span
                                className="p-sku"
                                style={{ color: "var(--p-600)" }}
                              >
                                Servicio
                              </span>
                              <div className="p-meta">—</div>
                            </>
                          ) : (
                            <>
                              <span className="p-sku">
                                {item.referencia ?? "—"}
                              </span>
                              <div className="p-meta">{item.unidad ?? ""}</div>
                            </>
                          )}
                        </td>
                        <td>
                          <div className="p-nm">{item.nombre}</div>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <QtyControl
                            value={item.cantidad}
                            danger={aviso}
                            onDec={() => actualizarCantidad(key, -1)}
                            onInc={() => actualizarCantidad(key, 1)}
                            onSet={(v) => setCantidadDirecta(key, v)}
                            incDisabled={false}
                          />
                          {aviso && (
                            <div
                              className="mt-1 inline-flex items-center gap-1 font-mono text-[10.5px]"
                              style={{ color: "var(--warn-700)" }}
                            >
                              <AlertTriangle className="size-3" />
                              {sinStock
                                ? "Sin stock en esta sede"
                                : `Excede stock (${item.stock_disponible} disp.)`}
                            </div>
                          )}
                        </td>
                        <td className="p-pr">
                          <PriceInput
                            value={item.precio_unitario}
                            onSet={(v) => setPrecioDirecto(key, v)}
                          />
                        </td>
                        <td className="p-sub">
                          {formatCOP(item.cantidad * item.precio_unitario)}
                        </td>
                        <td>
                          <button
                            onClick={() => eliminarItem(key)}
                            className="flex size-7 items-center justify-center rounded-md transition-colors"
                            style={{ color: "var(--n-500)" }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.color = "var(--dang-600)")
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.color = "var(--n-500)")
                            }
                            aria-label="Eliminar línea"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pago — método y descuento */}
          <div className="h-px" style={{ backgroundColor: "var(--n-150)" }} />
          <div
            className="font-mono text-[11px] uppercase tracking-[0.1em]"
            style={{ color: "var(--n-500)" }}
          >
            Pago
          </div>
          <div className="flex flex-wrap gap-2">
            {METODOS_PAGO.map((m) => {
              const on = metodoPago === m;
              return (
                <button
                  key={m}
                  onClick={() => {
                    setMetodoPago(m);
                    // B3: en Efectivo/Crédito no hay cuenta destino.
                    if (m === "Efectivo" || m === "Crédito")
                      setCuentaBancaria("");
                  }}
                  className={`pay-pill ${metodoPagoClass(m)}`}
                  style={{
                    minHeight: 36,
                    cursor: "pointer",
                    opacity: on ? 1 : 0.55,
                    outline: on
                      ? "2px solid var(--p-400)"
                      : "1px solid transparent",
                    outlineOffset: on ? 1 : 0,
                  }}
                >
                  <span className="dot" />
                  {m}
                </button>
              );
            })}
          </div>

          {/* #13 / B1 / B3 — Cuenta destino del pago. Solo se muestra para pagos
              electrónicos (Transferencia/Tarjeta); en Efectivo/Crédito se oculta. */}
          {(metodoPago === "Transferencia" || metodoPago === "Tarjeta") && (
            <div className="flex flex-wrap items-center gap-2.5">
              <label
                htmlFor="cuenta-banc"
                className="text-sm"
                style={{ color: "var(--n-500)" }}
              >
                Cuenta bancaria
                {(metodoPago === "Transferencia" ||
                  metodoPago === "Tarjeta") && (
                  <span style={{ color: "var(--dang-700)" }}> *</span>
                )}
              </label>
              <select
                id="cuenta-banc"
                value={cuentaBancaria}
                onChange={(e) => setCuentaBancaria(e.target.value)}
                className="h-10 cursor-pointer rounded-[10px] border bg-transparent px-3 text-[13px] font-medium outline-none"
                style={{ borderColor: "var(--n-200)", color: "var(--n-950)" }}
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
              {(metodoPago === "Transferencia" || metodoPago === "Tarjeta") &&
                !cuentaBancaria && (
                  <span
                    className="text-[11.5px]"
                    style={{ color: "var(--dang-700)" }}
                  >
                    {cuentasBanco.length === 0
                      ? "No hay cuentas activas. El Admin debe crearlas en Configuración."
                      : "Obligatorio: indica a qué cuenta entró el pago"}
                  </span>
                )}
            </div>
          )}

          {/* Pago mixto (#2): efectivo + transferencia sobre una sola factura. */}
          {metodoPago === "Mixto" && (
            <div
              className="space-y-2.5 rounded-[10px] border p-3"
              style={{
                borderColor: "var(--n-200)",
                backgroundColor: "var(--n-50)",
              }}
            >
              <div className="flex flex-wrap items-center gap-2.5">
                <label className="text-sm" style={{ color: "var(--n-500)" }}>
                  Efectivo $
                </label>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  value={pagoEfectivo}
                  onChange={(e) => setPagoEfectivo(e.target.value)}
                  className="h-10 w-32 rounded-[10px] border bg-transparent px-3 text-[13px] font-medium outline-none"
                  style={{ borderColor: "var(--n-200)", color: "var(--n-950)" }}
                />
                <label className="text-sm" style={{ color: "var(--n-500)" }}>
                  Transferencia $
                </label>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  value={pagoTransfer}
                  onChange={(e) => setPagoTransfer(e.target.value)}
                  className="h-10 w-32 rounded-[10px] border bg-transparent px-3 text-[13px] font-medium outline-none"
                  style={{ borderColor: "var(--n-200)", color: "var(--n-950)" }}
                />
                <button
                  type="button"
                  onClick={() =>
                    setPagoTransfer(
                      String(
                        Math.max(
                          0,
                          totalRedondeado -
                            Math.round(Number(pagoEfectivo) || 0),
                        ),
                      ),
                    )
                  }
                  className="h-9 rounded-[10px] border px-3 text-[12px] font-medium"
                  style={{ borderColor: "var(--n-200)", color: "var(--n-700)" }}
                >
                  Resto a transferencia
                </button>
              </div>
              {Math.round(Number(pagoTransfer) || 0) > 0 && (
                <div className="flex flex-wrap items-center gap-2.5">
                  <label className="text-sm" style={{ color: "var(--n-500)" }}>
                    Cuenta de la transferencia
                    <span style={{ color: "var(--dang-700)" }}> *</span>
                  </label>
                  <select
                    value={cuentaBancaria}
                    onChange={(e) => setCuentaBancaria(e.target.value)}
                    className="h-10 cursor-pointer rounded-[10px] border bg-transparent px-3 text-[13px] font-medium outline-none"
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
              <div
                className="flex items-center justify-between text-[12.5px] font-medium"
                style={{
                  color: mixtoCuadra ? "var(--succ-700)" : "var(--dang-700)",
                }}
              >
                <span>
                  Suma: {formatCOP(sumaMixto)} / Total:{" "}
                  {formatCOP(totalRedondeado)}
                </span>
                <span>
                  {mixtoCuadra
                    ? "✓ Cuadra"
                    : `Falta ${formatCOP(Math.abs(totalRedondeado - sumaMixto))}`}
                </span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm" style={{ color: "var(--n-500)" }}>
              Descuento $
            </label>
            <input
              type="number"
              min="0"
              step="1000"
              value={descuentoValor}
              onChange={(e) =>
                setDescuentoValor(Math.max(0, Number(e.target.value) || 0))
              }
              className="finput"
              style={{ width: 120, textAlign: "center" }}
              aria-label="Descuento en pesos"
            />
            <label className="text-sm" style={{ color: "var(--n-500)" }}>
              Domicilio $
            </label>
            <input
              type="number"
              min="0"
              step="1000"
              value={domicilio}
              onChange={(e) =>
                setDomicilio(Math.max(0, Number(e.target.value) || 0))
              }
              className="finput"
              style={{ width: 120, textAlign: "center" }}
              aria-label="Valor del domicilio"
            />
          </div>

          {/* #9 — IVA por venta: exento (0%), estándar (19%) o editable */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm" style={{ color: "var(--n-500)" }}>
              IVA
            </label>
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
                setIvaPct(Math.min(100, Math.max(0, Number(e.target.value))))
              }
              className="finput"
              style={{ width: 80, textAlign: "center" }}
              aria-label="IVA porcentaje"
            />
          </div>

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

        {/* ── Resumen (cart sticky) ─────────────────────────────────── */}
        <aside className="cart">
          <span className="cart-eyebrow">Resumen</span>
          <div className="text-[12px]" style={{ color: "var(--n-500)" }}>
            {carrito.length} ítem{carrito.length !== 1 ? "s" : ""}
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
          {domicilio > 0 && (
            <div className="cart-line">
              <span>Domicilio</span>
              <span className="v">{formatCOP(domicilio)}</span>
            </div>
          )}
          <div className="cart-line tot">
            <span>Total</span>
            <span className="v">{formatCOP(total)}</span>
          </div>
          <button
            onClick={confirmarVenta}
            disabled={carrito.length === 0 || confirmando || !mixtoCuadra}
            className="btn btn-pri mt-1 w-full justify-center disabled:opacity-40"
            style={{ height: 48 }}
          >
            {confirmando ? (
              "Registrando…"
            ) : (
              <>
                Confirmar venta <ChevronRight className="size-3.5" />
              </>
            )}
          </button>
          {/* #S1-27: explicar junto al botón por qué está deshabilitado cuando
              el pago mixto no cuadra (antes el aviso quedaba lejos, arriba). */}
          {metodoPago === "Mixto" && !mixtoCuadra && carrito.length > 0 && (
            <p
              className="mt-2 text-center text-[12px]"
              style={{ color: "var(--dang-700)" }}
            >
              Falta {formatCOP(Math.abs(totalRedondeado - sumaMixto))} para
              completar el pago mixto.
            </p>
          )}
        </aside>
      </div>

      {scannerOpen && (
        <QRScanner
          onFound={handleQRFound}
          onClose={() => setScannerOpen(false)}
        />
      )}

      {bloqueoSede && (
        <SedeBloqueoModal
          sedePropia={sedeLabel(perfil?.sede_id)}
          onClose={() => setBloqueoSede(false)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function Step({ n, label, estado }) {
  const cls = estado > n ? "done" : estado === n ? "active" : "todo";
  return (
    <div className={`step ${cls}`}>
      <div className="step-dot">{n}</div>
      <div className="step-lbl">{label}</div>
    </div>
  );
}

function Field({ label, full, children }) {
  return (
    <div className={`flex flex-col gap-1.5 ${full ? "sm:col-span-2" : ""}`}>
      <label
        className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--n-500)" }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

// #11 — popup cuando el vendedor intenta agregar un producto de otra sede.
// Usa los tokens del sistema de diseño (mismo esquema que ConfirmDialog).
function SedeBloqueoModal({ sedePropia, onClose }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-t-2xl p-5 sm:max-w-md sm:rounded-2xl"
        style={{ backgroundColor: "hsl(var(--card))" }}
        role="alertdialog"
        aria-labelledby="sede-bloqueo-title"
      >
        <h2
          id="sede-bloqueo-title"
          className="mb-2 text-lg font-semibold"
          style={{ color: "hsl(var(--foreground))" }}
        >
          No puedes vender desde otra sede
        </h2>
        <p
          className="mb-4 text-sm"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Este producto no está en tu sede ({sedePropia}). Búscalo en tu sede;
          si no hay stock, pide un traspaso.
        </p>
        <button
          onClick={onClose}
          autoFocus
          className="h-12 w-full rounded-lg text-sm font-medium"
          style={{
            backgroundColor: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
          }}
        >
          Entendido
        </button>
      </div>
    </div>
  );
}

function QtyControl({ value, danger, onDec, onInc, onSet, max, incDisabled }) {
  return (
    <div
      className="inline-flex h-12 items-center overflow-hidden rounded-md border"
      style={
        danger
          ? {
              borderColor: "var(--dang-border)",
              backgroundColor: "var(--dang-50)",
            }
          : { borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }
      }
    >
      <button
        onClick={onDec}
        className="grid h-full w-11 place-items-center transition-colors"
        style={{ color: "var(--n-700)" }}
        aria-label="Disminuir cantidad"
      >
        <Minus className="size-3.5" />
      </button>
      <input
        type="number"
        min="1"
        max={max}
        value={value}
        onChange={(e) => onSet(e.target.value)}
        className="w-12 border-0 bg-transparent text-center font-mono text-[13px] font-medium outline-none"
        style={{ color: danger ? "var(--dang-700)" : "var(--n-950)" }}
      />
      <button
        onClick={onInc}
        disabled={incDisabled}
        className="grid h-full w-11 place-items-center transition-colors disabled:opacity-40"
        style={{ color: "var(--n-700)" }}
        aria-label="Aumentar cantidad"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

// #9 — precio de venta editable por línea. Muestra el entero (COP sin
// decimales); el subtotal de la fila ya se muestra formateado al lado.
function PriceInput({ value, onSet }) {
  return (
    <div
      className="inline-flex h-12 items-center overflow-hidden rounded-md border"
      style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
    >
      <span
        className="pl-2 font-mono text-[12px]"
        style={{ color: "var(--n-500)" }}
      >
        $
      </span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onSet(e.target.value)}
        className="w-[92px] border-0 bg-transparent px-1.5 text-right font-mono text-[13px] font-medium outline-none"
        style={{ color: "var(--n-950)" }}
        aria-label="Precio unitario"
      />
    </div>
  );
}
