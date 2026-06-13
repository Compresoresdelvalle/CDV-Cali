-- Paso 5 — Cotizaciones (ALTA + MEDIA cheap): COTIZACIONES-01, -02, -04
--
-- COTIZACIONES-01 (ALTA): fn_convertir_cotizacion valida venta_id/sede/estado pero NO ot_id.
--   Una cotización vinculada a una OT podía además convertirse en venta → doble facturación
--   y doble consumo de stock (latente, 0 filas hoy). Fix: bloquear la conversión si ot_id no
--   es nulo + CHECK que impide que una cotización tenga ot_id Y venta_id a la vez.
--
-- COTIZACIONES-02 (ALTA): cot_all / dcot_all = get_my_rol() in (Admin,Vendedor) SIN filtro de
--   sede ni with_check → cualquier Vendedor leía/editaba/borraba cotizaciones de otras sedes
--   por REST. Fix: reescribir ambas policies acotando al Vendedor a su sede (Admin sin límite),
--   con with_check explícito.
--
-- COTIZACIONES-04 (MEDIA): detalle_cotizacion no tenía CHECK precio_unitario >= 0 (precios
--   negativos por REST). Fix: CHECK. (Datos verificados: 0 filas negativas.)
--
-- DIFERIDO: COTIZACIONES-03 (asociar cotización a OT ignora descuento/domicilio) — toca el
--   cálculo del total OT↔cotización; va en el paso de OT/follow-up.

-- ── (1) COTIZACIONES-01: bloquear conversión de cotización vinculada a OT ─────────
create or replace function public.fn_convertir_cotizacion(p_cotizacion_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cot cotizaciones%rowtype;
  v_det record;
  v_venta_id uuid;
  v_uid uuid := auth.uid();
  v_rol text; v_sede text;
  v_costo_prod numeric;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;

  select * into v_cot from cotizaciones where id = p_cotizacion_id for update;
  if not found then raise exception 'Cotizacion no encontrada'; end if;
  if v_rol <> 'Admin' and v_cot.sede_id <> v_sede then
    raise exception 'No tienes permiso para esta operacion';
  end if;
  if v_cot.venta_id is not null then
    raise exception 'Esta cotizacion ya fue convertida en venta';
  end if;
  if v_cot.ot_id is not null then
    raise exception 'Esta cotizacion esta vinculada a una orden de trabajo; se factura por la OT y no puede convertirse en venta por separado';
  end if;
  if v_cot.estado <> 'aprobada' then
    raise exception 'Solo se puede convertir una cotizacion APROBADA. Estado actual: %', v_cot.estado;
  end if;

  insert into ventas (
    vendedor_id, sede_id, cliente_nombre, cliente_nit,
    subtotal, descuento_pct, descuento_valor, domicilio, iva_pct, total, metodo_pago
  )
  values (
    v_uid, v_cot.sede_id, v_cot.cliente_nombre, v_cot.cliente_nit,
    v_cot.subtotal, coalesce(v_cot.descuento_pct, 0), v_cot.descuento_valor,
    coalesce(v_cot.domicilio, 0), v_cot.iva_pct, v_cot.total, 'efectivo'
  )
  returning id into v_venta_id;

  for v_det in
    select producto_id, servicio_id, descripcion, cantidad, precio_unitario, subtotal
      from detalle_cotizacion where cotizacion_id = p_cotizacion_id
  loop
    if v_det.servicio_id is not null then
      insert into detalle_venta (
        venta_id, producto_id, servicio_id, descripcion,
        cantidad, precio_unitario, costo_unitario, subtotal
      ) values (
        v_venta_id, null, v_det.servicio_id, v_det.descripcion,
        v_det.cantidad, v_det.precio_unitario, 0, v_det.subtotal
      );
    else
      select coalesce(p.costo_promedio, v_det.precio_unitario)
        into v_costo_prod from productos p where p.id = v_det.producto_id;
      insert into detalle_venta (
        venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal
      ) values (
        v_venta_id, v_det.producto_id, v_det.cantidad,
        v_det.precio_unitario, coalesce(v_costo_prod, v_det.precio_unitario), v_det.subtotal
      );
    end if;
  end loop;

  update cotizaciones set venta_id = v_venta_id, updated_at = now()
   where id = p_cotizacion_id;

  return jsonb_build_object('ok', true, 'venta_id', v_venta_id);
end;
$function$;

-- ── (1b) CHECK: una cotización no puede estar vinculada a OT Y convertida en venta ─
alter table public.cotizaciones drop constraint if exists cotizaciones_ot_xor_venta;
alter table public.cotizaciones
  add constraint cotizaciones_ot_xor_venta check (ot_id is null or venta_id is null);

-- ── (2) COTIZACIONES-02: RLS por sede en cotizaciones y su detalle ────────────────
drop policy if exists cot_all on public.cotizaciones;
create policy cot_all on public.cotizaciones
  for all to authenticated
  using (
    (select get_my_rol()) = 'Admin'
    or ((select get_my_rol()) = 'Vendedor' and sede_id = (select get_my_sede_id()))
  )
  with check (
    (select get_my_rol()) = 'Admin'
    or ((select get_my_rol()) = 'Vendedor' and sede_id = (select get_my_sede_id()))
  );

drop policy if exists dcot_all on public.detalle_cotizacion;
create policy dcot_all on public.detalle_cotizacion
  for all to authenticated
  using (
    exists (
      select 1 from cotizaciones c
       where c.id = detalle_cotizacion.cotizacion_id
         and ((select get_my_rol()) = 'Admin'
              or ((select get_my_rol()) = 'Vendedor' and c.sede_id = (select get_my_sede_id())))
    )
  )
  with check (
    exists (
      select 1 from cotizaciones c
       where c.id = detalle_cotizacion.cotizacion_id
         and ((select get_my_rol()) = 'Admin'
              or ((select get_my_rol()) = 'Vendedor' and c.sede_id = (select get_my_sede_id())))
    )
  );

-- ── (3) COTIZACIONES-04: precio_unitario no negativo ──────────────────────────────
alter table public.detalle_cotizacion drop constraint if exists detalle_cotizacion_precio_no_negativo;
alter table public.detalle_cotizacion
  add constraint detalle_cotizacion_precio_no_negativo check (precio_unitario >= 0);
