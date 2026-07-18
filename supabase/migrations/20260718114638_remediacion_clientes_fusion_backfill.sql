-- Remediacion de datos historicos de clientes (campana "revision de problemas")
-- Autorizado por el dueno 2026-07-18.
--
-- Alcance (SOLO lo seguro y confirmado):
--   1) Fusionar el par duplicado confirmado PROESTIBAS / PRO ESTIBAS.
--      Maestro = "PRO ESTIBAS" (id 9b14912e-13d2-4b33-a68b-5538632eeb6b):
--        tiene telefono y esta referenciado por 1 orden de servicio.
--      Duplicado = "PROESTIBAS"  (id 5786b2a4-839a-48e3-be02-d6c832fd09c3):
--        vacio (sin identificacion/telefono/email) y con 0 referencias.
--      Accion: re-apuntar cualquier referencia del duplicado al maestro (0 esperadas),
--      backfill de la venta con nombre libre "PROESTIBAS" al maestro, y soft-desactivar
--      el duplicado (activo=false) renombrandolo con sufijo de traza. NUNCA se borra.
--
--   2) Backfill de cliente_id SOLO en filas con nombre libre que coincide EXACTA y
--      UNIVOCAMENTE (case-insensitive, espacios colapsados) con un unico cliente ACTIVO.
--      Filas ambiguas (nombre que matchea 0 o >1 clientes) NO se tocan: quedan NULL.
--
-- Los otros grupos de nombre duplicado (CONSUMIDOR FINAL, NNNN PRUEBA, "j", "s",
-- "blady") son datos de prueba/genericos y NO se fusionan: decision del dueno.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Fusion PROESTIBAS -> PRO ESTIBAS
-- ---------------------------------------------------------------------------
-- Re-apuntar referencias existentes del duplicado al maestro (esperado: 0 filas)
UPDATE ventas           SET cliente_id='9b14912e-13d2-4b33-a68b-5538632eeb6b' WHERE cliente_id='5786b2a4-839a-48e3-be02-d6c832fd09c3';
UPDATE ordenes_servicio SET cliente_id='9b14912e-13d2-4b33-a68b-5538632eeb6b' WHERE cliente_id='5786b2a4-839a-48e3-be02-d6c832fd09c3';
UPDATE recibos          SET cliente_id='9b14912e-13d2-4b33-a68b-5538632eeb6b' WHERE cliente_id='5786b2a4-839a-48e3-be02-d6c832fd09c3';
UPDATE cotizaciones     SET cliente_id='9b14912e-13d2-4b33-a68b-5538632eeb6b' WHERE cliente_id='5786b2a4-839a-48e3-be02-d6c832fd09c3';

-- Soft-desactivar el duplicado vacio (traza en el nombre)
UPDATE clientes
   SET activo = false,
       updated_at = now(),
       nombre = nombre || ' (fusionado->PRO ESTIBAS 9b14912e)'
 WHERE id = '5786b2a4-839a-48e3-be02-d6c832fd09c3'
   AND activo = true;

-- ---------------------------------------------------------------------------
-- 2) Backfill de cliente_id por match exacto y univoco contra cliente ACTIVO
--    (excluye el duplicado ya desactivado)
-- ---------------------------------------------------------------------------
UPDATE ventas t SET cliente_id = sub.id
FROM (SELECT lower(trim(regexp_replace(nombre,'\s+',' ','g'))) nn, min(id::text)::uuid id
      FROM clientes WHERE activo GROUP BY 1 HAVING count(*)=1) sub
WHERE t.cliente_id IS NULL
  AND lower(trim(regexp_replace(coalesce(t.cliente_nombre,''),'\s+',' ','g'))) = sub.nn;

UPDATE recibos t SET cliente_id = sub.id
FROM (SELECT lower(trim(regexp_replace(nombre,'\s+',' ','g'))) nn, min(id::text)::uuid id
      FROM clientes WHERE activo GROUP BY 1 HAVING count(*)=1) sub
WHERE t.cliente_id IS NULL
  AND lower(trim(regexp_replace(coalesce(t.cliente_nombre,''),'\s+',' ','g'))) = sub.nn;

UPDATE cotizaciones t SET cliente_id = sub.id
FROM (SELECT lower(trim(regexp_replace(nombre,'\s+',' ','g'))) nn, min(id::text)::uuid id
      FROM clientes WHERE activo GROUP BY 1 HAVING count(*)=1) sub
WHERE t.cliente_id IS NULL
  AND lower(trim(regexp_replace(coalesce(t.cliente_nombre,''),'\s+',' ','g'))) = sub.nn;

UPDATE ordenes_servicio t SET cliente_id = sub.id
FROM (SELECT lower(trim(regexp_replace(nombre,'\s+',' ','g'))) nn, min(id::text)::uuid id
      FROM clientes WHERE activo GROUP BY 1 HAVING count(*)=1) sub
WHERE t.cliente_id IS NULL
  AND lower(trim(regexp_replace(coalesce(t.cliente_nombre,''),'\s+',' ','g'))) = sub.nn;

-- Alias de la fusion: la venta con nombre libre "PROESTIBAS" (una palabra) es la
-- misma empresa -> enlazar al maestro (el nombre normalizado "pro estibas" ya lo
-- enlazan los backfills de arriba).
UPDATE ventas SET cliente_id='9b14912e-13d2-4b33-a68b-5538632eeb6b'
WHERE cliente_id IS NULL
  AND lower(trim(regexp_replace(coalesce(cliente_nombre,''),'\s+',' ','g'))) = 'proestibas';

COMMIT;
