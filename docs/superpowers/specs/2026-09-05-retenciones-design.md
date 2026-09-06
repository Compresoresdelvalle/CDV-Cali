# Retenciones: retefuente, reteICA y reteIVA

**Fecha:** 2026-09-05
**Origen:** solicitud de la dueña — a la empresa le aplican retenciones y necesitan verlo reflejado en el flujo de caja
**Estado:** diseño aprobado, pendiente de plan de implementación

---

## El problema

Cuando un cliente grande le compra a Compresores del Valle, no paga el total de
la factura: descuenta las retenciones y las consigna a la DIAN o al municipio a
nombre de la empresa. La factura sigue diciendo diez millones, pero al banco
entran nueve y medio.

Hoy la app no sabe nada de eso. El cierre de caja suma `ventas.total`, así que
cuenta como ingreso una plata que nunca llegó, y Cuentas por Cobrar deja al
cliente debiendo un saldo que jamás va a pagar porque ya se fue a la DIAN.

Lo mismo al revés: cuando la empresa actúa como agente retenedor y le retiene a
un proveedor, le paga menos de lo que dice la factura de compra.

## Qué es cada retención

**Retefuente.** Anticipo del impuesto de renta. Quien paga descuenta un
porcentaje a quien cobra. Se calcula sobre la base, nunca sobre el IVA. La
tarifa depende del concepto: compras generales rondan el 2,5%, servicios el 4%
o 6%, honorarios 10% u 11%, arrendamientos 3,5%.

**ReteICA.** Retención del impuesto de Industria y Comercio, que es municipal.
Se expresa en por mil y cambia según el municipio y la actividad económica. En
Cali depende del código de actividad. También va sobre la base.

**ReteIVA.** La única que no va sobre la base sino sobre el IVA facturado. La
tarifa general es 15% de ese IVA.

Las tarifas cambian por ley y por municipio. Por eso son configurables y
editables documento por documento: la app no puede quedar amarrada a un número.

---

## La regla de oro: la factura no se toca

`ventas.total`, `compras.total`, el IVA y el subtotal **quedan exactamente como
están**. Una retención no modifica la factura; modifica cuánta plata se mueve.

```
Total facturado  =  base + IVA          ← no cambia nunca
Retenciones      =  retefuente(base) + reteICA(base) + reteIVA(IVA)
Plata real       =  Total − Retenciones
```

Todo lo nuevo vive en columnas aparte. Ninguna fórmula existente de totales se
modifica. Esto es lo que hace que la funcionalidad sea reversible: con las
retenciones apagadas, el comportamiento es idéntico al de hoy.

## Modelo de datos

En `ventas`, `compras` y `ordenes_servicio`, seis columnas y una derivada:

```sql
retefuente_pct    numeric(6,3)  default 0
retefuente_valor  numeric(12,2) default 0
reteica_pct       numeric(6,3)  default 0
reteica_valor     numeric(12,2) default 0
reteiva_pct       numeric(6,3)  default 0
reteiva_valor     numeric(12,2) default 0

retenciones_total numeric(12,2)
  GENERATED ALWAYS AS (
    coalesce(retefuente_valor,0) + coalesce(reteica_valor,0) + coalesce(reteiva_valor,0)
  ) STORED
```

Se guarda el porcentaje **y** el valor calculado. El porcentaje solo para poder
mostrar de dónde salió; el valor es el dato bueno. Si mañana la ley cambia la
tarifa, los documentos viejos conservan lo que se les aplicó de verdad.

`retenciones_total` es columna generada a propósito: no se puede desincronizar
del detalle ni por error de código ni por un `UPDATE` a mano. Todas las
consultas de dinero leen esa columna y solo esa.

Los valores los calcula **el servidor** dentro de las RPC que ya registran cada
documento, nunca el frontend. Es la misma regla que rige el resto de la app:
todo lo que es plata se decide en el servidor.

## Las bases de cálculo

```
base        = subtotal − descuento          (sin IVA, sin domicilio)
retefuente  = round(base × retefuente_pct / 100)
reteica     = round(base × reteica_pct  / 100)
reteiva     = round(iva  × reteiva_pct  / 100)
```

El domicilio queda fuera de la base: es un servicio de transporte facturado
aparte y no forma parte del valor de la mercancía.

Todo se redondea a pesos enteros, como el resto de la app.

---

## El impacto en el cierre — la parte delicada

El cierre tiene doce sumas de dinero distintas. La buena noticia es que **solo
dos caminos necesitan cambiar**, y el motivo es importante:

| Camino                  | Qué suma hoy                 | ¿Cambia?                                   |
| ----------------------- | ---------------------------- | ------------------------------------------ |
| Venta de **contado**    | `ventas.total`               | **Sí**: pasa a `total − retenciones_total` |
| Venta a **crédito**     | los cobros de `pagos_cuenta` | **No**: ya es plata real                   |
| **OT**                  | los abonos de `abonos`       | **No**: ya es plata real                   |
| Cotización con anticipo | `abonos_cotizacion`          | **No**: ya es plata real                   |
| Compra de **contado**   | `compras.total`              | **Sí** (fase 2)                            |
| Pago a proveedor        | los pagos de `pagos_cuenta`  | **No**: ya es plata real                   |

La asimetría es el corazón del diseño y también su riesgo. Una venta de contado
se cuenta por su total el día que se hace, así que ahí hay que descontar la
retención. Una venta a crédito **no se cuenta al facturarla**: el cierre solo ve
los cobros, y esos ya vienen netos porque el cliente pagó menos.

**Si se restara la retención también en el camino del crédito, se restaría dos
veces.** Ese es el bug que puede descuadrar la caja, y es lo que más pruebas
lleva.

### Los desgloses también

`sum(v.total)` aparece dos veces en la función: en el ingreso general y en el
desglose por sede. `sum(total)` de compras, otras dos. Los cuatro sitios tienen
que cambiar a la vez.

Si se arregla el total pero no el desglose por sede, la suma de las sedes deja
de coincidir con el total del día, y ese descuadre es peor que el original
porque no se sabe cuál de los dos números creer.

El desglose por método de pago y el arqueo se alimentan de los mismos orígenes,
así que se revisan uno por uno en la implementación.

## Cuentas por cobrar y por pagar

Hoy:

```
saldo = total − abonos_cotizacion − pagos_directos
```

Pasa a:

```
saldo = total − retenciones_total − abonos_cotizacion − pagos_directos
```

Sin esto, cada factura con retención deja un saldo fantasma. El cliente
aparecería debiendo $350.000 para siempre, y esa plata ya está en la DIAN.

Con el cambio, cuando el cliente paga lo que le corresponde el saldo cierra
exactamente en cero, que es la prueba de que la fórmula está bien.

Lo mismo en `v_cuentas_por_pagar` para la fase 2.

## El saldo de la OT

La OT calcula su saldo como `total − abonos`. Con retención pasa a
`total − retenciones_total − abonos`, por la misma razón.

Ojo con el orden: la OT entregada genera una venta. La retención se captura **en
la OT**, y al convertirse se copia a la venta que genera, para que el documento
final la lleve y no se cuente dos veces.

## Configuración de tarifas

Van en la tabla `parametros`, que ya existe y ya se usa para los mínimos:

```
retencion_retefuente_pct   default 2.5
retencion_reteica_pct      default 0.69
retencion_reteiva_pct      default 15
```

Maritza las edita en Configuración. Llegan precargadas a cada documento y se
pueden cambiar ahí mismo sin afectar el valor por defecto. Si la ley cambia, se
ajusta en un solo sitio.

## La interfaz

En Nueva Venta, la OT y (fase 2) Nueva Compra: un bloque plegable
**"Retenciones"**, apagado por defecto. Al activarlo aparecen las tres con su
porcentaje editable y el desglose:

```
Total facturado          $ 10.000.000
Retefuente 2,5%             − 210.084
ReteICA 0,69%                − 57.983
ReteIVA 15%                 − 239.496
─────────────────────────────────────
Neto a recibir            $ 9.492.437
```

Apagado, no cambia absolutamente nada. Ese es el criterio de aceptación más
importante de toda la funcionalidad.

Los tres campos usan el mismo control de porcentaje del resto de la app, con
tope 0–100 y validación de que no sea negativo.

### En los documentos impresos

El recibo POS y el PDF de la venta muestran el bloque de retenciones y el neto
solo cuando hay alguna. Sin retenciones, el documento sale idéntico a hoy.

---

## Alcance por entregas

**Fase 1 — ventas y órdenes de trabajo.** Es donde a la empresa le retienen y
donde está el impacto de caja que motivó la solicitud. Incluye el modelo de
datos completo (las tres tablas), la configuración de tarifas, el cierre, las
cuentas por cobrar, el saldo de OT y los documentos impresos de venta.

**Fase 2 — compras.** La empresa como agente retenedor. Se monta sobre un cierre
ya probado: solo se agregan los dos sitios de `compras.total` y la vista de
cuentas por pagar.

Las columnas de `compras` se crean desde la fase 1 aunque no se usen todavía,
para no partir la migración del esquema en dos.

## Lo que queda fuera, a propósito

**Bases mínimas en UVT.** La norma no obliga a retener por debajo de ciertos
montos. La app no las va a validar: quien registra decide si aplica o no. Meter
las UVT exige mantener el valor anual y una tabla de topes por concepto, y se
puede agregar después sin tocar nada de lo de aquí.

**Conceptos de retefuente.** Un solo porcentaje editable, no una lista de
conceptos con su tarifa. Se descartó en el diseño por costo contra beneficio.

**Certificados de retención.** El documento formal que se le entrega a quien se
le retuvo. Es otra funcionalidad y merece su propio diseño.

---

## Riesgos y cómo se atienden

**Doble resta en el cierre.** El riesgo principal. Se atiende con pruebas que
midan el ingreso del día antes y después en los cuatro caminos —contado,
crédito, OT y anticipo— y comprueben que solo el de contado se mueve.

**Desgloses que dejan de cuadrar.** Se atiende con una prueba que verifique que
la suma de las sedes es igual al ingreso total del día, y que el desglose por
método también.

**Documentos viejos.** Todas las columnas nacen en 0, así que las 1.949 ventas y
las compras que ya existen quedan con retención cero y su comportamiento no
cambia. Se verifica midiendo el ingreso acumulado antes y después de la
migración: tiene que ser idéntico.

**Redondeo.** Tres retenciones redondeadas por separado pueden diferir en un
peso de redondear la suma. Se redondea cada una y se suma después, y la columna
generada garantiza que frontend y backend siempre vean el mismo número.

**La venta a crédito con retención.** Caso que hay que probar explícitamente: al
facturar no entra nada a la caja, y cuando el cliente paga el neto el saldo debe
cerrar en cero, no quedar debiendo la retención.

## Verificación

Cada escenario se prueba contra producción dentro de una transacción que se
revierte, simulando el JWT del usuario y con `set local role authenticated` para
que la RLS esté activa.

El invariante que manda: **el ingreso del día tiene que moverse exactamente en
la diferencia esperada, ni un peso más**. Se mide antes y después de cada
operación, igual que se hizo con el cambio de producto.

Además, una prueba de humo que monte las pantallas tocadas: build, eslint y los
tests de lógica no ejecutan un componente, y ya se demostró dos veces que un
error de render pasa las tres verificaciones.
