-- Paso 3 — ENSAMBLES-01 (CRÍTICA): impedir producción de la nada con receta vacía
--
-- Problema: trg_ensamble_stock suma cantidad_producida al stock VENDIBLE del producto
-- resultado de forma incondicional al completar, sin exigir que el ensamble tenga receta
-- (detalle_ensamble). La UI permite borrar todos los insumos mientras !completado y luego
-- completar. Pruebas (ROLLBACK): ensamble SIN detalle → inventario +N, costo_total=0,
-- 0 insumo consumido → stock vendible sin respaldo físico, con movimiento que parece
-- producción legítima.
--
-- Fix: ampliar la validación BEFORE UPDATE ya existente (trg_ensamble_terminado_antes_completar,
-- enganchada en trg_before_update_ensamble_completar) para que, al completar:
--   · exija ≥1 fila en detalle_ensamble (receta no vacía)  → ENSAMBLES-01
--   · exija cantidad_producida >= 1
-- y para congelar cantidad_producida una vez el ensamble está 'terminado' → parte de
-- ENSAMBLES-02 ("inyectar cantidad arbitraria"). Backend puro; el flujo legítimo
-- (agregar receta → terminar → completar) pasa sin cambios.
--
-- DIFERIDO (requiere cambio coordinado de frontend, va en follow-up):
--   · ENSAMBLES-02 completo: que "completar" excluya al rol Técnico (control de dos
--     personas) — hoy la UI ofrece "Completar" al creador, que puede ser Técnico.
--   · ENSAMBLES-03: policy DELETE / creación transaccional para limpiar ensambles huérfanos.

create or replace function public.trg_ensamble_terminado_antes_completar()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Congelar cantidad_producida una vez marcado como terminado.
  if coalesce(old.terminado, false) = true
     and new.cantidad_producida is distinct from old.cantidad_producida then
    raise exception 'No se puede cambiar la cantidad producida de un ensamble ya marcado como terminado';
  end if;

  -- Validaciones al COMPLETAR (completado: false -> true)
  if new.completado = true and coalesce(old.completado, false) = false then
    -- (existente) el técnico debe haberlo marcado como terminado
    if coalesce(new.terminado, false) = false then
      raise exception 'No se puede completar un ensamble que el técnico aún no marcó como terminado';
    end if;

    -- ENSAMBLES-01: bloquear producción de la nada (receta vacía)
    if not exists (select 1 from detalle_ensamble where ensamble_id = new.id) then
      raise exception 'No se puede completar un ensamble sin componentes: la receta está vacía';
    end if;

    -- cantidad producida válida
    if coalesce(new.cantidad_producida, 0) < 1 then
      raise exception 'La cantidad producida debe ser al menos 1';
    end if;
  end if;

  return new;
end;
$function$;
