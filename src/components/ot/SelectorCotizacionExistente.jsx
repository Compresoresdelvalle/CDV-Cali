import { useState, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import FeedbackBanners from "../ui/FeedbackBanners";

// Estado de cotización real → variante de `.s-pill`.
function cotizacionPill(estado) {
  switch (estado) {
    case "aprobada":
      return { cls: "s-pill s-apr", label: "Aprobada" };
    case "enviada":
      return { cls: "s-pill s-env", label: "Enviada" };
    case "rechazada":
      return { cls: "s-pill s-rec", label: "Rechazada" };
    case "vencida":
      return { cls: "s-pill s-borr", label: "Vencida" };
    case "borrador":
    default:
      return { cls: "s-pill s-borr", label: estado ?? "Borrador" };
  }
}

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
        .limit(1000);
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

  const buscarDebounced = useDebouncedCallback(buscar, 400);

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
        className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-3 overflow-hidden rounded-xl border p-5"
        style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3
            className="text-lg font-semibold"
            style={{ color: "var(--n-950)" }}
          >
            Asociar cotización existente
          </h3>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="grid place-items-center rounded-lg border"
            style={{
              width: 44,
              height: 44,
              borderColor: "var(--n-200)",
              color: "var(--n-500)",
            }}
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>

        <p className="text-xs" style={{ color: "var(--n-500)" }}>
          Solo cotizaciones de tu sede que aún no estén vinculadas a otra OT.
        </p>

        <div
          className="flex h-12 items-center gap-2.5 rounded-lg border px-3.5"
          style={{ borderColor: "var(--n-200)", backgroundColor: "var(--n-0)" }}
        >
          <Search
            className="h-4 w-4 shrink-0"
            strokeWidth={1.5}
            style={{ color: "var(--n-500)" }}
          />
          <input
            type="text"
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value);
              buscarDebounced(e.target.value);
            }}
            placeholder="Buscar por número o nombre del cliente…"
            className="min-w-0 flex-1 border-none bg-transparent text-sm outline-none"
            style={{ color: "var(--n-950)" }}
            autoFocus
          />
        </div>

        <FeedbackBanners errorMsg={errorMsg} />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <p
              className="py-4 text-center text-xs"
              style={{ color: "var(--n-500)" }}
            >
              Buscando…
            </p>
          ) : resultados.length === 0 ? (
            <p
              className="py-8 text-center text-xs"
              style={{ color: "var(--n-500)" }}
            >
              Sin cotizaciones disponibles para asociar
            </p>
          ) : (
            <ul
              className="max-h-80 space-y-1.5 overflow-y-auto pr-1"
              role="list"
            >
              {resultados.map((c) => {
                const pill = cotizacionPill(c.estado);
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => onSelect?.(c.id)}
                      className="w-full rounded-lg border px-3.5 py-3 text-left transition-colors"
                      style={{
                        minHeight: 56,
                        backgroundColor: "var(--n-25)",
                        borderColor: "var(--n-150)",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor = "var(--n-50)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = "var(--n-25)")
                      }
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className="font-mono text-sm font-semibold"
                              style={{ color: "var(--p-600)" }}
                            >
                              #{c.numero}
                            </span>
                            <span className={pill.cls}>
                              <span className="dot" />
                              {pill.label}
                            </span>
                          </div>
                          <p
                            className="mt-0.5 text-sm"
                            style={{ color: "var(--n-950)" }}
                          >
                            {c.cliente_nombre ?? "Sin cliente"}
                          </p>
                          <p
                            className="font-mono text-[10.5px]"
                            style={{ color: "var(--n-300)" }}
                          >
                            {formatDate(c.fecha)}
                          </p>
                        </div>
                        <p
                          className="font-mono text-sm font-medium tabular-nums"
                          style={{ color: "var(--n-900)" }}
                        >
                          {formatCOP(c.total)}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
