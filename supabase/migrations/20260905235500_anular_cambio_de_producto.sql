-- Anular un cambio de producto: la operación que faltaba.
--
-- EL PROBLEMA
--   Un cambio deja dos registros enlazados: la devolución (motivo "Cambio desde
--   venta #N") y la venta de la diferencia (observación "Cambio por venta #N").
--   Ninguno de los dos se podía anular:
--     · fn_anular_devolucion rechazaba la devolución y mandaba a "anular la
--       venta del cambio desde Ventas";
--     · fn_anular_venta rechazaba esa venta por ser la diferencia de un cambio.
--   Cada mensaje remitía al otro, así que por la interfaz no había salida y todo
--   cambio mal registrado terminaba corrigiéndose a mano por SQL (pasó con la
--   devolución #38 / venta #1880 del 2026-08-31).
--
--   El bloqueo en sí era correcto: anular SOLO la venta reingresaría el producto
--   nuevo dejando también reingresado el viejo, e inflaría el inventario. Lo que
--   faltaba era la operación que revierte las dos patas juntas.
--
--   La salida que sugería el código ("registra el cambio inverso") arregla el
--   inventario pero no quita la plata mal cobrada ni deja rastro de que el
--   registro estuvo mal; no sirve para un cambio mal digitado.
--
-- LO QUE HACE ESTA MIGRACIÓN
--   1. ventas.devolucion_cambio_id — el enlace explícito que faltaba.
--   2. Un trigger lo llena solo, sin tocar fn_registrar_cambio.
--   3. fn_anular_cambio(venta, motivo) revierte las dos patas en una sola
--      transacción, y cancela el egreso de caja menor si el cambio había dejado
--      plata a favor del cliente.
--   4. fn_anular_devolucion deja de mandar a la puerta cerrada y nombra la
--      salida real con el número de venta; y su guard pasa a apoyarse en el
--      enlace y no solo en el texto del motivo, que lo escribe el frontend.
--   5. fn_registrar_devolucion deja de contar las devoluciones ANULADAS contra
--      el tope de "ya devuelto" — sin eso, anular no servía para nada porque
--      la devolución corregida no se podía volver a registrar.
--
--   fn_anular_venta se deja como está a propósito: su bloqueo sigue siendo
--   correcto (anular esa venta sola descuadra el inventario) y su mensaje no
--   manda a ningún lado que falle. Reescribirla entera solo para retocar un
--   texto es riesgo gratis sobre una función de plata y de stock. Por lo mismo
--   fn_registrar_cambio no se toca: el enlace lo pone el trigger de abajo.
--
-- No toca `total`, `subtotal` ni `descuento_valor` de ninguna venta existente.

-- ─────────────────────────────────────────────────────────── 1. El enlace ──
alter table ventas
  add column if not exists devolucion_cambio_id uuid references devoluciones(id);

comment on column ventas.devolucion_cambio_id is
  'Devolución que forma pareja con esta venta de cambio. Las dos se anulan juntas con fn_anular_cambio.';

create index if not exists idx_ventas_devolucion_cambio
  on ventas(devolucion_cambio_id) where devolucion_cambio_id is not null;

-- Backfill de los cambios ya registrados. La devolución y su venta nacen en la
-- MISMA transacción, así que comparten el `fecha` exacto (las dos usan now()).
-- Solo se emparejan las vivas: un cambio ya anulado puede tener dos devoluciones
-- con esa misma fecha (la anulada y la que la reemplazó), y ahí no se adivina.
-- Lo que quede ambiguo se deja nulo y fn_anular_cambio avisa en vez de suponer.
update ventas v
   set devolucion_cambio_id = c.dev_id
  from (
    select d.venta_id, d.fecha, (array_agg(d.id))[1] as dev_id, count(*) as n
      from devoluciones d
     where d.motivo ilike 'Cambio desde venta%'
       and d.estado <> 'anulada'
     group by d.venta_id, d.fecha
  ) c
 where v.cambio_de_venta_id = c.venta_id
   and v.fecha = c.fecha
   and c.n = 1
   and v.anulada = false
   and v.devolucion_cambio_id is null;

-- ────────────────────────────────── 2. El enlace se mantiene solo, por trigger ──
-- fn_registrar_cambio ya cierra su trabajo con un
--   `update ventas set cambio_de_venta_id = ... where id = <venta nueva>`
-- y para entonces la devolución de ese cambio ya existe. El trigger se cuelga de
-- ese UPDATE y completa la pareja, así no hay que reescribir esa función —que
-- calcula crédito, permuta y reembolso— para agregarle tres líneas.
CREATE OR REPLACE FUNCTION public.trg_venta_enlazar_devolucion_cambio()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_n integer;
  v_id uuid;
begin
  if new.cambio_de_venta_id is null or new.devolucion_cambio_id is not null then
    return new;
  end if;
  -- NO se filtra por el motivo: el prefijo "Cambio desde venta #N" lo escribe
  -- ModalCambioProducto, no el backend (fn_registrar_cambio pasa p_motivo tal
  -- cual). El criterio real es estructural — una devolución corriente de esa
  -- misma venta tendría otro `fecha`: el mismo timestamp al microsegundo solo
  -- lo produce fn_registrar_cambio, que crea las dos en una transacción.
  select count(*), (array_agg(d.id))[1] into v_n, v_id
    from devoluciones d
   where d.venta_id = new.cambio_de_venta_id
     and d.fecha = new.fecha
     and d.estado <> 'anulada';
  -- Si hay más de una candidata no se adivina: el enlace se queda nulo y
  -- fn_anular_cambio lo dice en voz alta cuando alguien intente anular.
  if v_n = 1 then
    new.devolucion_cambio_id := v_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_ventas_enlazar_devolucion_cambio on ventas;
create trigger trg_ventas_enlazar_devolucion_cambio
  before update of cambio_de_venta_id on ventas
  for each row execute function public.trg_venta_enlazar_devolucion_cambio();

-- ────────────────────────────────────────────── 3. Anular el cambio entero ──
CREATE OR REPLACE FUNCTION public.fn_anular_cambio(p_venta_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_rol    text;
  v_venta  ventas%rowtype;
  v_dev    devoluciones%rowtype;
  v_dev_id uuid;
  v_n      integer;
  v_item   record;
  v_ant    integer;
  v_post   integer;
  v_target uuid;
  v_reverse integer;
  v_num_orig integer;
  v_compra_id uuid;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_nota   text;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select get_my_rol() into v_rol;
  if v_rol is distinct from 'Admin' then
    raise exception 'Solo el administrador puede anular un cambio de producto';
  end if;

  select * into v_venta from ventas where id = p_venta_id for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v_venta.cambio_de_venta_id is null
     and coalesce(v_venta.observaciones, '') not like 'Cambio por venta #%' then
    raise exception 'La venta #% no salió de un cambio de producto. Para anularla usa la anulación normal desde Ventas.',
      v_venta.numero;
  end if;
  if v_venta.anulada then
    raise exception 'El cambio de la venta #% ya está anulado', v_venta.numero;
  end if;

  select numero into v_num_orig from ventas where id = v_venta.cambio_de_venta_id;
  v_nota := 'Anulación del cambio sobre la venta #' || coalesce(v_num_orig::text, '?')
         || ' (venta #' || v_venta.numero || ')'
         || coalesce(': ' || v_motivo, '');

  -- La devolución pareja: enlace directo si lo hay; si no, el `fecha` exacto que
  -- comparten por haber nacido en la misma transacción. Si queda ambiguo NO se
  -- adivina: se aborta y se dice por qué, que peor es equivocarse de devolución.
  v_dev_id := v_venta.devolucion_cambio_id;
  if v_dev_id is null then
    select count(*), (array_agg(d.id))[1] into v_n, v_dev_id
      from devoluciones d
     where d.venta_id = v_venta.cambio_de_venta_id
       and d.fecha = v_venta.fecha
       and d.estado <> 'anulada';
    if v_n <> 1 then
      raise exception 'No se pudo identificar la devolución de este cambio (candidatas: %). Hay que revisarlo a mano antes de anular.',
        v_n;
    end if;
  end if;

  select * into v_dev from devoluciones where id = v_dev_id for update;
  if not found then
    raise exception 'No aparece la devolución del cambio de la venta #%. Sin ella no se puede devolver el inventario a como estaba.',
      v_venta.numero;
  end if;
  if v_dev.estado = 'anulada' then
    raise exception 'La devolución #% de este cambio ya está anulada; el cambio quedó a medias y hay que revisarlo a mano.',
      v_dev.numero;
  end if;

  -- 1) Lo que el cliente había devuelto se lo vuelve a llevar: sale del stock.
  --    Mismo criterio que fn_anular_devolucion según el destino que se le dio.
  if v_dev.destino_stock = 'no_reingresa' then
    v_target := null; v_reverse := 0;
  elsif v_dev.destino_stock = 'chatarra' then
    v_target := v_dev.chatarra_producto_id;
    v_reverse := case when v_dev.chatarra_producto_id is null then 0 else -v_dev.cantidad end;
  else
    v_target := v_dev.producto_id; v_reverse := -v_dev.cantidad;
  end if;

  if v_target is not null and v_reverse <> 0 then
    select cantidad into v_ant from inventario
     where producto_id = v_target and sede_id = v_dev.sede_id for update;
    if not found then
      raise exception 'No hay registro de inventario del producto devuelto en %; no se puede revertir el cambio.',
        v_dev.sede_id;
    end if;
    if v_ant < abs(v_reverse) then
      raise exception 'No se puede anular el cambio: en % quedan % unidad(es) de las % que había devuelto el cliente, el resto ya se vendió o se movió. Repón el stock primero.',
        v_dev.sede_id, v_ant, abs(v_reverse);
    end if;
    update inventario
       set cantidad = cantidad + v_reverse, ultimo_movimiento = now(), updated_at = now()
     where producto_id = v_target and sede_id = v_dev.sede_id
     returning cantidad into v_post;
    insert into movimientos (producto_id, sede_id, tipo, cantidad, stock_anterior, stock_posterior,
                             referencia_id, referencia_tipo, usuario_id, observaciones)
    values (v_target, v_dev.sede_id, 'ajuste', v_reverse, v_ant, v_post,
            v_dev.id, 'devolucion', v_uid,
            v_nota || ' — revierte la devolución #' || v_dev.numero);
    perform fn_actualizar_estado_stock(v_target, v_dev.sede_id);
  end if;

  -- 2) Lo que se había llevado a cambio vuelve al stock.
  for v_item in
    select * from detalle_venta where venta_id = p_venta_id and producto_id is not null
  loop
    select cantidad into v_ant from inventario
     where producto_id = v_item.producto_id and sede_id = v_venta.sede_id for update;
    v_post := coalesce(v_ant, 0) + v_item.cantidad;
    update inventario
       set cantidad = v_post, ultimo_movimiento = now(), updated_at = now()
     where producto_id = v_item.producto_id and sede_id = v_venta.sede_id;
    insert into movimientos (producto_id, sede_id, tipo, cantidad, stock_anterior, stock_posterior,
                             referencia_id, referencia_tipo, usuario_id, observaciones)
    values (v_item.producto_id, v_venta.sede_id, 'ajuste', v_item.cantidad,
            coalesce(v_ant, 0), v_post, p_venta_id, 'venta', v_uid, v_nota);
    perform fn_actualizar_estado_stock(v_item.producto_id, v_venta.sede_id);
  end loop;

  -- 3) Las dos patas quedan anuladas. El stock ya se movió arriba, por eso no se
  --    llama a fn_anular_venta (volvería a reingresar el producto nuevo).
  perform set_config('cdv.anulando_venta', 'on', true);
  update ventas
     set anulada = true, anulada_por = v_uid, anulada_en = now(),
         motivo_anulacion = coalesce(v_motivo, 'Anulación del cambio de producto')
   where id = p_venta_id;
  perform set_config('cdv.anulando_venta', 'off', true);

  update pagos_cuenta
     set anulado = true, anulado_por = v_uid, anulado_en = now(),
         motivo_anulacion = coalesce(v_motivo, 'Cambio de producto anulado')
   where venta_id = p_venta_id and coalesce(anulado, false) = false;

  update devoluciones
     set estado = 'anulada', anulado_por = v_uid, anulado_at = now(),
         motivo_anulacion = coalesce(v_motivo, 'Anulación del cambio de producto'),
         updated_at = now()
   where id = v_dev.id;

  -- 4) Si el cambio había dejado plata a favor del cliente, fn_registrar_cambio
  --    creó un egreso de caja menor en la misma transacción (mismo `fecha`). Se
  --    cancela para que la caja no quede con una salida huérfana.
  select id into v_compra_id from compras
   where es_caja_menor = true
     and estado <> 'cancelada'
     and sede_destino_id = v_venta.sede_id
     and concepto = 'Devolución por cambio - venta #' || coalesce(v_num_orig::text, '')
     and fecha = v_venta.fecha
   limit 1;
  if v_compra_id is not null then
    perform fn_cancelar_compra(v_compra_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'venta_id', p_venta_id,
    'venta_numero', v_venta.numero,
    'venta_original_numero', v_num_orig,
    'devolucion_id', v_dev.id,
    'devolucion_numero', v_dev.numero,
    'unidades_devueltas_al_cliente', v_dev.cantidad,
    'egreso_cancelado', v_compra_id,
    'total_que_deja_de_contar', v_venta.total
  );
end;
$function$;

revoke execute on function public.fn_anular_cambio(uuid, text) from anon, public;
grant  execute on function public.fn_anular_cambio(uuid, text) to authenticated;

comment on function public.fn_anular_cambio(uuid, text) is
  'Revierte un cambio de producto completo: devuelve al stock lo que el cliente se llevó, saca lo que había devuelto, anula la venta de la diferencia y su devolución, y cancela el egreso de caja menor si lo hubo. Solo Admin.';

-- ───────────── 4. fn_anular_devolucion: mensaje y guard del cambio ─────────
-- Dos parches sobre la definición VIVA, igual que el punto 5: así esta
-- migración no pisa una versión más nueva que la que quedó en el repo (se
-- comprobó que las hay). Si el texto esperado no está exactamente una vez,
-- aborta en vez de parchear a ciegas.

-- 4a. El mensaje mandaba a "anular la venta del cambio desde Ventas", donde
-- fn_anular_venta lo rechazaba: un callejón sin salida. Ahora nombra la
-- operación que sí existe, con el número de venta para llegar de una.
DO $do$
DECLARE
  v_src text;
  v_anchor text := $a$RAISE EXCEPTION 'La devolución #% es parte de un cambio de producto. Para revertirla, anula la venta del cambio desde Ventas.', v_dev.numero;$a$;
  v_fix text := $f$RAISE EXCEPTION 'La devolución #% es una de las dos patas de un cambio de producto: se revierten juntas, o el inventario queda descuadrado. Abre la venta % y usa "Anular cambio".',
      v_dev.numero,
      COALESCE('#' || (SELECT v.numero::text FROM ventas v
                        WHERE (v.devolucion_cambio_id = v_dev.id
                            OR (v.cambio_de_venta_id = v_dev.venta_id AND v.fecha = v_dev.fecha))
                          AND v.anulada = false
                        ORDER BY v.numero DESC LIMIT 1), 'del cambio');$f$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_anular_devolucion';
  IF v_src IS NULL THEN RAISE EXCEPTION 'No existe fn_anular_devolucion'; END IF;
  IF position('Anular cambio' in v_src) > 0 THEN
    RAISE NOTICE 'fn_anular_devolucion ya nombra la salida real; no se toca.';
    RETURN;
  END IF;
  IF (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'El mensaje esperado no aparece exactamente una vez en fn_anular_devolucion; hay que revisarlo a mano.';
  END IF;
  EXECUTE replace(v_src, v_anchor, v_fix);
END
$do$;

-- 4b. El guard que impide anular una sola pata miraba SOLO el texto del motivo,
-- y ese prefijo lo escribe ModalCambioProducto, no el backend: una devolución
-- de cambio registrada por RPC con otro motivo se podía anular sola e inflar el
-- inventario. Ahora manda el enlace estructural; el texto queda de respaldo
-- para los cambios viejos que no alcanzaron enlace en el backfill.
DO $do$
DECLARE
  v_src text;
  v_anchor text := $a$IF v_dev.motivo ILIKE 'Cambio desde venta%' THEN$a$;
  v_fix text := $f$IF v_dev.motivo ILIKE 'Cambio desde venta%'
     OR EXISTS (SELECT 1 FROM ventas v
                 WHERE v.devolucion_cambio_id = v_dev.id AND v.anulada = false) THEN$f$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_anular_devolucion';
  IF v_src IS NULL THEN RAISE EXCEPTION 'No existe fn_anular_devolucion'; END IF;
  IF position('devolucion_cambio_id = v_dev.id AND v.anulada' in v_src) > 0 THEN
    RAISE NOTICE 'fn_anular_devolucion ya usa el enlace estructural; no se toca.';
    RETURN;
  END IF;
  IF (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'El guard esperado no aparece exactamente una vez en fn_anular_devolucion.';
  END IF;
  EXECUTE replace(v_src, v_anchor, v_fix);
END
$do$;

-- ────────── 5. Una devolución ANULADA seguía contando como "ya devuelto" ──
-- fn_registrar_devolucion topa la cantidad con lo vendido y para eso suma las
-- devoluciones previas de esa venta y ese producto… todas, incluidas las
-- anuladas. O sea: anular una devolución de cliente la dejaba imposible de
-- volver a registrar ("Cantidad excede lo vendido"), y sin poder rehacerla,
-- anular no servía de nada. Apareció al corregir la devolución #38: el paso de
-- rehacer el cambio con 2 unidades chocaba contra la #38 ya anulada.
--
-- El parche se aplica sobre la definición VIVA en vez de reescribir la función
-- entera: así no hay riesgo de que esta migración pise una versión más nueva
-- que la que quedó en el repo. Si el texto esperado no está exactamente una
-- vez, aborta en lugar de parchear a ciegas.
DO $do$
DECLARE
  v_src text;
  v_anchor text := 'FROM devoluciones WHERE venta_id = p_venta_id AND producto_id = p_producto_id;';
  v_fix text := 'FROM devoluciones WHERE venta_id = p_venta_id AND producto_id = p_producto_id
       AND estado <> ''anulada'';';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_registrar_devolucion';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'No existe fn_registrar_devolucion';
  END IF;
  IF position('estado <> ''anulada''' in v_src) > 0 THEN
    RAISE NOTICE 'fn_registrar_devolucion ya excluye las anuladas; no se toca.';
    RETURN;
  END IF;
  IF (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'El conteo de devoluciones previas no quedó donde se esperaba en fn_registrar_devolucion; hay que revisarlo a mano en vez de parchear a ciegas.';
  END IF;
  EXECUTE replace(v_src, v_anchor, v_fix);
END
$do$;
