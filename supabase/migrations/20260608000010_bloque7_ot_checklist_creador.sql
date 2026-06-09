-- Bloque 7 — Órdenes de trabajo:
--   1) Poblar el checklist de recepción (la tabla estaba vacía → checklist en
--      blanco). Lista estándar de compresor; el Admin la edita en
--      Configuración → Checklist OT.
--   2) Registrar quién creó la OT (`creado_por`).
--
-- El ítem "todo lo generado desde una OT = inventario de segunda" se trata
-- aparte (requiere definir el mecanismo con el cliente).

-- ── 1) Creador de la OT ────────────────────────────────────────────────────
alter table public.ordenes_servicio
  add column if not exists creado_por uuid references public.usuarios(id);

-- ── 2) Semilla del checklist de recepción (solo si está vacío) ─────────────
insert into public.checklist_componentes (nombre, orden, activo)
select v.nombre, v.orden, true
from (values
  ('Motor', 1),
  ('Cabezote / Pistón', 2),
  ('Tanque (pulmón)', 3),
  ('Manómetro', 4),
  ('Presóstato (switch de presión)', 5),
  ('Válvula de seguridad', 6),
  ('Válvula check (antirretorno)', 7),
  ('Regulador de presión', 8),
  ('Filtro de aire', 9),
  ('Correa', 10),
  ('Polea', 11),
  ('Ruedas', 12),
  ('Manija / Agarradera', 13),
  ('Cable de poder / Enchufe', 14),
  ('Drenaje del tanque', 15),
  ('Nivel / estado de aceite', 16),
  ('Carcasa / Tapas', 17),
  ('Acoples de salida', 18)
) as v(nombre, orden)
where not exists (select 1 from public.checklist_componentes);
