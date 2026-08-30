# Mínimos por sede, ABC de insumos y pedidos desde Reorden · Compresores del Valle

_Guía de las tres funciones nuevas de agosto de 2026. Está escrita para leerse una vez con calma y volver después a la sección que haga falta. No hace falta leerla de corrido._

**A quién le sirve cada parte.** La primera sección, la de mínimos, es la más importante y la usan todos: Maritza en las cuatro sedes, y Bladimir, Deyanira, Edna y Sofía cada una en la suya. La segunda, el ABC, es solo del Panel de Administrador. La tercera es un atajo que ahorra tiempo cuando se hace un pedido.

---

## Índice

1. Mínimos y máximos por sede
2. El ABC ahora mira también lo que se consume
3. Del pedido sugerido a la compra, sin volver a teclear

---

## 1. Mínimos y máximos por sede

### Qué cambió y por qué

Hasta ahora el stock mínimo era **uno solo para toda la empresa**. Si un filtro tenía mínimo 5, las cuatro sedes avisaban con 5, aunque en L3 no se vendiera nunca. Por eso la lista de alertas llegó a tener casi tres mil líneas: la mayoría eran productos que esa sede simplemente no maneja.

Ahora **cada sede tiene su propio mínimo y su propio máximo**. Lo que se define en CV no afecta a CHV. Con eso, las alertas pasaron de 2.961 a 77, y las 77 que quedan son las que alguien decidió vigilar de verdad.

### Lo único que hay que entender bien: el cero

Esta es la idea que hace funcionar todo lo demás.

**Mínimo en 0 significa "esta sede no maneja este producto, no me avises".** No importa si queda en cero unidades: no genera alerta, ni sale en la campana de reposición, ni aparece en Reorden. Es la forma de decirle a la app que ese producto no es asunto de esa sede.

**Mínimo mayor que 0 significa "esto sí me importa aquí".** Cuando las existencias bajan hasta ese número, o hasta cero, la alerta salta.

Conviene tener claro que el mínimo apaga la **alerta**, no la información. En la pantalla de Inventario el producto sigue diciendo "Agotado" en rojo si no hay unidades, porque la vendedora en el mostrador necesita saberlo aunque a nadie le interese reponerlo. Lo que se apaga es el aviso de que hay que comprar.

### El máximo, y por qué no puede ser igual al mínimo

**Máximo en 0 significa "sin techo".** El producto nunca se marca como sobrestock, por muchas unidades que entren. Es lo normal para casi todo.

Si se pone un máximo, tiene que ser **mayor que el mínimo**, no igual. La razón es sencilla cuando se ve con números: con mínimo 10 y máximo 10, cualquier cantidad cae en alerta. Con 10 unidades está "bajo mínimo", con 11 está "sobre el máximo", y no existe ninguna cantidad intermedia que la app pueda considerar correcta. Sería un aviso imposible de resolver, así que la app no deja guardarlo y explica por qué.

El máximo sirve además para calcular cuánto pedir. Cuando hay techo, la sugerencia de compra es lo que falta para llegar a él. Cuando no lo hay, la app propone reponer hasta el triple del mínimo, que es lo bastante para que el producto no vuelva a quedar en alerta al día siguiente.

### Dónde se configura

Hay dos caminos, y conviene usar cada uno para lo suyo.

**Para varios productos a la vez: Inventario, botón "Mínimos".** Es la pantalla nueva, y es la que conviene usar la primera vez, cuando hay que configurar de golpe. Muestra la lista de la sede en orden alfabético por referencia, con el mínimo y el máximo de cada producto editables ahí mismo. Se cambian los que haga falta y se guarda todo junto con el botón de abajo.

**Para un producto suelto: la ficha del producto.** Al abrir un producto desde Inventario, la tabla de existencias por sede tiene ahora una columna con el mínimo y el máximo, y un botón "Configurar" en la fila de la sede propia. Es lo cómodo cuando ya se está mirando ese producto por otra razón.

### Quién puede tocar qué

Maritza configura cualquier sede y tiene un selector para cambiar entre ellas. Las vendedoras y bodega configuran **solo la suya**, y ni siquiera se les muestra el botón en las filas de las demás, para que nadie pulse algo que va a fallar. El servidor lo comprueba igual por su cuenta, así que no hay forma de saltárselo.

También queda registro: cada cambio de mínimo o máximo se guarda con la fecha, quién lo hizo y qué valores había antes. Si un día las alertas de un producto dejan de salir, se puede saber quién las apagó y cuándo.

### Los cuatro filtros de la pantalla de Mínimos

Arriba hay cuatro botones que cambian lo que se lista, y son la diferencia entre configurar con cabeza o a ciegas.

**Todos** muestra el catálogo completo de esa sede, incluidos los productos que esa sede nunca ha tenido. Esos salen marcados como "Nunca ha estado aquí", y aparecen a propósito: son justo los que una sede puede querer empezar a controlar.

**Sin configurar** deja solo los que tienen mínimo en 0, o sea los que no avisan de nada. Es el filtro con el que se empieza.

**Configurados** muestra los que ya tienen mínimo puesto, para revisarlos.

**En alerta** deja los que están bajo mínimo o agotados **entre los configurados**. Es la lista de lo que hay que atender hoy.

### El asistente: "Sugerir por demanda"

El botón "Sugerir por demanda" mira los últimos noventa días de movimiento de esa sede y propone un mínimo y un máximo para cada producto. La cuenta considera todo lo que sale: lo que se vende, lo que se consume en ensambles y órdenes de trabajo, y lo que se despacha a otras sedes.

Ese último punto importa más de lo que parece. La bodega principal casi no vende: despacha. En noventa días salieron de BODEGA 32.943 unidades por traspaso contra 16 por venta. Si la app solo mirara las ventas, le sugeriría mantener una unidad de cada cosa, que es exactamente lo contrario de lo que necesita una bodega.

Una vez calculadas las sugerencias, cada fila muestra la suya y se puede aplicar de una en una, o todas las visibles con el botón de arriba. Ese botón en lote **respeta lo que ya está puesto a mano**: solo toca los productos que no tienen ningún valor configurado, y al terminar dice cuántos se saltó. Así una tarde de trabajo afinando números no se pierde por un clic.

Las sugerencias son una propuesta, no una orden. Están calculadas con un tiempo de reposición de siete días y un colchón de seguridad, valores que Maritza puede cambiar en el asistente de Reorden si la realidad del proveedor es otra.

### Cómo empezar, en la práctica

Lo razonable no es configurar dos mil productos. Es empezar por lo que ya se mueve.

Abrir Mínimos, elegir el filtro **Sin configurar**, pulsar **Sugerir por demanda** y aplicar las sugerencias visibles. Eso deja configurado lo que de verdad tiene movimiento en esa sede, que es una fracción pequeña del catálogo. Con eso las alertas empiezan a servir desde el primer día, y lo demás se va ajustando cuando aparezca la necesidad.

### Cosas que conviene tener presentes

Al entrar por primera vez, casi todo está en cero, o sea que casi nada avisa. Eso es a propósito: es preferible que la app calle hasta que alguien decida qué vigilar, a que grite por tres mil productos y todo el mundo aprenda a ignorarla.

Si se editan varios productos y se cambia de sede sin guardar, la app avisa antes de descartar los cambios. Los cambios sí sobreviven al pasar de página o al filtrar, así que se puede ir configurando por tandas y guardar al final.

Poner un mínimo no mueve inventario. No cambia cantidades, no registra movimientos, no toca nada del stock. Solo dice a partir de qué número hay que avisar.

---

## 2. El ABC ahora mira también lo que se consume

### El problema que tenía

La clasificación ABC ordenaba los productos por lo que se vendía, y a todo lo que no se vendía lo mandaba a la categoría C. Suena razonable hasta que se mira lo que estaba pasando de verdad.

En noventa días, 209 productos clasificados como "C" consumieron **41.896.595 pesos** como insumo en ensambles y órdenes de trabajo. Más que los A y los B juntos. Eran los cabezotes, los tanques, los motores y las unidades de aire seco: las piezas con las que se arma un compresor. Casi no se venden sueltas, pero entran en cada ensamble, y el sistema las trataba como poco importantes.

### Los tres criterios

Ahora la pantalla de Análisis ABC tiene un selector con tres formas de mirar el mismo catálogo, porque son tres preguntas distintas.

**Ventas** responde qué deja plata. Es la clasificación de siempre, con el mismo significado de siempre.

**Consumo** responde qué se acaba siempre, mirando lo que se gasta en ensambles y órdenes de trabajo.

**Combinado** responde qué no puede faltar, sumando las dos cosas en pesos. Es la que guía las compras.

Un mismo producto puede ser C en ventas y A en consumo. Eso no es un error: significa que casi no se vende pero se usa todo el tiempo, y que quedarse sin él frena la producción aunque no se pierda ni una venta directa.

### Qué cambia en la práctica

La pantalla de Reorden ordena ahora las prioridades por el criterio **combinado**, que es la pregunta correcta cuando se está decidiendo qué comprar primero. Por eso la letra que se ve en Reorden puede no coincidir con la que muestra Análisis ABC si allí está seleccionado el criterio de ventas. La propia pantalla de Reorden lo aclara arriba.

Con el cálculo nuevo, 34 productos que estaban sepultados como C aparecen como A o B en la clasificación combinada.

### El botón de recalcular

La clasificación se recalcula sola el día primero de cada mes. Además, el botón **Recalcular ABC** la actualiza en el momento, y ahora usa el periodo que esté seleccionado arriba: último mes, último trimestre o último año.

Elegir el periodo no es un detalle de visualización. Con un mes hay muchos menos productos con movimiento, así que muchos más caen en C. Antes de recalcular, la app dice con números cuántos productos tienen ventas en ese periodo y cuántos quedarán en C, para que la decisión se tome viendo las consecuencias.

Una advertencia útil: el sistema tiene historial desde el primero de junio de 2026, o sea unos tres meses. Mientras eso sea así, elegir "último año" da exactamente el mismo resultado que "último trimestre", porque no hay más datos que mirar.

---

## 3. Del pedido sugerido a la compra, sin volver a teclear

Antes, en Reorden se seleccionaban los productos que hacían falta, se pulsaba "Generar orden de compra", y se llegaba a la pantalla de Nueva compra **con el carrito vacío**. Había que buscar y teclear cada producto otra vez.

Ahora los productos seleccionados llegan puestos, con su cantidad sugerida y su costo. Solo queda poner el proveedor y la factura.

Hay dos detalles que la app resuelve sola y conviene conocer.

Si el mismo producto estaba seleccionado en dos sedes, llega al carrito como **una sola línea** con las cantidades sumadas, porque una compra no distingue sedes.

Y si los productos son insumos de los que no se venden, entran al carrito marcados como insumo, no como stock de venta. Eso evita tener que convertirlos a mano después, que era una molestia conocida.

Sobre la sede hay que tener presente algo: la compra se registra siempre en la sede de quien la hace. Como Reorden solo lo abre Maritza, que está en BODEGA, lo que se pida para CHV, CV o L3 llega a BODEGA y hay que traspasarlo después. La pantalla lo avisa cuando las sugerencias venían de otras sedes, para que nadie busque la mercancía donde no está.

---

## Resumen para tener a mano

Si hay que quedarse con cuatro ideas, son estas.

Mínimo en cero quiere decir "no me avises de esto aquí", y es la forma de quitar ruido sin perder información. El máximo en cero quiere decir "sin techo", y si se pone tiene que ser mayor que el mínimo. Cada sede manda sobre lo suyo, y queda constancia de quién cambió qué. Y la letra ABC que decide las compras ya no es solo la de ventas, porque lo que se consume para producir también cuesta plata.
