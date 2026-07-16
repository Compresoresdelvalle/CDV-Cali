-- COT-B: blindaje REST — toda escritura pasa por RPCs SECURITY DEFINER (mismo patrón S1-01/S3-02).
REVOKE INSERT, UPDATE, DELETE ON cotizaciones, detalle_cotizacion, abonos_cotizacion, cotizacion_cuentas_bancarias FROM authenticated, anon;
