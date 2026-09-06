# Garantía desde una OT entregada + tope único de reembolso

**Fecha:** 2026-09-05
**Estado:** aprobado por el dueño, listo para implementar

## Problema

La app no tiene por dónde registrar un reclamo de garantía sobre una orden de
trabajo. La RPC `fn_abrir_garantia_venta` sí lo soporta (recibe
`orden_servicio_id`, exige OT entregada, cuenta los 90 días desde
`fecha_entrega`) y `ModalAbrirGarantiaVenta` también (tiene la rama
`tipo: "ot"`), pero ningún componente pasa ese origen: el único que abre el
modal es `VentaDetalle`, siempre con `tipo: "venta"`. Falta el botón, no el
motor.

Al investigar dónde ponerlo apareció un problema de plata más grande.

## El problema de fondo: tres topes que no se hablan

Hay tres caminos para devolverle dinero al cliente por una misma compra, y cada
uno lleva su propia cuenta:

| Función                           | ¿Suma devoluciones? | ¿Suma garantías de la venta? | ¿Suma garantías de la OT? |
| --------------------------------- | :-----------------: | :--------------------------: | :-----------------------: |
| `fn_registrar_devolucion_cliente` |         sí          |              sí              |            no             |
| `fn_abrir_garantia_venta`         |         no          |         solo su lado         |       solo su lado        |

Consecuencias, todas con impacto real en el cierre de caja (los reembolsos de
garantía y de devolución entran como egreso del día):

1. **Ya existe hoy, sin tocar nada:** se puede devolver el total por devolución
   y otra vez por garantía sobre la misma venta. `fn_abrir_garantia_venta` no
   mira devoluciones.
2. **Lo destaparía el botón nuevo:** toda OT entregada tiene venta (el único
   camino a `entregada` es `fn_generar_venta_ot`), así que con la puerta de la
   OT abierta se podría reembolsar el total contra la OT y otra vez contra su
   factura. El `if/else` del acumulado mira `venta_id` **o**
   `orden_servicio_id`, nunca los dos.
3. **Carrera:** cada RPC bloquea con `FOR UPDATE` la fila por la que entró. Dos
   reclamos simultáneos por puertas distintas bloquean filas distintas y los dos
   pasan la validación.

## Terreno verificado en producción (2026-09-05)

- 156 OT entregadas; `fecha_entrega` poblada en las 156, promedio 6,5 días entre
  apertura y entrega. Los 90 días se anclan bien.
- 146 OT con venta viva, 10 sin venta (viejas). Una OT llegó a tener 2 ventas
  (una anulada y su reemplazo) → el cruce debe mirar **todas** las ventas con
  `ventas.orden_id = OT`, no solo `ordenes_servicio.venta_id`.
- El total de la OT coincide **exactamente** con el de su venta en los 146
  pares (diferencia máxima: 0).
- `garantias_venta` tiene 12 filas, todas cerradas; ninguna con
  `arreglar_producto`. `garantias_compra` tiene 4.
- La política `garventa_select` **ya contempla** `orden_servicio_id` con su
  propia rama por sede: la lectura de garantías de OT funciona para Vendedor y
  Técnico sin tocar RLS.
- `parametros_sistema` es legible por cualquier autenticado
  (`auth_read_parametros_sistema` con `USING true`), así que el frontend puede
  leer `dias_garantia_venta`. Hoy la clave no existe → corre el respaldo de 90.

## Diseño

### Modelo: un solo tope por grupo de reembolso

Una OT y todas las ventas que generó son **un solo evento económico**. La plata
que entró es una sola, así que el tope de lo que puede salir es uno solo.

```
GRUPO = la OT + todas las ventas con orden_id = esa OT
        (o, si es una venta suelta sin OT, esa venta sola)

Ya reembolsado del grupo =
      devoluciones no anuladas de las ventas del grupo
    + garantías 'devolver_dinero' no anuladas de las ventas del grupo
    + garantías 'devolver_dinero' no anuladas de la OT del grupo
```

**El tope no cambia**: sigue siendo el total del documento por el que se entra.
Solo cambia _qué se suma contra ese tope_. De ahí la propiedad que hace segura
la migración: **el cambio solo puede rechazar más, nunca aceptar más.** Ninguna
operación que hoy funcione deja de funcionar, salvo exactamente los casos que
son el error.

### Base de datos

**Migración 1 — `fn_reembolsado_del_grupo(p_orden_id uuid, p_venta_id uuid) → numeric`**

Nueva. Resuelve el grupo y devuelve el total ya reembolsado por las tres vías.
`STABLE`, `SECURITY DEFINER`, sin escrituras. Fuente de verdad única.

**Migración 2 — enganchar las dos RPC**

- `fn_abrir_garantia_venta`: el bloque `if/else` del acumulado se reemplaza por
  la llamada al helper.
- `fn_registrar_devolucion_cliente`: su cálculo de `v_ya_reemb` (líneas 77-81 de
  `20260812000005`) se reemplaza por la misma llamada.

**Serialización.** Se agrega `pg_advisory_xact_lock` sobre la clave del grupo
(id de la OT si hay OT, si no el de la venta): el mismo candado sin importar por
dónde se entre. Es el patrón que ya usa `fn_definir_minmax`. Se toma **después**
de los `FOR UPDATE` actuales, que no se tocan. No hay ciclo de espera posible:
la ruta que entra por la OT bloquea la fila de la OT y luego pide el advisory;
las que entran por la venta bloquean la fila de la venta y luego piden el mismo
advisory. Ninguna espera una fila que la otra tenga.

**Mensajes de error.** Siguiendo la regla del proyecto de que todo bloqueo diga
causa y salida: el mensaje debe decir que la OT y su factura comparten un solo
tope, cuánto se devolvió ya, y cuánto queda.

### Frontend — `src/pages/ops/OrdenDetalle.jsx`

En `PasoEntrega`, debajo de "OT entregada y convertida a venta":

- Botón **"Cliente reclama garantía"** que abre `ModalAbrirGarantiaVenta` con
  `origen={{ tipo: "ot", id, cliente_nombre, sede_id }}`. El modal no se toca:
  ya es agnóstico del origen y solo usa `origen.tipo`, `origen.id` y
  `origen.cliente_nombre`.
- Visible solo con OT `entregada` y rol Admin, Vendedor o Técnico — los mismos
  que acepta la RPC.
- Fuera de la ventana de garantía **no se muestra el botón**, se muestra la
  razón con la fecha de vencimiento. Los días salen de
  `parametros_sistema.dias_garantia_venta` con respaldo en 90, para que la
  pantalla y el servidor nunca se contradigan.
- Lista de garantías ya abiertas sobre la OT, con enlace al detalle, al estilo
  del bloque de Vinculaciones de `VentaDetalle`.
- Al crearla, navega a `/ops/garantias/venta/<id>`.

### Fuera de alcance

No se tocan: el modal, la RLS, los enums, `fn_generar_venta_ot`, el flujo de
estados de la OT, el cierre de caja, ni el botón de garantía que ya existe en
`VentaDetalle`. Las dos puertas quedan abiertas; ahora comparten tope.

## Pruebas

Contra los productos `INVENTARIO DE PRUEBA (999)`, en producción, como es
costumbre en este proyecto.

1. Abrir garantía de reembolso desde una OT entregada → entra y sale en el
   cierre.
2. Sobre la misma OT, intentar reembolso por su venta → debe rechazar con el
   mensaje nuevo.
3. Devolución de cliente sobre esa misma venta → debe rechazar también.
4. Reembolsos parciales que sumen exactamente el total → deben pasar.
5. Venta suelta sin OT → igual que hoy (regresión).
6. OT fuera de la ventana → sin botón, con la fecha de vencimiento visible.
