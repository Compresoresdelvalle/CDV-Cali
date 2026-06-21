# Rediseño Órdenes de Trabajo (OT) — Opción A — Plan de Implementación

> **Para quien implemente:** este plan se ejecuta **una fase por sesión**. Antes de aplicar cada fase, presentar el cambio al usuario y esperar su OK (regla del proyecto). Todas las migraciones se aplican primero en la rama y se prueban en prod con productos `INVENTARIO DE PRUEBA` (999). NO tocar auth ni el candado append-only de `movimientos`.

**Goal:** Convertir la OT en un documento autocontenido (cotización + venta propias) donde los repuestos se descargan del inventario a precio de venta, los abonos se llevan como **anticipos** dentro de la app, y el ingreso se reconoce **una sola vez al recoger** el equipo (Opción A), con un flujo guiado de pasos obligatorios y la vendedora habilitada para todos los pasos.

**Architecture (Opción A):**

- Los **abonos = anticipos**: dinero recibido que entra a caja (vista de efectivo) pero **no es venta** todavía.
- Al **recoger** (paso 7), la OT genera **una sola venta** ligada a la OT (`ventas.origen='ot'`, `ventas.orden_id`), a precio de venta, **sin volver a tocar stock** (ya se descargó en el paso 5). Esa venta es el único ingreso.
- El **cierre** deja de contar abonos como ingreso; cuenta las ventas-OT como `ingresos_servicios` y muestra los **anticipos** como línea de efectivo aparte. Cero doble conteo.

**Tech Stack:** Supabase (PostgreSQL 17, RLS, funciones `SECURITY DEFINER`, triggers), React 19 + Vite + Zustand + Tailwind, jsPDF.

**Proyecto Supabase:** `kbgwygnmhjeyiyyxosmb`. Rama git: `fix/logica-y-errores`.

---

## Decisiones de diseño congeladas

1. **Estado de la OT (enum `estado_orden`)** — flujo guiado de 7 pasos. Se **añaden** valores nuevos al enum (no se borran los viejos, para no romper filas históricas):
   - Nuevos: `recepcion`, `diagnostico`, `cotizada`, `autorizada`, `terminada`.
   - Reutilizados: `en_proceso`, `esperando_repuesto` (pausa opcional), `entregada`, `cancelada`.
   - En desuso (solo histórico): `abierta`, `completada`, `pendiente_recogida`.
   - Mapa de pasos → estado: 1 Recepción=`recepcion`, 2 Diagnóstico=`diagnostico`, 3 Cotización=`cotizada`, 4 Autorización=`autorizada`, 5 Descarga+trabajo=`en_proceso` (pausa: `esperando_repuesto`), 6 Terminado=`terminada`, 7 Recogida=`entregada`.

2. **Precios:** `detalle_orden` gana `precio_unitario` (precio de venta). `subtotal` pasa a ser `precio_unitario * cantidad`. Se conserva `costo_unitario` para el margen. `ordenes_servicio.total = costo_mano_obra + valor_repuestos(precio) + COALESCE(valor_revision,0)`.

3. **Venta de OT:** se usa la tabla `ventas` con `origen='ot'` y `orden_id`. `detalle_venta` ya soporta líneas de producto (`producto_id`) y de servicio (`servicio_id`/`descripcion`); la venta-OT lleva los repuestos como líneas de producto + una línea de servicio (mano de obra + revisión). El stock **no** se descuenta en la venta-OT (se blinda el trigger).

4. **Anticipos:** se mantiene la tabla `abonos` (ligada a `orden_id`). Gana `venta_id` (nullable) que se llena al conciliar en la recogida. En el cierre, los abonos se muestran como **anticipos recibidos** (efectivo), no como ingreso.

5. **Permisos (toderos) + visibilidad global:** **TODOS los roles VEN las OT de todas las sedes** (lectura global), pero **solo pueden MANIPULAR (crear/editar/descargar/terminar/generar venta) las de su PROPIA sede**. Admin manipula cualquier sede. Bodeguero apoya la descarga. Solo Admin cancela/anula. Se corrige la RLS de `detalle_orden` (hoy excluye al Vendedor → FALLA 2). Aplicado en Fase 1 (escritura por sede) + Fase 1b (lectura global). En la UI: las OT de otras sedes se muestran en **modo solo lectura** (los controles de acción se deshabilitan).

6. **Anti-doble-conteo:** el ingreso se reconoce **solo** en la venta-OT (recogida). Los abonos nunca cuentan como ingreso. Se elimina del cierre el conteo de `abonos` como `ingresos_servicios`.

7. **IVA seleccionable (coherente con Ventas):** el IVA va a **nivel de OT** (no por línea), con presets **[0, 19]** y editable, igual que `VentaNueva` (`IVA_PRESETS=[0,19]`, default 19). La OT gana `iva_pct` y `descuento_valor`. Fórmula del total, idéntica a ventas: `base = costo_mano_obra + valor_repuestos + valor_revision`; `total = (base − descuento_valor) × (1 + iva_pct/100)`. El `iva_pct`/`descuento` de la OT se copian a la cabecera de la venta-OT al generarla (Fase 4). El stepper de la OT sigue el **mismo patrón visual que el stepper de `VentaNueva`**.

8. **Analítica sin doble conteo:** `fn_top_productos`, `fn_recalcular_abc` y `fn_alertas_rotacion` leen `detalle_venta` y hoy **no filtran origen**; al crear líneas de producto en la venta-OT inflarían el ABC/rotación. Se **filtran a `origen='directa'`** (los consumos de OT se rastrean por `movimientos`/reportes de OT, no por estas analíticas).

9. **Anulación y cancelación definidas — SOLO ADMIN ambas:**
   - **Anular una venta-OT** (`fn_anular_venta` con `origen='ot'`): **solo Admin**. No toca stock (nunca lo movió); revierte la OT (`venta_id=null`, `estado='terminada'`), desvincula los anticipos (`abonos.venta_id=null`) y marca la venta anulada con traza.
   - **Cancelar una OT** (`fn_cancelar_orden`): **solo Admin**. Si tiene anticipos, **debe registrar la devolución del anticipo** (movimiento de caja de salida) antes de cancelar; no se "pierde" plata silenciosamente.
   - Ningún otro rol ve ni dispara estas acciones en la UI.

10. **OT viejas (decisión del usuario):** las **entregadas** quedan como están (no se regeneran ventas retroactivas). Las **abiertas/en curso** se migran al nuevo flujo mapeando su estado legacy al nuevo (Fase 8); si alguna no aplica limpio, se deja con el flujo viejo sin romperla.

### Nota sobre "tests" en este proyecto

No hay arnés de pruebas unitarias para SQL. La validación de cada fase de backend se hace con **consultas SQL de solo lectura** (criterios de aceptación verificables) y los smokes E2E de Playwright en `tests/e2e/` que **corre el usuario** con login real. Cada fase termina con un commit.

---

## Mapa de archivos

**Backend (nuevas migraciones en `supabase/migrations/`):**

- `2026MMDD0001_otA_esquema.sql` — columnas y enum nuevos.
- `2026MMDD0002_otA_rls_toderos.sql` — permisos.
- `2026MMDD0003_otA_consumo_precio_venta.sql` — trigger de consumo + total a precio.
- `2026MMDD0004_otA_maquina_estados.sql` — transiciones del flujo guiado + gates.
- `2026MMDD0005_otA_generar_venta_ot.sql` — `fn_generar_venta_ot` + blindaje de stock en ventas.
- `2026MMDD0006_otA_cierre_anticipos.sql` — `_fn_cierre_totales`/`fn_dashboard_kpis` sin doble conteo + anticipos.
- `2026MMDD0007_otA_backfill_y_limpieza.sql` — backfill precios + detección del "servicio abono".

**Frontend:**

- `src/pages/ops/OrdenDetalle.jsx` — reescritura a flujo guiado (stepper).
- `src/components/ot/OrdenStepper.jsx` — **nuevo**: barra de pasos + gating.
- `src/components/ot/pasos/*.jsx` — **nuevos**: un panel por paso.
- `src/pages/ops/OrdenNueva.jsx` — paso 1 (recepción) alineado al nuevo modelo.
- `src/lib/ordenes-ui.js` — labels de estados/pasos, helpers de gating.
- `src/lib/pdf/ordenPDF.js` — constancia de recepción vs factura final.
- `src/pages/admin/Cierres.jsx` y `src/pages/admin/Dashboard.jsx` — línea de anticipos + servicios desde ventas-OT.

---

## FASE 0 — Esquema base (DB)

**Objetivo:** dejar el esquema listo (columnas, enum, FKs) sin cambiar comportamiento todavía.

**Archivo:** crear `supabase/migrations/2026MMDD0001_otA_esquema.sql`.

**Cambios (DDL):**

```sql
-- 1) Enum: añadir estados del flujo guiado (idempotente)
do $$ begin
  alter type estado_orden add value if not exists 'recepcion';
  alter type estado_orden add value if not exists 'diagnostico';
  alter type estado_orden add value if not exists 'cotizada';
  alter type estado_orden add value if not exists 'autorizada';
  alter type estado_orden add value if not exists 'terminada';
end $$;

-- 2) ordenes_servicio: precio de repuestos, IVA/descuento (coherente con ventas) y venta generada
alter table ordenes_servicio
  add column if not exists valor_repuestos numeric(12,2) not null default 0,
  add column if not exists iva_pct numeric(5,2) not null default 0,        -- 0 = sin IVA, 19 = con IVA (editable)
  add column if not exists descuento_valor numeric(12,2) not null default 0,
  add column if not exists venta_id uuid references ventas(id);

-- 3) detalle_orden: precio de venta por línea
alter table detalle_orden
  add column if not exists precio_unitario numeric(12,2) not null default 0;

-- 4) ventas: origen y vínculo a OT
alter table ventas
  add column if not exists origen text not null default 'directa'
    check (origen in ('directa','ot')),
  add column if not exists orden_id uuid references ordenes_servicio(id);

-- 5) abonos (anticipos): vínculo a la venta conciliada
alter table abonos
  add column if not exists venta_id uuid references ventas(id);

-- 6) índices de FK nuevos
create index if not exists ix_ventas_orden_id on ventas(orden_id);
create index if not exists ix_ordenes_venta_id on ordenes_servicio(venta_id);
create index if not exists ix_abonos_venta_id on abonos(venta_id);
```

**Criterios de aceptación (SQL read-only):**

- `select unnest(enum_range(null::estado_orden));` incluye los 5 nuevos.
- Las columnas existen: `select column_name from information_schema.columns where table_name in ('ordenes_servicio','detalle_orden','ventas','abonos') and column_name in ('valor_repuestos','venta_id','precio_unitario','origen','orden_id');` → 6+ filas.
- Nada cambió de comportamiento (las funciones siguen iguales).

**Commit:** `feat(ot): esquema base opción A (enum, precios, vínculo venta-OT)`

---

## FASE 1 — Permisos RLS (toderos + arreglo FALLA 2)

**Objetivo:** que Admin/Vendedor/Tecnico de la sede puedan operar **todos** los pasos; corregir que el Vendedor no podía descargar repuestos.

**Archivo:** crear `supabase/migrations/2026MMDD0002_otA_rls_toderos.sql`.

**Cambios:**

```sql
-- detalle_orden: permitir Admin/Vendedor/Tecnico de la sede de la OT (no entregada/cancelada)
drop policy if exists do_write on detalle_orden;
create policy do_write on detalle_orden for all to authenticated
using (exists (
  select 1 from ordenes_servicio o
  where o.id = detalle_orden.orden_id
    and o.estado <> all (array['entregada','cancelada']::estado_orden[])
    and ( (select get_my_rol()) = 'Admin'
          or o.sede_id = (select get_my_sede_id()) )
))
with check (exists (
  select 1 from ordenes_servicio o
  where o.id = detalle_orden.orden_id
    and o.estado <> all (array['entregada','cancelada']::estado_orden[])
    and ( (select get_my_rol()) = 'Admin'
          or o.sede_id = (select get_my_sede_id()) )
));

-- ordenes_servicio update: ya permite Vendedor de la sede; reafirmamos Tecnico de la sede también
drop policy if exists os_update on ordenes_servicio;
create policy os_update on ordenes_servicio for update to authenticated
using (estado <> 'entregada'
  and ( (select get_my_rol()) = 'Admin' or sede_id = (select get_my_sede_id()) ))
with check ( (select get_my_rol()) = 'Admin' or sede_id = (select get_my_sede_id()) );
```

**Criterios de aceptación:**

- `select policyname, qual from pg_policies where tablename='detalle_orden';` → `do_write` ya no menciona `tecnico_id = auth.uid()` exclusivo; usa sede.
- Validación funcional (usuario, en UI con login de Vendedor): agregar **2** repuestos a una OT de prueba de su sede → ambos quedan. (Antes fallaba el primero.)

**Commit:** `fix(ot): RLS toderos — vendedor puede descargar repuestos (FALLA 2)`

---

## FASE 2 — Consumo de repuestos a precio de venta

**Objetivo:** que el repuesto descargado se registre a **precio de venta** (lo que paga el cliente) manteniendo el costo para el margen; recalcular el total con precio.

**Archivo:** crear `supabase/migrations/2026MMDD0003_otA_consumo_precio_venta.sql`.

**Cambios (reemplaza `trg_orden_consumir_repuesto` y el recálculo de totales):**

```sql
create or replace function public.trg_orden_consumir_repuesto()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_orden record; v_cant int; v_precio numeric; v_costo numeric;
begin
  select tecnico_id, sede_id into v_orden from ordenes_servicio where id = NEW.orden_id;

  -- precio y costo del producto (precio de venta para cobrar; costo para margen)
  select precio_venta, costo_promedio into v_precio, v_costo from productos where id = NEW.producto_id;

  -- Si el front no mandó precio_unitario, lo tomamos del catálogo
  if NEW.precio_unitario is null or NEW.precio_unitario = 0 then
    NEW.precio_unitario := coalesce(v_precio, 0);
  end if;
  if NEW.costo_unitario is null or NEW.costo_unitario = 0 then
    NEW.costo_unitario := coalesce(v_costo, 0);
  end if;
  NEW.subtotal := NEW.precio_unitario * NEW.cantidad;

  -- Descarga del pool de INSUMO (como hoy), con lock
  select cantidad_insumo into v_cant from inventario
   where producto_id = NEW.producto_id and sede_id = v_orden.sede_id for update;
  if v_cant is null or v_cant < NEW.cantidad then
    raise exception 'Stock de insumo insuficiente (disponible %, requerido %).', coalesce(v_cant,0), NEW.cantidad;
  end if;
  update inventario set cantidad_insumo = cantidad_insumo - NEW.cantidad,
    ultimo_movimiento = now(), updated_at = now()
   where producto_id = NEW.producto_id and sede_id = v_orden.sede_id;

  insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id)
  values ('orden_consumo', NEW.producto_id, v_orden.sede_id, -NEW.cantidad,
    v_cant, v_cant - NEW.cantidad, NEW.orden_id, 'orden_servicio',
    coalesce(auth.uid(), v_orden.tecnico_id));

  -- Totales: valor a precio para cobro; costo aparte para margen
  update ordenes_servicio set
    valor_repuestos = (select coalesce(sum(subtotal),0) from detalle_orden where orden_id = NEW.orden_id),
    costo_repuestos = (select coalesce(sum(costo_unitario*cantidad),0) from detalle_orden where orden_id = NEW.orden_id),
    total = costo_mano_obra
          + (select coalesce(sum(subtotal),0) from detalle_orden where orden_id = NEW.orden_id)
          + coalesce(valor_revision,0)
   where id = NEW.orden_id;

  perform fn_actualizar_estado_stock(NEW.producto_id, v_orden.sede_id);
  return NEW;
end $$;
```

> Nota: cambiar el trigger a `BEFORE INSERT` (para poder fijar `NEW.precio_unitario/subtotal`). Hoy es `AFTER INSERT`; la migración debe recrear el trigger como `BEFORE INSERT`. Igualmente actualizar `trg_orden_recalcular_totales` (DELETE/UPDATE) y `trg_orden_recalcular_total_mo` para usar la misma fórmula con `valor_repuestos`.

**Criterios de aceptación:**

- Insertar un repuesto de prueba → `detalle_orden.precio_unitario = productos.precio_venta`, `subtotal = precio*cant`.
- `ordenes_servicio.total` usa precio (no costo). `costo_repuestos` queda a costo para margen.
- El movimiento `orden_consumo` sigue registrando la salida de `cantidad_insumo`.

**Commit:** `feat(ot): repuestos a precio de venta + total con precio (costo para margen)`

---

## FASE 3 — Máquina de estados del flujo guiado (gates en BD)

**Objetivo:** imponer en la BD el orden de los 7 pasos: no avanzar si falta el requisito. Defensa dura detrás del stepper del frontend.

**Archivo:** crear `supabase/migrations/2026MMDD0004_otA_maquina_estados.sql`.

**Cambios (reescribe `trg_orden_validar_transicion` y `trg_orden_validar_anticipo`):**

```sql
create or replace function public.trg_orden_validar_transicion()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_tot_abonos numeric; v_items int;
begin
  if OLD.estado = NEW.estado then return NEW; end if;

  -- inmutables
  if OLD.estado in ('entregada','cancelada') then
    raise exception 'La OT % es inmutable (estado %)', OLD.numero, OLD.estado;
  end if;

  -- cualquiera -> cancelada (solo Admin lo invoca vía fn_cancelar_orden)
  if NEW.estado = 'cancelada' then return NEW; end if;

  -- transiciones permitidas del flujo guiado
  if not (
       (OLD.estado = 'recepcion'  and NEW.estado = 'diagnostico')
    or (OLD.estado = 'diagnostico' and NEW.estado = 'cotizada')
    or (OLD.estado = 'cotizada'    and NEW.estado = 'autorizada')
    or (OLD.estado = 'autorizada'  and NEW.estado = 'en_proceso')
    or (OLD.estado = 'en_proceso'  and NEW.estado in ('esperando_repuesto','terminada'))
    or (OLD.estado = 'esperando_repuesto' and NEW.estado in ('en_proceso','terminada'))
    or (OLD.estado = 'terminada'   and NEW.estado = 'entregada')
    -- compatibilidad con OT viejas en estados legacy:
    or (OLD.estado in ('abierta','completada','pendiente_recogida'))
  ) then
    raise exception 'Transición no permitida: % -> %', OLD.estado, NEW.estado;
  end if;

  -- GATES de cada paso
  if NEW.estado = 'cotizada' and coalesce(NEW.diagnostico,'') = '' then
    raise exception 'Falta el diagnóstico para cotizar';
  end if;
  if NEW.estado = 'autorizada' then
    select coalesce(sum(monto),0) into v_tot_abonos from abonos where orden_id = NEW.id;
    if v_tot_abonos <= 0 then raise exception 'Falta registrar el anticipo para autorizar'; end if;
  end if;
  if NEW.estado = 'terminada' and coalesce(NEW.trabajo_realizado,'') = '' then
    raise exception 'Falta registrar el trabajo realizado para terminar';
  end if;
  return NEW;
end $$;
```

> El trigger anti-anticipo viejo (`trg_orden_validar_anticipo`) se sustituye por estos gates. La generación de venta (paso 7) NO se hace con un `update estado='entregada'` directo desde el front, sino con `fn_generar_venta_ot` (Fase 5), que pondrá `entregada` internamente.

**Criterios de aceptación:**

- Intentar `cotizada` sin diagnóstico → error claro.
- Intentar `autorizada` sin abono → error claro.
- Saltar pasos (`recepcion`→`terminada`) → error.

**Commit:** `feat(ot): máquina de estados guiada con gates obligatorios`

---

## FASE 4 — Generar la venta en la recogida + blindar stock

**Objetivo:** en el paso 7, crear **una** venta-OT (a precio, sin tocar stock), conciliar anticipos y dejar la OT `entregada`. Blindar el trigger de stock de ventas para que `origen='ot'` no descuente.

**Archivo:** crear `supabase/migrations/2026MMDD0005_otA_generar_venta_ot.sql`.

**Cambios:**

```sql
-- 1) Blindaje: las ventas de OT NO descuentan stock (ya se descargó en la OT)
create or replace function public.trg_venta_descontar_stock()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_inv record; v_venta record;
begin
  if NEW.producto_id is null then return NEW; end if;
  select sede_id, vendedor_id, origen into v_venta from ventas where id = NEW.venta_id;
  if v_venta.origen = 'ot' then
    return NEW;   -- el stock ya salió por la OT; no descontar de nuevo
  end if;
  -- ... (resto idéntico al actual: lock, validar, descontar, movimiento 'venta') ...
  select id, cantidad into v_inv from inventario
   where producto_id = NEW.producto_id and sede_id = v_venta.sede_id for update;
  if not found then
    insert into inventario (producto_id, sede_id, cantidad) values (NEW.producto_id, v_venta.sede_id, 0)
      on conflict (producto_id, sede_id) do nothing;
    select id, cantidad into v_inv from inventario
     where producto_id = NEW.producto_id and sede_id = v_venta.sede_id for update;
  end if;
  if coalesce(v_inv.cantidad,0) < NEW.cantidad then
    raise exception 'Stock insuficiente en sede % (disp %, req %)', v_venta.sede_id, coalesce(v_inv.cantidad,0), NEW.cantidad;
  end if;
  update inventario set cantidad = cantidad - NEW.cantidad, ultimo_movimiento = now(), updated_at = now() where id = v_inv.id;
  insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id)
  values ('venta', NEW.producto_id, v_venta.sede_id, -NEW.cantidad, v_inv.cantidad, v_inv.cantidad - NEW.cantidad, NEW.venta_id, 'venta', v_venta.vendedor_id);
  perform fn_actualizar_estado_stock(NEW.producto_id, v_venta.sede_id);
  return NEW;
end $$;

-- 2) Generar la venta de la OT (paso 7)
create or replace function public.fn_generar_venta_ot(p_orden_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_uid uuid := auth.uid(); v_rol text; v_o ordenes_servicio; v_venta_id uuid;
        v_abonado numeric; v_det record;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select rol::text into v_rol from usuarios where id = v_uid;
  select * into v_o from ordenes_servicio where id = p_orden_id for update;
  if not found then raise exception 'OT no encontrada'; end if;
  if v_rol <> 'Admin' and v_o.sede_id <> get_my_sede_id() then
    raise exception 'Sin permiso sobre esta OT';
  end if;
  if v_o.venta_id is not null then raise exception 'La OT ya tiene venta generada'; end if;
  if v_o.estado <> 'terminada' then raise exception 'La OT debe estar TERMINADA para entregar'; end if;

  select coalesce(sum(monto),0) into v_abonado from abonos where orden_id = p_orden_id;
  if v_abonado + 0.01 < v_o.total then
    raise exception 'Saldo pendiente: total % vs abonado %', v_o.total, v_abonado;
  end if;

  -- Cabecera de venta-OT (sin IVA extra: el total de la OT ya es el precio final)
  insert into ventas (sede_id, vendedor_id, cliente_nombre, cliente_id, subtotal, descuento_pct,
                      iva_pct, total, metodo_pago, observaciones, origen, orden_id)
  values (v_o.sede_id, v_uid, v_o.cliente_nombre, v_o.cliente_id, v_o.total, 0,
          0, v_o.total, 'Varios', 'Venta generada de OT #'||v_o.numero, 'ot', p_orden_id)
  returning id into v_venta_id;

  -- Líneas: repuestos a precio (no descuentan stock por el blindaje)
  for v_det in select * from detalle_orden where orden_id = p_orden_id loop
    insert into detalle_venta (venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal)
    values (v_venta_id, v_det.producto_id, v_det.cantidad, v_det.precio_unitario, v_det.costo_unitario, v_det.subtotal);
  end loop;
  -- Línea de servicio: mano de obra + revisión
  if coalesce(v_o.costo_mano_obra,0) + coalesce(v_o.valor_revision,0) > 0 then
    insert into detalle_venta (venta_id, producto_id, descripcion, cantidad, precio_unitario, subtotal)
    values (v_venta_id, null, 'Mano de obra / revisión OT #'||v_o.numero, 1,
            coalesce(v_o.costo_mano_obra,0)+coalesce(v_o.valor_revision,0),
            coalesce(v_o.costo_mano_obra,0)+coalesce(v_o.valor_revision,0));
  end if;

  -- Conciliar anticipos y cerrar OT
  update abonos set venta_id = v_venta_id where orden_id = p_orden_id;
  update ordenes_servicio set venta_id = v_venta_id, estado = 'entregada', fecha_entrega = now()
   where id = p_orden_id;

  return jsonb_build_object('venta_id', v_venta_id, 'total', v_o.total);
end $$;

revoke execute on function public.fn_generar_venta_ot(uuid) from public, anon;
grant execute on function public.fn_generar_venta_ot(uuid) to authenticated;
```

**Criterios de aceptación:**

- Llamar `fn_generar_venta_ot` sobre una OT `terminada` con saldo cubierto → crea 1 venta `origen='ot'`, líneas de repuesto + servicio, abonos con `venta_id`, OT `entregada` con `venta_id`.
- **El stock NO se mueve** por esta venta: verificar que no hay nuevo movimiento `tipo='venta'` para esos productos (read-only sobre `movimientos`).
- Idempotencia: segunda llamada → error "ya tiene venta".
- Llamar sin saldo cubierto → error "Saldo pendiente".

**Commit:** `feat(ot): generar venta en la recogida sin tocar stock (Opción A)`

---

## FASE 5 — Cierre y dashboard sin doble conteo (anticipos)

**Objetivo:** el ingreso por servicios pasa a venir de **ventas-OT**, no de abonos; los abonos se muestran como **anticipos** (efectivo) aparte. Las ventas directas (`origen='directa'`) siguen como `ingresos_productos`.

**Archivo:** crear `supabase/migrations/2026MMDD0006_otA_cierre_anticipos.sql`.

**Cambios (reescribe `_fn_cierre_totales` y `fn_dashboard_kpis`):**

- `ingresos_productos` = `sum(ventas.total) where origen='directa' and anulada=false`.
- `ingresos_servicios` = `sum(ventas.total) where origen='ot' and anulada=false`.
- **Quitar** el bloque que sumaba `abonos` a `ingresos_servicios`.
- Añadir al jsonb `detalle` y a las KPIs un campo `anticipos_recibidos` = `sum(abonos.monto)` del rango (vista de efectivo, NO entra en `ingresos_total`).
- `por_metodo_pago`: las ventas-OT aportan a "servicios"; los anticipos van a su propia fila informativa.

**Criterios de aceptación:**

- Una OT entregada en el rango aparece en `ingresos_servicios` exactamente una vez (= su total), y **no** vuelve a contarse por sus abonos.
- `ingresos_total = ingresos_productos + ingresos_servicios` (sin anticipos).
- `anticipos_recibidos` refleja los abonos del rango como dato de caja.

**Commit:** `fix(cierre): ingresos de OT desde ventas-OT + anticipos sin doble conteo`

---

## FASE 6 — Frontend: flujo guiado (stepper)

**Objetivo:** reemplazar los botones sueltos por el asistente de 7 pasos con gating; cada rol ve su paso; mensajes de "qué falta".

**Archivos:**

- Crear `src/components/ot/OrdenStepper.jsx` — barra horizontal (desktop) / acordeón (móvil) con los 7 pasos, estado visual (verde/azul/gris) y botón "Siguiente" deshabilitado hasta cumplir el requisito.
- Crear `src/components/ot/pasos/PasoRecepcion.jsx`, `PasoDiagnostico.jsx`, `PasoCotizacion.jsx`, `PasoAutorizacion.jsx`, `PasoDescargaTrabajo.jsx`, `PasoTerminado.jsx`, `PasoRecogida.jsx`.
- Modificar `src/pages/ops/OrdenDetalle.jsx` — orquesta el stepper, carga la OT y deriva el paso actual desde `estado`.
- Modificar `src/lib/ordenes-ui.js` — `PASOS_OT` (orden, label, icono, rol sugerido), `requisitoFalta(orden, abonos, detalles)` que devuelve el texto del gate o `null`.

**Detalles de gating (frontend, refleja los gates de BD de Fase 3):**

- Paso 1→2: `equipo_descripcion` y checklist tocado.
- Paso 2→3: `diagnostico` no vacío.
- Paso 3→4: ≥1 repuesto o `costo_mano_obra>0`.
- Paso 4→5: abono registrado (anticipo).
- Paso 5→6: al menos un repuesto descargado **o** confirmación de "sin repuestos".
- Paso 6→7: `trabajo_realizado` no vacío.
- Paso 7: botón **"Convertir a venta / Entregar"** → `supabase.rpc('fn_generar_venta_ot',{p_orden_id})` con confirmación.

**Criterios de aceptación (UI, usuario con login):**

- No se puede avanzar sin cumplir el requisito; el aviso dice exactamente qué falta.
- Un Vendedor puede ejecutar todos los pasos en una OT de su sede.

**Commit:** `feat(ot): flujo guiado con stepper y pasos obligatorios (REQ4)`

---

## FASE 7 — Frontend: anticipos, conversión a venta, impresión

**Objetivo:** renombrar abonos→anticipos en la UI, mostrar saldo en vivo, y separar las dos impresiones.

**Archivos:**

- Modificar el panel de abonos (dentro de `OrdenDetalle.jsx`/`PasoAutorizacion.jsx` y `PasoRecogida.jsx`): título **"Anticipos"**, total anticipado, **saldo** = `total - anticipos`, y badge "Saldo cubierto" cuando llega a 0.
- Modificar `src/lib/pdf/ordenPDF.js`: parámetro `modo` = `'recepcion'` (constancia, sin económicos) o `'final'` (factura con total + anticipos + saldo). Reusar la sección de abonos ya existente (líneas 282-320) para el modo final.
- En `PasoRecepcion.jsx`: botón "Imprimir constancia" → `modo:'recepcion'`. En `PasoRecogida.jsx`: "Imprimir factura" → `modo:'final'`.

**Criterios de aceptación:**

- La constancia de recepción no muestra plata; la factura final muestra total, anticipos y saldo.
- El saldo en pantalla cuadra con `total - sum(anticipos)`.

**Commit:** `feat(ot): anticipos con saldo en vivo + constancia vs factura`

---

## FASE 8 — Backfill de datos + limpieza del "servicio abono"

**Objetivo:** alinear datos existentes al nuevo modelo y detectar/limpiar el mal uso (ventas creadas como "servicio abono").

**Archivo:** crear `supabase/migrations/2026MMDD0007_otA_backfill_y_limpieza.sql` (solo lo seguro; la limpieza de ventas mal hechas se hace tras revisión del usuario).

**Cambios automáticos seguros:**

```sql
-- Backfill precio_unitario en detalle_orden desde el catálogo (si quedó en 0)
update detalle_orden d
   set precio_unitario = coalesce(p.precio_venta, d.costo_unitario, 0),
       subtotal = coalesce(p.precio_venta, d.costo_unitario, 0) * d.cantidad
  from productos p
 where p.id = d.producto_id and (d.precio_unitario is null or d.precio_unitario = 0);

-- Recalcular valor_repuestos/total de OT no entregadas
update ordenes_servicio o set
  valor_repuestos = (select coalesce(sum(subtotal),0) from detalle_orden where orden_id=o.id),
  total = o.costo_mano_obra + (select coalesce(sum(subtotal),0) from detalle_orden where orden_id=o.id) + coalesce(o.valor_revision,0)
 where o.estado not in ('entregada','cancelada');
```

**Detección (read-only, para decidir con el usuario):**

```sql
-- Ventas sospechosas de "servicio abono" (servicio cuyo nombre contiene 'abono')
select v.numero, v.fecha, v.total, dv.descripcion
from detalle_venta dv join ventas v on v.id = dv.venta_id
left join servicios s on s.id = dv.servicio_id
where lower(coalesce(dv.descripcion,'') || ' ' || coalesce(s.nombre,'')) like '%abono%'
order by v.fecha desc;
```

> La anulación/corrección de esas ventas se hará en un paso aparte, **solo tras aprobación del usuario**, usando `fn_anular_venta`.

**Criterios de aceptación:**

- OT no entregadas quedan con `total` a precio de venta.
- Lista de ventas "abono" presentada al usuario para decisión.

**Commit:** `chore(ot): backfill precios + detección de ventas mal registradas`

---

## FASE 9 — QA integral end-to-end

**Objetivo:** validar el ciclo completo con productos `INVENTARIO DE PRUEBA` (999), corrido por el usuario.

**Pasos de prueba (camino feliz, login real):**

1. Recepción (Vendedor) → imprime constancia (sin plata).
2. Diagnóstico → Cotización (repuestos a precio).
3. Autorización con anticipo 50%.
4. Descargar 2 repuestos (verifica que baja `cantidad_insumo`).
5. Terminar.
6. Recogida → "Convertir a venta": pagar saldo, generar venta.
7. Verificaciones SQL (read-only):
   - 1 venta `origen='ot'` con total correcto; `ordenes_servicio.venta_id` y `estado='entregada'`.
   - **Sin** movimiento `tipo='venta'` para esos productos (no doble descuento).
   - Cierre del día: la OT aparece en `ingresos_servicios` una sola vez; anticipos en su línea.
8. Casos borde: cancelar OT con anticipo (Admin) → política definida; intentar entregar con saldo pendiente → bloqueado.

**Smoke E2E:** añadir `tests/e2e/_otA_flujo_guiado.spec.js` (lo corre el usuario).

**Commit:** `test(ot): smoke E2E flujo guiado opción A`

---

## Adiciones de integralidad (rev. 2026-06-21)

Estos puntos amplían las fases existentes para cerrar huecos detectados.

### 4b — IVA/descuento seleccionable + anulación/cancelación (extiende Fase 4)

**IVA/descuento (coherente con Ventas):** la línea `iva_pct` de la cabecera de `fn_generar_venta_ot` deja de ser `0` y copia los valores de la OT. La fórmula del total de la OT (en Fase 2 y en los triggers de recálculo) pasa a:

```sql
-- base + IVA - descuento (igual que ventas: total = (base - desc) * (1 + iva/100))
total = ( (costo_mano_obra + valor_repuestos + coalesce(valor_revision,0)) - coalesce(descuento_valor,0) )
        * (1 + coalesce(iva_pct,0)/100);
```

Y la cabecera de la venta-OT:

```sql
insert into ventas (..., subtotal, descuento_valor, iva_pct, total, origen, orden_id)
values (..., v_o.valor_repuestos + v_o.costo_mano_obra + coalesce(v_o.valor_revision,0),
        v_o.descuento_valor, v_o.iva_pct, v_o.total, 'ot', p_orden_id);
```

**Anular venta-OT** (modificar `fn_anular_venta`): si `ventas.origen='ot'`, además de marcar anulada (sin tocar stock, porque nunca lo movió) revertir la OT:

```sql
-- dentro de fn_anular_venta, si origen='ot':
update abonos set venta_id = null where venta_id = p_venta_id;
update ordenes_servicio set venta_id = null, estado = 'terminada', fecha_entrega = null
 where venta_id = p_venta_id;
```

**Cancelar OT con anticipos** (modificar `fn_cancelar_orden`, solo Admin): permitir cancelar con anticipos, exigiendo registrar la devolución del anticipo como salida de caja (movimiento/registro de devolución) antes de pasar a `cancelada`. Documentar el método de devolución en `observaciones`.

**Criterios:** venta-OT respeta IVA elegido (0 o 19); anular una venta-OT devuelve la OT a `terminada` con sus anticipos libres; cancelar OT con anticipo deja traza de la devolución.

### 5b — Analítica sin doble conteo (extiende Fase 5)

Modificar `fn_top_productos`, `fn_recalcular_abc` y `fn_alertas_rotacion` para **filtrar `ventas.origen='directa'`** en su lectura de `detalle_venta` (las líneas de producto de la venta-OT no deben contar como ventas directas en ABC/rotación).

**Criterio:** una venta-OT no altera el ABC ni el top de productos.

### 8b — Migración de OT abiertas al nuevo flujo (extiende Fase 8)

Mapear el estado legacy de las OT **no entregadas/no canceladas** al nuevo flujo (las entregadas NO se tocan):

```sql
update ordenes_servicio set estado = case estado
    when 'abierta'             then 'recepcion'
    when 'completada'          then 'terminada'
    when 'pendiente_recogida'  then 'terminada'
    else estado end::estado_orden
 where estado in ('abierta','completada','pendiente_recogida');
-- 'en_proceso' y 'esperando_repuesto' se conservan (existen en ambos flujos)
```

> Si alguna OT vieja no encaja limpio, se deja en su estado legacy (el stepper del front debe tolerar estados legacy mostrando el paso más cercano, sin romperse).

**Criterio:** las OT abiertas aparecen en un paso válido del stepper; ninguna OT entregada cambió.

---

## Resumen de fases

| Fase | Capa     | Entregable                               |
| ---- | -------- | ---------------------------------------- |
| 0    | DB       | Esquema (enum, precios, vínculos)        |
| 1    | DB/RLS   | Permisos toderos + arreglo FALLA 2       |
| 2    | DB       | Repuestos a precio de venta              |
| 3    | DB       | Máquina de estados con gates             |
| 4    | DB       | Venta en recogida + blindaje stock       |
| 5    | DB       | Cierre/KPIs sin doble conteo + anticipos |
| 6    | Front    | Stepper guiado                           |
| 7    | Front    | Anticipos/saldo + impresiones            |
| 8    | DB/datos | Backfill + limpieza "servicio abono"     |
| 9    | QA       | Validación end-to-end                    |

**Orden recomendado:** 0→1→2→3→4→5 (todo backend, probable en 1-2 sesiones) y luego 6→7 (frontend), 8 (datos) y 9 (QA). Cada fase se presenta y se aprueba antes de aplicar.
