import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import PageHeader from "../../components/layout/PageHeader";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";

const inputStyle = {
  backgroundColor: "hsl(var(--card))",
  borderColor: "hsl(var(--border))",
  color: "hsl(var(--foreground))",
};

export default function DevolucionNueva() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [tipo, setTipo] = useState("cliente");

  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [productoSeleccionado, setProductoSeleccionado] = useState(null);

  const [cantidad, setCantidad] = useState(1);
  const [motivo, setMotivo] = useState("");
  const [ventaId, setVentaId] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(null);

  const buscarProductos = useCallback(async (q) => {
    if (!q || q.trim().length < 2) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    try {
      const { data, error: e } = await supabase
        .from("productos")
        .select("id, nombre, referencia, unidad_medida")
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

  const buscarDebounced = useDebouncedCallback(buscarProductos, 300);

  const handleBusquedaChange = (e) => {
    const val = e.target.value;
    setBusqueda(val);
    setProductoSeleccionado(null);
    buscarDebounced(val);
  };

  const seleccionarProducto = (prod) => {
    setProductoSeleccionado(prod);
    setBusqueda(prod.nombre);
    setResultados([]);
  };

  const registrar = async () => {
    if (!productoSeleccionado) {
      setError("Selecciona un producto.");
      return;
    }
    if (cantidad < 1) {
      setError("La cantidad debe ser al menos 1.");
      return;
    }
    setError(null);
    setExito(null);
    setGuardando(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc(
        "fn_registrar_devolucion",
        {
          p_tipo: tipo,
          p_producto_id: productoSeleccionado.id,
          p_sede_id: perfil.sede_id,
          p_cantidad: cantidad,
          p_motivo: motivo.trim() || "Sin motivo especificado",
          p_venta_id: ventaId.trim() || null,
        },
      );
      if (rpcErr) throw new Error(rpcErr.message);
      const delta = tipo === "cliente" ? `+${cantidad}` : `-${cantidad}`;
      setExito(
        `Devolución #${data.numero} registrada. Stock ajustado: ${delta} unidades.`,
      );
      // Reset form
      setProductoSeleccionado(null);
      setBusqueda("");
      setCantidad(1);
      setMotivo("");
      setVentaId("");
    } catch (e) {
      setError(e.message ?? "Error al registrar la devolución");
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
        title="Nueva Devolución"
        description={perfil.sede_id}
        actions={
          <button
            onClick={() => navigate("/ops/devoluciones")}
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

      {/* Tipo */}
      <SectionCard title="Tipo de devolución">
        <div className="flex gap-3">
          {[
            {
              value: "cliente",
              label: "Devolución de cliente",
              desc: "Suma stock",
            },
            {
              value: "proveedor",
              label: "Devolución a proveedor",
              desc: "Resta stock",
            },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTipo(opt.value)}
              className="flex-1 py-3 px-4 rounded-xl border text-left transition-all cursor-pointer"
              style={
                tipo === opt.value
                  ? {
                      backgroundColor: "hsl(var(--primary) / 0.08)",
                      borderColor: "hsl(var(--primary))",
                      color: "hsl(var(--primary))",
                    }
                  : {
                      backgroundColor: "hsl(var(--card))",
                      borderColor: "hsl(var(--border))",
                      color: "hsl(var(--foreground))",
                    }
              }
            >
              <p className="text-sm font-semibold">{opt.label}</p>
              <p
                className="text-xs mt-0.5"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {opt.desc}
              </p>
            </button>
          ))}
        </div>
      </SectionCard>

      {/* Producto */}
      <SectionCard title="Producto">
        <div className="space-y-3">
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
                  onClick={() => seleccionarProducto(r)}
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
                  <CheckIcon />
                </button>
              ))}
            </div>
          )}

          {productoSeleccionado && (
            <div
              className="flex items-center gap-3 px-4 py-3 rounded-xl border"
              style={{
                backgroundColor: "hsl(var(--success) / 0.06)",
                borderColor: "hsl(var(--success) / 0.3)",
              }}
            >
              <span style={{ color: "hsl(var(--success))" }}>
                <CheckCircleIcon />
              </span>
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-semibold truncate"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {productoSeleccionado.nombre}
                </p>
                <p
                  className="text-xs"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {productoSeleccionado.referencia}
                </p>
              </div>
              <button
                onClick={() => {
                  setProductoSeleccionado(null);
                  setBusqueda("");
                }}
                className="text-xs cursor-pointer"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Cambiar
              </button>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Detalles */}
      <SectionCard title="Detalles">
        <div className="space-y-3">
          <div>
            <label
              className="block text-xs font-medium mb-1.5"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Cantidad *
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCantidad((n) => Math.max(1, n - 1))}
                className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-xl border cursor-pointer"
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
                value={cantidad}
                onChange={(e) =>
                  setCantidad(Math.max(1, parseInt(e.target.value, 10) || 1))
                }
                className="w-20 text-center text-lg font-bold border rounded-xl py-2.5 focus:outline-none"
                style={inputStyle}
              />
              <button
                onClick={() => setCantidad((n) => n + 1)}
                className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-xl border cursor-pointer"
                style={{
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--muted-foreground))",
                  backgroundColor: "hsl(var(--card))",
                }}
              >
                +
              </button>
            </div>
          </div>

          <div>
            <label
              className="block text-xs font-medium mb-1.5"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Motivo (opcional)
            </label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Describe el motivo de la devolución..."
              rows={3}
              className="w-full px-4 py-3 rounded-xl text-sm border focus:outline-none resize-none transition-all"
              style={inputStyle}
            />
          </div>

          {tipo === "cliente" && (
            <div>
              <label
                className="block text-xs font-medium mb-1.5"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                ID de venta relacionada (opcional)
              </label>
              <input
                type="text"
                value={ventaId}
                onChange={(e) => setVentaId(e.target.value)}
                placeholder="UUID de la venta original"
                className="w-full px-4 py-3 rounded-xl text-sm border focus:outline-none transition-all font-mono"
                style={inputStyle}
              />
            </div>
          )}
        </div>
      </SectionCard>

      {/* Exito */}
      {exito && (
        <div
          className="rounded-xl border px-4 py-3"
          style={{
            backgroundColor: "hsl(var(--success) / 0.06)",
            borderColor: "hsl(var(--success) / 0.3)",
          }}
        >
          <p
            className="text-sm font-medium"
            style={{ color: "hsl(var(--success))" }}
          >
            {exito}
          </p>
        </div>
      )}

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

      <button
        onClick={registrar}
        disabled={!productoSeleccionado || cantidad < 1 || guardando}
        className="w-full py-4 rounded-xl font-semibold text-base transition-opacity disabled:opacity-40 cursor-pointer"
        style={{
          backgroundColor: "hsl(var(--primary))",
          color: "hsl(var(--primary-foreground))",
        }}
      >
        {guardando
          ? "Registrando..."
          : `Registrar devolución · ${cantidad} ud.`}
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

function CheckIcon() {
  return (
    <svg
      className="w-4 h-4 shrink-0"
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
        d="M12 4v16m8-8H4"
      />
    </svg>
  );
}

function CheckCircleIcon() {
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
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}
