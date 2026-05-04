import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import FeedbackBanners from "../ui/FeedbackBanners";

/**
 * Modal selector de cotizaciones disponibles para asociar a una OT.
 *
 * Filtra:
 * - Misma sede (sedeId)
 * - Sin ot_id (no asociadas a otra OT)
 * - Búsqueda por número o cliente_nombre
 *
 * Props:
 *   - sedeId: TEXT — sede de la OT
 *   - onClose: () => void
 *   - onSelect: (cotizacionId) => void
 */
export default function SelectorCotizacionExistente({
  sedeId,
  onClose,
  onSelect,
}) {
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ESC cierra el modal
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const buscar = async (q) => {
    setLoading(true);
    setErrorMsg("");
    try {
      let query = supabase
        .from("cotizaciones")
        .select("id, numero, fecha, cliente_nombre, total, estado")
        .is("ot_id", null)
        .order("fecha", { ascending: false })
        .limit(20);
      if (sedeId) query = query.eq("sede_id", sedeId);
      const trimmed = (q ?? "").trim();
      if (trimmed.length >= 2) {
        // Buscar por número exacto o por nombre cliente parcial
        const asInt = parseInt(trimmed, 10);
        if (!Number.isNaN(asInt)) {
          query = query.or(
            `numero.eq.${asInt},cliente_nombre.ilike.%${trimmed}%`,
          );
        } else {
          query = query.ilike("cliente_nombre", `%${trimmed}%`);
        }
      }
      const { data, error } = await query;
      if (!mountedRef.current) return;
      if (error) throw error;
      setResultados(data ?? []);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al buscar"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const buscarDebounced = useDebouncedCallback(buscar, 300);

  useEffect(() => {
    buscar(busqueda);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="rounded-xl border p-5 w-full max-w-2xl space-y-3 max-h-[80vh] overflow-hidden flex flex-col"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3
            className="text-lg font-semibold"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Asociar cotización existente
          </h3>
          <button
            onClick={onClose}
            className="text-xs px-3 py-2 rounded-lg border cursor-pointer min-h-[44px]"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            Cerrar
          </button>
        </div>

        <p
          className="text-xs"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Solo cotizaciones de tu sede que aún no estén vinculadas a otra OT.
        </p>

        <input
          type="text"
          value={busqueda}
          onChange={(e) => {
            setBusqueda(e.target.value);
            buscarDebounced(e.target.value);
          }}
          placeholder="Buscar por número o nombre del cliente…"
          className="w-full px-3 py-2 rounded-lg border text-sm min-h-[48px]"
          style={{
            backgroundColor: "hsl(var(--background))",
            borderColor: "hsl(var(--border))",
            color: "hsl(var(--foreground))",
          }}
          autoFocus
        />

        <FeedbackBanners errorMsg={errorMsg} />

        <div className="overflow-y-auto flex-1 min-h-0">
          {loading ? (
            <p
              className="text-center text-xs py-4"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Buscando…
            </p>
          ) : resultados.length === 0 ? (
            <p
              className="text-center text-xs py-8"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Sin cotizaciones disponibles para asociar
            </p>
          ) : (
            <ul className="space-y-1.5" role="list">
              {resultados.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => onSelect?.(c.id)}
                    className="w-full text-left rounded-lg border px-3 py-2 cursor-pointer min-h-[56px]"
                    style={{
                      backgroundColor: "hsl(var(--background))",
                      borderColor: "hsl(var(--border))",
                    }}
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p
                            className="text-sm font-bold font-mono"
                            style={{ color: "hsl(var(--primary))" }}
                          >
                            #{c.numero}
                          </p>
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-medium"
                            style={{
                              backgroundColor: "hsl(var(--muted) / 0.4)",
                              color: "hsl(var(--muted-foreground))",
                            }}
                          >
                            {c.estado}
                          </span>
                        </div>
                        <p
                          className="text-sm"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {c.cliente_nombre ?? "Sin cliente"}
                        </p>
                        <p
                          className="text-[10px] font-mono"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {formatDate(c.fecha)}
                        </p>
                      </div>
                      <p
                        className="text-sm font-bold tabular-nums"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {formatCOP(c.total)}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
