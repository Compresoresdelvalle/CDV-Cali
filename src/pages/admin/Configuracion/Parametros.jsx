import { useState, useEffect, useRef } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { safeError } from "../../../lib/utils";
import { avisarOk, avisarError } from "../../../lib/notify";
import { invalidateParametro } from "../../../hooks/useParametro";
import { paramLabel } from "../../../lib/admin-config-ui";

// Bounds por key — sincronizado con fn_validate_parametro_value() en BD
const BOUNDS = {
  iva_pct: { min: 0, max: 100 },
  validez_cotizacion_dias: { min: 1, max: 365 },
  dias_alerta_ot_abandonada: { min: 1, max: 3650 },
  dias_garantia_venta: { min: 1, max: 3650 },
  dias_conteo_ciclico: { min: 1, max: 3650 },
};

// Sufijo legible por key (solo presentación)
const SUFFIX = {
  iva_pct: "%",
  validez_cotizacion_dias: "días",
  dias_alerta_ot_abandonada: "días",
  dias_garantia_venta: "días",
  dias_conteo_ciclico: "días",
};

export default function Parametros() {
  const [params, setParams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [edits, setEdits] = useState({}); // { key: value pendiente }
  const [savingKey, setSavingKey] = useState(null);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);

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
    const checkBounds = (n) => {
      const b = BOUNDS[p.key];
      if (b) {
        if (n < b.min) return `Debe ser ≥ ${b.min}`;
        if (n > b.max) return `Debe ser ≤ ${b.max}`;
      } else if (n < 0) {
        return "No puede ser negativo";
      }
      return null;
    };
    if (p.tipo === "int") {
      if (!/^-?\d+$/.test(v)) return "Debe ser entero";
      return checkBounds(parseInt(v, 10));
    } else if (p.tipo === "decimal") {
      if (!/^-?\d+(\.\d+)?$/.test(v)) return "Debe ser numérico";
      return checkBounds(parseFloat(v));
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
    if (savingRef.current) return;
    savingRef.current = true;
    setSavingKey(p.key);
    setErrorMsg("");
    try {
      // updated_by y updated_at los setea el trigger fn_set_updated_by_auth (anti-spoof)
      const { error } = await supabase
        .from("parametros_sistema")
        .update({ value: String(raw).trim() })
        .eq("key", p.key);
      if (error) throw error;
      invalidateParametro(p.key);
      avisarOk(`Parámetro "${p.key}" actualizado`);
      await cargar();
    } catch (e) {
      avisarError(e, "Error al guardar");
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSavingKey(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {errorMsg && <Banner type="destructive">{errorMsg}</Banner>}

      {/* Banner propagación en tiempo real */}
      <WarnBanner title="Propagación en tiempo real">
        Los cambios se aplican en <b>tiempo real</b> a todas las pestañas
        abiertas. Cotizaciones, OTs y otros documentos creados después usarán
        los nuevos valores; los existentes mantienen los suyos. Editar con
        cuidado: afecta toda la operación.
      </WarnBanner>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            />
          ))}
        </div>
      ) : (
        <div
          className="rounded-[10px] border p-5"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
            {params.map((p) => {
              const dirty =
                edits[p.key] !== undefined && edits[p.key] !== p.value;
              const saving = savingKey === p.key;
              const isNum = p.tipo === "int" || p.tipo === "decimal";
              return (
                <ParamCard
                  key={p.key}
                  p={p}
                  value={edits[p.key] ?? p.value}
                  onChange={(v) => setEdits({ ...edits, [p.key]: v })}
                  onSave={() => guardar(p)}
                  dirty={dirty}
                  saving={saving}
                  isNum={isNum}
                  suffix={SUFFIX[p.key]}
                />
              );
            })}
          </div>

          {/* "Días hábiles por defecto" del diseño Lovable no tiene parámetro
              en el esquema → nota honesta, sin selector ficticio. */}
          <div
            className="mt-6 flex items-start gap-2 border-t pt-4 text-[11.5px] leading-relaxed"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            <Info
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              strokeWidth={1.75}
              style={{ color: "hsl(var(--info))" }}
            />
            <span>
              La configuración de{" "}
              <b style={{ color: "hsl(var(--foreground))" }}>
                días hábiles por defecto
              </b>{" "}
              (para cálculo de vencimientos) se habilitará en una versión
              futura; hoy el cálculo usa días calendario.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Tarjeta de parámetro ─────────────────────────────────────────────── */
function ParamCard({
  p,
  value,
  onChange,
  onSave,
  dirty,
  saving,
  isNum,
  suffix,
}) {
  return (
    <div>
      {/* Etiqueta humana (derivada del key) como en el diseño Lovable, con la
          key técnica como subtítulo mono para trazabilidad. */}
      <div
        className="text-[12.5px] font-medium"
        style={{ color: "hsl(var(--foreground))" }}
      >
        {paramLabel(p.key)}
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        <span
          className="font-mono text-[11px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {p.key}
        </span>
        <span
          className="rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium"
          style={{
            backgroundColor: "hsl(var(--muted) / 0.5)",
            color: "hsl(var(--muted-foreground))",
          }}
        >
          {p.tipo}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <div
          className="flex h-12 items-center overflow-hidden rounded-md border"
          style={{
            borderColor: dirty ? "hsl(var(--primary))" : "hsl(var(--border))",
            backgroundColor: "hsl(var(--background))",
          }}
        >
          <input
            type={isNum ? "number" : "text"}
            step={p.tipo === "decimal" ? "0.01" : "1"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={saving}
            className="h-full w-24 bg-transparent px-3 font-mono text-[14px] font-medium tabular-nums focus:outline-none disabled:opacity-50"
            style={{ color: "hsl(var(--foreground))" }}
          />
          {suffix && (
            <span
              className="border-l px-3 text-[12.5px]"
              style={{
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              {suffix}
            </span>
          )}
        </div>
        <button
          onClick={onSave}
          disabled={!dirty || saving}
          className="h-12 rounded-lg px-3 text-xs font-semibold cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            backgroundColor: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
          }}
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>

      <p
        className="mt-2 text-[11.5px] leading-relaxed"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {p.descripcion}
      </p>
      {p.updated_at && (
        <p
          className="mt-1 font-mono text-[10px]"
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
  );
}

function Banner({ type, children }) {
  return (
    <div
      role={type === "destructive" ? "alert" : "status"}
      className="rounded-lg border px-3 py-2 text-xs"
      style={{
        backgroundColor: `hsl(var(--${type}) / 0.08)`,
        borderColor: `hsl(var(--${type}) / 0.4)`,
        color: `hsl(var(--${type}))`,
      }}
    >
      {children}
    </div>
  );
}

function WarnBanner({ title, children }) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg border p-4"
      style={{
        backgroundColor: "hsl(var(--warning) / 0.08)",
        borderColor: "hsl(var(--warning) / 0.3)",
      }}
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0"
        strokeWidth={1.75}
        style={{ color: "hsl(var(--warning))" }}
      />
      <div>
        <div
          className="text-[13px] font-medium"
          style={{ color: "hsl(var(--warning))" }}
        >
          {title}
        </div>
        <div
          className="mt-0.5 text-[12px] leading-relaxed"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
