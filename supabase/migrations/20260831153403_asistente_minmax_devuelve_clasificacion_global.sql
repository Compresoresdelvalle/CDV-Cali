-- El asistente de min/max mostraba el ABC de VENTAS, no el combinado.
--
-- `fn_sugerir_minmax` devolvia solo `p.clasificacion` (ventas). La lista
-- principal de Reorden si usa `clasificacion_global` desde que la vista la
-- expone, pero dentro del asistente el helper `claseReorden` no encontraba esa
-- columna y caia al respaldo, o sea a la letra de ventas.
--
-- Importa porque el asistente es justo donde se decide QUE productos vale la
-- pena controlar, que es una decision de compras. Medido en produccion: 55
-- productos tienen letra distinta entre las dos clasificaciones, y 34 de ellos
-- SUBEN al mirar el consumo (15 pasan de C a A). Son los cabezotes, tanques y
-- motores que casi no se venden sueltos pero entran en cada ensamble: en el
-- asistente aparecian como cola larga cuando en realidad son criticos.
--
-- Cambia el RETURNS TABLE, asi que hace falta DROP + CREATE. El frontend ya
-- esta preparado: `claseReorden` prefiere `clasificacion_global` en cuanto
-- llega en la respuesta.
DROP FUNCTION IF EXISTS public.fn_sugerir_minmax(integer, text);

CREATE FUNCTION public.fn_sugerir_minmax(p_dias integer, p_sede_id text DEFAULT NULL::text)
RETURNS TABLE(
  producto_id uuid, referencia text, nombre text,
  clasificacion text, clasificacion_global text,
  sede_id text, sede_nombre text,
  demanda_periodo bigint, demanda_diaria numeric,
  stock_minimo_actual integer, stock_maximo_actual integer,
  min_sugerido integer, max_sugerido integer, ya_configurado boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rol text; v_sede text; v_objetivo text;
  v_lead numeric; v_seg numeric; v_fmax numeric; v_traspasos boolean;
BEGIN
  SELECT u.rol::text, u.sede_id INTO v_rol, v_sede FROM usuarios u WHERE u.id = auth.uid();
  IF v_rol IS NULL THEN
    RAISE EXCEPTION 'Sesion no valida. Vuelve a iniciar sesion.';
  END IF;
  IF v_rol NOT IN ('Admin', 'Vendedor', 'Bodeguero') THEN
    RAISE EXCEPTION 'Tu rol (%) no puede ver sugerencias de minimos y maximos. Pidelo a Maritza.', v_rol;
  END IF;
  IF p_dias IS NULL OR p_dias < 30 OR p_dias > 365 THEN
    RAISE EXCEPTION 'El periodo debe estar entre 30 y 365 dias.';
  END IF;

  -- Admin puede pedir una sede o todas (NULL). Los demas quedan forzados a la
  -- suya, sin importar lo que manden.
  v_objetivo := CASE WHEN v_rol = 'Admin' THEN p_sede_id ELSE v_sede END;
  IF v_rol <> 'Admin' AND v_objetivo IS NULL THEN
    RAISE EXCEPTION 'Tu usuario no tiene sede asignada. Pidele a Maritza que la configure.';
  END IF;

  SELECT COALESCE((SELECT valor FROM parametros WHERE clave = 'minmax_lead_time_dias'), 7)
    INTO v_lead;
  SELECT COALESCE((SELECT valor FROM parametros WHERE clave = 'minmax_factor_seguridad'), 1.5)
    INTO v_seg;
  SELECT COALESCE((SELECT valor FROM parametros WHERE clave = 'minmax_factor_max'), 3)
    INTO v_fmax;
  SELECT COALESCE((SELECT valor FROM parametros WHERE clave = 'minmax_incluir_traspasos'), 1) > 0
    INTO v_traspasos;

  RETURN QUERY
  WITH salidas AS (
    -- Demanda de la sede = todo lo que SALE de ella.
    --
    -- Los traspasos cuentan (perilla `minmax_incluir_traspasos`): BODEGA
    -- despacho 32.943 unidades por traspaso contra 16 vendidas en 90 dias, asi
    -- que sin ellos la bodega principal recibiria "minimo 1" en todo.
    --
    -- sum(-cantidad) y no sum(abs(cantidad)): las salidas son negativas y las
    -- reversas de OT y ensambles llegan como `devolucion` POSITIVO, asi que se
    -- restan solas. Con abs(), un repuesto puesto y quitado inflaria la demanda
    -- para siempre.
    --
    -- Las ventas anuladas se excluyen: su reversa es un `ajuste` positivo, no un
    -- `venta` negativo, asi que no se compensan solas.
    SELECT m.sede_id AS s_id, m.producto_id AS p_id, sum(-m.cantidad) AS total
    FROM movimientos m
    WHERE m.fecha >= now() - (p_dias || ' days')::interval
      AND m.producto_id IS NOT NULL
      AND (v_objetivo IS NULL OR m.sede_id = v_objetivo)
      AND ( m.tipo IN ('venta', 'ensamble_consumo', 'orden_consumo')
         OR (v_traspasos AND m.tipo = 'traspaso_salida')
         OR (m.tipo = 'devolucion'
             AND m.referencia_tipo IN ('ensamble', 'orden_servicio')) )
      AND NOT (m.tipo = 'venta' AND EXISTS (
            SELECT 1 FROM ventas v WHERE v.id = m.referencia_id AND v.anulada))
    GROUP BY 1, 2
    HAVING sum(-m.cantidad) > 0
  ),
  calc AS (
    SELECT d.s_id, d.p_id, d.total,
      GREATEST(ceil((d.total::numeric / p_dias) * v_lead * v_seg)::int, 1) AS min_sug
    FROM salidas d
  )
  SELECT
    p.id, p.referencia, p.nombre,
    p.clasificacion::text, p.clasificacion_global::text,
    c.s_id, s.nombre,
    c.total::bigint,
    round(c.total::numeric / p_dias, 2),
    COALESCE(i.stock_minimo, 0), COALESCE(i.stock_maximo, 0),
    c.min_sug,
    GREATEST(ceil(c.min_sug * v_fmax)::int, c.min_sug + 1),
    COALESCE(i.stock_minimo, 0) > 0
  FROM calc c
  JOIN productos p ON p.id = c.p_id
  JOIN sedes s ON s.id = c.s_id
  LEFT JOIN inventario i ON i.producto_id = c.p_id AND i.sede_id = c.s_id
  WHERE p.activo = true AND s.activa = true
  ORDER BY c.total DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_sugerir_minmax(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugerir_minmax(integer, text) TO authenticated;
