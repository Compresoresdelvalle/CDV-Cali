import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import FeedbackBanners from "../ui/FeedbackBanners";
import SelectorCotizacionExistente from "./SelectorCotizacionExistente";

/**
 * Cotizaciones asociadas a una OT (Fase 10 §10.6).
 *
 * Muestra lista de cotizaciones con ot_id = ordenId. Permite:
 * - Generar nueva cotización vinculada (warning si ya existe alguna).
 * - Asociar una cotización existente (selector modal).
 *
 * Props:
 *   - ordenId: UUID
 *   - readOnly: boolean
 *   - sedeId: TEXT — sede de la OT (para filtrar cotizaciones disponibles)
 */
export default function CotizacionesAsociadasOT({
  ordenId,
  readOnly = false,
  sedeId,
}) {
  const navigate = useNavigate();
  const [cotizaciones, setCotizaciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [showSelector, setShowSelector] = useState(false);
  const [confirmCrearOtra, setConfirmCrearOtra] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const cargar = async () => {
    if (!ordenId) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const { data, error } = await supabase
        .from("cotizaciones")
        .select("id, numero, fecha, cliente_nombre, total, estado")
        .eq("ot_id", ordenId)
        .order("fecha", { ascending: false });
      if (!mountedRef.current) return;
      if (error) throw error;
      setCotizaciones(data ?? []);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar cotizaciones"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordenId]);

  const irACrearNueva = () => {
    setConfirmCrearOtra(false);
    navigate(`/ops/cotizaciones/nueva?ot_id=${ordenId}`);
  };

  const onClickCrear = () => {
    if (cotizaciones.length > 0) {
      setConfirmCrearOtra(true);
    } else {
      irACrearNueva();
    }
  };

  const asociarExistente = async (cotId) => {
    try {
      const { error } = await supabase
        .from("cotizaciones")
        .update({ ot_id: ordenId })
        .eq("id", cotId);
      if (error) throw error;
      setOkMsg("Cotización asociada correctamente");
      setShowSelector(false);
      await cargar();
    } catch (err) {
      setErrorMsg(safeError(err, "Error al asociar cotización"));
    }
  };

  const desasociar = async (cotId) => {
    try {
      const { error } = await supabase
        .from("cotizaciones")
        .update({ ot_id: null })
        .eq("id", cotId);
      if (error) throw error;
      setOkMsg("Cotización desvinculada");
      await cargar();
    } catch (err) {
      setErrorMsg(safeError(err, "Error al desvincular"));
    }
  };

  return (
    <div className="space-y-3">
      <FeedbackBanners errorMsg={errorMsg} okMsg={okMsg} />

      {!readOnly && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={onClickCrear}
            className="text-xs px-3 py-2 rounded-lg cursor-pointer min-h-[48px]"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            📄 Generar nueva cotización
          </button>
          <button
            onClick={() => setShowSelector(true)}
            className="text-xs px-3 py-2 rounded-lg border cursor-pointer min-h-[48px]"
            style={{
              borderColor: "hsl(var(--primary))",
              color: "hsl(var(--primary))",
              backgroundColor: "hsl(var(--card))",
            }}
          >
            🔗 Asociar cotización existente
          </button>
        </div>
      )}

      {loading ? (
        <div
          className="rounded-lg p-3 animate-pulse border h-12"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        />
      ) : cotizaciones.length === 0 ? (
        <p
          className="text-center text-xs py-3"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Sin cotizaciones asociadas
        </p>
      ) : (
        <ul className="space-y-1.5" role="list">
          {cotizaciones.map((c) => (
            <li
              key={c.id}
              className="rounded-lg border px-3 py-2 flex items-center justify-between gap-2"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            >
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
                  <p
                    className="text-sm font-bold tabular-nums"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {formatCOP(c.total)}
                  </p>
                </div>
                <p
                  className="text-[10px] font-mono"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {c.cliente_nombre ?? "Sin cliente"} · {formatDate(c.fecha)}
                </p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => navigate(`/ops/cotizaciones/${c.id}`)}
                  className="text-xs px-2 py-1.5 rounded-lg border cursor-pointer min-h-[44px]"
                  style={{
                    borderColor: "hsl(var(--primary))",
                    color: "hsl(var(--primary))",
                  }}
                >
                  Ver
                </button>
                {!readOnly && (
                  <button
                    onClick={() => desasociar(c.id)}
                    className="text-xs px-2 py-1.5 rounded-lg border cursor-pointer min-h-[44px]"
                    style={{
                      borderColor: "hsl(var(--destructive))",
                      color: "hsl(var(--destructive))",
                    }}
                  >
                    Desvincular
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Modal: confirmar crear otra cuando ya hay 1+ */}
      {confirmCrearOtra && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => setConfirmCrearOtra(false)}
        >
          <div
            className="rounded-xl border p-5 w-full max-w-md space-y-3"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              className="text-lg font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Esta OT ya tiene {cotizaciones.length} cotización
              {cotizaciones.length === 1 ? "" : "es"} asociada
              {cotizaciones.length === 1 ? "" : "s"}
            </h3>
            <p
              className="text-sm"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              ¿Seguro que quieres crear otra? Lo normal es que una OT tenga 1
              sola cotización. Si la existente ya no aplica, mejor edítala desde
              su detalle.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setConfirmCrearOtra(false)}
                className="text-sm px-4 py-2 rounded-lg border cursor-pointer min-h-[48px]"
                style={{
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                No, ver existentes
              </button>
              <button
                onClick={irACrearNueva}
                className="text-sm px-4 py-2 rounded-lg cursor-pointer min-h-[48px]"
                style={{
                  backgroundColor: "hsl(var(--warning))",
                  color: "hsl(var(--primary-foreground))",
                }}
              >
                Sí, crear otra
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal selector de cotización existente */}
      {showSelector && (
        <SelectorCotizacionExistente
          sedeId={sedeId}
          onClose={() => setShowSelector(false)}
          onSelect={asociarExistente}
        />
      )}
    </div>
  );
}
