-- Rescata el dato de ubicación que ya existía y estaba en la columna equivocada.
--
-- Contexto: la app tiene DOS sistemas de ubicación que nunca se sincronizaron.
--   * El viejo: productos.stand / posicion / en_piso — cargado desde la planilla
--     de mayo de 2026, con 752 productos poblados. Solo aplica a BODEGA.
--   * El nuevo: inventario.ubicacion_id -> ubicaciones — es el que alimenta el
--     chip de ubicación, el mapa SVG de la bodega, el picking y el slotting.
--     Estaba prácticamente vacío: 21 filas de 5.173 en toda la operación.
--
-- El resultado era que la función de ubicaciones se veía "rota" cuando en
-- realidad el dato existía, solo que en el lugar que la UI nueva no lee.
--
-- El mapeo entre ambos es mecánico y exacto contra el seed de `ubicaciones`:
--     stand 3 + posición 2  ->  'ST3-P2'
--     en_piso               ->  'PISO'
-- Se hace por JOIN contra `ubicaciones` (no por concatenación ciega), así que
-- cualquier combinación que no exista como ubicación real simplemente no se
-- actualiza en vez de reventar contra la llave foránea.
--
-- Cuidados:
--   * Solo toca filas de BODEGA con ubicacion_id IS NULL: las 20 asignaciones
--     hechas a mano desde la app NO se pisan.
--   * Los productos con stand pero sin posición quedan sin ubicar: no se
--     inventa una posición.
--   * Si la bodega se reorganizó desde mayo, el conteo cíclico y la asignación
--     manual desde la ficha del producto irán corrigiendo posición por posición.
--
-- Resultado real en producción (2026-07-23): BODEGA pasó de 20 a 689 filas
-- ubicadas (1,4% -> 48,4%), usando 30 ubicaciones distintas.

do $$
declare
  v_antes integer;
  v_despues integer;
begin
  select count(*) into v_antes
    from inventario where sede_id = 'BODEGA' and ubicacion_id is not null;

  update inventario i
     set ubicacion_id = u.id
    from productos p, ubicaciones u
   where i.producto_id = p.id
     and i.sede_id = 'BODEGA'
     and i.ubicacion_id is null
     and u.sede_id = 'BODEGA'
     and u.activa
     and u.id = case
                  when p.en_piso then 'PISO'
                  when p.stand is not null and p.posicion is not null
                    then 'ST' || p.stand || '-P' || p.posicion
                end;

  select count(*) into v_despues
    from inventario where sede_id = 'BODEGA' and ubicacion_id is not null;

  raise notice 'Ubicaciones BODEGA: % -> % (se ubicaron % filas)',
    v_antes, v_despues, v_despues - v_antes;
end $$;
