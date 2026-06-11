-- MEDIO (auditoría 2026-06-09, M10 — lado COMPRA): reversa/anulación de garantías
-- de compra. fn_abrir_garantia_compra descuenta stock (garantia_salida: el
-- defectuoso devuelto al proveedor) y, según resolución, emite una
-- notas_credito_proveedor o queda 'reposicion_pendiente'; fn_marcar_reposicion_recibida
-- reingresa stock (garantia_entrada) al recibir la reposición. No existía forma de
-- anular una garantía abierta por error → stock/nota permanentes.
--
-- DECISIÓN CLIENTE: implementar la reversa (anulación).
--
-- fn_anular_garantia_compra (solo Admin):
--   * Nota de crédito: solo se puede anular si NO se ha consumido (saldo_restante ==
--     monto). Se neutraliza poniendo saldo_restante = 0 (impide consumo futuro) y se
--     anota en observaciones. Si ya hubo consumo parcial, aborta (hay que revertir los
--     consumos primero — fuera del alcance hoy: fn_consumir_nota_credito no está cableada).
--   * Reversa de stock por el ledger: garantia_salida (devuelto al proveedor) → reingresa
--     +; garantia_entrada (reposición recibida) → retira − (valida disponibilidad).
--   * Marca la garantía estado='anulada' (enum agregado en migr 36) con el motivo.

create or replace function public.fn_anular_garantia_compra(p_garantia_id uuid, p_motivo text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text;
  v_gar record;
  v_nota record;
  v_mov record;
  v_stock_ant int;
  v_stock_post int;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text into v_rol from usuarios where id = v_uid;
  if v_rol <> 'Admin' then raise exception 'Solo un Admin puede anular garantías'; end if;

  select * into v_gar from garantias_compra where id = p_garantia_id for update;
  if not found then raise exception 'Garantía de compra no encontrada'; end if;
  if v_gar.estado = 'anulada' then raise exception 'La garantía ya está anulada'; end if;

  -- 1) Nota de crédito: solo anulable si está intacta (sin consumos). Se valida ANTES
  --    de tocar stock para abortar limpio si ya se consumió.
  select * into v_nota from notas_credito_proveedor where garantia_compra_id = p_garantia_id for update;
  if found then
    if v_nota.saldo_restante is distinct from v_nota.monto then
      raise exception 'No se puede anular: la nota de crédito #% ya fue consumida (saldo % de %). Revierte los consumos primero.',
        v_nota.numero, v_nota.saldo_restante, v_nota.monto;
    end if;
    update notas_credito_proveedor
       set saldo_restante = 0,
           observaciones = coalesce(nullif(trim(coalesce(observaciones,'')),'') || ' | ', '') || 'ANULADA por reversa de garantía'
     where id = v_nota.id;
  end if;

  -- 2) Reversa de los movimientos de stock de la garantía.
  for v_mov in
    select * from movimientos
     where referencia_id = p_garantia_id and referencia_tipo = 'garantia_compra'
       and tipo in ('garantia_salida','garantia_entrada')
     order by id
  loop
    select coalesce(cantidad,0) into v_stock_ant
      from inventario where producto_id = v_mov.producto_id and sede_id = v_mov.sede_id for update;
    v_stock_ant := coalesce(v_stock_ant, 0);

    if v_mov.tipo = 'garantia_salida' then
      -- defectuoso devuelto al proveedor (cantidad < 0) -> reingresar +abs
      v_stock_post := v_stock_ant + abs(v_mov.cantidad);
      update inventario set cantidad = v_stock_post, ultimo_movimiento = now(), updated_at = now()
       where producto_id = v_mov.producto_id and sede_id = v_mov.sede_id;
      insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, observaciones)
      values ('garantia_entrada', v_mov.producto_id, v_mov.sede_id, abs(v_mov.cantidad),
        v_stock_ant, v_stock_post, p_garantia_id, 'garantia_compra', v_uid,
        'Reversa por anulación de garantía');
    else
      -- reposición recibida (cantidad > 0) -> retirar, validando disponibilidad
      if v_stock_ant < v_mov.cantidad then
        raise exception 'No se puede anular: la reposición recibida (% uds en %) ya no está disponible (stock %).',
          v_mov.cantidad, v_mov.sede_id, v_stock_ant;
      end if;
      v_stock_post := v_stock_ant - v_mov.cantidad;
      update inventario set cantidad = v_stock_post, ultimo_movimiento = now(), updated_at = now()
       where producto_id = v_mov.producto_id and sede_id = v_mov.sede_id;
      insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, observaciones)
      values ('garantia_salida', v_mov.producto_id, v_mov.sede_id, -v_mov.cantidad,
        v_stock_ant, v_stock_post, p_garantia_id, 'garantia_compra', v_uid,
        'Reversa por anulación de garantía (retiro de reposición)');
    end if;
    perform fn_actualizar_estado_stock(v_mov.producto_id, v_mov.sede_id);
  end loop;

  -- 3) Marcar anulada con el motivo.
  update garantias_compra
     set estado = 'anulada',
         motivo = coalesce(nullif(trim(coalesce(motivo,'')),'') || ' | ', '') ||
                  case when nullif(trim(coalesce(p_motivo,'')),'') is not null
                       then 'ANULADA: ' || trim(p_motivo)
                       else 'ANULADA' end
   where id = p_garantia_id;
end;
$function$;
