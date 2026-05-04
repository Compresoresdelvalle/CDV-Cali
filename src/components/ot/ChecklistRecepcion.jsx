import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { safeError } from "../../lib/utils";
import FeedbackBanners from "../ui/FeedbackBanners";

/**
 * Checklist de recepción de OT (Fase 10 §10.1).
 * Consume catálogo `checklist_componentes` (Fase 9) y persiste en `ot_checklist`.
 * Lo MARCADO = sí trae. Lo NO marcado = no llegó (soporte legal).
 *
 * Props:
 *   - ordenId: UUID de la OT
 *   - readOnly: boolean (default false) — si la OT ya está completada/entregada
 *   - onChange: callback opcional cuando se actualiza un check
 */
export default function ChecklistRecepcion({
  ordenId,
  readOnly = false,
  onChange,
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [savingId, setSavingId] = useState(null);
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
      // Sembrar filas faltantes para componentes activos sin marcar
      // (idempotente: el migration ya las creó al INSERT, esto cubre
      // componentes nuevos agregados por admin después de crear la OT)
      const { data: componentes } = await supabase
        .from("checklist_componentes")
        .select("id")
        .eq("activo", true);
      if (componentes?.length) {
        const rows = componentes.map((c) => ({
          orden_id: ordenId,
          componente_id: c.id,
          marcado: false,
        }));
        await supabase.from("ot_checklist").upsert(rows, {
          onConflict: "orden_id,componente_id",
          ignoreDuplicates: true,
        });
      }
      // Cargar checklist con inner-join filtrado por activo (server-side)
      const { data, error } = await supabase
        .from("ot_checklist")
        .select(
          "id, marcado, observacion, componente:componente_id!inner(id, nombre, orden, activo)",
        )
        .eq("orden_id", ordenId)
        .eq("componente.activo", true);
      if (!mountedRef.current) return;
      if (error) throw error;
      // Sort en cliente (multi-criterio: orden numérico, luego nombre)
      const sorted = (data ?? [])
        .slice()
        .sort(
          (a, b) =>
            (a.componente?.orden ?? 0) - (b.componente?.orden ?? 0) ||
            (a.componente?.nombre ?? "").localeCompare(
              b.componente?.nombre ?? "",
            ),
        );
      setItems(sorted);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar checklist"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordenId]);

  const toggleMarca = async (item) => {
    if (readOnly) return;
    setSavingId(item.id);
    setErrorMsg("");
    try {
      const { error } = await supabase
        .from("ot_checklist")
        .update({ marcado: !item.marcado })
        .eq("id", item.id);
      if (error) throw error;
      // Optimistic update local
      setItems((prev) =>
        prev.map((it) =>
          it.id === item.id ? { ...it, marcado: !item.marcado } : it,
        ),
      );
      onChange?.();
    } catch (err) {
      setErrorMsg(safeError(err, "Error al actualizar checklist"));
    } finally {
      if (mountedRef.current) setSavingId(null);
    }
  };

  const totalMarcados = items.filter((it) => it.marcado).length;

  if (loading) {
    return (
      <div className="space-y-1.5">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="rounded-lg p-2 animate-pulse border h-10"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <FeedbackBanners errorMsg={errorMsg} />

      <div
        className="rounded-lg border px-3 py-2 text-xs flex items-center justify-between gap-3"
        style={{
          backgroundColor: "hsl(var(--info) / 0.08)",
          borderColor: "hsl(var(--info) / 0.4)",
          color: "hsl(var(--info))",
        }}
      >
        <span>
          <strong>¿Cómo se usa?</strong> Marca cada componente que el cliente
          entregó FÍSICAMENTE con el equipo. Lo que NO marques queda como prueba
          de que NO llegó — esto te protege legalmente si después reclama.
        </span>
        <span
          className="font-mono font-bold whitespace-nowrap text-base"
          style={{
            color:
              totalMarcados === 0
                ? "hsl(var(--muted-foreground))"
                : "hsl(var(--info))",
          }}
        >
          {totalMarcados} / {items.length}
        </span>
      </div>

      {totalMarcados === 0 && (
        <p
          className="text-xs italic"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Empieza marcando los componentes que ves en el equipo. Click en cada
          tarjeta para marcar/desmarcar.
        </p>
      )}

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5" role="list">
        {items.map((it) => {
          const saving = savingId === it.id;
          return (
            <li key={it.id}>
              <button
                onClick={() => toggleMarca(it)}
                disabled={saving || readOnly}
                aria-pressed={it.marcado}
                className="w-full rounded-lg border px-3 py-2 flex items-center gap-2 text-left cursor-pointer min-h-[44px] disabled:opacity-50"
                style={{
                  backgroundColor: it.marcado
                    ? "hsl(var(--success) / 0.12)"
                    : "hsl(var(--card))",
                  borderColor: it.marcado
                    ? "hsl(var(--success))"
                    : "hsl(var(--border))",
                }}
              >
                <span
                  className="w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center text-xs font-bold"
                  style={{
                    backgroundColor: it.marcado
                      ? "hsl(var(--success))"
                      : "transparent",
                    borderColor: it.marcado
                      ? "hsl(var(--success))"
                      : "hsl(var(--border))",
                    color: it.marcado
                      ? "hsl(var(--primary-foreground))"
                      : "transparent",
                  }}
                >
                  ✓
                </span>
                <span
                  className="text-sm font-medium flex-1 min-w-0 truncate"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {it.componente?.nombre ?? "—"}
                </span>
                {saving && (
                  <span
                    className="text-[10px] font-mono"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    …
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
