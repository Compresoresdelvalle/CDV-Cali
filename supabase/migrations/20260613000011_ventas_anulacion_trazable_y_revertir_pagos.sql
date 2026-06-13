-- Paso 10 — TRAZA-02 + DINERO-05 (MEDIA)
--
-- TRAZA-02: la anulación de venta no dejaba rastro de quién/cuándo/por qué (solo el flag
--   anulada). Fix: columnas anulada_por/anulada_en/motivo_anulacion en ventas, seteadas por
--   fn_anular_venta. La función pasa a aceptar p_motivo (opcional).
--
-- DINERO-05: fn_anular_venta no revertía los pagos a cuenta (abonos) asociados a la venta
--   → quedaban como pagos vivos en el ledger. Fix: marcar anulado=true los pagos_cuenta de la
--   venta. (abonos_cotizacion no se tocan: no tienen columna anulado y la vista de cartera ya
--   excluye ventas anuladas, así que no descuadran.)
--
-- Se recrea fn_anular_venta con nueva firma (p_venta_id, p_motivo default null). Conserva el
-- guard auth.uid()/is distinct from 'Admin' (RLS-02/03) y el flag cdv.anulando_venta que exige
-- el trigger trg_ventas_proteger_anulacion. Se reaplica el hardening (revoke anon, RLS-09).

-- ── TRAZA-02: columnas de auditoría de anulación ─────────────────────────────────
alter table public.ventas
  add column if not exists anulada_por      uuid references usuarios(id),
  add column if not exists anulada_en        timestamptz,
  add column if not exists motivo_anulacion  text;

-- ── fn_anular_venta: trazable (TRAZA-02) + revierte pagos (DINERO-05) ─────────────
drop function if exists public.fn_anular_venta(uuid);

create or replace function public.fn_anular_venta(p_venta_id uuid, p_motivo text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid        uuid := auth.uid();
  v_rol        text;
  v_anulada    boolean;
  v_item       detalle_venta%rowtype;
  v_sede_id    text;
  v_stock_ant  integer;
  v_stock_post integer;
  v_motivo     text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select get_my_rol() into v_rol;
  if v_rol is distinct from 'Admin' then
    raise exception 'Solo el administrador puede anular ventas';
  end if;

  select anulada, sede_id into v_anulada, v_sede_id
  from ventas where id = p_venta_id;

  if not found then
    raise exception 'Venta no encontrada';
  end if;

  if v_anulada then
    raise exception 'La venta ya fue anulada anteriormente';
  end if;

  perform set_config('cdv.anulando_venta', 'on', true);
  update ventas
     set anulada          = true,
         anulada_por      = v_uid,
         anulada_en       = now(),
         motivo_anulacion = v_motivo
   where id = p_venta_id;
  perform set_config('cdv.anulando_venta', 'off', true);

  -- DINERO-05: revertir (anular) los pagos a cuenta asociados a esta venta.
  update pagos_cuenta
     set anulado          = true,
         anulado_por      = v_uid,
         anulado_en       = now(),
         motivo_anulacion = coalesce(v_motivo, 'Venta anulada')
   where venta_id = p_venta_id
     and coalesce(anulado, false) = false;

  for v_item in
    select * from detalle_venta where venta_id = p_venta_id
  loop
    if v_item.producto_id is null then
      continue;
    end if;

    select cantidad into v_stock_ant
    from inventario
    where producto_id = v_item.producto_id and sede_id = v_sede_id
    for update;

    v_stock_post := coalesce(v_stock_ant, 0) + v_item.cantidad;

    update inventario
       set cantidad   = v_stock_post,
           updated_at = now()
     where producto_id = v_item.producto_id and sede_id = v_sede_id;

    insert into movimientos (
      producto_id, sede_id, tipo, cantidad,
      stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, observaciones
    )
    select
      v_item.producto_id, v_sede_id,
      'ajuste', v_item.cantidad,
      coalesce(v_stock_ant, 0), v_stock_post,
      p_venta_id, 'venta', v_uid,
      'Anulación de venta #' || v.numero
    from ventas v where v.id = p_venta_id;

    perform fn_actualizar_estado_stock(v_item.producto_id, v_sede_id);
  end loop;
end;
$function$;

-- Reaplicar hardening RLS-09 sobre la nueva firma.
revoke execute on function public.fn_anular_venta(uuid, text) from anon, public;
grant  execute on function public.fn_anular_venta(uuid, text) to authenticated, service_role;
