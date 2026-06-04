-- Bloque A · Ítem 5 + 10 — Asignar técnico en el 2º momento (revisión), no en
-- la recepción. El cliente recibe el equipo y registra la OT; el técnico se
-- asigna después, cuando la OT pasa a revisión. Para permitirlo, la OT puede
-- crearse SIN técnico asignado.
--
-- La sede de la OT sigue siendo la de quien la crea (de ahí salen los
-- repuestos), así que el RLS os_insert no se ve afectado. La asignación
-- posterior se hace vía os_update (Admin o Vendedor de la sede).
--
-- Reversible: para revertir habría que reasignar técnicos a las OT con NULL
-- antes de volver a poner NOT NULL.

alter table public.ordenes_servicio
  alter column tecnico_id drop not null;
