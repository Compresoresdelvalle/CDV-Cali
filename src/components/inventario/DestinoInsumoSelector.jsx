import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { safeError } from "../../lib/utils";
import {
  OT_ESTADOS_CERRADOS,
  etiquetaEnsamble,
  etiquetaOT,
  etiquetaPrestamo,
} from "../../lib/insumo-destino";

/**
 * Bloque 2 — "¿Para qué es?" al convertir stock de venta a insumo.
 *
 * Controlado: `value` = { tipo, id, nota } y `onChange(nuevo)`. La validación
 * (qué falta para poder confirmar) vive en `validarDestinoInsumo`, así el
 * padre decide si habilita el botón.
 *
 * Carga, solo de la sede de la conversión: OT abiertas, ensambles sin
 * completar y préstamos de herramienta activos. El RPC rechaza documentos de
 * otra sede, así que no se ofrecen.
 */

const NUEVO = "__nuevo__";

const OPCIONES = [
  { tipo: "orden", label: "OT" },
  { tipo: "ensamble", label: "Ensamble" },
  { tipo: "prestamo", label: "Préstamo de herramienta" },
  { tipo: "otro", label: "Otro" },
];

const controlStyle = {
  backgroundColor: "var(--n-0)",
  borderColor: "var(--n-200)",
  color: "var(--n-900)",
};

export default function DestinoInsumoSelector({
  sedeId,
  esAdmin,
  value,
  onChange,
  disabled,
}) {
  const tipo = value?.tipo ?? "";
  const [docs, setDocs] = useState({ tipo: "", filas: [] });
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState("");
  // En ensamble/préstamo, "nuevo" = todavía no existe el documento: se pide nota.
  const [modoNuevo, setModoNuevo] = useState(false);

  useEffect(() => {
    if (!sedeId || !["orden", "ensamble", "prestamo"].includes(tipo)) return;
    let cancelado = false;
    const cargar = async () => {
      setCargando(true);
      setErrorCarga("");
      try {
        let q;
        if (tipo === "orden") {
          // Las cerradas (entregada, cancelada, abandonada) se filtran en el
          // servidor: el enum ya tiene 'abandonada', y así el límite de 150
          // no se gasta en OTs que no se pueden escoger.
          q = supabase
            .from("ordenes_servicio")
            .select("id, numero, cliente_nombre, equipo_descripcion, estado")
            .eq("sede_id", sedeId)
            .not("estado", "in", `(${OT_ESTADOS_CERRADOS.join(",")})`)
            .order("numero", { ascending: false })
            .limit(150);
        } else if (tipo === "ensamble") {
          q = supabase
            .from("ensambles")
            .select("id, numero, producto:producto_resultado_id(nombre)")
            .eq("sede_id", sedeId)
            .eq("completado", false)
            .order("numero", { ascending: false })
            .limit(100);
        } else {
          q = supabase
            .from("herramientas_prestamo")
            .select("id, herramienta_nombre, usuario:prestada_a(nombre)")
            .eq("sede_id", sedeId)
            .eq("estado_prestamo", "activo")
            .eq("activo", true)
            .order("fecha_prestamo", { ascending: false })
            .limit(150);
        }
        const { data, error } = await q;
        if (error) throw error;
        if (cancelado) return;
        setDocs({ tipo, filas: data ?? [] });
      } catch (err) {
        if (!cancelado) {
          setDocs({ tipo, filas: [] });
          setErrorCarga(
            safeError(
              err,
              "No se pudo cargar la lista. Revisa la conexión y vuelve a escoger la opción.",
            ),
          );
        }
      } finally {
        if (!cancelado) setCargando(false);
      }
    };
    cargar();
    return () => {
      cancelado = true;
    };
  }, [tipo, sedeId]);

  const elegirTipo = (t) => {
    setModoNuevo(false);
    onChange({ tipo: t, id: "", nota: "" });
  };

  const filas = docs.tipo === tipo ? docs.filas : [];
  const etiqueta =
    tipo === "orden"
      ? etiquetaOT
      : tipo === "ensamble"
        ? etiquetaEnsamble
        : etiquetaPrestamo;
  const opciones = esAdmin
    ? [...OPCIONES, { tipo: "ninguno", label: "Sin destino" }]
    : OPCIONES;

  const onSelectDoc = (v) => {
    if (v === NUEVO) {
      setModoNuevo(true);
      onChange({ tipo, id: "", nota: value?.nota ?? "" });
    } else {
      setModoNuevo(false);
      onChange({ tipo, id: v, nota: "" });
    }
  };

  const selectValue = modoNuevo ? NUEVO : (value?.id ?? "");
  const pideNota =
    tipo === "otro" ||
    ((tipo === "ensamble" || tipo === "prestamo") && modoNuevo);

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend
        className="mb-1 text-xs font-semibold"
        style={{ color: "var(--n-700)" }}
      >
        ¿Para qué es?
        {!esAdmin && (
          <span className="font-normal" style={{ color: "var(--n-500)" }}>
            {" "}
            (obligatorio)
          </span>
        )}
      </legend>
      <div className="grid grid-cols-2 gap-2">
        {opciones.map((o) => {
          const activo = tipo === o.tipo;
          return (
            <button
              key={o.tipo}
              type="button"
              aria-pressed={activo}
              onClick={() => elegirTipo(o.tipo)}
              className="min-h-[48px] rounded-lg border px-3 py-2 text-left text-sm font-medium leading-tight disabled:opacity-50"
              style={{
                backgroundColor: activo ? "var(--p-50)" : "var(--n-0)",
                borderColor: activo ? "var(--p-600)" : "var(--n-200)",
                color: activo ? "var(--p-800)" : "var(--n-800)",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      {["orden", "ensamble", "prestamo"].includes(tipo) && (
        <div>
          <label
            htmlFor="destino-doc"
            className="text-xs"
            style={{ color: "var(--n-500)" }}
          >
            {tipo === "orden"
              ? "OT abierta de esta sede"
              : tipo === "ensamble"
                ? "Ensamble de esta sede"
                : "Préstamo activo de esta sede"}
          </label>
          <select
            id="destino-doc"
            value={selectValue}
            onChange={(e) => onSelectDoc(e.target.value)}
            disabled={disabled || cargando}
            className="mt-1 min-h-[48px] w-full rounded-lg border px-3 py-2 text-sm"
            style={controlStyle}
          >
            <option value="">
              {cargando ? "Cargando..." : "Escoge una opción"}
            </option>
            {tipo === "ensamble" && (
              <option value={NUEVO}>Ensamble que voy a crear</option>
            )}
            {tipo === "prestamo" && (
              <option value={NUEVO}>Préstamo nuevo</option>
            )}
            {filas.map((r) => (
              <option key={r.id} value={r.id}>
                {etiqueta(r)}
              </option>
            ))}
          </select>
          {errorCarga && (
            <p className="mt-1 text-xs" style={{ color: "var(--dang-700)" }}>
              {errorCarga}
            </p>
          )}
          {!cargando && !errorCarga && filas.length === 0 && (
            <p className="mt-1 text-xs" style={{ color: "var(--n-500)" }}>
              {tipo === "orden"
                ? "No hay OT abiertas en esta sede. Si el insumo es para una OT, créala primero; si no, escoge otra opción."
                : tipo === "ensamble"
                  ? "No hay ensambles abiertos en esta sede: escoge «Ensamble que voy a crear»."
                  : "No hay préstamos activos en esta sede: escoge «Préstamo nuevo»."}
            </p>
          )}
        </div>
      )}

      {pideNota && (
        <div>
          <label
            htmlFor="destino-nota"
            className="text-xs"
            style={{ color: "var(--n-500)" }}
          >
            {tipo === "ensamble"
              ? "¿Qué ensamble vas a crear?"
              : tipo === "prestamo"
                ? "¿Para quién es la herramienta?"
                : "¿Para qué es? (nota corta)"}
          </label>
          <input
            id="destino-nota"
            type="text"
            maxLength={200}
            value={value?.nota ?? ""}
            onChange={(e) => onChange({ tipo, id: "", nota: e.target.value })}
            className="mt-1 min-h-[48px] w-full rounded-lg border px-3 py-2 text-sm"
            style={controlStyle}
          />
        </div>
      )}
    </fieldset>
  );
}
