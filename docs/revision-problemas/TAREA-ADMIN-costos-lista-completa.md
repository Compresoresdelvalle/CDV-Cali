# Costos por corregir: lista completa

Verificado contra la base de datos el 21 de julio de 2026. Son 28 productos que
tienen existencias y cuyo costo guardado no coincide con lo que se pagó en la
última compra recibida.

## Cómo leer la tabla

La columna "costo hoy" es lo que el sistema tiene guardado. "Se pagó" es lo que
costó realmente en la última compra, con su fecha. El ajuste es la diferencia por
unidad, y el impacto es esa diferencia multiplicada por las existencias, que es
la plata que está mal valorada en el inventario.

La columna de situación distingue dos casos que se corrigen igual pero tienen
consecuencias distintas. Cuando dice **subvalorado**, el sistema cree que el
producto costó menos de lo que costó, así que el margen se ve más alto de lo real
y se corre el riesgo de venderlo demasiado barato. Es el caso que conviene
atender primero aunque el monto sea pequeño. Cuando dice **sobrevalorado**, el
sistema lo tiene más caro de lo que fue, el margen se ve más bajo y el inventario
aparece inflado.

Para corregir se entra a la ficha del producto y se pone el valor de la columna
"se pagó".

## La lista

| #   | Ref      | Producto                           | Costo hoy  | Se pagó    | Compra | Stock | Ajuste x und | Impacto    | Situación       |
| --- | -------- | ---------------------------------- | ---------- | ---------- | ------ | ----- | ------------ | ---------- | --------------- |
| 1   | CTA1105T | CABEZOTE 5 HP 1105T TIPO CHEQUERA  | $1.500.000 | $1.000.000 | 01/07  | 2     | −$500.000    | $1.000.000 | Sobrevalorado   |
| 2   | M1501/4V | MANOMETRO 150 1/4 V                | $13.700    | $8.000     | 01/07  | 95    | −$5.700      | $541.500   | Sobrevalorado   |
| 3   | CBMC     | CAJA ELECTRICA BORNERA MOTOR CHINO | $9.153     | $30.000    | 25/06  | 10    | +$20.847     | $208.470   | **Subvalorado** |
| 4   | 6205FAG  | RODAMIENTO 6205 ZZ FAG             | $44.100    | $11.758    | 08/07  | 5     | −$32.342     | $161.710   | Sobrevalorado   |
| 5   | GF3/4PP  | GRAPAS DE FIJACION 3/4 PP          | $1.031     | $1.500     | 12/06  | 266   | +$469        | $124.754   | **Subvalorado** |
| 6   | CL250VT  | CLAVIJAS 3X50 CAUCHO TRIFASICA     | $17.081    | $20.800    | 23/06  | 18    | +$3.719      | $66.942    | **Subvalorado** |
| 7   | SECG     | SOPORTE EN CAUCHO GRANDE           | $3.849     | $50.000    | 03/07  | 1     | +$46.151     | $46.151    | **Subvalorado** |
| 8   | 6307F    | RODAMIENTO 6307 FAG                | $44.200    | $28.847    | 08/07  | 2     | −$15.353     | $30.706    | Sobrevalorado   |
| 9   | 6204K    | RODAMIENTO 6204 KOYO               | $11.900    | $16.807    | 11/07  | 6     | +$4.907      | $29.442    | **Subvalorado** |
| 10  | 6304F    | RODAMIENTO 6304 FAG                | $23.100    | $13.798    | 08/07  | 2     | −$9.302      | $18.604    | Sobrevalorado   |
| 11  | CA45     | CORREA A45                         | $7.475     | $10.084    | 07/07  | 6     | +$2.609      | $15.654    | **Subvalorado** |
| 12  | CA53     | CORREA A53                         | $8.823     | $10.926    | 07/07  | 6     | +$2.103      | $12.618    | **Subvalorado** |
| 13  | CA36     | CORREA A36                         | $5.966     | $8.403     | 07/07  | 4     | +$2.437      | $9.748     | **Subvalorado** |
| 14  | 5.51A28  | POLEA 5.5 1A 28                    | $23.100    | $19.412    | 22/06  | 2     | −$3.688      | $7.376     | Sobrevalorado   |
| 15  | 70-AS    | CAPACITOR 70 UF 250 VAC AIRE SECO  | $24.000    | $23.000    | 25/06  | 6     | −$1.000      | $6.000     | Sobrevalorado   |
| 16  | 42A5/8   | POLEA 4 x 2A 5/8                   | $33.800    | $28.403    | 17/06  | 1     | −$5.397      | $5.397     | Sobrevalorado   |
| 17  | CA50     | CORREA A50                         | $11.644    | $12.605    | 08/07  | 4     | +$961        | $3.844     | **Subvalorado** |
| 18  | CA35     | CORREA A35                         | $6.827     | $8.403     | 17/06  | 1     | +$1.576      | $1.576     | **Subvalorado** |
| 19  | 31A5/8   | POLEA 3 1A 5/8                     | $11.457    | $12.857    | 11/06  | 1     | +$1.400      | $1.400     | **Subvalorado** |
| 20  | 6203TIM  | RODAMIENTO 6203 TIMKEN             | $8.706     | $8.936     | 08/07  | 6     | +$230        | $1.380     | **Subvalorado** |
| 21  | NI1/2G   | NIPLE 1/2 GALVANIZADO              | $1.380     | $2.000     | 25/06  | 2     | +$620        | $1.240     | **Subvalorado** |
| 22  | 3.51A5/8 | POLEA 3.5 1A 5/8                   | $11.764    | $12.857    | 12/06  | 1     | +$1.093      | $1.093     | **Subvalorado** |
| 23  | 62B28    | POLEA 6 2B 28                      | $44.537    | $44.958    | 07/07  | 1     | +$421        | $421       | **Subvalorado** |
| 24  | 21A3/4   | POLEA 2 1A 3/4                     | $7.410     | $7.395     | 11/06  | 3     | −$15         | $45        | Sobrevalorado   |
| 25  | 2.52A5/8 | POLEA 2.5 2A 5/8                   | $16.500    | $16.471    | 12/06  | 1     | −$29         | $29        | Sobrevalorado   |
| 26  | 2.51A3/4 | POLEA 2.5 1A 3/4                   | $9.063     | $9.076     | 16/07  | 1     | +$13         | $13        | **Subvalorado** |

Los tres últimos (21A3/4, 2.52A5/8 y 2.51A3/4) tienen diferencias de menos de
treinta pesos. Son redondeos y se pueden dejar como están sin ninguna
consecuencia.

## Aparte: dos productos sin costo

Estos dos tienen existencias pero el costo está en cero, y no hay ninguna compra
registrada de donde sacarlo. Toda venta suya aparece como ganancia pura, así que
el margen del producto es irreal. Hay que ponerles el costo a mano, con el precio
que se sepa que costaron.

| #   | Ref    | Producto                     | Costo hoy | Stock |
| --- | ------ | ---------------------------- | --------- | ----- |
| 27  | TA1/2G | TAPON 1/2 GALVANIZADO HEMBRA | $0        | 64    |
| 28  | UG3/8  | UNION DE 3/8 GALVANIZADO     | $0        | 23    |

## No hay que hacer nada con estos

Trece productos de la lista original quedaron sin existencias, así que su costo
se corrige solo con la próxima compra que se reciba: WEG1.5AT (motor 1.5HP),
17-25 (arrancador), CR2051 (cabezote 1.5HP), PEA (empaquetadura), CB90, CA75,
TT8, 4.51A24, 41A5/8, 41A28, 31A3/4, 5.52A28 y TA1/4G.

## Resumen

| Concepto                             | Productos | Plata mal valorada |
| ------------------------------------ | --------- | ------------------ |
| Subvalorados (margen se ve más alto) | 14        | $517.383           |
| Sobrevalorados (inventario inflado)  | 12        | $1.778.730         |
| Sin costo, hay que ponerlo a mano    | 2         | margen irreal      |
| Sin existencias, se corrigen solos   | 13        | nada que hacer     |

En total hay **$2.296.113** mal valorados en el inventario. Los cinco primeros de
la tabla concentran $2.036.434, es decir el 89 por ciento, así que corrigiendo
solo esos cinco ya queda resuelto casi todo.
