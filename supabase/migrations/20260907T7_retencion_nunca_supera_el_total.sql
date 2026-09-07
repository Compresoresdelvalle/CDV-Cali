-- Una retencion nunca puede superar el total del documento.
--
-- Cada porcentaje esta recortado a [0,100] por su propio CHECK, pero la SUMA de
-- los tres podia pasarse. Con retefuente 100% y reteICA 100% sobre una factura
-- de 1.190.000 la retencion da 2.000.000, y el cierre registra un movimiento de
-- signo invertido: una compra aparece como ingreso, una venta como egreso.
-- Plata inventada, en silencio.
--
-- Va como CHECK y no como validacion dentro de las RPC porque los caminos de
-- escritura son varios y uno de ellos NO es una RPC: la OT guarda sus tres
-- porcentajes con un UPDATE directo por REST desde OrdenDetalle. Blindar solo
-- fn_registrar_venta y fn_convertir_cotizacion habria dejado ese abierto, y
-- cualquier camino nuevo tambien. El CHECK los cubre todos, incluido
-- fn_generar_venta_ot, que copia las retenciones de la OT a la venta.
--
-- `greatest(total, 0)` y no `total` a secas por la OT #76, una de prueba ya
-- cancelada que quedo con total -51.000 y retenciones en 0: sin el greatest,
-- 0 > -51000 y la restriccion no se habria podido crear. El total negativo es
-- otro asunto, anterior a esto y ajeno a las retenciones.
--
-- Es la red de seguridad, no el mensaje al operador. BloqueRetenciones avisa en
-- pantalla y las cuatro pantallas (VentaNueva, CompraNueva, OrdenDetalle y
-- ConvertirCotizacionModal) bloquean el envio antes de llegar hasta aca, con un
-- mensaje que dice que hacer. Nadie deberia ver nunca este error crudo.
--
-- Verificado contra produccion en BEGIN/ROLLBACK: bloquea el UPDATE directo de
-- una OT editable (1.639.996 contra 819.998) y fn_registrar_venta con 100+100
-- (200.000 contra 119.000); deja pasar 2,5/0,414/15 en venta (5.764 sobre
-- 119.000) y en compra (57.640 sobre 1.190.000).

alter table ventas
  add constraint ventas_retencion_no_supera_total
  check (retenciones_total <= greatest(total, 0));

alter table ordenes_servicio
  add constraint ordenes_retencion_no_supera_total
  check (retenciones_total <= greatest(total, 0));

alter table compras
  add constraint compras_retencion_no_supera_total
  check (retenciones_total <= greatest(total, 0));
