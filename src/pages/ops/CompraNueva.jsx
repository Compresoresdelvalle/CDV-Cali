import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";

const inputStyle = {
  backgroundColor: "hsl(var(--card))",
  borderColor: "hsl(var(--border))",
  color: "hsl(var(--foreground))",
};

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

export default function CompraNueva() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [proveedor, setProveedor] = useState("");
  const [facturaProveedor, setFacturaProveedor] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [recibirAhora, setRecibirAhora] = useState(false);

  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);

  const [carrito, setCarrito] = useState([]);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const buscarProductos = useCallback(async (q) => {
    if (!q || q.trim().length < 2) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    try {
      const { data, error: e } = await supabase
        .from("productos")
        .select("id, nombre, referencia, costo_promedio, unidad_medida")
        .eq("activo", true)
        .or(`nombre.ilike.%${q}%,referencia.ilike.%${q}%`)
        .limit(8);
      if (e) throw e;
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
          costo_unitario: prod.costo_promedio ?? 0,
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

  const setCostoDirecto = (productoId, valor) => {
    const n = parseFloat(valor);
    if (isNaN(n) || n < 0) return;
    setCarrito((prev) =>
      prev.map((i) =>
        i.producto_id !== productoId ? i : { ...i, costo_unitario: n },
      ),
    );
  };

  const eliminarItem = (productoId) => {
    setCarrito((prev) => prev.filter((i) => i.producto_id !== productoId));
  };

  const subtotal = carrito.reduce(
    (s, i) => s + i.cantidad * i.costo_unitario,
    0,
  );
  const iva = subtotal * 0.19;
  const total = subtotal + iva;

  const guardarCompra = async () => {
    if (!proveedor.trim()) {
      setError("El proveedor es obligatorio.");
      return;
    }
    if (carrito.length === 0) {
      setError("Agrega al menos un producto.");
      return;
    }
    setError(null);
    setGuardando(true);
    try {
      // 1. Insertar compra con recibida=false
      const { data: compra, error: e1 } = await supabase
        .from("compras")
        .insert({
          proveedor: proveedor.trim(),
          registrado_por: perfil.id,
          sede_destino_id: perfil.sede_id,
          subtotal,
          iva,
          total,
          factura_proveedor: facturaProveedor.trim() || null,
          observaciones: observaciones.trim() || null,
          recibida: false,
        })
        .select("id, numero")
        .single();
      if (e1) throw new Error(e1.message);

      // 2. Insertar detalle
      const { error: e2 } = await supabase.from("detalle_compra").insert(
        carrito.map((i) => ({
          compra_id: compra.id,
          producto_id: i.producto_id,
          cantidad: i.cantidad,
          costo_unitario: i.costo_unitario,
          subtotal: i.cantidad * i.costo_unitario,
        })),
      );
      if (e2) throw new Error(e2.message);

      // 3. Si checkbox marcado → activar trigger de stock
      if (recibirAhora) {
        const { error: e3 } = await supabase
          .from("compras")
          .update({ recibida: true, fecha_recepcion: new Date().toISOString() })
          .eq("id", compra.id);
        if (e3) throw new Error(e3.message);
      }

      navigate("/ops/compras");
    } catch (e) {
      setError(e.message ?? "Error al guardar la compra");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Nueva Compra"
        description={perfil.sede_id}
        actions={
          <button
            onClick={() => navigate("/ops/compras")}
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

      {/* Proveedor */}
      <SectionCard title="Proveedor">
        <div className="space-y-3">
          <input
            type="text"
            value={proveedor}
            onChange={(e) => setProveedor(e.target.value)}
            placeholder="Nombre del proveedor *"
            className="w-full px-4 py-3 rounded-xl text-sm border focus:outline-none transition-all"
            style={inputStyle}
          />
          <input
            type="text"
            value={facturaProveedor}
            onChange={(e) => setFacturaProveedor(e.target.value)}
            placeholder="N° factura del proveedor (opcional)"
            className="w-full px-4 py-3 rounded-xl text-sm border focus:outline-none transition-all"
            style={inputStyle}
          />
        </div>
      </SectionCard>

      {/* Productos */}
      <SectionCard title="Productos">
        <div className="space-y-3">
          {/* Buscador */}
          <div className="relative">
            <SearchIcon />
            <input
              type="text"
              value={busqueda}
              onChange={handleBusquedaChange}
              placeholder="Buscar producto por nombre o referencia..."
              className="w-full pl-9 pr-4 py-3 rounded-xl text-sm border focus:outline-none transition-all"
              style={inputStyle}
            />
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
                      {r.referencia} · {r.unidad_medida}
                    </p>
                  </div>
                  <span
                    className="text-xs"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    + Agregar
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Carrito */}
          {carrito.length === 0 ? (
            <div className="py-8 text-center">
              <p
                className="text-sm"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Agrega productos a la orden de compra
              </p>
            </div>
          ) : (
            <>
              {/* Desktop tabla */}
              <div
                className="hidden md:block overflow-x-auto rounded-xl border"
                style={{ borderColor: "hsl(var(--border))" }}
              >
                <table className="w-full border-collapse">
                  <thead>
                    <tr
                      style={{
                        backgroundColor: "hsl(var(--muted) / 0.4)",
                        borderBottom: "1px solid hsl(var(--border))",
                      }}
                    >
                      {[
                        "Producto",
                        "Cantidad",
                        "Costo unitario",
                        "Subtotal",
                        "",
                      ].map((col) => (
                        <th
                          key={col}
                          className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-left whitespace-nowrap"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {carrito.map((item, idx) => (
                      <tr
                        key={item.producto_id}
                        style={{
                          borderTop:
                            idx === 0
                              ? "none"
                              : "1px solid hsl(var(--border) / 0.5)",
                        }}
                      >
                        <td className="px-3 py-3">
                          <p
                            className="text-sm font-medium"
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
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() =>
                                actualizarCantidad(item.producto_id, -1)
                              }
                              className="w-8 h-8 rounded-lg flex items-center justify-center font-bold border transition-all cursor-pointer"
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
                              value={item.cantidad}
                              onChange={(e) =>
                                setCantidadDirecta(
                                  item.producto_id,
                                  e.target.value,
                                )
                              }
                              className="w-14 text-center text-sm font-semibold border rounded-lg py-1 focus:outline-none"
                              style={inputStyle}
                            />
                            <button
                              onClick={() =>
                                actualizarCantidad(item.producto_id, 1)
                              }
                              className="w-8 h-8 rounded-lg flex items-center justify-center font-bold border transition-all cursor-pointer"
                              style={{
                                borderColor: "hsl(var(--border))",
                                color: "hsl(var(--muted-foreground))",
                                backgroundColor: "hsl(var(--card))",
                              }}
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <input
                            type="number"
                            min="0"
                            step="100"
                            value={item.costo_unitario}
                            onChange={(e) =>
                              setCostoDirecto(item.producto_id, e.target.value)
                            }
                            className="w-32 px-3 py-1.5 text-sm border rounded-lg focus:outline-none"
                            style={inputStyle}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className="text-sm font-semibold tabular-nums"
                            style={{ color: "hsl(var(--foreground))" }}
                          >
                            {formatCOP(item.cantidad * item.costo_unitario)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <button
                            onClick={() => eliminarItem(item.producto_id)}
                            className="transition-colors cursor-pointer"
                            style={{ color: "hsl(var(--muted-foreground))" }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.color =
                                "hsl(var(--destructive))")
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.color =
                                "hsl(var(--muted-foreground))")
                            }
                          >
                            <XIcon />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-2.5">
                {carrito.map((item) => (
                  <div
                    key={item.producto_id}
                    className="rounded-xl border p-3 space-y-2"
                    style={{
                      backgroundColor: "hsl(var(--card))",
                      borderColor: "hsl(var(--border))",
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
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
                        className="shrink-0 cursor-pointer"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        <XIcon />
                      </button>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() =>
                            actualizarCantidad(item.producto_id, -1)
                          }
                          className="w-9 h-9 rounded-lg flex items-center justify-center font-bold border cursor-pointer"
                          style={{
                            borderColor: "hsl(var(--border))",
                            color: "hsl(var(--muted-foreground))",
                            backgroundColor: "hsl(var(--background))",
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
                          className="w-14 text-center text-sm font-semibold border rounded-lg py-1.5 focus:outline-none"
                          style={inputStyle}
                        />
                        <button
                          onClick={() =>
                            actualizarCantidad(item.producto_id, 1)
                          }
                          className="w-9 h-9 rounded-lg flex items-center justify-center font-bold border cursor-pointer"
                          style={{
                            borderColor: "hsl(var(--border))",
                            color: "hsl(var(--muted-foreground))",
                            backgroundColor: "hsl(var(--background))",
                          }}
                        >
                          +
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="text-xs"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          $
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="100"
                          value={item.costo_unitario}
                          onChange={(e) =>
                            setCostoDirecto(item.producto_id, e.target.value)
                          }
                          className="w-28 px-2 py-1.5 text-sm border rounded-lg focus:outline-none"
                          style={inputStyle}
                        />
                      </div>
                      <span
                        className="ml-auto text-sm font-bold tabular-nums"
                        style={{ color: "hsl(var(--foreground))" }}
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
      </SectionCard>

      {/* Observaciones */}
      <SectionCard title="Observaciones">
        <textarea
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          placeholder="Observaciones internas (opcional)"
          rows={2}
          className="w-full px-4 py-3 rounded-xl text-sm border focus:outline-none resize-none transition-all"
          style={inputStyle}
        />
      </SectionCard>

      {/* Totales */}
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

      {/* Recibir ahora */}
      <label
        className="flex items-center gap-3 p-4 rounded-xl border cursor-pointer select-none"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: recibirAhora
            ? "hsl(var(--primary))"
            : "hsl(var(--border))",
        }}
      >
        <input
          type="checkbox"
          checked={recibirAhora}
          onChange={(e) => setRecibirAhora(e.target.checked)}
          className="w-5 h-5 rounded accent-primary cursor-pointer"
        />
        <div>
          <p
            className="text-sm font-semibold"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Marcar como recibida ahora
          </p>
          <p
            className="text-xs"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            El stock se sumará automáticamente al confirmar
          </p>
        </div>
      </label>

      {/* Error */}
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

      {/* Botón guardar */}
      <button
        onClick={guardarCompra}
        disabled={carrito.length === 0 || !proveedor.trim() || guardando}
        className="w-full py-4 rounded-xl font-semibold text-base transition-opacity disabled:opacity-40 cursor-pointer"
        style={{
          backgroundColor: "hsl(var(--primary))",
          color: "hsl(var(--primary-foreground))",
        }}
      >
        {guardando
          ? "Guardando..."
          : recibirAhora
            ? `Registrar y recibir · ${formatCOP(total)}`
            : `Registrar compra · ${formatCOP(total)}`}
      </button>
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
