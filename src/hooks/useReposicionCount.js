import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { ROLE_MODULES } from "../lib/constants";

/** Solo cuenta para quien puede abrir Inventario: al Técnico el badge le
 *  exigiría atención sobre un módulo al que no tiene acceso. */
export const puedeVerInventario = (perfil) =>
  Boolean(perfil?.rol && ROLE_MODULES[perfil.rol]?.includes("Inventario"));

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
  // Sufijo único por montaje. Con un nombre fijo, al navegar entre /ops y
  // /admin el shell nuevo pedía el canal mientras el del shell viejo seguía en
  // estado `leaving`: supabase reutiliza el canal por topic, el subscribe() no
  // hacía nada por no estar cerrado, y el badge se quedaba sin actualizarse.
  const canalRef = useRef(null);

  // Primitivas sueltas: usando `perfil?.x` directo en las deps, el compilador de
  // React infiere `perfil` entero y no puede preservar la memoización.
  const perfilId = perfil?.id;
  const perfilRol = perfil?.rol;
  const perfilSedeId = perfil?.sede_id;
  const tieneInventario = puedeVerInventario({ rol: perfilRol });

  const fetchCount = useCallback(async () => {
    if (!perfilId || !tieneInventario) return;
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
  }, [perfilId, perfilRol, perfilSedeId, tieneInventario]);

  useEffect(() => {
    if (!perfilId || !tieneInventario) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCount();

    // Debounce de cola: la suscripción es sobre TODA la tabla `inventario`, así
    // que una venta de 20 líneas disparaba 20 recuentos sobre ~2.900 filas en
    // cada dispositivo conectado. Con esto, una venta produce un recuento.
    const programar = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(fetchCount, 3000);
    };

    if (!canalRef.current) {
      canalRef.current = `reposicion-count-${Math.random().toString(36).slice(2)}`;
    }

    const channel = supabase
      .channel(canalRef.current)
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
  }, [perfilId, tieneInventario, fetchCount]);

  return count;
}
