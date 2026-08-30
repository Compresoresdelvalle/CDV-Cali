# Plan — Min/max por sede · Reorden→Compras · ABC de insumos

**Fecha:** 2026-08-29 · **Versión:** 2 (revisión a fondo) · **Estado:** IMPLEMENTADO 2026-08-29, rama `feat/reorden-a-compras`, sin merge
**Rama sugerida:** `feat/minmax-sede-abc-insumos`

> **La v2 cambia la recomendación principal de la v1.** La segunda pasada encontró que buena
> parte de lo que iba a construir **ya existe**, que un componente existente **prohíbe
> justamente lo que la clienta pide**, y que había una solución más simple y menos riesgosa
> para el corazón del problema. Ver §0.2.

---

## 0. Lo que encontró la revisión a fondo

### 0.1 Catorce hallazgos nuevos

| #       | Hallazgo                                                                                                                                                                                                                                                         | Impacto                                                                                                                                                                                              |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **N1**  | **El asistente de min/max ya existe**: `fn_sugerir_minmax` + `fn_aplicar_minmax`, con modal en Reorden, demanda a 90 días, min/max sugeridos y chip "Configurado". Parámetros en la tabla `parametros` (lead time 7 días, factor seguridad 1.5, factor máximo 3) | No hay que construir pantalla masiva. Hay que **volver por sede la que ya está**                                                                                                                     |
| **N2**  | **`fn_aplicar_minmax` prohíbe `min = 0`**: `if v_item.min < 1 then raise 'El mínimo de % debe ser al menos 1'`. Y exige `max > min`, así que "sin techo" (`max = 0`) también es imposible                                                                        | **El asistente bloquea literalmente lo que pide la clienta.** Sin tocar esto, la funcionalidad no existe                                                                                             |
| **N3**  | **La demanda de BODEGA es 99,9% traspasos**: 32.943 unidades salieron por traspaso contra 16 por venta en 90 días                                                                                                                                                | Si la demanda por sede sólo cuenta ventas y consumo, **la bodega principal recibiría "mínimo 1" en todo el catálogo**. Consejo catastrófico                                                          |
| **N4**  | **La demanda cuenta ventas anuladas.** La reversa de una anulación se registra como `tipo='ajuste'` positivo, no como `venta` negativa, así que `sum(abs())` sobre `venta` las suma igual                                                                        | 110 unidades infladas en 180 días                                                                                                                                                                    |
| **N5**  | **`min > 0` con `max = 0` alerta pero NUNCA aparece en Reorden.** La vista exige `GREATEST(max - stock, 0) > 0`                                                                                                                                                  | Trampa silenciosa: hoy no ocurre porque los 26 productos tienen ambos, pero en cuanto Maritza ponga un mínimo sin máximo —lo natural— el producto alerta y **no hay forma de pedirlo desde Reorden** |
| **N6**  | **`/admin` está protegido con `RoleGuard roles={["Admin"]}`**: Alertas, Reorden y ABC son sólo de Maritza                                                                                                                                                        | Las vendedoras **no pueden entrar al asistente**. Su único camino es producto por producto                                                                                                           |
| **N7**  | **No hay bitácora de min/max.** Existe `productos_precio_costo_log` para precios, nada para mínimos                                                                                                                                                              | Con vendedoras editando, si las alertas se apagan nadie sabrá quién las apagó                                                                                                                        |
| **N8**  | Un traspaso a una sede que nunca tuvo el producto crea la fila de inventario                                                                                                                                                                                     | Con `min = 0` por defecto entra callada: correcto, pero hay que poder encontrarlas después                                                                                                           |
| **N9**  | **`keyOf = producto_id-sede_id`**: se puede seleccionar el mismo producto en dos sedes                                                                                                                                                                           | **Bug en el código que yo mismo propuse en la v1**: habría creado dos líneas con el mismo `producto_id` en el carrito, y `actualizarCantidad`/`eliminarItem` operan sobre todas las coincidencias    |
| **N10** | **`fn_registrar_compra` recibe una sola sede** y `CompraNueva` manda siempre `perfil.sede_id`                                                                                                                                                                    | Como Reorden es sólo de Maritza (BODEGA), todo lo que se pida para CHV/CV/L3 **aterriza en BODEGA** y necesita traspaso manual. Nadie lo advierte en pantalla                                        |
| **N11** | **Cero compras sin recibir** en toda la base                                                                                                                                                                                                                     | El flujo real recibe de inmediato. **No hace falta inventar seguimiento de "en tránsito"**: sería sobre-ingeniería sobre un problema que no existe                                                   |
| **N12** | **El cron de ABC es mensual** (`0 5 1 * *`)                                                                                                                                                                                                                      | Si la clasificación combinada va a guiar Reorden, una vez al mes puede quedar corto                                                                                                                  |
| **N13** | La pantalla ABC deja elegir periodo, pero `_fn_recalcular_abc_core` está fijo en 90 días                                                                                                                                                                         | Se pueden ver ventas de 180 días junto a una clasificación de 90. Confunde                                                                                                                           |
| **N14** | `fn_sugerir_minmax` tiene **el mismo bug de reversas** que encontré para el ABC                                                                                                                                                                                  | Un repuesto puesto y quitado de una OT infla la demanda para siempre                                                                                                                                 |

### 0.2 Cambio de recomendación: sin tocar el enum

En la v1 propuse un estado nuevo `No aplica` en el enum `estado_stock`. **Retiro esa
propuesta.** Al revisar a fondo encontré una solución mejor en las tres dimensiones que
importan.

El razonamiento: `estado_stock` responde una pregunta física —_¿cuánto hay?_— y la alerta
responde una pregunta de gestión —_¿me importa que no haya?_—. Son dos preguntas distintas y
la v1 las metía en la misma columna. Al separarlas:

- **`estado_stock` se queda como está** (Agotado / Bajo / OK / Sobrestock), sólo que leyendo
  el mínimo de la sede en vez del global.
- **Las pantallas de alerta filtran por `stock_minimo > 0`.** Como el mínimo ahora vive en
  `inventario`, que es la misma tabla que ya consultan, **son dos filtros de una línea**.

Qué se gana:

|                                                             | v1 (enum nuevo)                               | v2 (filtro)                         |
| ----------------------------------------------------------- | --------------------------------------------- | ----------------------------------- |
| Migración del enum y su orden                               | Sí, en migración aparte                       | **No existe**                       |
| Filas a reescribir en el recálculo                          | ~2.900                                        | **~119**                            |
| Riesgo de avalancha de realtime                             | Alto                                          | **Prácticamente nulo**              |
| Cambios en `StatusBadge`, `inventario-ui`, `Inventario.jsx` | Sí                                            | **Ninguno**                         |
| Consultas a modificar                                       | 0                                             | 2 (`Alertas`, `Dashboard`)          |
| Lo que ve la vendedora en Inventario                        | "No aplica" en gris sobre un producto en cero | **"Agotado" en rojo, como siempre** |

Ese último punto es el que más pesa. La vendedora en el mostrador necesita la palabra
**"Agotado"**; "No aplica" es lenguaje de planeación de bodega. La v1 les habría cambiado la
pantalla principal a 8 de los 12 usuarios para resolver un problema que sólo tiene Maritza en
su panel. La v2 no les cambia nada.

**Y si además queremos quitar el mar de rojo**, se hace en el cliente sin tocar la base: como
`stock_minimo` viaja en la misma fila que ya se consulta, la lista puede pintar "Agotado" en
rojo cuando `stock_minimo > 0` y un "Sin existencias" neutro cuando es 0. Cero riesgo de
esquema, y la vendedora sigue viendo la verdad.

---

## Parte 1 — Min/max por sede

### 1.1 Decisiones

1. **Min/max se mudan a `inventario`** (por producto×sede). La columna de `productos` se retira
   en una sesión posterior.
2. **`mínimo = 0` = "esta sede no maneja este producto": no genera alerta**, ni con cantidad 0.
3. **`estado_stock` no cambia de valores.** Las alertas se filtran por `stock_minimo > 0`.
4. **El asistente existente se vuelve por sede** en vez de construir uno nuevo.

### 1.2 Esquema

```sql
ALTER TABLE inventario
  ADD COLUMN IF NOT EXISTS stock_minimo INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_maximo INTEGER NOT NULL DEFAULT 0;

ALTER TABLE inventario
  ADD CONSTRAINT inventario_minmax_no_negativo
    CHECK (stock_minimo >= 0 AND stock_maximo >= 0),
  ADD CONSTRAINT inventario_max_mayor_que_min
    CHECK (stock_maximo = 0 OR stock_maximo >= stock_minimo);

-- N7 — bitácora, espejo de productos_precio_costo_log
CREATE TABLE IF NOT EXISTS inventario_minmax_log (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  producto_id uuid NOT NULL REFERENCES productos(id),
  sede_id text NOT NULL REFERENCES sedes(id),
  min_anterior integer, max_anterior integer,
  min_nuevo integer NOT NULL, max_nuevo integer NOT NULL,
  usuario_id uuid, fecha timestamptz NOT NULL DEFAULT now()
);
```

`NOT NULL DEFAULT 0` es deliberado: una fila nueva entra **callada**. Una alerta falsa entrena
a la gente a ignorar las alertas.

### 1.3 La función — sólo el cuerpo, la firma intacta

**30 funciones** llaman a `fn_actualizar_estado_stock`. Por eso la firma no se toca:

```sql
CREATE OR REPLACE FUNCTION public.fn_actualizar_estado_stock(p_producto_id uuid, p_sede_id text)
RETURNS void LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
DECLARE v_exist INTEGER; v_min INTEGER; v_max INTEGER; v_nuevo estado_stock;
BEGIN
  SELECT CASE WHEN p.vendible THEN i.cantidad ELSE i.cantidad_insumo END,
         COALESCE(i.stock_minimo,0), COALESCE(i.stock_maximo,0)
    INTO v_exist, v_min, v_max
  FROM inventario i JOIN productos p ON p.id = i.producto_id
  WHERE i.producto_id = p_producto_id AND i.sede_id = p_sede_id;

  IF NOT FOUND THEN RETURN; END IF;

  v_nuevo := CASE
    WHEN v_exist <= 0                   THEN 'Agotado'
    WHEN v_min > 0 AND v_exist <= v_min THEN 'Bajo'
    WHEN v_max > 0 AND v_exist >  v_max THEN 'Sobrestock'
    ELSE 'OK'
  END;

  UPDATE inventario SET estado_stock = v_nuevo, updated_at = now()
  WHERE producto_id = p_producto_id AND sede_id = p_sede_id
    AND estado_stock IS DISTINCT FROM v_nuevo;   -- no escribe si no cambió
END $$;
```

Tres cambios respecto de hoy: lee el mínimo de la sede, **corrige el Bug A** (los insumos se
comparan contra `cantidad_insumo`), y no escribe cuando el estado no cambia — lo que reduce el
tráfico de realtime de toda la app, no sólo el de la migración.

### 1.4 El RPC de configuración

`inventario` sólo tiene política de SELECT, así que toda escritura pasa por aquí:

```sql
CREATE OR REPLACE FUNCTION public.fn_definir_minmax(
  p_producto_id uuid, p_sede_id text, p_minimo integer, p_maximo integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $$
DECLARE v_rol text; v_sede text; v_min_ant integer; v_max_ant integer;
BEGIN
  SELECT rol::text, sede_id INTO v_rol, v_sede FROM usuarios WHERE id = auth.uid();

  IF v_rol IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida. Vuelve a iniciar sesión.';
  END IF;
  IF v_rol NOT IN ('Admin','Vendedor','Bodeguero') THEN
    RAISE EXCEPTION 'Tu rol (%) no puede configurar mínimos y máximos. Pídelo a Maritza.', v_rol;
  END IF;
  IF v_rol <> 'Admin' AND p_sede_id IS DISTINCT FROM v_sede THEN
    RAISE EXCEPTION 'Sólo puedes configurar mínimos de tu sede (%). Para % pídelo a Maritza.',
      v_sede, p_sede_id;
  END IF;
  IF p_minimo < 0 OR p_maximo < 0 THEN
    RAISE EXCEPTION 'El mínimo y el máximo no pueden ser negativos.';
  END IF;
  IF p_maximo > 0 AND p_maximo < p_minimo THEN
    RAISE EXCEPTION 'El máximo (%) no puede ser menor que el mínimo (%). Sube el máximo o baja el mínimo.',
      p_maximo, p_minimo;
  END IF;

  SELECT stock_minimo, stock_maximo INTO v_min_ant, v_max_ant
  FROM inventario WHERE producto_id = p_producto_id AND sede_id = p_sede_id;

  INSERT INTO inventario (producto_id, sede_id, cantidad, cantidad_insumo,
                          stock_minimo, stock_maximo)
  VALUES (p_producto_id, p_sede_id, 0, 0, p_minimo, p_maximo)
  ON CONFLICT (producto_id, sede_id) DO UPDATE
    SET stock_minimo = EXCLUDED.stock_minimo,
        stock_maximo = EXCLUDED.stock_maximo,
        updated_at   = now();
  --  ^^ jamás toca `cantidad` ni `cantidad_insumo`: configurar no mueve inventario.

  INSERT INTO inventario_minmax_log (producto_id, sede_id, min_anterior, max_anterior,
                                     min_nuevo, max_nuevo, usuario_id)
  VALUES (p_producto_id, p_sede_id, v_min_ant, v_max_ant, p_minimo, p_maximo, auth.uid());

  PERFORM fn_actualizar_estado_stock(p_producto_id, p_sede_id);
END $$;

REVOKE ALL ON FUNCTION public.fn_definir_minmax(uuid,text,integer,integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_definir_minmax(uuid,text,integer,integer) TO authenticated;
```

La constraint `inventario_producto_id_sede_id_key` ya existe, así que el `ON CONFLICT` es
viable (verificado).

### 1.5 El asistente existente, vuelto por sede (N1, N2, N3, N4, N14)

Ésta es la pieza que la v1 se perdió. Hay que rehacer las dos funciones:

**`fn_sugerir_minmax(p_dias)` → `fn_sugerir_minmax(p_dias, p_sede_id)`**

La demanda pasa a calcularse **por sede** y con la definición correcta de "salida":

```sql
WITH salidas AS (
  SELECT m.sede_id, m.producto_id, SUM(-m.cantidad) AS uds
  FROM movimientos m
  WHERE m.fecha >= now() - (p_dias || ' days')::interval
    AND m.producto_id IS NOT NULL
    AND (  m.tipo IN ('venta','ensamble_consumo','orden_consumo')
        OR (m.tipo = 'traspaso_salida' AND v_incluir_traspasos)        -- N3
        OR (m.tipo = 'devolucion'
            AND m.referencia_tipo IN ('ensamble','orden_servicio')) )  -- N14
    AND NOT (m.tipo = 'venta' AND EXISTS (                             -- N4
          SELECT 1 FROM ventas v WHERE v.id = m.referencia_id AND v.anulada))
  GROUP BY 1, 2
  HAVING SUM(-m.cantidad) > 0
)
```

Tres correcciones en una sola consulta:

- **`traspaso_salida` cuenta como demanda (N3).** Sin esto, BODEGA —que despacha 32.943
  unidades y vende 16— recibiría "mínimo 1" en todo el catálogo. La demanda de una bodega
  central _es_ lo que despacha. Se controla con un parámetro nuevo
  `minmax_incluir_traspasos` (por defecto `true`) en la tabla `parametros`, junto a los tres
  que ya existen.
- **`SUM(-cantidad)` en vez de `SUM(abs(cantidad))` (N14).** Las salidas son negativas; las
  reversas de OT y ensambles son positivas y se restan solas.
- **Ventas anuladas excluidas (N4).** Su reversa es un `ajuste` positivo, no un `venta`
  negativo, así que `abs()` las sumaba igual.

> **Nota sobre el doble colchón:** contar los traspasos hace que BODEGA guarde reserva de lo
> que despacha y que CV guarde reserva de lo que vende y de lo que reenvía. Es cómo funciona
> el inventario en varios niveles y es correcto, aunque implique algo más de stock total.

`stock_minimo_actual`, `stock_maximo_actual` y `ya_configurado` pasan a leerse de
`inventario` para la sede consultada.

> **Ojo:** cambia el `RETURNS TABLE` (entra `sede_id`), así que exige `DROP FUNCTION` +
> `CREATE`, y el modal de Reorden hay que actualizarlo en la misma entrega.

**`fn_aplicar_minmax(p_items)` — quitar el bloqueo (N2)**

```sql
-- ANTES (bloquea lo que pide la clienta):
if v_item.min < 1 then raise exception 'El mínimo de % debe ser al menos 1', v_referencia; end if;
if v_item.max <= v_item.min then raise exception 'El máximo de % debe ser mayor que el mínimo'; end if;

-- DESPUÉS:
--   min = 0  → válido, significa "esta sede no lo maneja"
--   max = 0  → válido, significa "sin techo"
```

Cada ítem del `jsonb` lleva ahora `sede_id`, y en vez de hacer su propio `UPDATE productos`,
**delega en `fn_definir_minmax`**. Así hay **una sola ruta de validación y una sola bitácora**:
si mañana cambia una regla, cambia en un solo sitio y no se puede escapar por la otra puerta.

### 1.6 Corregir la trampa del máximo en Reorden (N5)

`v_sugerencias_reorden` calcula `cantidad_sugerida = GREATEST(max - stock, 0)` y descarta las
filas donde eso da 0. Con `max = 0` ("sin techo"), **todo producto con mínimo pero sin máximo
alerta y no se puede pedir**. Y como la campana de reposición se alimenta de esta misma vista,
tampoco lo contaría.

Solución: cuando no hay techo, el objetivo de reposición es un múltiplo del mínimo, usando el
factor que ya está parametrizado:

```sql
objetivo := CASE WHEN i.stock_maximo > 0
                 THEN i.stock_maximo
                 ELSE i.stock_minimo * <minmax_factor_max, por defecto 3> END
cantidad_sugerida := GREATEST(objetivo - existencias, 0)
```

Reponer justo hasta el mínimo no sirve: la fila volvería a quedar en "Bajo" el mismo día,
porque la comparación es `<=`.

### 1.7 Interfaz

**Vendedoras y bodegueros — en `ProductoDetalle`.** Es la única pantalla de inventario a la
que llegan (N6: `/admin` es sólo de Maritza). En la tabla de existencias por sede que ya
existe, cada fila gana un botón "Configurar"; **sólo la fila de su sede lo tiene**, las demás
muestran el valor en gris. Nunca se ofrece un botón que va a fallar.

**Maritza — el asistente de Reorden, ahora con selector de sede.** Ya tiene demanda, sugeridos
y el chip "Configurado". Sólo hay que añadirle el selector y que el "Aplicar seleccionados"
mande la sede.

**`ProductoForm`** pierde los campos globales, con una nota que remite a la tabla por sede.

**Las dos consultas de alerta** (`Alertas.jsx:208/227` y `Dashboard.jsx:102`) suman
`.gt("stock_minimo", 0)`.

**Banner de transición en Alertas**, sólo para Maritza: _"X productos de esta sede no tienen
mínimo configurado y por eso no generan alerta. Configurarlos →"_. `Reorden.jsx:90` ya calcula
ese número; se reusa con el filtro nuevo.

### 1.7-b Pantalla `/ops/minimos` — edición masiva para la sede propia

**Aprobada el 2026-08-29.** Sin esto, una vendedora que quiera configurar 80 productos tendría
que abrir 80 fichas. La pantalla vive en `/ops` (no en `/admin`) porque `/admin` es sólo de
Maritza (N6).

**Consecuencia que no era obvia:** `fn_sugerir_minmax` y `fn_aplicar_minmax` son **Admin-only
hoy** (`if v_rol is distinct from 'Admin' then raise`). Para que la vendedora vea sugerencias
y guarde en lote, las dos tienen que aceptar `Vendedor` y `Bodeguero` **forzando su sede**,
igual que `fn_definir_minmax`. No basta con crear la pantalla: sin esto se le ofrecería un
botón que falla, que es justo lo que el proyecto prohíbe.

| Rol       | Qué ve                             | Qué edita    |
| --------- | ---------------------------------- | ------------ |
| Admin     | Selector de sede, las 4            | Todas        |
| Vendedor  | Su sede, sin selector              | Sólo su sede |
| Bodeguero | BODEGA, sin selector               | Sólo BODEGA  |
| Técnico   | No entra (fuera de `ROLE_MODULES`) | —            |

**Contenido de cada fila:** referencia, nombre, existencias, mínimo y máximo actuales, mínimo
y máximo sugeridos (del asistente, por sede), y el estado. Edición en línea de los dos
números, con guardado en lote.

**Filtros:** búsqueda con el debounce de 400 ms que ya usa Inventario, categoría, clasificación
ABC, y dos atajos que son los que de verdad se usan: **"sin configurar"** y **"con movimiento
en 90 días"** — que juntos responden "¿qué me falta por configurar de lo que sí muevo?".

**Rendimiento:** una sede tiene ~1.400 filas de inventario. Paginación y búsqueda en el
servidor con `ilike`, reusando el patrón de `inventarioStore`. Nada de traer todo al cliente.

**Guardado en lote:** `fn_aplicar_minmax` recorre los ítems y delega en `fn_definir_minmax`,
que por cada uno escribe la bitácora y recalcula el estado. Con 200 filas eso son 200
recálculos: **tope de 200 ítems por llamada** y barra de progreso si se seleccionan más. Sin
tope, un "seleccionar todo" sobre 1.400 filas dejaría la petición colgada.

**Móvil:** tarjetas en vez de tabla, `NumeroInput` para los dos campos, botones de 48 px.

**Aplicar sugeridos:** botón "usar el sugerido" por fila y para la selección, que es lo que
convierte la pantalla en algo de dos minutos en vez de dos horas.

```gherkin
Escenario: Vendedora configura su sede en lote
  Dado que Deyanira es Vendedor de CV
  Cuando abre /ops/minimos
  Entonces no ve selector de sede y la lista es de CV
  Y puede filtrar por "sin configurar" y "con movimiento en 90 días"
  Cuando selecciona 30 productos y pulsa "usar el sugerido"
  Entonces se guardan los 30 con sus min/max sugeridos para CV
  Y cada uno queda registrado en inventario_minmax_log

Escenario: Vendedora pide sugerencias y el servidor no la rechaza
  Cuando la pantalla llama a fn_sugerir_minmax para su sede
  Entonces responde con las sugerencias de CV
  Y no falla con "Solo Admin puede ver las sugerencias de min/max"
  # Sin relajar el rol, la pantalla nace rota

Escenario: Vendedora intenta guardar para otra sede
  Cuando manda un lote con sede_id = 'CHV'
  Entonces falla con el mensaje de sede de fn_definir_minmax
  Y no se guarda ninguno de los ítems del lote

Escenario: Selección de más de 200 productos
  Cuando selecciona 1.400 con "seleccionar todo"
  Entonces se guarda por tandas de 200 con progreso visible
  Y no queda una petición colgada

Escenario: Técnico intenta entrar
  Entonces no ve la opción en el menú y la ruta lo devuelve

Escenario: Admin usa la misma pantalla
  Entonces ve el selector de sede y puede configurar las cuatro
```

### 1.8 Migración

Sin enum nuevo, son **tres pasos** y ninguno bloquea al anterior:

| #   | Migración                            | Contenido                                                                                                                                                             |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `..._inventario_minmax_columnas.sql` | Columnas + CHECKs + tabla de bitácora + copia de los 26 productos a sus 91 filas                                                                                      |
| 2   | `..._fn_minmax_por_sede.sql`         | `fn_actualizar_estado_stock` nueva + `fn_definir_minmax` + `fn_sugerir_minmax` + `fn_aplicar_minmax` + `v_sugerencias_reorden` + parámetro `minmax_incluir_traspasos` |
| 3   | `..._recalculo_estado_stock.sql`     | Recálculo por lotes                                                                                                                                                   |

```sql
-- Paso 1, copia de datos
UPDATE inventario i SET
  stock_minimo = COALESCE(p.stock_minimo,0),
  stock_maximo = COALESCE(p.stock_maximo,0)
FROM productos p
WHERE p.id = i.producto_id
  AND (COALESCE(p.stock_minimo,0) > 0 OR COALESCE(p.stock_maximo,0) > 0);
```

**El recálculo ya no es peligroso.** Con la regla física intacta, sólo cambian de estado las
filas cuyo mínimo cambió (91) más las 28 de insumos mal marcados: **~119 filas, no 2.900**. Aun
así se hace por lotes, porque `inventario` está publicada en realtime:

```sql
DO $$
DECLARE r RECORD; n INT := 0;
BEGIN
  FOR r IN SELECT producto_id, sede_id FROM inventario ORDER BY producto_id LOOP
    PERFORM fn_actualizar_estado_stock(r.producto_id, r.sede_id);
    n := n + 1;
    IF n % 250 = 0 THEN PERFORM pg_sleep(0.4); END IF;
  END LOOP;
END $$;
```

**Paso 4, en otra sesión:** retirar `productos.stock_minimo`/`stock_maximo` y el trigger
`trg_productos_recalc_estado_stock`. **Nunca el mismo día.** El service worker de la PWA puede
estar sirviendo el bundle viejo horas después del deploy; ese bundle pide las columnas y si ya
no existen, Inventario, Alertas, Dashboard y Reorden se caen a la vez.

### 1.9 Frontend a tocar

| Archivo                                 | Qué cambia                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/pages/ops/ProductoDetalle.jsx`     | Min/max por sede en la tabla + botón Configurar por fila                                     |
| `src/pages/admin/Reorden.jsx`           | Selector de sede en el asistente; `.eq("producto.stock_minimo",0)` → `.eq("stock_minimo",0)` |
| `src/pages/admin/Alertas.jsx`           | `.gt("stock_minimo", 0)` en las dos consultas + banner                                       |
| `src/pages/admin/Dashboard.jsx`         | `.gt("stock_minimo", 0)`                                                                     |
| `src/components/forms/ProductoForm.jsx` | Quitar los campos globales                                                                   |
| `src/stores/inventarioStore.js`         | Leer min/max de `inventario`                                                                 |
| `src/pages/ops/Inventario.jsx`          | _(opcional)_ "Agotado" rojo si `stock_minimo > 0`, "Sin existencias" neutro si es 0          |

| `src/pages/ops/Minimos.jsx` **(nuevo)** | Pantalla de edición masiva por sede propia (§1.7-b) |
| `src/App.jsx` + `src/lib/constants.js` | Ruta `/ops/minimos` y entrada en `ROLE_MODULES` para Admin, Vendedor y Bodeguero |

`StatusBadge` e `inventario-ui.js` **no se tocan**.

### 1.10 Escenarios Gherkin — Parte 1

```gherkin
# ─────────── Permisos ───────────

Escenario: Vendedora configura su propia sede
  Dado que Bladimir es Vendedor de CHV
  Cuando define mínimo 3 para "FIL-1020" en CHV
  Entonces se guarda y el estado de esa fila se recalcula

Escenario: Vendedora ve las otras sedes pero no puede tocarlas
  Cuando abre "FIL-1020" y mira la fila de CV
  Entonces el botón "Configurar" NO aparece en esa fila
  Y ve el mínimo de CV en gris, de sólo lectura

Escenario: Vendedora intenta otra sede saltándose la interfaz
  Cuando llama al RPC con p_sede_id = 'CV'
  Entonces falla con "Sólo puedes configurar mínimos de tu sede (CHV). Para CV pídelo a Maritza."
  Y no se modifica ninguna fila

Escenario: Técnico intenta configurar
  Entonces falla con "Tu rol (Técnico) no puede configurar mínimos y máximos. Pídelo a Maritza."

Escenario: Escritura directa por REST
  Cuando hace PATCH a /rest/v1/inventario con stock_minimo=99
  Entonces RLS lo rechaza: inventario sólo tiene política de SELECT

Escenario: Vendedora no puede entrar al asistente masivo          # N6
  Cuando Sofía navega a /admin/reorden
  Entonces RoleGuard la devuelve
  Y su camino es ProductoDetalle, producto por producto

# ─────────── La regla de alerta ───────────

Escenario: Mínimo 0 no alerta aunque no haya existencias
  Dado un producto con mínimo 0 y cantidad 0 en L3
  Entonces la fila NO aparece en Alertas ni en el Dashboard
  Y en Inventario sigue diciendo "Agotado", que es la verdad física
  # Ésta es la diferencia clave con la v1

Escenario: Mínimo mayor que 0 sigue alertando en rojo
  Dado un producto con mínimo 3 y cantidad 0 en CHV
  Entonces el estado es "Agotado" y sí aparece en Alertas

Escenario: Frontera exacta del mínimo
  Dado mínimo 3 y cantidad 3
  Entonces el estado es "Bajo"          # <= inclusivo, igual que hoy

Escenario: Máximo 0 significa sin techo
  Dado mínimo 2, máximo 0 y cantidad 9.999
  Entonces el estado es "OK", nunca "Sobrestock"

Escenario: Frontera exacta del máximo
  Dado máximo 10 y cantidad 10 → "OK"
  Y con cantidad 11 → "Sobrestock"

Escenario: Insumo con existencias deja de decir Agotado          # Bug A
  Dado vendible = false, cantidad = 0, cantidad_insumo = 40, mínimo 5
  Entonces el estado es "OK", no "Agotado"
  # Hoy hay 28 filas exactamente así

Escenario: Insumo realmente agotado sigue alertando
  Dado vendible = false, cantidad_insumo = 0, mínimo 5
  Entonces el estado es "Agotado"

Escenario: Producto vendible con existencias sólo como insumo
  Dado vendible = true, cantidad = 0, cantidad_insumo = 50
  Entonces el estado es "Agotado"
  # Correcto: como artículo de venta no hay nada que vender

# ─────────── La trampa del máximo ───────────

Escenario: Mínimo sin máximo sí se puede pedir                   # N5
  Dado un producto con mínimo 5, máximo 0 y cantidad 1 en CV
  Cuando se abre Reorden
  Entonces la fila aparece con cantidad sugerida 14 (5×3 − 1)
  Y la campana de reposición la cuenta
  # Sin el arreglo, alertaría y sería imposible pedirla

Escenario: Reponer no deja el producto otra vez en Bajo
  Dado mínimo 5, máximo 0, cantidad 1
  Cuando se recibe la cantidad sugerida
  Entonces la cantidad queda en 15, por encima del mínimo
  Y no vuelve a alertar el mismo día

# ─────────── Integridad del inventario ───────────

Escenario: Configurar un mínimo jamás altera las existencias
  Dado cantidad 17 en BODEGA
  Cuando Maritza define mínimo 5 y máximo 20
  Entonces cantidad sigue en 17, cantidad_insumo no cambia
  Y no se inserta ninguna fila en movimientos

Escenario: Configurar un producto que esa sede nunca ha tenido
  Dado que "FIL-1020" no tiene fila de inventario en L3
  Cuando Sofía define mínimo 2 en L3
  Entonces se crea la fila con cantidad 0 y cantidad_insumo 0
  Y el estado queda "Agotado", porque mínimo 2 > 0
  Y no se registra ningún movimiento de stock

Escenario: Mínimo negativo
  Entonces falla con "El mínimo y el máximo no pueden ser negativos."
  Y el CHECK lo bloquearía igual si el RPC fallara

Escenario: Máximo menor que el mínimo
  Cuando se envía mínimo 10 y máximo 3
  Entonces falla con "El máximo (3) no puede ser menor que el mínimo (10)..."

Escenario: Venta concurrente mientras se configura
  Entonces la venta toma su FOR UPDATE y termina primero
  Y el recálculo se aplica sobre la cantidad ya actualizada
  # fn_definir_minmax no toca `cantidad`: no compite por ese valor

Escenario: Queda registro de quién apagó una alerta              # N7
  Dado que una vendedora baja un mínimo de 5 a 0
  Cuando Maritza pregunta por qué dejó de alertar
  Entonces inventario_minmax_log tiene fecha, usuario y valores anterior y nuevo

Escenario: Traspaso a una sede nueva entra callado                # N8
  Dado que BODEGA despacha 10 unidades a una sede que nunca tuvo el producto
  Entonces se crea la fila con mínimo 0 y no alerta
  Y aparece en el contador de "productos con movimiento sin mínimo configurado"

# ─────────── El asistente ───────────

Escenario: BODEGA no recibe mínimo 1 en todo el catálogo         # N3
  Dado que BODEGA despachó 32.943 unidades por traspaso y vendió 16
  Cuando se piden sugerencias para BODEGA
  Entonces la demanda incluye los traspasos de salida
  Y los mínimos sugeridos reflejan lo que la bodega despacha

Escenario: Se puede excluir los traspasos si se quiere
  Dado el parámetro minmax_incluir_traspasos en false
  Entonces la demanda de BODEGA cae y los sugeridos bajan
  # Queda como perilla, no como decisión enterrada en el código

Escenario: Una venta anulada no infla la demanda                 # N4
  Dado una venta de 10 unidades que después se anuló
  Entonces esas 10 unidades no cuentan como demanda
  # Su reversa es un 'ajuste' positivo, no un 'venta' negativo

Escenario: Un repuesto puesto y quitado de una OT no infla       # N14
  Entonces su aporte neto a la demanda es 0

Escenario: El asistente ya permite mínimo 0                      # N2
  Cuando Maritza selecciona un producto y lo aplica con mínimo 0
  Entonces se guarda
  Y antes fallaba con "El mínimo de X debe ser al menos 1"

Escenario: El asistente ya permite máximo 0
  Cuando aplica mínimo 5 y máximo 0
  Entonces se guarda como "sin techo"
  Y antes fallaba con "El máximo debe ser mayor que el mínimo"

Escenario: El asistente y el detalle validan igual
  Dado que fn_aplicar_minmax delega en fn_definir_minmax
  Cuando se intenta un valor inválido por cualquiera de las dos vías
  Entonces el mensaje de error es el mismo
  Y la bitácora registra ambas

# ─────────── Migración y regresión ───────────

Escenario: Los 26 productos configurados no pierden su mínimo
  Entonces sus 91 filas heredan el mínimo en todas sus sedes
  Y sus alertas actuales se mantienen

Escenario: El recálculo casi no mueve filas
  Cuando corre sobre las 5.624 filas
  Entonces sólo cambian de estado ~119
  Y las demás no generan evento de realtime

Escenario: La migración se corre dos veces
  Entonces IF NOT EXISTS y la copia idempotente no fallan

Escenario: Tablet con el bundle viejo tras el deploy
  Entonces las columnas de productos todavía existen y las consultas funcionan
  # Por eso el DROP va días después

Escenario: Las 30 funciones que mueven stock siguen sirviendo
  Dado que la firma fn_actualizar_estado_stock(uuid, text) no cambió
  Entonces ninguna necesitó modificarse

Escenario: La vendedora no nota el cambio en Inventario
  Cuando abre Inventario el día del despliegue
  Entonces ve exactamente los mismos badges que ayer
  # Ésta es la ganancia grande de la v2 sobre la v1

Escenario: Vender sigue sin poder dejar el inventario en negativo
  Entonces se bloquea igual que antes
```

### 1.11 Riesgos de la Parte 1

| #   | Riesgo                                                                                     | Gravedad                  | Mitigación                                                   |
| --- | ------------------------------------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------ |
| R1  | Dropear las columnas viejas antes de que todos tengan el bundle nuevo → 4 pantallas caídas | **Alta**                  | El DROP va en una sesión posterior                           |
| R2  | Cambio de firma de `fn_sugerir_minmax` sin actualizar el modal                             | Media                     | Van en la misma entrega; probar el asistente antes del merge |
| R3  | La avalancha de realtime del recálculo                                                     | **Baja** (era Alta en v1) | ~119 filas + lotes de 250 + `IS DISTINCT FROM`               |
| R4  | Alertas caen de ~3.000 a ~100 y se lee como "se dañó"                                      | Media                     | Banner de transición. Sólo lo ve Maritza, y es lo que pidió  |
| R5  | El RPC toca `cantidad` por descuido                                                        | Media                     | Lista de columnas explícita + escenario que lo verifica      |
| R6  | Doble colchón por contar traspasos en BODEGA y en las sedes                                | Baja                      | Documentado; perilla `minmax_incluir_traspasos`              |
| R7  | Se olvida uno de los sitios del frontend                                                   | Media                     | La tabla de §1.9 como lista de verificación                  |

---

## Parte 2 — Reorden → Compras

### 2.1 El problema

Se seleccionan productos en Reorden, se pulsa "Generar orden de compra" y se llega a **Nueva
compra con el carrito vacío**. El comentario del propio código lo admite: _"hoy se ignora sin
romper"_.

### 2.2 La solución, corregida

`Reorden.jsx` **ya envía** los datos correctos. Falta que `CompraNueva` los lea — **pero no
como los propuse en la v1**.

**El bug que encontré en mi propio código (N9):** la clave de selección de Reorden es
`producto_id-sede_id`, así que se puede seleccionar el mismo producto en CHV y en CV. Mi
`sug.map(...)` habría creado **dos líneas con el mismo `producto_id`**, y como
`actualizarCantidad`, `setCostoDirecto` y `eliminarItem` filtran por `producto_id`, las dos
líneas se habrían movido juntas y borrado juntas. Hay que **consolidar por producto**:

```jsx
import { useLocation } from "react-router-dom";
const location = useLocation();

// Precarga desde Reorden. Una sola vez: si ya empezó a armar el carrito, no se le pisa.
const precargaHecha = useRef(false);
useEffect(() => {
  if (precargaHecha.current) return;
  const sug = location.state?.sugerenciasReorden;
  if (!Array.isArray(sug) || sug.length === 0) return;
  precargaHecha.current = true;

  // N9 — la selección de Reorden es por producto Y sede: el mismo producto puede
  // venir dos veces. El carrito indexa por producto_id, así que se consolida
  // sumando cantidades; si no, dos líneas del mismo producto se editan y se
  // borran juntas.
  const porProducto = new Map();
  for (const s of sug) {
    const cant = Math.max(1, Number(s.cantidad_sugerida) || 1);
    const ya = porProducto.get(s.producto_id);
    if (ya) {
      ya.cantidad += cant;
      ya.sedes.add(s.sede_id);
    } else {
      porProducto.set(s.producto_id, {
        producto_id: s.producto_id,
        referencia: s.referencia,
        nombre: s.nombre,
        cantidad: cant,
        // Al Vendedor nunca se le precarga el costo histórico (regla ya existente).
        costo_unitario: esVendedor ? 0 : Number(s.costo_unitario) || 0,
        // Mismo default inteligente que `agregarAlCarrito`: un producto no
        // vendible entra como insumo. Con "venta" fijo, los 32 insumos del
        // catálogo sumarían a `cantidad` en vez de `cantidad_insumo` y habría
        // que convertirlos a mano después — el dolor conocido de las OT.
        destino: s.vendible === false ? "insumo" : "venta",
        sedes: new Set([s.sede_id]),
      });
    }
  }
  setCarrito([...porProducto.values()].map(({ sedes, ...i }) => i));
  setSedesOrigen([...new Set(sug.map((s) => s.sede_id))]); // para el aviso de §2.3
  window.history.replaceState({}, ""); // un F5 no vuelve a precargar
}, [location.state, esVendedor]);
```

> **Requisito nuevo para la vista:** `v_sugerencias_reorden` **no expone `vendible`** hoy (lo
> usa por dentro en un `CASE` pero no lo devuelve). Hay que agregarlo a la lista de columnas —
> se está reescribiendo la vista de todos modos para el min/max por sede— o el `destino` de
> arriba siempre caería en "venta".

### 2.3 El aviso de sede que hoy no existe (N10)

`fn_registrar_compra` recibe **una sola sede** y `CompraNueva` manda siempre `perfil.sede_id`.
Como Reorden es sólo de Maritza (BODEGA), **todo lo que se pida para CHV, CV o L3 aterriza en
BODEGA** y necesita un traspaso posterior. Hoy nada lo advierte.

No hay que cambiar el RPC ni inventar compras multi-sede. Basta decir la verdad en pantalla:

> _"Esta compra se registrará en **BODEGA**. Las sugerencias venían de **CV** y **CHV**: cuando
> llegue la mercancía habrá que traspasarla."_

Es honesto, es una línea, y evita la sorpresa de buscar el stock donde no está.

**Lo que NO hay que hacer (N11):** seguimiento de "pedido / en tránsito". Hay **cero compras
sin recibir** en toda la base: el flujo real recibe de inmediato, así que un producto pedido
sale de Reorden solo. Construir eso sería resolver un problema que nadie tiene.

### 2.4 Escenarios Gherkin — Parte 2

```gherkin
Escenario: Pedido agrupado llega con los ítems puestos
  Dado que Maritza selecciona 5 productos en Reorden
  Cuando pulsa "Generar orden de compra"
  Entonces Nueva compra abre con los 5 en el carrito, con cantidad y costo
  Y sólo tiene que poner proveedor y factura

Escenario: El mismo producto seleccionado en dos sedes             # N9
  Dado que selecciona "FIL-1020" en CHV (sugerido 4) y en CV (sugerido 6)
  Cuando genera la orden
  Entonces el carrito tiene UNA línea de "FIL-1020" con cantidad 10
  Y al cambiar su cantidad no se duplica el efecto
  Y al eliminarla desaparece una sola línea

Escenario: Aviso de sede de destino                                # N10
  Dado que las sugerencias venían de CV y CHV
  Y Maritza es de BODEGA
  Entonces se muestra que la compra se registra en BODEGA
  Y que habrá que traspasar la mercancía

Escenario: Entrar a Nueva compra por el menú normal
  Entonces el carrito está vacío, como siempre, y no hay error

Escenario: La vendedora no ve el costo histórico
  Entonces los productos llegan con costo 0 y ella lo digita

Escenario: Recargar la página no duplica el carrito
  Cuando pulsa F5
  Entonces el carrito no se duplica

Escenario: Cantidad sugerida en cero o inválida
  Entonces se carga con cantidad 1 y ella la ajusta

Escenario: Producto desactivado entre la sugerencia y la compra
  Entonces el RPC de compra lo rechaza con su mensaje habitual
  # No se agrega validación nueva: la de compras ya existe

Escenario: Volver atrás desde Nueva compra y entrar otra vez
  Cuando usa el botón de atrás y vuelve a entrar por el menú
  Entonces el carrito está vacío
  # El state se limpió con replaceState
```

### 2.5 Riesgos de la Parte 2

Bajos y acotados. Es aditivo: sin `state`, el comportamiento es idéntico al de hoy. Los dos
riesgos reales —duplicar líneas por producto y filtrar el costo a la vendedora— están cubiertos
explícitamente arriba.

---

## Parte 3 — ABC de insumos

### 3.1 Tres clasificaciones

```
productos.clasificacion          → ABC por VENTAS      (existe, no cambia su significado)
productos.clasificacion_consumo  → ABC por CONSUMO     (ensambles + OT)
productos.clasificacion_global   → ABC COMBINADO       (la que usan Reorden y las compras)
```

Son tres preguntas distintas: _¿qué me deja plata?_, _¿qué se me acaba siempre?_ y _¿qué no me
puede faltar?_. La combinada manda en las compras; las otras dos explican **por qué** algo es A,
que es lo que permite discutirlo.

### 3.2 El cálculo del consumo, con la trampa

Lo obvio sería `sum(abs(cantidad))` sobre `ensamble_consumo` y `orden_consumo`. **Está mal.**
Las reversas —quitar un repuesto de una OT, devolver un insumo de un ensamble— no usan esos
tipos: `trg_ensamble_detalle_devolver` y `trg_orden_revertir_repuesto` escriben
`tipo = 'devolucion'` con cantidad **positiva** y `referencia_tipo` en `('ensamble',
'orden_servicio')`.

Con `abs()`, un repuesto puesto y luego quitado contaría como consumido para siempre: **21
movimientos y 199 unidades** de más en 90 días. Y hay otras 12 devoluciones con
`referencia_tipo = 'devolucion'` que son devoluciones de cliente y **no** deben restarse.

```sql
WITH consumo_90d AS (
  SELECT m.producto_id, SUM(-m.cantidad) AS uds     -- consumo negativo → positivo
  FROM movimientos m                                 -- reversa positiva → resta sola
  WHERE m.fecha >= now() - interval '90 days'
    AND m.producto_id IS NOT NULL
    AND (  m.tipo IN ('ensamble_consumo','orden_consumo')
        OR (m.tipo = 'devolucion'
            AND m.referencia_tipo IN ('ensamble','orden_servicio')) )
  GROUP BY 1
  HAVING SUM(-m.cantidad) > 0
)
```

El valor sale de multiplicar por `productos.costo_promedio`, con el mismo corte de Pareto 80/95
que ya usa ventas.

> **Salvedad honesta:** `movimientos` no guarda el costo del momento, así que el consumo se
> valora al costo promedio **actual**. Si un insumo cambió mucho de precio en el trimestre, su
> valoración queda sesgada. Sirve para clasificar en tres cubetas, no para contabilidad.

**Combinada** = valor de ventas + valor de consumo, mismo Pareto. Al sumar en pesos, las dos
fuentes son comparables sin inventar ponderaciones.

**La regla que arregla el sesgo:** hoy `_fn_recalcular_abc_core` fuerza `'C'` a todo lo que no
se vendió. Se mantiene **sólo para `clasificacion` (ventas)**, donde es correcto. Pero
`clasificacion_global` ya no lo fuerza: un producto puede no venderse nunca y ser crítico. Ahí
están los 42 millones.

### 3.3 Recalcular a demanda, con periodo elegible (decisión 2026-08-29)

**El cron mensual se queda como está.** En vez de cambiarlo, el botón "Recalcular" de la
pantalla ABC pasa a recibir el periodo que ya está seleccionado arriba: **último mes,
último trimestre o último año**.

Buena noticia: `PERIODOS_RANKING` en `src/lib/admin-analytics-ui.js` **ya tiene exactamente
esas tres opciones** (30 / 90 / 365) y la pantalla ya las usa para mostrar las ventas. El
cambio es pasarle ese mismo valor al RPC.

#### Verificación del recálculo actual (hecha en producción, sólo lectura)

| Comprobación                                                 | Resultado                                  |
| ------------------------------------------------------------ | ------------------------------------------ |
| Totales negativos que dañarían el Pareto                     | **0**                                      |
| Porcentaje acumulado fuera del rango 0-100                   | **0**                                      |
| Orígenes de venta cubiertos por el filtro `('directa','ot')` | **Los dos únicos que existen**             |
| Última ejecución del cron                                    | 1-ago 00:00 Colombia, **0,59 s**, correcta |
| Ventas anuladas excluidas                                    | Sí, `v.anulada = false`                    |

**La matemática está bien.** Pero la simulación contra los datos de hoy da algo revelador:

| Guardada hoy | Daría hoy | Productos |
| ------------ | --------- | --------- |
| C            | **A**     | 18        |
| C            | **B**     | 49        |
| B            | A         | 14        |
| A            | B         | 8         |
| B            | C         | 13        |

**67 productos están hoy marcados "C" cuando deberían ser A o B.** Con 28 días desde el
último recálculo, ésa es exactamente la razón por la que conviene poder apretar el botón
cuando se quiera en vez de esperar al día 1.

#### La trampa de la sobrecarga que rompería el cron

`fn_recalcular_abc()` y `_fn_recalcular_abc_core()` **no reciben ningún argumento hoy**. Si se
les agrega `p_dias integer DEFAULT 90` con `CREATE OR REPLACE`, **no se reemplazan: se crea una
segunda versión**. A partir de ahí la llamada del cron, `select public._fn_recalcular_abc_core()`,
queda ambigua y **falla con `function is not unique`**. El cron se rompe en silencio y nadie se
entera hasta que las letras se congelan.

```sql
DROP FUNCTION public.fn_recalcular_abc();
DROP FUNCTION public._fn_recalcular_abc_core();
-- y recién ahí crear las versiones con p_dias integer DEFAULT 90
```

Con el `DEFAULT 90`, la llamada del cron sigue funcionando sin tocarla.

#### Sólo hay 3 meses de historia

La primera venta del sistema es del **1 de junio de 2026**. Hoy:

- "Último trimestre" → 3.811 líneas de venta
- "Último año" → **3.811 líneas, las mismas**

O sea que **elegir "último año" da hoy un resultado idéntico a "último trimestre"**, y la dueña
va a pensar que el botón no funcionó. La pantalla tiene que decirlo:
_"Hay 3 meses de historial; los periodos más largos no cambian el resultado todavía."_

#### "Último mes" no es un cambio cosmético

Con 30 días sólo 400 productos tienen ventas, contra 604 con 90 días. Recalcular a un mes
**empuja unos 200 productos más a la categoría C**. Eso no es un detalle de visualización: si
`clasificacion_global` guía Reorden, cambia qué se compra primero.

El diálogo de confirmación debe decir la verdad con números, no un texto fijo:

> _"Vas a reclasificar 2.062 productos según las ventas del **último mes**. Con ese periodo,
> 400 productos tienen ventas y los otros 1.662 quedarán en C. ¿Continuar?"_

Hoy el texto está escrito a mano y dice "los últimos 90 días" pase lo que pase.

#### El timeout que miente

`recalcular` usa `Promise.race` con 30 segundos, pero **eso no cancela nada en el servidor**: la
petición sigue y termina. Si alguna vez se pasa de 30 s, la pantalla dice _"Timeout: contacta
soporte"_ y no recarga, mientras la base **sí quedó reclasificada**. La dueña vería las letras
viejas creyendo que falló, cuando funcionó.

Hoy no ocurre —el recálculo tarda 0,59 s— pero con más historia acumulada puede pasar. Ya que
se toca el archivo: al vencer el plazo, el mensaje debe decir que el proceso **sigue corriendo**
y ofrecer recargar, no mandar a soporte.

### 3.4 Dónde se ve

- **Pantalla ABC**: tres columnas y un selector de criterio (Ventas · Consumo · Combinado).
- **Reorden**: prioriza por `clasificacion_global`.
- **Alertas**: el chip ABC muestra la combinada, con las otras dos en el detalle.
- La distinción vendible/insumo ya existe en `productos.vendible`.

### 3.5 Escenarios Gherkin — Parte 3

```gherkin
Escenario: Insumo muy usado que casi no se vende
  Dado un empaque consumido 400 veces en ensambles y vendido 2 veces
  Entonces clasificacion = "C", clasificacion_consumo = "A", clasificacion_global = "A"
  Y en Reorden aparece con prioridad alta
  # Hoy sale "C" y se compra tarde

Escenario: Producto de venta pura
  Entonces clasificacion = "A", clasificacion_consumo = "C", clasificacion_global = "A"

Escenario: Producto sin movimiento alguno
  Entonces las tres son "C"

Escenario: Repuesto puesto en una OT y luego quitado
  Entonces su consumo neto es 0 y no queda inflado
  # SUM(-cantidad) hace que la reversa positiva se reste sola

Escenario: Devolución de cliente no se confunde con reversa de insumo
  Dado un movimiento 'devolucion' con referencia_tipo = 'devolucion'
  Entonces se ignora en el consumo de insumos

Escenario: Producto nuevo con menos de 90 días
  Entonces se clasifica con lo que hay, sin romperse

Escenario: Insumo sin costo promedio cargado
  Dado costo_promedio nulo o 0
  Entonces aporta 0 al ranking y no rompe la división
  Y la pantalla ABC avisa cuántos productos están sin costo
  # Hoy son 10

Escenario: Sólo Admin recalcula
  Entonces falla con el mensaje de siempre
  # Se reusa el control que ya existe

Escenario: El cron actualiza las tres columnas
  Cuando corre el recálculo programado
  Entonces actualiza clasificacion, clasificacion_consumo y clasificacion_global
  Y no se agenda un cron adicional

Escenario: El periodo de la pantalla no contradice la clasificación   # N13
  Cuando se eligen 180 días en el selector
  Entonces la pantalla aclara que la clasificación se calculó sobre 90 días
```

### 3.6 Riesgos de la Parte 3

| #   | Riesgo                                     | Gravedad | Mitigación                                                |
| --- | ------------------------------------------ | -------- | --------------------------------------------------------- |
| R8  | Contar las reversas como consumo           | Media    | Resuelto: `SUM(-cantidad)` + filtro por `referencia_tipo` |
| R9  | Insumos sin `costo_promedio` invisibles    | Media    | Aviso en pantalla con el conteo (hoy 10)                  |
| R10 | Valorar a costo actual y no histórico      | Baja     | Documentado; sólo afecta el orden dentro de la cubeta     |
| R11 | Reorden cambia de criterio sin explicación | Baja     | El selector de criterio hace visible el porqué            |

---

---

## Revisión transversal — qué puede dañar el inventario o romper la app

Tercera pasada, ya con las decisiones tomadas (Bodeguero incluido, pantalla masiva aprobada,
periodo elegible en el recálculo). Ordenado por lo que más duele.

### A. Escalada de privilegios: el riesgo más serio de todo el plan

`fn_aplicar_minmax` hoy hace `UPDATE productos SET stock_minimo = ...` — **global, las cuatro
sedes de un solo golpe**. Y su única defensa es `if v_rol is distinct from 'Admin' then raise`.

Para que la pantalla masiva funcione hay que relajar ese rol. **Si se relaja el rol antes de
volverla por sede, cualquier vendedora podría cambiar los mínimos de las cuatro sedes.** Es un
cambio de una línea que abre un agujero de permisos.

**Regla obligatoria: las dos modificaciones van en la misma migración, o no va ninguna.**
Concretamente, `fn_aplicar_minmax` deja de escribir `productos` y pasa a delegar cada ítem en
`fn_definir_minmax`, que ya valida rol y sede. Una sola puerta, una sola validación.

### B. Bloqueos mutuos en el guardado en lote

`fn_definir_minmax` hace `INSERT ... ON CONFLICT DO UPDATE`, que toma bloqueo de fila. Dos
guardados en lote simultáneos que recorran las mismas filas **en orden distinto** pueden
quedarse trabados uno esperando al otro.

Es poco probable (son 12 usuarios y cada uno en su sede), pero la mitigación es gratis:
**procesar siempre el lote `ORDER BY producto_id, sede_id`**. Con un orden fijo, dos lotes no
pueden bloquearse en cruz.

### C. El cron de ABC roto por una sobrecarga

Detallado en §3.3. `CREATE OR REPLACE` con un parámetro nuevo **no reemplaza, duplica**, y la
llamada sin argumentos del cron pasa a ser ambigua. Hay que `DROP FUNCTION` primero. Es el tipo
de error que no da la cara: el cron simplemente deja de correr y las letras se congelan.

### D. Romper la app en las tablets con el bundle viejo

El service worker de la PWA sirve el paquete anterior por horas. Cualquier columna o función
que se retire mientras haya un bundle viejo circulando **tumba la pantalla que la use**:

| Qué se retira                             | Qué se cae si se hace antes de tiempo   |
| ----------------------------------------- | --------------------------------------- |
| `productos.stock_minimo` / `stock_maximo` | Inventario, Alertas, Dashboard, Reorden |
| Firma vieja de `fn_sugerir_minmax`        | El asistente de Reorden                 |
| Firma vieja de `fn_recalcular_abc`        | El botón Recalcular de la pantalla ABC  |

Las tres funciones cambian de firma. **Frontend y base tienen que salir en la misma entrega**,
y el `DROP` de las columnas de `productos` va en una sesión posterior, nunca el mismo día.

### E. Lo que NO puede tocar el inventario

Repaso explícito de lo que debe quedar intacto, porque es la preocupación de fondo:

| Operación           | Garantía                                  | Cómo se asegura                                                                    |
| ------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------- |
| Configurar min/max  | No cambia `cantidad` ni `cantidad_insumo` | Lista de columnas explícita en el `ON CONFLICT`; escenario Gherkin que lo verifica |
| Configurar min/max  | No escribe en `movimientos`               | El RPC no inserta ahí; `movimientos` es append-only por trigger                    |
| Recalcular ABC      | No toca inventario en absoluto            | Sólo escribe `productos.clasificacion*`                                            |
| Recalcular ABC      | No dispara el guardia de costos           | El trigger es `UPDATE OF costo_promedio, precio_venta`; no se tocan                |
| Recálculo de estado | No inventa filas                          | `IF NOT FOUND THEN RETURN`                                                         |
| Vender sin stock    | Sigue bloqueado                           | No se toca ninguna regla de venta                                                  |

### F. Cosas que parecen problema y no lo son (verificadas)

Vale la pena dejarlas escritas para no volver a investigarlas:

- **`productos` no está en la publicación de realtime.** Recalcular el ABC actualiza ~2.000
  filas sin mandar un solo evento a los clientes. Sólo `inventario` publica.
- **El recálculo es atómico.** Es una función: si falla a mitad, revierte entera. No hay estado
  intermedio con la mitad de los productos reclasificados.
- **No hay compras pendientes de recibir** en toda la base, así que un producto pedido sale de
  Reorden solo. No hace falta seguimiento de "en tránsito".
- **Los orígenes de venta son sólo `directa` y `ot`**, los dos que el ABC ya filtra. No se está
  perdiendo ninguna venta en la clasificación.
- **No hay subtotales negativos** en las ventas, así que el Pareto no se desordena.
- **La constraint única `(producto_id, sede_id)` existe**, el `ON CONFLICT` es válido.

### G. Escenarios Gherkin de la revisión transversal

```gherkin
Escenario: Una vendedora no puede cambiar los mínimos de otras sedes por el lote
  Dado que fn_aplicar_minmax ya acepta a Vendedor
  Y que delega en fn_definir_minmax
  Cuando Deyanira manda un lote con ítems de CV y de CHV
  Entonces la llamada falla completa por el ítem de CHV
  Y ninguno de los dos se guarda
  # Es una función: o entran todos o no entra ninguno

Escenario: El cron de ABC sigue corriendo tras agregar el periodo
  Dado que se hizo DROP y luego CREATE con p_dias DEFAULT 90
  Cuando llega el día 1 y el cron llama _fn_recalcular_abc_core()
  Entonces resuelve al valor por defecto de 90 días y corre normal
  Y no falla con "function is not unique"

Escenario: Recalcular con "último mes" avisa lo que va a pasar
  Cuando Maritza elige "Último mes" y pulsa Recalcular
  Entonces el diálogo dice cuántos productos tienen ventas en ese periodo
  Y cuántos quedarán en C
  Y sólo procede si ella confirma

Escenario: "Último año" no engaña con 3 meses de historial
  Cuando elige "Último año"
  Entonces la pantalla avisa que sólo hay 3 meses de historial
  Y que el resultado es el mismo que el del trimestre

Escenario: El recálculo tarda más de 30 segundos
  Entonces el mensaje dice que el proceso sigue corriendo en el servidor
  Y ofrece recargar para ver el resultado
  Y NO manda a contactar soporte por algo que sí funcionó

Escenario: Dos guardados en lote al mismo tiempo
  Dado que Maritza guarda 200 mínimos y una vendedora guarda 50
  Y ambos lotes se procesan ordenados por producto_id y sede_id
  Entonces uno espera al otro y los dos terminan
  Y no hay bloqueo mutuo

Escenario: Comprar un insumo desde Reorden no exige conversión manual
  Dado un producto con vendible = false sugerido en Reorden
  Cuando se genera la orden de compra
  Entonces llega al carrito con destino "insumo"
  Y al recibirla suma a cantidad_insumo, no a cantidad
  # Con destino "venta" fijo tocaría convertirlo a mano después

Escenario: Recalcular el ABC no mueve una sola unidad de inventario
  Cuando corre el recálculo completo
  Entonces ninguna fila de inventario cambia de cantidad
  Y no se genera ningún movimiento
  Y ningún cliente recibe eventos de realtime por esto

Escenario: Un despliegue a medias no deja pantallas caídas
  Dado que se despliega la base pero una tablet tiene el bundle viejo
  Entonces las columnas viejas de productos siguen existiendo
  Y esa tablet sigue funcionando hasta que actualice
```

## Orden de ejecución

1. **Parte 2 (Reorden→Compras).** Un archivo, aditivo, sin base de datos.
2. **Parte 3 (ABC de insumos).** Columnas nuevas, nada se retira.
3. **Parte 1 (min/max por sede).** En los 3 pasos de §1.8; el DROP de columnas viejas **en una
   sesión posterior**.

## Criterios de aceptación

- [ ] Configurar un mínimo nunca modifica `cantidad`, `cantidad_insumo` ni `movimientos`
- [ ] `mínimo = 0` no genera alerta; `mínimo > 0` con cantidad 0 sigue alertando
- [ ] En Inventario la vendedora ve lo mismo que antes del cambio
- [ ] Vendedora sólo configura su sede, verificado saltándose la interfaz
- [ ] Los 26 productos con mínimo conservan sus alertas
- [ ] Las 28 filas de insumos falsamente "Agotado" quedan correctas
- [ ] El asistente acepta mínimo 0 y máximo 0
- [ ] Un producto con mínimo y sin máximo aparece en Reorden con cantidad sugerida
- [ ] Las sugerencias de BODEGA reflejan lo que despacha por traspaso
- [ ] Una venta anulada no infla la demanda sugerida
- [ ] El mismo producto en dos sedes llega al carrito como una sola línea
- [ ] Se avisa en qué sede quedará registrada la compra
- [ ] Un insumo muy consumido y poco vendido sale "A" en la combinada
- [ ] Un repuesto puesto y quitado de una OT tiene consumo neto 0
- [ ] Toda edición de min/max queda en `inventario_minmax_log`
- [ ] Una vendedora configura 30 productos de su sede en lote desde `/ops/minimos`
- [ ] `fn_sugerir_minmax` y `fn_aplicar_minmax` responden a Vendedor y Bodeguero para su sede
- [ ] Un lote de más de 200 ítems se guarda por tandas, sin peticiones colgadas
- [ ] Recalcular ABC acepta mes / trimestre / año y el diálogo dice qué va a pasar
- [ ] El cron mensual sigue corriendo después del cambio de firma
- [ ] Comprar un insumo desde Reorden llega con destino "insumo"
- [ ] Un lote con ítems de otra sede se rechaza completo, sin guardar ninguno
- [ ] Recalcular ABC no mueve ninguna unidad de inventario
- [ ] Recorrido por rol (Admin, Vendedor, Bodeguero, Técnico) y en ancho de celular

## Decisiones tomadas (2026-08-29)

1. **Bodeguero SÍ configura min/max de BODEGA.** Los tres roles operativos —Admin, Vendedor y
   Bodeguero— pueden configurar; los dos últimos sólo su propia sede. Ya está reflejado en
   `fn_definir_minmax` (§1.4).
2. **Las vendedoras SÍ necesitan edición masiva.** Se construye la pantalla `/ops/minimos`
   descrita en §1.7-b. No queda para después.
3. **El cron mensual se queda como está.** En vez de cambiar la frecuencia, el botón
   "Recalcular" recibe el periodo elegido (mes / trimestre / año). Ver §3.3.
