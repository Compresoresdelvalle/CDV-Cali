import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate } from "../../lib/utils";

const ESTADOS = [
  "Todos",
  "borrador",
  "enviada",
  "aprobada",
  "rechazada",
  "vencida",
];

const ESTADO_COLORS = {
  borrador: { bg: "#EDE9E0", text: "#636B74", label: "Borrador" },
  enviada: { bg: "#DBEAFE", text: "#2563EB", label: "Enviada" },
  aprobada: { bg: "#D1FAE5", text: "#0B8A57", label: "Aprobada" },
  rechazada: { bg: "#FEE2E2", text: "#C0392B", label: "Rechazada" },
  vencida: { bg: "#F3F4F6", text: "#9CA3AB", label: "Vencida" },
};

export default function CotizacionHistorial() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";

  const [cotizaciones, setCotizaciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState("Todos");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  // Modal para convertir
  const [convirtiendo, setConvirtiendo] = useState(null); // cotizacion_id
  const [errorConversion, setErrorConversion] = useState(null);

  const PAGE_SIZE = 20;

  const cargarCotizaciones = async (reset = false) => {
    setLoading(true);
    const currentPage = reset ? 0 : page;

    try {
      let query = supabase
        .from("cotizaciones")
        .select(
          `id, numero, fecha, cliente_nombre, estado, total, vigencia_dias,
           vendedor:vendedor_id(nombre)`,
        )
        .order("fecha", { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      if (!esAdmin) {
        query = query.eq("sede_id", perfil.sede_id);
      }

      if (filtroEstado !== "Todos") {
        query = query.eq("estado", filtroEstado);
      }

      const { data, error } = await query;
      if (error) throw error;

      if (reset) {
        setCotizaciones(data ?? []);
        setPage(1);
      } else {
        setCotizaciones((prev) => [...prev, ...(data ?? [])]);
        setPage((p) => p + 1);
      }
      setHasMore((data ?? []).length === PAGE_SIZE);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarCotizaciones(true);
  }, [filtroEstado]);

  const convertirEnVenta = async (e, cotizacionId) => {
    e.stopPropagation();
    setConvirtiendo(cotizacionId);
    setErrorConversion(null);
    try {
      // Cargar cabecera e ítems de la cotización
      const [{ data: cot, error: cotErr }, { data: items, error: itemsErr }] =
        await Promise.all([
          supabase
            .from("cotizaciones")
            .select("*")
            .eq("id", cotizacionId)
            .single(),
          supabase
            .from("detalle_cotizacion")
            .select("*")
            .eq("cotizacion_id", cotizacionId),
        ]);

      if (cotErr) throw new Error(cotErr.message);
      if (itemsErr) throw new Error(itemsErr.message);
      if (cot.estado === "vencida")
        throw new Error("La cotización está vencida");
      if (cot.estado === "rechazada")
        throw new Error("La cotización fue rechazada");

      // Pre-validar stock de cada ítem
      for (const item of items) {
        const { data: inv } = await supabase
          .from("inventario")
          .select("cantidad")
          .eq("producto_id", item.producto_id)
          .eq("sede_id", cot.sede_id)
          .single();
        if (!inv || inv.cantidad < item.cantidad) {
          throw new Error("Stock insuficiente para uno o más productos");
        }
      }

      // Insertar cabecera de venta
      const { data: venta, error: ventaErr } = await supabase
        .from("ventas")
        .insert({
          vendedor_id: cot.vendedor_id,
          sede_id: cot.sede_id,
          cliente_nombre: cot.cliente_nombre,
          cliente_nit: cot.cliente_nit,
          metodo_pago: "Efectivo",
          descuento_pct: cot.descuento_pct,
          iva_pct: cot.iva_pct,
          subtotal: 0,
          total: 0,
        })
        .select("id, numero")
        .single();
      if (ventaErr) throw new Error(ventaErr.message);

      // Insertar ítems — triggers manejan stock y recálculo
      const detalles = items.map((i) => ({
        venta_id: venta.id,
        producto_id: i.producto_id,
        cantidad: i.cantidad,
        precio_unitario: i.precio_unitario,
        costo_unitario: 0,
        subtotal: i.cantidad * i.precio_unitario,
      }));
      const { error: detErr } = await supabase
        .from("detalle_venta")
        .insert(detalles);
      if (detErr) throw new Error(detErr.message);

      // Marcar cotización como aprobada
      await supabase
        .from("cotizaciones")
        .update({ estado: "aprobada" })
        .eq("id", cotizacionId);

      navigate(`/ops/ventas/${venta.id}`);
    } catch (e) {
      setErrorConversion({ id: cotizacionId, msg: e.message });
    } finally {
      setConvirtiendo(null);
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F4F1EB" }}>
      {/* Header */}
      <div
        className="sticky top-0 z-10 px-4 py-4 shadow-sm"
        style={{ backgroundColor: "#14352A" }}
      >
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-white font-semibold text-lg">Cotizaciones</h1>
            <button
              onClick={() => navigate("/ops/cotizaciones/nueva")}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
              style={{ backgroundColor: "#C8993E", color: "#fff" }}
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
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Nueva
            </button>
          </div>

          {/* Filtros de estado */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {ESTADOS.map((e) => (
              <button
                key={e}
                onClick={() => setFiltroEstado(e)}
                className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors capitalize"
                style={
                  filtroEstado === e
                    ? {
                        backgroundColor: "#C8993E",
                        color: "#fff",
                        borderColor: "#C8993E",
                      }
                    : {
                        backgroundColor: "transparent",
                        color: "rgba(255,255,255,0.7)",
                        borderColor: "rgba(255,255,255,0.3)",
                      }
                }
              >
                {e === "Todos" ? "Todos" : (ESTADO_COLORS[e]?.label ?? e)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-3">
        {loading && cotizaciones.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm" style={{ color: "#9CA3AB" }}>
              Cargando cotizaciones...
            </p>
          </div>
        ) : cotizaciones.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm" style={{ color: "#9CA3AB" }}>
              No hay cotizaciones
            </p>
          </div>
        ) : (
          <>
            {cotizaciones.map((c) => {
              const estadoStyle =
                ESTADO_COLORS[c.estado] ?? ESTADO_COLORS.borrador;
              const esteError =
                errorConversion?.id === c.id ? errorConversion.msg : null;
              const puedeConvertir =
                c.estado !== "rechazada" &&
                c.estado !== "vencida" &&
                c.estado !== "aprobada";

              return (
                <div
                  key={c.id}
                  onClick={() => navigate(`/ops/cotizaciones/${c.id}`)}
                  className="bg-white rounded-2xl shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
                >
                  <div className="px-4 py-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="text-xs font-bold"
                            style={{ color: "#14352A" }}
                          >
                            #{c.numero}
                          </span>
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-medium"
                            style={{
                              backgroundColor: estadoStyle.bg,
                              color: estadoStyle.text,
                            }}
                          >
                            {estadoStyle.label}
                          </span>
                        </div>
                        <p
                          className="text-sm font-medium truncate"
                          style={{ color: "#151515" }}
                        >
                          {c.cliente_nombre || "Sin nombre"}
                        </p>
                        <p
                          className="text-xs mt-0.5"
                          style={{ color: "#9CA3AB" }}
                        >
                          {formatDate(c.fecha)}
                          {esAdmin && c.vendedor && ` · ${c.vendedor.nombre}`}
                          {" · "}
                          {c.vigencia_dias}d vigencia
                        </p>
                      </div>
                      <div className="text-right ml-4">
                        <p
                          className="font-bold text-base"
                          style={{ color: "#14352A" }}
                        >
                          {formatCOP(c.total)}
                        </p>
                      </div>
                    </div>

                    {/* Error de conversión */}
                    {esteError && (
                      <p className="text-xs text-red-600 mt-2">{esteError}</p>
                    )}

                    {/* Botón convertir en venta */}
                    {puedeConvertir && (
                      <button
                        onClick={(e) => convertirEnVenta(e, c.id)}
                        disabled={convirtiendo === c.id}
                        className="mt-3 w-full py-2.5 rounded-xl text-sm font-medium border transition-colors disabled:opacity-50"
                        style={{ borderColor: "#14352A", color: "#14352A" }}
                      >
                        {convirtiendo === c.id
                          ? "Convirtiendo..."
                          : "Convertir en venta"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {hasMore && (
              <button
                onClick={() => cargarCotizaciones(false)}
                disabled={loading}
                className="w-full py-3 rounded-2xl text-sm font-medium border transition-colors disabled:opacity-50"
                style={{ borderColor: "#E2DED5", color: "#636B74" }}
              >
                {loading ? "Cargando..." : "Cargar más"}
              </button>
            )}
          </>
        )}
        <div className="h-6" />
      </div>
    </div>
  );
}
