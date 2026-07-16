import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  rangoBogota,
  aplicarTexto,
  aplicarRango,
  aplicarOpcion,
  etiquetaRango,
} from "../lib/filtros";
import { useDebounce } from "./useDebounce";

/**
 * Estado y aplicación de los filtros reales de un listado.
 *
 * Los filtros se DECLARAN, no se programan: la pantalla dice qué campos tiene y
 * el hook arma la consulta. Así las cuatro trampas (zona horaria de Bogotá,
 * `numero` integer contra ilike, resetear la página, contar en el servidor) se
 * resuelven una vez y no en cada pantalla.
 *
 * La pantalla conserva su propio fetch: el hook no consulta nada. Se usa
 * `valoresAplicados` como dependencia del efecto de carga (ya viene con el
 * debounce del texto) y `aplicar(q)` para armar la consulta.
 *
 * Tipos de campo:
 *   texto    { columnas: string[], numericoA?: 'numero', debounce?: 400 }
 *   fecha    { columna: 'fecha' }            -> valor { desdeDia, hastaDia }
 *   opciones { columna, opciones, comparador?: 'eq'|'ilike-exacto' }
 *
 * @param {{clave: string, campos: Array, persistir?: 'sesion'|false}} config
 */
export function useFiltros({ clave, campos, persistir = "sesion" }) {
  const visibles = useMemo(
    () => campos.filter((c) => c.visible !== false),
    [campos],
  );

  const inicial = useMemo(() => {
    const base = {};
    for (const c of visibles) {
      base[c.id] = c.tipo === "fecha" ? { desdeDia: "", hastaDia: "" } : "";
    }
    if (persistir === "sesion") {
      try {
        const guardado = sessionStorage.getItem(`filtros:${clave}`);
        if (guardado) return { ...base, ...JSON.parse(guardado) };
      } catch {
        // sessionStorage puede fallar (modo privado / cuota). No es motivo
        // para romper la pantalla: se sigue con los filtros en limpio.
      }
    }
    return base;
    // Solo al montar: recalcular esto pisaría lo que el usuario escribió.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [valores, setValores] = useState(inicial);

  // El texto se debounce; el resto aplica de inmediato (un chip es una
  // decisión, no un tecleo).
  const campoTexto = visibles.find((c) => c.tipo === "texto");
  const textoCrudo = campoTexto ? (valores[campoTexto.id] ?? "") : "";
  const textoDebounced = useDebounce(textoCrudo, campoTexto?.debounce ?? 400);

  const valoresAplicados = useMemo(() => {
    if (!campoTexto) return valores;
    return { ...valores, [campoTexto.id]: textoDebounced };
  }, [valores, campoTexto, textoDebounced]);

  useEffect(() => {
    if (persistir !== "sesion") return;
    try {
      sessionStorage.setItem(`filtros:${clave}`, JSON.stringify(valores));
    } catch {
      // Ver arriba: no poder recordar el filtro no puede tumbar el listado.
    }
  }, [clave, valores, persistir]);

  const setValor = useCallback((id, v) => {
    setValores((prev) => ({ ...prev, [id]: v }));
  }, []);

  const limpiar = useCallback(() => {
    const base = {};
    for (const c of visibles) {
      base[c.id] = c.tipo === "fecha" ? { desdeDia: "", hastaDia: "" } : "";
    }
    setValores(base);
  }, [visibles]);

  /** Token de secuencia: descarta respuestas que llegan fuera de orden. */
  const reqIdRef = useRef(0);
  const nuevoReqId = useCallback(() => ++reqIdRef.current, []);
  const esReqVigente = useCallback((id) => id === reqIdRef.current, []);

  /** Mete los filtros activos en un query builder de supabase-js. */
  const aplicar = useCallback(
    (query) => {
      let q = query;
      for (const c of visibles) {
        const v = valoresAplicados[c.id];
        if (c.tipo === "texto") {
          q = aplicarTexto(q, v, {
            columnas: c.columnas,
            numericoA: c.numericoA,
          });
        } else if (c.tipo === "fecha") {
          q = aplicarRango(q, c.columna, rangoBogota(v?.desdeDia, v?.hastaDia));
        } else if (c.tipo === "opciones") {
          q = aplicarOpcion(q, c.columna, v, c.comparador);
        }
      }
      return q;
    },
    [visibles, valoresAplicados],
  );

  /** Chips de filtros activos, con su forma de quitarlos. */
  const activos = useMemo(() => {
    const out = [];
    for (const c of visibles) {
      const v = valores[c.id];
      if (c.tipo === "fecha") {
        if (v?.desdeDia || v?.hastaDia) {
          out.push({
            id: c.id,
            label: c.label,
            valorLegible: etiquetaRango(v),
            quitar: () => setValor(c.id, { desdeDia: "", hastaDia: "" }),
          });
        }
      } else if (v && v !== "" && v !== "Todos") {
        const op = c.opciones?.find(
          (o) => (typeof o === "string" ? o : o.v) === v,
        );
        out.push({
          id: c.id,
          label: c.label,
          valorLegible:
            typeof op === "string" ? op : (op?.l ?? op?.label ?? String(v)),
          quitar: () => setValor(c.id, ""),
        });
      }
    }
    return out;
  }, [visibles, valores, setValor]);

  return {
    campos: visibles,
    valores,
    valoresAplicados,
    setValor,
    limpiar,
    activos,
    aplicar,
    nuevoReqId,
    esReqVigente,
    hayFiltros: activos.length > 0,
  };
}
