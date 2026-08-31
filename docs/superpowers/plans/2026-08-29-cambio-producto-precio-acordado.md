# Cambio de producto con precio acordado — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el precio del producto que el cliente se lleva en un cambio sea el precio acordado y no el de lista, sin crear ni alterar un solo registro de dinero.

**Architecture:** El arreglo cambia un único número dentro de `fn_registrar_cambio` (`v_valor_nuevo`) y agrega una columna de enlace (`ventas.cambio_de_venta_id`) que solo usa el cálculo del crédito. La mecánica de plata —permuta neteada como `descuento_valor`, `total` clampado a cero o más, reembolso como único egreso de caja menor— queda intacta, así que la fórmula del cierre no se toca y no puede haber doble conteo.

**Tech Stack:** PostgreSQL (Supabase, RPC `SECURITY DEFINER`), React 19 + Vite, Zustand, vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-cambio-producto-precio-acordado-design.md`

---

## Estructura de archivos

| Archivo                                                     | Responsabilidad                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/lib/ventas-ui.js` (modificar)                          | Aloja `precioSugeridoCambio()`, la fórmula pura del precio sugerido. Es el único lugar donde vive esa regla.       |
| `tests/integration/cambio-precio-sugerido.test.js` (crear)  | Prueba la fórmula en aislamiento, sin base de datos.                                                               |
| Migración `cambio_de_venta_id`                              | Columna de enlace + índice + backfill de los cambios ya registrados.                                               |
| Migración `fn_registrar_cambio`                             | Nueva firma con `p_precio_nuevo`, ratio = 1 para ventas de cambio, precio en la línea, enlace a la venta original. |
| `src/pages/ops/VentaDetalle.jsx` (modificar)                | Trae el precio de lista actual de cada producto de la venta y deja de parsear la observación con regex.            |
| `src/components/ventas/ModalCambioProducto.jsx` (modificar) | Campo de precio acordado, precargado con el sugerido, y envío del nuevo parámetro.                                 |

---

## Advertencias que aplican a todo el plan

**No usar `origen = 'cambio'`.** El cierre filtra `origen = 'directa'`; marcar la venta de otro modo la sacaría del ingreso del día y el cierre quedaría corto.

**No convertir la permuta en un pago ni moverla a una columna que cambie el `total`.** El cierre suma `ventas.total`; ese número es sagrado.

**Las pruebas contra producción van dentro de un bloque `DO` que termina en `raise exception`,** para que todo se revierta. Se simula el JWT del usuario y se hace `set local role authenticated` para que la RLS esté activa; probar como superusuario no prueba nada.

---

## Task 1: La fórmula del precio sugerido

**Files:**

- Modify: `src/lib/ventas-ui.js`
- Test: `tests/integration/cambio-precio-sugerido.test.js`

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/integration/cambio-precio-sugerido.test.js`:

```js
import { describe, it, expect } from "vitest";
import { precioSugeridoCambio } from "../../src/lib/ventas-ui";

describe("precioSugeridoCambio", () => {
  it("misma lista: sugiere lo que el cliente pagó (cambio par)", () => {
    // El caso real: pagó 60.000 de una lista de 65.000 y cambia por otro de 65.000.
    expect(
      precioSugeridoCambio({
        precioPagadoUnitario: 60000,
        listaDevuelto: 65000,
        listaNuevo: 65000,
      }),
    ).toBe(60000);
  });

  it("el nuevo es más caro: conserva el mismo descuento en pesos", () => {
    expect(
      precioSugeridoCambio({
        precioPagadoUnitario: 60000,
        listaDevuelto: 65000,
        listaNuevo: 100000,
      }),
    ).toBe(95000);
  });

  it("subió la lista de las dos referencias: sigue siendo par", () => {
    expect(
      precioSugeridoCambio({
        precioPagadoUnitario: 65000,
        listaDevuelto: 70000,
        listaNuevo: 70000,
      }),
    ).toBe(65000);
  });

  it("sin descuento de por medio: cae en el precio de lista del nuevo", () => {
    expect(
      precioSugeridoCambio({
        precioPagadoUnitario: 65000,
        listaDevuelto: 65000,
        listaNuevo: 100000,
      }),
    ).toBe(100000);
  });

  it("sin lista del devuelto: cae en el precio de lista del nuevo", () => {
    expect(
      precioSugeridoCambio({
        precioPagadoUnitario: 60000,
        listaDevuelto: 0,
        listaNuevo: 100000,
      }),
    ).toBe(100000);
  });

  it("nunca sugiere un precio negativo", () => {
    expect(
      precioSugeridoCambio({
        precioPagadoUnitario: 10000,
        listaDevuelto: 65000,
        listaNuevo: 20000,
      }),
    ).toBe(0);
  });

  it("redondea a pesos", () => {
    expect(
      precioSugeridoCambio({
        precioPagadoUnitario: 59999.6,
        listaDevuelto: 65000,
        listaNuevo: 65000,
      }),
    ).toBe(60000);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/integration/cambio-precio-sugerido.test.js`
Expected: FAIL — `precioSugeridoCambio is not a function` o error de importación.

- [ ] **Step 3: Implementar la función**

Agregar al final de `src/lib/ventas-ui.js`:

```js
/**
 * Precio sugerido para el producto que el cliente se lleva en un CAMBIO.
 *
 * Conserva el trato relativo que se le hizo: parte de lo que realmente pagó y
 * le suma la diferencia de precio de lista entre los dos productos. Si las dos
 * referencias valen lo mismo, el resultado es lo que pagó — o sea, cambio par,
 * que es el caso que rompía antes (se le cobraba de vuelta el descuento).
 *
 * Usa a propósito los precios de lista de HOY y no `detalle_venta.precio_catalogo`:
 * esa columna está vacía en las ventas anteriores a que se empezara a guardar
 * (542 de 3.811 líneas), y una fórmula que dependa de ella fallaría justo en las
 * ventas viejas.
 *
 * @param {{precioPagadoUnitario:number, listaDevuelto:number, listaNuevo:number}} args
 * @returns {number} precio unitario sugerido, en pesos enteros, nunca negativo
 */
export function precioSugeridoCambio({
  precioPagadoUnitario,
  listaDevuelto,
  listaNuevo,
}) {
  const pagado = Number(precioPagadoUnitario) || 0;
  const lDev = Number(listaDevuelto) || 0;
  const lNue = Number(listaNuevo) || 0;
  // Sin lista del devuelto no hay con qué comparar: se cae al precio de lista
  // del nuevo, que es el comportamiento de siempre.
  if (lDev <= 0) return Math.round(lNue);
  return Math.max(0, Math.round(pagado + (lNue - lDev)));
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/integration/cambio-precio-sugerido.test.js`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ventas-ui.js tests/integration/cambio-precio-sugerido.test.js
git commit -m "feat(ventas): formula del precio sugerido para un cambio de producto"
```

---

## Task 2: Columna de enlace `ventas.cambio_de_venta_id`

**Files:**

- Migración Supabase: `cambio_de_venta_id`

- [ ] **Step 1: Fotografiar el estado actual**

Correr en Supabase y guardar el resultado para comparar después:

```sql
select count(*) as cambios_por_observacion
  from ventas where observaciones ~ '^Cambio por venta #[0-9]+';
```

Expected: 9 filas (a la fecha del plan; si difiere, anotar el número real).

- [ ] **Step 2: Aplicar la migración**

`apply_migration` con nombre `ventas_cambio_de_venta_id`:

```sql
-- Enlace explícito de una venta de CAMBIO con la venta original.
--
-- Sirve para dos cosas. La primera es el cálculo del crédito: en una venta de
-- cambio, `descuento_valor` guarda la PERMUTA (lo que valía el producto que el
-- cliente entregó), no un descuento comercial. Aplicarle el ratio de descuento
-- al devolver ese producto subvaloraba el crédito — en la venta #1677 daba
-- $5.000 en vez de $30.000, y revertir un cambio terminaba cobrándole al
-- cliente. La segunda es reemplazar el parseo por regex de la observación con
-- el que hoy VentaDetalle averigua de qué venta viene un cambio.
--
-- NO participa en ningún cálculo de dinero: no toca `total`, `subtotal` ni
-- `descuento_valor`, y el cierre no la mira.
alter table ventas
  add column if not exists cambio_de_venta_id uuid references ventas(id);

comment on column ventas.cambio_de_venta_id is
  'Venta original de la que proviene este cambio. Cuando no es nula, descuento_valor es una permuta, no un descuento comercial.';

create index if not exists idx_ventas_cambio_de_venta
  on ventas(cambio_de_venta_id) where cambio_de_venta_id is not null;

-- Backfill de los cambios ya registrados, por el número que quedó en la
-- observación. `ventas.numero` es identity, así que es único en toda la tabla.
-- Lo que no matchee se queda en nulo y se comporta como hasta hoy.
update ventas v
   set cambio_de_venta_id = o.id
  from ventas o
 where v.observaciones ~ '^Cambio por venta #[0-9]+'
   and v.cambio_de_venta_id is null
   and o.numero = (regexp_match(v.observaciones, '^Cambio por venta #([0-9]+)'))[1]::int;
```

- [ ] **Step 3: Verificar el backfill y que no se movió un peso**

```sql
select
  (select count(*) from ventas where observaciones ~ '^Cambio por venta #[0-9]+') as cambios,
  (select count(*) from ventas where cambio_de_venta_id is not null) as enlazadas,
  (select count(*) from ventas where observaciones ~ '^Cambio por venta #[0-9]+'
     and cambio_de_venta_id is null) as sin_enlazar,
  (select count(*) from ventas where total < 0) as totales_negativos,
  (select coalesce(sum(total),0) from ventas where anulada=false and origen='directa'
     and metodo_pago <> 'Crédito') as ingreso_acumulado;
```

Expected: `cambios` = `enlazadas`, `sin_enlazar` = 0, `totales_negativos` = 0.
`ingreso_acumulado` debe quedar anotado: **no puede cambiar en ninguna tarea posterior de este plan salvo por ventas nuevas de prueba, y todas las pruebas se revierten.**

Si `sin_enlazar` > 0, listar esas ventas y reportarlas sin adivinar el enlace:

```sql
select numero, fecha::date, observaciones from ventas
 where observaciones ~ '^Cambio por venta #[0-9]+' and cambio_de_venta_id is null;
```

---

## Task 3: Nueva `fn_registrar_cambio`

**Files:**

- Migración Supabase: `fn_registrar_cambio_precio_acordado`

- [ ] **Step 1: Guardar la ACL actual para restaurarla**

```sql
select array_to_string(proacl,' | ') as acl from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='fn_registrar_cambio';
```

Expected: `postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres`
(sin `anon` — así debe quedar al final).

- [ ] **Step 2: Aplicar la migración**

`apply_migration` con nombre `fn_registrar_cambio_precio_acordado`:

```sql
-- El DROP es obligatorio: agregar un parámetro con DEFAULT crea una función
-- NUEVA y deja viva la de 9 argumentos. PostgREST vería dos candidatas y
-- fallaría con "Could not choose the best candidate function".
DROP FUNCTION IF EXISTS public.fn_registrar_cambio(
  uuid, uuid, integer, uuid, integer, text, text, text, text);

CREATE OR REPLACE FUNCTION public.fn_registrar_cambio(
  p_venta_original_id uuid,
  p_producto_devuelto_id uuid,
  p_cant_dev integer,
  p_producto_nuevo_id uuid,
  p_cant_nuevo integer,
  p_sede_id text,
  p_metodo text DEFAULT 'Efectivo'::text,
  p_cuenta_bancaria text DEFAULT NULL::text,
  p_motivo text DEFAULT NULL::text,
  p_precio_nuevo numeric DEFAULT NULL::numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_rol text; v_sede text;
  v_venta record;
  v_sub_dev numeric;
  v_vendido integer;
  v_sub_total numeric;
  v_desc_v numeric;
  v_ratio numeric;
  v_precio_lista numeric;
  v_precio_nuevo numeric;
  v_valor_dev numeric;
  v_valor_nuevo numeric;
  v_diferencia numeric;
  v_iva_factor numeric;
  v_obs text;
  v_dev jsonb; v_venta_nueva jsonb; v_egreso jsonb := null;
  v_venta_nueva_id uuid;
  v_reembolso numeric;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;

  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;
  if v_rol is null or v_rol not in ('Admin','Vendedor') then
    raise exception 'Solo Ventas (Vendedor) o Administración pueden registrar cambios';
  end if;
  if v_rol <> 'Admin' and v_sede is distinct from p_sede_id then
    raise exception 'Solo puedes registrar cambios en tu propia sede';
  end if;

  if p_cant_dev <= 0 or p_cant_nuevo <= 0 then
    raise exception 'Las cantidades deben ser mayores a 0';
  end if;
  if p_producto_devuelto_id = p_producto_nuevo_id then
    raise exception 'El producto nuevo debe ser distinto al devuelto';
  end if;
  if lower(coalesce(p_metodo,'')) not in ('efectivo','transferencia') then
    raise exception 'Método no soportado para cambios (usa Efectivo o Transferencia)';
  end if;
  -- Se valida ANTES de mover stock o plata.
  if p_precio_nuevo is not null and p_precio_nuevo < 0 then
    raise exception 'El precio acordado no puede ser negativo';
  end if;

  select * into v_venta from ventas where id = p_venta_original_id;
  if not found then raise exception 'Venta original no encontrada'; end if;
  if v_venta.anulada then raise exception 'No se puede cambiar sobre una venta anulada'; end if;

  select coalesce(sum(subtotal),0), coalesce(sum(cantidad),0)
    into v_sub_dev, v_vendido
  from detalle_venta
  where venta_id = p_venta_original_id and producto_id = p_producto_devuelto_id;
  if v_vendido = 0 then
    raise exception 'El producto a devolver no estaba en la venta original';
  end if;

  -- Crédito por lo que devuelve.
  --
  -- En una venta de CAMBIO, `descuento_valor` guarda la permuta (lo que valía
  -- el producto que el cliente entregó), no un descuento comercial. Aplicarle
  -- el ratio subvaloraba el crédito: revertir un cambio terminaba cobrándole al
  -- cliente. Ahí el crédito correcto es el subtotal de la línea, tal cual.
  if v_venta.cambio_de_venta_id is not null then
    v_ratio := 1;
  else
    v_sub_total := coalesce(v_venta.subtotal, 0);
    v_desc_v := coalesce(v_venta.descuento_valor, v_sub_total * coalesce(v_venta.descuento_pct, 0) / 100.0);
    v_desc_v := greatest(0, least(v_desc_v, v_sub_total));
    v_ratio := case when v_sub_total > 0 then (v_sub_total - v_desc_v) / v_sub_total else 1 end;
  end if;

  v_valor_dev := round((v_sub_dev / v_vendido) * p_cant_dev * v_ratio);

  select precio_venta into v_precio_lista from productos where id = p_producto_nuevo_id and activo = true;
  if v_precio_lista is null then raise exception 'Producto nuevo no encontrado o inactivo'; end if;

  -- ESTE es el arreglo: antes siempre se usaba el precio de lista, así que el
  -- descuento dado en la venta original se le cobraba de vuelta al cliente y
  -- entraba a la caja del día una plata que nadie había entregado.
  -- Sin precio acordado se cae en la lista, o sea el comportamiento de siempre.
  v_precio_nuevo := coalesce(p_precio_nuevo, v_precio_lista);
  v_valor_nuevo := round(v_precio_nuevo * p_cant_nuevo);

  v_diferencia := v_valor_nuevo - v_valor_dev;
  v_iva_factor := 1 + coalesce(v_venta.iva_pct, 0) / 100.0;

  -- Señal para que fn_registrar_devolucion permita esta devolución compuesta:
  -- el rol y la sede ya se validaron arriba. Se apaga justo después.
  perform set_config('cdv.cambio_interno', '1', true);
  v_dev := fn_registrar_devolucion(
    'cliente', p_producto_devuelto_id, p_sede_id, p_cant_dev,
    coalesce(nullif(btrim(p_motivo), ''), 'Cambio de producto'),
    p_venta_original_id
  );
  perform set_config('cdv.cambio_interno', '', true);

  -- El prefijo "Cambio por venta #" lo detecta VentaDetalle para bloquear la
  -- anulación por separado: no se puede cambiar.
  v_obs := format('Cambio por venta #%s: entrega %s u. del nuevo, devuelve %s u. del original',
                  v_venta.numero, p_cant_nuevo, p_cant_dev);
  if v_precio_nuevo is distinct from v_precio_lista then
    v_obs := v_obs || format(' · precio acordado %s (lista %s)',
                             round(v_precio_nuevo), round(v_precio_lista));
  end if;

  v_venta_nueva := fn_registrar_venta(
    p_sede_id,
    v_venta.cliente_nombre,
    v_venta.cliente_nit,
    p_metodo,
    0,
    v_obs,
    jsonb_build_array(jsonb_build_object(
      'producto_id', p_producto_nuevo_id,
      'cantidad', p_cant_nuevo,
      'precio_unitario', v_precio_nuevo)),
    coalesce(v_venta.iva_pct, 0),
    p_cuenta_bancaria,
    v_valor_dev,
    0
  );
  v_venta_nueva_id := (v_venta_nueva->>'venta_id')::uuid;

  -- Enlace explícito. El trigger trg_ventas_proteger_anulacion solo se opone a
  -- que cambie `anulada`, así que este UPDATE pasa sin señales de sesión.
  update ventas set cambio_de_venta_id = p_venta_original_id
   where id = v_venta_nueva_id;

  if v_diferencia < 0 then
    v_reembolso := round((v_valor_dev - v_valor_nuevo) * v_iva_factor);
    if v_reembolso > 0 then
      perform set_config('cdv.caja_menor_metodo', coalesce(p_metodo, ''), true);
      perform set_config('cdv.caja_menor_cuenta', coalesce(nullif(btrim(coalesce(p_cuenta_bancaria, '')), ''), ''), true);
      v_egreso := fn_registrar_caja_menor(
        p_sede_id,
        format('Devolución por cambio - venta #%s', v_venta.numero),
        v_reembolso,
        coalesce(nullif(v_venta.cliente_nombre, ''), 'Cliente'),
        format('Diferencia a favor del cliente en cambio de producto (venta #%s)', v_venta.numero)
      );
      perform set_config('cdv.caja_menor_metodo', '', true);
      perform set_config('cdv.caja_menor_cuenta', '', true);
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'venta_original_numero', v_venta.numero,
    'venta_nueva_id', v_venta_nueva_id,
    'venta_nueva_numero', (v_venta_nueva->>'numero'),
    'devolucion', v_dev,
    'valor_devuelto', v_valor_dev,
    'valor_nuevo', v_valor_nuevo,
    'precio_nuevo_aplicado', v_precio_nuevo,
    'precio_lista_nuevo', v_precio_lista,
    'diferencia_sin_iva', v_diferencia,
    'diferencia_con_iva', round(v_diferencia * v_iva_factor),
    'accion', case when v_diferencia > 0 then 'cobro'
                   when v_diferencia < 0 then 'devolucion'
                   else 'par' end,
    'reembolso', coalesce(v_reembolso, 0),
    'egreso', v_egreso
  );
end;
$function$;

-- El DROP se llevó los permisos. Supabase concede EXECUTE a `anon` por defecto
-- a toda función nueva de public, y REVOKE ... FROM PUBLIC no lo quita porque
-- el de anon es un grant explícito. Regla del proyecto: la anon key nunca
-- escribe.
REVOKE ALL ON FUNCTION public.fn_registrar_cambio(uuid,uuid,integer,uuid,integer,text,text,text,text,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_registrar_cambio(uuid,uuid,integer,uuid,integer,text,text,text,text,numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_registrar_cambio(uuid,uuid,integer,uuid,integer,text,text,text,text,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_registrar_cambio(uuid,uuid,integer,uuid,integer,text,text,text,text,numeric) TO service_role;
```

- [ ] **Step 3: Verificar que quedó una sola firma y con la ACL correcta**

```sql
select p.oid::regprocedure as firma, array_to_string(p.proacl,' | ') as acl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='fn_registrar_cambio';
```

Expected: **una sola fila**, terminada en `numeric)`, con ACL
`postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres`.
Si aparecen dos filas, la firma vieja no se borró: borrarla antes de seguir.
Si aparece `anon=X`, revocarlo.

- [ ] **Step 4: Refrescar la caché de esquema de PostgREST**

```sql
notify pgrst, 'reload schema';
```

Sin esto la app recibe 404 al llamar la función con el parámetro nuevo.

---

## Task 4: Verificar los escenarios contra producción

**Files:** ninguno. Todo se ejecuta en Supabase dentro de transacciones que se revierten.

Cada bloque simula el JWT de una vendedora real y hace `set local role authenticated`
para que la RLS esté activa. Terminan en `raise exception` para revertir.

- [ ] **Step 1: Anotar el ingreso del día antes de probar**

```sql
select coalesce(sum(total),0) as ingreso_hoy
from ventas
where anulada=false and origen='directa' and metodo_pago <> 'Crédito'
  and (fecha at time zone 'America/Bogota')::date = (now() at time zone 'America/Bogota')::date;
```

Anotar el número. Al terminar la tarea debe ser idéntico.

- [ ] **Step 2: Escenario "cambio par" — el caso de Maritza**

Usa la venta #1834 (hoy, AUTOMATICO 4 VIA PALANCA a $60.000 con lista $65.000)
y cambia por otro automático de lista $65.000.

```sql
do $$
declare
  v_uid uuid; v_venta record; v_dev uuid; v_nue uuid;
  v_ing_ini numeric; v_ing_fin numeric; v_egresos int;
  v_res jsonb; v_nueva record; v_log text := '';
begin
  select id, sede_id, vendedor_id into v_venta from ventas where numero = 1834;
  v_uid := v_venta.vendedor_id;
  select producto_id into v_dev from detalle_venta where venta_id = v_venta.id limit 1;
  -- otro automático activo de la MISMA lista, con stock en la sede
  select p.id into v_nue from productos p
    join inventario i on i.producto_id = p.id and i.sede_id = v_venta.sede_id
   where p.activo and p.id <> v_dev and p.precio_venta = 65000 and i.cantidad > 0
   limit 1;
  if v_nue is null then raise exception 'No hay producto de la misma lista con stock para probar'; end if;

  select coalesce(sum(total),0) into v_ing_ini from ventas
   where anulada=false and origen='directa' and metodo_pago <> 'Crédito'
     and (fecha at time zone 'America/Bogota')::date = (now() at time zone 'America/Bogota')::date;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';

  v_res := fn_registrar_cambio(v_venta.id, v_dev, 1, v_nue, 1, v_venta.sede_id,
                               'Efectivo', null, 'Prueba cambio par', 60000);

  select numero, subtotal, descuento_valor, total, cambio_de_venta_id
    into v_nueva from ventas where id = (v_res->>'venta_nueva_id')::uuid;

  execute 'reset role';
  select coalesce(sum(total),0) into v_ing_fin from ventas
   where anulada=false and origen='directa' and metodo_pago <> 'Crédito'
     and (fecha at time zone 'America/Bogota')::date = (now() at time zone 'America/Bogota')::date;
  select count(*) into v_egresos from caja_menor
   where observaciones ilike '%cambio de producto (venta #' || v_venta.numero || ')%';

  v_log := format('accion=%s diferencia=%s | venta nueva subtotal=%s desc=%s total=%s enlace=%s | ingreso %s -> %s (delta %s) | egresos=%s',
    v_res->>'accion', v_res->>'diferencia_con_iva',
    v_nueva.subtotal, v_nueva.descuento_valor, v_nueva.total,
    (v_nueva.cambio_de_venta_id is not null),
    v_ing_ini, v_ing_fin, v_ing_fin - v_ing_ini, v_egresos);
  raise exception 'PAR %', v_log;
end $$;
```

Expected: `accion=par`, `diferencia=0`, venta nueva con `subtotal=60000 desc=60000 total=0`,
`enlace=t`, **delta de ingreso = 0**, `egresos=0`.

- [ ] **Step 3: Escenario "el nuevo es más caro"**

Mismo bloque del Step 2, cambiando la llamada por:

```sql
  v_res := fn_registrar_cambio(v_venta.id, v_dev, 1, v_nue, 1, v_venta.sede_id,
                               'Efectivo', null, 'Prueba cobro', 95000);
```

y el mensaje final por `raise exception 'COBRO %', v_log;`

Expected: `accion=cobro`, `diferencia=35000`, venta nueva `subtotal=95000 desc=60000 total=35000`,
**delta de ingreso = 35000**, `egresos=0`.

- [ ] **Step 4: Escenario "el nuevo es más barato"**

Mismo bloque, con:

```sql
  v_res := fn_registrar_cambio(v_venta.id, v_dev, 1, v_nue, 1, v_venta.sede_id,
                               'Efectivo', null, 'Prueba devolucion', 40000);
```

y `raise exception 'DEVOLUCION %', v_log;`

Expected: `accion=devolucion`, `diferencia=-20000`, venta nueva `total=0`,
**delta de ingreso = 0**, `egresos=1` (uno solo, nunca dos).

- [ ] **Step 5: Escenario "sin precio acordado se comporta como antes"**

```sql
  v_res := fn_registrar_cambio(v_venta.id, v_dev, 1, v_nue, 1, v_venta.sede_id,
                               'Efectivo', null, 'Prueba sin precio');
```

Expected: `precio_nuevo_aplicado` = `precio_lista_nuevo` = 65000, `accion=cobro`,
`diferencia=5000`. Es el comportamiento viejo, confirmando que nada se rompe
para quien no toque el campo.

- [ ] **Step 6: Escenario "precio negativo"**

```sql
  v_res := fn_registrar_cambio(v_venta.id, v_dev, 1, v_nue, 1, v_venta.sede_id,
                               'Efectivo', null, 'Prueba invalida', -1);
```

Expected: excepción `El precio acordado no puede ser negativo`,
**y ninguna devolución registrada** (verificar que `devoluciones` no creció).

- [ ] **Step 7: Escenario "revertir un cambio"**

Prueba el arreglo del ratio sobre una venta de cambio ya existente (#1677:
subtotal 30.000, descuento 25.000, total 5.000).

```sql
do $$
declare
  v_venta record; v_dev uuid; v_nue uuid; v_res jsonb; v_log text;
begin
  select id, sede_id, vendedor_id, cambio_de_venta_id into v_venta from ventas where numero = 1677;
  if v_venta.cambio_de_venta_id is null then raise exception 'El backfill de Task 2 no enlazó la #1677'; end if;
  select producto_id into v_dev from detalle_venta where venta_id = v_venta.id limit 1;
  select p.id into v_nue from productos p
    join inventario i on i.producto_id=p.id and i.sede_id=v_venta.sede_id
   where p.activo and p.id <> v_dev and i.cantidad > 0 limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_venta.vendedor_id, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := fn_registrar_cambio(v_venta.id, v_dev, 1, v_nue, 1, v_venta.sede_id,
                               'Efectivo', null, 'Prueba reversa', null);
  v_log := format('valor_devuelto=%s (debe ser 30000, no 5000)', v_res->>'valor_devuelto');
  raise exception 'REVERSA %', v_log;
end $$;
```

Expected: `valor_devuelto=30000`. Antes del arreglo daba 5000.

- [ ] **Step 8: Escenario "cambio parcial de una línea con varias unidades"**

Busca una venta con una línea de 2 o más unidades y devuelve solo una.

```sql
do $$
declare
  v_venta record; v_dev uuid; v_nue uuid; v_res jsonb; v_precio numeric;
begin
  select v.id, v.sede_id, v.vendedor_id, d.producto_id, d.subtotal / d.cantidad as unit
    into v_venta
    from ventas v join detalle_venta d on d.venta_id = v.id
   where v.anulada = false and d.cantidad >= 2 and d.producto_id is not null
   order by v.fecha desc limit 1;
  if v_venta.id is null then raise exception 'No hay venta con línea de 2+ unidades para probar'; end if;
  v_dev := v_venta.producto_id;
  v_precio := v_venta.unit;
  select p.id into v_nue from productos p
    join inventario i on i.producto_id = p.id and i.sede_id = v_venta.sede_id
   where p.activo and p.id <> v_dev and i.cantidad > 0 limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_venta.vendedor_id, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := fn_registrar_cambio(v_venta.id, v_dev, 1, v_nue, 1, v_venta.sede_id,
                               'Efectivo', null, 'Prueba parcial', null);
  raise exception 'PARCIAL valor_devuelto=% (debe ser el precio de UNA unidad: %)',
    v_res->>'valor_devuelto', round(v_precio);
end $$;
```

Expected: `valor_devuelto` igual al precio de una sola unidad, no al de la línea
completa.

- [ ] **Step 9: Escenario "no hay stock del producto nuevo"**

```sql
do $$
declare
  v_venta record; v_dev uuid; v_nue uuid; v_res jsonb;
  v_dev_ini int; v_dev_fin int;
begin
  select id, sede_id, vendedor_id into v_venta from ventas where numero = 1834;
  select producto_id into v_dev from detalle_venta where venta_id = v_venta.id limit 1;
  -- producto activo SIN stock en la sede
  select p.id into v_nue from productos p
    left join inventario i on i.producto_id = p.id and i.sede_id = v_venta.sede_id
   where p.activo and p.id <> v_dev and coalesce(i.cantidad, 0) = 0 limit 1;
  if v_nue is null then raise exception 'No hay producto sin stock para probar'; end if;

  select count(*) into v_dev_ini from devoluciones where venta_id = v_venta.id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_venta.vendedor_id, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    v_res := fn_registrar_cambio(v_venta.id, v_dev, 1, v_nue, 1, v_venta.sede_id,
                                 'Efectivo', null, 'Prueba sin stock', null);
    raise exception 'SIN STOCK: pasó (mal)';
  exception when others then
    if sqlerrm like 'SIN STOCK%' then raise; end if;
    execute 'reset role';
    select count(*) into v_dev_fin from devoluciones where venta_id = v_venta.id;
    raise exception 'SIN STOCK rechazado -> % | devoluciones antes=% despues=%',
      sqlerrm, v_dev_ini, v_dev_fin;
  end;
end $$;
```

Expected: rechazado con un mensaje que diga qué producto y qué stock falta, y
`devoluciones antes = despues` — la devolución no puede quedar aplicada a
medias.

- [ ] **Step 10: Confirmar que no quedó nada**

```sql
select
  (select coalesce(sum(total),0) from ventas where anulada=false and origen='directa'
     and metodo_pago <> 'Crédito'
     and (fecha at time zone 'America/Bogota')::date = (now() at time zone 'America/Bogota')::date) as ingreso_hoy,
  (select count(*) from ventas where observaciones ilike '%Prueba%') as ventas_de_prueba,
  (select count(*) from ventas where total < 0) as totales_negativos;
```

Expected: `ingreso_hoy` idéntico al del Step 1, `ventas_de_prueba` = 0,
`totales_negativos` = 0.

---

## Task 5: Traer el precio de lista al modal

**Files:**

- Modify: `src/pages/ops/VentaDetalle.jsx:105-109`
- Modify: `src/components/ventas/ModalCambioProducto.jsx:38-60`

- [ ] **Step 1: Pedir el precio de lista en la consulta del detalle**

En `src/pages/ops/VentaDetalle.jsx`, reemplazar:

```js
            .from("detalle_venta")
            .select(
              `*, producto:producto_id(nombre, referencia, unidad_medida)`,
            )
```

por:

```js
            .from("detalle_venta")
            .select(
              // `precio_venta` es la lista de HOY del producto: la necesita el
              // modal de cambio para sugerir el precio acordado.
              `*, producto:producto_id(nombre, referencia, unidad_medida, precio_venta)`,
            )
```

- [ ] **Step 2: Propagar la lista en el agrupado del modal**

En `src/components/ventas/ModalCambioProducto.jsx`, dentro de
`productosDevolubles`, agregar `precioLista` al objeto agrupado. Reemplazar:

```js
const g = map.get(it.producto_id) ?? {
  producto_id: it.producto_id,
  nombre: it.producto?.nombre ?? it.descripcion ?? "—",
  referencia: it.producto?.referencia ?? "",
  cantidad: 0,
  subtotal: 0,
};
```

por:

```js
const g = map.get(it.producto_id) ?? {
  producto_id: it.producto_id,
  nombre: it.producto?.nombre ?? it.descripcion ?? "—",
  referencia: it.producto?.referencia ?? "",
  // Lista de HOY del producto devuelto. Es la referencia contra la que se
  // mide el descuento que se le dio al cliente.
  precioLista: Number(it.producto?.precio_venta) || 0,
  cantidad: 0,
  subtotal: 0,
};
```

- [ ] **Step 3: Verificar que compila**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/pages/ops/VentaDetalle.jsx src/components/ventas/ModalCambioProducto.jsx
git commit -m "feat(ventas): traer el precio de lista de los productos de la venta"
```

---

## Task 6: Campo de precio acordado en el modal

**Files:**

- Modify: `src/components/ventas/ModalCambioProducto.jsx`

- [ ] **Step 1: Importar la fórmula**

Agregar a los imports:

```js
import { precioSugeridoCambio } from "../../lib/ventas-ui";
```

- [ ] **Step 2: Agregar el estado del precio**

Después de `const [cantNuevo, setCantNuevo] = useState(1);` agregar:

```js
// Precio unitario acordado para el producto que se lleva. Vacío = todavía no
// se ha elegido producto nuevo. Se guarda como string porque es un input.
const [precioAcordado, setPrecioAcordado] = useState("");
```

- [ ] **Step 3: Calcular el sugerido y precargarlo**

Después del bloque de `ratioPagado` y de `const precioDev = devSel ? devSel.precio : 0;`
agregar:

```js
// Lo que el cliente realmente pagó por unidad del producto que devuelve.
const precioPagadoUnitario = Math.round(precioDev * ratioPagado);
const listaNuevo = nuevo ? Number(nuevo.precio_venta) || 0 : 0;
const sugerido = nuevo
  ? precioSugeridoCambio({
      precioPagadoUnitario,
      listaDevuelto: devSel?.precioLista ?? 0,
      listaNuevo,
    })
  : 0;

// Al elegir producto nuevo (o cambiar el devuelto) el campo se precarga con
// el sugerido. La vendedora puede sobrescribirlo; si vuelve a elegir otro
// producto, se recalcula.
useEffect(() => {
  setPrecioAcordado(nuevo ? String(sugerido) : "");
  // `sugerido` depende de nuevo/devSel: se recalcula al cambiar cualquiera.
}, [nuevo, devSel?.producto_id, sugerido]);
```

- [ ] **Step 4: Usar el precio acordado en el cálculo de la diferencia**

Reemplazar:

```js
const valorNuevo = nuevo
  ? Math.round(Number(nuevo.precio_venta) * cantNuevo)
  : 0;
```

por:

```js
// Espejo exacto del backend: valor_nuevo = precio acordado × cantidad.
const precioAcordadoNum = Math.max(0, Math.round(Number(precioAcordado) || 0));
const valorNuevo = nuevo ? precioAcordadoNum * cantNuevo : 0;
```

- [ ] **Step 5: Exigir un precio válido antes de guardar**

En `puedeGuardar`, agregar una condición después de `cantNuevo >= 1 &&`:

```js
    precioAcordado !== "" &&
    Number.isFinite(Number(precioAcordado)) &&
    Number(precioAcordado) >= 0 &&
```

- [ ] **Step 6: Enviar el precio al RPC**

En la llamada `supabase.rpc("fn_registrar_cambio", {...})`, agregar como último
parámetro, después de `p_motivo`:

```js
          // El backend cae en el precio de lista si llega null; se manda
          // siempre para que lo que ve la vendedora sea lo que se registra.
          p_precio_nuevo: precioAcordadoNum,
```

- [ ] **Step 7: Pintar el campo en la UI**

Justo antes del bloque del resumen (donde hoy aparece
`value={`−${formatCOP(valorDev)}`}`), insertar:

```jsx
{
  nuevo && (
    <div className="mt-4">
      <label
        className="mb-1.5 block text-[12px] font-medium"
        style={{ color: "var(--n-700)" }}
      >
        Precio acordado por unidad
      </label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={precioAcordado}
          onChange={(e) => setPrecioAcordado(e.target.value)}
          className="finput sans flex-1"
          style={{ height: 48 }}
        />
        {precioAcordadoNum !== listaNuevo && (
          <button
            type="button"
            onClick={() => setPrecioAcordado(String(listaNuevo))}
            className="btn btn-out"
            style={{ height: 48 }}
            title="Usar el precio de lista del producto"
          >
            Lista {formatCOP(listaNuevo)}
          </button>
        )}
      </div>
      <p
        className="mt-1.5 text-[11.5px] leading-[1.5]"
        style={{ color: "var(--n-500)" }}
      >
        {precioAcordadoNum === sugerido && sugerido !== listaNuevo ? (
          <>
            Sugerido: conserva el mismo descuento que se le hizo en la venta
            original. Lista {formatCOP(listaNuevo)}.
          </>
        ) : precioAcordadoNum !== listaNuevo ? (
          <>Lista {formatCOP(listaNuevo)}. Queda registrado en el cambio.</>
        ) : (
          <>Precio de lista.</>
        )}
      </p>
    </div>
  );
}
```

- [ ] **Step 8: Verificar build y lint**

Run: `npm run build && npx eslint src/components/ventas/ModalCambioProducto.jsx`
Expected: build exit 0, eslint sin salida.

- [ ] **Step 9: Commit**

```bash
git add src/components/ventas/ModalCambioProducto.jsx
git commit -m "feat(ventas): precio acordado editable en el cambio de producto"
```

---

## Task 7: VentaDetalle deja de parsear la observación

**Files:**

- Modify: `src/pages/ops/VentaDetalle.jsx:314-316`

- [ ] **Step 1: Confirmar que la columna ya llega**

La consulta de la venta en `VentaDetalle.jsx:100` es
``.select(`*, vendedor:vendedor_id(nombre)`)``. El `*` ya trae
`cambio_de_venta_id` sin tocar nada. Verificarlo y seguir:

Run: `grep -n 'from("ventas")' -A 2 src/pages/ops/VentaDetalle.jsx`
Expected: la línea del `select` empieza con `` `*, ``. Si alguien la cambió por
una lista de columnas, agregar `cambio_de_venta_id` a esa lista.

- [ ] **Step 2: Usar la columna en vez del regex**

Reemplazar:

```js
const obs = venta.observaciones || "";
const esCambio = obs.startsWith("Cambio por venta #");
const cambioRefNum = esCambio ? (obs.match(/#(\d+)/)?.[1] ?? null) : null;
```

por:

```js
// El enlace vive en `cambio_de_venta_id` desde 2026-08-29. La observación se
// sigue mirando como respaldo por si alguna venta vieja no quedó enlazada en
// el backfill; el prefijo lo sigue escribiendo fn_registrar_cambio.
const obs = venta.observaciones || "";
const esCambio =
  venta.cambio_de_venta_id != null || obs.startsWith("Cambio por venta #");
const cambioRefNum = esCambio ? (obs.match(/#(\d+)/)?.[1] ?? null) : null;
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/pages/ops/VentaDetalle.jsx
git commit -m "fix(ventas): detectar una venta de cambio por su enlace, no por el texto"
```

---

## Task 8: Verificación final

**Files:** ninguno.

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: los 17 tests que ya pasaban más los 7 nuevos, 0 fallos.

- [ ] **Step 2: Build y lint de lo tocado**

Run: `npm run build && npx eslint src/lib/ventas-ui.js src/components/ventas/ModalCambioProducto.jsx src/pages/ops/VentaDetalle.jsx`
Expected: build exit 0, eslint sin salida.

- [ ] **Step 3: Confirmar el invariante de caja en producción**

```sql
select
  (select count(*) from ventas where total < 0) as totales_negativos,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='fn_registrar_cambio') as firmas_de_la_funcion,
  (select count(*) from ventas where observaciones ~ '^Cambio por venta #[0-9]+'
     and cambio_de_venta_id is null) as cambios_sin_enlazar;
```

Expected: `totales_negativos` = 0, `firmas_de_la_funcion` = 1, `cambios_sin_enlazar` = 0.

- [ ] **Step 4: Prueba manual del flujo (la corre el usuario)**

Entrar a una venta con descuento, pulsar **Registrar cambio**, elegir el
producto devuelto y uno nuevo de la misma lista, y comprobar que el precio
llega precargado con lo que el cliente pagó y que la diferencia dice
**cambio par**. Cambiar el precio a mano y ver que la diferencia se mueve.

- [ ] **Step 5: Push a los dos remotos**

```bash
git push origin main && git push cdv-cali main
```

---

## Fuera de este plan

La reparación de #1789 y #1834 va aparte. `trg_ventas_proteger_anulacion`
bloquea de forma incondicional pasar `anulada` de verdadero a falso, y la
anulación ya reingresó el stock, así que revertirla obliga a volver a
descontarlo. Los cierres del 27, 28 y 29 no están generados y se calculan en
vivo, así que corregir los datos antes de generarlos deja los tres días bien.
El bloque se presentará con el antes y el después de cada peso y cada unidad,
y se ejecutará en una sola transacción, con aprobación explícita.

Los cambios sobre ventas a crédito siguen moviendo la diferencia en efectivo
aunque la venta original no haya entrado a caja. Es un problema real, de otra
naturaleza, y toca el módulo de cuentas por cobrar.
