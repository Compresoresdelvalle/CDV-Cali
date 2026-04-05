import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useInventarioStore } from '../stores/inventarioStore'

/**
 * Suscribe al canal Realtime de la tabla `inventario`.
 * Cuando llega un UPDATE, actualiza el item correspondiente en el store
 * sin necesidad de recargar toda la lista.
 */
export function useRealtimeInventario() {
  const updateItem = useInventarioStore(s => s.updateItem)

  useEffect(() => {
    const channel = supabase
      .channel('inventario-realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'inventario' },
        (payload) => {
          updateItem(payload.new.id, payload.new)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [updateItem])
}
