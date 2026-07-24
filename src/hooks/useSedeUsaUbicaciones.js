import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

/**
 * ¿La sede indicada realmente ubica productos (pasillo/estante/nivel)?
 *
 * Reemplaza la heurística local que había en PickingPage y Conteo ("¿alguna
 * fila de la lista YA CARGADA tiene ubicación?"): esa heurística tenía un
 * falso negativo real — si la lista cargada (un traspaso puntual, la cola
 * de un día) traía por casualidad solo productos sin ubicar, el chip "Sin
 * ubicar" desaparecía aunque la sede sí ubique productos (hoy BODEGA),
 * justo cuando avisar sería más útil. Y en el modal de conteo manual no
 * había ninguna lista de la que sacar la heurística, así que ese chip
 * quedó sin el aviso.
 *
 * La respuesta real: ¿existe al menos una fila de `inventario` de esa sede
 * con `ubicacion_id` no nulo? Consulta de EXISTENCIA (limit 1), no un
 * conteo del universo — y cacheada por sede a nivel de módulo, porque esto
 * se llama desde varias pantallas y no puede disparar una consulta de red
 * por cada render o montaje.
 *
 * Si la consulta falla o la sede viene vacía/indefinida, la respuesta es
 * FALSE: es la opción segura, el mismo comportamiento que había antes de
 * todo esto (el chip no se muestra). Un fallo de red nunca debe terminar
 * pintando "Sin ubicar" en todas las filas.
 */

// Caché en memoria por sede — vive mientras dure la sesión (una recarga de
// página la limpia). No se invalida activamente: si una sede empieza a
// ubicar productos hoy, el chip no necesita reaccionar en caliente.
const cache = new Map(); // sedeId -> boolean
const inflight = new Map(); // sedeId -> Promise<boolean>

async function fetchUsaUbicaciones(sedeId) {
  if (cache.has(sedeId)) return cache.get(sedeId);
  if (inflight.has(sedeId)) return inflight.get(sedeId);

  const promise = (async () => {
    try {
      const { data, error } = await supabase
        .from("inventario")
        .select("id")
        .eq("sede_id", sedeId)
        .not("ubicacion_id", "is", null)
        .limit(1);
      const resultado = !error && !!data && data.length > 0;
      cache.set(sedeId, resultado);
      return resultado;
    } catch {
      // No se cachea: un error transitorio de red no debe condenar la
      // sede a "no usa ubicaciones" para el resto de la sesión.
      return false;
    } finally {
      inflight.delete(sedeId);
    }
  })();
  inflight.set(sedeId, promise);
  return promise;
}

/**
 * @param {string|null|undefined} sedeId
 * @returns {boolean} true si esa sede tiene al menos un producto ubicado
 */
export function useSedeUsaUbicaciones(sedeId) {
  // Arranca en falso y solo se enciende cuando llega la respuesta real:
  // así el chip "Sin ubicar" nunca parpadea (pintarse y desaparecer, o al
  // revés) mientras la consulta está en vuelo.
  const [usaUbicaciones, setUsaUbicaciones] = useState(false);

  useEffect(() => {
    if (!sedeId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUsaUbicaciones(false);
      return;
    }
    if (cache.has(sedeId)) {
      setUsaUbicaciones(cache.get(sedeId));
      return;
    }
    let vigente = true;
    // Al cambiar de sedeId hay que resetear: si la sede anterior ya había
    // resuelto en `true`, sin esto el chip mostraría "usa ubicaciones" de
    // la sede vieja mientras la nueva todavía está en vuelo.
    setUsaUbicaciones(false);
    fetchUsaUbicaciones(sedeId).then((resultado) => {
      if (vigente) setUsaUbicaciones(resultado);
    });
    return () => {
      vigente = false;
    };
  }, [sedeId]);

  return usaUbicaciones;
}
