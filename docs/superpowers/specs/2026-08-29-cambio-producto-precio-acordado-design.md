# Cambio de producto: precio acordado en vez de precio de lista

**Fecha:** 2026-08-29
**Origen:** reporte de Maritza (nota de voz, 11:08 a.m.) sobre la venta #1789
**Estado:** diseño aprobado, pendiente de implementar

---

## El problema

Cuando un cliente cambia un producto por otro, `fn_registrar_cambio` valora las
dos puntas con varas distintas. Lo que el cliente **devuelve** se valora con lo
que realmente pagó, porque sale de `detalle_venta.subtotal` y se ajusta por el
descuento de la venta. Lo que el cliente **se lleva** se valora con
`productos.precio_venta`, el precio de lista, y no existe ningún campo para
decir otra cosa.

El resultado es que cualquier descuento concedido en la venta original se le
cobra de vuelta al cliente en el cambio.

### El caso que lo destapó

La venta #1789 del 27/08 fue un AUTOMATICO 1 VIA PALANCA 135 175 con
`precio_unitario` de $60.000 sobre una lista de $65.000: el descuento se dio
bajando el precio de la línea, no como descuento de venta. Dos días después el
cliente volvió a cambiarlo porque la referencia estaba equivocada, por otro
automático de la misma lista.

El sistema valoró la devolución en $60.000 y la entrega en $65.000, y pidió
cobrar $5.000 por un intercambio que no movía plata. La vendedora no tenía
manera de bajar ese precio.

Como el cambio no servía, se anuló #1789 y se facturó de nuevo hoy como #1834
por los mismos $60.000. Ese es el estado actual de la base.

### Por qué esto daña la caja

El cobro fantasma de $5.000 crea una venta de $5.000 el día del cambio. La caja
del día espera $5.000 que nadie entregó, así que el arqueo queda corto.

El rodeo de anular y refacturar es peor: mueve $60.000 del 27 de agosto a hoy.
El 27 pierde un ingreso que sí ocurrió y hoy gana uno que no. Los cierres del
27, 28 y 29 todavía no se han generado — el último guardado es el del 26 — así
que el daño es reversible, pero está ahí.

---

## Los derivados

Al revisar el mecanismo aparecieron cuatro problemas más, del mismo tronco.

**Revertir un cambio le cobra al cliente.** La venta que genera un cambio
guarda el valor de lo entregado como `descuento_valor`. En la venta #1677 eso
es subtotal $30.000, descuento $25.000, total $5.000. Si mañana se revierte ese
cambio, el crédito por devolver el producto se calcula como
`30.000 × (5.000 / 30.000)` = $5.000, cuando el cliente puso $30.000 entre
permuta y efectivo. El sistema le cobraría unos $20.000 por deshacer un cambio.

Lo grave es que la pantalla de la venta **recomienda hacer exactamente eso**:
"Para revertir el cambio, usa Registrar cambio a la inversa". El botón está
disponible sobre las ventas de cambio; solo anular está bloqueado.

**Si sube el precio de lista aparece una diferencia inventada.** Un cliente que
compró a $65.000 cuando esa era la lista, y hoy cambia por la misma referencia
con la lista en $70.000, recibe un cobro de $5.000 sin que nadie haya dado
nunca un descuento.

**Cambios sobre ventas a crédito.** La venta original nunca entró a caja, pero
la diferencia se cobra o se paga en efectivo el día del cambio. Si el producto
nuevo es más barato, sale plata real de una venta que todavía no se ha cobrado.
Queda fuera del alcance de este trabajo, anotado abajo.

**Devolver en efectivo lo que se pagó por transferencia.** Es una decisión
operativa, no un defecto, pero mueve el arqueo de efectivo del día.

---

## La solución

### Principio rector: no tocar la plata

El arreglo cambia **un solo número**: `v_valor_nuevo`, que hoy es
`productos.precio_venta × cantidad` y pasa a ser `precio_acordado × cantidad`.

Todo lo que viene después queda idéntico. La permuta se sigue netando como
`descuento_valor` en la venta nueva, el `total` se sigue clampando a cero o más,
y el reembolso sigue siendo un único egreso de caja menor cuando la diferencia
es negativa.

Esto se verificó contra la base antes de diseñar:

| Paso del cambio                     | ¿Crea registro de dinero?                                        |
| ----------------------------------- | ---------------------------------------------------------------- |
| `fn_registrar_devolucion` (interna) | No. No toca caja menor ni genera reembolso; solo reingresa stock |
| `fn_registrar_venta`                | Sí: un ingreso, `total` = precio nuevo − permuta                 |
| `fn_registrar_caja_menor`           | Solo si la diferencia es negativa: un egreso                     |

El clampeo también está verificado: `descuento_valor` se acota a
`[0, subtotal]` y el trigger clampa el total con el mismo `greatest/least`.
Ninguna de las 1.787 ventas de la base tiene total negativo.

Como no se crea ningún registro de dinero nuevo, no cambia el significado de
ninguno existente y no se toca la fórmula del cierre, **no puede haber doble
conteo**. El arreglo además retira plata fantasma: hoy un cambio par inventa un
ingreso de $5.000; después será $0.

### Tres caminos descartados a propósito

Son las soluciones aparentes que sí descuadrarían la caja.

Marcar la venta del cambio con `origen = 'cambio'` la sacaría del cierre, que
filtra por `origen = 'directa'`. Las diferencias cobradas dejarían de contarse
como ingreso y el cierre quedaría corto. La venta del cambio sigue siendo
`'directa'`.

Registrar la permuta como un pago de la venta inflaría el ingreso: el cierre
suma `ventas.total`, no los pagos, así que la venta valdría el precio completo
y contaría $65.000 cuando solo entraron $5.000.

Mover la permuta a una columna nueva que participe en el cálculo del `total`
tocaría justamente lo que el cierre suma.

### El precio sugerido

El campo de precio llega precargado con lo que el cliente pagó, ajustado por la
diferencia de lista entre los dos productos:

```
sugerido = precio_pagado_unitario + (lista_nuevo_hoy − lista_devuelto_hoy)
```

acotado a cero o más y redondeado a pesos.

| Situación                        | Cuenta                      | Sugerido                                     |
| -------------------------------- | --------------------------- | -------------------------------------------- |
| Misma lista (el caso de Maritza) | 60.000 + (65.000 − 65.000)  | **60.000** → cambio par                      |
| El nuevo es más caro             | 60.000 + (100.000 − 65.000) | **95.000** → conserva los 5.000 de descuento |
| Subió la lista de los dos        | 65.000 + (70.000 − 70.000)  | **65.000** → diferencia 0                    |
| No hubo descuento                | 65.000 + (100.000 − 65.000) | **100.000** → igual que hoy                  |

La fórmula preserva el trato relativo que se le hizo al cliente. Usa
deliberadamente los precios de lista **de hoy** de los dos productos y no
`detalle_venta.precio_catalogo`, porque esa columna está vacía en 542 de las
3.811 líneas de venta (las anteriores a que se empezara a guardar).

`precio_pagado_unitario` sale de lo que ya calcula el modal: el subtotal de la
línea dividido por la cantidad, multiplicado por el ratio del descuento de
venta.

El campo es editable. La vendedora puede poner cualquier precio, igual que en
una venta normal — la app no tiene tope de descuento ni precio mínimo por
decisión del dueño. Queda registrado quién lo puso y cuál era la lista.

### Revertir un cambio

Se agrega `ventas.cambio_de_venta_id uuid` con referencia a `ventas(id)`.
`fn_registrar_cambio` la llena en la venta nueva.

El cálculo del crédito pasa a usar ratio = 1 cuando la venta es un cambio,
porque ahí `descuento_valor` es una permuta y no un descuento comercial. Con el
precio acordado guardado en `detalle_venta.precio_unitario`, el subtotal de la
línea ya refleja el valor real del producto, que es exactamente el crédito
correcto.

Ninguna columna de dinero cambia. El cierre no se entera.

De paso, la columna reemplaza el parseo por expresión regular de la observación
(`obs.match(/#(\d+)/)`) con el que hoy VentaDetalle averigua de qué venta viene
un cambio.

---

## Escenarios

```gherkin
Característica: Cambio de producto respetando lo que el cliente pagó

  Antecedentes:
    Dado que el AUTOMATICO A1VP175 tiene precio de lista $65.000
    Y se vendió en $60.000 con descuento autorizado

  Escenario: Cambio par por referencia equivocada
    Cuando se cambia por el AUTOMATICO A4VP, lista $65.000
    Entonces el precio sugerido debe ser $60.000
    Y la diferencia debe ser $0
    Y no debe generarse ningún cobro ni egreso
    Y la venta del cambio debe quedar en total $0
    Y el ingreso del día no debe cambiar

  Escenario: El de cambio es más caro y se conserva el descuento
    Cuando se cambia por uno de lista $100.000
    Entonces el precio sugerido debe ser $95.000
    Y deben cobrarse $35.000
    Y esos $35.000 deben entrar como ingreso del día del cambio
    Y no debe generarse ningún egreso

  Escenario: El de cambio es más barato
    Cuando se cambia por uno cuyo precio acordado es $40.000
    Entonces deben devolverse $20.000
    Y la venta del cambio debe quedar en total $0
    Y debe generarse un único egreso de caja menor por $20.000

  Escenario: La vendedora ajusta el precio sugerido
    Cuando se cambia por uno de lista $100.000
    Y la vendedora escribe $90.000 como precio acordado
    Entonces deben cobrarse $30.000
    Y la observación del cambio debe registrar el precio acordado y la lista

  Escenario: Sin descuento de por medio
    Dado que la venta original fue a precio de lista
    Cuando se cambia por otro producto
    Entonces el precio sugerido debe ser el de lista del nuevo
    Y el resultado debe ser idéntico al comportamiento actual

  Escenario: El precio de lista subió después de la venta
    Dado que la lista de las dos referencias pasó de $65.000 a $70.000
    Cuando se cambia por la otra referencia
    Entonces la diferencia debe ser $0

  Escenario: Revertir un cambio
    Dado un cambio ya registrado de A por B
    Cuando se registra el cambio inverso de B por A
    Entonces el crédito por devolver B debe ser el subtotal de su línea
    Y el cliente debe quedar como antes del primer cambio
    Y no debe cobrársele nada

  Escenario: Cambio parcial de una línea con varias unidades
    Dado que se vendieron 3 unidades a $60.000 cada una
    Cuando se devuelve 1 unidad
    Entonces el crédito debe ser $60.000

  Escenario: No hay stock del producto nuevo
    Cuando se intenta el cambio
    Entonces debe fallar completo con un mensaje que diga qué falta
    Y el producto devuelto NO debe quedar reingresado
    Y no debe quedar ninguna venta ni egreso a medias

  Escenario: Precio acordado inválido
    Cuando se envía un precio negativo
    Entonces debe rechazarse antes de mover stock o plata

  Escenario: Compatibilidad con llamadas sin precio
    Cuando se registra un cambio sin indicar precio acordado
    Entonces debe usarse el precio de lista, como hasta hoy
```

---

## Alcance

### Incluido

La columna `ventas.cambio_de_venta_id` y su backfill desde las observaciones de
los nueve cambios ya registrados. El parámetro de precio acordado en
`fn_registrar_cambio` y el ratio = 1 para ventas de cambio. El campo de precio
en `ModalCambioProducto` con el sugerido, el botón para volver a lista y el
detalle de la diferencia. El cambio de una palabra en `VentaDetalle` para traer
el precio de lista actual de los productos de la venta. La observación del
cambio dejando constancia del precio acordado y la lista.

### Excluido

La reparación de #1789 y #1834 va aparte, con su propio análisis y aprobación
antes de ejecutarse (ver abajo).

Los cambios sobre ventas a crédito se quedan como están. Hoy la diferencia se
mueve en efectivo aunque la venta original no haya entrado a caja. Es un
problema real pero de otra naturaleza — toca el módulo de cuentas por cobrar —
y mezclarlo aquí ampliaría el riesgo sin necesidad.

No se toca `fn_registrar_venta`: ya acepta `precio_unitario` por ítem y guarda
`precio_catalogo` aparte para auditoría.

---

## Riesgos y cómo se atienden

**El `DROP` de la firma vieja.** Agregar un parámetro con valor por defecto a
`fn_registrar_cambio` crea una función nueva y deja viva la de nueve
argumentos. PostgREST vería dos candidatas y fallaría con "Could not choose the
best candidate function". Hay que borrar explícitamente la firma anterior en la
misma migración.

**Los permisos se pierden con el `DROP`.** Al recrear la función hay que
restaurar `EXECUTE` a `authenticated` y `service_role`, y revocar `anon`.
Supabase concede `anon` por defecto a toda función nueva y `REVOKE ... FROM
PUBLIC` no lo quita, porque el de `anon` es un grant explícito. La ACL de
referencia, la que tiene hoy, es `postgres | authenticated | service_role`.

**La caché de esquema de PostgREST.** Después de cambiar la firma hay que
mandar `NOTIFY pgrst, 'reload schema'` o la app recibirá un 404 al llamar la
función.

**El backfill de `cambio_de_venta_id`.** Se hace por número de venta parseado
de la observación. Si alguna no matchea se deja en nulo y se reporta; no se
adivina. Una fila sin enlace se comporta como hoy, que es el estado actual.

**Regresión en cambios sin descuento.** El precio sugerido cae en el de lista,
así que el resultado es idéntico al de hoy. Es la garantía de que el flujo
normal no se altera.

---

## La reparación de #1789 y #1834

Se ejecuta después, y solo con aprobación explícita sobre el bloque exacto.

El objetivo es que el 27 de agosto muestre los $60.000 que sí ingresaron ese
día y que hoy no muestre un ingreso que no ocurrió.

La dificultad es que `trg_ventas_proteger_anulacion` bloquea de forma
incondicional pasar `anulada` de verdadero a falso: el escape
`cdv.anulando_venta = 'on'` solo permite el sentido contrario. Des-anular
#1789 no es posible por la vía normal. Además la anulación ya reingresó el
stock, así que revertirla obliga a volver a descontarlo.

A favor juega que los cierres se calculan en vivo y que ni el 27, ni el 28, ni
el 29 están cerrados. Si los datos se corrigen antes de generar esos cierres,
los tres días salen bien sin tocar ningún cierre guardado.

El bloque se presentará con el antes y el después de cada peso y cada unidad de
inventario, y se ejecutará en una sola transacción.

---

## Verificación

Cada escenario del Gherkin se prueba contra producción dentro de una
transacción que se revierte, como se hizo con las garantías: simulando el JWT
de la vendedora y con `set local role authenticated` para que la RLS esté
activa, no como superusuario.

Además, para cada camino se comprueba el invariante de caja: que la suma de
ingresos del día antes y después del cambio se mueva exactamente en la
diferencia cobrada, y que el número de egresos generados sea cero o uno, nunca
dos.
