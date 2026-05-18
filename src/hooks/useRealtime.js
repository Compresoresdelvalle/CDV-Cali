import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useInventarioStore } from "../stores/inventarioStore";

/**
 * Suscribe al canal Realtime de la tabla `inventario`.
 * - UPDATE: actualiza el item correspondiente en el store sin recargar todo.
 * - INSERT (F12): cuando se crea un producto nuevo (que inserta filas de
 *   inventario en todas las sedes), refresca la lista para que aparezca.
 */
export function useRealtimeInventario() {
  const updateItem = useInventarioStore((s) => s.updateItem);
  const fetchInventario = useInventarioStore((s) => s.fetchInventario);

  useEffect(() => {
    let refetchTimer = null;
    const channel = supabase
      .channel("inventario-realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "inventario" },
        (payload) => {
          // updateItem solo modifica un item ya presente en el store (match
          // por id), así que no inyecta filas de otras sedes no cargadas.
          updateItem(payload.new.id, payload.new);
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "inventario" },
        () => {
          // Crear un producto inserta filas de inventario en varias sedes →
          // varios eventos INSERT seguidos. Se agrupan en un solo re-fetch
          // con debounce para no disparar N recargas (y N resets de página).
          clearTimeout(refetchTimer);
          refetchTimer = setTimeout(() => fetchInventario(false), 400);
        },
      )
      .subscribe();

    return () => {
      clearTimeout(refetchTimer);
      supabase.removeChannel(channel);
    };
  }, [updateItem, fetchInventario]);
}
