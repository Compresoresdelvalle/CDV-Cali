import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X, Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { applyKeywordSearch } from "../../lib/search";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import { formatCOP, safeError } from "../../lib/utils";
import { categoriaClass } from "../../lib/inventario-ui";

/**
 * #33 — Buscador global del topbar. Antes era un botón que solo navegaba a
 * Inventario; ahora es un input real con dropdown de resultados en vivo:
 *   · escribir → busca productos por palabras clave (#32)
 *   · click / Enter sobre un resultado → ficha del producto
 *   · Enter sin selección (o "Ver todos") → Inventario con el término aplicado
 */
export default function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState(null);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const boxRef = useRef(null);
  // Token de secuencia: en tablet con red lenta, una respuesta vieja podía
  // llegar después de una nueva y pisar los resultados (mostrar coincidencias
  // que ya no correspondían a lo tecleado). Descartamos las respuestas obsoletas.
  const seqRef = useRef(0);

  const buscar = useCallback(async (text) => {
    if (text.trim().length < 2) {
      setResultados([]);
      setBuscando(false);
      setErrorBusqueda(null);
      return;
    }
    const id = ++seqRef.current;
    setBuscando(true);
    setErrorBusqueda(null);
    try {
      let pq = supabase
        .from("productos")
        .select(
          "id, nombre, referencia, codigo_interno, categoria, precio_venta",
        )
        .eq("activo", true);
      pq = applyKeywordSearch(pq, text, [
        "nombre",
        "referencia",
        "codigo_interno",
        "codigo_proveedor",
      ]);
      const { data, error } = await pq.order("nombre").limit(1000);
      if (id !== seqRef.current) return; // respuesta obsoleta
      if (error) throw error;
      setResultados(data ?? []);
    } catch (e) {
      if (id !== seqRef.current) return;
      // Antes se tragaba el error y se mostraba "Sin resultados", afirmando que
      // el producto no existe aunque la búsqueda hubiera fallado (red/RLS).
      setErrorBusqueda(safeError(e, "No se pudo buscar. Reintenta."));
      setResultados([]);
    } finally {
      if (id === seqRef.current) setBuscando(false);
    }
  }, []);

  const buscarDebounced = useDebouncedCallback(buscar, 350);

  const onChange = (e) => {
    const v = e.target.value;
    setQ(v);
    setOpen(true);
    setActiveIdx(-1);
    buscarDebounced(v);
  };

  // Cerrar al hacer click fuera.
  useEffect(() => {
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const limpiar = () => {
    setQ("");
    setResultados([]);
    setActiveIdx(-1);
    setOpen(false);
  };

  const irAProducto = (id) => {
    if (!id) return;
    limpiar();
    navigate(`/ops/inventario/${id}`);
  };

  const verTodos = () => {
    const term = q.trim();
    if (term.length < 2) return;
    setOpen(false);
    navigate(`/ops/inventario?q=${encodeURIComponent(term)}`);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(i + 1, resultados.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0 && resultados[activeIdx]) {
        irAProducto(resultados[activeIdx].id);
      } else {
        verTodos();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const mostrarDropdown = open && q.trim().length >= 2;

  return (
    <div ref={boxRef} className="relative min-w-[280px] flex-1 max-w-[480px]">
      {/* Input (estética del topbar oscuro) */}
      <div className="flex h-9 items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 text-[13px] text-white focus-within:border-white/30 focus-within:bg-white/15">
        <Search className="h-4 w-4 shrink-0 text-white/70" strokeWidth={1.75} />
        <input
          type="search"
          value={q}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={() => q.trim().length >= 2 && setOpen(true)}
          placeholder="Buscar productos por nombre, referencia o código…"
          className="flex-1 border-none bg-transparent text-[13px] text-white placeholder:text-white/55 outline-none"
        />
        {q && (
          <button
            type="button"
            onClick={limpiar}
            aria-label="Limpiar búsqueda"
            className="grid h-5 w-5 place-items-center rounded text-white/70 hover:text-white"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        )}
      </div>

      {/* Dropdown de resultados (tarjeta clara flotante) */}
      {mostrarDropdown && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-lg border shadow-lg"
          style={{
            backgroundColor: "var(--n-0)",
            borderColor: "var(--n-200)",
          }}
        >
          {buscando && resultados.length === 0 && (
            <div
              className="flex items-center gap-2 px-3.5 py-3 text-[12.5px]"
              style={{ color: "var(--n-500)" }}
            >
              <Loader2
                className="h-3.5 w-3.5 animate-spin"
                strokeWidth={1.75}
              />
              Buscando…
            </div>
          )}

          {!buscando && errorBusqueda && (
            <div
              className="px-3.5 py-3 text-[12.5px]"
              style={{ color: "var(--dang-600)" }}
            >
              {errorBusqueda}
            </div>
          )}

          {!buscando && !errorBusqueda && resultados.length === 0 && (
            <div
              className="px-3.5 py-3 text-[12.5px]"
              style={{ color: "var(--n-500)" }}
            >
              Sin resultados para “{q.trim()}”
            </div>
          )}

          {resultados.length > 0 && (
            <ul role="listbox" className="max-h-[60vh] overflow-y-auto">
              {resultados.map((p, idx) => {
                const ref = p.codigo_interno ?? p.referencia ?? "—";
                const activo = idx === activeIdx;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={activo}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => irAProducto(p.id)}
                      className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors"
                      style={{
                        backgroundColor: activo ? "var(--n-50)" : "var(--n-0)",
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-[13px] font-medium leading-tight"
                          style={{ color: "var(--n-950)" }}
                        >
                          {p.nombre}
                        </p>
                        <p
                          className="mt-0.5 truncate font-mono text-[11px] tracking-[0.04em]"
                          style={{ color: "var(--n-500)" }}
                        >
                          {ref}
                          {p.categoria && (
                            <span
                              className={`bdg ml-1.5 ${categoriaClass(p.categoria)}`}
                            >
                              {p.categoria}
                            </span>
                          )}
                        </p>
                      </div>
                      {p.precio_venta != null && (
                        <span
                          className="shrink-0 font-mono text-[12px] font-semibold"
                          style={{ color: "var(--n-950)" }}
                        >
                          {formatCOP(p.precio_venta)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Pie: ver todos en Inventario */}
          {q.trim().length >= 2 && (
            <button
              type="button"
              onClick={verTodos}
              className="flex w-full items-center justify-between border-t px-3.5 py-2.5 text-left text-[12px] font-medium transition-colors"
              style={{
                borderColor: "var(--n-150)",
                color: "var(--p-700)",
                backgroundColor: "var(--n-0)",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = "var(--p-50)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "var(--n-0)")
              }
            >
              <span>Ver todos los resultados en Inventario</span>
              <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
