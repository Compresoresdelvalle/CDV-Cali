-- ============================================================================
-- Rediseño OT — Opción A — FASE 0: Esquema base
-- Todo aditivo e idempotente: NO cambia comportamiento todavía.
--   - Nuevos estados del flujo guiado (enum estado_orden)
--   - ordenes_servicio: valor_repuestos (precio), iva_pct, descuento_valor, venta_id
--   - detalle_orden: precio_unitario (precio de venta por línea)
--   - ventas: origen ('directa'|'ot') + orden_id (vínculo a la OT)
--   - abonos: venta_id (anticipo conciliado en la recogida)
--   - índices de las FK nuevas
-- ============================================================================

-- 1) Enum: estados del flujo guiado de 7 pasos (no se borran los viejos)
do $$ begin
  alter type estado_orden add value if not exists 'recepcion';
  alter type estado_orden add value if not exists 'diagnostico';
  alter type estado_orden add value if not exists 'cotizada';
  alter type estado_orden add value if not exists 'autorizada';
  alter type estado_orden add value if not exists 'terminada';
end $$;

-- 2) ordenes_servicio: precio de repuestos, IVA/descuento (coherente con ventas) y venta generada
alter table ordenes_servicio
  add column if not exists valor_repuestos numeric(12,2) not null default 0,
  add column if not exists iva_pct         numeric(5,2)  not null default 0,   -- 0 = sin IVA, 19 = con IVA (editable)
  add column if not exists descuento_valor numeric(12,2) not null default 0,
  add column if not exists venta_id        uuid references ventas(id);

-- 3) detalle_orden: precio de venta por línea (se conserva costo_unitario para margen)
alter table detalle_orden
  add column if not exists precio_unitario numeric(12,2) not null default 0;

-- 4) ventas: origen y vínculo a OT
alter table ventas
  add column if not exists origen text not null default 'directa'
    check (origen in ('directa','ot')),
  add column if not exists orden_id uuid references ordenes_servicio(id);

-- 5) abonos (anticipos): vínculo a la venta conciliada en la recogida
alter table abonos
  add column if not exists venta_id uuid references ventas(id);

-- 6) índices de las FK nuevas
create index if not exists ix_ventas_orden_id   on ventas(orden_id);
create index if not exists ix_ordenes_venta_id  on ordenes_servicio(venta_id);
create index if not exists ix_abonos_venta_id   on abonos(venta_id);
