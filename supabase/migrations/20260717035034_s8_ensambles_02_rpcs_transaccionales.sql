-- S8 Ensambles: RPCs transaccionales que reemplazan la escritura directa por REST.
-- fn_crear_ensamble: cabecera + detalle en UNA transacción (realizado_por = auth.uid()).
-- fn_ensamble_receta: única puerta de edición de receta (congelada tras terminado).
-- fn_ensamble_estado: terminar / reabrir / completar con transiciones válidas.
-- Los triggers existentes (trg_detalle_ensamble_ins/upd/del, trg_after_update_ensamble,
-- trg_before_update_ensamble_completar) siguen haciendo los movimientos de stock.

CREATE OR REPLACE FUNCTION public.fn_crear_ensamble(
  p_producto_id uuid, p_cantidad integer, p_sede_id text,
  p_tecnico_id uuid DEFAULT NULL, p_observaciones text DEFAULT NULL, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_rol text; v_ens_id uuid; v_numero integer;
  v_item jsonb; v_pid uuid; v_cant integer; v_costo numeric; v_prod RECORD; v_n int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  v_rol := get_my_rol();
  IF v_rol IS NULL OR v_rol NOT IN ('Admin','Bodeguero','Tecnico','Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para crear ensambles (rol %)', COALESCE(v_rol,'desconocido');
  END IF;
  IF v_rol <> 'Admin' AND p_sede_id IS DISTINCT FROM get_my_sede_id() THEN
    RAISE EXCEPTION 'Solo puedes crear ensambles en tu sede';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad < 1 THEN RAISE EXCEPTION 'La cantidad a producir debe ser al menos 1'; END IF;
  SELECT id, activo, ensamblable INTO v_prod FROM productos WHERE id = p_producto_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto a ensamblar no encontrado'; END IF;
  IF v_prod.activo IS NOT TRUE THEN RAISE EXCEPTION 'El producto a ensamblar está inactivo'; END IF;
  IF v_prod.ensamblable IS NOT TRUE THEN RAISE EXCEPTION 'El producto no está marcado como ensamblable'; END IF;
  IF p_tecnico_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM usuarios WHERE id = p_tecnico_id AND rol = 'Tecnico') THEN
    RAISE EXCEPTION 'El técnico asignado no es válido';
  END IF;
  INSERT INTO ensambles (producto_resultado_id, cantidad_producida, realizado_por,
      tecnico_id, sede_id, observaciones, completado, terminado)
  VALUES (p_producto_id, p_cantidad, v_uid, p_tecnico_id, p_sede_id,
      NULLIF(btrim(COALESCE(p_observaciones,'')),''), false, false)
  RETURNING id, numero INTO v_ens_id, v_numero;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items,'[]'::jsonb)) LOOP
    v_pid := (v_item->>'producto_id')::uuid;
    v_cant := COALESCE((v_item->>'cantidad')::int, 0);
    IF v_pid IS NULL THEN RAISE EXCEPTION 'Componente sin producto_id'; END IF;
    IF v_cant < 1 THEN RAISE EXCEPTION 'La cantidad de cada componente debe ser al menos 1'; END IF;
    SELECT COALESCE(costo_promedio,0) INTO v_costo FROM productos WHERE id = v_pid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Componente no encontrado'; END IF;
    INSERT INTO detalle_ensamble (ensamble_id, producto_id, cantidad, costo_unitario)
    VALUES (v_ens_id, v_pid, v_cant, v_costo);
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('ensamble_id', v_ens_id, 'numero', v_numero, 'componentes', v_n);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_ensamble_receta(
  p_ensamble_id uuid, p_accion text, p_producto_id uuid, p_cantidad integer DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_rol text; v_ens RECORD; v_costo numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  v_rol := get_my_rol();
  IF v_rol IS NULL OR v_rol NOT IN ('Admin','Bodeguero','Tecnico','Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso (rol %)', COALESCE(v_rol,'desconocido'); END IF;
  SELECT * INTO v_ens FROM ensambles WHERE id = p_ensamble_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ensamble no encontrado'; END IF;
  IF v_rol <> 'Admin' AND v_ens.realizado_por <> v_uid THEN
    RAISE EXCEPTION 'Solo el creador o un Admin pueden editar la receta'; END IF;
  IF v_ens.completado THEN RAISE EXCEPTION 'La receta no se puede editar: el ensamble ya está completado'; END IF;
  IF v_ens.terminado THEN RAISE EXCEPTION 'La receta está congelada porque el ensamble ya fue marcado como terminado. Usa reabrir para corregir.'; END IF;
  IF p_producto_id IS NULL THEN RAISE EXCEPTION 'Falta el producto del componente'; END IF;
  IF p_accion = 'agregar' THEN
    IF p_cantidad IS NULL OR p_cantidad < 1 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
    IF EXISTS (SELECT 1 FROM detalle_ensamble WHERE ensamble_id=p_ensamble_id AND producto_id=p_producto_id) THEN
      RAISE EXCEPTION 'Ese componente ya está en la receta; edita su cantidad'; END IF;
    SELECT COALESCE(costo_promedio,0) INTO v_costo FROM productos WHERE id=p_producto_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Componente no encontrado'; END IF;
    INSERT INTO detalle_ensamble (ensamble_id, producto_id, cantidad, costo_unitario)
    VALUES (p_ensamble_id, p_producto_id, p_cantidad, v_costo);
  ELSIF p_accion = 'editar' THEN
    IF p_cantidad IS NULL OR p_cantidad < 1 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
    UPDATE detalle_ensamble SET cantidad=p_cantidad WHERE ensamble_id=p_ensamble_id AND producto_id=p_producto_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Componente no está en la receta'; END IF;
  ELSIF p_accion = 'quitar' THEN
    DELETE FROM detalle_ensamble WHERE ensamble_id=p_ensamble_id AND producto_id=p_producto_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Componente no está en la receta'; END IF;
  ELSE RAISE EXCEPTION 'Acción inválida: %', p_accion; END IF;
  RETURN jsonb_build_object('ensamble_id', p_ensamble_id, 'accion', p_accion, 'producto_id', p_producto_id);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_ensamble_estado(p_ensamble_id uuid, p_accion text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_rol text; v_ens RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  v_rol := get_my_rol();
  IF v_rol IS NULL OR v_rol NOT IN ('Admin','Bodeguero','Tecnico','Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso (rol %)', COALESCE(v_rol,'desconocido'); END IF;
  SELECT * INTO v_ens FROM ensambles WHERE id = p_ensamble_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ensamble no encontrado'; END IF;
  IF NOT ((v_rol='Admin') OR (v_ens.realizado_por=v_uid) OR (v_ens.tecnico_id=v_uid)) THEN
    RAISE EXCEPTION 'No tienes permiso sobre este ensamble'; END IF;
  IF p_accion = 'terminar' THEN
    IF v_ens.completado THEN RAISE EXCEPTION 'El ensamble ya está completado'; END IF;
    IF v_ens.terminado THEN RAISE EXCEPTION 'El ensamble ya está marcado como terminado'; END IF;
    UPDATE ensambles SET terminado=true WHERE id=p_ensamble_id;
  ELSIF p_accion = 'reabrir' THEN
    IF v_ens.completado THEN RAISE EXCEPTION 'No se puede reabrir un ensamble completado'; END IF;
    IF NOT v_ens.terminado THEN RAISE EXCEPTION 'El ensamble no está terminado'; END IF;
    UPDATE ensambles SET terminado=false WHERE id=p_ensamble_id;
  ELSIF p_accion = 'completar' THEN
    IF v_ens.completado THEN RAISE EXCEPTION 'El ensamble ya está completado'; END IF;
    IF NOT v_ens.terminado THEN RAISE EXCEPTION 'No se puede completar: el técnico aún no lo marcó como terminado'; END IF;
    IF NOT EXISTS (SELECT 1 FROM detalle_ensamble WHERE ensamble_id=p_ensamble_id) THEN
      RAISE EXCEPTION 'No se puede completar un ensamble sin componentes: la receta está vacía'; END IF;
    UPDATE ensambles SET completado=true WHERE id=p_ensamble_id;
  ELSE RAISE EXCEPTION 'Acción inválida: %', p_accion; END IF;
  RETURN jsonb_build_object('ensamble_id', p_ensamble_id, 'accion', p_accion);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_crear_ensamble(uuid,integer,text,uuid,text,jsonb) FROM public, anon;
REVOKE ALL ON FUNCTION public.fn_ensamble_receta(uuid,text,uuid,integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.fn_ensamble_estado(uuid,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_crear_ensamble(uuid,integer,text,uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ensamble_receta(uuid,text,uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ensamble_estado(uuid,text) TO authenticated;
