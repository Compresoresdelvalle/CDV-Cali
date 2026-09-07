# Qué cambió en la aplicación

## Guía de las novedades del 5 y 6 de septiembre de 2026

Estos dos días entraron cinco cosas nuevas y quedó una a medio camino. Esta guía
explica qué hace cada una, quién la usa y qué cambia en el trabajo del día. No
hace falta leerla de corrido: cada sección se entiende sola.

---

## Retenciones en ventas y órdenes de trabajo

Cuando un cliente grande compra, no paga el total de la factura. Descuenta las
retenciones y las consigna a la DIAN o al municipio a nombre de la empresa. La
factura sigue diciendo diez millones, pero al banco entran nueve y medio.

Hasta ahora la aplicación no sabía nada de eso. El cierre de caja sumaba el
total de la venta, así que contaba como ingreso una plata que nunca llegó, y
Cuentas por Cobrar dejaba al cliente debiendo un saldo que jamás iba a pagar
porque ya se había ido a la DIAN.

Ahora, tanto en Nueva Venta como en la Orden de Trabajo, aparece un bloque
plegable donde se capturan las tres retenciones: retefuente, reteICA y reteIVA.
Va plegado por defecto, así que quien no las necesita ni lo nota. Al abrirlo,
las tarifas sugeridas ya vienen cargadas y se pueden editar desde
Configuración.

Lo importante es lo que pasa después. El recibo impreso muestra el total, las
retenciones y el neto que de verdad entra. El saldo de la orden se mide contra
lo cobrable y no contra el total, porque si se midiera contra el total la orden
nunca se podría entregar: el cliente jamás va a abonar una plata que ya
consignó a la DIAN. Y el cierre de caja deja de contar como ingreso lo que no
llegó.

**Quién la usa.** Vendedoras y administración, en las ventas y órdenes donde el
cliente retiene.

---

## Anular un cambio de producto

Cuando se cambia un producto por otro, la aplicación deja dos registros
enlazados: la devolución del producto viejo y la venta de la diferencia
cobrada. Hasta ahora ninguno de los dos se podía anular. La devolución mandaba
a anular la venta del cambio, y la venta rechazaba porque era la diferencia de
un cambio. Cada mensaje remitía al otro y no había salida por la interfaz: todo
cambio mal registrado terminaba corrigiéndose a mano con una consulta directa a
la base.

El bloqueo en sí estaba bien puesto, porque anular solo una de las dos partes
descuadraría el inventario. Lo que faltaba era la operación completa, que
deshace las dos al tiempo. Ahora existe y se hace desde la aplicación.

**Quién la usa.** Administración, desde el detalle de la venta.

---

## Panel de decisiones

El panel anterior mostraba cuánto se facturó, nunca cuánto se ganó. Y el
selector de Hoy, Semana y Mes solo movía una tarjeta: todo lo demás, el
desglose por sede, el top de productos y la tendencia, estaba clavado por
dentro a "este mes". No es que el filtro estuviera mal hecho, es que no
existía.

El panel nuevo tiene rangos de fecha de verdad, que gobiernan todo lo que se ve
en pantalla, y una barra que dice en español qué rango está aplicado. Debajo
aparece la cascada del resultado, que es el camino desde lo facturado hasta lo
que queda, con el detalle de cada pérdida.

Ahí está lo que más vale la pena mirar. Sobre los últimos noventa días, la
aplicación encontró seis millones y medio de pesos vendidos por debajo del
costo, repartidos en ciento tres líneas y cincuenta y un productos. Esa plata
llevaba meses en la base y el panel viejo no la mostraba en ninguna parte.

También trae la composición de la venta por siete dimensiones, con la
posibilidad de ver los peores casos por margen y por volumen, la cartera
ordenada por antigüedad, el inventario visto como capital inmovilizado, y la
opción de exportar a CSV exactamente lo que se está viendo.

**Quién lo usa.** Administración.

---

## Picking de recepción de compras

Esta es la más grande de las cinco y cambia una rutina diaria de bodega.

### Qué pasaba antes

Cuando llegaba mercancía del proveedor, se pulsaba un botón y la compra entera
se daba por recibida. El inventario subía exactamente lo que decía la factura,
hubiera llegado o no. No había dónde anotar que faltaron tres unidades, que dos
llegaron partidas o que mandaron dos de más.

Las consecuencias no se veían ese día. Se veían semanas después, cuando el
conteo cíclico marcaba un descuadre y ya nadie sabía si había sido robo, error
de digitación o mercancía que el proveedor nunca despachó. Para entonces ya no
había a quién reclamarle.

### Cómo funciona ahora

El flujo es el mismo de siempre hasta un punto: llega la mercancía y se registra
la compra. La diferencia es que ahora, si la compra tiene productos y quien la
registra es Bodega o Administración, el botón principal dice **Registrar y
contar** y lleva derecho a la pantalla de conteo. También se puede llegar
después, desde el detalle de una compra que quedó pendiente.

La pantalla se adapta al aparato. En celular muestra un producto a la vez, con
botones grandes, como el picking de traspasos que ya se conoce. En tablet y
computador muestra la lista completa. Se puede cambiar de vista cuando se
quiera y la aplicación recuerda la preferencia.

Cada línea pide dos números y calcula el resto sola: cuántas unidades llegaron
y, de esas, cuántas venían dañadas. El contador **arranca en cero** y el
operario suma, porque si viniera con el pedido puesto bastaría pasar de largo
para que el sistema jurara que todo llegó. Para no perder tiempo hay un atajo de
un toque que dice "Llegó completo", y otro para "No llegó nada".

La forma más rápida de contar es el escáner. Se abre una vez, se deja abierto, y
cada pieza que se escanea suma una unidad a su línea.

### Las preguntas que aparecen

Solo cuando hay diferencia, y cada una tiene consecuencias distintas.

Si faltó mercancía, la aplicación pregunta si el proveedor la facturó. Si
responde que no la despachó ni la cobra, la factura de la compra baja sola y no
se le reclama nada. Si responde que sí viene facturada, la factura no se toca y
esas unidades quedan como un reclamo abierto al proveedor.

Si algo llegó dañado, se reclama siempre, sin preguntar. Llegó, pero no sirve.

Si llegó de más, entra al inventario igual, porque físicamente está en la
bodega. La pregunta es solo si además hay que reportárselo al proveedor.

### Antes de confirmar

La pantalla no deja recibir mientras falten líneas por contar, y dice cuántas
faltan con un botón que lleva directo a la primera pendiente. Cuando ya está
todo, el modal de confirmación explica en palabras qué va a pasar: cuánto sube
el inventario, a cuánto baja la factura y por qué, cuántas unidades quedan para
reclamar y a qué proveedor, y cuántas entran de más.

Si por alguna razón toca recibir sin contar, se puede. El botón está ahí, en
letra pequeña, con una advertencia que dice el daño concreto: que el inventario
va a decir que llegaron todas aunque hayan llegado menos, y que cualquier
faltante después va a quedar como pérdida de bodega y no como algo que el
proveedor debía. Queda registrado quién lo saltó.

### Dos cosas que conviene saber

El conteo se guarda solo en el aparato mientras se cuenta. Si se apaga el
celular en la línea treinta y ocho de cuarenta, al volver a entrar la aplicación
ofrece retomar el conteo donde iba.

Y no aplica a todo. El picking solo aparece en compras que tienen productos.
Una compra de caja menor, un recibo de transporte o de papelería, se recibe
directo como siempre, sin conteo y sin advertencias. Las vendedoras también
siguen trabajando igual que antes: el conteo es para Bodega y Administración.

**Quién lo usa.** Bodega y Administración.

---

## Aviso urgente al administrador

Mientras se cuenta puede aparecer algo que el operario no sabe resolver: llegó
un bulto roto, el proveedor mandó otra cosa, falta una caja. Antes tocaba salir
a buscar a alguien.

Ahora hay un botón para avisarle a Maritza sin salir de la pantalla. Se escribe
en corto qué está pasando y ella recibe un aviso que ocupa toda la pantalla y no
se puede ignorar, con quién avisó, desde dónde y por qué, más un botón para ir
directo a la compra.

Si no estaba conectada, el aviso es lo primero que ve al abrir la aplicación. Y
para que esto no se convierta en ruido, cada situación admite máximo dos avisos.
Al segundo, el botón lo dice claro y no deja mandar más.

**Quién lo usa.** Cualquiera que esté contando. Lo recibe Administración.

---

## Lo que quedó a medias

Hay una sexta cosa que está a mitad de camino y conviene saberlo.

Se corrigió un problema de plata en las garantías. Había tres caminos para
devolverle dinero a un cliente (la devolución, la garantía sobre la venta y la
garantía sobre la orden de trabajo) y ninguno se enteraba de los otros. Se podía
devolver el total de una compra más de una vez, y como los reembolsos salen como
egreso del cierre del día, era plata duplicada de verdad.

**Esa corrección ya está activa.** Ahora los tres comparten un solo tope y el
sistema no deja pasarse. No hay nada que hacer para activarla.

Lo que no quedó desplegado es la pantalla que la acompaña: un botón para
registrar el reclamo de un cliente sobre una orden de trabajo. Hoy, si alguien
reclama por un trabajo de taller, sigue habiendo que registrarlo entrando por la
factura. El código está listo y probado, esperando el visto bueno para salir.

---

## Un pendiente conocido

Se reportó que a veces, al entrar a Nueva Compra, la pantalla queda pegada y no
deja llenar los campos. Recargar la página con F5 la destraba.

Todavía no se encuentra la causa. Ya se descartaron las sospechas obvias, así
que hace falta ver el error que queda en la consola del navegador cuando pasa.
Si le ocurre, pulse F12, abra la pestaña Console y guarde lo que aparezca en
rojo. Con eso se puede cerrar.

Mientras tanto hay dos salidas: recargar destraba, y si el conteo llegara a
fallar siempre queda el botón de recibir sin contar, que es el camino de
siempre.
