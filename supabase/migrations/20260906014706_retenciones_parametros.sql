-- Tarifas por defecto de las retenciones.
--
-- Van en parametros_sistema (no en `parametros`, que es la de minimos y maximos)
-- porque es la que tiene pantalla en Configuracion, validacion por rango y
-- auditoria de updated_by. Una tarifa de impuesto la cambia una persona por una
-- razon, y conviene poder reconstruir cual y cuando.
--
-- Estas son las primeras filas de la tabla: hoy esta vacia y la pantalla de
-- Configuracion -> Parametros no muestra nada.
--
-- Su RLS ya sirve tal como esta: auth_read_parametros_sistema deja leer a
-- cualquier autenticado (la vendedora necesita la tarifa sugerida al vender) y
-- admin_write_parametros_sistema deja escribir solo a Admin.
--
-- 2,5% es la retefuente de compras generales; 0,69% (6,9 por mil) es una tarifa
-- de ICA usual en Cali para comercio; 15% es la general de reteIVA. Son puntos
-- de partida editables, no una asesoria tributaria: si la ley o el municipio
-- cambian, Maritza los ajusta desde Configuracion sin tocar codigo.
--
-- Llegan SUGERIDAS a cada documento, no aplicadas: el bloque de retenciones
-- nace apagado y solo se precarga cuando alguien lo abre.
INSERT INTO public.parametros_sistema (key, value, tipo, descripcion) VALUES
  ('retencion_retefuente_pct', '2.5',  'decimal', 'Retefuente sugerida (% sobre subtotal menos descuento)'),
  ('retencion_reteica_pct',    '0.69', 'decimal', 'ReteICA sugerida (% sobre subtotal menos descuento)'),
  ('retencion_reteiva_pct',    '15',   'decimal', 'ReteIVA sugerida (% sobre el IVA facturado)')
ON CONFLICT (key) DO NOTHING;
