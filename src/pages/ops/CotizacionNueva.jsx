import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
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

const inputStyle = {
  backgroundColor: "hsl(var(--card))",
  borderColor: "hsl(var(--border))",
  color: "hsl(var(--foreground))",
};

export default function CotizacionNueva() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [carrito, setCarrito] = useState([]);

  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteNit, setClienteNit] = useState("");
  const [clienteEmail, setClienteEmail] = useState("");
  const [clienteTelefono, setClienteTelefono] = useState("");
  const [descuentoPct, setDescuentoPct] = useState(0);
  const [vigenciaDias, setVigenciaDias] = useState(30);
  const [observaciones, setObservaciones] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

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
      /* ignore */
    }
  }, []);

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
        .map((i) =>
          i.producto_id !== productoId
            ? i
            : { ...i, cantidad: Math.max(0, i.cantidad + delta) },
        )
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

  const subtotal = carrito.reduce(
    (s, i) => s + i.cantidad * i.precio_unitario,
    0,
  );
  const descuento = subtotal * (descuentoPct / 100);
  const baseIva = subtotal - descuento;
  const iva = baseIva * 0.19;
  const total = baseIva + iva;

  const guardarCotizacion = async () => {
    if (carrito.length === 0) return;
    setError(null);
    setGuardando(true);
    try {
      const { error: rpcErr } = await supabase.rpc("fn_registrar_cotizacion", {
        p_sede_id: perfil.sede_id,
        p_cliente_nombre: clienteNombre || null,
        p_cliente_nit: clienteNit || null,
        p_cliente_email: clienteEmail || null,
        p_cliente_telefono: clienteTelefono || null,
        p_descuento_pct: descuentoPct,
        p_vigencia_dias: vigenciaDias,
        p_observaciones: observaciones || null,
        p_items: carrito.map((i) => ({
          producto_id: i.producto_id,
          cantidad: i.cantidad,
          precio_unitario: i.precio_unitario,
        })),
      });
      if (rpcErr) throw new Error(rpcErr.message);
      navigate("/ops/cotizaciones");
    } catch (e) {
      setError(e.message ?? "Error al guardar la cotización");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      {/* ── PageHeader ── */}
      <PageHeader
        title="Nueva Cotización"
        description={perfil?.sede_id}
        actions={
          <button
            onClick={() => navigate("/ops/cotizaciones")}
            className="h-9 px-3 rounded-lg border text-sm font-medium transition-all cursor-pointer"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
              backgroundColor: "hsl(var(--card))",
            }}
          >
            Cancelar
          </button>
        }
      />

      {/* ── Productos / Búsqueda ── */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        {/* Búsqueda */}
        <div
          className="p-4 border-b"
          style={{
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--muted) / 0.3)",
          }}
        >
          <p
            className="text-xs font-semibold uppercase tracking-wide mb-3"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Agregar productos
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <SearchIcon
                className="absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: "hsl(var(--muted-foreground))" }}
              />
              <input
                type="text"
                value={busqueda}
                onChange={handleBusquedaChange}
                placeholder="Nombre o referencia..."
                className="w-full pl-9 pr-4 h-10 rounded-lg text-sm border focus:outline-none transition-all"
                style={inputStyle}
              />
            </div>
            <button
              onClick={() => setScannerOpen(true)}
              className="flex items-center justify-center w-10 h-10 rounded-lg text-white flex-shrink-0 transition-all cursor-pointer"
              style={{ backgroundColor: "hsl(var(--primary))" }}
              aria-label="Escanear QR"
            >
              <QRIcon />
            </button>
          </div>

          {buscando && (
            <p
              className="text-xs mt-2"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Buscando...
            </p>
          )}
          {resultados.length > 0 && (
            <div
              className="mt-2 border rounded-lg overflow-hidden"
              style={{ borderColor: "hsl(var(--border))" }}
            >
              {resultados.map((p, idx) => (
                <button
                  key={p.id}
                  onClick={() => agregarAlCarrito(p)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors cursor-pointer"
                  style={{
                    borderTop:
                      idx === 0 ? "none" : `1px solid hsl(var(--border) / 0.5)`,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor =
                      "hsl(var(--muted) / 0.5)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "")
                  }
                >
                  <div>
                    <p
                      className="text-sm font-medium"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {p.nombre}
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {p.referencia}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className="text-sm font-semibold"
                      style={{ color: "hsl(var(--primary))" }}
                    >
                      {formatCOP(p.precio_venta)}
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
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
          <div className="px-4 py-10 text-center">
            <div className="text-4xl mb-3">📋</div>
            <p
              className="text-sm"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Agrega productos a la cotización
            </p>
          </div>
        ) : (
          <div>
            {carrito.map((item, idx) => (
              <div
                key={item.producto_id}
                className="px-4 py-3"
                style={{
                  borderTop:
                    idx === 0 ? "none" : `1px solid hsl(var(--border) / 0.5)`,
                }}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm font-medium truncate"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {item.nombre}
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {item.referencia}
                    </p>
                  </div>
                  <button
                    onClick={() => eliminarItem(item.producto_id)}
                    className="ml-2 transition-colors cursor-pointer"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.color = "hsl(var(--destructive))")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.color =
                        "hsl(var(--muted-foreground))")
                    }
                    aria-label="Eliminar"
                  >
                    <XIcon />
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => actualizarCantidad(item.producto_id, -1)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center border text-base cursor-pointer transition-all"
                      style={{
                        borderColor: "hsl(var(--border))",
                        color: "hsl(var(--muted-foreground))",
                      }}
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
                      style={{
                        borderColor: "hsl(var(--border))",
                        color: "hsl(var(--foreground))",
                        backgroundColor: "hsl(var(--background))",
                      }}
                    />
                    <button
                      onClick={() => actualizarCantidad(item.producto_id, 1)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center border text-base cursor-pointer transition-all"
                      style={{
                        borderColor: "hsl(var(--border))",
                        color: "hsl(var(--muted-foreground))",
                      }}
                    >
                      +
                    </button>
                  </div>
                  <div className="flex-1 relative">
                    <span
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
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
                      style={{
                        borderColor: "hsl(var(--border))",
                        color: "hsl(var(--foreground))",
                        backgroundColor: "hsl(var(--background))",
                      }}
                    />
                  </div>
                  <p
                    className="text-sm font-semibold w-20 text-right tabular-nums"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {formatCOP(item.cantidad * item.precio_unitario)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Cliente ── */}
      <SectionCard label="Cliente">
        <input
          type="text"
          value={clienteNombre}
          onChange={(e) => setClienteNombre(e.target.value)}
          placeholder="Nombre del cliente"
          className="w-full px-4 py-2.5 rounded-lg text-sm border focus:outline-none"
          style={inputStyle}
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            value={clienteNit}
            onChange={(e) => setClienteNit(e.target.value)}
            placeholder="NIT o Cédula"
            className="px-4 py-2.5 rounded-lg text-sm border focus:outline-none"
            style={inputStyle}
          />
          <input
            type="tel"
            value={clienteTelefono}
            onChange={(e) => setClienteTelefono(e.target.value)}
            placeholder="Teléfono"
            className="px-4 py-2.5 rounded-lg text-sm border focus:outline-none"
            style={inputStyle}
          />
        </div>
        <input
          type="email"
          value={clienteEmail}
          onChange={(e) => setClienteEmail(e.target.value)}
          placeholder="Email (para envío)"
          className="w-full px-4 py-2.5 rounded-lg text-sm border focus:outline-none"
          style={inputStyle}
        />
      </SectionCard>

      {/* ── Condiciones ── */}
      <SectionCard label="Condiciones">
        <div className="flex items-center gap-3">
          <label
            className="text-sm"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
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
            className="w-20 px-3 py-2 rounded-lg text-sm border text-center focus:outline-none"
            style={inputStyle}
          />
        </div>
        <div className="flex items-center gap-3">
          <label
            className="text-sm"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
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
            className="w-20 px-3 py-2 rounded-lg text-sm border text-center focus:outline-none"
            style={inputStyle}
          />
        </div>
        <textarea
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          placeholder="Observaciones"
          rows={2}
          className="w-full px-4 py-2.5 rounded-lg text-sm border focus:outline-none resize-none"
          style={inputStyle}
        />
      </SectionCard>

      {/* ── Totales ── */}
      {carrito.length > 0 && (
        <div
          className="rounded-xl border p-4 space-y-2"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          <div
            className="flex justify-between text-sm"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            <span>Subtotal</span>
            <span className="tabular-nums">{formatCOP(subtotal)}</span>
          </div>
          {descuentoPct > 0 && (
            <div
              className="flex justify-between text-sm"
              style={{ color: "hsl(var(--warning))" }}
            >
              <span>Descuento ({descuentoPct}%)</span>
              <span className="tabular-nums">−{formatCOP(descuento)}</span>
            </div>
          )}
          <div
            className="flex justify-between text-sm"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            <span>IVA 19%</span>
            <span className="tabular-nums">{formatCOP(iva)}</span>
          </div>
          <div
            className="flex justify-between font-bold text-base pt-2 border-t"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
          >
            <span>Total</span>
            <span className="tabular-nums">{formatCOP(total)}</span>
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div
          className="rounded-xl border px-4 py-3"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.05)",
            borderColor: "hsl(var(--destructive) / 0.2)",
          }}
        >
          <p className="text-sm" style={{ color: "hsl(var(--destructive))" }}>
            {error}
          </p>
        </div>
      )}

      {/* ── Guardar ── */}
      <button
        onClick={guardarCotizacion}
        disabled={carrito.length === 0 || guardando}
        className="w-full py-4 rounded-xl font-semibold text-base transition-opacity disabled:opacity-40 cursor-pointer"
        style={{
          backgroundColor: "hsl(var(--primary))",
          color: "hsl(var(--primary-foreground))",
        }}
      >
        {guardando
          ? "Guardando..."
          : `Guardar cotización · ${formatCOP(total)}`}
      </button>

      {scannerOpen && (
        <QRScanner
          onFound={handleQRFound}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </div>
  );
}

/* ─── Componentes locales ── */
function SectionCard({ label, children }) {
  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <p
        className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </p>
      {children}
    </div>
  );
}

function SearchIcon({ className = "", style }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="m10.5 10.5 2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function QRIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h.01M18 14h.01M14 18h.01M18 18h.01M14 14v4h4v-4" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 3 11 11M11 3 3 11"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
