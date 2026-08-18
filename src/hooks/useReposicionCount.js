import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";

/**
 * Conteo de líneas de reposición sugerida (`v_sugerencias_reorden`).
 *
 * Reemplaza al viejo conteo de `estado_stock IN ('Bajo','Agotado')`, que daba
 * 2.868 de los cuales 2.853 eran ceros legítimos de sedes que nunca han tenido
 * el producto. Esto da ~76, que sí es trabajo que alguien puede atender.
 *
 * La RLS de `inventario` es `USING (true)`, así que la vista NO se limita sola
 * a la sede del usuario aunque sea security_invoker: el filtro va explícito.
 */
export function useReposicionCount(perfil) {
  const [count, setCount] = useState(0);
  const timerRef = useRef(null);

  // Primitivas sueltas: usando `perfil?.x` directo en las deps, el compilador de
  // React infiere `perfil` entero y no puede preservar la memoización.
  const perfilId = perfil?.id;
  const perfilRol = perfil?.rol;
  const perfilSedeId = perfil?.sede_id;

  const fetchCount = useCallback(async () => {
    if (!perfilId) return;
    let q = supabase
      .from("v_sugerencias_reorden")
      .select("producto_id", { count: "exact", head: true });

    if (perfilRol !== "Admin" && perfilSedeId) {
      q = q.eq("sede_id", perfilSedeId);
    }

    const { count: c, error } = await q;
    // Si falla, conservar el último conteo conocido en vez de caer a 0: un 0
    // falso se lee como "todo en orden" y es el peor error posible en un badge.
    if (!error) setCount(c ?? 0);
  }, [perfilId, perfilRol, perfilSedeId]);

  useEffect(() => {
    if (!perfilId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCount();

    // Debounce de cola: la suscripción es sobre TODA la tabla `inventario`, así
    // que una venta de 20 líneas disparaba 20 recuentos sobre ~2.900 filas en
    // cada dispositivo conectado. Con esto, una venta produce un recuento.
    const programar = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(fetchCount, 3000);
    };

    const channel = supabase
      .channel("reposicion-count")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventario" },
        programar,
      )
      .subscribe();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      supabase.removeChannel(channel);
    };
  }, [perfilId, fetchCount]);

  return count;
}
