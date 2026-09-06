# Retenciones Fase 1 (ventas + OT) — Plan de implementación

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usar
> `superpowers:subagent-driven-development` (recomendado) o
> `superpowers:executing-plans` para ejecutar tarea por tarea. Los pasos usan
> casillas (`- [ ]`) para llevar la cuenta.

**Objetivo:** que una venta o una OT puedan registrar retefuente, reteICA y
reteIVA, y que la caja, el arqueo, las cuentas por cobrar y los documentos
impresos reflejen la plata que de verdad entra — sin tocar ni un peso de la
factura.

**Arquitectura:** las tarifas y los valores viven en columnas nuevas de
`ventas`, `ordenes_servicio` y `compras`. Los valores son **columnas generadas
(`GENERATED ALWAYS AS ... STORED`)**, no calculadas por código: dependen solo de
columnas de la misma fila, así que no pueden desincronizarse ni por un bug ni
por un `UPDATE` a mano. Donde el cierre lee `ventas.total` de una venta que no
es a crédito, se le resta `retenciones_total`; donde lee pagos, abonos o cobros,
no se toca nada, porque eso ya es plata real.

**Stack:** PostgreSQL (Supabase, RPC `SECURITY DEFINER` + RLS), React 19 + Vite,
vitest, jsPDF.

**Spec:** `docs/superpowers/specs/2026-09-05-retenciones-design.md`

---

## Correcciones al diseño (halladas al leer el código real)

El spec se escribió antes de leer las funciones línea por línea. Siete cosas
cambian, y todas hacen el trabajo **más grande**, no más pequeño. Están aquí
arriba porque cada una es un descuadre o un bloqueo si se ignora.

**1. El cierre no tiene dos sitios de `ventas.total`. Tiene seis.**

| #   | Línea de `_fn_cierre_totales`        | Qué alimenta                    |
| --- | ------------------------------------ | ------------------------------- |
| 1   | 14 — `sum(total) from ventas`        | ingreso general de productos    |
| 2   | 70 — `sum(v.total)`                  | desglose por sede               |
| 3   | 95 — `v.total as productos`          | desglose por método de pago     |
| 4   | 113 — `v.total as ingresos`          | desglose por sede y método      |
| 5   | 141 — `v.total as ingresos`          | desglose por cuenta bancaria    |
| 6   | 222 — `sum(v.total)` … `='efectivo'` | **arqueo de efectivo esperado** |

El sexto es el más grave: es la plata que la vendedora tiene que tener en el
cajón al cerrar. Si no se le resta la retención, el arqueo va a dar faltante
todos los días y nadie va a saber por qué.

**2. Las ventas Mixto se cuentan por `pagos_venta`, no por `total`.**
Las líneas 95, 113, 141 y 222 excluyen `'Mixto'` a propósito y usan las filas de
`pagos_venta`. La línea 14 y la 70 sí lo incluyen vía `sum(total)`. Para que los
desgloses sigan cuadrando con el total, en una venta Mixto la suma de los pagos
tiene que ser **el neto**: `total − retenciones_total`. Eso obliga a cambiar la
validación de `fn_registrar_venta`, que hoy exige que los pagos sumen `total`.

**3. Tres compuertas de la OT bloquean la entrega si no se tocan.**

- `fn_generar_venta_ot` exige `abonado >= total`. Con retención el cliente abona
  el neto, así que la OT **nunca se podría entregar**.
- `trg_abono_validar_tope` rechaza abonos que superen `total`; con retención el
  techo es el neto, y el saldo se vería como impagable.
- `trg_orden_recalcular_total_mo` prohíbe dejar `total` por debajo de lo abonado.

**4. `fn_registrar_pago_cuenta` calcula el saldo como `total − abonos − pagos`.**
Sin corregirlo, el último cobro de una factura retenida se rechaza con "el monto
supera el saldo pendiente", y la factura queda abierta para siempre.

**5. Los valores pueden ser columnas generadas.** El spec decía que los calculara
la RPC. Todo lo que entra en la fórmula (`subtotal`, `descuento_valor`,
`descuento_pct`, `iva_pct`, `estado_autorizacion`) está en la misma fila, así que
`GENERATED ALWAYS AS ... STORED` funciona. Es estrictamente mejor: cubre gratis
la venta que genera la OT, el cambio de producto y cualquier recálculo futuro.

**6. `por_producto` no se toca.** El desglose por producto reparte el ingreso
entre los ítems de `detalle_venta`. Una retención no es atribuible a un producto,
y ese bloque no alimenta ningún total: es informativo. Restarle algo sería
inventar una repartición.

**7. Hay DOS tablas de parámetros y el spec nombró la equivocada.**
`parametros` (clave/valor) guarda los ajustes de mínimos y máximos, y se edita
desde Reorden. La que tiene pantalla en **Configuración** es
`parametros_sistema` (key/value/tipo), con validación de rangos, tipo y
auditoría de quién cambió qué (`updated_by`). Las tarifas van ahí: es la única
que le da a Maritza dónde editarlas, y para una tarifa de impuesto el rastro de
quién la cambió y cuándo importa.

Detalle que hay que saber antes de empezar: **`parametros_sistema` está vacía
hoy**, así que la pantalla de Configuración → Parámetros no muestra nada. Las
tres tarifas van a ser sus primeras filas. Su RLS ya es la correcta: lectura
para cualquier autenticado, escritura solo Admin.

---

## Orden de las entregas — y por qué este orden

**1A Cimientos → 1B Dinero → 1C Captura → 1D Documentos.**

El dinero va **antes** que la captura, no después. Si se hiciera al revés,
existiría una ventana en la que una vendedora puede escribir una retención pero
el cierre todavía no la resta: la caja descuadraría en producción. Haciéndolo en
este orden, cada camino de plata ya sabe manejar retenciones cuando aún no hay
ninguna que valga distinto de cero, y el día que se activa la interfaz todo lo
de atrás ya está probado.

Cada entrega deja el sistema funcionando y se puede desplegar sola.

---

## Estructura de archivos

**Backend (migraciones nuevas, en `supabase/migrations/`)**

| Archivo                                  | Responsabilidad                                     |
| ---------------------------------------- | --------------------------------------------------- |
| `..._retenciones_helpers_inmutables.sql` | las tres funciones IMMUTABLE de base y de IVA       |
| `..._retenciones_columnas.sql`           | columnas en `ventas`, `ordenes_servicio`, `compras` |
| `..._retenciones_parametros.sql`         | las tres tarifas por defecto                        |
| `..._retenciones_cierre.sql`             | `_fn_cierre_totales`: los seis sitios               |
| `..._retenciones_cuentas_por_cobrar.sql` | `v_cuentas_por_cobrar` + `fn_registrar_pago_cuenta` |
| `..._retenciones_compuertas_ot.sql`      | las tres compuertas de OT                           |
| `..._retenciones_registrar_venta.sql`    | `fn_registrar_venta`: parámetros y validación Mixto |

**Frontend**

| Archivo                                        | Responsabilidad                                                 |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `src/lib/retenciones.js`                       | **nuevo** — cálculo puro, compartido por venta, OT y documentos |
| `src/components/ventas/BloqueRetenciones.jsx`  | **nuevo** — el plegable, usado en venta y OT                    |
| `src/pages/ops/VentaNueva.jsx`                 | estado de las tarifas + envío a la RPC                          |
| `src/lib/ot-flujo.js`                          | `calcularMontos`: saldo neto de la OT                           |
| `src/pages/ops/OrdenDetalle.jsx`               | monta el bloque; guarda las tarifas en la OT                    |
| `src/lib/pdf/ventaPOS.js`                      | líneas de retención y neto en el recibo POS                     |
| `src/lib/pdf/reciboPDF.js`                     | lo mismo en el PDF carta                                        |
| `src/lib/admin-config-ui.js`                   | etiqueta legible de las tres tarifas nuevas                     |
| `src/pages/admin/Configuracion/Parametros.jsx` | rangos y sufijo `%` de las tarifas                              |

`src/lib/retenciones.js` existe para que la fórmula viva en **un solo sitio** del
frontend. VentaNueva, OrdenDetalle, el POS y el PDF la comparten. Es exactamente
el error que costó caro en el cambio de producto: la fórmula estaba duplicada
entre el modal y el servidor, se arregló en uno y no en el otro, y nueve ventas
quedaron con el crédito mal.

**Pruebas**

| Archivo                                        | Qué cubre                                 |
| ---------------------------------------------- | ----------------------------------------- |
| `tests/integration/retenciones.test.js`        | **nuevo** — la aritmética pura            |
| `tests/integration/retenciones-render.test.js` | **nuevo** — humo de las pantallas tocadas |
| `tests/integration/ot-montos.test.js`          | **nuevo** — saldo de OT con retención     |

---

# FASE 1A — Cimientos

Columnas y funciones. Nadie las lee todavía. Al terminar, la app se comporta
exactamente igual que hoy y eso es lo que hay que demostrar.

---

### Tarea 1: Funciones inmutables de base gravable

Las columnas generadas exigen funciones `IMMUTABLE`. Estas tres son la única
definición de "sobre qué se retiene", y tienen que replicar al pie de la letra
lo que ya hacen `trg_recalcular_total_venta` y `trg_orden_recalcular_total_mo`.
Si difieren en un peso, la base de la retención no corresponde a la factura.

**Archivos:**

- Crear: `supabase/migrations/<TS>_retenciones_helpers_inmutables.sql`

- [ ] **Paso 1: Escribir la prueba que falla (contra producción, en transacción revertida)**

Correr con `mcp__supabase__execute_sql`. Falla porque las funciones no existen.

```sql
DO $$
DECLARE v_base numeric; v_iva numeric;
BEGIN
  -- Venta: subtotal 1.000.000, descuento 100.000, IVA 19%
  v_base := public._fn_base_retencion_venta(1000000, 100000, 0);
  IF v_base <> 900000 THEN RAISE EXCEPTION 'base venta = % (esperado 900000)', v_base; END IF;

  -- El descuento por porcentaje se usa solo si no hay descuento en valor
  v_base := public._fn_base_retencion_venta(1000000, NULL, 10);
  IF v_base <> 900000 THEN RAISE EXCEPTION 'base venta pct = % (esperado 900000)', v_base; END IF;

  -- Un descuento mayor que el subtotal se recorta: la base nunca es negativa
  v_base := public._fn_base_retencion_venta(1000000, 5000000, 0);
  IF v_base <> 0 THEN RAISE EXCEPTION 'base venta clamp = % (esperado 0)', v_base; END IF;

  -- El IVA sale de la base, no del total, y se redondea a pesos enteros
  v_iva := public._fn_iva_venta(1000000, 100000, 0, 19);
  IF v_iva <> 171000 THEN RAISE EXCEPTION 'iva venta = % (esperado 171000)', v_iva; END IF;

  -- OT autorizada: mano de obra + repuestos + revision - descuento
  v_base := public._fn_base_retencion_ot('autorizado', 200000, 300000, 50000, 50000);
  IF v_base <> 500000 THEN RAISE EXCEPTION 'base OT = % (esperado 500000)', v_base; END IF;

  -- OT NO autorizada: solo la revision, y el descuento se ignora
  v_base := public._fn_base_retencion_ot('no_autorizado', 200000, 300000, 50000, 50000);
  IF v_base <> 50000 THEN RAISE EXCEPTION 'base OT no aut = % (esperado 50000)', v_base; END IF;

  RAISE EXCEPTION 'OK - todas las aserciones pasaron (se revierte a proposito)';
END $$;
```

Esperado: `ERROR: function public._fn_base_retencion_venta(...) does not exist`.

- [ ] **Paso 2: Aplicar la migración**

Con `mcp__supabase__apply_migration`, nombre `retenciones_helpers_inmutables`:

```sql
-- Base gravable de las retenciones. NO es una formula nueva: es la misma que
-- ya usan los triggers que calculan el total, extraida a una funcion para que
-- las columnas generadas puedan invocarla y para que exista un solo sitio donde
-- diga que se grava.
--
-- Sobre la base (subtotal - descuento) van retefuente y reteICA. Sobre el IVA
-- va reteIVA. El domicilio queda FUERA a proposito: es transporte facturado
-- aparte, no valor de la mercancia.
--
-- OJO: estas funciones son IMMUTABLE y las usan columnas GENERATED STORED. Si
-- algun dia se cambia el cuerpo, Postgres NO recalcula las filas existentes.
-- Cambiarlas exige forzar un rewrite de la tabla en la misma migracion.

-- Espejo de trg_recalcular_total_venta:
--   v_desc := coalesce(descuento_valor, subtotal * descuento_pct/100)
--   v_desc := greatest(0, least(v_desc, subtotal))
--   base   := subtotal - v_desc
CREATE OR REPLACE FUNCTION public._fn_base_retencion_venta(
  p_subtotal numeric, p_descuento_valor numeric, p_descuento_pct numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT coalesce(p_subtotal, 0) - greatest(0::numeric, least(
           coalesce(p_descuento_valor, coalesce(p_subtotal,0) * coalesce(p_descuento_pct,0) / 100),
           coalesce(p_subtotal, 0)))
$$;

-- El IVA facturado. La tabla `ventas` no lo guarda: el trigger calcula
-- total = round(base * (1+iva/100) + domicilio) sin materializarlo. Aqui se
-- redondea a pesos enteros, que es como sale en la factura impresa.
CREATE OR REPLACE FUNCTION public._fn_iva_venta(
  p_subtotal numeric, p_descuento_valor numeric, p_descuento_pct numeric, p_iva_pct numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT round(public._fn_base_retencion_venta(p_subtotal, p_descuento_valor, p_descuento_pct)
               * coalesce(p_iva_pct, 0) / 100)
$$;

-- Espejo de trg_orden_recalcular_total_mo. La OT no autorizada solo cobra la
-- revision: ni mano de obra, ni repuestos, ni descuento.
CREATE OR REPLACE FUNCTION public._fn_base_retencion_ot(
  p_estado_autorizacion text, p_mano_obra numeric, p_repuestos numeric,
  p_revision numeric, p_descuento numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE WHEN p_estado_autorizacion = 'no_autorizado'
    THEN greatest(0::numeric, coalesce(p_revision, 0))
    ELSE greatest(0::numeric,
           (coalesce(p_mano_obra,0) + coalesce(p_repuestos,0) + coalesce(p_revision,0))
           - least(greatest(coalesce(p_descuento,0), 0::numeric),
                   coalesce(p_mano_obra,0) + coalesce(p_repuestos,0) + coalesce(p_revision,0)))
  END
$$;

-- Son funciones internas de calculo, no API. Supabase concede EXECUTE a `anon`
-- por defecto en cada funcion nueva del esquema public, y REVOKE FROM PUBLIC
-- no lo quita: hay que nombrar el rol.
REVOKE EXECUTE ON FUNCTION public._fn_base_retencion_venta(numeric, numeric, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public._fn_iva_venta(numeric, numeric, numeric, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public._fn_base_retencion_ot(text, numeric, numeric, numeric, numeric) FROM anon;
```

- [ ] **Paso 3: Correr la prueba del paso 1 otra vez**

Esperado: `ERROR: OK - todas las aserciones pasaron (se revierte a proposito)`.
Cualquier otro mensaje es una fórmula que no coincide.

- [ ] **Paso 4: Comprobar que `anon` no puede ejecutarlas**

```sql
SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_puede
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('_fn_base_retencion_venta','_fn_iva_venta','_fn_base_retencion_ot');
```

Esperado: `anon_puede = false` en las tres.

- [ ] **Paso 5: Guardar el archivo de migración y commitear**

El archivo debe quedar en `supabase/migrations/` con el mismo timestamp que le
puso Supabase (verificar con `mcp__supabase__list_migrations`) y **el mismo
contenido byte a byte** que se aplicó.

```bash
git add supabase/migrations/
git commit -m "feat(retenciones): funciones inmutables de base gravable"
```

---

### Tarea 2: Columnas de retención en las tres tablas

**Archivos:**

- Crear: `supabase/migrations/<TS>_retenciones_columnas.sql`

- [ ] **Paso 1: Medir el ingreso acumulado ANTES de tocar nada**

Este número es la prueba de que la migración no movió un peso. Guardarlo.

```sql
SELECT
  (SELECT coalesce(sum(total),0) FROM ventas WHERE anulada = false) AS ventas_total,
  (SELECT count(*) FROM ventas) AS ventas_filas,
  (SELECT coalesce(sum(total),0) FROM ordenes_servicio WHERE estado <> 'cancelada') AS ot_total,
  (SELECT coalesce(sum(total),0) FROM compras WHERE estado <> 'cancelada') AS compras_total;
```

- [ ] **Paso 2: Escribir la prueba que falla**

```sql
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema='public' AND table_name IN ('ventas','ordenes_servicio','compras')
     AND column_name IN ('retefuente_pct','retefuente_valor','reteica_pct','reteica_valor',
                         'reteiva_pct','reteiva_valor','retenciones_total');
  IF v_n <> 21 THEN RAISE EXCEPTION 'hay % columnas de retencion (esperado 21)', v_n; END IF;
  RAISE EXCEPTION 'OK - las 21 columnas existen (se revierte a proposito)';
END $$;
```

Esperado: `ERROR: hay 0 columnas de retencion (esperado 21)`.

- [ ] **Paso 3: Aplicar la migración**

Nombre `retenciones_columnas`:

```sql
-- Retenciones: seis columnas de captura y una derivada por tabla.
--
-- Se guarda el PORCENTAJE y el VALOR. El porcentaje solo para poder mostrar de
-- donde salio el numero; el valor es el dato bueno. Si manana la ley cambia la
-- tarifa, los documentos viejos conservan lo que se les aplico de verdad.
--
-- Los cuatro valores son GENERATED STORED, no calculados por codigo: dependen
-- unicamente de columnas de la misma fila, asi que no pueden desincronizarse ni
-- por un bug de la RPC ni por un UPDATE a mano. Eso cubre gratis la venta que
-- genera una OT y la que genera un cambio de producto.
--
-- retenciones_total no puede referirse a las otras tres (Postgres prohibe que
-- una columna generada lea otra generada), asi que repite la expresion. Es
-- verboso a proposito: la alternativa era que pudieran discrepar.
--
-- Las columnas de `compras` nacen aqui aunque la fase 2 sea la que las use, para
-- no partir la migracion del esquema en dos.
--
-- Todas nacen en 0: las ventas, OT y compras que ya existen quedan con retencion
-- cero y su comportamiento no cambia.

-- ventas ------------------------------------------------------------------
ALTER TABLE public.ventas
  ADD COLUMN retefuente_pct numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN reteica_pct    numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN reteiva_pct    numeric(6,3) NOT NULL DEFAULT 0,
  ADD CONSTRAINT ventas_retefuente_pct_rango CHECK (retefuente_pct >= 0 AND retefuente_pct <= 100),
  ADD CONSTRAINT ventas_reteica_pct_rango    CHECK (reteica_pct    >= 0 AND reteica_pct    <= 100),
  ADD CONSTRAINT ventas_reteiva_pct_rango    CHECK (reteiva_pct    >= 0 AND reteiva_pct    <= 100);

ALTER TABLE public.ventas
  ADD COLUMN retefuente_valor numeric(12,2) GENERATED ALWAYS AS (
    round(public._fn_base_retencion_venta(subtotal, descuento_valor, descuento_pct)
          * retefuente_pct / 100)) STORED,
  ADD COLUMN reteica_valor numeric(12,2) GENERATED ALWAYS AS (
    round(public._fn_base_retencion_venta(subtotal, descuento_valor, descuento_pct)
          * reteica_pct / 100)) STORED,
  ADD COLUMN reteiva_valor numeric(12,2) GENERATED ALWAYS AS (
    round(public._fn_iva_venta(subtotal, descuento_valor, descuento_pct, iva_pct)
          * reteiva_pct / 100)) STORED,
  ADD COLUMN retenciones_total numeric(12,2) GENERATED ALWAYS AS (
      round(public._fn_base_retencion_venta(subtotal, descuento_valor, descuento_pct) * retefuente_pct / 100)
    + round(public._fn_base_retencion_venta(subtotal, descuento_valor, descuento_pct) * reteica_pct / 100)
    + round(public._fn_iva_venta(subtotal, descuento_valor, descuento_pct, iva_pct) * reteiva_pct / 100)
  ) STORED;

-- ordenes_servicio --------------------------------------------------------
ALTER TABLE public.ordenes_servicio
  ADD COLUMN retefuente_pct numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN reteica_pct    numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN reteiva_pct    numeric(6,3) NOT NULL DEFAULT 0,
  ADD CONSTRAINT ot_retefuente_pct_rango CHECK (retefuente_pct >= 0 AND retefuente_pct <= 100),
  ADD CONSTRAINT ot_reteica_pct_rango    CHECK (reteica_pct    >= 0 AND reteica_pct    <= 100),
  ADD CONSTRAINT ot_reteiva_pct_rango    CHECK (reteiva_pct    >= 0 AND reteiva_pct    <= 100);

ALTER TABLE public.ordenes_servicio
  ADD COLUMN retefuente_valor numeric(12,2) GENERATED ALWAYS AS (
    round(public._fn_base_retencion_ot(estado_autorizacion, costo_mano_obra, valor_repuestos,
                                       valor_revision, descuento_valor) * retefuente_pct / 100)) STORED,
  ADD COLUMN reteica_valor numeric(12,2) GENERATED ALWAYS AS (
    round(public._fn_base_retencion_ot(estado_autorizacion, costo_mano_obra, valor_repuestos,
                                       valor_revision, descuento_valor) * reteica_pct / 100)) STORED,
  ADD COLUMN reteiva_valor numeric(12,2) GENERATED ALWAYS AS (
    round(round(public._fn_base_retencion_ot(estado_autorizacion, costo_mano_obra, valor_repuestos,
                                             valor_revision, descuento_valor) * iva_pct / 100)
          * reteiva_pct / 100)) STORED,
  ADD COLUMN retenciones_total numeric(12,2) GENERATED ALWAYS AS (
      round(public._fn_base_retencion_ot(estado_autorizacion, costo_mano_obra, valor_repuestos,
                                         valor_revision, descuento_valor) * retefuente_pct / 100)
    + round(public._fn_base_retencion_ot(estado_autorizacion, costo_mano_obra, valor_repuestos,
                                         valor_revision, descuento_valor) * reteica_pct / 100)
    + round(round(public._fn_base_retencion_ot(estado_autorizacion, costo_mano_obra, valor_repuestos,
                                               valor_revision, descuento_valor) * iva_pct / 100)
            * reteiva_pct / 100)
  ) STORED;

-- compras (fase 2; nacen aqui y quedan en 0) ------------------------------
ALTER TABLE public.compras
  ADD COLUMN retefuente_pct numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN reteica_pct    numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN reteiva_pct    numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN retefuente_valor numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN reteica_valor    numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN reteiva_valor    numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN retenciones_total numeric(12,2) GENERATED ALWAYS AS (
    retefuente_valor + reteica_valor + reteiva_valor) STORED,
  ADD CONSTRAINT compras_retefuente_pct_rango CHECK (retefuente_pct >= 0 AND retefuente_pct <= 100),
  ADD CONSTRAINT compras_reteica_pct_rango    CHECK (reteica_pct    >= 0 AND reteica_pct    <= 100),
  ADD CONSTRAINT compras_reteiva_pct_rango    CHECK (reteiva_pct    >= 0 AND reteiva_pct    <= 100);

COMMENT ON COLUMN public.ventas.retenciones_total IS
  'Suma de las tres retenciones. Es lo que el cliente NO paga porque lo consigna a la DIAN o al municipio. La factura (total, IVA, subtotal) no cambia.';
COMMENT ON COLUMN public.ordenes_servicio.retenciones_total IS
  'Suma de las tres retenciones de la OT. El saldo cobrable es total - retenciones_total.';
COMMENT ON COLUMN public.compras.retenciones_total IS
  'Fase 2: la empresa como agente retenedor. Hoy siempre 0.';
```

> **Nota sobre `compras`:** ahí los valores son columnas normales, no generadas.
> `compras.total` no se deriva de un subtotal y un descuento como en ventas —
> la fase 2 decidirá cómo se calcula la base. Dejarlas normales evita
> comprometerse ahora con una fórmula que no se ha estudiado.

- [ ] **Paso 4: Correr la prueba del paso 2**

Esperado: `ERROR: OK - las 21 columnas existen (se revierte a proposito)`.

- [ ] **Paso 5: Verificar que NO se movió ni un peso**

```sql
SELECT
  (SELECT coalesce(sum(total),0) FROM ventas WHERE anulada = false) AS ventas_total,
  (SELECT count(*) FROM ventas) AS ventas_filas,
  (SELECT coalesce(sum(total),0) FROM ordenes_servicio WHERE estado <> 'cancelada') AS ot_total,
  (SELECT coalesce(sum(total),0) FROM compras WHERE estado <> 'cancelada') AS compras_total,
  (SELECT coalesce(sum(retenciones_total),0) FROM ventas) AS ret_ventas,
  (SELECT coalesce(sum(retenciones_total),0) FROM ordenes_servicio) AS ret_ot,
  (SELECT coalesce(sum(retenciones_total),0) FROM compras) AS ret_compras;
```

Esperado: los cuatro primeros **idénticos** al paso 1, y las tres retenciones en 0.

- [ ] **Paso 6: Comprobar que una columna generada no se puede escribir a mano**

Esta es la garantía que justifica todo el diseño; hay que verla fallar.

```sql
DO $$
BEGIN
  UPDATE ventas SET retenciones_total = 999999 WHERE id = (SELECT id FROM ventas LIMIT 1);
  RAISE EXCEPTION 'MAL: se pudo escribir una columna generada';
END $$;
```

Esperado: `ERROR: column "retenciones_total" can only be updated to DEFAULT`.

- [ ] **Paso 7: Revisar los advisors de Supabase**

Correr `mcp__supabase__get_advisors` con `type: "security"`. No debe aparecer
ningún hallazgo nuevo asociado a las columnas o funciones creadas.

- [ ] **Paso 8: Guardar el archivo y commitear**

```bash
git add supabase/migrations/
git commit -m "feat(retenciones): columnas de retencion en ventas, OT y compras"
```

---

### Tarea 3: Tarifas configurables en `parametros_sistema`

Van en `parametros_sistema`, no en `parametros`: es la que tiene pantalla en
Configuración, validación de rangos y auditoría de quién cambió el valor. Para
una tarifa de impuesto, saber quién la tocó y cuándo no es un lujo.

La tabla está vacía hoy, así que estas van a ser sus primeras tres filas.

**Archivos:**

- Crear: `supabase/migrations/<TS>_retenciones_parametros.sql`
- Modificar: `src/lib/admin-config-ui.js:141-147` (`PARAM_LABELS`)
- Modificar: `src/pages/admin/Configuracion/Parametros.jsx:10-25` (`BOUNDS`, `SUFFIX`)

- [ ] **Paso 1: Escribir la prueba que falla**

```sql
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM parametros_sistema
   WHERE key IN ('retencion_retefuente_pct','retencion_reteica_pct','retencion_reteiva_pct')
     AND tipo = 'decimal';
  IF v_n <> 3 THEN RAISE EXCEPTION 'hay % tarifas (esperado 3)', v_n; END IF;
  RAISE EXCEPTION 'OK - las 3 tarifas existen (se revierte a proposito)';
END $$;
```

Esperado: `ERROR: hay 0 tarifas (esperado 3)`.

- [ ] **Paso 2: Aplicar la migración**

Nombre `retenciones_parametros`:

```sql
-- Tarifas por defecto de las retenciones.
--
-- Van en parametros_sistema (no en `parametros`, que es la de minimos y maximos)
-- porque es la que tiene pantalla en Configuracion, validacion por rango y
-- auditoria de updated_by. Una tarifa de impuesto la cambia una persona por una
-- razon, y conviene poder reconstruir cual y cuando.
--
-- Estas son las primeras filas de la tabla: hoy esta vacia y la pantalla de
-- Configuracion -> Parametros no muestra nada.
--
-- Su RLS ya sirve tal como esta: auth_read_parametros_sistema deja leer a
-- cualquier autenticado (la vendedora necesita la tarifa sugerida al vender) y
-- admin_write_parametros_sistema deja escribir solo a Admin.
--
-- 2,5% es la retefuente de compras generales; 0,69% (6,9 por mil) es una tarifa
-- de ICA usual en Cali para comercio; 15% es la general de reteIVA. Son puntos
-- de partida editables, no una asesoria tributaria: si la ley o el municipio
-- cambian, Maritza los ajusta desde Configuracion sin tocar codigo.
--
-- Llegan SUGERIDAS a cada documento, no aplicadas: el bloque de retenciones
-- nace apagado y solo se precarga cuando alguien lo abre.
INSERT INTO public.parametros_sistema (key, value, tipo, descripcion) VALUES
  ('retencion_retefuente_pct', '2.5',  'decimal', 'Retefuente sugerida (% sobre subtotal menos descuento)'),
  ('retencion_reteica_pct',    '0.69', 'decimal', 'ReteICA sugerida (% sobre subtotal menos descuento)'),
  ('retencion_reteiva_pct',    '15',   'decimal', 'ReteIVA sugerida (% sobre el IVA facturado)')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Paso 3: Correr la prueba del paso 1**

Esperado: `ERROR: OK - las 3 tarifas existen (se revierte a proposito)`.

- [ ] **Paso 4: Ponerles etiqueta legible**

Sin esto la pantalla muestra la clave cruda (`retencion_retefuente_pct`).
En `src/lib/admin-config-ui.js`, dentro de `PARAM_LABELS` (línea 141):

```js
  retencion_retefuente_pct: "Retefuente sugerida",
  retencion_reteica_pct: "ReteICA sugerida",
  retencion_reteiva_pct: "ReteIVA sugerida",
```

- [ ] **Paso 5: Ponerles rango y sufijo**

En `src/pages/admin/Configuracion/Parametros.jsx`, dentro de `BOUNDS` (línea 10):

```js
  retencion_retefuente_pct: { min: 0, max: 100 },
  retencion_reteica_pct: { min: 0, max: 100 },
  retencion_reteiva_pct: { min: 0, max: 100 },
```

Y dentro de `SUFFIX` (línea 19):

```js
  retencion_retefuente_pct: "%",
  retencion_reteica_pct: "%",
  retencion_reteiva_pct: "%",
```

> El comentario de `BOUNDS` dice "sincronizado con `fn_validate_parametro_value()`
> en BD". Ese trigger no tiene regla para estas claves: solo comprueba que un
> `decimal` sea numérico. El rango 0-100 vive aquí y en el `CHECK` de las
> columnas de `ventas`, `ordenes_servicio` y `compras`, que es donde de verdad
> importa. No hace falta tocar el trigger.

- [ ] **Paso 6: Comprobar que la pantalla monta con filas de verdad**

Hoy la tabla está vacía, así que esa pantalla nunca se ha renderizado con datos.

```bash
npm test && npm run lint && npm run build
```

Y abrir en la app: Configuración → Parámetros. Tienen que salir las tres con su
etiqueta en español, el sufijo `%` y el valor editable. Cambiar una a otro valor
y verla guardar.

- [ ] **Paso 7: Guardar el archivo y commitear**

```bash
git add supabase/migrations/ src/lib/admin-config-ui.js src/pages/admin/Configuracion/Parametros.jsx
git commit -m "feat(retenciones): tarifas sugeridas editables desde Configuracion"
```

---

# FASE 1B — El dinero

Aquí se cambia el cierre, las cuentas por cobrar y las tres compuertas de la OT.
Todas las retenciones valen 0 mientras tanto, así que **el comportamiento
observable no cambia**: eso es justo lo que hace segura esta entrega y lo que
hay que medir en cada tarea.

La regla que gobierna todo lo que sigue, en una línea:

> Donde el cierre lee `ventas.total` de una venta que no es a crédito, se resta
> `retenciones_total`. Donde lee `pagos_venta`, `pagos_cuenta`, `abonos` o
> `abonos_cotizacion`, no se toca: eso ya es plata que se movió.

---

### Tarea 4: El cierre — los seis sitios de `ventas.total`

**Archivos:**

- Crear: `supabase/migrations/<TS>_retenciones_cierre.sql`

- [ ] **Paso 1: Medir el cierre de los últimos 90 días ANTES de tocarlo**

Guardar este resultado. Es el patrón contra el que se compara después.

```sql
SELECT
  x->>'ingresos_productos'  AS productos,
  x->>'ingresos_servicios'  AS servicios,
  x->>'ingresos_total'      AS ingresos,
  x->>'egresos'             AS egresos,
  jsonb_pretty(x->'detalle'->'por_sede')          AS por_sede,
  jsonb_pretty(x->'detalle'->'por_metodo_pago')   AS por_metodo,
  jsonb_pretty(x->'detalle'->'arqueo_esperado')   AS arqueo
FROM (SELECT public._fn_cierre_totales(current_date - 90, current_date, NULL) AS x) t;
```

- [ ] **Paso 2: Escribir la prueba que falla**

Simula una venta de contado con retención y comprueba que el ingreso del día se
mueve **exactamente** en la retención, ni un peso más, en los seis sitios.

```sql
DO $$
DECLARE
  v_sede text; v_uid uuid; v_prod uuid;
  v_antes numeric; v_despues numeric;
  v_sede_antes numeric; v_sede_despues numeric;
  v_arq_antes numeric; v_arq_despues numeric;
  v_met_antes numeric; v_met_despues numeric;
  v_venta uuid; v_ret numeric;
  x jsonb;
BEGIN
  -- Sede y producto CON STOCK: la venta sin stock esta bloqueada por
  -- trg_venta_descontar_stock y por el CHECK (cantidad >= 0). Elegir un producto
  -- cualquiera haria fallar la prueba por una razon que no tiene que ver con
  -- retenciones.
  SELECT i.sede_id, i.producto_id INTO v_sede, v_prod
    FROM inventario i JOIN productos p ON p.id = i.producto_id
   WHERE i.cantidad >= 5 AND p.activo = true
     AND i.sede_id IN (SELECT id FROM sedes WHERE activa = true)
   ORDER BY i.cantidad DESC LIMIT 1;
  IF v_prod IS NULL THEN RAISE EXCEPTION 'no hay ningun producto con stock para probar'; END IF;
  SELECT id INTO v_uid FROM usuarios WHERE rol = 'Admin' LIMIT 1;

  x := public._fn_cierre_totales(current_date, current_date, NULL);
  v_antes := (x->>'ingresos_productos')::numeric;
  SELECT coalesce(sum((e->>'productos')::numeric),0) INTO v_sede_antes
    FROM jsonb_array_elements(x->'detalle'->'por_sede') e;
  SELECT coalesce(sum((e->>'efectivo_esperado')::numeric),0) INTO v_arq_antes
    FROM jsonb_array_elements(x->'detalle'->'arqueo_esperado') e;
  SELECT coalesce(sum((e->>'productos')::numeric),0) INTO v_met_antes
    FROM jsonb_array_elements(x->'detalle'->'por_metodo_pago') e;

  INSERT INTO ventas (vendedor_id, sede_id, metodo_pago, iva_pct, subtotal, total,
                      origen, retefuente_pct, reteica_pct, reteiva_pct)
  VALUES (v_uid, v_sede, 'Efectivo', 19, 0, 0, 'directa', 2.5, 0.69, 15)
  RETURNING id INTO v_venta;

  INSERT INTO detalle_venta (venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal)
  VALUES (v_venta, v_prod, 1, 1000000, 0, 1000000);

  SELECT retenciones_total INTO v_ret FROM ventas WHERE id = v_venta;
  -- base 1.000.000 -> retefuente 25.000 + reteica 6.900 + reteiva 15% de 190.000 = 28.500
  IF v_ret <> 60400 THEN RAISE EXCEPTION 'retenciones = % (esperado 60400)', v_ret; END IF;

  x := public._fn_cierre_totales(current_date, current_date, NULL);
  v_despues := (x->>'ingresos_productos')::numeric;
  SELECT coalesce(sum((e->>'productos')::numeric),0) INTO v_sede_despues
    FROM jsonb_array_elements(x->'detalle'->'por_sede') e;
  SELECT coalesce(sum((e->>'efectivo_esperado')::numeric),0) INTO v_arq_despues
    FROM jsonb_array_elements(x->'detalle'->'arqueo_esperado') e;
  SELECT coalesce(sum((e->>'productos')::numeric),0) INTO v_met_despues
    FROM jsonb_array_elements(x->'detalle'->'por_metodo_pago') e;

  -- total facturado 1.190.000, neto 1.129.600
  IF v_despues - v_antes <> 1129600 THEN
    RAISE EXCEPTION 'ingreso general subio % (esperado 1129600)', v_despues - v_antes; END IF;
  IF v_sede_despues - v_sede_antes <> 1129600 THEN
    RAISE EXCEPTION 'desglose por sede subio % (esperado 1129600)', v_sede_despues - v_sede_antes; END IF;
  IF v_met_despues - v_met_antes <> 1129600 THEN
    RAISE EXCEPTION 'desglose por metodo subio % (esperado 1129600)', v_met_despues - v_met_antes; END IF;
  IF v_arq_despues - v_arq_antes <> 1129600 THEN
    RAISE EXCEPTION 'arqueo de efectivo subio % (esperado 1129600)', v_arq_despues - v_arq_antes; END IF;

  -- INVARIANTE: la suma de las sedes tiene que dar el ingreso general
  IF v_sede_despues <> v_despues THEN
    RAISE EXCEPTION 'las sedes suman % pero el general dice %', v_sede_despues, v_despues; END IF;

  RAISE EXCEPTION 'OK - los seis sitios restan la retencion (se revierte a proposito)';
END $$;
```

Esperado antes del cambio: `ERROR: ingreso general subio 1190000 (esperado 1129600)`.

- [ ] **Paso 3: Aplicar la migración**

Nombre `retenciones_cierre`. Tomar la definición vigente de `_fn_cierre_totales`
con `SELECT pg_get_functiondef('public._fn_cierre_totales(date,date,text)'::regprocedure)`
y aplicar **exactamente estos seis reemplazos**, sin tocar nada más:

| #   | Buscar                                                                                                                                             | Reemplazar por                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `coalesce((select sum(total) from ventas`                                                                                                          | `coalesce((select sum(total - coalesce(retenciones_total,0)) from ventas`                                                                                                            |
| 2   | `coalesce((select sum(v.total) from ventas v where v.sede_id=se.id and v.anulada=false and v.origen='directa' and v.metodo_pago<>'Crédito'`        | `coalesce((select sum(v.total - coalesce(v.retenciones_total,0)) from ventas v where v.sede_id=se.id and v.anulada=false and v.origen='directa' and v.metodo_pago<>'Crédito'`        |
| 3   | `select v.metodo_pago as metodo, v.total as productos, 0::numeric as servicios from ventas v`                                                      | `select v.metodo_pago as metodo, v.total - coalesce(v.retenciones_total,0) as productos, 0::numeric as servicios from ventas v`                                                      |
| 4   | `select v.sede_id as sede_id, lower(v.metodo_pago) as metodo, v.total as ingresos, 0::numeric as egresos from ventas v`                            | `select v.sede_id as sede_id, lower(v.metodo_pago) as metodo, v.total - coalesce(v.retenciones_total,0) as ingresos, 0::numeric as egresos from ventas v`                            |
| 5   | `select v.sede_id, nullif(trim(v.cuenta_bancaria),'') as cuenta, v.total as ingresos, 0::numeric as egresos from ventas v`                         | `select v.sede_id, nullif(trim(v.cuenta_bancaria),'') as cuenta, v.total - coalesce(v.retenciones_total,0) as ingresos, 0::numeric as egresos from ventas v`                         |
| 6   | `coalesce((select sum(v.total) from ventas v where v.sede_id=se.id and v.anulada=false and v.origen='directa' and lower(v.metodo_pago)='efectivo'` | `coalesce((select sum(v.total - coalesce(v.retenciones_total,0)) from ventas v where v.sede_id=se.id and v.anulada=false and v.origen='directa' and lower(v.metodo_pago)='efectivo'` |

Encabezar la migración con este comentario:

```sql
-- El cierre resta las retenciones donde lee el total de una venta de contado.
--
-- SEIS sitios, no dos: ingreso general (1), desglose por sede (2), por metodo
-- de pago (3), por sede y metodo (4), por cuenta bancaria (5) y arqueo de
-- efectivo esperado (6). Tienen que cambiar TODOS a la vez: si se arregla el
-- total y no el desglose, la suma de las sedes deja de dar el total del dia y
-- ese descuadre es peor que el original, porque nadie sabe cual creer.
--
-- El sexto es el mas delicado: es la plata que la vendedora debe tener en el
-- cajon. Sin el, el arqueo daria faltante todos los dias.
--
-- Lo que NO cambia, y es deliberado:
--   * cobros de pagos_cuenta, abonos de OT y abonos_cotizacion: ya son plata
--     real que entro por caja. El cliente que retiene abona el neto, asi que la
--     retencion ya esta descontada. Restarla otra vez seria contarla dos veces.
--   * ventas Mixto en los desgloses 3, 4, 5 y 6: esos sitios excluyen 'Mixto' y
--     leen pagos_venta. fn_registrar_venta garantiza que esos pagos sumen el
--     NETO, asi que ya vienen bien.
--   * por_producto: reparte el ingreso entre los items de detalle_venta. Una
--     retencion no es atribuible a un producto y ese bloque no alimenta ningun
--     total. Restarle algo seria inventar una reparticion.
--   * compras: fase 2.
```

- [ ] **Paso 4: Correr la prueba del paso 2**

Esperado: `ERROR: OK - los seis sitios restan la retencion (se revierte a proposito)`.

- [ ] **Paso 5: Verificar que el histórico no se movió**

Volver a correr la consulta del paso 1. Los seis valores tienen que ser
**idénticos** a los de antes: ninguna venta existente tiene retención, así que
restarles cero no puede cambiar nada. Si algo cambió, un reemplazo tocó una
línea que no debía.

- [ ] **Paso 6: Verificar que no se tocaron los caminos de plata real**

```sql
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
  FROM regexp_matches(pg_get_functiondef('public._fn_cierre_totales(date,date,text)'::regprocedure),
                      'retenciones_total', 'g');
  IF v_n <> 6 THEN RAISE EXCEPTION 'hay % menciones de retenciones_total (esperado 6)', v_n; END IF;
  RAISE EXCEPTION 'OK - exactamente 6 sitios (se revierte a proposito)';
END $$;
```

Esperado: `ERROR: OK - exactamente 6 sitios (se revierte a proposito)`.

- [ ] **Paso 7: Guardar el archivo y commitear**

```bash
git add supabase/migrations/
git commit -m "feat(retenciones): el cierre resta la retencion en los seis sitios del total de venta"
```

---

### Tarea 5: Cuentas por cobrar y el tope de los cobros

Sin esto, cada factura retenida deja un saldo fantasma que el cliente nunca va a
pagar porque ya está en la DIAN — y peor: el **último cobro se rechaza**, porque
`fn_registrar_pago_cuenta` cree que todavía se debe la retención.

**Archivos:**

- Crear: `supabase/migrations/<TS>_retenciones_cuentas_por_cobrar.sql`

- [ ] **Paso 1: Escribir la prueba que falla**

```sql
DO $$
DECLARE
  v_sede text; v_uid uuid; v_prod uuid; v_venta uuid;
  v_saldo numeric; v_ret numeric;
BEGIN
  -- Sede y producto CON STOCK: la venta sin stock esta bloqueada por
  -- trg_venta_descontar_stock y por el CHECK (cantidad >= 0). Elegir un producto
  -- cualquiera haria fallar la prueba por una razon que no tiene que ver con
  -- retenciones.
  SELECT i.sede_id, i.producto_id INTO v_sede, v_prod
    FROM inventario i JOIN productos p ON p.id = i.producto_id
   WHERE i.cantidad >= 5 AND p.activo = true
     AND i.sede_id IN (SELECT id FROM sedes WHERE activa = true)
   ORDER BY i.cantidad DESC LIMIT 1;
  IF v_prod IS NULL THEN RAISE EXCEPTION 'no hay ningun producto con stock para probar'; END IF;
  SELECT id INTO v_uid FROM usuarios WHERE rol = 'Admin' LIMIT 1;

  INSERT INTO ventas (vendedor_id, sede_id, cliente_nombre, metodo_pago, iva_pct,
                      subtotal, total, origen, retefuente_pct)
  VALUES (v_uid, v_sede, 'CLIENTE PRUEBA RETENCION', 'Crédito', 19, 0, 0, 'directa', 2.5)
  RETURNING id INTO v_venta;

  INSERT INTO detalle_venta (venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal)
  VALUES (v_venta, v_prod, 1, 1000000, 0, 1000000);

  SELECT retenciones_total INTO v_ret FROM ventas WHERE id = v_venta;
  IF v_ret <> 25000 THEN RAISE EXCEPTION 'retencion = % (esperado 25000)', v_ret; END IF;

  -- Total facturado 1.190.000, el cliente paga 1.165.000
  SELECT saldo INTO v_saldo FROM v_cuentas_por_cobrar WHERE venta_id = v_venta;
  IF v_saldo <> 1165000 THEN RAISE EXCEPTION 'saldo inicial = % (esperado 1165000)', v_saldo; END IF;

  INSERT INTO pagos_cuenta (tipo, venta_id, monto, metodo_pago, registrado_por)
  VALUES ('cobro', v_venta, 1165000, 'Efectivo', v_uid);

  SELECT saldo INTO v_saldo FROM v_cuentas_por_cobrar WHERE venta_id = v_venta;
  IF v_saldo <> 0 THEN RAISE EXCEPTION 'saldo tras pagar el neto = % (esperado 0)', v_saldo; END IF;

  RAISE EXCEPTION 'OK - el saldo cierra en cero al pagar el neto (se revierte a proposito)';
END $$;
```

Esperado: `ERROR: saldo inicial = 1190000 (esperado 1165000)`.

- [ ] **Paso 2: Aplicar la migración**

Nombre `retenciones_cuentas_por_cobrar`:

```sql
-- El saldo de una factura retenida baja en la retencion desde el momento en que
-- se emite. Esa plata no la va a pagar el cliente: ya la consigno a la DIAN.
--
-- Sin este cambio pasan dos cosas, y la segunda es peor que la primera:
--   1. La factura queda para siempre con un saldo fantasma en Cuentas por Cobrar.
--   2. El ULTIMO cobro se rechaza. fn_registrar_pago_cuenta compara el monto
--      contra total - abonos - pagos, cree que todavia falta la retencion, y
--      responde "el monto supera el saldo pendiente". La factura no se puede
--      cerrar por ningun camino desde la app.
--
-- CREATE OR REPLACE VIEW solo permite AGREGAR columnas al final, no insertarlas
-- en medio, y hay que conservar security_invoker.

CREATE OR REPLACE VIEW public.v_cuentas_por_cobrar
WITH (security_invoker = true) AS
 SELECT v.id AS venta_id,
    v.numero,
    v.fecha,
    v.cliente_nombre,
    v.sede_id,
    v.vendedor_id,
    COALESCE(v.total, 0::numeric) AS total,
    COALESCE(ac.abonos, 0::numeric) AS abonos_cotizacion,
    COALESCE(pc.pagos, 0::numeric) AS pagos_directos,
    COALESCE(v.total, 0::numeric)
      - COALESCE(v.retenciones_total, 0::numeric)
      - COALESCE(ac.abonos, 0::numeric)
      - COALESCE(pc.pagos, 0::numeric) AS saldo,
    COALESCE(v.retenciones_total, 0::numeric) AS retenciones_total
   FROM ventas v
     LEFT JOIN LATERAL ( SELECT sum(a.monto) AS abonos
           FROM abonos_cotizacion a
             JOIN cotizaciones c ON c.id = a.cotizacion_id
          WHERE c.venta_id = v.id) ac ON true
     LEFT JOIN LATERAL ( SELECT sum(p.monto) AS pagos
           FROM pagos_cuenta p
          WHERE p.venta_id = v.id AND p.tipo = 'cobro'::text AND COALESCE(p.anulado, false) = false) pc ON true
  WHERE COALESCE(v.anulada, false) = false AND (v.metodo_pago = 'Crédito'::text OR ac.abonos IS NOT NULL);

-- El tope de un cobro es el saldo NETO, con la misma formula que la vista.
CREATE OR REPLACE FUNCTION public.fn_registrar_pago_cuenta(p_payload jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_rol text;
  v_sede text;
  v_tipo text;
  v_venta record; v_compra record;
  v_monto numeric;
  v_metodo text;
  v_cuenta text;
  v_abonos_cotiz numeric := 0;
  v_pagos numeric := 0;
  v_saldo numeric;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  v_rol  := (select get_my_rol());
  v_sede := (select get_my_sede_id());
  v_tipo := p_payload->>'tipo';

  -- Matriz de rol y tipo. La sede se comprueba mas abajo, cuando ya se sabe a
  -- que sede pertenece la venta o la compra.
  if v_rol not in ('Admin','Vendedor','Bodeguero') then
    raise exception 'No tienes permiso para registrar cobros o pagos';
  end if;
  if v_tipo = 'cobro' and v_rol = 'Bodeguero' then
    raise exception 'Bodega registra pagos a proveedores, no cobros a clientes';
  end if;
  if v_tipo = 'pago' and v_rol = 'Vendedor' then
    raise exception 'Los pagos a proveedores los registra bodega o el administrador';
  end if;

  v_monto  := coalesce(nullif(p_payload->>'monto','')::numeric, 0);
  v_metodo := nullif(trim(p_payload->>'metodo_pago'),'');
  v_cuenta := nullif(trim(p_payload->>'cuenta_bancaria'),'');

  if v_monto <= 0 then raise exception 'El monto debe ser mayor que 0'; end if;
  if v_metodo is null then raise exception 'Falta el método de pago'; end if;
  if v_metodo in ('Transferencia','Tarjeta') and v_cuenta is null then
    raise exception 'Indica la cuenta bancaria para pagos electrónicos';
  end if;

  if v_tipo = 'cobro' then
    select * into v_venta from ventas where id = (p_payload->>'venta_id')::uuid for update;
    if not found then raise exception 'Venta no encontrada'; end if;

    if v_rol <> 'Admin' and v_venta.sede_id is distinct from v_sede then
      raise exception 'Solo puedes registrar cobros de ventas de tu propia sede';
    end if;

    if coalesce(v_venta.anulada, false) then raise exception 'La venta está anulada'; end if;

    select coalesce(sum(a.monto),0) into v_abonos_cotiz
      from abonos_cotizacion a join cotizaciones c on c.id = a.cotizacion_id
      where c.venta_id = v_venta.id;

    if v_venta.metodo_pago is distinct from 'Crédito' and v_abonos_cotiz <= 0 then
      raise exception 'La venta no admite cobros (no es a crédito ni tiene abonos de cotización)';
    end if;

    select coalesce(sum(p.monto),0) into v_pagos
      from pagos_cuenta p
     where p.venta_id = v_venta.id and p.tipo = 'cobro' and coalesce(p.anulado,false) = false;
    -- Lo cobrable es el NETO: la retencion no la paga el cliente, la consigna a
    -- la DIAN. Misma formula que v_cuentas_por_cobrar.saldo.
    v_saldo := coalesce(v_venta.total,0) - coalesce(v_venta.retenciones_total,0)
               - v_abonos_cotiz - v_pagos;
    if v_monto > v_saldo + 0.01 then
      raise exception 'El monto (%) supera el saldo pendiente (%)', v_monto, v_saldo;
    end if;
    insert into pagos_cuenta (tipo, venta_id, monto, metodo_pago, cuenta_bancaria, observaciones, registrado_por)
    values ('cobro', v_venta.id, v_monto, v_metodo, v_cuenta, nullif(trim(p_payload->>'observaciones'),''), v_uid);
    return v_saldo - v_monto;

  elsif v_tipo = 'pago' then
    select * into v_compra from compras where id = (p_payload->>'compra_id')::uuid for update;
    if not found then raise exception 'Compra no encontrada'; end if;

    if v_rol <> 'Admin' and v_compra.sede_destino_id is distinct from v_sede then
      raise exception 'Solo puedes registrar pagos de compras de tu propia sede';
    end if;

    if v_compra.estado = 'cancelada' then raise exception 'La compra está cancelada'; end if;
    if v_compra.metodo_pago is distinct from 'Crédito' then
      raise exception 'La compra no es a crédito';
    end if;
    select coalesce(sum(p.monto),0) into v_pagos
      from pagos_cuenta p
     where p.compra_id = v_compra.id and p.tipo = 'pago' and coalesce(p.anulado,false) = false;
    -- Compras: la retencion siempre vale 0 hasta la fase 2, asi que restarla no
    -- cambia nada hoy y deja el camino listo.
    v_saldo := coalesce(v_compra.total,0) - coalesce(v_compra.retenciones_total,0) - v_pagos;
    if v_monto > v_saldo + 0.01 then
      raise exception 'El monto (%) supera el saldo pendiente (%)', v_monto, v_saldo;
    end if;
    insert into pagos_cuenta (tipo, compra_id, monto, metodo_pago, cuenta_bancaria, observaciones, registrado_por)
    values ('pago', v_compra.id, v_monto, v_metodo, v_cuenta, nullif(trim(p_payload->>'observaciones'),''), v_uid);
    return v_saldo - v_monto;
  else
    raise exception 'tipo inválido (cobro|pago)';
  end if;
end $function$;
```

- [ ] **Paso 3: Correr la prueba del paso 1**

Esperado: `ERROR: OK - el saldo cierra en cero al pagar el neto (se revierte a proposito)`.

- [ ] **Paso 4: Verificar que las cuentas por cobrar de hoy no cambiaron**

```sql
SELECT count(*) AS facturas, coalesce(sum(saldo),0) AS saldo_total
FROM v_cuentas_por_cobrar;
```

Comparar contra el mismo conteo tomado antes de aplicar la migración. Tienen que
coincidir: ninguna venta existente tiene retención.

- [ ] **Paso 5: Comprobar que la vista conservó `security_invoker`**

```sql
SELECT reloptions FROM pg_class WHERE oid = 'public.v_cuentas_por_cobrar'::regclass;
```

Esperado: contiene `security_invoker=true`. Si no, la vista se saltaría la RLS y
cada vendedora vería las cuentas de las otras sedes.

- [ ] **Paso 6: Guardar el archivo y commitear**

```bash
git add supabase/migrations/
git commit -m "feat(retenciones): el saldo por cobrar y el tope de cobro descuentan la retencion"
```

---

### Tarea 6: Las tres compuertas de la OT

Son las que impiden entregar una OT retenida. Sin ellas la funcionalidad no
sirve para OT: el cliente abona el neto, la OT queda "con saldo pendiente" para
siempre y no se puede facturar.

**Archivos:**

- Crear: `supabase/migrations/<TS>_retenciones_compuertas_ot.sql`

- [ ] **Paso 1: Escribir la prueba que falla**

```sql
DO $$
DECLARE
  v_sede text; v_uid uuid; v_ot uuid; v_ret numeric; v_total numeric;
BEGIN
  SELECT id INTO v_sede FROM sedes WHERE activa = true ORDER BY id LIMIT 1;
  SELECT id INTO v_uid  FROM usuarios WHERE rol = 'Admin' LIMIT 1;

  INSERT INTO ordenes_servicio (cliente_nombre, equipo_descripcion, sede_id, creado_por,
                                costo_mano_obra, valor_revision, iva_pct,
                                estado_autorizacion, retefuente_pct)
  VALUES ('CLIENTE PRUEBA RETENCION', 'EQUIPO PRUEBA', v_sede, v_uid,
          900000, 100000, 19, 'autorizado', 4)
  RETURNING id INTO v_ot;

  SELECT total, retenciones_total INTO v_total, v_ret FROM ordenes_servicio WHERE id = v_ot;
  -- base 1.000.000, total 1.190.000, retefuente 4% = 40.000, cobrable 1.150.000
  IF v_total <> 1190000 THEN RAISE EXCEPTION 'total OT = % (esperado 1190000)', v_total; END IF;
  IF v_ret <> 40000 THEN RAISE EXCEPTION 'retencion OT = % (esperado 40000)', v_ret; END IF;

  -- Compuerta 1: el abono por el NETO tiene que pasar el tope
  INSERT INTO abonos (orden_id, monto, metodo_pago, registrado_por)
  VALUES (v_ot, 1150000, 'Efectivo', v_uid);

  RAISE EXCEPTION 'OK - el abono por el neto se acepta (se revierte a proposito)';
END $$;
```

Esperado antes del cambio: el `INSERT` pasa (1.150.000 < 1.190.000), así que
**esta prueba no falla todavía**. La que sí falla es la de la compuerta 2:

```sql
DO $$
DECLARE
  v_sede text; v_uid uuid; v_ot uuid; v_r jsonb;
BEGIN
  SELECT id INTO v_sede FROM sedes WHERE activa = true ORDER BY id LIMIT 1;
  SELECT id INTO v_uid  FROM usuarios WHERE rol = 'Admin' LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  INSERT INTO ordenes_servicio (cliente_nombre, equipo_descripcion, sede_id, creado_por,
                                costo_mano_obra, valor_revision, iva_pct,
                                estado_autorizacion, estado, retefuente_pct)
  VALUES ('CLIENTE PRUEBA RETENCION', 'EQUIPO PRUEBA', v_sede, v_uid,
          900000, 100000, 19, 'autorizado', 'terminada', 4)
  RETURNING id INTO v_ot;

  INSERT INTO abonos (orden_id, monto, metodo_pago, registrado_por)
  VALUES (v_ot, 1150000, 'Efectivo', v_uid);

  -- El cliente ya pago todo lo que le toca: la OT debe poder entregarse
  v_r := public.fn_generar_venta_ot(v_ot);

  RAISE EXCEPTION 'OK - la OT retenida se puede entregar (se revierte a proposito)';
END $$;
```

Esperado: `ERROR: Saldo pendiente: total 1190000 vs abonado 1150000`.

- [ ] **Paso 2: Aplicar la migración**

Nombre `retenciones_compuertas_ot`:

```sql
-- Tres compuertas de la OT miden contra el total facturado. Con retencion, lo
-- cobrable es el NETO: total - retenciones_total. Sin este cambio una OT con
-- retencion NO SE PUEDE ENTREGAR nunca, porque el cliente abona menos de lo que
-- dice la factura y las tres la dan por impaga.
--
-- OJO con el orden en trg_orden_recalcular_total_mo: es un trigger BEFORE, y las
-- columnas generadas se calculan DESPUES de los BEFORE. NEW.retenciones_total
-- todavia no vale nada ahi, asi que hay que recalcularla en linea con las mismas
-- funciones inmutables.

-- Compuerta 1: tope de los abonos ----------------------------------------
CREATE OR REPLACE FUNCTION public.trg_abono_validar_tope()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_total     numeric;
  v_acumulado numeric;
begin
  if NEW.monto is null or NEW.monto <= 0 then
    raise exception 'El monto del abono debe ser mayor que 0';
  end if;
  if TG_OP = 'INSERT' or (TG_OP = 'UPDATE' and NEW.monto > OLD.monto) then
    -- Pesos enteros: el tope se mide contra el total redondeado, consistente
    -- con el frontend (Math.round) y con el input, que solo admite dígitos.
    -- Así el saldo siempre se puede saldar exactamente.
    --
    -- El tope es lo COBRABLE, no lo facturado: si al cliente le retienen, va a
    -- abonar el neto y nunca va a llegar al total.
    select round(coalesce(total, 0), 0) - round(coalesce(retenciones_total, 0), 0)
      into v_total
      from ordenes_servicio where id = NEW.orden_id;
    -- Con la OT aún sin cotizar (total = 0) no hay techo contra el que medir:
    -- se acepta el anticipo, como antes del 2026-07-24. En cuanto la OT tenga
    -- valor, el tope vuelve a aplicarse y un acumulado que se pase se rechaza.
    if v_total > 0 then
      select coalesce(sum(monto), 0) into v_acumulado
        from abonos where orden_id = NEW.orden_id and id <> coalesce(NEW.id, -1);
      if v_acumulado + NEW.monto > v_total + 0.01 then
        raise exception 'El abono haría que el acumulado (%) supere el total cobrable de la OT (%). Registra a lo sumo el saldo pendiente (%).',
          v_acumulado + NEW.monto, v_total, greatest(v_total - v_acumulado, 0);
      end if;
    end if;
  end if;
  return NEW;
end;
$function$;

-- Compuerta 2: la entrega de la OT ---------------------------------------
CREATE OR REPLACE FUNCTION public.fn_generar_venta_ot(p_orden_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v_rol text; v_o ordenes_servicio; v_venta_id uuid;
        v_abonado numeric; v_det record; v_base numeric; v_mo numeric; v_serv_id bigint;
        v_no_aut boolean; v_cobrable numeric;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select get_my_rol() into v_rol;
  if v_rol not in ('Admin','Vendedor') then
    raise exception 'Solo Ventas o Administración pueden facturar y entregar una OT';
  end if;
  select * into v_o from ordenes_servicio where id = p_orden_id for update;
  if not found then raise exception 'OT no encontrada'; end if;
  if v_rol <> 'Admin' and v_o.sede_id <> get_my_sede_id() then
    raise exception 'Sin permiso sobre esta OT';
  end if;
  if v_o.venta_id is not null then raise exception 'La OT ya tiene venta generada'; end if;
  if v_o.estado <> 'terminada' then raise exception 'La OT debe estar TERMINADA para entregar'; end if;
  select coalesce(sum(monto),0) into v_abonado from abonos where orden_id = p_orden_id;
  -- Lo que el cliente tiene que abonar es el NETO. La retencion no la paga el:
  -- la consigna a la DIAN o al municipio a nombre de la empresa.
  v_cobrable := v_o.total - coalesce(v_o.retenciones_total, 0);
  if v_abonado + 0.01 < v_cobrable then
    raise exception 'Saldo pendiente: cobrable % (total % menos retenciones %) vs abonado %',
      v_cobrable, v_o.total, coalesce(v_o.retenciones_total,0), v_abonado;
  end if;
  if v_abonado > v_cobrable + 0.01 then
    raise exception 'No puedes cerrar la OT #%: lo cobrable ($%) quedó por debajo de lo ya abonado ($%). El cliente pagó de más; ajusta los abonos (o reembolsa la diferencia) primero.',
      v_o.numero, to_char(v_cobrable,'FM999G999G999G990'), to_char(v_abonado,'FM999G999G999G990');
  end if;
  v_no_aut := v_o.estado_autorizacion = 'no_autorizado';
  if v_no_aut then
    v_base := coalesce(v_o.valor_revision,0);
  else
    v_base := coalesce(v_o.costo_mano_obra,0) + coalesce(v_o.valor_repuestos,0) + coalesce(v_o.valor_revision,0);
  end if;
  -- Las tarifas de retencion se COPIAN a la venta que genera la OT para que el
  -- documento final las lleve impresas. No se cuentan dos veces: el cierre
  -- excluye origen='ot' de todos los caminos de venta y cuenta los abonos, que
  -- ya vienen netos.
  insert into ventas (sede_id, vendedor_id, cliente_nombre, cliente_id, subtotal, descuento_valor,
                      iva_pct, total, metodo_pago, observaciones, origen, orden_id,
                      retefuente_pct, reteica_pct, reteiva_pct)
  values (v_o.sede_id, v_uid, v_o.cliente_nombre, v_o.cliente_id, v_base,
          case when v_no_aut then 0 else coalesce(v_o.descuento_valor,0) end,
          coalesce(v_o.iva_pct,0), v_o.total, 'Abonos OT', 'Venta generada de OT #'||v_o.numero, 'ot', p_orden_id,
          coalesce(v_o.retefuente_pct,0), coalesce(v_o.reteica_pct,0), coalesce(v_o.reteiva_pct,0))
  returning id into v_venta_id;
  if not v_no_aut then
    for v_det in select * from detalle_orden where orden_id = p_orden_id loop
      insert into detalle_venta (venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal)
      values (v_venta_id, v_det.producto_id, v_det.cantidad, v_det.precio_unitario, v_det.costo_unitario, v_det.subtotal);
    end loop;
  end if;
  v_mo := case when v_no_aut then coalesce(v_o.valor_revision,0)
               else coalesce(v_o.costo_mano_obra,0) + coalesce(v_o.valor_revision,0) end;
  if v_mo > 0 then
    select id into v_serv_id from servicios where nombre = 'Mano de obra / revisión (OT)' limit 1;
    if v_serv_id is null then
      insert into servicios (nombre, precio, iva_pct, activo)
      values ('Mano de obra / revisión (OT)', 0, 0, true)
      returning id into v_serv_id;
    end if;
    insert into detalle_venta (venta_id, servicio_id, descripcion, cantidad, precio_unitario, subtotal)
    values (v_venta_id, v_serv_id,
            case when v_no_aut then 'Revisión / diagnóstico OT #'||v_o.numero
                 else 'Mano de obra / revisión OT #'||v_o.numero end,
            1, v_mo, v_mo);
  end if;
  update abonos set venta_id = v_venta_id where orden_id = p_orden_id;
  perform set_config('cdv.entregando_ot', 'on', true);
  update ordenes_servicio set venta_id = v_venta_id, estado = 'entregada', fecha_entrega = now()
   where id = p_orden_id;
  perform set_config('cdv.entregando_ot', 'off', true);
  return jsonb_build_object('venta_id', v_venta_id, 'total', v_o.total,
                            'retenciones', coalesce(v_o.retenciones_total,0),
                            'cobrable', v_cobrable);
end $function$;

-- Compuerta 3: no dejar el total por debajo de lo abonado ------------------
CREATE OR REPLACE FUNCTION public.trg_orden_recalcular_total_mo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_det_rep numeric; v_base numeric; v_desc numeric; v_abonado numeric; v_anulando boolean;
        v_ret numeric; v_base_ret numeric;
begin
  v_anulando := coalesce(current_setting('cdv.anulando_venta', true), 'off') = 'on';
  if TG_OP = 'UPDATE' and OLD.estado in ('entregada','cancelada') and not v_anulando then
    if NEW.costo_mano_obra is distinct from OLD.costo_mano_obra
       or NEW.valor_repuestos is distinct from OLD.valor_repuestos
       or NEW.valor_revision is distinct from OLD.valor_revision
       or NEW.iva_pct is distinct from OLD.iva_pct
       or NEW.descuento_valor is distinct from OLD.descuento_valor
       or NEW.estado_autorizacion is distinct from OLD.estado_autorizacion
       or NEW.retefuente_pct is distinct from OLD.retefuente_pct
       or NEW.reteica_pct is distinct from OLD.reteica_pct
       or NEW.reteiva_pct is distinct from OLD.reteiva_pct
       or NEW.cliente_nombre is distinct from OLD.cliente_nombre
       or NEW.cliente_telefono is distinct from OLD.cliente_telefono
       or NEW.equipo_descripcion is distinct from OLD.equipo_descripcion
       or NEW.diagnostico is distinct from OLD.diagnostico
       or NEW.trabajo_realizado is distinct from OLD.trabajo_realizado then
      raise exception 'La OT % está % y no admite cambios', OLD.numero, OLD.estado;
    end if;
  end if;
  if TG_OP = 'UPDATE' then
    select coalesce(sum(subtotal),0) into v_det_rep from detalle_orden where orden_id = NEW.id;
    if v_det_rep > 0 and NEW.valor_repuestos is distinct from v_det_rep then
      NEW.valor_repuestos := v_det_rep;
    end if;
  end if;
  if NEW.estado_autorizacion = 'no_autorizado'
     and (TG_OP = 'INSERT' or OLD.estado_autorizacion is distinct from NEW.estado_autorizacion)
     and exists (select 1 from detalle_orden where orden_id = NEW.id) then
    raise exception 'Esta OT tiene repuestos cargados. Quítalos antes de marcarla como no autorizada (el cliente no autorizó la reparación).';
  end if;
  if TG_OP = 'INSERT'
     or NEW.costo_mano_obra is distinct from OLD.costo_mano_obra
     or NEW.valor_repuestos is distinct from OLD.valor_repuestos
     or NEW.valor_revision is distinct from OLD.valor_revision
     or NEW.iva_pct is distinct from OLD.iva_pct
     or NEW.descuento_valor is distinct from OLD.descuento_valor
     or NEW.estado_autorizacion is distinct from OLD.estado_autorizacion
     or NEW.retefuente_pct is distinct from OLD.retefuente_pct
     or NEW.reteica_pct is distinct from OLD.reteica_pct
     or NEW.reteiva_pct is distinct from OLD.reteiva_pct then
    if NEW.estado_autorizacion = 'no_autorizado' then
      NEW.costo_mano_obra := 0; NEW.valor_repuestos := 0;
      v_base := coalesce(NEW.valor_revision,0);
      NEW.total := round(greatest(0, v_base) * (1 + coalesce(NEW.iva_pct,0)/100), 0);
    else
      v_base := coalesce(NEW.costo_mano_obra,0) + coalesce(NEW.valor_repuestos,0) + coalesce(NEW.valor_revision,0);
      v_desc := least(greatest(coalesce(NEW.descuento_valor,0), 0), v_base);
      if v_desc is distinct from NEW.descuento_valor then NEW.descuento_valor := v_desc; end if;
      NEW.total := round(greatest(0, v_base - v_desc) * (1 + coalesce(NEW.iva_pct,0)/100), 0);
    end if;
    if not v_anulando
       and NEW.estado is distinct from 'cancelada'
       and coalesce(current_setting('cdv.recalc_detalle', true), '') <> '1' then
      select coalesce(sum(monto),0) into v_abonado from abonos where orden_id = NEW.id;
      -- NEW.retenciones_total todavia no existe: es GENERATED y se calcula
      -- DESPUES de los triggers BEFORE. Se recalcula aqui con las mismas
      -- funciones inmutables que usa la columna, para no discrepar nunca.
      v_base_ret := public._fn_base_retencion_ot(NEW.estado_autorizacion, NEW.costo_mano_obra,
                      NEW.valor_repuestos, NEW.valor_revision, NEW.descuento_valor);
      v_ret := round(v_base_ret * coalesce(NEW.retefuente_pct,0) / 100)
             + round(v_base_ret * coalesce(NEW.reteica_pct,0) / 100)
             + round(round(v_base_ret * coalesce(NEW.iva_pct,0) / 100) * coalesce(NEW.reteiva_pct,0) / 100);
      if v_abonado > 0 and (NEW.total - v_ret) < v_abonado then
        raise exception 'No puedes dejar lo cobrable ($%) por debajo de lo ya abonado ($%). Ajusta los abonos primero.',
          to_char(NEW.total - v_ret,'FM999G999G999G990'), to_char(v_abonado,'FM999G999G999G990');
      end if;
    end if;
  end if;
  return NEW;
end $function$;
```

- [ ] **Paso 3: Correr las dos pruebas del paso 1**

Esperado en ambas: `ERROR: OK - ... (se revierte a proposito)`.

- [ ] **Paso 4: Comprobar que una OT sin retención se comporta igual que hoy**

```sql
DO $$
DECLARE v_sede text; v_uid uuid; v_ot uuid;
BEGIN
  SELECT id INTO v_sede FROM sedes WHERE activa = true ORDER BY id LIMIT 1;
  SELECT id INTO v_uid  FROM usuarios WHERE rol = 'Admin' LIMIT 1;
  INSERT INTO ordenes_servicio (cliente_nombre, equipo_descripcion, sede_id, creado_por,
                                costo_mano_obra, valor_revision, iva_pct, estado_autorizacion)
  VALUES ('CLIENTE PRUEBA', 'EQUIPO PRUEBA', v_sede, v_uid, 900000, 100000, 19, 'autorizado')
  RETURNING id INTO v_ot;

  -- Sin retencion, el tope sigue siendo el total: un abono de mas se rechaza
  BEGIN
    INSERT INTO abonos (orden_id, monto, metodo_pago, registrado_por)
    VALUES (v_ot, 1190001, 'Efectivo', v_uid);
    RAISE EXCEPTION 'MAL: se acepto un abono por encima del total';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'MAL:%' THEN RAISE; END IF;
  END;

  INSERT INTO abonos (orden_id, monto, metodo_pago, registrado_por)
  VALUES (v_ot, 1190000, 'Efectivo', v_uid);

  RAISE EXCEPTION 'OK - sin retencion el tope sigue siendo el total (se revierte a proposito)';
END $$;
```

Esperado: `ERROR: OK - sin retencion el tope sigue siendo el total (se revierte a proposito)`.

- [ ] **Paso 5: Guardar los archivos y commitear**

```bash
git add supabase/migrations/
git commit -m "feat(retenciones): las compuertas de la OT miden contra lo cobrable, no lo facturado"
```

---

# FASE 1C — La captura

Recién ahora aparece la interfaz. Todo lo de atrás ya sabe manejar retenciones,
así que la primera que se registre va a estar bien contada desde el minuto uno.

---

### Tarea 7: `fn_registrar_venta` acepta las tres tarifas

**Archivos:**

- Crear: `supabase/migrations/<TS>_retenciones_registrar_venta.sql`

- [ ] **Paso 1: Escribir la prueba que falla**

```sql
DO $$
DECLARE
  v_sede text; v_uid uuid; v_prod uuid; v_r jsonb; v_venta uuid;
  v_ret numeric; v_total numeric;
BEGIN
  -- Sede y producto CON STOCK: la venta sin stock esta bloqueada por
  -- trg_venta_descontar_stock y por el CHECK (cantidad >= 0). Elegir un producto
  -- cualquiera haria fallar la prueba por una razon que no tiene que ver con
  -- retenciones.
  SELECT i.sede_id, i.producto_id INTO v_sede, v_prod
    FROM inventario i JOIN productos p ON p.id = i.producto_id
   WHERE i.cantidad >= 5 AND p.activo = true
     AND i.sede_id IN (SELECT id FROM sedes WHERE activa = true)
   ORDER BY i.cantidad DESC LIMIT 1;
  IF v_prod IS NULL THEN RAISE EXCEPTION 'no hay ningun producto con stock para probar'; END IF;
  SELECT id INTO v_uid FROM usuarios WHERE rol = 'Admin' LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  -- Caso 1: metodo simple con retefuente
  v_r := public.fn_registrar_venta(
    p_sede_id => v_sede, p_metodo_pago => 'Efectivo', p_iva_pct => 19,
    p_items => jsonb_build_array(jsonb_build_object(
      'producto_id', v_prod, 'cantidad', 1, 'precio_unitario', 1000000)),
    p_retefuente_pct => 2.5);
  v_venta := (v_r->>'venta_id')::uuid;
  SELECT total, retenciones_total INTO v_total, v_ret FROM ventas WHERE id = v_venta;
  IF v_total <> 1190000 THEN RAISE EXCEPTION 'total = % (esperado 1190000)', v_total; END IF;
  IF v_ret <> 25000 THEN RAISE EXCEPTION 'retencion = % (esperado 25000)', v_ret; END IF;
  IF (v_r->>'retenciones_total')::numeric <> 25000 THEN
    RAISE EXCEPTION 'la RPC no devolvio la retencion'; END IF;

  -- Caso 2: Mixto. Los pagos tienen que sumar el NETO (1.165.000), no el total.
  v_r := public.fn_registrar_venta(
    p_sede_id => v_sede, p_metodo_pago => 'Efectivo', p_iva_pct => 19,
    p_items => jsonb_build_array(jsonb_build_object(
      'producto_id', v_prod, 'cantidad', 1, 'precio_unitario', 1000000)),
    p_retefuente_pct => 2.5,
    p_pagos => jsonb_build_array(
      jsonb_build_object('metodo_pago','Efectivo','monto', 665000),
      jsonb_build_object('metodo_pago','Transferencia','monto', 500000,'cuenta_bancaria','PRUEBA')));
  v_venta := (v_r->>'venta_id')::uuid;
  SELECT coalesce(sum(monto),0) INTO v_total FROM pagos_venta WHERE venta_id = v_venta;
  IF v_total <> 1165000 THEN RAISE EXCEPTION 'pagos suman % (esperado 1165000)', v_total; END IF;

  -- Caso 3: pagos que suman el TOTAL (no el neto) tienen que rechazarse
  BEGIN
    v_r := public.fn_registrar_venta(
      p_sede_id => v_sede, p_metodo_pago => 'Efectivo', p_iva_pct => 19,
      p_items => jsonb_build_array(jsonb_build_object(
        'producto_id', v_prod, 'cantidad', 1, 'precio_unitario', 1000000)),
      p_retefuente_pct => 2.5,
      p_pagos => jsonb_build_array(jsonb_build_object('metodo_pago','Efectivo','monto', 1190000)));
    RAISE EXCEPTION 'MAL: se acepto que los pagos sumaran el total en vez del neto';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'MAL:%' THEN RAISE; END IF;
  END;

  RAISE EXCEPTION 'OK - la RPC captura las tarifas y valida el neto (se revierte a proposito)';
END $$;
```

Esperado: `ERROR: ... fn_registrar_venta(...) does not exist` (no existe con ese parámetro).

- [ ] **Paso 2: Aplicar la migración**

Nombre `retenciones_registrar_venta`. Es la definición vigente de
`fn_registrar_venta` con **cuatro cambios**, todos marcados con `-- RETENCIONES`:

1. tres parámetros nuevos al final de la firma, con `DEFAULT 0` (así los
   llamados que ya existen siguen funcionando sin tocarlos);
2. las tres columnas en el `INSERT INTO ventas`;
3. la validación de Mixto contra el **neto**;
4. la retención en el `jsonb` de retorno.

```sql
-- fn_registrar_venta captura las tres tarifas de retencion.
--
-- Los parametros van AL FINAL y con DEFAULT 0: PostgREST llama por nombre, asi
-- que ningun llamado existente se rompe y una venta sin retencion se comporta
-- exactamente igual que antes.
--
-- La RPC solo guarda los PORCENTAJES. Los valores los calculan las columnas
-- generadas, que no pueden discrepar de la factura.
--
-- El cambio delicado es la validacion de Mixto. Hoy exige que los pagos sumen
-- `total`. Con retencion, el cliente entrega el NETO, y los desgloses del cierre
-- (por metodo, por sede y metodo, por cuenta y arqueo) leen esos pagos para las
-- ventas Mixto. Si sumaran el total, esos cuatro desgloses contarian de mas y
-- dejarian de cuadrar con el ingreso general.
CREATE OR REPLACE FUNCTION public.fn_registrar_venta(
  p_sede_id text,
  p_cliente_nombre text DEFAULT NULL::text,
  p_cliente_nit text DEFAULT NULL::text,
  p_metodo_pago text DEFAULT 'Efectivo'::text,
  p_descuento_pct numeric DEFAULT 0,
  p_observaciones text DEFAULT NULL::text,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_iva_pct numeric DEFAULT 19,
  p_cuenta_bancaria text DEFAULT NULL::text,
  p_descuento_valor numeric DEFAULT NULL::numeric,
  p_domicilio numeric DEFAULT 0,
  p_pagos jsonb DEFAULT NULL::jsonb,
  p_retefuente_pct numeric DEFAULT 0,   -- RETENCIONES
  p_reteica_pct numeric DEFAULT 0,      -- RETENCIONES
  p_reteiva_pct numeric DEFAULT 0       -- RETENCIONES
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_vendedor_id uuid;
  v_mi_sede     text;
  v_mi_rol      text;
  v_venta_id    uuid;
  v_numero      int;
  v_iva         numeric;
  item          jsonb;
  v_prod_id     uuid;
  v_serv_id     bigint;
  v_serv_nombre text;
  v_serv_precio numeric;
  v_cantidad    numeric;
  v_precio      numeric;
  v_precio_cat  numeric;
  v_precio_in   numeric;
  v_costo       numeric;
  pago          jsonb;
  v_pm          text;
  v_pmonto      numeric;
  v_suma        numeric := 0;
  v_total_real  numeric;
  v_tiene_pagos boolean;
  v_cliente_ok  boolean;
  v_rf          numeric;  -- RETENCIONES
  v_ri          numeric;  -- RETENCIONES
  v_riva        numeric;  -- RETENCIONES
  v_neto        numeric;  -- RETENCIONES
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe tener al menos un ítem';
  end if;

  v_vendedor_id := auth.uid();
  if v_vendedor_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  select sede_id, rol::text into v_mi_sede, v_mi_rol
    from usuarios where id = v_vendedor_id;

  if v_mi_rol is null or v_mi_rol not in ('Admin', 'Vendedor') then
    raise exception 'No tienes permiso para registrar ventas (rol %)', coalesce(v_mi_rol, 'desconocido');
  end if;

  if v_mi_rol <> 'Admin' and v_mi_sede is distinct from p_sede_id then
    raise exception 'No puedes vender desde otra sede. Tu sede es %, la sede solicitada es %', v_mi_sede, p_sede_id;
  end if;

  v_tiene_pagos := p_pagos is not null and jsonb_array_length(p_pagos) > 0;
  v_cliente_ok  := nullif(btrim(coalesce(p_cliente_nombre, '')), '') is not null;

  -- S1-10 / S1-09: validaciones del método simple (solo cuando NO hay pagos múltiples).
  if not v_tiene_pagos then
    if lower(btrim(coalesce(p_metodo_pago, ''))) in ('transferencia', 'tarjeta')
       and nullif(btrim(coalesce(p_cuenta_bancaria, '')), '') is null then
      raise exception 'Indica la cuenta bancaria para pagos con % (Transferencia o Tarjeta).', p_metodo_pago;
    end if;
    if lower(btrim(coalesce(p_metodo_pago, ''))) in ('crédito', 'credito')
       and not v_cliente_ok then
      raise exception 'Una venta a crédito necesita un cliente identificado para poder cobrarla.';
    end if;
  end if;

  v_iva := greatest(0, least(100, coalesce(p_iva_pct, 19)));

  -- RETENCIONES: se recortan a [0, 100]. El CHECK de la tabla los rechazaria,
  -- pero un mensaje de constraint no le dice nada a la vendedora.
  v_rf   := greatest(0, least(100, coalesce(p_retefuente_pct, 0)));
  v_ri   := greatest(0, least(100, coalesce(p_reteica_pct, 0)));
  v_riva := greatest(0, least(100, coalesce(p_reteiva_pct, 0)));

  insert into ventas (
    vendedor_id, sede_id, cliente_nombre, cliente_nit,
    metodo_pago, descuento_pct, descuento_valor, domicilio, iva_pct,
    observaciones, subtotal, total, cuenta_bancaria,
    retefuente_pct, reteica_pct, reteiva_pct                          -- RETENCIONES
  ) values (
    v_vendedor_id, p_sede_id, p_cliente_nombre, p_cliente_nit,
    public._fn_metodo_pago_canonico(p_metodo_pago), p_descuento_pct, p_descuento_valor, greatest(0, coalesce(p_domicilio, 0)), v_iva,
    p_observaciones, 0, 0, nullif(btrim(coalesce(p_cuenta_bancaria, '')), ''),
    v_rf, v_ri, v_riva                                                -- RETENCIONES
  )
  returning id, numero into v_venta_id, v_numero;

  for item in select * from jsonb_array_elements(p_items)
  loop
    v_cantidad := (item->>'cantidad')::numeric;
    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Cantidad inválida en un ítem de la venta';
    end if;

    v_precio_in := nullif(item->>'precio_unitario', '')::numeric;
    v_serv_id   := nullif(item->>'servicio_id', '')::bigint;

    if v_serv_id is not null then
      select nombre, precio into v_serv_nombre, v_serv_precio
        from servicios where id = v_serv_id and activo = true;

      if v_serv_nombre is null then
        raise exception 'Servicio % no encontrado o inactivo', v_serv_id;
      end if;

      v_precio := case
        when v_precio_in is not null and v_precio_in >= 0 then v_precio_in
        else v_serv_precio
      end;

      insert into detalle_venta (
        venta_id, producto_id, servicio_id, descripcion,
        cantidad, precio_unitario, costo_unitario, subtotal, precio_catalogo
      ) values (
        v_venta_id, null, v_serv_id, v_serv_nombre,
        v_cantidad, v_precio, 0, v_cantidad * v_precio, v_serv_precio
      );
    else
      v_prod_id := (item->>'producto_id')::uuid;

      select precio_venta, coalesce(costo_promedio, 0)
        into v_precio_cat, v_costo
        from productos where id = v_prod_id and activo = true;

      if v_precio_cat is null then
        raise exception 'Producto % no encontrado o inactivo', v_prod_id;
      end if;

      v_precio := case
        when v_precio_in is not null and v_precio_in >= 0 then v_precio_in
        else v_precio_cat
      end;

      insert into detalle_venta (
        venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal,
        precio_catalogo
      ) values (
        v_venta_id, v_prod_id, v_cantidad, v_precio, v_costo, v_cantidad * v_precio,
        v_precio_cat
      );
    end if;
  end loop;

  -- S1-23: clampar descuento_valor a [0, subtotal] (el trigger ya clampa el total,
  -- usando el mismo greatest/least, por lo que el total queda consistente).
  update ventas
     set descuento_valor = greatest(0, least(descuento_valor, subtotal))
   where id = v_venta_id and descuento_valor is not null;

  if v_tiene_pagos then
    -- RETENCIONES: lo que el cliente entrega es el NETO. Se lee despues del
    -- clamp del descuento para que la columna generada ya este al dia.
    select total, total - coalesce(retenciones_total, 0)
      into v_total_real, v_neto
      from ventas where id = v_venta_id;
    for pago in select * from jsonb_array_elements(p_pagos)
    loop
      v_pm := btrim(coalesce(pago->>'metodo_pago', ''));
      v_pmonto := round(coalesce((pago->>'monto')::numeric, 0));
      if v_pm = '' then raise exception 'Cada pago debe indicar el método'; end if;
      if v_pmonto <= 0 then raise exception 'Cada pago debe tener un monto mayor a 0'; end if;
      -- S1-10: cada pago electrónico exige cuenta bancaria.
      if lower(v_pm) in ('transferencia', 'tarjeta')
         and nullif(btrim(coalesce(pago->>'cuenta_bancaria', '')), '') is null then
        raise exception 'El pago con % requiere indicar la cuenta bancaria.', v_pm;
      end if;
      -- S1-09: un pago a crédito exige cliente identificado.
      if lower(v_pm) in ('crédito', 'credito') and not v_cliente_ok then
        raise exception 'Una venta a crédito necesita un cliente identificado para poder cobrarla.';
      end if;
      insert into pagos_venta (venta_id, metodo_pago, cuenta_bancaria, monto)
      values (v_venta_id, public._fn_metodo_pago_canonico(v_pm), nullif(btrim(coalesce(pago->>'cuenta_bancaria','')), ''), v_pmonto);
      v_suma := v_suma + v_pmonto;
    end loop;
    -- RETENCIONES: contra el NETO, no contra el total facturado.
    if abs(v_suma - coalesce(v_neto,0)) > 1 then
      if v_total_real <> v_neto then
        raise exception 'La suma de los pagos (%) no coincide con lo que el cliente debe entregar (%): el total es % y le retienen %',
          v_suma, v_neto, v_total_real, v_total_real - v_neto;
      else
        raise exception 'La suma de los pagos (%) no coincide con el total de la venta (%)', v_suma, v_total_real;
      end if;
    end if;
    update ventas set metodo_pago = 'Mixto', cuenta_bancaria = null where id = v_venta_id;
  end if;

  return (
    select jsonb_build_object(
      'venta_id', v.id, 'numero', v.numero, 'total', v.total, 'fecha', v.fecha,
      'retenciones_total', coalesce(v.retenciones_total, 0),          -- RETENCIONES
      'neto', v.total - coalesce(v.retenciones_total, 0)              -- RETENCIONES
    ) from ventas v where v.id = v_venta_id
  );
end;
$function$;
```

- [ ] **Paso 3: Correr la prueba del paso 1**

Esperado: `ERROR: OK - la RPC captura las tarifas y valida el neto (se revierte a proposito)`.

- [ ] **Paso 4: Comprobar que la firma vieja sigue sirviendo**

Una venta sin los parámetros nuevos tiene que comportarse igual que ayer.

```sql
DO $$
DECLARE v_sede text; v_uid uuid; v_prod uuid; v_r jsonb; v_ret numeric;
BEGIN
  -- Sede y producto CON STOCK: la venta sin stock esta bloqueada por
  -- trg_venta_descontar_stock y por el CHECK (cantidad >= 0). Elegir un producto
  -- cualquiera haria fallar la prueba por una razon que no tiene que ver con
  -- retenciones.
  SELECT i.sede_id, i.producto_id INTO v_sede, v_prod
    FROM inventario i JOIN productos p ON p.id = i.producto_id
   WHERE i.cantidad >= 5 AND p.activo = true
     AND i.sede_id IN (SELECT id FROM sedes WHERE activa = true)
   ORDER BY i.cantidad DESC LIMIT 1;
  IF v_prod IS NULL THEN RAISE EXCEPTION 'no hay ningun producto con stock para probar'; END IF;
  SELECT id INTO v_uid FROM usuarios WHERE rol = 'Admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  v_r := public.fn_registrar_venta(
    p_sede_id => v_sede, p_metodo_pago => 'Efectivo', p_iva_pct => 19,
    p_items => jsonb_build_array(jsonb_build_object(
      'producto_id', v_prod, 'cantidad', 1, 'precio_unitario', 1000000)));
  IF (v_r->>'total')::numeric <> 1190000 THEN
    RAISE EXCEPTION 'total = % (esperado 1190000)', v_r->>'total'; END IF;
  IF (v_r->>'retenciones_total')::numeric <> 0 THEN
    RAISE EXCEPTION 'retencion = % (esperado 0)', v_r->>'retenciones_total'; END IF;
  RAISE EXCEPTION 'OK - la firma vieja se comporta igual (se revierte a proposito)';
END $$;
```

Esperado: `ERROR: OK - la firma vieja se comporta igual (se revierte a proposito)`.

- [ ] **Paso 5: Verificar que no quedó una sobrecarga huérfana**

`CREATE OR REPLACE` con parámetros nuevos crea una función **distinta** si la
lista de argumentos cambia. Hay que confirmar que solo existe una.

```sql
SELECT pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'fn_registrar_venta';
```

Esperado: **una sola fila**, la de 15 argumentos. Si aparecen dos, hay que
`DROP FUNCTION` la vieja (por su firma exacta de 12 argumentos) y volver a
comprobar; con dos, PostgREST no sabe cuál llamar y la venta falla por
ambigüedad.

- [ ] **Paso 6: Confirmar los permisos**

```sql
SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'fn_registrar_venta';
```

Esperado: `auth = true`, `anon = false`. Si `anon` quedó en `true`, agregar a la
migración `REVOKE EXECUTE ON FUNCTION public.fn_registrar_venta(text,text,text,text,numeric,text,jsonb,numeric,text,numeric,numeric,jsonb,numeric,numeric,numeric) FROM anon;`
y volver a aplicar.

- [ ] **Paso 7: Guardar el archivo y commitear**

```bash
git add supabase/migrations/
git commit -m "feat(retenciones): fn_registrar_venta captura las tarifas y valida el neto en Mixto"
```

---

### Tarea 8: `src/lib/retenciones.js` — la fórmula, una sola vez

Existe para que VentaNueva, OrdenDetalle, el recibo POS y el PDF compartan el
mismo cálculo. Duplicar esta fórmula ya costó caro una vez: en el cambio de
producto estaba repetida entre el modal y el servidor, se corrigió en uno y no
en el otro, y nueve ventas quedaron con el crédito mal.

**Archivos:**

- Crear: `src/lib/retenciones.js`
- Probar: `tests/integration/retenciones.test.js`

- [ ] **Paso 1: Escribir la prueba que falla**

```js
import { describe, it, expect } from "vitest";
import { calcularRetenciones } from "../../src/lib/retenciones";

describe("calcularRetenciones", () => {
  it("sin tarifas devuelve todo en cero y el neto igual al total", () => {
    const r = calcularRetenciones({
      base: 1000000,
      iva: 190000,
      total: 1190000,
    });
    expect(r.retefuente).toBe(0);
    expect(r.reteica).toBe(0);
    expect(r.reteiva).toBe(0);
    expect(r.total).toBe(0);
    expect(r.neto).toBe(1190000);
    expect(r.hay).toBe(false);
  });

  it("retefuente y reteICA van sobre la base, reteIVA sobre el IVA", () => {
    const r = calcularRetenciones({
      base: 1000000,
      iva: 190000,
      total: 1190000,
      retefuentePct: 2.5,
      reteicaPct: 0.69,
      reteivaPct: 15,
    });
    expect(r.retefuente).toBe(25000);
    expect(r.reteica).toBe(6900);
    expect(r.reteiva).toBe(28500);
    expect(r.total).toBe(60400);
    expect(r.neto).toBe(1129600);
    expect(r.hay).toBe(true);
  });

  it("redondea cada retencion por separado, como el servidor", () => {
    // base 333.333 * 2,5% = 8.333,325 -> 8.333
    const r = calcularRetenciones({
      base: 333333,
      iva: 0,
      total: 333333,
      retefuentePct: 2.5,
    });
    expect(r.retefuente).toBe(8333);
    expect(r.total).toBe(8333);
  });

  it("recorta las tarifas fuera de rango en vez de producir basura", () => {
    const r = calcularRetenciones({
      base: 1000000,
      iva: 0,
      total: 1000000,
      retefuentePct: -5,
    });
    expect(r.retefuente).toBe(0);
    const r2 = calcularRetenciones({
      base: 1000000,
      iva: 0,
      total: 1000000,
      retefuentePct: 500,
    });
    expect(r2.retefuente).toBe(1000000);
  });

  it("tolera entradas nulas o vacias sin devolver NaN", () => {
    const r = calcularRetenciones({});
    expect(r.total).toBe(0);
    expect(r.neto).toBe(0);
    expect(Number.isNaN(r.neto)).toBe(false);
    const r2 = calcularRetenciones({
      base: null,
      iva: undefined,
      total: "1190000",
      retefuentePct: "2.5",
    });
    expect(r2.neto).toBe(1190000);
  });

  it("el neto nunca es negativo", () => {
    const r = calcularRetenciones({
      base: 1000000,
      iva: 0,
      total: 1000,
      retefuentePct: 100,
    });
    expect(r.neto).toBe(0);
  });
});
```

- [ ] **Paso 2: Correr la prueba y verla fallar**

```bash
npx vitest run tests/integration/retenciones.test.js
```

Esperado: `Failed to resolve import "../../src/lib/retenciones"`.

- [ ] **Paso 3: Escribir el módulo**

```js
/**
 * Retenciones: retefuente, reteICA y reteIVA.
 *
 * Espejo EXACTO de las columnas generadas de `ventas` y `ordenes_servicio`. Si
 * esta fórmula y la del servidor divergen, la pantalla le promete al cliente un
 * neto distinto del que la caja va a contar.
 *
 * Reglas:
 *   - retefuente y reteICA van sobre la BASE (subtotal menos descuento, sin IVA
 *     y sin domicilio).
 *   - reteIVA va sobre el IVA facturado, no sobre la base.
 *   - cada una se redondea por separado y después se suman, igual que el
 *     servidor. Redondear la suma daría un peso de diferencia.
 *
 * La factura NO se toca: `total`, IVA y subtotal quedan como están. Una
 * retención no modifica la factura; modifica cuánta plata se mueve.
 */

/**
 * Claves de `parametros_sistema` con las tarifas sugeridas. Maritza las edita
 * en Configuración → Parámetros.
 */
export const CLAVES_TARIFA_RETENCION = {
  retefuentePct: "retencion_retefuente_pct",
  reteicaPct: "retencion_reteica_pct",
  reteivaPct: "retencion_reteiva_pct",
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Recorta una tarifa a [0, 100], igual que el CHECK de la tabla. */
const pct = (v) => Math.min(100, Math.max(0, num(v)));

/**
 * @param {object} p
 * @param {number} p.base   subtotal menos descuento, sin IVA ni domicilio
 * @param {number} p.iva    IVA facturado
 * @param {number} p.total  total de la factura (base + IVA + domicilio)
 * @param {number} [p.retefuentePct]
 * @param {number} [p.reteicaPct]
 * @param {number} [p.reteivaPct]
 * @returns {{retefuente:number, reteica:number, reteiva:number, total:number, neto:number, hay:boolean}}
 */
export function calcularRetenciones({
  base = 0,
  iva = 0,
  total = 0,
  retefuentePct = 0,
  reteicaPct = 0,
  reteivaPct = 0,
} = {}) {
  const b = Math.max(0, num(base));
  const i = Math.max(0, num(iva));
  const t = num(total);

  const retefuente = Math.round(b * (pct(retefuentePct) / 100));
  const reteica = Math.round(b * (pct(reteicaPct) / 100));
  const reteiva = Math.round(Math.round(i) * (pct(reteivaPct) / 100));

  const suma = retefuente + reteica + reteiva;
  return {
    retefuente,
    reteica,
    reteiva,
    total: suma,
    neto: Math.max(0, Math.round(t - suma)),
    hay: suma > 0,
  };
}
```

- [ ] **Paso 4: Correr la prueba y verla pasar**

```bash
npx vitest run tests/integration/retenciones.test.js
```

Esperado: `Test Files 1 passed`, `Tests 6 passed`.

- [ ] **Paso 5: Commitear**

```bash
git add src/lib/retenciones.js tests/integration/retenciones.test.js
git commit -m "feat(retenciones): calculo compartido entre ventas, OT y documentos"
```

---

### Tarea 9: El saldo de la OT en el frontend

**Archivos:**

- Modificar: `src/lib/ot-flujo.js:171-212` (`calcularMontos`)
- Probar: `tests/integration/ot-montos.test.js`

- [ ] **Paso 1: Escribir la prueba que falla**

```js
import { describe, it, expect } from "vitest";
import { calcularMontos } from "../../src/lib/ot-flujo";

describe("calcularMontos con retenciones", () => {
  const ot = {
    costo_mano_obra: 900000,
    valor_revision: 100000,
    valor_repuestos: 0,
    descuento_valor: 0,
    iva_pct: 19,
    estado_autorizacion: "autorizado",
  };

  it("sin retencion se comporta exactamente como antes", () => {
    const m = calcularMontos(ot, null, []);
    expect(m.total).toBe(1190000);
    expect(m.retenciones).toBe(0);
    expect(m.cobrable).toBe(1190000);
    expect(m.saldo).toBe(1190000);
  });

  it("el saldo se mide contra lo cobrable, no contra el total", () => {
    const m = calcularMontos({ ...ot, retefuente_pct: 4 }, null, []);
    expect(m.total).toBe(1190000);
    expect(m.retenciones).toBe(40000);
    expect(m.cobrable).toBe(1150000);
    expect(m.saldo).toBe(1150000);
  });

  it("al abonar el neto el saldo cierra en cero", () => {
    const m = calcularMontos({ ...ot, retefuente_pct: 4 }, null, [
      { monto: 1150000 },
    ]);
    expect(m.saldo).toBe(0);
  });

  it("la OT no autorizada retiene solo sobre la revision", () => {
    const m = calcularMontos(
      { ...ot, estado_autorizacion: "no_autorizado", retefuente_pct: 4 },
      null,
      [],
    );
    expect(m.total).toBe(119000);
    expect(m.retenciones).toBe(4000);
    expect(m.cobrable).toBe(115000);
  });

  it("reteIVA va sobre el IVA de la OT, no sobre la base", () => {
    const m = calcularMontos({ ...ot, reteiva_pct: 15 }, null, []);
    expect(m.retenciones).toBe(28500);
    expect(m.cobrable).toBe(1161500);
  });
});
```

- [ ] **Paso 2: Correr la prueba y verla fallar**

```bash
npx vitest run tests/integration/ot-montos.test.js
```

Esperado: `expected undefined to be 0` en `m.retenciones`.

- [ ] **Paso 3: Modificar `calcularMontos`**

En `src/lib/ot-flujo.js`, añadir el import arriba del archivo, junto a los que
ya existan:

```js
import { calcularRetenciones } from "./retenciones";
```

Reemplazar las líneas 196-211 (desde `const total = Math.round(base + iva);`
hasta el `return`) por:

```js
  const total = Math.round(base + iva);
  const anticipos = abonos.reduce((s, a) => s + (Number(a.monto) || 0), 0);

  // Retenciones: la factura sigue diciendo `total`, pero el cliente entrega
  // menos porque el resto lo consigna a la DIAN o al municipio. El saldo se
  // mide contra lo COBRABLE; si se midiera contra el total, la OT nunca se
  // podría entregar. Misma fórmula que las columnas generadas del servidor.
  const ret = calcularRetenciones({
    base,
    iva,
    total,
    retefuentePct: orden.retefuente_pct,
    reteicaPct: orden.reteica_pct,
    reteivaPct: orden.reteiva_pct,
  });
  const cobrable = ret.neto;
  const saldo = Math.max(0, Math.round(cobrable - anticipos));

  return {
    repuestos,
    mano,
    revision,
    descuento,
    ivaPct,
    base,
    iva,
    total,
    retenciones: ret.total,
    retefuente: ret.retefuente,
    reteica: ret.reteica,
    reteiva: ret.reteiva,
    cobrable,
    anticipos,
    saldo,
  };
}
```

- [ ] **Paso 4: Correr la prueba y verla pasar**

```bash
npx vitest run tests/integration/ot-montos.test.js
```

Esperado: `Tests 5 passed`.

- [ ] **Paso 5: Correr toda la suite — no se puede romper nada**

```bash
npm test
```

Esperado: todo en verde. `OrdenHistorial.jsx:208` usa `{ total, saldo }` de esta
misma función, así que si algo se rompió, sale aquí.

- [ ] **Paso 6: Commitear**

```bash
git add src/lib/ot-flujo.js tests/integration/ot-montos.test.js
git commit -m "feat(retenciones): el saldo de la OT se mide contra lo cobrable"
```

---

### Tarea 10: El bloque plegable de retenciones

Un solo componente para venta y OT. Apagado por defecto: **con las retenciones
apagadas la pantalla no cambia en nada**, y ese es el criterio de aceptación más
importante de toda la funcionalidad.

**Archivos:**

- Crear: `src/components/ventas/BloqueRetenciones.jsx`
- Probar: `tests/integration/retenciones-render.test.js`

- [ ] **Paso 1: Escribir la prueba de humo que falla**

Ni el build ni eslint ejecutan un componente. Un error de render pasa las dos y
llega a producción con la pantalla inservible — ya pasó dos veces en este
proyecto (la última, una variable usada antes de declararse en
`ModalCambioProducto`, con build, eslint y 31 pruebas en verde).

```js
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import BloqueRetenciones from "../../src/components/ventas/BloqueRetenciones";

const montar = (props) =>
  renderToStaticMarkup(createElement(BloqueRetenciones, props));

const BASE = {
  base: 1000000,
  iva: 190000,
  total: 1190000,
  valores: { retefuentePct: 0, reteicaPct: 0, reteivaPct: 0 },
  onChange() {},
};

describe("BloqueRetenciones", () => {
  it("no revienta al montarse apagado", () => {
    expect(() => montar(BASE)).not.toThrow();
  });

  it("apagado no muestra ningun campo de porcentaje ni el neto", () => {
    const html = montar(BASE);
    expect(html).toContain("Retenciones");
    expect(html).not.toContain("Neto a recibir");
    expect(html).not.toContain("Retefuente");
  });

  it("abierto muestra las tres retenciones y el neto", () => {
    const html = montar({
      ...BASE,
      abierto: true,
      valores: { retefuentePct: 2.5, reteicaPct: 0.69, reteivaPct: 15 },
    });
    expect(html).toContain("Retefuente");
    expect(html).toContain("ReteICA");
    expect(html).toContain("ReteIVA");
    expect(html).toContain("Neto a recibir");
  });

  it("solo lectura no pinta inputs editables", () => {
    const html = montar({ ...BASE, abierto: true, soloLectura: true });
    expect(html).not.toContain("<input");
  });

  it("aguanta valores nulos sin romperse", () => {
    expect(() =>
      montar({
        base: null,
        iva: null,
        total: null,
        valores: {},
        onChange() {},
      }),
    ).not.toThrow();
  });

  it("monta con tarifas sugeridas sin aplicarlas todavia", () => {
    // La precarga ocurre al pulsar el encabezado, no al montar: apagado sigue
    // significando cero retencion.
    const html = montar({
      ...BASE,
      sugeridas: { retefuentePct: 2.5, reteicaPct: 0.69, reteivaPct: 15 },
    });
    expect(html).toContain("Sin retenciones");
    expect(html).not.toContain("Neto a recibir");
  });
});
```

- [ ] **Paso 2: Correr la prueba y verla fallar**

```bash
npx vitest run tests/integration/retenciones-render.test.js
```

Esperado: `Failed to resolve import ".../BloqueRetenciones"`.

- [ ] **Paso 3: Escribir el componente**

Solo tokens de diseño, nunca colores fijos; los botones que se tocan con guantes
van a 48px de alto.

```jsx
import { useState } from "react";
import { calcularRetenciones } from "../../lib/retenciones";
import { formatCOP } from "../../lib/utils";

/**
 * Bloque plegable de retenciones, compartido por Nueva Venta y la OT.
 *
 * Apagado por defecto: mientras nadie lo abra, la pantalla se ve y se comporta
 * exactamente igual que antes de que esto existiera.
 *
 * Al abrirlo por primera vez las tres se precargan con las tarifas sugeridas de
 * Configuración, para no obligar a la vendedora a saberse los porcentajes de
 * memoria. Si el documento ya trae alguna tarifa, no se pisa.
 *
 * Los porcentajes son editables documento por documento porque las tarifas
 * cambian por ley y por municipio: la app no puede quedar amarrada a un número.
 *
 * @param {object}   p
 * @param {number}   p.base        subtotal menos descuento (sin IVA ni domicilio)
 * @param {number}   p.iva         IVA facturado
 * @param {number}   p.total       total de la factura
 * @param {object}   p.valores     { retefuentePct, reteicaPct, reteivaPct }
 * @param {Function} p.onChange    recibe el objeto de valores completo
 * @param {object}   [p.sugeridas] tarifas de Configuración con que precargar
 * @param {boolean}  [p.abierto]   fuerza el estado abierto (para pruebas)
 * @param {boolean}  [p.soloLectura]
 */
export default function BloqueRetenciones({
  base = 0,
  iva = 0,
  total = 0,
  valores = {},
  onChange,
  sugeridas = null,
  abierto: abiertoInicial = false,
  soloLectura = false,
}) {
  const [abierto, setAbierto] = useState(abiertoInicial);

  const vacio =
    !Number(valores.retefuentePct) &&
    !Number(valores.reteicaPct) &&
    !Number(valores.reteivaPct);

  const alternar = () => {
    const abriendo = !abierto;
    setAbierto(abriendo);
    // Solo al ABRIR y solo si no hay nada puesto: así, si alguien deja las tres
    // en cero a propósito y vuelve a abrir, no se le repone la sugerencia.
    if (abriendo && vacio && sugeridas && !soloLectura) {
      onChange?.({
        retefuentePct: Number(sugeridas.retefuentePct) || 0,
        reteicaPct: Number(sugeridas.reteicaPct) || 0,
        reteivaPct: Number(sugeridas.reteivaPct) || 0,
      });
    }
  };

  const ret = calcularRetenciones({
    base,
    iva,
    total,
    retefuentePct: valores.retefuentePct,
    reteicaPct: valores.reteicaPct,
    reteivaPct: valores.reteivaPct,
  });

  const cambiar = (clave) => (e) => {
    // Coma o punto: en Colombia se escribe "0,69". Se recorta a [0, 100] igual
    // que el CHECK de la tabla, para que nunca se envíe algo que el servidor
    // vaya a rechazar con un mensaje de constraint.
    const crudo = String(e.target.value ?? "").replace(",", ".");
    const n = crudo === "" ? 0 : Number(crudo);
    const limpio = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
    onChange?.({ ...valores, [clave]: limpio });
  };

  const Fila = ({ etiqueta, clave, valor, monto }) => (
    <div className="flex items-center gap-3">
      <label
        className="flex-1 text-[13px]"
        htmlFor={`ret-${clave}`}
        style={{ color: "hsl(var(--foreground))" }}
      >
        {etiqueta}
      </label>
      {soloLectura ? (
        <span
          className="w-20 text-right text-[13px] tabular-nums"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {valor || 0}%
        </span>
      ) : (
        <input
          id={`ret-${clave}`}
          type="text"
          inputMode="decimal"
          value={valor ?? 0}
          onChange={cambiar(clave)}
          className="w-20 rounded-lg border px-2 py-2 text-right text-[13px] tabular-nums"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
            color: "hsl(var(--foreground))",
          }}
          aria-label={`${etiqueta} en porcentaje`}
        />
      )}
      <span
        className="w-28 text-right text-[13px] tabular-nums"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {monto > 0 ? `- ${formatCOP(monto)}` : formatCOP(0)}
      </span>
    </div>
  );

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <button
        type="button"
        onClick={alternar}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        style={{ minHeight: 48, backgroundColor: "hsl(var(--muted) / 0.3)" }}
        aria-expanded={abierto}
      >
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Retenciones
        </span>
        <span
          className="text-[13px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {ret.hay ? `- ${formatCOP(ret.total)}` : "Sin retenciones"}
        </span>
      </button>

      {abierto && (
        <div className="space-y-3 p-4">
          <p
            className="text-[12px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Lo que el cliente descuenta y consigna a la DIAN o al municipio. La
            factura no cambia: solo cambia cuánta plata entra.
          </p>

          <Fila
            etiqueta="Retefuente (sobre la base)"
            clave="retefuentePct"
            valor={valores.retefuentePct}
            monto={ret.retefuente}
          />
          <Fila
            etiqueta="ReteICA (sobre la base)"
            clave="reteicaPct"
            valor={valores.reteicaPct}
            monto={ret.reteica}
          />
          <Fila
            etiqueta="ReteIVA (sobre el IVA)"
            clave="reteivaPct"
            valor={valores.reteivaPct}
            monto={ret.reteiva}
          />

          <div
            className="mt-1 flex items-center justify-between border-t pt-3"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <span
              className="text-[13px]"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Total facturado
            </span>
            <span
              className="text-[13px] tabular-nums"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {formatCOP(total)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span
              className="text-[13px] font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Neto a recibir
            </span>
            <span
              className="text-[15px] font-semibold tabular-nums"
              style={{
                color: ret.hay
                  ? "hsl(var(--warning))"
                  : "hsl(var(--foreground))",
              }}
            >
              {formatCOP(ret.neto)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Paso 4: Correr la prueba y verla pasar**

```bash
npx vitest run tests/integration/retenciones-render.test.js
```

Esperado: `Tests 5 passed`.

Si `formatCOP` no está exportado desde `src/lib/utils.js`, buscar de dónde lo
importa `src/lib/pdf/ventaPOS.js` y usar la misma ruta:
`grep -rn "formatCOP" src/lib/ | head -3`.

- [ ] **Paso 5: Commitear**

```bash
git add src/components/ventas/BloqueRetenciones.jsx tests/integration/retenciones-render.test.js
git commit -m "feat(retenciones): bloque plegable compartido por venta y OT"
```

---

### Tarea 11: Montar el bloque en Nueva Venta

**Archivos:**

- Modificar: `src/pages/ops/VentaNueva.jsx` (totales ~387-406, RPC ~464-500)
- Probar: `tests/integration/retenciones-render.test.js` (se le añaden casos)

- [ ] **Paso 1: Añadir el caso de humo que falla**

Al final de `tests/integration/retenciones-render.test.js`, ANTES del último
`});` del archivo, no dentro de otro `describe`. Los mocks van arriba del todo,
junto a los imports:

```js
// --- al principio del archivo, con los demas imports ---
// import { vi } from "vitest";
// import { MemoryRouter } from "react-router-dom";
//
// vi.mock("../../src/lib/supabase", () => {
//   const q = {
//     select: () => q, eq: () => q, gt: () => q, in: () => q, or: () => q,
//     order: () => q, limit: () => q,
//     range: () => Promise.resolve({ data: [], error: null, count: 0 }),
//     maybeSingle: () => Promise.resolve({ data: null, error: null }),
//     then: (r) => Promise.resolve({ data: [], error: null }).then(r),
//   };
//   return { supabase: { from: () => q, rpc: () => Promise.resolve({ data: [], error: null }) } };
// });
//
// let perfilActual = { rol: "Vendedor", sede_id: "CV", nombre: "Deyanira" };
// vi.mock("../../src/stores/authStore", () => ({
//   get useAuthStore() {
//     const usar = (sel) =>
//       typeof sel === "function" ? sel({ perfil: perfilActual }) : { perfil: perfilActual };
//     usar.getState = () => ({ perfil: perfilActual });
//     usar.setState = () => {};
//     usar.subscribe = () => () => {};
//     return usar;
//   },
// }));

describe("Nueva Venta con el bloque de retenciones", () => {
  it("la pantalla monta y trae el bloque", async () => {
    const VentaNueva = (await import("../../src/pages/ops/VentaNueva")).default;
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(VentaNueva)),
    );
    expect(html).toContain("Retenciones");
  });

  it("como Admin tambien monta", async () => {
    perfilActual = { rol: "Admin", sede_id: "BODEGA", nombre: "Admin Maritza" };
    const VentaNueva = (await import("../../src/pages/ops/VentaNueva")).default;
    expect(() =>
      renderToStaticMarkup(
        createElement(MemoryRouter, null, createElement(VentaNueva)),
      ),
    ).not.toThrow();
  });
});
```

- [ ] **Paso 2: Correr y ver fallar**

```bash
npx vitest run tests/integration/retenciones-render.test.js
```

Esperado: `expected '...' to contain 'Retenciones'`.

- [ ] **Paso 3: Añadir el estado de las tarifas**

En `src/pages/ops/VentaNueva.jsx`, junto a los demás `useState` (cerca de la
línea 86, donde está `descuentoValor`):

```jsx
// Retenciones. Arrancan en cero: mientras nadie abra el bloque, la venta se
// registra exactamente igual que siempre.
const [retenciones, setRetenciones] = useState({
  retefuentePct: 0,
  reteicaPct: 0,
  reteivaPct: 0,
});
```

Y las tarifas sugeridas de Configuración, junto a los demás efectos:

```jsx
// Tarifas sugeridas de Configuración. Solo se usan para precargar el bloque
// cuando la vendedora lo abre; si la consulta falla, el bloque abre en cero y
// ella escribe los porcentajes a mano. No es motivo para bloquear una venta.
const [tarifasSugeridas, setTarifasSugeridas] = useState(null);
useEffect(() => {
  let vivo = true;
  (async () => {
    const { data } = await supabase
      .from("parametros_sistema")
      .select("key, value")
      .in("key", Object.values(CLAVES_TARIFA_RETENCION));
    if (!vivo || !data) return;
    const porClave = Object.fromEntries(
      data.map((r) => [r.key, Number(r.value)]),
    );
    setTarifasSugeridas({
      retefuentePct: porClave[CLAVES_TARIFA_RETENCION.retefuentePct] ?? 0,
      reteicaPct: porClave[CLAVES_TARIFA_RETENCION.reteicaPct] ?? 0,
      reteivaPct: porClave[CLAVES_TARIFA_RETENCION.reteivaPct] ?? 0,
    });
  })();
  return () => {
    vivo = false;
  };
}, []);
```

Y los imports arriba, con los demás:

```jsx
import BloqueRetenciones from "../../components/ventas/BloqueRetenciones";
import { CLAVES_TARIFA_RETENCION } from "../../lib/retenciones";
```

- [ ] **Paso 4: Montar el bloque en la interfaz**

En el resumen de totales, justo DESPUÉS de la línea del total y ANTES del
selector de método de pago (buscar dónde se pinta el total con
`grep -n "formatCOP(total)" src/pages/ops/VentaNueva.jsx`):

```jsx
<BloqueRetenciones
  base={baseIva}
  iva={iva}
  total={total}
  valores={retenciones}
  onChange={setRetenciones}
  sugeridas={tarifasSugeridas}
/>
```

`baseIva` e `iva` ya existen en el componente (líneas 394-395); no hay que
calcular nada nuevo.

- [ ] **Paso 5: Enviarlas a la RPC**

En la llamada a `fn_registrar_venta` (línea ~464), añadir tres claves después de
`p_iva_pct`:

```jsx
        p_retefuente_pct: retenciones.retefuentePct,
        p_reteica_pct: retenciones.reteicaPct,
        p_reteiva_pct: retenciones.reteivaPct,
```

- [ ] **Paso 6: Corregir la validación de Mixto en la pantalla**

Esto es lo que rompe la venta si se olvida: la pantalla exige que las formas de
pago sumen el total, pero el servidor ahora exige que sumen el neto. Si no
coinciden, el botón se habilita y la RPC rechaza.

Reemplazar las líneas 401-406:

```jsx
// Pago mixto: la suma de las formas debe igualar el total (COP, tolerancia 1).
const totalRedondeado = Math.round(total);
const sumaMixto =
  Math.round(Number(pagoEfectivo) || 0) + Math.round(Number(pagoTransfer) || 0);
const mixtoCuadra =
  metodoPago !== "Mixto" || Math.abs(sumaMixto - totalRedondeado) <= 1;
```

por:

```jsx
// Pago mixto: la suma de las formas debe igualar lo que el cliente ENTREGA,
// que con retención es el neto, no el total facturado. Tiene que coincidir
// con fn_registrar_venta: si la pantalla midiera contra el total, habilitaría
// el botón y el servidor rechazaría la venta.
const retencionesCalculadas = calcularRetenciones({
  base: baseIva,
  iva,
  total,
  retefuentePct: retenciones.retefuentePct,
  reteicaPct: retenciones.reteicaPct,
  reteivaPct: retenciones.reteivaPct,
});
const totalRedondeado = retencionesCalculadas.neto;
const sumaMixto =
  Math.round(Number(pagoEfectivo) || 0) + Math.round(Number(pagoTransfer) || 0);
const mixtoCuadra =
  metodoPago !== "Mixto" || Math.abs(sumaMixto - totalRedondeado) <= 1;
```

Y el import correspondiente arriba:

```jsx
import {
  calcularRetenciones,
  CLAVES_TARIFA_RETENCION,
} from "../../lib/retenciones";
```

(una sola linea de import para las dos cosas; reemplaza la del paso 3).

> **Ojo:** `totalRedondeado` se usa en más sitios de la pantalla (el botón que
> rellena el monto restante, por ejemplo). Que ahora valga el neto es lo
> correcto en todos ellos: son la plata que se recibe. Verificar con
> `grep -n "totalRedondeado" src/pages/ops/VentaNueva.jsx` que cada uso siga
> teniendo sentido leído como "lo que el cliente entrega".

- [ ] **Paso 7: Correr las pruebas**

```bash
npx vitest run tests/integration/retenciones-render.test.js && npm test && npm run lint && npm run build
```

Esperado: todo en verde. Las cuatro tienen que pasar; ninguna sola alcanza —
build y lint no ejecutan el componente, y las pruebas de lógica no lo montan.

- [ ] **Paso 8: Commitear**

```bash
git add src/pages/ops/VentaNueva.jsx tests/integration/retenciones-render.test.js
git commit -m "feat(retenciones): capturar retenciones en Nueva Venta"
```

---

### Tarea 12: Montar el bloque en la OT

**Archivos:**

- Modificar: `src/pages/ops/OrdenDetalle.jsx` (resumen de montos y guardado)

- [ ] **Paso 1: Añadir el caso de humo que falla**

En `tests/integration/retenciones-render.test.js`:

```js
describe("OrdenDetalle con retenciones", () => {
  it("monta sin reventar", async () => {
    const OrdenDetalle = (await import("../../src/pages/ops/OrdenDetalle"))
      .default;
    expect(() =>
      renderToStaticMarkup(
        createElement(MemoryRouter, null, createElement(OrdenDetalle)),
      ),
    ).not.toThrow();
  });
});
```

- [ ] **Paso 2: Correr y ver el resultado**

```bash
npx vitest run tests/integration/retenciones-render.test.js
```

Si ya pasa (la pantalla monta hoy), sirve igual: es la red que va a atrapar el
error de render que introduzca el paso siguiente.

- [ ] **Paso 3: Montar el bloque en el panel de cotización**

En `src/pages/ops/OrdenDetalle.jsx`, los imports arriba:

```jsx
import BloqueRetenciones from "../../components/ventas/BloqueRetenciones";
import { CLAVES_TARIFA_RETENCION } from "../../lib/retenciones";
```

Y las tarifas sugeridas, en el mismo componente que monta el panel (el que ya
recibe `montos` y `orden`), junto a sus demas efectos:

```jsx
// Mismas tarifas sugeridas que en Nueva Venta. Si la consulta falla, el
// bloque abre en cero y se escriben a mano: no bloquea la OT.
const [tarifasSugeridas, setTarifasSugeridas] = useState(null);
useEffect(() => {
  let vivo = true;
  (async () => {
    const { data } = await supabase
      .from("parametros_sistema")
      .select("key, value")
      .in("key", Object.values(CLAVES_TARIFA_RETENCION));
    if (!vivo || !data) return;
    const porClave = Object.fromEntries(
      data.map((r) => [r.key, Number(r.value)]),
    );
    setTarifasSugeridas({
      retefuentePct: porClave[CLAVES_TARIFA_RETENCION.retefuentePct] ?? 0,
      reteicaPct: porClave[CLAVES_TARIFA_RETENCION.reteicaPct] ?? 0,
      reteivaPct: porClave[CLAVES_TARIFA_RETENCION.reteivaPct] ?? 0,
    });
  })();
  return () => {
    vivo = false;
  };
}, []);
```

> Si ese componente no importa todavia `useState`/`useEffect` o `supabase`,
> anadirlos: `grep -n "^import" src/pages/ops/OrdenDetalle.jsx | head`.

En el panel donde se cotiza (el que muestra `montos.total` y el saldo, cerca de
la línea 2709), justo antes del bloque "Pago del saldo":

```jsx
<BloqueRetenciones
  base={montos.base}
  iva={montos.iva}
  total={montos.total}
  valores={{
    retefuentePct: orden?.retefuente_pct ?? 0,
    reteicaPct: orden?.reteica_pct ?? 0,
    reteivaPct: orden?.reteiva_pct ?? 0,
  }}
  sugeridas={tarifasSugeridas}
  onChange={(v) =>
    updateOrden({
      retefuente_pct: v.retefuentePct,
      reteica_pct: v.reteicaPct,
      reteiva_pct: v.reteivaPct,
    })
  }
  soloLectura={ro || entregada}
/>
```

`updateOrden` ya existe (línea 324) y refresca la OT al terminar, así que el
saldo se recalcula solo. `ro` y `entregada` ya están en ámbito en ese panel.

- [ ] **Paso 4: Mostrar lo cobrable junto al saldo**

Donde el panel pinta el total y el saldo (línea ~2709), añadir una fila entre
los dos, para que quede claro por qué el saldo no es el total:

```jsx
          ...(montos.retenciones > 0
            ? [
                {
                  l: "Retenciones",
                  v: -montos.retenciones,
                  color: "hsl(var(--warning))",
                },
                { l: "Cobrable", v: montos.cobrable },
              ]
            : []),
```

Insertarlo en el arreglo de filas, después de la del total y antes de la del
saldo. Si no hay retención el arreglo queda idéntico al de hoy.

- [ ] **Paso 5: Correr todo**

```bash
npx vitest run tests/integration/retenciones-render.test.js && npm test && npm run lint && npm run build
```

- [ ] **Paso 6: Commitear**

```bash
git add src/pages/ops/OrdenDetalle.jsx tests/integration/retenciones-render.test.js
git commit -m "feat(retenciones): capturar retenciones en la OT y mostrar lo cobrable"
```

---

# FASE 1D — Los documentos y el cierre de la entrega

---

### Tarea 13: Retenciones en el recibo POS

La tirilla se dibuja en dos pasadas: una mide el alto del papel y otra pinta. Si
solo se añaden líneas al dibujo, **la tirilla sale cortada por abajo** — es
exactamente el modo en que ya falló una vez.

**Archivos:**

- Modificar: `src/lib/pdf/ventaPOS.js` (alto ~120-140, totales ~297-303)
- Probar: `tests/integration/pos-retenciones.test.js`

- [ ] **Paso 1: Escribir la prueba que falla**

```js
import { describe, it, expect } from "vitest";
import { generarVentaPOS } from "../../src/lib/pdf/ventaPOS";

const VENTA_BASE = {
  numero: 1234,
  fecha: "2026-09-05T15:00:00Z",
  sede_id: "CV",
  subtotal: 1000000,
  descuento_valor: 0,
  iva_pct: 19,
  domicilio: 0,
  total: 1190000,
  metodo_pago: "Efectivo",
};

const ITEMS = [
  {
    descripcion: "FILTRO AIRE TORNILLO",
    cantidad: 1,
    precio_unitario: 1000000,
    subtotal: 1000000,
  },
];

const alto = (venta) => {
  const doc = generarVentaPOS({ venta, items: ITEMS, pagos: [] });
  return doc.internal.pageSize.getHeight();
};

describe("recibo POS con retenciones", () => {
  it("una venta sin retencion genera el mismo recibo de siempre", () => {
    expect(() =>
      generarVentaPOS({ venta: VENTA_BASE, items: ITEMS }),
    ).not.toThrow();
  });

  it("una venta con retencion no revienta", () => {
    const v = {
      ...VENTA_BASE,
      retefuente_pct: 2.5,
      retefuente_valor: 25000,
      retenciones_total: 25000,
    };
    expect(() => generarVentaPOS({ venta: v, items: ITEMS })).not.toThrow();
  });

  it("con retencion el papel es MAS LARGO: si no, la tirilla sale cortada", () => {
    const sinRet = alto(VENTA_BASE);
    const conRet = alto({
      ...VENTA_BASE,
      retefuente_pct: 2.5,
      retefuente_valor: 25000,
      reteica_pct: 0.69,
      reteica_valor: 6900,
      reteiva_pct: 15,
      reteiva_valor: 28500,
      retenciones_total: 60400,
    });
    expect(conRet).toBeGreaterThan(sinRet);
  });

  it("sin retencion el alto es identico al de antes de esta funcionalidad", () => {
    const a = alto(VENTA_BASE);
    const b = alto({ ...VENTA_BASE, retenciones_total: 0 });
    expect(a).toBe(b);
  });
});
```

- [ ] **Paso 2: Correr y ver fallar**

```bash
npx vitest run tests/integration/pos-retenciones.test.js
```

Esperado: falla el tercer caso, `expected X to be greater than X`.

- [ ] **Paso 3: Reservar el alto**

En `src/lib/pdf/ventaPOS.js`, junto a las demás reservas de alto (después de
`const anulAlto = venta.anulada ? 6 : 0;`, línea ~110):

```js
// Retenciones: una línea por cada una que exista, más la del neto y su regla.
// Si esto no se reserva, la tirilla sale cortada justo por abajo — la
// medición y el dibujo TIENEN que contar lo mismo.
const nRetenciones =
  (Number(venta.retefuente_valor ?? 0) > 0 ? 1 : 0) +
  (Number(venta.reteica_valor ?? 0) > 0 ? 1 : 0) +
  (Number(venta.reteiva_valor ?? 0) > 0 ? 1 : 0);
const retencionesAlto = nRetenciones > 0 ? nRetenciones * 3.8 + 9 : 0;
```

Y sumarlo en el cálculo de `altura`, dentro del `Math.max`, después de
`anulAlto +`:

```js
      retencionesAlto +
```

- [ ] **Paso 4: Dibujar las líneas**

Después de `fila("TOTAL:", formatCOP(total), true);` (línea ~303):

```js
// Retenciones: solo si las hay. Sin retención el recibo sale idéntico a hoy.
const retFuente = Number(venta.retefuente_valor ?? 0);
const retIca = Number(venta.reteica_valor ?? 0);
const retIva = Number(venta.reteiva_valor ?? 0);
const retTotal = retFuente + retIca + retIva;
if (retTotal > 0) {
  doc.setFontSize(7);
  if (retFuente > 0)
    fila(
      `Retefuente ${Number(venta.retefuente_pct ?? 0)}%:`,
      `-${formatCOP(retFuente)}`,
    );
  if (retIca > 0)
    fila(
      `ReteICA ${Number(venta.reteica_pct ?? 0)}%:`,
      `-${formatCOP(retIca)}`,
    );
  if (retIva > 0)
    fila(
      `ReteIVA ${Number(venta.reteiva_pct ?? 0)}%:`,
      `-${formatCOP(retIva)}`,
    );
  doc.line(MX, y - 1, W - MX, y - 1);
  y += 1;
  doc.setFontSize(8.5);
  fila("NETO:", formatCOP(Math.max(0, Math.round(total - retTotal))), true);
  doc.setFontSize(7);
}
```

- [ ] **Paso 5: Correr las pruebas**

```bash
npx vitest run tests/integration/pos-retenciones.test.js tests/integration/pos-columnas.test.js tests/integration/pos-recibo.test.js
```

Esperado: todas en verde. Las dos últimas ya existían y protegen la estética
actual de la tirilla; si alguna se rompe, el cambio movió algo que no debía.

- [ ] **Paso 6: Commitear**

```bash
git add src/lib/pdf/ventaPOS.js tests/integration/pos-retenciones.test.js
git commit -m "feat(retenciones): el recibo POS muestra las retenciones y el neto"
```

---

### Tarea 14: Retenciones en el PDF carta

**Archivos:**

- Modificar: `src/lib/pdf/reciboPDF.js:233-250`

- [ ] **Paso 1: Añadir el caso a la prueba**

En `tests/integration/pos-retenciones.test.js`:

```js
describe("PDF carta con retenciones", () => {
  it("no revienta con retencion ni sin ella", async () => {
    const { generarReciboPDF } = await import("../../src/lib/pdf/reciboPDF");
    const base = { numero: 1, subtotal: 1000000, iva_pct: 19, total: 1190000 };
    expect(() => generarReciboPDF({ recibo: base, items: [] })).not.toThrow();
    expect(() =>
      generarReciboPDF({
        recibo: {
          ...base,
          retefuente_valor: 25000,
          retefuente_pct: 2.5,
          retenciones_total: 25000,
        },
        items: [],
      }),
    ).not.toThrow();
  });
});
```

Si el nombre exportado no es `generarReciboPDF`, tomarlo de
`grep -n "^export" src/lib/pdf/reciboPDF.js` y ajustar el import y la llamada
(incluida la forma del argumento, que puede no ser `{ recibo, items }`).

- [ ] **Paso 2: Añadir las filas**

En `src/lib/pdf/reciboPDF.js`, después de
`totRow("Total", formatCOP(total), { bold: true, color: INK, labColor: INK });`
(línea ~240) y ANTES de `if (abonosPrev > 0)`:

```js
// Retenciones: lo que el cliente descuenta y consigna a la DIAN o al
// municipio. Solo se imprimen si las hay; sin ellas el recibo sale idéntico.
const retFuente = Number(recibo?.retefuente_valor ?? 0);
const retIca = Number(recibo?.reteica_valor ?? 0);
const retIva = Number(recibo?.reteiva_valor ?? 0);
const retTotal = retFuente + retIca + retIva;
if (retTotal > 0) {
  if (retFuente > 0)
    totRow(
      `Retefuente ${Number(recibo?.retefuente_pct ?? 0)}%`,
      `−${formatCOP(retFuente)}`,
    );
  if (retIca > 0)
    totRow(
      `ReteICA ${Number(recibo?.reteica_pct ?? 0)}%`,
      `−${formatCOP(retIca)}`,
    );
  if (retIva > 0)
    totRow(
      `ReteIVA ${Number(recibo?.reteiva_pct ?? 0)}%`,
      `−${formatCOP(retIva)}`,
    );
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.2);
  doc.line(tLabel, y - 1.5, R, y - 1.5);
  y += 1.5;
  totRow(
    "Neto a recibir",
    formatCOP(Math.max(0, Math.round(total - retTotal))),
    {
      bold: true,
      color: INK,
      labColor: INK,
    },
  );
}
```

- [ ] **Paso 3: Verificar que la consulta trae las columnas nuevas**

El PDF y el POS solo van a mostrar algo si quien los llama trae las columnas.

```bash
grep -rn "generarVentaPOS\|generarReciboPDF" src/pages/ | head
```

En cada sitio que aparezca, revisar el `.select(...)` que carga la venta: si
enumera columnas en vez de usar `*`, hay que añadir `retefuente_pct`,
`retefuente_valor`, `reteica_pct`, `reteica_valor`, `reteiva_pct`,
`reteiva_valor`, `retenciones_total`. Si usa `*`, no hay nada que hacer.

- [ ] **Paso 4: Correr todo**

```bash
npm test && npm run lint && npm run build
```

- [ ] **Paso 5: Commitear**

```bash
git add src/lib/pdf/reciboPDF.js src/pages/ tests/integration/pos-retenciones.test.js
git commit -m "feat(retenciones): el PDF de venta muestra las retenciones y el neto"
```

---

### Tarea 15: Verificación de punta a punta

Nada nuevo se escribe aquí. Es la comprobación de que los cuatro caminos de
plata se comportan como dice el diseño, hecha de una sola vez sobre el sistema
completo. **El invariante que manda: el ingreso del día se mueve exactamente en
lo esperado, ni un peso más.**

- [ ] **Paso 1: Los cuatro caminos, en una sola transacción revertida**

```sql
DO $$
DECLARE
  v_sede text; v_uid uuid; v_prod uuid; v_r jsonb; v_ot uuid; v_venta uuid;
  a1 numeric; a2 numeric; a3 numeric; a4 numeric; a5 numeric;
  s1 numeric; s5 numeric;
  x jsonb;
BEGIN
  -- Sede y producto CON STOCK: la venta sin stock esta bloqueada por
  -- trg_venta_descontar_stock y por el CHECK (cantidad >= 0). Elegir un producto
  -- cualquiera haria fallar la prueba por una razon que no tiene que ver con
  -- retenciones.
  SELECT i.sede_id, i.producto_id INTO v_sede, v_prod
    FROM inventario i JOIN productos p ON p.id = i.producto_id
   WHERE i.cantidad >= 5 AND p.activo = true
     AND i.sede_id IN (SELECT id FROM sedes WHERE activa = true)
   ORDER BY i.cantidad DESC LIMIT 1;
  IF v_prod IS NULL THEN RAISE EXCEPTION 'no hay ningun producto con stock para probar'; END IF;
  SELECT id INTO v_uid FROM usuarios WHERE rol = 'Admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  x := public._fn_cierre_totales(current_date, current_date, NULL);
  a1 := (x->>'ingresos_total')::numeric;
  SELECT coalesce(sum((e->>'productos')::numeric),0) + coalesce(sum((e->>'servicios')::numeric),0)
    INTO s1 FROM jsonb_array_elements(x->'detalle'->'por_sede') e;

  -- CAMINO 1: contado con retencion -> el ingreso sube el NETO
  v_r := public.fn_registrar_venta(
    p_sede_id => v_sede, p_metodo_pago => 'Efectivo', p_iva_pct => 19,
    p_items => jsonb_build_array(jsonb_build_object(
      'producto_id', v_prod, 'cantidad', 1, 'precio_unitario', 1000000)),
    p_retefuente_pct => 2.5);
  x := public._fn_cierre_totales(current_date, current_date, NULL);
  a2 := (x->>'ingresos_total')::numeric;
  IF a2 - a1 <> 1165000 THEN
    RAISE EXCEPTION 'CONTADO: subio % (esperado 1165000)', a2 - a1; END IF;

  -- CAMINO 2: credito con retencion -> el ingreso NO se mueve al facturar
  v_r := public.fn_registrar_venta(
    p_sede_id => v_sede, p_cliente_nombre => 'CLIENTE PRUEBA RETENCION',
    p_metodo_pago => 'Crédito', p_iva_pct => 19,
    p_items => jsonb_build_array(jsonb_build_object(
      'producto_id', v_prod, 'cantidad', 1, 'precio_unitario', 1000000)),
    p_retefuente_pct => 2.5);
  v_venta := (v_r->>'venta_id')::uuid;
  x := public._fn_cierre_totales(current_date, current_date, NULL);
  a3 := (x->>'ingresos_total')::numeric;
  IF a3 <> a2 THEN
    RAISE EXCEPTION 'CREDITO: el ingreso se movio % al facturar (esperado 0)', a3 - a2; END IF;

  -- CAMINO 2b: al cobrar el neto, sube exactamente el neto UNA sola vez
  PERFORM public.fn_registrar_pago_cuenta(jsonb_build_object(
    'tipo','cobro','venta_id', v_venta, 'monto', 1165000, 'metodo_pago','Efectivo'));
  x := public._fn_cierre_totales(current_date, current_date, NULL);
  a4 := (x->>'ingresos_total')::numeric;
  IF a4 - a3 <> 1165000 THEN
    RAISE EXCEPTION 'CREDITO COBRO: subio % (esperado 1165000 - ojo doble resta)', a4 - a3; END IF;
  IF (SELECT saldo FROM v_cuentas_por_cobrar WHERE venta_id = v_venta) <> 0 THEN
    RAISE EXCEPTION 'CREDITO: el saldo no cerro en cero'; END IF;

  -- CAMINO 3: OT con retencion -> el ingreso sube por el ABONO, no por el total
  INSERT INTO ordenes_servicio (cliente_nombre, equipo_descripcion, sede_id, creado_por,
                                costo_mano_obra, valor_revision, iva_pct,
                                estado_autorizacion, estado, retefuente_pct)
  VALUES ('CLIENTE PRUEBA RETENCION', 'EQUIPO PRUEBA', v_sede, v_uid,
          900000, 100000, 19, 'autorizado', 'terminada', 4)
  RETURNING id INTO v_ot;
  INSERT INTO abonos (orden_id, monto, metodo_pago, registrado_por)
  VALUES (v_ot, 1150000, 'Efectivo', v_uid);
  x := public._fn_cierre_totales(current_date, current_date, NULL);
  a5 := (x->>'ingresos_total')::numeric;
  IF a5 - a4 <> 1150000 THEN
    RAISE EXCEPTION 'OT: subio % (esperado 1150000 - ojo doble resta)', a5 - a4; END IF;

  -- CAMINO 3b: la OT retenida se puede entregar y NO vuelve a sumar
  PERFORM public.fn_generar_venta_ot(v_ot);
  x := public._fn_cierre_totales(current_date, current_date, NULL);
  IF (x->>'ingresos_total')::numeric <> a5 THEN
    RAISE EXCEPTION 'OT ENTREGA: el ingreso se movio % al facturar (esperado 0)',
      (x->>'ingresos_total')::numeric - a5; END IF;

  -- INVARIANTE FINAL: la suma de las sedes da el ingreso del dia
  SELECT coalesce(sum((e->>'productos')::numeric),0) + coalesce(sum((e->>'servicios')::numeric),0)
    INTO s5 FROM jsonb_array_elements(x->'detalle'->'por_sede') e;
  IF s5 <> (x->>'ingresos_total')::numeric THEN
    RAISE EXCEPTION 'DESGLOSE: las sedes suman % pero el dia dice %',
      s5, (x->>'ingresos_total')::numeric; END IF;

  RAISE EXCEPTION 'OK - los cuatro caminos se comportan como el diseno (se revierte a proposito)';
END $$;
```

Esperado: `ERROR: OK - los cuatro caminos se comportan como el diseno (se revierte a proposito)`.

Cualquier otro mensaje señala exactamente qué camino falló y por cuánto. Los dos
que dicen "ojo doble resta" son el riesgo principal del diseño: si dan de menos,
la retención se está restando dos veces.

- [ ] **Paso 2: Confirmar que el histórico sigue intacto**

```sql
SELECT
  (SELECT coalesce(sum(total),0) FROM ventas WHERE anulada = false) AS ventas_total,
  (SELECT coalesce(sum(retenciones_total),0) FROM ventas) AS ret_ventas,
  (SELECT count(*) FROM v_cuentas_por_cobrar) AS cxc_filas,
  (SELECT coalesce(sum(saldo),0) FROM v_cuentas_por_cobrar) AS cxc_saldo;
```

Comparar contra la medición del inicio de la Tarea 2. `ret_ventas` debe seguir
en 0 y los otros tres, idénticos.

- [ ] **Paso 3: Advisors de seguridad**

`mcp__supabase__get_advisors` con `type: "security"` y con `type: "performance"`.
Ningún hallazgo nuevo. Prestar atención especial a funciones con `EXECUTE` para
`anon` y a vistas sin `security_invoker`.

- [ ] **Paso 4: La suite completa y el build**

```bash
npm test && npm run lint && npm run build
```

Esperado: todo en verde. La suite parte de 106 pruebas y debe quedar en 106 + las
nuevas (≈24), sin ninguna en rojo.

- [ ] **Paso 5: Verificar que cada migración aplicada tiene su archivo**

Ya pasó que una migración quedara en la base sin archivo en el repo y nadie
pudiera reconstruir el esquema.

```bash
ls supabase/migrations/ | grep -i retencion
```

Cruzar con `mcp__supabase__list_migrations`. Tienen que estar las siete, con el
mismo timestamp y el mismo contenido.

- [ ] **Paso 6: Verificación manual — la única que ninguna prueba puede hacer**

Pedirle al usuario que recorra esto en la app:

1. **Nueva Venta, sin tocar nada.** Tiene que verse y comportarse igual que
   siempre. Registrar una venta normal y confirmar que el total no cambió.
2. **Nueva Venta con retefuente 2,5%.** Abrir el bloque, escribir la tarifa,
   comprobar que el "Neto a recibir" cuadra y registrar. Abrir el recibo POS:
   debe traer la línea de retefuente y el NETO, sin texto encima de otro.
3. **Venta Mixto con retención.** Confirmar que la pantalla pide repartir el
   **neto**, no el total, y que el botón se habilita cuando cuadra.
4. **OT con retención.** Abrir el bloque en la OT, poner una tarifa, ver que el
   saldo baja, abonar el saldo y confirmar que la OT **se puede entregar**.
5. **Cierre del día.** Comprobar que el ingreso bajó justo lo retenido y que la
   suma de las sedes da el total.
6. **Arqueo.** Que el efectivo esperado sea el neto, no el facturado.

- [ ] **Paso 7: Merge y push a los dos repos**

```bash
npm test && npm run build
git checkout main && git merge --no-ff <rama>
git push origin main
git push cdv-cali main
```

---

## Fuera del alcance de la fase 1, a propósito

**Las compras (fase 2).** Las columnas ya existen y valen 0. Falta decidir la
base de cálculo de `compras`, cambiar los dos sitios de `compras.total` en el
cierre y la vista `v_cuentas_por_pagar`. Se monta sobre un cierre ya probado.

**Bases mínimas en UVT.** La norma no obliga a retener por debajo de ciertos
montos. La app no las valida: quien registra decide. Meterlas exige mantener el
valor anual de la UVT y una tabla de topes por concepto.

**Conceptos de retefuente.** Un solo porcentaje editable, no una lista de
conceptos con tarifa propia.

**Certificados de retención.** El documento formal que se le entrega a quien se
le retuvo. Es otra funcionalidad y merece su propio diseño.

---

## Resumen de lo que se toca

| Capa                 | Qué cambia                                               | Tarea |
| -------------------- | -------------------------------------------------------- | ----- |
| Esquema              | 21 columnas nuevas, 4 generadas por tabla en ventas y OT | 2     |
| Funciones inmutables | 3 nuevas, base gravable e IVA                            | 1     |
| Configuración        | 3 filas en `parametros_sistema` + su pantalla            | 3     |
| Cierre               | 6 sitios de `ventas.total`                               | 4     |
| Cuentas por cobrar   | la vista y el tope del cobro                             | 5     |
| OT                   | 3 compuertas que medían contra el total facturado        | 6     |
| RPC de venta         | 3 parámetros y la validación de Mixto contra el neto     | 7     |
| Frontend             | 1 módulo, 1 componente, 4 pantallas                      | 8-12  |
| Documentos           | POS y PDF                                                | 13-14 |

**Lo que NO cambia, y es lo que hace segura la entrega:** `ventas.total`,
`compras.total`, `ordenes_servicio.total`, el IVA, el subtotal, el descuento, y
los caminos del cierre que leen pagos, cobros y abonos. Con las retenciones
apagadas el sistema se comporta exactamente igual que hoy — y cada tarea trae la
medición que lo demuestra.
