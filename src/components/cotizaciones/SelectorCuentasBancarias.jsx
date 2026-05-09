import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { safeError } from "../../lib/utils";

/**
 * Multi-selector de cuentas bancarias para cotizaciones (Fase 11 §1.5).
 * Filtra cuentas activas y permite marcar/desmarcar.
 *
 * Props:
 *   - selectedIds: BIGINT[] (IDs marcados actualmente)
 *   - onChange: (ids: BIGINT[]) => void
 *   - ivaPct: number (para filtrar/sugerir cuentas con/sin IVA)
 *   - readOnly?: boolean
 */
export default function SelectorCuentasBancarias({
  selectedIds = [],
  onChange,
  ivaPct = 19,
  readOnly = false,
}) {
  const [cuentas, setCuentas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("cuentas_bancarias")
          .select("id, banco, tipo, numero, titular, marca_iva, activo")
          .eq("activo", true)
          .order("banco");
        if (!mountedRef.current) return;
        if (error) throw error;
        setCuentas(data ?? []);
      } catch (err) {
        if (mountedRef.current)
          setErrorMsg(safeError(err, "Error al cargar cuentas"));
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    })();
  }, []);

  const isSelected = (id) => selectedIds.includes(id);

  const toggle = (id) => {
    if (readOnly) return;
    const next = isSelected(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    onChange?.(next);
  };

  // Sugerencia: marcar cuentas que coincidan con el IVA elegido
  const sugerencia = ivaPct === 0 ? "sin_iva" : ivaPct > 0 ? "con_iva" : null;

  return (
    <div className="space-y-2">
      {errorMsg && (
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.08)",
            borderColor: "hsl(var(--destructive) / 0.4)",
            color: "hsl(var(--destructive))",
          }}
        >
          {errorMsg}
        </div>
      )}

      <div
        className="rounded-lg border px-3 py-2 text-xs"
        style={{
          backgroundColor: "hsl(var(--info) / 0.08)",
          borderColor: "hsl(var(--info) / 0.4)",
          color: "hsl(var(--info))",
        }}
      >
        ℹ️ Marca las cuentas que aparecerán al pie del PDF de la cotización.
        {sugerencia && (
          <>
            {" "}
            Como esta cotización lleva{" "}
            <strong>{ivaPct === 0 ? "sin IVA" : `IVA ${ivaPct}%`}</strong>,
            idealmente seleccionas cuentas marcadas como
            <strong> {sugerencia === "con_iva" ? "Con IVA" : "Sin IVA"}</strong>
            .
          </>
        )}
      </div>

      {loading ? (
        <div className="space-y-1.5">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="rounded-lg p-2 animate-pulse border h-12"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            />
          ))}
        </div>
      ) : cuentas.length === 0 ? (
        <p
          className="text-xs italic py-3"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          No hay cuentas bancarias activas. Pídele al Admin que las cree en
          Configuración.
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5" role="list">
          {cuentas.map((c) => {
            const active = isSelected(c.id);
            const matchSugerencia = sugerencia && c.marca_iva === sugerencia;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => toggle(c.id)}
                  disabled={readOnly}
                  aria-pressed={active}
                  className="w-full rounded-lg border px-3 py-2 flex items-start gap-2 text-left cursor-pointer min-h-[56px] disabled:opacity-60"
                  style={{
                    backgroundColor: active
                      ? "hsl(var(--success) / 0.10)"
                      : "hsl(var(--card))",
                    borderColor: active
                      ? "hsl(var(--success))"
                      : matchSugerencia
                        ? "hsl(var(--info) / 0.5)"
                        : "hsl(var(--border))",
                  }}
                >
                  <span
                    className="w-5 h-5 mt-0.5 rounded border flex-shrink-0 flex items-center justify-center text-xs font-bold"
                    style={{
                      backgroundColor: active
                        ? "hsl(var(--success))"
                        : "transparent",
                      borderColor: active
                        ? "hsl(var(--success))"
                        : "hsl(var(--border))",
                      color: active
                        ? "hsl(var(--primary-foreground))"
                        : "transparent",
                    }}
                  >
                    ✓
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="text-sm font-semibold"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {c.banco}
                      </span>
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-medium"
                        style={{
                          backgroundColor: "hsl(var(--muted) / 0.4)",
                          color: "hsl(var(--muted-foreground))",
                        }}
                      >
                        {c.tipo}
                      </span>
                      {c.marca_iva && (
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-medium"
                          style={{
                            backgroundColor:
                              c.marca_iva === "con_iva"
                                ? "hsl(var(--info) / 0.15)"
                                : "hsl(var(--warning) / 0.15)",
                            color:
                              c.marca_iva === "con_iva"
                                ? "hsl(var(--info))"
                                : "hsl(var(--warning))",
                          }}
                        >
                          {c.marca_iva === "con_iva" ? "Con IVA" : "Sin IVA"}
                        </span>
                      )}
                    </div>
                    <p
                      className="text-xs font-mono"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {c.numero}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
