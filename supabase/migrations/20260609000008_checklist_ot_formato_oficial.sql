-- Checklist de recepción de OT: ajustarlo al FORMATO OFICIAL del cliente (24
-- ítems del formato impreso). Los placeholders genéricos sembrados en B7 se
-- DESACTIVAN (no se borran: la FK ot_checklist.componente_id es ON DELETE
-- RESTRICT y hay que preservar el historial de recepciones). Idempotente.
--
-- Ítems oficiales (24): Compresor, Motor, Manómetro, V. seguridad, Llave bola 1/4,
-- Correa, Filtros, Filtro trampa, Arrancador, Motor quemado, Engrasadora,
-- Pistola de impacto, Cabezote, Automático, V. cheque, Llave bola 1/2,
-- Llave de bola 3/8, Polea, Unidad mantenimiento, Tubo de carga, Desfogue,
-- Tanque roto, Grapadora, Guarda polea.

-- 1) Desactivar todo el checklist actual.
update public.checklist_componentes set activo = false, updated_at = now();

-- 2) Reactivar + reordenar los que ya existen por nombre exacto.
update public.checklist_componentes c
   set activo = true, orden = v.orden, updated_at = now()
  from (values
    ('Compresor',1),('Motor',2),('Manómetro',3),('V. seguridad',4),
    ('Llave bola 1/4',5),('Correa',6),('Filtros',7),('Filtro trampa',8),
    ('Arrancador',9),('Motor quemado',10),('Engrasadora',11),('Pistola de impacto',12),
    ('Cabezote',13),('Automático',14),('V. cheque',15),('Llave bola 1/2',16),
    ('Llave de bola 3/8',17),('Polea',18),('Unidad mantenimiento',19),('Tubo de carga',20),
    ('Desfogue',21),('Tanque roto',22),('Grapadora',23),('Guarda polea',24)
  ) as v(nombre, orden)
 where c.nombre = v.nombre;

-- 3) Insertar los oficiales que aún no existían.
insert into public.checklist_componentes (nombre, activo, orden)
select v.nombre, true, v.orden
  from (values
    ('Compresor',1),('Motor',2),('Manómetro',3),('V. seguridad',4),
    ('Llave bola 1/4',5),('Correa',6),('Filtros',7),('Filtro trampa',8),
    ('Arrancador',9),('Motor quemado',10),('Engrasadora',11),('Pistola de impacto',12),
    ('Cabezote',13),('Automático',14),('V. cheque',15),('Llave bola 1/2',16),
    ('Llave de bola 3/8',17),('Polea',18),('Unidad mantenimiento',19),('Tubo de carga',20),
    ('Desfogue',21),('Tanque roto',22),('Grapadora',23),('Guarda polea',24)
  ) as v(nombre, orden)
 where not exists (
   select 1 from public.checklist_componentes c where c.nombre = v.nombre
 );
