-- ============================================================================
-- Rediseño OT — Opción A — FASE 8: Backfill + migración de OT abiertas.
-- ⚠️ CORRER JUSTO EN EL DEPLOY DEL FRONTEND NUEVO (no antes), para no confundir
--    al frontend viejo mientras siga en producción.
--   - Backfill de precios de repuestos en OT no entregadas.
--   - Migra los estados legacy de OT en curso al flujo nuevo.
--   - Las OT ENTREGADAS/CANCELADAS NO se tocan.
-- ============================================================================

-- 1) Backfill precio_unitario desde el catálogo (líneas que quedaron en 0) y subtotal,
--    solo en OT no entregadas/canceladas.
update detalle_orden d
   set precio_unitario = coalesce(p.precio_venta, d.costo_unitario, 0),
       subtotal        = coalesce(p.precio_venta, d.costo_unitario, 0) * d.cantidad
  from productos p, ordenes_servicio o
 where p.id = d.producto_id
   and o.id = d.orden_id
   and o.estado not in ('entregada','cancelada')
   and (d.precio_unitario is null or d.precio_unitario = 0);

-- 2) Recalcular valor_repuestos / total de las OT no entregadas (fórmula nueva).
update ordenes_servicio o set
  valor_repuestos = coalesce((select sum(subtotal) from detalle_orden where orden_id = o.id), 0),
  total = round((o.costo_mano_obra
                 + coalesce((select sum(subtotal) from detalle_orden where orden_id = o.id), 0)
                 + coalesce(o.valor_revision,0) - coalesce(o.descuento_valor,0))
                * (1 + coalesce(o.iva_pct,0)/100), 2)
 where o.estado not in ('entregada','cancelada');

-- 3) Migrar estados legacy de OT en curso al flujo nuevo.
update ordenes_servicio set estado = case estado
    when 'abierta'            then 'recepcion'
    when 'completada'         then 'terminada'
    when 'pendiente_recogida' then 'terminada'
    else estado end::estado_orden
 where estado in ('abierta','completada','pendiente_recogida');
-- 'en_proceso' y 'esperando_repuesto' existen en ambos flujos → se conservan.
