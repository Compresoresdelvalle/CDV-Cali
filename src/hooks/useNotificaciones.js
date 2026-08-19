import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";

const COLS = "id, tipo, titulo, mensaje, data, leida, created_at, updated_at";

/**
 * Estado de la campana de notificaciones, para que lo llame el SHELL una sola vez.
 *
 * Vive aquí y no dentro del botón porque los headers de escritorio y móvil se
 * montan los dos a la vez (solo se ocultan por CSS). Con el estado dentro del
 * botón había dos instancias pidiendo el canal "notificaciones-feed"; como
 * supabase reutiliza el canal por topic, la segunda añadía un binding que el
 * servidor no conocía y el canal se autodestruía: el realtime no funcionaba
 * nunca. Un solo hook = un solo canal = un solo fetch.
 *
 * Filtra por `para_rol`: la RLS también deja ver lo que uno mismo creó
 * (`created_by = auth.uid()`), y sin este filtro una vendedora veía —y podía
 * marcar como leídas— las 446 notificaciones dirigidas al Admin que ella misma
 * había generado al convertir a insumo.
 */
export function useNotificaciones(perfil) {
  const [items, setItems] = useState([]);
  const [noLeidas, setNoLeidas] = useState(0);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);
  // Sufijo único por montaje: evita reutilizar el canal de un shell que se está
  // desmontando (queda en estado `leaving` y el nuevo `subscribe()` no haría nada).
  // Se sortea dentro del efecto, no aquí, porque el render debe ser puro.
  const canalRef = useRef(null);

  const rol = perfil?.rol;

  const cargarConteo = useCallback(async () => {
    if (!rol) return;
    const { count, error: e } = await supabase
      .from("notificaciones")
      .select("id", { count: "exact", head: true })
      .eq("para_rol", rol)
      .eq("leida", false);
    // Si falla, conservar el último conteo en vez de mentir con 0.
    if (!e) setNoLeidas(count ?? 0);
  }, [rol]);

  const cargarLista = useCallback(async () => {
    if (!rol) return;
    const { data, error: e } = await supabase
      .from("notificaciones")
      .select(COLS)
      .eq("para_rol", rol)
      // updated_at y no created_at: un aviso agrupado que se actualiza debe
      // subir a la cabeza de la lista, y su created_at no cambia.
      .order("updated_at", { ascending: false })
      .limit(30);
    if (e) setError(e.message ?? "No se pudo cargar");
    else {
      setError(null);
      setItems(data ?? []);
    }
  }, [rol]);

  const refrescar = useCallback(() => {
    cargarConteo();
    cargarLista();
  }, [cargarConteo, cargarLista]);

  useEffect(() => {
    if (!rol) return;
    if (!canalRef.current) {
      canalRef.current = `notificaciones-feed-${Math.random()
        .toString(36)
        .slice(2)}`;
    }
    // Carga inicial: el setState ocurre tras el await, pero la regla no lo
    // distingue. Mismo patrón que useReposicionCount.js / useParametro.js.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refrescar();

    // Debounce: "Marcar todas leídas" actualiza cientos de filas y cada una
    // emite un evento. Sin esto, un solo clic dispararía cientos de recargas.
    const programar = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(refrescar, 800);
    };

    const channel = supabase
      .channel(canalRef.current)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notificaciones" },
        programar,
      )
      .subscribe();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      supabase.removeChannel(channel);
    };
  }, [rol, refrescar]);

  const marcarUna = useCallback(
    async (id) => {
      const previas = items;
      setItems((rows) =>
        rows.map((r) => (r.id === id ? { ...r, leida: true } : r)),
      );
      setNoLeidas((c) => Math.max(0, c - 1));
      const { error: e } = await supabase
        .from("notificaciones")
        .update({ leida: true })
        .eq("id", id);
      // Revertir el optimismo si el servidor no lo aceptó: si no, el badge
      // queda bajo para siempre y la fila sigue sin leer en la base.
      if (e) {
        setItems(previas);
        await cargarConteo();
      }
    },
    [items, cargarConteo],
  );

  const marcarTodas = useCallback(async () => {
    if (!rol || noLeidas === 0) return;
    setItems((rows) => rows.map((n) => ({ ...n, leida: true })));
    setNoLeidas(0);
    // Sin lista de ids: barre todo lo del rol, no solo las 30 cargadas.
    // El .eq("para_rol") es lo que impide apagar la campana de otro rol.
    await supabase
      .from("notificaciones")
      .update({ leida: true })
      .eq("para_rol", rol)
      .eq("leida", false);
    // Siempre reconsultar: si el UPDATE falló, el conteo vuelve a la verdad.
    await cargarConteo();
    await cargarLista();
  }, [rol, noLeidas, cargarConteo, cargarLista]);

  return { items, noLeidas, error, marcarUna, marcarTodas, refrescar };
}
