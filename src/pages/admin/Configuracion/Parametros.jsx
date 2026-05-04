import { useState, useEffect, useRef } from "react";
import { supabase } from "../../../lib/supabase";
import { safeError } from "../../../lib/utils";
import { useAuthStore } from "../../../stores/authStore";
import { invalidateParametro } from "../../../hooks/useParametro";

export default function Parametros() {
  const perfil = useAuthStore((s) => s.perfil);
  const [params, setParams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [edits, setEdits] = useState({}); // { key: value pendiente }
  const [savingKey, setSavingKey] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const cargar = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const { data, error } = await supabase
        .from("parametros_sistema")
        .select("*, updated_by_usuario:updated_by(nombre)")
        .order("key");
      if (!mountedRef.current) return;
      if (error) throw error;
      setParams(data ?? []);
      setEdits({});
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar parámetros"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  const validate = (p, raw) => {
    const v = String(raw).trim();
    if (!v) return "Valor obligatorio";
    if (p.tipo === "int") {
      if (!/^-?\d+$/.test(v)) return "Debe ser entero";
      const n = parseInt(v, 10);
      if (n <= 0 && p.key !== "iva_pct") return "Debe ser > 0";
      if (n < 0) return "No puede ser negativo";
    } else if (p.tipo === "decimal") {
      if (!/^-?\d+(\.\d+)?$/.test(v)) return "Debe ser numérico";
    } else if (p.tipo === "bool") {
      if (!["true", "false"].includes(v)) return "Debe ser true o false";
    }
    return null;
  };

  const guardar = async (p) => {
    const raw = edits[p.key] ?? p.value;
    const err = validate(p, raw);
    if (err) {
      setErrorMsg(`${p.key}: ${err}`);
      return;
    }
    setSavingKey(p.key);
    setErrorMsg("");
    setOkMsg("");
    try {
      const { error } = await supabase
        .from("parametros_sistema")
        .update({
          value: String(raw).trim(),
          updated_by: perfil?.id ?? null,
        })
        .eq("key", p.key);
      if (error) throw error;
      invalidateParametro(p.key);
      setOkMsg(`Parámetro "${p.key}" actualizado`);
      await cargar();
    } catch (e) {
      setErrorMsg(safeError(e, "Error al guardar"));
    } finally {
      if (mountedRef.current) setSavingKey(null);
    }
  };

  return (
    <div className="space-y-3">
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
      {okMsg && (
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            backgroundColor: "hsl(var(--success) / 0.08)",
            borderColor: "hsl(var(--success) / 0.4)",
            color: "hsl(var(--success))",
          }}
        >
          {okMsg}
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
        ℹ️ Parámetros consumidos por las demás fases (cotizaciones, OT,
        garantías, conteo). Editar con cuidado: los cambios afectan toda la
        operación.
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="rounded-lg p-3 animate-pulse border h-16"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            />
          ))}
        </div>
      ) : (
        <ul className="space-y-2" role="list">
          {params.map((p) => {
            const dirty =
              edits[p.key] !== undefined && edits[p.key] !== p.value;
            const saving = savingKey === p.key;
            return (
              <li
                key={p.key}
                className="rounded-lg border p-3"
                style={{
                  backgroundColor: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                }}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p
                        className="text-sm font-mono font-semibold"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {p.key}
                      </p>
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-medium"
                        style={{
                          backgroundColor: "hsl(var(--muted) / 0.4)",
                          color: "hsl(var(--muted-foreground))",
                        }}
                      >
                        {p.tipo}
                      </span>
                    </div>
                    <p
                      className="text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {p.descripcion}
                    </p>
                    {p.updated_at && (
                      <p
                        className="text-[10px] font-mono mt-1"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        Última edición:{" "}
                        {new Date(p.updated_at).toLocaleString("es-CO", {
                          timeZone: "America/Bogota",
                        })}
                        {p.updated_by_usuario?.nombre
                          ? ` · ${p.updated_by_usuario.nombre}`
                          : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type={
                        p.tipo === "int" || p.tipo === "decimal"
                          ? "number"
                          : "text"
                      }
                      step={p.tipo === "decimal" ? "0.01" : "1"}
                      value={edits[p.key] ?? p.value}
                      onChange={(e) =>
                        setEdits({ ...edits, [p.key]: e.target.value })
                      }
                      disabled={saving}
                      className="w-28 px-3 py-2 rounded-lg border text-sm font-mono min-h-[40px] disabled:opacity-50"
                      style={{
                        backgroundColor: "hsl(var(--background))",
                        borderColor: dirty
                          ? "hsl(var(--primary))"
                          : "hsl(var(--border))",
                        color: "hsl(var(--foreground))",
                      }}
                    />
                    <button
                      onClick={() => guardar(p)}
                      disabled={!dirty || saving}
                      className="text-xs px-3 py-2 rounded-lg cursor-pointer min-h-[40px] disabled:opacity-50"
                      style={{
                        backgroundColor: "hsl(var(--primary))",
                        color: "hsl(var(--primary-foreground))",
                      }}
                    >
                      {saving ? "Guardando…" : "Guardar"}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
