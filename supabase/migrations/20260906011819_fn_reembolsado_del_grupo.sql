-- Tope unico de reembolso por "grupo": una OT y TODAS las ventas que genero son
-- un solo evento economico. La plata que entro es una sola, asi que el tope de
-- lo que puede salir tiene que ser uno solo.
--
-- Antes habia tres cuentas que no se hablaban:
--   * fn_registrar_devolucion_cliente sumaba devoluciones + garantias DE LA VENTA,
--     pero no las colgadas de la OT.
--   * fn_abrir_garantia_venta sumaba garantias de un lado O del otro (un if/else),
--     y no miraba devoluciones.
-- Resultado: se podia devolver el total dos veces (por devolucion y por garantia
-- sobre la misma venta), y al abrir la puerta de la OT tambien contra la OT y
-- contra su factura. Los reembolsos salen como egreso del cierre del dia, asi
-- que era plata duplicada de verdad.
--
-- Esta funcion es la fuente de verdad unica. Solo lee; el tope contra el que se
-- compara no cambia (sigue siendo el total del documento por el que se entra),
-- asi que enchufarla solo puede RECHAZAR mas, nunca aceptar mas.

CREATE OR REPLACE FUNCTION public.fn_reembolsado_del_grupo(
  p_orden_id uuid,
  p_venta_id uuid
) RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ot    uuid;
  v_total numeric := 0;
BEGIN
  -- La OT manda. Si se entra por una venta que nacio de una OT, el grupo es esa
  -- OT y por lo tanto TODAS sus ventas: la OT 43 llego a tener dos (una anulada
  -- y su reemplazo), asi que mirar `ordenes_servicio.venta_id` (que apunta solo
  -- a la vigente) dejaria plata sin contar. Se mira `ventas.orden_id`.
  v_ot := p_orden_id;
  IF v_ot IS NULL AND p_venta_id IS NOT NULL THEN
    SELECT orden_id INTO v_ot FROM ventas WHERE id = p_venta_id;
  END IF;

  IF v_ot IS NOT NULL THEN
    -- Un solo SELECT con OR y no dos sumas: si algun dia una garantia llegara
    -- con venta_id Y orden_servicio_id, se cuenta una vez, no dos.
    v_total := v_total + COALESCE((
      SELECT sum(g.monto_devuelto)
        FROM garantias_venta g
       WHERE g.resolucion = 'devolver_dinero'
         AND g.estado <> 'anulada'
         AND ( g.orden_servicio_id = v_ot
            OR g.venta_id IN (SELECT v.id FROM ventas v WHERE v.orden_id = v_ot) )
    ), 0);

    v_total := v_total + COALESCE((
      SELECT sum(d.monto_reembolso)
        FROM devoluciones d
       WHERE d.estado <> 'anulada'
         AND d.venta_id IN (SELECT v.id FROM ventas v WHERE v.orden_id = v_ot)
    ), 0);

  ELSIF p_venta_id IS NOT NULL THEN
    -- Venta suelta, sin OT detras. Mismo alcance que ya tenia la devolucion.
    v_total := v_total + COALESCE((
      SELECT sum(g.monto_devuelto)
        FROM garantias_venta g
       WHERE g.venta_id = p_venta_id
         AND g.resolucion = 'devolver_dinero'
         AND g.estado <> 'anulada'
    ), 0);

    v_total := v_total + COALESCE((
      SELECT sum(d.monto_reembolso)
        FROM devoluciones d
       WHERE d.venta_id = p_venta_id
         AND d.estado <> 'anulada'
    ), 0);
  END IF;

  RETURN v_total;
END;
$function$;

-- Solo la llaman las RPC SECURITY DEFINER (owner postgres, que conserva sus
-- privilegios). Nadie mas necesita ejecutarla, asi que no se expone por REST.
REVOKE ALL ON FUNCTION public.fn_reembolsado_del_grupo(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_reembolsado_del_grupo(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_reembolsado_del_grupo(uuid, uuid) FROM authenticated;
