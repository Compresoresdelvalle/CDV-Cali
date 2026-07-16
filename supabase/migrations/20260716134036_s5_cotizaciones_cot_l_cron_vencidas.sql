-- COT-L: programar el marcado diario de cotizaciones vencidas.
-- pg_cron corre en UTC. 06:00 UTC = 01:00 America/Bogota (UTC-5, sin horario de verano).
-- La función solo pasa borrador/enviada (venta_id NULL, vigencia expirada) a 'vencida';
-- nunca toca 'aprobada' ni 'rechazada'.
SELECT cron.schedule(
  'cotizaciones-vencidas-diario',
  '0 6 * * *',
  $$select public.fn_marcar_cotizaciones_vencidas()$$
);
