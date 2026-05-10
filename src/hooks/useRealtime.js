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
    const channel = supabase
      .channel("inventario-realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "inventario" },
        (payload) => {
          updateItem(payload.new.id, payload.new);
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "inventario" },
        () => {
          // Producto nuevo: refrescar lista (no podemos sólo agregar el item
          // porque el SELECT del store hace JOIN a productos y la fila INSERT
          // no trae esos campos). Re-fetch es lo más simple y barato.
          fetchInventario(false);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [updateItem, fetchInventario]);
}
