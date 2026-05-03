import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, sanitizeSearch, safeError } from "../../lib/utils";
import QRScanner from "../../components/forms/QRScanner";
import PageHeader from "../../components/layout/PageHeader";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";

const METODOS_PAGO = ["Efectivo", "Transferencia", "Tarjeta", "Crédito"];

const inputStyle = {
  backgroundColor: "hsl(var(--card))",
  borderColor: "hsl(var(--border))",
  color: "hsl(var(--foreground))",
};

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
  const [metodoPago, setMetodoPago] = useState("Efectivo");
  const [descuentoPct, setDescuentoPct] = useState(0);
  const [observaciones, setObservaciones] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState(null);

  const buscarProductos = useCallback(
    async (q) => {
      if (!q || q.trim().length < 2 || !perfil?.sede_id) {
        setResultados([]);
        return;
      }
      setBuscando(true);
      try {
        const safe = sanitizeSearch(q.trim());
        const { data: prods, error: e1 } = await supabase
          .from("productos")
          .select("id, nombre, referencia, precio_venta, unidad_medida")
          .eq("activo", true)
          .or(`nombre.ilike.%${safe}%,referencia.ilike.%${safe}%`)
          .limit(10);
        if (e1) throw e1;
        if (!prods?.length) {
          setResultados([]);
          return;
        }

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

  const buscarDebounced = useDebouncedCallback(buscarProductos, 300);

  const handleBusquedaChange = (e) => {
    const val = e.target.value;
    setBusqueda(val);
    buscarDebounced(val);
  };

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

  const agregarAlCarrito = (prod) => {
    setBusqueda("");
    setResultados([]);
    setCarrito((prev) => {
      const idx = prev.findIndex((i) => i.producto_id === prod.id);
      if (idx >= 0) {
        const updated = [...prev];
        const item = { ...updated[idx] };
        if (item.cantidad < prod.stock_disponible) item.cantidad += 1;
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

  // Misma fórmula que el trigger trg_recalcular_total_venta del servidor:
  // total = subtotal * (1 - desc/100) * (1 + iva/100)
  // Esto evita drifts de 1-2 COP por orden de operaciones distinto.
  const IVA_PCT = 19;
  const subtotal = carrito.reduce(
    (s, i) => s + i.cantidad * i.precio_unitario,
    0,
  );
  const descuento = subtotal * (descuentoPct / 100);
  const baseIva = subtotal - descuento;
  const iva = baseIva * (IVA_PCT / 100);
  const total = subtotal * (1 - descuentoPct / 100) * (1 + IVA_PCT / 100);

  const confirmarVenta = async () => {
    if (carrito.length === 0) return;
    setError(null);
    setConfirmando(true);
    try {
      const { error: rpcErr } = await supabase.rpc("fn_registrar_venta", {
        p_sede_id: perfil.sede_id,
        p_cliente_nombre: clienteNombre || null,
        p_cliente_nit: clienteNit || null,
        p_metodo_pago: metodoPago,
        p_descuento_pct: descuentoPct,
        p_observaciones: observaciones || null,
        p_items: carrito.map((i) => ({
          producto_id: i.producto_id,
          cantidad: i.cantidad,
          precio_unitario: i.precio_unitario,
        })),
      });
      if (rpcErr) throw new Error(rpcErr.message);
      navigate("/ops/ventas");
    } catch (e) {
      setError(safeError(e, "Error al registrar la venta"));
    } finally {
      setConfirmando(false);
    }
  };

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      {/* ── PageHeader ── */}
      <PageHeader
        title="Nueva Venta"
        description={perfil.sede_id}
        actions={
          <button
            onClick={() => navigate("/ops/ventas")}
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

      {/* ── Búsqueda de productos ── */}
      <SectionCard title="Agregar productos">
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <SearchIcon />
              <input
                type="text"
                value={busqueda}
                onChange={handleBusquedaChange}
                placeholder="Nombre o referencia..."
                className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm border focus:outline-none transition-all"
                style={inputStyle}
              />
            </div>
            <button
              onClick={() => setScannerOpen(true)}
              className="flex items-center justify-center w-11 h-11 rounded-xl flex-shrink-0 transition-all cursor-pointer"
              style={{
                backgroundColor: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
              }}
            >
              <QRIcon />
            </button>
          </div>

          {buscando && (
            <p
              className="text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Buscando...
            </p>
          )}

          {resultados.length > 0 && (
            <div
              className="border rounded-xl overflow-hidden"
              style={{ borderColor: "hsl(var(--border))" }}
            >
              {resultados.map((r, idx) => (
                <button
                  key={r.id}
                  onClick={() => agregarAlCarrito(r)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left transition-all cursor-pointer"
                  style={{
                    borderTop:
                      idx === 0 ? "none" : `1px solid hsl(var(--border) / 0.5)`,
                    backgroundColor: "hsl(var(--card))",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor =
                      "hsl(var(--muted) / 0.5)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "hsl(var(--card))")
                  }
                >
                  <div>
                    <p
                      className="text-sm font-medium"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {r.nombre}
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {r.referencia} · Stock: {r.stock_disponible}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className="text-sm font-semibold"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {formatCOP(r.precio_venta)}
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
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
          <div className="py-8 text-center">
            <p
              className="text-sm"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Agrega productos al carrito
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-0">
            {carrito.map((item, idx) => (
              <div
                key={item.producto_id}
                className="flex items-center gap-3 px-0 py-3"
                style={{
                  borderTop:
                    idx === 0 ? "none" : `1px solid hsl(var(--border) / 0.5)`,
                }}
              >
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
                    {formatCOP(item.precio_unitario)} c/u
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => actualizarCantidad(item.producto_id, -1)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-lg border transition-all cursor-pointer"
                    style={{
                      borderColor: "hsl(var(--border))",
                      color: "hsl(var(--muted-foreground))",
                      backgroundColor: "hsl(var(--card))",
                    }}
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
                    style={inputStyle}
                  />
                  <button
                    onClick={() => actualizarCantidad(item.producto_id, 1)}
                    disabled={item.cantidad >= item.stock_disponible}
                    className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-lg border transition-all disabled:opacity-40 cursor-pointer"
                    style={{
                      borderColor: "hsl(var(--border))",
                      color: "hsl(var(--muted-foreground))",
                      backgroundColor: "hsl(var(--card))",
                    }}
                  >
                    +
                  </button>
                </div>
                <div className="text-right w-20">
                  <p
                    className="text-sm font-semibold tabular-nums"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {formatCOP(item.cantidad * item.precio_unitario)}
                  </p>
                </div>
                <button
                  onClick={() => eliminarItem(item.producto_id)}
                  className="transition-colors cursor-pointer"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.color = "hsl(var(--destructive))")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.color =
                      "hsl(var(--muted-foreground))")
                  }
                >
                  <XIcon />
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Cliente (opcional) ── */}
      <SectionCard title="Cliente (opcional)">
        <div className="space-y-3">
          <input
            type="text"
            value={clienteNombre}
            onChange={(e) => setClienteNombre(e.target.value)}
            placeholder="Nombre del cliente"
            className="w-full px-4 py-2.5 rounded-xl text-sm border focus:outline-none transition-all"
            style={inputStyle}
          />
          <input
            type="text"
            value={clienteNit}
            onChange={(e) => setClienteNit(e.target.value)}
            placeholder="NIT o Cédula"
            className="w-full px-4 py-2.5 rounded-xl text-sm border focus:outline-none transition-all"
            style={inputStyle}
          />
        </div>
      </SectionCard>

      {/* ── Pago ── */}
      <SectionCard title="Pago">
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {METODOS_PAGO.map((m) => (
              <button
                key={m}
                onClick={() => setMetodoPago(m)}
                className="px-3 py-2 rounded-xl text-sm border font-medium transition-all cursor-pointer"
                style={
                  metodoPago === m
                    ? {
                        backgroundColor: "hsl(var(--primary))",
                        color: "hsl(var(--primary-foreground))",
                        borderColor: "hsl(var(--primary))",
                      }
                    : {
                        backgroundColor: "hsl(var(--card))",
                        color: "hsl(var(--muted-foreground))",
                        borderColor: "hsl(var(--border))",
                      }
                }
              >
                {m}
              </button>
            ))}
          </div>
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
              className="w-20 px-3 py-2 rounded-xl text-sm border text-center focus:outline-none"
              style={inputStyle}
            />
          </div>
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Observaciones (opcional)"
            rows={2}
            className="w-full px-4 py-2.5 rounded-xl text-sm border focus:outline-none resize-none transition-all"
            style={inputStyle}
          />
        </div>
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

      {/* ── Botón confirmar ── */}
      <button
        onClick={confirmarVenta}
        disabled={carrito.length === 0 || confirmando}
        className="w-full py-4 rounded-xl font-semibold text-base transition-opacity disabled:opacity-40 cursor-pointer"
        style={{
          backgroundColor: "hsl(var(--primary))",
          color: "hsl(var(--primary-foreground))",
        }}
      >
        {confirmando
          ? "Registrando..."
          : `Confirmar venta · ${formatCOP(total)}`}
      </button>

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

function SectionCard({ title, children }) {
  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <div
        className="px-4 py-3 border-b"
        style={{
          borderColor: "hsl(var(--border))",
          backgroundColor: "hsl(var(--muted) / 0.3)",
        }}
      >
        <p
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {title}
        </p>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
      style={{ color: "hsl(var(--muted-foreground))" }}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  );
}

function QRIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}
