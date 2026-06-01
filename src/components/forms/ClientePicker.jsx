import { useState, useRef, useEffect, useCallback } from "react";
import { Search, User, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { sanitizeSearch } from "../../lib/utils";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";

/**
 * ClientePicker — autocompletado de clientes reutilizables (Bloque 0 #2).
 *
 * Input de texto libre con dropdown de coincidencias sobre la tabla `clientes`
 * (SELECT lo permite cualquier autenticado, RLS). NO bloquea texto libre: si el
 * cliente aún no existe, el usuario simplemente escribe el nombre y al guardar el
 * documento padre se hace `fn_upsert_cliente` para crearlo/reutilizarlo.
 *
 * Props:
 *   value       : string         — valor controlado del nombre (campo del padre)
 *   onChange    : (texto) => void — al teclear (texto libre). El padre actualiza su estado de nombre.
 *   onSelect    : (cliente) => void — al elegir una coincidencia. Recibe la fila completa
 *                                     { id, nombre, identificacion, telefono, email, direccion }.
 *   placeholder : string?
 *   className   : string?        — clases extra para el <input>
 *   inputStyle  : object?        — estilos inline extra para el <input>
 *   required    : bool?
 *   id          : string?
 *   autoFocus   : bool?
 */
export default function ClientePicker({
  value,
  onChange,
  onSelect,
  placeholder = "Nombre del cliente",
  className = "",
  inputStyle,
  required = false,
  id,
  autoFocus = false,
}) {
  const [resultados, setResultados] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [activo, setActivo] = useState(-1);
  const wrapperRef = useRef(null);
  // Evita reabrir el dropdown justo después de seleccionar.
  const acabaDeSeleccionar = useRef(false);

  const buscar = useCallback(async (q) => {
    const term = (q ?? "").trim();
    if (term.length < 2) {
      setResultados([]);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    try {
      const safe = sanitizeSearch(term);
      const { data, error } = await supabase
        .from("clientes")
        .select("id, nombre, identificacion, telefono, email, direccion")
        .eq("activo", true)
        .or(`nombre.ilike.%${safe}%,identificacion.ilike.%${safe}%`)
        .order("nombre", { ascending: true })
        .limit(1000);
      if (error) throw error;
      setResultados(data ?? []);
      if (!acabaDeSeleccionar.current) setAbierto(true);
    } catch {
      setResultados([]);
    } finally {
      setBuscando(false);
    }
  }, []);

  const buscarDebounced = useDebouncedCallback(buscar, 350);

  const handleChange = (e) => {
    const val = e.target.value;
    acabaDeSeleccionar.current = false;
    setActivo(-1);
    onChange?.(val);
    buscarDebounced(val);
  };

  const seleccionar = (cliente) => {
    acabaDeSeleccionar.current = true;
    setAbierto(false);
    setResultados([]);
    setActivo(-1);
    onChange?.(cliente.nombre ?? "");
    onSelect?.(cliente);
  };

  const handleKeyDown = (e) => {
    if (!abierto || resultados.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActivo((i) => Math.min(i + 1, resultados.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActivo((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activo >= 0) {
      e.preventDefault();
      seleccionar(resultados[activo]);
    } else if (e.key === "Escape") {
      setAbierto(false);
    }
  };

  // Cerrar al hacer click fuera.
  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setAbierto(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
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
          id={id}
          type="text"
          value={value ?? ""}
          onChange={handleChange}
          onFocus={() => {
            if (resultados.length > 0 && !acabaDeSeleccionar.current)
              setAbierto(true);
          }}
          onKeyDown={handleKeyDown}
          required={required}
          autoFocus={autoFocus}
          autoComplete="off"
          placeholder={placeholder}
          className={
            "min-w-0 flex-1 border-none bg-transparent text-[14px] outline-none " +
            className
          }
          style={{ color: "var(--n-950)", ...inputStyle }}
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              acabaDeSeleccionar.current = false;
              onChange?.("");
              setResultados([]);
              setAbierto(false);
            }}
            aria-label="Limpiar"
            className="grid h-6 w-6 shrink-0 place-items-center rounded"
            style={{ color: "var(--n-500)" }}
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        )}
      </div>

      {abierto && (buscando || resultados.length > 0) && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-72 overflow-y-auto overflow-hidden rounded-lg border shadow-lg"
          style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
          role="listbox"
        >
          {buscando && resultados.length === 0 ? (
            <p className="px-4 py-3 text-xs" style={{ color: "var(--n-500)" }}>
              Buscando…
            </p>
          ) : (
            resultados.map((c, idx) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={idx === activo}
                onMouseDown={(e) => {
                  // mousedown (no click) para no perder el foco antes de seleccionar.
                  e.preventDefault();
                  seleccionar(c);
                }}
                onMouseEnter={(e) => {
                  setActivo(idx);
                  e.currentTarget.style.backgroundColor = "var(--n-50)";
                }}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor =
                    idx === activo ? "var(--n-50)" : "var(--n-0)")
                }
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
                style={{
                  borderTop: idx === 0 ? "none" : "1px solid var(--n-100)",
                  backgroundColor:
                    idx === activo ? "var(--n-50)" : "var(--n-0)",
                }}
              >
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
                  style={{
                    backgroundColor: "var(--p-50)",
                    color: "var(--p-600)",
                  }}
                >
                  <User className="h-4 w-4" strokeWidth={1.7} />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-sm font-medium"
                    style={{ color: "var(--n-950)" }}
                  >
                    {c.nombre}
                  </span>
                  <span
                    className="block truncate font-mono text-[11px]"
                    style={{ color: "var(--n-500)" }}
                  >
                    {[c.identificacion, c.telefono]
                      .filter(Boolean)
                      .join(" · ") || "Sin identificación"}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
