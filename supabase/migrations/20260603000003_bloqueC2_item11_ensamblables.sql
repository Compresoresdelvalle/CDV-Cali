-- Bloque C2 · Ítem 11 — Habilitar productos faltantes como ensamblables.
--
-- El cliente reportó que ESPUMADORA y CHEETA COMPLETA no aparecían en el flujo
-- de ensamble. El ensamble usa "receta al vuelo" (sin BOM), así que basta con
-- marcar productos.ensamblable = true para que aparezcan en EnsambleNuevo.
--
-- Se marcan los que coinciden con el plan y existen en el catálogo, por
-- `referencia` (clave de negocio estable; no se hardcodean UUIDs).
-- Pendiente con el cliente: "ESPUMADORA 45 GL" no existe (habría que crearla)
-- y "ESPUMADORA 21 GL" existe pero no estaba en el plan.

update public.productos
set ensamblable = true
where referencia in ('E10GL', 'E28GL', 'E35GL', 'CHEETA200')
  and ensamblable is distinct from true;
