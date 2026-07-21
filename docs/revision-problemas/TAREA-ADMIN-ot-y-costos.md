# Tarea para administración: órdenes de trabajo y costos

Verificado contra la base de datos el 21 de julio de 2026. Son dos listas
independientes. La primera es plata cobrada sin respaldo y conviene resolverla
pronto. La segunda son costos de inventario que distorsionan el margen, y buena
parte se arregla sola con las próximas compras.

---

## Lista 1. Órdenes de trabajo con plata cobrada y sin valor registrado

### Qué está mal

En estas órdenes se le recibió dinero al cliente, pero nunca se registró cuánto
valía el trabajo: ni la mano de obra ni los repuestos. La orden quedó con un
total de cero (o casi) mientras la caja sí recibió el pago.

La caja está bien: ese dinero entró como abono y el cierre lo cuenta como
ingreso por servicios. El problema es que no hay una venta que lo respalde, así
que no se sabe cuánto se ganó en ese trabajo, y la orden no se puede facturar
correctamente. El caso más claro es la orden 43, que se facturó por 2.000 pesos
habiendo recibido 400.000.

### Qué hay que ajustar

Entrar a cada orden y registrar el valor real del trabajo, es decir la mano de
obra y los repuestos que se usaron. Cuando el total de la orden coincida con lo
que se le cobró al cliente, se factura normalmente. Si el trabajo efectivamente
costó lo que se cobró, basta con poner ese valor como mano de obra.

### Las que importan

| OT  | Sede | Cliente                | Creada     | Registrado | Cobrado  | Estado     |
| --- | ---- | ---------------------- | ---------- | ---------- | -------- | ---------- |
| 38  | CV   | SERVIAUTOMATICOS       | 12/06/2026 | $0         | $800.000 | entregada  |
| 43  | L3   | DANILO SANTARRIAGA     | 16/06/2026 | $2.000     | $400.000 | facturada  |
| 82  | CV   | HUGO RODRIGUEZ         | 25/06/2026 | $0         | $380.800 | terminada  |
| 23  | CV   | CONSUMIDOR FINAL       | 10/06/2026 | $0         | $297.500 | abierta    |
| 34  | CV   | CONSUMIDOR FINAL       | 11/06/2026 | $200       | $297.500 | entregada  |
| 39  | L3   | JORGE ENRIQUE GALEANO  | 12/06/2026 | $0         | $288.000 | en proceso |
| 32  | CV   | JORGE ENRIQUE PACHONGO | 11/06/2026 | $0         | $100.000 | en proceso |

Suman **2.563.800 pesos** cobrados sin valor de trabajo registrado. La orden 43
es la más urgente porque ya se facturó mal: la venta quedó por 2.000 pesos.

### Las que no requieren nada

Las órdenes 76 y 115 están canceladas, y las 1, 8 y 42 son de prueba o
diferencias de centavos. No hay que tocarlas.

---

## Lista 2. Costos de inventario por revisar

### Qué está mal

El costo que el sistema tiene guardado para estos productos no coincide con lo
que realmente se pagó en la última compra. Cuando el costo está por debajo del
real, el margen se ve más alto de lo que es y se corre el riesgo de vender
demasiado barato. Cuando está por encima, el margen se ve más bajo y el
inventario aparece sobrevalorado.

### Qué hay que ajustar

Solo vale la pena corregir los productos que tienen existencias. Los que están
en cero se corrigen solos apenas se compren de nuevo, así que no hay que hacer
nada con ellos. Para corregir, se entra a la ficha del producto y se ajusta el
costo al valor de la última compra que aparece en la tabla.

### Prioridad alta

Estos cinco concentran casi todo el descuadre. Vale la pena empezar por aquí.

| Ref      | Producto                           | Costo hoy  | Se pagó    | Stock | Impacto    |
| -------- | ---------------------------------- | ---------- | ---------- | ----- | ---------- |
| CTA1105T | CABEZOTE 5 HP 1105T TIPO CHEQUERA  | $1.500.000 | $1.000.000 | 2     | $1.000.000 |
| M1501/4V | MANOMETRO 150 1/4 V                | $13.700    | $8.000     | 95    | $541.500   |
| CBMC     | CAJA ELECTRICA BORNERA MOTOR CHINO | $9.153     | $30.000    | 10    | $208.470   |
| 6205FAG  | RODAMIENTO 6205 ZZ FAG             | $44.100    | $11.758    | 5     | $161.710   |
| GF3/4PP  | GRAPAS DE FIJACION 3/4 PP          | $1.031     | $1.500     | 266   | $124.754   |

Ojo con la caja eléctrica y las grapas: el sistema las tiene **más baratas** de
lo que costaron, así que hoy se están vendiendo con menos margen del que parece.

### Prioridad media

| Ref     | Producto                 | Costo hoy | Se pagó | Stock |
| ------- | ------------------------ | --------- | ------- | ----- |
| CL250VT | CLAVIJAS 3X50 TRIFASICA  | $17.081   | $20.800 | 18    |
| SECG    | SOPORTE EN CAUCHO GRANDE | $3.849    | $50.000 | 1     |
| 6307F   | RODAMIENTO 6307 FAG      | $44.200   | $28.847 | 2     |
| 6204K   | RODAMIENTO 6204 KOYO     | $11.900   | $16.807 | 6     |
| 6304F   | RODAMIENTO 6304 FAG      | $23.100   | $13.798 | 2     |
| CA45    | CORREA A45               | $7.475    | $10.084 | 6     |
| CA53    | CORREA A53               | $8.823    | $10.926 | 6     |
| CA36    | CORREA A36               | $5.966    | $8.403  | 4     |
| 5.51A28 | POLEA 5.5 1A 28          | $23.100   | $19.412 | 2     |
| 70-AS   | CAPACITOR 70 UF 250 VAC  | $24.000   | $23.000 | 6     |
| 42A5/8  | POLEA 4 x 2A 5/8         | $33.800   | $28.403 | 1     |

El soporte en caucho es el más llamativo: figura en 3.849 pesos y costó 50.000.

### Diferencias menores

Estos tienen existencias pero la diferencia es de unos pocos miles de pesos o
menos, así que se corrigen si sobra tiempo: CA50, CA35, 31A5/8, 6203TIM, NI1/2G,
3.51A5/8, 62B28, 21A3/4, 2.52A5/8 y 2.51A3/4.

### Productos sin costo

Estos dos tienen existencias pero el costo está en cero, así que toda venta suya
aparece como ganancia pura. Hay que ponerles el costo real, que el sistema no
tiene de dónde sacar porque nunca se registró una compra.

| Ref    | Producto                     | Stock |
| ------ | ---------------------------- | ----- |
| TA1/2G | TAPON 1/2 GALVANIZADO HEMBRA | 64    |
| UG3/8  | UNION DE 3/8 GALVANIZADO     | 23    |

### No hay que hacer nada

Trece productos de la lista original quedaron sin existencias, entre ellos el
motor WEG 1.5HP, el arrancador 17-25 y varias correas y poleas. Su costo se
corrige solo con la próxima compra que se reciba.

---

## Resumen

| Tarea                              | Cuántos | Plata implicada |
| ---------------------------------- | ------- | --------------- |
| Órdenes con valor sin registrar    | 7       | $2.563.800      |
| Costos de prioridad alta           | 5       | $2.036.434      |
| Costos de prioridad media          | 11      | ~$220.000       |
| Productos sin costo                | 2       | margen irreal   |
| Diferencias menores                | 10      | poco            |
| Sin existencias, se corrigen solos | 13      | nada que hacer  |
