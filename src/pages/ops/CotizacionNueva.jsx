import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP } from "../../lib/utils";
import QRScanner from "../../components/forms/QRScanner";

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

export default function CotizacionNueva() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  // Búsqueda
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  // Carrito (sin restricción de stock — cotización no descuenta)
  const [carrito, setCarrito] = useState([]);

  // Datos cliente
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteNit, setClienteNit] = useState("");
  const [clienteEmail, setClienteEmail] = useState("");
  const [clienteTelefono, setClienteTelefono] = useState("");
  const [descuentoPct, setDescuentoPct] = useState(0);
  const [vigenciaDias, setVigenciaDias] = useState(30);
  const [observaciones, setObservaciones] = useState("");

  // UI
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  // -----------------------------------------------------------
  // Búsqueda de productos (incluye sin stock — cotización)
  // -----------------------------------------------------------
  const buscarProductos = useCallback(async (q) => {
    if (!q || q.trim().length < 2) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    try {
      const { data, error: err } = await supabase
        .from("productos")
        .select("id, nombre, referencia, precio_venta, unidad_medida")
        .eq("activo", true)
        .or(`nombre.ilike.%${q}%,referencia.ilike.%${q}%`)
        .limit(8);

      if (err) throw err;
      setResultados(data ?? []);
    } catch {
      setResultados([]);
    } finally {
      setBuscando(false);
    }
  }, []);

  const buscarDebounced = useDebounce(buscarProductos, 300);

  const handleBusquedaChange = (e) => {
    const val = e.target.value;
    setBusqueda(val);
    buscarDebounced(val);
  };

  const handleQRFound = useCallback(async (productoId) => {
    setScannerOpen(false);
    try {
      const { data, error: err } = await supabase
        .from("productos")
        .select("id, nombre, referencia, precio_venta, unidad_medida")
        .eq("id", productoId)
        .single();

      if (err || !data) return;
      agregarAlCarrito(data);
    } catch {
      // ignore
    }
  }, []);

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
        updated[idx] = { ...updated[idx], cantidad: updated[idx].cantidad + 1 };
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
          return { ...i, cantidad: Math.max(0, i.cantidad + delta) };
        })
        .filter((i) => i.cantidad > 0),
    );
  };

  const setCantidadDirecta = (productoId, valor) => {
    const n = parseInt(valor, 10);
    if (isNaN(n) || n < 0) return;
    setCarrito((prev) =>
      prev
        .map((i) => (i.producto_id !== productoId ? i : { ...i, cantidad: n }))
        .filter((i) => i.cantidad > 0),
    );
  };

  const setPrecioDirecto = (productoId, valor) => {
    const n = parseFloat(valor);
    if (isNaN(n) || n < 0) return;
    setCarrito((prev) =>
      prev.map((i) =>
        i.producto_id !== productoId ? i : { ...i, precio_unitario: n },
      ),
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
  // Guardar cotización
  // -----------------------------------------------------------
  const guardarCotizacion = async () => {
    if (carrito.length === 0) return;
    setError(null);
    setGuardando(true);

    try {
      const items = carrito.map((i) => ({
        producto_id: i.producto_id,
        cantidad: i.cantidad,
        precio_unitario: i.precio_unitario,
      }));

      const { error: fnErr } = await supabase.rpc("fn_registrar_cotizacion", {
        p_sede_id: perfil.sede_id,
        p_cliente_nombre: clienteNombre || null,
        p_cliente_nit: clienteNit || null,
        p_cliente_email: clienteEmail || null,
        p_cliente_telefono: clienteTelefono || null,
        p_descuento_pct: descuentoPct,
        p_vigencia_dias: vigenciaDias,
        p_observaciones: observaciones || null,
        p_items: items,
      });

      if (fnErr) throw new Error(fnErr.message);
      navigate("/ops/cotizaciones");
    } catch (e) {
      setError(e.message ?? "Error al guardar la cotización");
    } finally {
      setGuardando(false);
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
            onClick={() => navigate("/ops/cotizaciones")}
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
            Nueva Cotización
          </h1>
          <span className="text-white/60 text-sm">{perfil.sede_id}</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Búsqueda */}
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
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm border focus:outline-none"
                  style={{ borderColor: "#E2DED5" }}
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
                {resultados.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => agregarAlCarrito(p)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-left border-b last:border-b-0 transition-colors"
                    style={{ borderColor: "#E2DED5" }}
                  >
                    <div>
                      <p
                        className="text-sm font-medium"
                        style={{ color: "#151515" }}
                      >
                        {p.nombre}
                      </p>
                      <p className="text-xs" style={{ color: "#9CA3AB" }}>
                        {p.referencia}
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className="text-sm font-semibold"
                        style={{ color: "#14352A" }}
                      >
                        {formatCOP(p.precio_venta)}
                      </p>
                      <p className="text-xs" style={{ color: "#9CA3AB" }}>
                        {p.unidad_medida}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Carrito */}
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
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <p className="text-sm" style={{ color: "#9CA3AB" }}>
                Agrega productos a la cotización
              </p>
            </div>
          ) : (
            <div>
              {carrito.map((item) => (
                <div
                  key={item.producto_id}
                  className="px-4 py-3 border-b last:border-b-0"
                  style={{ borderColor: "#E2DED5" }}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-medium truncate"
                        style={{ color: "#151515" }}
                      >
                        {item.nombre}
                      </p>
                      <p className="text-xs" style={{ color: "#9CA3AB" }}>
                        {item.referencia}
                      </p>
                    </div>
                    <button
                      onClick={() => eliminarItem(item.producto_id)}
                      className="text-red-400 hover:text-red-600 transition-colors ml-2"
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
                  <div className="flex items-center gap-3">
                    {/* Cantidad */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => actualizarCantidad(item.producto_id, -1)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center border text-base"
                        style={{ borderColor: "#E2DED5", color: "#636B74" }}
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min="1"
                        value={item.cantidad}
                        onChange={(e) =>
                          setCantidadDirecta(item.producto_id, e.target.value)
                        }
                        className="w-12 text-center text-sm font-semibold border rounded-lg py-1 focus:outline-none"
                        style={{ borderColor: "#E2DED5" }}
                      />
                      <button
                        onClick={() => actualizarCantidad(item.producto_id, 1)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center border text-base"
                        style={{ borderColor: "#E2DED5", color: "#636B74" }}
                      >
                        +
                      </button>
                    </div>
                    {/* Precio editable */}
                    <div className="flex-1 relative">
                      <span
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-xs"
                        style={{ color: "#9CA3AB" }}
                      >
                        $
                      </span>
                      <input
                        type="number"
                        min="0"
                        value={item.precio_unitario}
                        onChange={(e) =>
                          setPrecioDirecto(item.producto_id, e.target.value)
                        }
                        className="w-full pl-6 pr-3 py-1.5 rounded-lg text-sm border text-right focus:outline-none"
                        style={{ borderColor: "#E2DED5" }}
                      />
                    </div>
                    <p
                      className="text-sm font-semibold w-20 text-right"
                      style={{ color: "#14352A" }}
                    >
                      {formatCOP(item.cantidad * item.precio_unitario)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Datos cliente */}
        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "#9CA3AB" }}
          >
            Cliente
          </p>
          <input
            type="text"
            value={clienteNombre}
            onChange={(e) => setClienteNombre(e.target.value)}
            placeholder="Nombre del cliente"
            className="w-full px-4 py-2.5 rounded-xl text-sm border focus:outline-none"
            style={{ borderColor: "#E2DED5" }}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={clienteNit}
              onChange={(e) => setClienteNit(e.target.value)}
              placeholder="NIT o Cédula"
              className="px-4 py-2.5 rounded-xl text-sm border focus:outline-none"
              style={{ borderColor: "#E2DED5" }}
            />
            <input
              type="tel"
              value={clienteTelefono}
              onChange={(e) => setClienteTelefono(e.target.value)}
              placeholder="Teléfono"
              className="px-4 py-2.5 rounded-xl text-sm border focus:outline-none"
              style={{ borderColor: "#E2DED5" }}
            />
          </div>
          <input
            type="email"
            value={clienteEmail}
            onChange={(e) => setClienteEmail(e.target.value)}
            placeholder="Email (para envío)"
            className="w-full px-4 py-2.5 rounded-xl text-sm border focus:outline-none"
            style={{ borderColor: "#E2DED5" }}
          />
        </div>

        {/* Condiciones */}
        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "#9CA3AB" }}
          >
            Condiciones
          </p>
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
          <div className="flex items-center gap-3">
            <label className="text-sm" style={{ color: "#636B74" }}>
              Vigencia (días)
            </label>
            <input
              type="number"
              min="1"
              max="365"
              value={vigenciaDias}
              onChange={(e) =>
                setVigenciaDias(Math.max(1, Number(e.target.value)))
              }
              className="w-20 px-3 py-2 rounded-xl text-sm border text-center focus:outline-none"
              style={{ borderColor: "#E2DED5" }}
            />
          </div>
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Observaciones"
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

        {/* Guardar */}
        <button
          onClick={guardarCotizacion}
          disabled={carrito.length === 0 || guardando}
          className="w-full py-4 rounded-2xl font-semibold text-base text-white transition-opacity disabled:opacity-40"
          style={{ backgroundColor: "#14352A" }}
        >
          {guardando
            ? "Guardando..."
            : `Guardar cotización · ${formatCOP(total)}`}
        </button>

        <div className="h-6" />
      </div>

      {scannerOpen && (
        <QRScanner
          onFound={handleQRFound}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </div>
  );
}
