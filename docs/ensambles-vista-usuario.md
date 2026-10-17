# Ensambles: cómo se usan, paso a paso

**Para quién es esto:** para entender cómo trabaja una persona con el módulo de
Ensambles en el día a día, sin entrar en la base de datos. La explicación técnica
está en `ensambles-explicacion-tecnica.md`.

Al final hay un ejemplo completo traducido a un gastrobar.

---

## 1. Qué es un ensamble, en una frase

**Coger varias cosas del inventario y convertirlas en una cosa nueva.**

En Compresores del Valle: un motor, un tanque y un cabezote se convierten en un
compresor listo para vender. En un bar: azúcar y agua se convierten en dos litros
de jarabe.

Cuando se hace un ensamble, la app **saca** del inventario lo que se gastó y
**mete** lo que se armó. Nadie tiene que hacer esas cuentas a mano.

---

## 2. Lo primero que hay que entender: cada producto tiene dos montones

La app guarda el inventario de cada producto en dos montones separados:

| Montón     | Para qué es                           | Ejemplo                          |
| ---------- | ------------------------------------- | -------------------------------- |
| **Venta**  | Lo que se vende en el mostrador       | 6 motores para vender sueltos    |
| **Insumo** | Lo que está apartado para armar cosas | 4 motores para armar compresores |

```
   Motor 2HP en BODEGA
   ┌────────────────────┬────────────────────┐
   │   VENTA:   6       │   INSUMO:  4       │
   │   (para vender)    │   (para armar)     │
   └────────────────────┴────────────────────┘
```

**El ensamble solo gasta del montón de insumo.** Así nunca se vende un motor que el
técnico ya tiene en la mesa.

Si se va a armar algo y lo que hace falta está en el montón de venta, hay que
**pasarlo a insumo** primero. La app ofrece hacerlo ahí mismo, con un botón.

---

## 3. Quién hace qué

Normalmente participan dos personas:

| Persona                                        | Qué hace                                   |
| ---------------------------------------------- | ------------------------------------------ |
| **Quien crea el ensamble** (vendedora, bodega) | Dice qué se va a armar, cuántos, y con qué |
| **El técnico**                                 | Lo arma físicamente y avisa cuando terminó |

Y el administrador puede hacer todo, ver los costos y deshacer.

Si no hay técnico, quien lo crea también lo arma. En la pantalla aparece la opción
**"Sin técnico (lo armo yo)"**.

---

## 4. El camino completo

Un ensamble pasa por tres estados. Se ven como columnas o como pestañas en la lista
de ensambles: **En proceso**, **Terminados** y **Completados**.

```
   ┌─────────────┐   el técnico    ┌─────────────┐  quien lo creó  ┌─────────────┐
   │ EN PROCESO  │ ──────────────► │ TERMINADO   │ ──────────────► │ COMPLETADO  │
   │ se arma     │  "Ensamble      │ esperando   │  "Completar     │ ya está en  │
   │ la receta   │   terminado"    │ visto bueno │   ensamble"     │ inventario  │
   └─────────────┘                 └─────────────┘                 └─────────────┘
          ▲                               │
          └───── "Reabrir para corregir" ─┘
```

### Paso 1. Crear el ensamble

Se entra a **Operaciones → Ensambles → Nuevo ensamble**.

1. **Escoger qué se va a armar.** Se busca escribiendo al menos dos letras. Solo
   aparecen los productos que el administrador marcó como **ensamblables**. Si el
   que se busca no sale, hay que pedirle al administrador que lo agregue en
   _Configuración → Equipos ensamblables_.
2. **Decir cuántos.** Cuántas unidades van a salir.
3. **Escoger el técnico**, o dejar _"Sin técnico (lo armo yo)"_.
4. **Agregar los insumos.** Se busca cada uno y se le pone la cantidad. También se
   puede usar el **escáner de QR**: se escanea la etiqueta del producto y se
   agrega solo, y queda listo para escanear el siguiente.
5. **Registrar ensamble.**

Mientras se buscan insumos hay dos modos:

| Modo                  | Qué muestra                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------ |
| **Solo insumos**      | Lo que es insumo o ya tiene stock de insumo. Se puede agregar aunque tenga 0 y convertirlo |
| **Inventario global** | Todo el inventario. Al agregar algo que está en venta, se convierte a insumo               |

Al lado de cada insumo se ve cuánto hay disponible en el montón de insumo.

> **Importante:** apenas se registra el ensamble, **los insumos salen del
> inventario.** No al final. Se considera que ya salieron del estante y están en la
> mesa de trabajo.

### Si falta un insumo

La app no deja agregar más de lo que hay en el montón de insumo. Si hace falta,
aparece **"Convertir a insumo"**: se pasa la cantidad que falta desde el montón de
venta, y se confirma.

```
   Necesitas 2 motores. En insumo hay 0. En venta hay 6.
   ┌────────────────────────────────────────────┐
   │  Convertir a insumo:  [ 2 ]                │
   │  ¿Seguro? Se le avisará al administrador.  │
   │            [Cancelar]  [Sí, convertir]     │
   └────────────────────────────────────────────┘
   Después:  venta 4   ·   insumo 2   →   se agregan los 2 al ensamble
```

Cuando la conversión no la hace el administrador, a él le llega un aviso. Todos los
avisos del día de una misma sede se juntan en uno solo, para no llenarle la campana.

### Paso 2. Ajustar la receta mientras se arma

En el detalle del ensamble, mientras esté **en proceso**, se puede:

| Acción                          | Qué pasa con el inventario               |
| ------------------------------- | ---------------------------------------- |
| **Agregar** un insumo que faltó | Sale del montón de insumo                |
| **Subir** la cantidad           | Sale solo la diferencia                  |
| **Bajar** la cantidad           | Vuelve la diferencia al montón de insumo |
| **Quitar** un insumo que sobró  | Vuelve completo al montón de insumo      |

Esto es útil porque al armar casi siempre pasa algo: se usó un acople de más, o un
tornillo resultó no hacer falta. La receta se corrige y el inventario queda bien
solo.

Solo puede editar la receta **quien creó el ensamble** o el administrador.

### Paso 3. El técnico avisa que terminó

Cuando el equipo está armado, el técnico toca **"Ensamble terminado"**.

Desde ese momento **la receta queda congelada**: ya no se puede agregar ni quitar
nada. Es la forma de decir "esto es lo que de verdad lleva".

No se puede marcar terminado un ensamble sin ningún insumo.

### Si hay que corregir algo después de terminado

**"Reabrir para corregir"** lo devuelve a _en proceso_. Se corrige la receta y se
vuelve a marcar terminado.

### Paso 4. Completar

Quien creó el ensamble revisa y toca **"Completar ensamble"**. La app pide
confirmar, porque es definitivo.

Al completar:

1. El producto armado **entra al montón de venta**, listo para vender.
2. La app calcula **cuánto costaron los materiales** y actualiza el costo del
   producto.
3. Al administrador le llega un aviso: _"Se ensamblaron 2 uds de "Compresor 2HP" en
   BODEGA (costo de materiales: $ 1.250.000). Revisa el precio/costo del
   producto."_ Es para que revise si el precio de venta sigue teniendo sentido.

No se puede completar algo que el técnico no marcó como terminado.

### Paso 5 (solo si algo salió mal). Eliminar

Solo el administrador puede eliminar un ensamble. Al hacerlo:

- Los insumos **vuelven** al montón de insumo.
- Si ya estaba completado, el producto armado **sale** del inventario.

Pero si el producto armado **ya se vendió o se trasladó**, la app no deja
eliminarlo: no se puede deshacer algo que ya salió de la bodega.

---

## 5. Quién puede hacer qué

|                                |      Admin      |             Bodega             |            Técnico             |           Vendedora            |
| ------------------------------ | :-------------: | :----------------------------: | :----------------------------: | :----------------------------: |
| Ver ensambles                  | todas las sedes |            su sede             |      su sede y los suyos       |            su sede             |
| Crear                          |        ✓        |               ✓                |               ✓                |               ✓                |
| Editar la receta               |        ✓        |           si lo creó           |           si lo creó           |           si lo creó           |
| Marcar terminado               |        ✓        | si lo creó o lo tiene asignado | si lo creó o lo tiene asignado | si lo creó o lo tiene asignado |
| Completar                      |        ✓        | si lo creó o lo tiene asignado | si lo creó o lo tiene asignado | si lo creó o lo tiene asignado |
| Eliminar                       |        ✓        |                                |                                |                                |
| Pasar de venta a insumo        |        ✓        |               ✓                |               ✓                |               ✓                |
| Ver los costos                 |        ✓        |                                |                                |                                |
| Decidir qué se puede ensamblar |        ✓        |                                |                                |                                |

Cada persona trabaja en **su sede**. El administrador trabaja en todas.

---

## 6. Los mensajes que pueden salir y qué hacer

| Mensaje                                                                                                           | Qué significa                            | Qué hacer                                                                     |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| _Stock de insumo insuficiente del componente "X" (necesita 2, hay 0). Convierte stock de venta a insumo primero._ | No hay suficiente en el montón de insumo | Tocar "Convertir a insumo" y pasar lo que falta                               |
| _Ese componente ya está en la receta; edita su cantidad_                                                          | Se intentó agregar dos veces lo mismo    | Cambiar la cantidad del que ya está                                           |
| _La receta está congelada porque el ensamble ya fue marcado como terminado. Usa reabrir para corregir._           | Ya se marcó terminado                    | "Reabrir para corregir"                                                       |
| _No se puede completar: el técnico aún no lo marcó como terminado_                                                | Falta el aviso del técnico               | Esperar al técnico, o que él toque "Ensamble terminado"                       |
| _No se puede completar un ensamble sin componentes: la receta está vacía_                                         | No tiene insumos                         | Agregar al menos uno                                                          |
| _El producto no está marcado como ensamblable_                                                                    | El administrador no lo habilitó          | Pedir que lo agregue en Equipos ensamblables                                  |
| _No se puede deshacer: el producto resultante ya no tiene stock suficiente_                                       | Ya se vendió o se trasladó parte         | No se puede eliminar; si hay un error, se corrige con un ajuste de inventario |
| _Solo puedes crear ensambles en tu sede_                                                                          | Se intentó en otra sede                  | Crearlo en la sede propia, o pedírselo al administrador                       |

---

## 7. Preguntas que siempre salen

**¿Por qué los insumos se descuentan apenas creo el ensamble, si todavía no lo he
armado?**
Porque desde ese momento ya no están disponibles: están en la mesa. Si se
descontaran al final, durante horas el inventario diría que hay algo que en
realidad ya está atornillado, y alguien podría venderlo.

**Me equivoqué en un insumo. ¿Pierdo el inventario?**
No. Mientras no esté terminado, se quita o se cambia la cantidad y vuelve solo.

**Si el motor sube de precio mañana, ¿cambia el costo del compresor que armé hoy?**
No. Cada insumo guarda el costo que tenía cuando se agregó.

**¿El costo del compresor queda igual al de los materiales?**
Se mezcla con lo que ya había en inventario. Si había 2 compresores que costaron
$ 1.000.000 cada uno y se arman 2 más con materiales por $ 2.400.000, el costo
promedio queda en $ 1.100.000.

**¿Por qué tiene que intervenir el técnico y luego otra persona?**
Para que haya dos ojos. El técnico confirma que lo armó; quien lo pidió confirma
que está bien. Recién ahí entra al inventario para venderse.

---

## 8. El mismo flujo, en un gastrobar

### Ejemplo: preparar 2 litros de jarabe de goma

El jefe de barra quiere tener jarabe listo para la noche.

**Antes de empezar:** el azúcar está en el montón de **insumo** de la barra (se
compró para la barra, así que entró directo como insumo).

1. **Crear el ensamble.** Producto: _Jarabe de goma (litro)_. Cantidad: **2**.
   Bartender: _Camilo_.
2. **Agregar insumos.** 2.000 g de azúcar, 1.000 ml de agua. El azúcar **sale del
   inventario en ese momento.**
3. **Camilo lo prepara.** Le sobraron 100 g de azúcar: se baja la cantidad a 1.900
   g y los 100 g **vuelven** al inventario.
4. **Camilo toca "terminado".**
5. **El jefe de barra completa.** Entran **2 litros de jarabe** al inventario, con
   su costo calculado.

Esa noche, cada mojito gasta 30 ml de ese jarabe.

### Lo que en un bar funciona distinto

Este módulo sirve tal cual para lo que se **prepara antes**: jarabes, premezclas,
infusiones, sangría por jarra, cold brew.

Pero **un coctel no se prepara antes: se prepara cuando lo piden.** No tiene
sentido "armar 10 mojitos" y dejarlos en el inventario. Para el coctel de carta, lo
natural es que **al venderlo** la app descuente sola su receta:

```
   Cliente pide 1 mojito
          │
          ▼
   Se registra la venta  ──►  sale del inventario de insumo:
                               60 ml de ron
                               30 ml de jarabe de goma
                               10 hojas de menta
                               1 limón
                               150 g de hielo
```

Para eso, cada coctel necesita una **receta fija guardada** (lo que lleva siempre),
en vez de escoger los insumos uno por uno cada vez.

### Resumen para el bar

| Qué                                    | Cómo se maneja                                           |
| -------------------------------------- | -------------------------------------------------------- |
| Botella o cerveza que se vende cerrada | Venta normal, del montón de venta                        |
| Jarabe, premezcla, infusión, jarra     | **Ensamble**, como en esta guía                          |
| Coctel de carta                        | Al venderlo, se descuenta su receta del montón de insumo |
| Abrir una botella para la barra        | "Pasar de venta a insumo"                                |
| Lo que se derrama o se regala          | Un registro de merma con su motivo                       |

Y dos cosas que en un bar no pueden faltar: que las cantidades se manejen en
**mililitros y gramos** (aquí todo es por unidades enteras, porque son motores), y
que al comprar para la barra el producto **entre directo como insumo**, para no
tener que convertir cada botella que se abre.
