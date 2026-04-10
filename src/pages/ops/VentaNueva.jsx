import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP } from "../../lib/utils";
import QRScanner from "../../components/forms/QRScanner";

const METODOS_PAGO = ["Efectivo", "Transferencia", "Tarjeta", "Crédito"];

function useDebounce(fn, delay) {
  const timer = useRef(null);
  return useCallback(
    (...args) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => fn(...args), delay);
    },
    [fn, delay],
  );
}

export default function VentaNueva() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  // Búsqueda
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  // Carrito
  const [carrito, setCarrito] = useState([]);

  // Datos cliente y pago
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteNit, setClienteNit] = useState("");
  const [metodoPago, setMetodoPago] = useState("Efectivo");
  const [descuentoPct, setDescuentoPct] = useState(0);
  const [observaciones, setObservaciones] = useState("");

  // UI state
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState(null);

  // -----------------------------------------------------------
  // Búsqueda de productos
  // -----------------------------------------------------------
  const buscarProductos = useCallback(
    async (q) => {
      if (!q || q.trim().length < 2) {
        setResultados([]);
        return;
      }
      setBuscando(true);
      try {
        // Paso 1: buscar productos por nombre/referencia
        const { data: prods, error: e1 } = await supabase
          .from("productos")
          .select("id, nombre, referencia, precio_venta, unidad_medida")
          .eq("activo", true)
          .or(`nombre.ilike.%${q}%,referencia.ilike.%${q}%`)
          .limit(10);
        if (e1) throw e1;
        if (!prods?.length) {
          setResultados([]);
          return;
        }

        // Paso 2: verificar stock en la sede del usuario
        const ids = prods.map((p) => p.id);
        const { data: inv, error: e2 } = await supabase
          .from("inventario")
          .select("producto_id, cantidad")
          .eq("sede_id", perfil.sede_id)
          .gt("cantidad", 0)
          .in("producto_id", ids);
        if (e2) throw e2;

        const stockMap = Object.fromEntries(
          (inv ?? []).map((i) => [i.producto_id, i.cantidad]),
        );
        const merged = prods
          .filter((p) => stockMap[p.id] !== undefined)
          .map((p) => ({ ...p, stock_disponible: stockMap[p.id] }));

        setResultados(merged.slice(0, 8));
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    },
    [perfil.sede_id],
  );

  const buscarDebounced = useDebounce(buscarProductos, 300);

  const handleBusquedaChange = (e) => {
    const val = e.target.value;
    setBusqueda(val);
    buscarDebounced(val);
  };

  // QR scanner: producto_id viene resuelto desde QRScanner
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
            .single(),
          supabase
            .from("inventario")
            .select("cantidad")
            .eq("sede_id", perfil.sede_id)
            .eq("producto_id", productoId)
            .single(),
        ]);
        if (!prod || !inv || inv.cantidad <= 0) return;
        agregarAlCarrito({ ...prod, stock_disponible: inv.cantidad });
      } catch {
        // silently ignore
      }
    },
    [perfil.sede_id],
  );

  // -----------------------------------------------------------
  // Carrito
  // -----------------------------------------------------------
  const agregarAlCarrito = (prod) => {
    setBusqueda("");
    setResultados([]);

    setCarrito((prev) => {
      const idx = prev.findIndex((i) => i.producto_id === prod.id);
      if (idx >= 0) {
        const updated = [...prev];
        const item = { ...updated[idx] };
        if (item.cantidad < prod.stock_disponible) {
          item.cantidad += 1;
        }
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
    setCarrito((prev) =>
      prev
        .map((i) => {
          if (i.producto_id !== productoId) return i;
          const nueva = Math.max(
            0,
            Math.min(i.cantidad + delta, i.stock_disponible),
          );
          return { ...i, cantidad: nueva };
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
          return {
            ...i,
            cantidad: Math.max(0, Math.min(n, i.stock_disponible)),
          };
        })
        .filter((i) => i.cantidad > 0),
    );
  };

  const eliminarItem = (productoId) => {
    setCarrito((prev) => prev.filter((i) => i.producto_id !== productoId));
  };

  // -----------------------------------------------------------
  // Totales
  // -----------------------------------------------------------
  const subtotal = carrito.reduce(
    (s, i) => s + i.cantidad * i.precio_unitario,
    0,
  );
  const descuento = subtotal * (descuentoPct / 100);
  const baseIva = subtotal - descuento;
  const iva = baseIva * 0.19;
  const total = baseIva + iva;

  // -----------------------------------------------------------
  // Confirmar venta
  // -----------------------------------------------------------
  const confirmarVenta = async () => {
    if (carrito.length === 0) return;
    setError(null);
    setConfirmando(true);

    try {
      // Pre-validar stock antes de insertar
      for (const item of carrito) {
        const { data: inv } = await supabase
          .from("inventario")
          .select("cantidad")
          .eq("producto_id", item.producto_id)
          .eq("sede_id", perfil.sede_id)
          .single();
        if (!inv || inv.cantidad < item.cantidad) {
          throw new Error(`Stock insuficiente para: ${item.nombre}`);
        }
      }

      // Insertar cabecera de venta
      const { data: venta, error: e1 } = await supabase
        .from("ventas")
        .insert({
          vendedor_id: perfil.id,
          sede_id: perfil.sede_id,
          cliente_nombre: clienteNombre || null,
          cliente_nit: clienteNit || null,
          metodo_pago: metodoPago,
          descuento_pct: descuentoPct,
          iva_pct: 19,
          observaciones: observaciones || null,
          subtotal: 0,
          total: 0,
        })
        .select("id, numero")
        .single();
      if (e1) throw new Error(e1.message);

      // Insertar ítems — el trigger trg_venta_descontar_stock descuenta stock
      // y trg_recalcular_venta recalcula los totales automáticamente
      const detalles = carrito.map((i) => ({
        venta_id: venta.id,
        producto_id: i.producto_id,
        cantidad: i.cantidad,
        precio_unitario: i.precio_unitario,
        costo_unitario: 0,
        subtotal: i.cantidad * i.precio_unitario,
      }));

      const { error: e2 } = await supabase
        .from("detalle_venta")
        .insert(detalles);
      if (e2) throw new Error(e2.message);

      navigate("/ops/ventas");
    } catch (e) {
      setError(e.message ?? "Error al registrar la venta");
    } finally {
      setConfirmando(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F4F1EB" }}>
      {/* Header */}
      <div
        className="sticky top-0 z-10 px-4 py-4 shadow-sm"
        style={{ backgroundColor: "#14352A" }}
      >
        <div className="flex items-center gap-3 max-w-2xl mx-auto">
          <button
            onClick={() => navigate("/ops/ventas")}
            className="text-white/70 hover:text-white transition-colors"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <h1 className="text-white font-semibold text-lg flex-1">
            Nueva Venta
          </h1>
          <span className="text-white/60 text-sm">{perfil.sede_id}</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Búsqueda de productos */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 border-b" style={{ borderColor: "#E2DED5" }}>
            <p
              className="text-xs font-semibold uppercase tracking-wide mb-3"
              style={{ color: "#9CA3AB" }}
            >
              Agregar productos
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                  style={{ color: "#9CA3AB" }}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  type="text"
                  value={busqueda}
                  onChange={handleBusquedaChange}
                  placeholder="Nombre o referencia..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm border focus:outline-none focus:ring-2"
                  style={{ borderColor: "#E2DED5", focusRingColor: "#14352A" }}
                />
              </div>
              <button
                onClick={() => setScannerOpen(true)}
                className="flex items-center justify-center w-11 h-11 rounded-xl text-white flex-shrink-0"
                style={{ backgroundColor: "#14352A" }}
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
                  />
                </svg>
              </button>
            </div>

            {/* Resultados de búsqueda */}
            {buscando && (
              <p className="text-xs mt-2" style={{ color: "#9CA3AB" }}>
                Buscando...
              </p>
            )}
            {resultados.length > 0 && (
              <div
                className="mt-2 border rounded-xl overflow-hidden"
                style={{ borderColor: "#E2DED5" }}
              >
                {resultados.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => agregarAlCarrito(r)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-left border-b last:border-b-0 transition-colors"
                    style={{ borderColor: "#E2DED5" }}
                  >
                    <div>
                      <p
                        className="text-sm font-medium"
                        style={{ color: "#151515" }}
                      >
                        {r.nombre}
                      </p>
                      <p className="text-xs" style={{ color: "#9CA3AB" }}>
                        {r.referencia} · Stock: {r.stock_disponible}
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className="text-sm font-semibold"
                        style={{ color: "#14352A" }}
                      >
                        {formatCOP(r.precio_venta)}
                      </p>
                      <p className="text-xs" style={{ color: "#9CA3AB" }}>
                        {r.unidad_medida}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Ítems del carrito */}
          {carrito.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <svg
                className="w-10 h-10 mx-auto mb-2"
                style={{ color: "#E2DED5" }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              <p className="text-sm" style={{ color: "#9CA3AB" }}>
                Agrega productos al carrito
              </p>
            </div>
          ) : (
            <div>
              {carrito.map((item) => (
                <div
                  key={item.producto_id}
                  className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0"
                  style={{ borderColor: "#E2DED5" }}
                >
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm font-medium truncate"
                      style={{ color: "#151515" }}
                    >
                      {item.nombre}
                    </p>
                    <p className="text-xs" style={{ color: "#9CA3AB" }}>
                      {formatCOP(item.precio_unitario)} c/u
                    </p>
                  </div>
                  {/* Controles de cantidad */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => actualizarCantidad(item.producto_id, -1)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-lg border transition-colors"
                      style={{ borderColor: "#E2DED5", color: "#636B74" }}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min="1"
                      max={item.stock_disponible}
                      value={item.cantidad}
                      onChange={(e) =>
                        setCantidadDirecta(item.producto_id, e.target.value)
                      }
                      className="w-12 text-center text-sm font-semibold border rounded-lg py-1 focus:outline-none"
                      style={{ borderColor: "#E2DED5", color: "#151515" }}
                    />
                    <button
                      onClick={() => actualizarCantidad(item.producto_id, 1)}
                      disabled={item.cantidad >= item.stock_disponible}
                      className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-lg border transition-colors disabled:opacity-40"
                      style={{ borderColor: "#E2DED5", color: "#636B74" }}
                    >
                      +
                    </button>
                  </div>
                  <div className="text-right w-20">
                    <p
                      className="text-sm font-semibold"
                      style={{ color: "#14352A" }}
                    >
                      {formatCOP(item.cantidad * item.precio_unitario)}
                    </p>
                  </div>
                  <button
                    onClick={() => eliminarItem(item.producto_id)}
                    className="text-red-400 hover:text-red-600 transition-colors"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Datos del cliente */}
        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "#9CA3AB" }}
          >
            Cliente (opcional)
          </p>
          <input
            type="text"
            value={clienteNombre}
            onChange={(e) => setClienteNombre(e.target.value)}
            placeholder="Nombre del cliente"
            className="w-full px-4 py-2.5 rounded-xl text-sm border focus:outline-none"
            style={{ borderColor: "#E2DED5" }}
          />
          <input
            type="text"
            value={clienteNit}
            onChange={(e) => setClienteNit(e.target.value)}
            placeholder="NIT o Cédula"
            className="w-full px-4 py-2.5 rounded-xl text-sm border focus:outline-none"
            style={{ borderColor: "#E2DED5" }}
          />
        </div>

        {/* Pago y descuento */}
        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "#9CA3AB" }}
          >
            Pago
          </p>
          <div className="flex gap-2 flex-wrap">
            {METODOS_PAGO.map((m) => (
              <button
                key={m}
                onClick={() => setMetodoPago(m)}
                className="px-3 py-2 rounded-xl text-sm border font-medium transition-colors"
                style={
                  metodoPago === m
                    ? {
                        backgroundColor: "#14352A",
                        color: "#fff",
                        borderColor: "#14352A",
                      }
                    : {
                        backgroundColor: "#fff",
                        color: "#636B74",
                        borderColor: "#E2DED5",
                      }
                }
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm" style={{ color: "#636B74" }}>
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
              className="w-20 px-3 py-2 rounded-xl text-sm border text-center focus:outline-none"
              style={{ borderColor: "#E2DED5" }}
            />
          </div>
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Observaciones (opcional)"
            rows={2}
            className="w-full px-4 py-2.5 rounded-xl text-sm border focus:outline-none resize-none"
            style={{ borderColor: "#E2DED5" }}
          />
        </div>

        {/* Totales */}
        {carrito.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-4 space-y-2">
            <div
              className="flex justify-between text-sm"
              style={{ color: "#636B74" }}
            >
              <span>Subtotal</span>
              <span>{formatCOP(subtotal)}</span>
            </div>
            {descuentoPct > 0 && (
              <div
                className="flex justify-between text-sm"
                style={{ color: "#C47F17" }}
              >
                <span>Descuento ({descuentoPct}%)</span>
                <span>−{formatCOP(descuento)}</span>
              </div>
            )}
            <div
              className="flex justify-between text-sm"
              style={{ color: "#636B74" }}
            >
              <span>IVA 19%</span>
              <span>{formatCOP(iva)}</span>
            </div>
            <div
              className="flex justify-between font-bold text-base pt-2 border-t"
              style={{ borderColor: "#E2DED5", color: "#14352A" }}
            >
              <span>Total</span>
              <span>{formatCOP(total)}</span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Botón confirmar */}
        <button
          onClick={confirmarVenta}
          disabled={carrito.length === 0 || confirmando}
          className="w-full py-4 rounded-2xl font-semibold text-base text-white transition-opacity disabled:opacity-40"
          style={{ backgroundColor: "#14352A" }}
        >
          {confirmando
            ? "Registrando..."
            : `Confirmar venta · ${formatCOP(total)}`}
        </button>

        <div className="h-6" />
      </div>

      {/* QR Scanner modal */}
      {scannerOpen && (
        <QRScanner
          onFound={handleQRFound}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </div>
  );
}
