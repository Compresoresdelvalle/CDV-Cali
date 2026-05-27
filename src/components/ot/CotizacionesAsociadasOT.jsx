import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Link2, ExternalLink, Unlink } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import FeedbackBanners from "../ui/FeedbackBanners";
import SelectorCotizacionExistente from "./SelectorCotizacionExistente";

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
 * Cotizaciones asociadas a una OT (Fase 10 §10.6 + Fase 11 fix).
 *
 * Muestra lista de cotizaciones con ot_id = ordenId. Permite:
 * - Generar nueva cotización vinculada (warning si ya existe alguna).
 * - Asociar una cotización existente (selector modal) — COPIA sus items
 *   como repuestos a la OT (descuenta stock y suma al total OT).
 * - Desvincular cotización (los repuestos copiados PERMANECEN en la OT;
 *   borrarlos manualmente desde el panel de repuestos si no aplican).
 *
 * Props:
 *   - ordenId: UUID
 *   - readOnly: boolean
 *   - sedeId: TEXT — sede de la OT
 *   - onChange: () => void — callback para que el padre (OrdenDetalle)
 *     refresque sus datos (total, repuestos) tras asociar/desvincular
 */
export default function CotizacionesAsociadasOT({
  ordenId,
  readOnly = false,
  sedeId,
  onChange,
}) {
  const navigate = useNavigate();
  const [cotizaciones, setCotizaciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [showSelector, setShowSelector] = useState(false);
  const [confirmCrearOtra, setConfirmCrearOtra] = useState(false);
  const mountedRef = useRef(true);
  // Guard síncrono: evita disparar dos RPC concurrentes (asociar/desasociar)
  // por un doble-click antes del re-render.
  const accionRef = useRef(false);

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
    if (accionRef.current) return;
    accionRef.current = true;
    try {
      // RPC: setea ot_id + COPIA items a detalle_orden (descuenta stock,
      // recalcula total OT vía triggers). Atómico server-side.
      const { data, error } = await supabase.rpc("fn_asociar_cotizacion_a_ot", {
        p_cotizacion_id: cotId,
        p_ot_id: ordenId,
      });
      if (error) throw error;
      const copiados = data?.items_copiados ?? 0;
      setOkMsg(
        copiados > 0
          ? `Cotización asociada. ${copiados} repuesto(s) copiado(s) a la OT y descontados del inventario.`
          : "Cotización asociada (los repuestos ya estaban en la OT)",
      );
      setShowSelector(false);
      await cargar();
      onChange?.(); // refresca OrdenDetalle (total, repuestos)
    } catch (err) {
      setErrorMsg(safeError(err, "Error al asociar cotización"));
    } finally {
      accionRef.current = false;
    }
  };

  const desasociar = async (cotId) => {
    if (accionRef.current) return;
    accionRef.current = true;
    try {
      // RPC: borra los repuestos copiados de ESTA cotización (los manuales
      // se preservan via cotizacion_id NULL) y quita el vínculo ot_id.
      // Atómico server-side, el trigger reintegra stock al inventario.
      const { data, error } = await supabase.rpc(
        "fn_desasociar_cotizacion_de_ot",
        { p_cotizacion_id: cotId },
      );
      if (error) throw error;
      const borrados = data?.items_borrados ?? 0;
      setOkMsg(
        borrados > 0
          ? `Cotización desvinculada. ${borrados} repuesto(s) copiado(s) eliminado(s) de la OT y reintegrado(s) al inventario.`
          : "Cotización desvinculada (no había repuestos copiados que eliminar)",
      );
      await cargar();
      onChange?.();
    } catch (err) {
      setErrorMsg(safeError(err, "Error al desvincular"));
    } finally {
      accionRef.current = false;
    }
  };

  return (
    <div className="space-y-3">
      <FeedbackBanners errorMsg={errorMsg} okMsg={okMsg} />

      {loading ? (
        <div
          className="h-12 animate-pulse rounded-lg border"
          style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
        />
      ) : cotizaciones.length === 0 ? (
        <p
          className="py-3 text-center text-xs"
          style={{ color: "var(--n-500)" }}
        >
          Sin cotizaciones asociadas
        </p>
      ) : (
        <ul className="space-y-1.5" role="list">
          {cotizaciones.map((c) => {
            const pill = cotizacionPill(c.estado);
            return (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3"
                style={{
                  backgroundColor: "var(--n-25)",
                  borderColor: "var(--n-150)",
                }}
              >
                <button
                  onClick={() => navigate(`/ops/cotizaciones/${c.id}`)}
                  className="link-pill cot"
                  style={{ cursor: "pointer" }}
                >
                  #{c.numero}
                </button>
                <span
                  className="font-mono text-[11.5px]"
                  style={{ color: "var(--n-500)" }}
                >
                  {c.cliente_nombre ?? "Sin cliente"} · {formatDate(c.fecha)}
                </span>
                <span
                  className="ml-auto font-mono text-[13px] font-medium tabular-nums"
                  style={{ color: "var(--n-900)" }}
                >
                  {formatCOP(c.total)}
                </span>
                <span className={pill.cls}>
                  <span className="dot" />
                  {pill.label}
                </span>
                <div className="flex w-full gap-1.5 sm:w-auto">
                  <button
                    onClick={() => navigate(`/ops/cotizaciones/${c.id}`)}
                    className="btn btn-out flex-1 justify-center sm:flex-initial"
                    style={{ height: 44 }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.7} />
                    Ver
                  </button>
                  {!readOnly && (
                    <button
                      onClick={() => desasociar(c.id)}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border text-xs font-medium sm:flex-initial sm:px-3"
                      style={{
                        height: 44,
                        borderColor: "var(--dang-border)",
                        color: "var(--dang-700)",
                      }}
                    >
                      <Unlink className="h-3.5 w-3.5" strokeWidth={1.7} />
                      Desvincular
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onClickCrear}
            className="btn btn-out"
            style={{ height: 48 }}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.7} />
            Generar nueva cotización
          </button>
          <button
            onClick={() => setShowSelector(true)}
            className="btn btn-out"
            style={{ height: 48 }}
          >
            <Link2 className="h-3.5 w-3.5" strokeWidth={1.7} />
            Asociar cotización existente
          </button>
        </div>
      )}

      {/* Modal: confirmar crear otra cuando ya hay 1+ */}
      {confirmCrearOtra && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => setConfirmCrearOtra(false)}
        >
          <div
            className="w-full max-w-md space-y-3 rounded-xl border p-5"
            style={{
              backgroundColor: "var(--n-0)",
              borderColor: "var(--n-150)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              className="text-lg font-semibold"
              style={{ color: "var(--n-950)" }}
            >
              Esta OT ya tiene {cotizaciones.length} cotización
              {cotizaciones.length === 1 ? "" : "es"} asociada
              {cotizaciones.length === 1 ? "" : "s"}
            </h3>
            <p className="text-sm" style={{ color: "var(--n-500)" }}>
              ¿Seguro que quieres crear otra? Lo normal es que una OT tenga 1
              sola cotización. Si la existente ya no aplica, mejor edítala desde
              su detalle.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setConfirmCrearOtra(false)}
                className="rounded-lg border px-4 text-sm font-medium"
                style={{
                  height: 48,
                  borderColor: "var(--n-200)",
                  color: "var(--n-700)",
                  backgroundColor: "var(--n-0)",
                }}
              >
                No, ver existentes
              </button>
              <button
                onClick={irACrearNueva}
                className="rounded-lg px-4 text-sm font-semibold text-white"
                style={{ height: 48, backgroundColor: "var(--warn-500)" }}
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
