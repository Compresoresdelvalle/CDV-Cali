-- Sección 9 — Herramientas. Tarea 3: blindar trg_hp_proteger_mutacion.
--
-- Huecos que cierra (el trigger anterior solo bloqueaba 4 cosas):
--  1. No cubría el paso a estado='prestada' ni el cambio de `prestada_a`: por REST directo
--     se podía reasignar/secuestrar un préstamo activo de otra persona, saltándose el
--     FOR UPDATE SKIP LOCKED y la validación de disponibilidad de fn_prestar_herramientas_lote.
--  2. La regla del paso a 'disponible' estaba condicionada a old.producto_id is not null,
--     así que las herramientas MANUALES se podían "devolver" por REST saltando
--     fn_devolver_herramienta, quedando fuera del historial.
--
-- Ahora CUALQUIER transición de `estado` y CUALQUIER cambio de los datos del préstamo
-- exigen el flag cdv.herramienta_rpc='on', que solo ponen las RPC SECURITY DEFINER.
--
-- NO se usa REVOKE a propósito: dejaría las policies hp_insert/hp_update como letra muerta.
-- El trigger es BEFORE UPDATE, así que NO afecta el INSERT directo por REST de herramientas
-- manuales que hace el frontend (HerramientaModales.jsx) — verificado en pruebas.
-- Sigue permitido por REST: editar nombre, código, observaciones y fecha esperada.

create or replace function public.trg_hp_proteger_mutacion() returns trigger
language plpgsql set search_path to 'public','pg_temp' as $fn$
begin
  if coalesce(current_setting('cdv.herramienta_rpc', true), 'off') = 'on' then
    return new;
  end if;

  if new.activo is distinct from old.activo then
    raise exception 'No se permite cambiar el estado activo de una herramienta por escritura directa; usa la función de devolución o consumo';
  end if;

  if new.producto_id is distinct from old.producto_id then
    raise exception 'No se permite cambiar el producto vinculado de una herramienta por escritura directa';
  end if;

  if new.estado is distinct from old.estado then
    raise exception 'Cambiar el estado de una herramienta (% → %) requiere las funciones de la app (prestar, devolver, consumir, extraviar, recuperar, mantenimiento); no se permite por escritura directa', old.estado, new.estado;
  end if;

  if new.prestada_a is distinct from old.prestada_a
     or new.fecha_prestamo is distinct from old.fecha_prestamo
     or new.fecha_devolucion_real is distinct from old.fecha_devolucion_real
     or new.estado_prestamo is distinct from old.estado_prestamo then
    raise exception 'Los datos del préstamo (responsable y fechas) solo se pueden cambiar con las funciones de préstamo, devolución o mantenimiento';
  end if;

  return new;
end;
$fn$;