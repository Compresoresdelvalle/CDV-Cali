-- BAJO (auditoría 2026-06-09, B7): la policy abonos_insert valida registrado_por, rol
-- y sede de la OT, pero NO excluye OTs en estado terminal (entregada/cancelada). El
-- bloqueo "no abonar a OT cerrada" vivía solo en el frontend (AbonosPanel readOnly).
-- Un cliente authenticated podía insertar abonos por API directa sobre OTs ya cerradas
-- de su propia sede, alterando saldos históricos.
--
-- Fix (defensa en profundidad): añadir al WITH CHECK la condición de que la OT no esté
-- en estado 'entregada' ni 'cancelada'. Aplica a todos los roles: un abono sobre una OT
-- cerrada es una inconsistencia financiera independientemente de quién lo registre.

drop policy if exists abonos_insert on public.abonos;

create policy abonos_insert on public.abonos
  for insert
  with check (
    registrado_por = auth.uid()
    and get_my_rol() = any (array['Admin'::text, 'Tecnico'::text, 'Vendedor'::text])
    and exists (
      select 1 from ordenes_servicio o
      where o.id = abonos.orden_id
        and (get_my_rol() = 'Admin'::text or o.sede_id = get_my_sede_id())
        and o.estado not in ('entregada'::estado_orden, 'cancelada'::estado_orden)
    )
  );
