# Tarea para el Admin — costos por revisar

**Fecha:** 2026-07-17 · **Para:** Carlos (Admin) · **Dónde se hace:** Panel → Productos → editar costo

---

## Por qué existe esta lista

Entre el 11 de junio y el 16 de julio, cuando un Bodeguero o un Vendedor marcaba una
compra como recibida, **el sistema no guardaba el nuevo costo promedio**. El error ya
está corregido (desde el 17 de julio a las 03:58 no se ha perdido ni un costo más),
pero los costos que quedaron mal **no se arreglan solos hasta la próxima compra** de
cada producto.

Esto importa porque un costo mal bajo **infla la ganancia**: si un producto figura con
costo $50 y en realidad costó $35.000, cada venta suya reporta una utilidad que no
existe, y eso se ve en el Dashboard, en los cierres y en el análisis ABC.

### Por qué no lo corrigió el sistema solo

Ya se corrigieron automáticamente los 6 productos donde había **certeza matemática**
(los que no tenían stock previo: ahí el costo correcto es exactamente el de la compra).

Los de esta lista **no se pueden calcular**. El costo correcto es una mezcla entre lo
que ya había en bodega y lo que se compró nuevo, y para calcularla haría falta saber
cuánto stock había en el momento exacto de cada compra. Ese dato no se puede
reconstruir de forma confiable: se probó el método contra 34 casos conocidos y **falló
en 10 de ellos**, con errores de hasta $140.625 por unidad. Preferimos dejarlo en tus
manos antes que escribir un número inventado que parezca preciso.

### Cómo usar la lista

La columna **"lo que se pagó"** es el dato duro: las compras reales cuyo costo se
perdió, con su fecha. El costo correcto está normalmente **entre** el costo de hoy y lo
que se pagó, más cerca de uno u otro según cuánto stock viejo hubiera.

> **No apliques "lo que se pagó" a ciegas.** Es referencia, no respuesta.

---

## Grupo A — Los 5 grandes (79% del descuadre)

Si solo vas a hacer una parte, haz esta. Son **$2,87M de los $3,6M** en 5 productos.

| Ref      | Producto                          |  Costo hoy | Lo que se pagó                          | Stock |  Descuadre |
| -------- | --------------------------------- | ---------: | --------------------------------------- | ----: | ---------: |
| CTA1105T | CABEZOTE 5 HP 1105T TIPO CHEQUERA | $1.500.000 | 01/07: 1 × $1.000.000                   |     2 | $1.000.000 |
| C2X10    | CABLE ENCAUCHETADO 2X10           |       $443 | 18/06: 5.000 × $115                     | 2.730 |   $895.959 |
| M1501/4V | MANOMETRO 150 1/4 V               |    $13.700 | 01/07: 100 × $8.000                     |    96 |   $547.200 |
| GF3/4PP  | GRAPAS DE FIJACION 3/4 PP         |     $1.031 | 12/06: 50 × $50                         |   266 |   $260.999 |
| 6205FAG  | RODAMIENTO 6205 ZZ FAG            |    $44.100 | 01/07: 4 × $11.765 · 08/07: 4 × $11.758 |     5 |   $161.690 |

---

## Grupo B — Con stock, valen la pena

| Ref       | Producto                           |  Costo hoy | Lo que se pagó                                               | Stock | Descuadre |
| --------- | ---------------------------------- | ---------: | ------------------------------------------------------------ | ----: | --------: |
| WEG1.5AT  | MOTOR 1.5HP 3600 RPM WEG TRIFASICO | $1.046.250 | 16/07: 1 × $1.300.000                                        |     1 |  $253.750 |
| CBMC      | CAJA ELECTRICA BORNERA MOTOR CHINO |     $9.153 | 25/06: 5 × $30.000                                           |    10 |  $208.470 |
| CL250VT   | CLAVIJAS 3X50 CAUCHO TRIFASICA     |    $17.081 | 23/06: 20 × $20.800                                          |    19 |   $70.661 |
| MG2001/4V | MANOMETRO 200 GLISERINA 1/4 V      |    $25.520 | 18/06: 1 × $42.900                                           |     4 |   $69.520 |
| SECG      | SOPORTE EN CAUCHO GRANDE           |     $3.849 | 03/07: 1 × $50.000                                           |     1 |   $46.151 |
| 6307F     | RODAMIENTO 6307 FAG                |    $44.200 | 19/06: 2 × $44.200 · 08/07: 3 × $28.847                      |     2 |   $18.424 |
| CA45      | CORREA A45                         |     $7.475 | 07/07: 5 × $10.084                                           |     6 |   $15.654 |
| CA53      | CORREA A53                         |     $8.823 | 07/07: 5 × $10.926                                           |     6 |   $12.618 |
| CR2051    | CABEZOTE 1.5 HP 2051 REFORZADO     |   $252.101 | 25/06: 3 × $239.495                                          |     1 |   $12.606 |
| CA36      | CORREA A36                         |     $5.966 | 07/07: 5 × $8.403                                            |     4 |    $9.748 |
| 5.51A28   | POLEA 5.5 1A 28                    |    $23.100 | 22/06: 2 × $19.412                                           |     2 |    $7.376 |
| 70-AS     | CAPACITOR 70 UF 250 VAC AIRE SECO  |    $24.000 | 25/06: 1 × $23.000                                           |     6 |    $6.000 |
| 42A5/8    | POLEA 4 × 2A 5/8                   |    $33.800 | 17/06: 1 × $28.403                                           |     1 |    $5.397 |
| FP1/2     | FILTRO 1/2 PLASTICO                |     $5.000 | 15/07: 3 × **$0** ⚠️                                         |     1 |    $5.000 |
| 6304F     | RODAMIENTO 6304 FAG                |    $23.100 | 19/06: 1 × $23.100 · 02/07: 1 × $40.000 · 08/07: 3 × $13.798 |     2 |    $4.402 |
| CA50      | CORREA A50                         |    $11.644 | 08/07: 4 × $12.605                                           |     4 |    $3.842 |
| 6204K     | RODAMIENTO 6204 KOYO               |    $11.900 | 19/06: 4 × $11.900 · 08/07: 6 × $11.198 · 11/07: 2 × $16.807 |     7 |    $3.269 |
| 2.51A3/4  | POLEA 2.5 1A 3/4                   |     $9.063 | 18/06: 2 × $12.605 · 16/07: 1 × $9.076                       |     1 |    $2.366 |
| 31A5/8    | POLEA 3 1A 5/8                     |    $11.457 | 11/06: 4 × $11.429 · 11/06: 4 × $12.857                      |     2 |    $1.372 |
| NI1/2G    | NIPLE 1/2 GALVANIZADO              |     $1.380 | 25/06: 2 × $2.000                                            |     2 |    $1.240 |
| 3.51A5/8  | POLEA 3.5 1A 5/8                   |    $11.764 | 12/06: 2 × $12.857                                           |     1 |    $1.093 |
| 6203TIM   | RODAMIENTO 6203 TIMKEN             |     $8.706 | 19/06: 4 × $8.706 · 08/07: 5 × $8.936                        |     6 |      $768 |
| 62B28     | POLEA 6 2B 28                      |    $44.537 | 07/07: 1 × $44.958                                           |     1 |      $421 |
| CA35      | CORREA A35                         |     $6.827 | 13/06: 5 × $7.000                                            |     2 |      $345 |
| 2.52A5/8  | POLEA 2.5 2A 5/8                   |    $16.500 | 12/06: 2 × $16.471                                           |     2 |       $58 |
| 21A3/4    | POLEA 2 1A 3/4                     |     $7.410 | 11/06: 6 × $7.395 · 11/06: 4 × $7.395                        |     3 |       $45 |
| 31A3/4    | POLEA 3 1A 3/4                     |    $11.457 | 16/07: 1 × $11.429                                           |     1 |       $28 |

> ⚠️ **FP1/2** merece una mirada aparte: la compra del 15/07 quedó registrada a **$0** el
> unitario. O fue un regalo del proveedor, o alguien no escribió el costo al recibir.

De la mitad de esta tabla hacia abajo el descuadre es de unos pocos miles de pesos: si
no tienes tiempo, no pasa nada por dejarlos.

---

## Grupo C — Sin stock: **no hagas nada**

Estos tienen el costo mal, pero hoy hay **0 unidades**, así que no están mintiendo en
ningún margen. En cuanto los vuelvas a comprar, el sistema los corrige solo con el
arreglo que ya está activo. Se listan solo para que sepas que existen.

| Ref     | Producto                         | Costo hoy | Lo que se pagó                        |
| ------- | -------------------------------- | --------: | ------------------------------------- |
| 32A5/8  | POLEA 3 2A 5/8                   |       $50 | 11/06: 2 × $19.916                    |
| 4.51A24 | POLEA 4.5 1A 24                  |       $50 | 14/07: 1 × $16.471                    |
| TT8     | TEE TUBIN 8M                     |    $1.647 | 07/07: 2 × $8.000 · 09/07: 1 × $8.000 |
| CB90    | CORREA B90                       |   $21.008 | 08/07: 2 × $29.412                    |
| CA75    | CORREA A75                       |    $9.874 | 11/06: 1 × $16.807                    |
| 17-25   | ARRANCADOR 17-25                 |  $180.200 | 25/06: 1 × $147.000                   |
| PEA     | PLIEGO DE EMPAQUETADURA ALBESTON |  $155.300 | 01/07: 2 × $130.504                   |
| 5.52A28 | POLEA 5.5 2A 28                  |   $40.000 | 22/06: 2 × $39.916                    |
| 41A5/8  | POLEA 4 1A 5/8                   |   $15.216 | 11/06: 1 × $15.126                    |
| 41A28   | POLEA 4 1A 28                    |   $15.216 | 24/06: 1 × $15.126                    |

---

## Aparte — 3 productos con costo en $0 (caso distinto)

**Esto no viene del error de las compras.** El 16 de julio a las 02:14, un proceso sin
usuario identificado puso estos costos en cero. **No sabemos qué lo causó** y no vamos a
inventar una explicación. Lo que sí sabemos: los valores que tenían ANTES también eran
absurdos (¿$803.816 de costo para un tapón que vendes a $5.000?), así que el antes y el
después están mal. Estos tres nunca han tenido una compra registrada en el sistema, que
es probablemente el origen del disparate.

Como venden con costo $0, **hoy reportan 100% de ganancia falsa**.

| Ref    | Producto                     | Costo hoy | Costo absurdo anterior | Precio venta | Stock |
| ------ | ---------------------------- | --------: | ---------------------: | -----------: | ----: |
| TA1/2G | TAPON 1/2 GALVANIZADO HEMBRA |    **$0** |               $708.765 |       $5.000 |    64 |
| UG3/8  | UNION DE 3/8 GALVANIZADO     |    **$0** |               $802.855 |       $6.000 |    24 |
| TA1/4G | TAPON 1/4 MACHO GALVANIZADO  |    **$0** |               $803.816 |       $5.000 |     0 |

Aquí no hay nada que calcular: **son accesorios de ferretería y tú sabes lo que te
cuestan**. Ponles el valor real desde la app y quedan bien.

---

## Resumen

|                                                    | Productos |         Descuadre |
| -------------------------------------------------- | --------: | ----------------: |
| Ya corregidos automáticamente (certeza matemática) |         6 |        $2.101.900 |
| Grupo A — los 5 grandes                            |         5 |        $2.866.000 |
| Grupo B — con stock                                |        27 |         ~$770.000 |
| Grupo C — sin stock, se autocorrigen               |        10 |            $0 hoy |
| Costos en $0 (caso aparte)                         |         3 | margen 100% falso |

El margen histórico ya reportado quedó inflado en **$140.935** comprobables. Eso no se
puede reexpresar: los cierres pasados quedan como están.
