import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

/**
 * Carga las sedes ACTIVAS desde la tabla `sedes` (única fuente de verdad).
 *
 * Reemplaza las listas de sedes hardcodeadas en el código: al desactivar o
 * agregar una sede en la base de datos (`activa = true/false`), todos los
 * dropdowns que usan este hook se actualizan sin tocar código.
 *
 * @returns {{ sedes: Array<{id: string, nombre: string}>, loading: boolean, error: string|null }}
 */
export function useSedes() {
  const [sedes, setSedes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let vigente = true;
    supabase
      .from("sedes")
      .select("id, nombre")
      .eq("activa", true)
      .order("nombre")
      .then(({ data, error: err }) => {
        if (!vigente) return;
        if (err) {
          setError("No se pudieron cargar las sedes.");
        } else {
          setSedes(data ?? []);
        }
        setLoading(false);
      });
    return () => {
      vigente = false;
    };
  }, []);

  return { sedes, loading, error };
}
