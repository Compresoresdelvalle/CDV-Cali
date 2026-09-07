-- Clasificar egresos por lotes. Son 465 movimientos: uno por uno no lo hace
-- nadie, y un panel cuyo Resultado depende de una tarea que nadie va a hacer no
-- sirve.
--
-- Solo Admin: la categoria decide si la plata resta del resultado, asi que es
-- una decision de administracion, no de operacion.
--
-- No se adivina nada automaticamente. Un 'PIDIO PLATA' solo lo puede clasificar
-- quien sabe que fue; agrupar por texto parecido es ayuda para la pantalla, no
-- una regla que asigne sola.
--
-- Verificado: clasifica, desclasifica (categoria NULL devuelve el movimiento a
-- la bandeja) y no toca las compras de mercancia. Una vendedora es rechazada.
CREATE OR REPLACE FUNCTION public.fn_clasificar_egresos(
  p_ids uuid[],
  p_categoria_id bigint
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_n int;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  if (select get_my_rol()) <> 'Admin' then
    raise exception 'Solo administración clasifica los egresos: la categoría decide si la plata resta del resultado';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'No se recibió ningún egreso para clasificar';
  end if;
  -- p_categoria_id NULL es valido a proposito: sirve para DESclasificar y
  -- devolver un movimiento a la bandeja cuando se marco mal.
  if p_categoria_id is not null
     and not exists (select 1 from categorias_gasto where id = p_categoria_id and activa = true) then
    raise exception 'La categoría no existe o está inactiva';
  end if;

  update compras
     set categoria_gasto_id = p_categoria_id
   where id = any(p_ids)
     and es_caja_menor = true      -- una compra de mercancia no se clasifica:
     and estado <> 'cancelada';    -- su plata ya vive en el costo de lo vendido
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_clasificar_egresos(uuid[], bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_clasificar_egresos(uuid[], bigint) TO authenticated, service_role;
