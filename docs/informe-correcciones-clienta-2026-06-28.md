# Informe de correcciones y mejoras del sistema

**Compresores del Valle S.A.S.**
**Fecha:** 28 de junio de 2026
**Asunto:** Correcciones en el cierre de caja, cuentas por cobrar/pagar, órdenes de trabajo y mejoras de uso
**Estado:** Correcciones de base de datos aplicadas en producción. Los ajustes de pantalla quedan listos para la próxima actualización.

---

## 1. Resumen ejecutivo

Se realizó una auditoría a fondo del manejo del dinero en el sistema (cierre de caja, arqueo, cuentas por cobrar y por pagar, y su relación con las órdenes de trabajo). Se detectaron y corrigieron varios puntos donde el dinero **se contaba dos veces** o **se contaba antes de tiempo**, además de incorporar mejoras de uso solicitadas.

| #   | Corrección                                                            | Tipo              | Impacto |
| --- | --------------------------------------------------------------------- | ----------------- | ------- |
| 1   | El dinero de las órdenes de trabajo se contaba dos veces en el cierre | Error de dinero   | Alto    |
| 2   | El efectivo de una OT entregada el mismo día desaparecía del arqueo   | Error de dinero   | Alto    |
| 3   | Los cobros y pagos de cartera no se reflejaban en el arqueo           | Error de dinero   | Medio   |
| 4   | **Compras/ventas a crédito afectaban el cierre sin haberse pagado**   | Error de dinero   | Alto    |
| 5   | El tablero (dashboard) mostraba ingresos de servicios inflados        | Error de dinero   | Medio   |
| 6   | Anular un cobro o pago no pedía confirmación ni motivo                | Seguridad         | Medio   |
| 7   | Al convertir una cotización en venta, el método de pago quedaba mal   | Consistencia      | Bajo    |
| 8   | Se podían registrar abonos en una OT sin valor asignado               | Control           | Medio   |
| 9   | Nueva sección para administrar "Equipos ensamblables"                 | Mejora            | —       |
| 10  | Filtro por fecha en los listados                                      | Mejora            | —       |
| 11  | Los técnicos podían registrar devoluciones de herramientas            | Permisos          | Medio   |
| 12  | No se podía buscar por referencias con punto decimal (ej. "2.5")      | Error de búsqueda | Medio   |
| 13  | OT no autorizada obligaba a descargar repuestos para poder cerrarla   | Error de flujo    | Alto    |
| 14  | Nuevo: cambio de producto con cobro/devolución de la diferencia       | Función nueva     | —       |
| 15  | Técnicos podían ejecutar y facturar órdenes (debe ser solo Ventas)    | Permisos          | Medio   |
| 16  | Perfil de Bodega/caja sin acceso de solo-lectura al cierre            | Permisos          | Medio   |
| 17  | Nuevo: pago mixto (efectivo + transferencia) en una sola factura      | Función nueva     | —       |

También se revisaron dos puntos reportados que **resultaron no ser errores** del sistema (cantidades decimales y precios decimales). Se explican en la sección **"Aclaraciones"** al final.

> **Aclaración importante:** el **arqueo de caja** (el conteo del efectivo físico) ya venía calculando bien el efectivo. Los errores afectaban principalmente los **totales del cierre** (Ingresos, Egresos, Margen) y el **tablero**, que ahora quedan alineados con el efectivo real.

---

## PARTE A — Cierre de caja y manejo del dinero

### 1. El dinero de las órdenes de trabajo se contaba dos veces

**¿Qué pasaba antes?**
Cuando un cliente pagaba una orden de trabajo (OT) en abonos y luego se le entregaba el equipo, el sistema **sumaba ese dinero dos veces**: una vez como abono (cuando el cliente pagaba) y otra vez como venta (cuando se entregaba y facturaba). Si el abono y la entrega caían en cierres distintos, el mismo dinero aparecía en **dos cierres diferentes**, inflando los ingresos.

**Ejemplo real encontrado:**
Una OT recibió un abono de **$400.000 el 16 de junio** (que entró al cierre de ese día) y se entregó/facturó el **24 de junio**. El sistema volvía a sumar la venta el 24 → el mismo dinero quedaba contado en dos cierres.

**¿Cómo funciona ahora?**
El dinero de una OT se cuenta **una sola vez: el día en que el cliente abona**. La factura de la OT ya no se vuelve a sumar al cierre (es solo el documento de respaldo; el dinero ya había entrado a través de los abonos).

**Beneficio:** los "ingresos por servicios" del cierre reflejan el dinero realmente recibido, sin duplicados.

---

### 2. El efectivo de una OT entregada el mismo día desaparecía del arqueo

**¿Qué pasaba antes?**
Si una OT se pagaba en efectivo y se entregaba el **mismo día**, ese efectivo **no aparecía** en el "efectivo esperado" del arqueo. Resultado: la caja mostraba un **sobrante sin explicación** al cuadrar.

**¿Cómo funciona ahora?**
El efectivo de los abonos de OT se cuenta **siempre por su fecha**, sin importar si la OT ya se entregó. El arqueo vuelve a cuadrar con el efectivo físico.

**Beneficio:** se elimina un descuadre de caja que aparecía cuando se entregaban OT el mismo día del pago.

---

### 3. Los cobros y pagos de cartera no llegaban al arqueo

**¿Qué pasaba antes?**
Cuando se **cobraba** una venta a crédito en efectivo, o se **pagaba** una factura a un proveedor en efectivo, ese movimiento de efectivo **no se reflejaba** en el efectivo esperado del arqueo.

**¿Cómo funciona ahora?**
El arqueo ahora **suma los cobros en efectivo** y **resta los pagos en efectivo** de cartera. El efectivo esperado refleja todos los movimientos reales de caja del día.

**Beneficio:** el arqueo considera también el dinero que entra/sale por recaudos y pagos de crédito.

---

### 4. Compras y ventas a crédito afectaban el cierre sin haberse pagado _(punto reportado)_

**¿Qué pasaba antes?**
Al ingresar una **factura de compra a crédito**, el sistema la dejaba bien en Cuentas por Pagar, pero **al mismo tiempo la registraba como egreso** en el cierre el mismo día, **aunque no se hubiera pagado nada**. Lo mismo ocurría con las **ventas a crédito**: se contaban como ingreso el día de la venta, aunque el cliente todavía no hubiera pagado. (En contabilidad esto se llama "causación"; lo que se esperaba es manejo de **caja real**.)

**¿Cómo funciona ahora? (caja real)**
El crédito **solo afecta el cierre cuando el dinero realmente se mueve**:

| Operación            | Antes                       | Ahora                                                                                |
| -------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| Compra a crédito     | Egreso el día de la factura | **Solo en Cuentas por Pagar**; entra al cierre como egreso **el día que se paga**    |
| Venta a crédito      | Ingreso el día de la venta  | **Solo en Cuentas por Cobrar**; entra al cierre como ingreso **el día que se cobra** |
| Compra de caja menor | Egreso (correcto)           | Egreso (igual, sin cambios)                                                          |

**Ejemplo real:** una compra a crédito de **$251.506 del 27 de junio** ya **no aparece en egresos** ese día (queda en $0 hasta que se pague). Cuando se registre el pago, ahí sí entra al cierre, el día del pago.

**Beneficio:** "Ingresos", "Egresos" y "Margen" del cierre reflejan **caja real**, igual que el arqueo. El crédito vive en Cuentas por Cobrar / por Pagar hasta que se paga o cobra.

---

### 5. El tablero mostraba ingresos de servicios inflados

**¿Qué pasaba antes?**
El tablero principal del administrador (dashboard) calculaba los "ingresos de servicios del mes" con **el mismo doble conteo** del punto 1.

**¿Cómo funciona ahora?**
Se corrigió igual que el cierre: el dinero de las OT se cuenta **una sola vez, por su fecha de abono**.

**Beneficio:** el tablero muestra cifras de servicios consistentes con el cierre.

---

## PARTE B — Cuentas por cobrar / por pagar y órdenes de trabajo

### 6. Anular un cobro o pago ahora pide confirmación y motivo

**¿Qué pasaba antes?**
En la pantalla de cobros/pagos, al tocar el ícono de eliminar junto a un movimiento, este **se anulaba al instante**, sin confirmación ni registro del motivo. Riesgo de anular por error un registro financiero.

**¿Cómo funciona ahora?**
Al anular un cobro o pago, el sistema:

1. Pide **confirmación**.
2. Permite escribir el **motivo** de la anulación.
3. Deja el movimiento **registrado en la auditoría** (no se borra físicamente; queda como anulado con quién, cuándo y por qué).

**Beneficio:** se evita el borrado accidental y queda trazabilidad de cada anulación.

---

### 7. Método de pago correcto al convertir una cotización en venta

**¿Qué pasaba antes?**
Al convertir una cotización aprobada en venta, esta quedaba **siempre marcada como "efectivo"** (en minúscula), aun cuando tuviera saldo pendiente. Esto generaba inconsistencias: una venta con saldo aparecía como "pagada en efectivo".

**¿Cómo funciona ahora?**

- Si la cotización **ya estaba pagada** → la venta queda como **"Efectivo"**.
- Si **queda saldo pendiente** → la venta queda como **"Crédito"** y entra correctamente a **Cuentas por Cobrar**.

**Beneficio:** las ventas que vienen de cotización reflejan su estado real de pago.

---

### 8. Control de abonos en órdenes de trabajo sin valor

**¿Qué pasaba antes?**
Se podía registrar un abono de **cualquier monto** en una OT que **aún no tenía valor asignado** (total en $0). Esto permitía anticipos desproporcionados (por ejemplo, un abono de $400.000 en una orden que luego valía $2.000), que después descuadraban el cierre.

**¿Cómo funciona ahora?**
El sistema **exige cotizar primero la orden** (asignarle el valor de repuestos y mano de obra) antes de permitir registrar abonos. El asistente de OT ya guía en ese orden: primero la cotización, luego el anticipo.

**Beneficio:** se evita registrar anticipos sobre órdenes sin valor, fuente de descuadres.

---

## PARTE C — Mejoras de uso

### 9. Nueva sección "Equipos ensamblables" en Configuración _(REQ9)_

**¿Qué pasaba antes?**
No existía una forma de administrar desde la aplicación la lista de equipos que se pueden ensamblar.

**¿Cómo funciona ahora?**
En **Configuración** se agregó la sección **"Equipos ensamblables"**, igual que la lista de la checklist de OT. Desde ahí el administrador puede:

- **Crear** un equipo ensamblable (incluso con un nombre provisional, para confirmarlo después).
- **Editar** su nombre, referencia y precio.
- **Quitar** un equipo de la lista.

> **Importante:** "Quitar" solo saca el equipo de la lista de ensamblables; **no afecta su venta ni su inventario** en el resto de la aplicación.

**Beneficio:** el administrador gestiona la lista de equipos ensamblables sin depender de soporte técnico.

---

### 10. Filtro por fecha en los listados _(REQ10)_

**¿Qué pasaba antes?**
En los listados de **Ventas, Cotizaciones, Órdenes de Trabajo y Traspasos** no se podía filtrar por fecha; había que desplazarse manualmente.

**¿Cómo funciona ahora?**
En la **misma barra de búsqueda** que ya tenían, ahora se puede escribir una fecha:

- **`dd/mm/aaaa`** → muestra los documentos de **ese día** (ejemplo: `15/06/2026`).
- **`mm/aaaa`** → muestra los documentos de **ese mes completo** (ejemplo: `06/2026`).

Si no se escribe una fecha, la búsqueda funciona como siempre (por número, cliente, etc.).

**Beneficio:** encontrar documentos de un día o mes específico de forma rápida, sin pantallas nuevas.

---

## PARTE D — Permisos y búsqueda

### 11. Devolución de herramientas restringida a Bodega y Administración

**¿Qué pasaba antes?**
Cualquier usuario con acceso al módulo de Herramientas —incluidos los **técnicos**— podía registrar la **devolución** de una herramienta. El préstamo sí estaba limitado a Bodega/Administración, pero la devolución no exigía perfil: bastaba estar en la misma sede.

**¿Cómo funciona ahora?**
La **devolución de herramientas** quedó restringida a los perfiles **Bodega** y **Administración**. Los técnicos ya **no** ven ni pueden ejecutar esa acción. El control se aplica **tanto en la pantalla como en el servidor**, para que no pueda saltarse.

| Acción sobre herramientas  | Quién puede                                               |
| -------------------------- | --------------------------------------------------------- |
| Crear / Prestar            | Bodega, Administración                                    |
| **Devolver**               | **Bodega, Administración** (antes: cualquiera de la sede) |
| Regresar a stock de insumo | Solo Administración                                       |

**Beneficio:** el control de entrada y salida de herramientas queda en manos de Bodega y Administración, como debe ser.

---

### 12. Búsqueda por referencias con punto decimal (ej. "2.5", "3.5")

**¿Qué pasaba antes?**
La barra de búsqueda **eliminaba el punto** (`.`) de lo que se escribía. Por eso, al buscar una polea por su referencia **"2.5"** o **"3.5"**, el sistema en realidad buscaba **"25"** o **"35"** y no encontraba el producto. Afectaba a cualquier referencia o descripción que tuviera un punto.

**¿Cómo funciona ahora?**
La búsqueda **respeta el punto**. Escribir **"2.5"** encuentra los productos cuya referencia o descripción contiene exactamente "2.5". (Se siguen ignorando solo unos pocos símbolos que podrían dañar la consulta —`, ( ) : *`—, pero el punto ya funciona.)

**Beneficio:** se pueden encontrar productos por referencias con decimales, como las poleas.

---

## PARTE E — Órdenes de trabajo y cambios de producto

### 13. La OT no autorizada ya no obliga a descargar repuestos

**¿Qué pasaba antes?**
Cuando se cotizaban repuestos en una orden de trabajo y luego el cliente **no autorizaba** la reparación, el sistema **no dejaba cerrar la orden** a menos que se **descargaran del inventario** esos repuestos. Es decir, obligaba a sacar del stock unas piezas que **no se iban a usar**, solo para poder marcar la orden como terminada y cobrar la revisión.

**¿Cómo funciona ahora?**
Si el cliente **no autoriza**, la orden se cierra **cobrando únicamente la revisión / diagnóstico**, **sin tocar el inventario**:

- Ya **no** aparece el botón de "Descargar del inventario" en ese caso.
- Una nota explica que los repuestos cotizados **no se descargan** porque no hubo autorización.
- Al marcar como terminada, la cotización de repuestos **se descarta sola**, sin afectar el stock.

**Beneficio:** una orden no autorizada se cierra de forma correcta y rápida, cobrando solo la revisión, sin consumir repuestos que el cliente no aprobó.

---

### 14. Nuevo: cambio de producto con cobro o devolución de la diferencia

**¿Qué se pidió?**
Que cuando un cliente regrese a **cambiar un producto por otro de distinto precio**, el sistema gestione la **diferencia**: cobrar el excedente si el nuevo es más caro, o devolverlo si es más barato, con todo vinculado a la factura original.

**¿Cómo funciona ahora?**
Se agregó un botón **"Registrar cambio"** dentro de la **factura de venta original** (no hay que teclear números ni buscar la venta: se hace desde la venta misma). El flujo es:

1. Se elige, de la factura, **qué producto devuelve** el cliente y la cantidad.
2. Se busca y elige el **producto nuevo** que se lleva y su cantidad.
3. El sistema calcula **automáticamente la diferencia** y muestra si hay que **cobrar** o **devolver**, y cuánto.
4. Al confirmar:
   - El producto devuelto **vuelve al inventario** (entra stock).
   - El producto nuevo **sale del inventario**.
   - Si el nuevo es **más caro**, se **cobra solo la diferencia** (efectivo o transferencia).
   - Si el nuevo es **más barato**, se **devuelve la diferencia** al cliente (en efectivo, queda como egreso del día).

**En el dinero:** el cierre registra **solo la diferencia** (lo que realmente entró o salió), una sola vez, sin doble conteo. El cambio queda **vinculado a la venta original** para su trazabilidad.

**Beneficio:** los cambios de producto se hacen en un solo paso, con el inventario y la caja siempre cuadrados.

> **Nota:** en esta primera versión, la diferencia se cobra en **efectivo o transferencia** y, cuando hay que devolver al cliente, se hace en **efectivo**. La opción de "nota de crédito / saldo a favor" para usar en una compra futura puede agregarse más adelante como mejora aparte.

> **¿Cómo deshacer un cambio?** La venta que registra la diferencia **no se anula por separado** (hacerlo descuadraría el inventario). Para revertir un cambio se registra el **cambio inverso**: se devuelve el producto nuevo y se entrega de vuelta el original. El sistema muestra una nota recordándolo en esa venta.

---

## PARTE F — Roles y permisos

### 15. Los técnicos ya no ejecutan ni facturan órdenes (solo se asignan)

**¿Qué pasaba antes?**
Un técnico podía **operar toda la orden de trabajo** (diagnóstico, cotización, autorización, descarga de repuestos e incluso **facturar/entregar**), igual que Ventas. Eso mezclaba responsabilidades.

**¿Cómo funciona ahora?**
Se separó claramente:

- **Técnicos:** quedan **disponibles para asignarse** a una orden y la **ven en solo-lectura**. Ya no pueden crear, avanzar ni facturar órdenes; tampoco les aparece el botón "Nueva OT".
- **Ventas / Administración:** ejecutan **todo** el proceso (recepción, diagnóstico, autorización, descarga, facturación y cierre).

El control se aplica **en la pantalla y en el servidor** (la base de datos rechaza que un técnico cree, modifique o facture una orden), para que no pueda saltarse.

**Beneficio:** vista más simple para los técnicos, sin confusiones, y el proceso de venta/facturación centralizado en el perfil correcto.

---

### 16. Perfil de Bodega/caja puede consultar el cierre (solo lectura)

**¿Qué se pidió?**
Un perfil para quien recibe caja, que pueda **ver el cierre** y el **inventario de todas las bodegas** en solo lectura, con buen uso desde el celular, **sin** poder configurar, eliminar ni modificar registros críticos.

**¿Cómo funciona ahora?**

- El perfil **Bodega** ahora tiene, en su menú, **"Cierre"** (solo lectura): elige fechas, **previsualiza** los totales (ingresos, egresos, margen, desglose por sede/método/cuenta y arqueo de caja) y consulta el **histórico** de cierres. **No** puede generar/firmar cierres (eso sigue siendo solo de Administración).
- **Ver inventario de todas las bodegas:** ya estaba disponible para el perfil Bodega (puede ver el stock de todas las sedes). Si un usuario puntual no lo veía, era un tema de su cuenta, no del sistema de permisos.
- Sin acceso al Panel de Administración (configuración, usuarios, eliminación de registros): se mantiene restringido.

**Beneficio:** quien maneja la caja puede cuadrar y revisar el cierre del día sin poder alterar nada, desde el celular o el PC.

---

## PARTE G — Pago mixto

### 17. Nuevo: pago combinado (efectivo + transferencia) en una sola factura

**¿Qué se pidió?**
Que cuando un cliente pague una factura **combinando efectivo y transferencia**, el sistema permita registrar **ambas formas** sobre la misma venta, validando que la suma sea igual al total, y que el **cierre las muestre por separado**.

**¿Cómo funciona ahora?**
En **Nueva venta**, además de Efectivo / Transferencia / Tarjeta / Crédito, hay una opción **"Mixto"**:

1. Se ingresa el **monto en efectivo** y el **monto por transferencia** (con su cuenta).
2. El sistema muestra en vivo la **suma vs. el total** y solo deja confirmar cuando **cuadra exactamente**.
3. Al guardar, cada forma de pago queda registrada en su medio correspondiente.

**En el cierre de caja:** la venta cuenta **una sola vez** en los ingresos (sin doble conteo), pero el dinero se reparte por separado:

- El **efectivo** entra a la caja (y al **arqueo**, que espera solo esa parte en efectivo, no el total).
- La **transferencia** entra a su cuenta bancaria.

Así el desglose por método y por cuenta, y el arqueo de efectivo, reflejan exactamente cómo se pagó.

**Beneficio:** se pueden cobrar facturas con pago combinado sin inventar dos ventas, y la caja del día cuadra con el efectivo real recibido.

---

## Aclaraciones — puntos revisados que NO son errores del sistema

Estos puntos fueron reportados y revisados a fondo; **funcionan correctamente por diseño**. Se documentan aquí para dejar claro el porqué y cómo funcionan.

### A. Cantidades con decimales (ej. "2.5 unidades")

**Situación:** se solicitó poder ingresar cantidades con decimales.

**Por qué funciona así:** en todo el sistema las **cantidades son números enteros** (1, 2, 3 …), porque el inventario se maneja por unidades completas. El control de stock, los movimientos y las alertas están construidos sobre esa base; por eso los campos de cantidad no aceptan decimales.

**Aclaración importante:** el caso de las poleas **"2.5" / "3.5"** **no es una cantidad**, es la **referencia/medida del producto** (el tamaño de la polea). Eso se resuelve con la corrección **#12 (búsqueda)**, no con cantidades decimales. Se venden **1, 2, 3 …** poleas "2.5", no "2.5 poleas".

> Si en el futuro se necesita vender productos por fracción (por ejemplo, manguera por metro: 2,5 m), eso requiere una **adaptación específica** del manejo de inventario y puede evaluarse como una mejora aparte.

### B. Precios "exactos" sin redondear (ej. "2.820 pesos")

**Situación:** se pidió que los precios no se redondeen, con el ejemplo "2.820 pesos".

**Por qué funciona así:** en Colombia el punto es el **separador de miles**. "2.820" significa **dos mil ochocientos veinte pesos**, y el sistema lo guarda **exacto** (2.820), **sin redondear**. El peso colombiano **no usa centavos**, por eso los precios se manejan en pesos enteros.

**En resumen:** no hay redondeo. Si se escribe "2.820", el valor guardado es exactamente $2.820. El punto solo separa los miles, como en cualquier factura.

---

## Glosario rápido

| Término              | Significado                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------- |
| **Cierre de caja**   | Resumen del periodo (día o rango) con ingresos, egresos y margen.                            |
| **Arqueo**           | Conteo del efectivo físico de la caja, comparado con lo que el sistema espera.               |
| **Cartera**          | Cuentas por cobrar (lo que deben los clientes) y por pagar (lo que se debe a proveedores).   |
| **OT**               | Orden de trabajo (servicio técnico / reparación).                                            |
| **Abono / anticipo** | Pago parcial que hace el cliente antes de completar el total.                                |
| **Causación**        | Registrar un ingreso o gasto cuando ocurre la operación, aunque no se haya movido el dinero. |
| **Caja real**        | Registrar ingresos y gastos solo cuando el dinero realmente entra o sale.                    |
| **Caja menor**       | Gastos menores pagados en efectivo (registrados como egreso).                                |

---

## Estado y próximos pasos

- **Correcciones de base de datos (puntos 1 a 5, 7, 8, la parte de servidor del 11, el cierre correcto de la OT no autorizada #13, el motor del cambio de producto #14, los permisos de técnicos en OT #15, el acceso de lectura al cierre #16 y el motor del pago mixto #17):** **aplicadas y activas en producción.**
- **Ajustes de pantalla (puntos 6, 11, 12 y 13, las mejoras 9 y 10, la pantalla del cambio de producto #14, y las pantallas de los puntos #15, #16 y #17):** **listos**, se activan con la próxima publicación de la aplicación.
- Todo el trabajo está versionado y respaldado en los repositorios del proyecto.

> **Nota sobre el reporte de caja menor:** se revisó a fondo y la caja menor **ya se registra correctamente como egreso** (tanto en el cálculo interno como en la pantalla del cierre, donde aparece bajo "Egresos — en qué se fue el dinero"). No se encontró ningún punto donde caja menor se sume a las ventas. Si en alguna pantalla específica se sigue viendo distinto, por favor indicarla para revisarla (puede tratarse de información en caché del navegador).
