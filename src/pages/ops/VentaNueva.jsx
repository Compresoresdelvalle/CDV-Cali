import { useState, useCallback, useMemo, useEffect } from "react";
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
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import { applyKeywordSearch } from "../../lib/search";
import QRScanner from "../../components/forms/QRScanner";
import ClientePicker from "../../components/forms/ClientePicker";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import { metodoPagoClass } from "../../lib/ventas-ui";
import { SEDE_LABELS, sedeLabel } from "../../lib/traspasos-ui";
import { SEDES } from "../../lib/constants";
import { upsertCliente } from "../../lib/clientes";

const METODOS_PAGO = ["Efectivo", "Transferencia", "Tarjeta", "Crédito"];
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
  const [metodoPago, setMetodoPago] = useState("Efectivo");
  const [cuentaBancaria, setCuentaBancaria] = useState(""); // #13
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
  const [descuentoPct, setDescuentoPct] = useState(0);
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
  // #10 — cuántos ítems quedaron en negativo tras la venta (0 = ninguno).
  const [negativoInfo, setNegativoInfo] = useState(0);
  // La venta SALE de: Admin → la sede elegida; Vendedor → siempre su sede.
  const sedeVenta = esVendedor ? perfil?.sede_id : sedeConsulta;
  // El vendedor está mirando una sede que NO es la suya (solo consulta).
  const consultandoOtraSede = esVendedor && sedeConsulta !== perfil?.sede_id;

  const buscarProductos = useCallback(
    async (q) => {
      if (!q || q.trim().length < 2 || !sedeConsulta) {
        setResultados([]);
        return;
      }
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
          .select("producto_id, cantidad")
          .eq("sede_id", sedeConsulta)
          .in("producto_id", ids);
        if (e2) throw e2;

        const stockMap = Object.fromEntries(
          (inv ?? []).map((i) => [i.producto_id, i.cantidad]),
        );
        const merged = prods.map((p) => ({
          ...p,
          stock_disponible: stockMap[p.id] ?? 0,
        }));

        setResultados(merged.slice(0, 8));
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
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
        if (!prod) return;
        agregarAlCarrito({ ...prod, stock_disponible: inv?.cantidad ?? 0 });
      } catch {
        // silently ignore
      }
    },
    [sedeConsulta],
  );

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
      const idx = prev.findIndex((i) => i.producto_id === prod.id);
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

  const actualizarCantidad = (productoId, delta) => {
    // #12: sin tope por stock (la venta puede exceder el disponible → negativo).
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
    setCarrito((prev) =>
      prev
        .map((i) => {
          if (i.producto_id !== productoId) return i;
          return { ...i, cantidad: Math.max(0, n) };
        })
        .filter((i) => i.cantidad > 0),
    );
  };

  // #9: editar el precio de venta por línea. Solo dígitos; vacío = 0.
  const setPrecioDirecto = (productoId, valor) => {
    const limpio = String(valor).replace(/[^\d]/g, "");
    const n = limpio === "" ? 0 : Number(limpio);
    if (isNaN(n) || n < 0) return;
    setCarrito((prev) =>
      prev.map((i) =>
        i.producto_id === productoId ? { ...i, precio_unitario: n } : i,
      ),
    );
  };

  const eliminarItem = (productoId) => {
    setCarrito((prev) => prev.filter((i) => i.producto_id !== productoId));
  };

  // #11: cambiar la sede a consultar. Limpia la búsqueda; si el Admin cambia la
  // sede de la venta, vacía el carrito (la venta es de una sola sede).
  const onChangeSede = (nuevaSede) => {
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
  const descuento = subtotal * (descuentoPct / 100);
  const baseIva = subtotal - descuento;
  const iva = baseIva * (ivaPct / 100);
  const total = subtotal * (1 - descuentoPct / 100) * (1 + ivaPct / 100);

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
    // B3: NO se permite vender sin stock. Bloquear si algún ítem excede lo
    // disponible (antes solo se avisaba después de la venta).
    const sinStock = carrito.filter((i) => i.cantidad > i.stock_disponible);
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
    // Tras el bloqueo de arriba esto es 0; se conserva como red de seguridad.
    const negativos = sinStock.length;
    try {
      const { error: rpcErr } = await supabase.rpc("fn_registrar_venta", {
        p_sede_id: sedeVenta,
        p_cliente_nombre: clienteNombre || null,
        p_cliente_nit: clienteNit || null,
        p_metodo_pago: metodoPago,
        p_descuento_pct: descuentoPct,
        p_iva_pct: ivaPct,
        p_cuenta_bancaria: cuentaBancaria || null,
        p_observaciones: observaciones || null,
        p_items: carrito.map((i) => ({
          producto_id: i.producto_id,
          cantidad: i.cantidad,
          precio_unitario: i.precio_unitario,
        })),
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
      // #10: si la venta dejó inventario negativo, avisar (urgente) antes de
      // salir; el modal navega al cerrar. Si no, navegar directo.
      if (negativos > 0) {
        setNegativoInfo(negativos);
      } else {
        navigate("/ops/ventas");
      }
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
                }}
                onSelect={(c) => {
                  setClienteNombre(c.nombre ?? "");
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
                      className="text-sm font-medium"
                      style={{ color: "var(--n-950)" }}
                    >
                      {r.nombre}
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
                    // #12: ya no topamos por stock. Avisamos si está sin stock
                    // o si la cantidad excede el disponible (quedará negativo).
                    const sinStock = item.stock_disponible <= 0;
                    const excede = item.cantidad > item.stock_disponible;
                    const aviso = sinStock || excede;
                    return (
                      <tr key={item.producto_id}>
                        <td>
                          <span className="p-sku">
                            {item.referencia ?? "—"}
                          </span>
                          <div className="p-meta">{item.unidad ?? ""}</div>
                        </td>
                        <td>
                          <div className="p-nm">{item.nombre}</div>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <QtyControl
                            value={item.cantidad}
                            danger={aviso}
                            onDec={() =>
                              actualizarCantidad(item.producto_id, -1)
                            }
                            onInc={() =>
                              actualizarCantidad(item.producto_id, 1)
                            }
                            onSet={(v) =>
                              setCantidadDirecta(item.producto_id, v)
                            }
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
                            onSet={(v) => setPrecioDirecto(item.producto_id, v)}
                          />
                        </td>
                        <td className="p-sub">
                          {formatCOP(item.cantidad * item.precio_unitario)}
                        </td>
                        <td>
                          <button
                            onClick={() => eliminarItem(item.producto_id)}
                            className="flex size-7 items-center justify-center rounded-md transition-colors"
                            style={{ color: "var(--n-500)" }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.color = "var(--dang-600)")
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.color = "var(--n-500)")
                            }
                            aria-label="Eliminar producto"
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

          <div className="flex items-center gap-3">
            <label className="text-sm" style={{ color: "var(--n-500)" }}>
              Descuento %
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={descuentoPct}
              onChange={(e) =>
                setDescuentoPct(
                  Math.min(100, Math.max(0, Number(e.target.value))),
                )
              }
              className="finput"
              style={{ width: 80, textAlign: "center" }}
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
            {carrito.length} producto{carrito.length !== 1 ? "s" : ""}
          </div>
          <div className="cart-line">
            <span>Subtotal</span>
            <span className="v">{formatCOP(subtotal)}</span>
          </div>
          {descuentoPct > 0 && (
            <div className="cart-line" style={{ color: "var(--warn-700)" }}>
              <span>Descuento ({descuentoPct}%)</span>
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
            <span>Total</span>
            <span className="v">{formatCOP(total)}</span>
          </div>
          <button
            onClick={confirmarVenta}
            disabled={carrito.length === 0 || confirmando}
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

      {negativoInfo > 0 && (
        <NegativoModal
          count={negativoInfo}
          onClose={() => navigate("/ops/ventas")}
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

// #10 — aviso urgente cuando la venta dejó inventario negativo.
function NegativoModal({ count, onClose }) {
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
        aria-labelledby="negativo-title"
      >
        <div className="mb-2 flex items-center gap-2">
          <AlertTriangle
            className="size-5 shrink-0"
            style={{ color: "hsl(var(--warning, var(--destructive)))" }}
          />
          <h2
            id="negativo-title"
            className="text-lg font-semibold"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Venta registrada · inventario negativo
          </h2>
        </div>
        <p
          className="mb-4 text-sm"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {count} producto{count !== 1 ? "s" : ""} quedó
          {count !== 1 ? "ron" : ""} con stock negativo en esta sede.
          Regularízalo cuanto antes con un <b>traspaso</b> o una <b>compra</b>.
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
      className="inline-flex h-9 items-center overflow-hidden rounded-md border"
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
        className="grid h-full w-8 place-items-center transition-colors"
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
        className="w-10 border-0 bg-transparent text-center font-mono text-[13px] font-medium outline-none"
        style={{ color: danger ? "var(--dang-700)" : "var(--n-950)" }}
      />
      <button
        onClick={onInc}
        disabled={incDisabled}
        className="grid h-full w-8 place-items-center transition-colors disabled:opacity-40"
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
      className="inline-flex h-9 items-center overflow-hidden rounded-md border"
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
