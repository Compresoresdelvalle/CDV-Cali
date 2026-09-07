# Retenciones fase 2: la empresa como agente retenedor

**Fecha:** 2026-09-07
**Origen:** el dueño, al probar fase 1: _"compras es porque nosotros podemos
retener, o sea pagamos menos, y en ventas podrían retenernos, o sea nos entra
menos. Si estaba en el plan y no se hizo, retómalo y acábalo."_
**Rama:** `feat/retenciones-compras`
**Antecede:** `docs/superpowers/specs/2026-09-05-retenciones-design.md` (fase 1,
ventas y OT, en producción).
**Estado:** diseño aprobado.

---

## El problema

Fase 1 resolvió la mitad que duele cuando entra plata: si un cliente grande
retiene, a la caja llegan nueve millones y medio de una factura de diez, y el
cierre ya lo sabe.

Falta la mitad de cuando sale plata. Compresores del Valle también es agente
retenedor: cuando le compra a un proveedor pequeño, descuenta la retención de la
factura y la consigna ella misma a la DIAN. La factura del proveedor dice un
millón, del cajón salen novecientos cincuenta mil, y los cincuenta mil restantes
se giran después a nombre del proveedor.

Hoy la app no tiene por dónde registrarlo. `fn_registrar_compra` ni siquiera
recibe los porcentajes, así que las columnas que fase 1 dejó creadas en
`compras` están todas en cero y no hay forma de que dejen de estarlo. El
resultado es que el cierre da por salido del cajón el total completo de la
factura, y Cuentas por Pagar deja al proveedor con un saldo que nunca se le va
a pagar porque esa parte ya se fue a la DIAN. Es el mismo par de errores de
fase 1, con el signo cambiado.

---

## Dos cosas que el spec de fase 1 dejó mal

Fase 1 anticipó fase 2 en una línea: _"solo se agregan los dos sitios de
`compras.total` y la vista de cuentas por pagar"_. Al ir a buscarlos, ninguna de
las dos afirmaciones resiste.

### Son seis sitios, no dos

En `_fn_cierre_totales`, `compras.total` entra como egreso en seis lugares
distintos: el total global (`v_egresos`), el desglose por sede (`v_por_sede`),
el de sede por método de pago (`v_por_sede_metodo`), el de sede por cuenta
bancaria (`v_por_cuenta`), el detalle línea a línea de egresos
(`v_egresos_detalle`) y el efectivo esperado del arqueo (`v_arqueo_esp`).

Son exactamente los mismos seis en los que fase 1 tuvo que tocar `ventas.total`.
Arreglar unos y olvidar otros es peor que no arreglar ninguno: el cierre se
contradiría consigo mismo, el total diría una cosa y el arqueo otra, y la
diferencia aparecería al cuadrar la caja, cuando ya nadie se acuerda de qué
compra la causó.

El contador de compras (`v_cc`) no se toca: cuenta documentos, no plata.

### Y hay un hueco vivo, no futuro

`v_cuentas_por_cobrar.saldo` resta `retenciones_total`. `v_cuentas_por_pagar.saldo`
no. Pero `fn_registrar_pago_cuenta`, en su rama de pago, sí la resta, con un
comentario que dice que hoy vale cero y que así queda el camino listo.

El camino no quedó listo: quedó partido. En el momento en que una compra tenga
retención, la pantalla de Cuentas por Pagar mostraría un saldo de un millón y el
servidor rechazaría cualquier pago mayor a novecientos cincuenta mil, con un
mensaje de "el monto supera el saldo pendiente" que contradice lo que la misma
pantalla acaba de mostrar. La compra jamás llegaría a estado "pagada".

Hay además un comentario equivocado en `src/pages/ops/Cuentas.jsx` que afirma
que la fórmula del saldo es `total - retenciones - abonado` "en ambas vistas".
No lo es, y hay que corregirlo junto con la vista.

---

## Dónde cambia la plata y dónde no

Esta es la tabla que evita el descuadre. Restar la retención en el sitio de más
es tan grave como no restarla.

| Camino                                       | Qué suma hoy                | ¿Cambia en fase 2?                           |
| -------------------------------------------- | --------------------------- | -------------------------------------------- |
| Compra de **contado**                        | `compras.total`             | **Sí**, pasa a `total - retenciones_total`   |
| **Pago a proveedor** de una compra a crédito | los pagos de `pagos_cuenta` | **No**: eso ya es plata real que salió       |
| **Saldo** de Cuentas por Pagar               | `total - pagos`             | **Sí**, pasa a `total - retenciones - pagos` |
| Panel de decisiones y Dashboard              | `compras.total`             | **No**                                       |

Las dos filas del medio son las que se hacen mal con más facilidad.

Si se restara la retención también en el camino del pago a crédito, se restaría
dos veces: una en el saldo, que ya nace neto, y otra en el pago. Ese es el bug
que descuadra la caja.

Y la última fila es la distinción que hay que tener clara: **una retención no
abarata la mercancía**. El gasto sigue siendo el total de la factura; lo que
cambia es a quién se le paga, una parte al proveedor y otra a la DIAN. Por eso
`fn_panel_resultado`, `fn_dashboard_admin` y `fn_dashboard_kpis` se quedan
intactos. Es la misma asimetría que ya vive en ventas: el ingreso contable es el
total, y la caja recibe el neto.

---

## El cálculo: hacerlo imposible de escribir mal

Fase 1 dejó las columnas de `compras` a medio blindar, y esa diferencia con
`ventas` importa.

En `ventas`, `retefuente_valor`, `reteica_valor` y `reteiva_valor` son columnas
**generadas** a partir del porcentaje y de la base. Nadie puede escribir un
valor que no corresponda a su porcentaje, porque no se puede escribir en
absoluto. En `compras`, en cambio, las tres son columnas normales con default 0,
y solo `retenciones_total` es generada como su suma. Es decir, la mitad del
blindaje: la suma está protegida, pero los sumandos no.

**Decisión: volver generadas también las tres de `compras`**, espejo de ventas.

```
base            = greatest(0, subtotal - coalesce(descuento_valor, 0))
retefuente_valor = round(base * retefuente_pct / 100)
reteica_valor    = round(base * reteica_pct   / 100)
reteiva_valor    = round(compras.iva * reteiva_pct / 100)
```

Sale más simple que en ventas por dos razones: `compras` no tiene domicilio ni
descuento porcentual, solo `descuento_valor`, y el IVA es una columna guardada
(`compras.iva`) en vez de tener que recalcularse con `_fn_iva_venta`. No hacen
falta funciones auxiliares nuevas.

Cada retención se redondea por separado y después se suman, igual que en ventas
y que en `src/lib/retenciones.js`. Redondear la suma daría un peso de
diferencia entre lo que la pantalla promete y lo que la base guarda.

Como hoy las tres valen 0 en todas las filas de `compras`, recrearlas no toca
ni un dato. PostgreSQL no permite convertir una columna existente en generada,
así que la migración baja `retenciones_total`, baja las tres, y vuelve a
crearlas en el orden correcto.

**La alternativa descartada** era calcular los valores dentro de
`fn_registrar_compra`. Funciona el día que se escribe, pero deja abierto que un
`UPDATE` posterior o alguno de los triggers que ya tiene `compras` cambie el
subtotal y deje el valor de la retención pegado al subtotal viejo. Ese
desfase es invisible hasta el cierre, y para entonces no hay forma de saber
cuál de los dos números era el bueno.

---

## Captura: dónde lo ve quien registra la compra

`BloqueRetenciones` se reutiliza tal cual, con una prop nueva `modo` que solo
cambia las palabras, porque el sentido del dinero es el opuesto:

|                    | `modo="venta"` (actual)                 | `modo="compra"` (nuevo)                        |
| ------------------ | --------------------------------------- | ---------------------------------------------- |
| Invitación plegada | ¿El cliente retiene? Tocar para aplicar | ¿Le retenemos al proveedor? Tocar para aplicar |
| Pie del bloque     | Neto a recibir                          | Neto a pagar                                   |
| Total de arriba    | Total facturado                         | Total de la factura                            |

Todo lo demás se queda igual: plegado por defecto, en cero por defecto, y las
tarifas de Configuración detrás del botón explícito "Aplicar las tarifas de
siempre". Esto último es la corrección de ayer y aplica con más razón acá: si
abrir el bloque rellenara las tarifas solas, bastaría que alguien lo abriera por
curiosidad para que el sistema diera por pagados novecientos cincuenta mil
mientras del cajón salió un millón.

Las tres claves de `parametros_sistema` se comparten con ventas. No se crean
tarifas sugeridas aparte para compras: son las mismas tarifas de ley, y
duplicarlas solo crea un segundo sitio donde quedarse desactualizado.

**Dónde va.** En Nueva Compra, debajo del bloque de totales, antes del botón de
registrar. En el detalle de la compra, el mismo bloque en `soloLectura`, para
que quien vaya a pagarle al proveedor vea de dónde salió el neto.

**Quién lo ve.** Nadie queda por fuera. `BloqueRetenciones` no tiene ni ha
tenido filtro de rol, y Compras la usan Admin, Bodega y también las vendedoras,
que registran compras por la decisión de rol "todero" de 2026-07-16.

---

## Qué queda deliberadamente fuera

**Editar la retención de una compra ya registrada.** Ventas tampoco lo permite:
las retenciones se capturan al crear el documento y no hay RPC para cambiarlas
después. Mantener la simetría es más importante que la comodidad, porque una
compra ya recibida movió inventario y, si era de contado, ya movió el cierre.
Cambiarle la retención después exige decidir qué pasa con un cierre que ya se
guardó, y eso es su propio diseño y su propio candado.

**Tarifas sugeridas distintas para compras.** Ver arriba.

**Un documento imprimible de la compra.** No existe hoy y esta funcionalidad no
lo necesita: la constancia del proveedor es su propia factura.

---

## Alcance de los cambios

**Base de datos**

1. Migración que recrea `retefuente_valor`, `reteica_valor`, `reteiva_valor` y
   `retenciones_total` de `compras` como columnas generadas.
2. `fn_registrar_compra` recibe `p_retefuente_pct`, `p_reteica_pct` y
   `p_reteiva_pct`, con default 0 y recorte a `[0, 100]`, y los guarda.
   Con default 0 la firma vieja sigue funcionando, así que nada se rompe
   mientras el frontend no se despliegue.
3. `v_cuentas_por_pagar`: el saldo pasa a `total - retenciones_total - pagos`.
4. `_fn_cierre_totales`: los seis sitios de `compras.total` pasan a
   `total - coalesce(retenciones_total, 0)`. El camino de `pagos_cuenta` no se
   toca en ninguno de los seis.

**Frontend**

5. `BloqueRetenciones` acepta `modo` y cambia los tres textos. Sin `modo`, se
   comporta exactamente como hoy.
6. `CompraNueva` monta el bloque, calcula la vista previa con
   `calcularRetenciones` y manda los tres porcentajes al RPC.
7. `CompraDetalle` muestra el desglose en solo lectura cuando hay retención.
8. `Cuentas.jsx`: corregir el comentario de la fórmula del saldo.

**Pruebas**

9. Unitarias de `calcularRetenciones` en modo compra, comparadas contra lo que
   devuelven las columnas generadas para los mismos números.
10. Render de `BloqueRetenciones` en `modo="compra"`: que diga "Neto a pagar",
    que arranque plegado y en cero, y que ninguna tarifa sugerida aparezca
    aplicada al montar.
11. Verificación en producción dentro de `BEGIN ... ROLLBACK`, con una compra de
    contado y otra a crédito, comprobando los seis sitios del cierre, el saldo
    de la vista y el tope de `fn_registrar_pago_cuenta`.

---

## Criterio de aceptación

El más importante es el mismo de fase 1: **mientras nadie abra el bloque, la app
se comporta exactamente igual que antes**. Una compra sin retención tiene los
tres porcentajes en cero, `retenciones_total` en cero, y todas las restas de
arriba son restas de cero.

Y el que da sentido a la funcionalidad: registrada una compra de contado de un
millón con 2,5% de retefuente, el cierre de ese día debe reportar novecientos
setenta y cinco mil de egreso, el arqueo esperado debe bajar en esa misma cifra
y no en un millón, y el detalle de egresos debe mostrar el neto, no el total.
Si esos tres números no coinciden entre sí, la funcionalidad está mal y hay que
volver a la tabla de los seis sitios.
