-- ============================================================================
-- Rediseño OT — Opción A — FASE 0c: Borrador de cotización
-- El paso 3 (cotización) guarda los repuestos seleccionados como BORRADOR
-- (sin tocar stock). El paso 5 (descarga) los confirma insertándolos en
-- detalle_orden, que ahí sí consume el insumo. Así el stock sale solo en la
-- descarga, después de la autorización + anticipo.
-- ============================================================================

alter table ordenes_servicio
  add column if not exists cotizacion_draft jsonb not null default '[]'::jsonb;
