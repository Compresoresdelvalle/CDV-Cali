-- alertas_count / stock_agotado_count / stock_bajo_count contaban FILAS de
-- inventario (producto×sede), inflando el número: un producto sin stock en las
-- 4 sedes se contaba 4 veces. En el Dashboard admin mostraba 2.674 cuando los
-- productos distintos con alerta son 873. Además contaban productos dados de
-- baja. Ahora cuentan productos DISTINTOS y activos, y la lista de alertas
-- también excluye inactivos. Por sede (vendedor) el número ya era casi correcto
-- (una fila por producto) y solo se le quitan los inactivos.
DO $mig$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO d FROM pg_proc WHERE proname='fn_dashboard_kpis';
  d := replace(d,
    '''stock_bajo_count'', (select count(*) from inventario where estado_stock = ''Bajo'' and (v_rol = ''Admin'' or sede_id = v_sede)),',
    '''stock_bajo_count'', (select count(distinct i.producto_id) from inventario i join productos p on p.id = i.producto_id where i.estado_stock = ''Bajo'' and p.activo = true and (v_rol = ''Admin'' or i.sede_id = v_sede)),');
  d := replace(d,
    '''stock_agotado_count'', (select count(*) from inventario where estado_stock = ''Agotado'' and (v_rol = ''Admin'' or sede_id = v_sede)),',
    '''stock_agotado_count'', (select count(distinct i.producto_id) from inventario i join productos p on p.id = i.producto_id where i.estado_stock = ''Agotado'' and p.activo = true and (v_rol = ''Admin'' or i.sede_id = v_sede)),');
  d := replace(d,
    '''alertas_count'', (select count(*) from inventario where estado_stock in (''Bajo'',''Agotado'') and (v_rol = ''Admin'' or sede_id = v_sede)),',
    '''alertas_count'', (select count(distinct i.producto_id) from inventario i join productos p on p.id = i.producto_id where i.estado_stock in (''Bajo'',''Agotado'') and p.activo = true and (v_rol = ''Admin'' or i.sede_id = v_sede)),');
  d := replace(d,
    'where i.estado_stock in (''Bajo'',''Agotado'') and (v_rol = ''Admin'' or i.sede_id = v_sede) order by (i.estado_stock = ''Agotado'')',
    'where i.estado_stock in (''Bajo'',''Agotado'') and p.activo = true and (v_rol = ''Admin'' or i.sede_id = v_sede) order by (i.estado_stock = ''Agotado'')');
  EXECUTE d;
END $mig$;
