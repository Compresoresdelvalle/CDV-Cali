-- Herramientas visibles en todas las sedes (solo lectura).
--
-- Las herramientas viajan entre sedes y hoy nadie puede saber dónde quedó una
-- sin llamar por teléfono: la RLS solo dejaba ver las de la sede propia.
-- Se abre el SELECT a cualquier usuario autenticado.
--
-- Qué NO cambia: las políticas de escritura (hp_insert, hp_update) y las
-- funciones de préstamo, devolución, consumo y mantenimiento siguen exigiendo
-- sede propia salvo al Admin. Ver es distinto de tocar.
--
-- Qué se expone: nombre, código, estado, quién la tiene y desde cuándo. No hay
-- dinero, costos ni datos de clientes en estas tablas.

DROP POLICY IF EXISTS hp_select ON public.herramientas_prestamo;
CREATE POLICY hp_select ON public.herramientas_prestamo
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS hh_select ON public.herramientas_historial;
CREATE POLICY hh_select ON public.herramientas_historial
  FOR SELECT TO authenticated
  USING (true);
