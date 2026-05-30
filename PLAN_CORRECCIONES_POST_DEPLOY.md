# PLAN DE CORRECCIONES POST-DEPLOY — COMPRESORES DEL VALLE

## 33 ajustes organizados en 9 bloques de trabajo

Cada bloque = una sesión de Claude Code. Ejecutar en orden (los primeros son
fundacionales y afectan a los demás). Commit de git al terminar cada bloque.

---

## BLOQUE 0 — DATOS Y BACKEND (fundacional)

_Arreglos de base de datos que afectan a todo. Hacer PRIMERO._

1. **Resetear contadores de secuencia.** Las cotizaciones van en 459 pero realmente
   es la #1 porqué se reinicio la app — los contadores no se resetearon al borrar los datos de prueba para
   subir el inventario real. Resetear secuencias de: ventas, cotizaciones, compras,
   traspasos, órdenes, ensambles, devoluciones.
2. **Verificar/crear la DB de clientes.** Confirmar que existe tabla de clientes y
   que funciona para autocompletar en todas las casillas de la app dónde se utilicen clientes.

---

## BLOQUE 1 — PERMISOS Y ROLES (transversal)

_Cambios de acceso que tocan varios módulos. Hacer segundo._

3. **Inventario visible en TODAS las bodegas para TODOS los vendedores.**
   (Antes cada vendedor solo veía su sede — ahora todos ven todos los stocks de las otras sedes.)
   ✅ Hecho en backend (`inv_select=true`). ⚠️ **Aclaración clienta 2026-05-30:** esto es **solo VER**. **VENDER sigue restringido a la sede propia** del vendedor (Admin = cualquiera). La parte de "vender desde otra sede" queda descartada; el flujo de comprar/usar producto de otra sede se resuelve con el botón "Sede" + venta sin stock del Bloque 3 (#10, #11). Migración de la corrección: `20260530000004_bloque1_revert_venta_solo_su_sede.sql`.
4. **Cada producto del inventario debe ser editable/eliminable SOLO por admin.**
5. **Habilitar la opción de cancelar traspasos, solo para el admin.**
6. **El vendedor tiene acceso a la función de órdenes de trabajo y traslados.**

---

## BLOQUE 2 — CATÁLOGO DE PRODUCTOS

_Cambios en cómo se manejan los productos. Afecta ventas y órdenes._

7. **Lógica de "insumos":**
   - Productos categoría "insumos" NO se pueden vender.
   - En órdenes de trabajo y ensambles solo se visualizan para selección productos "insumos".
   - Si un producto no es insumo, dar opción de tomarlo del stock y convertirlo
     en insumo (deja de poder venderse, resta del inventario de ventas)
   - Si no hay stock de un insumo que aparezca la notificación para consultar en el inventario de ventas si está disponible para convertirlo en insumo
8. **Agregar ubicación de los productos de bodega** (pasillo/estante/posición) aparece en la base de datos que cargamos.

---

## BLOQUE 3 — VENTAS (el módulo más grande)

_Hacer después de productos porque depende de la lógica de insumos y sedes._

9. **Editar precio de venta e impuesto durante la venta.**
10. **Opción "venta sin stock"** deja el producto con inventario negativo, se repone cuando se produce la compra pero que alerte que hay inventario negativo para solucionarlo con urgencia.
    📌 **Aclaración clienta 2026-05-30:** este inventario negativo es justamente lo que resuelve el caso "el producto no está en mi sede": en vez de bloquear, el stock baja a negativo y el sistema **pide hacer un traspaso o una compra** para regularizar. **Aplica a TODO lo que disminuye inventario, no solo Ventas → también las OT (Bloque 6) y demás operaciones que restan stock.**
11. **Botón "Sede"** en todas las funciones que requira seleccionar algún producto, cada sede vinculada a su propio inventario. Para así validar dónde está el producto que se va a utilizar.
    📌 **Aclaración clienta 2026-05-30:** desplegable "Sede" que, al elegir una sede, muestra el inventario de ESA sede (consultar sin ir al módulo Inventario; se apoya en `inv_select=true` del Bloque 1). **El vendedor SOLO puede vender de su sede:** si intenta vender un producto que está en otra sede, mostrar **popup con la estética del sistema de diseño** (tokens CSS, sin hardcode): _"No puedes vender este producto porque no está en tu sede. Búscalo en tu sede; si no hay stock, pide un traspaso."_ Implementar el patrón una sola vez (ProductPicker consolidado, ver Bloque 9) y reusar en Venta y OT.
12. **Mostrar TODOS los productos en todas las funciones aunque no tengan stock**; si seleccionan uno sin
    stock, mostrar alerta "sin stock" (no bloquear, solo avisar).
13. **Agregar a qué cuenta bancaria se está pagando** En la venta.

---

## BLOQUE 4 — RECIBOS E IMPRESIÓN

_Depende de ventas y órdenes. Hacer después de ambos._

14. **Ajuste en la información de cualquier recibo** Debe mostrar según el almacen seleccionado:
    - Nombre "Compresores CV"
    - Teléfonos por almacen--> CV: 3127536787 / L3: 3114940799 / CHV: 3174675905
15. **La observación de la venta debe aparecer en el recibo.**
16. **IVA condicional en recibos:** si hay IVA mostrarlo, si no, NO mostrarlo.
    (Hoy dice fijo "IVA 19%".)
17. **Verificar que el recibo previsualizado = el que se imprime** (deben ser idénticos).

---

## BLOQUE 5 — TRASPASOS

_Reorganización del flujo de traslados._

19. **Traslado de productos entre sedes, bodega/sede y sede/bodega** (flujo completo).
20. _(Cancelar traspasos solo admin — ya cubierto en Bloque 1, verificar aquí.)_

---

## BLOQUE 6 — ÓRDENES DE TRABAJO

_Depende de la lógica de insumos (Bloque 2)._

22. **Agregar dirección y teléfonos de la empresa en las órdenes:**
    - Dirección: Calle 34 #4b-30
    - Teléfonos por almacen--> CV: 3127536787 / L3: 3114940799 / CHV: 3174675905
23. **Campo "Sede"** en la orden, que ponga el teléfono de esa sede.
24. **Checklist de recepción debe aparecer en el recibo de la orden.**
25. **Permitir editar cantidades en los repuestos consumidos** en la OT. Hoy en día si se necesita 3 unidades de un producto debe registrarse 3 veces, en vez de poder seleccionar la cantidad desde un inicio
26. _(En OT solo insumos — ya cubierto en Bloque 2, verificar aquí.)_

---

## BLOQUE 7 — ENSAMBLES

_Módulo independiente._

27. **Ingresar manualmente los productos utilizados** en el ensamble.
28. **Casilla de observaciones** en el ensamble (igual que en ventas).
29. **La barra de busqueda en ensambles solo debe desplegar los ensambles pre definidos.** Se proveerá una lista de cuales son. Pidela cuando estemos ejecutando este bloque.
30. **Una vez seleccionado el producto a ensamblar debe habilitarse un espacio dónde el técnico encargado del ensamble pueda seleccionar los insumos empleados en el ensamble y las cantidades** Una vez terminado el ensamble, el producto ensamblado se agrega al inventario de ventas y se restan los insumos utilizados en el ensamble.

---

## BLOQUE 8 — COMPRAS

_Módulo independiente._

30. **Arreglar UX/UI de la barra del proceso proveedor-->productos-->confirmación de las nuevas compras**
31. **Crear "compras de caja menor"** Será seleccionable dentro de las compras pero no aparecerá un valor definido, deberá ser digitado manualmente porqué puede variar el concepto. No es inventariable.

---

## BLOQUE 9 — UX TRANSVERSAL Y CONTEO

_Pulido final. Hacer al último._

32. **Buscador de productos que despliegue la barra completa de todos los productos relacionados con la busqueda.** teniendo en cuenta las palabras clave
33. **Arreglar el placeholder de la barra de búsqueda general.** Hacerla funcional, no que te envíe a otra página
34. **Filtros multi-selección** (poder elegir varias opciones a la vez en los filtros/check box).
35. **Chequear conteo cíclico si es funcional** + agregar la función de hacer chequeo por bodega.

---

## RESUMEN DE BLOQUES

| Bloque | Tema               | Ajustes                           | Prioridad  |
| ------ | ------------------ | --------------------------------- | ---------- |
| 0      | Datos/Backend      | Contadores, DB clientes           | 🔴 Primero |
| 1      | Permisos y roles   | Inventario global, accesos        | 🔴 Segundo |
| 2      | Catálogo productos | Insumos, ubicaciones              | 🟠 Tercero |
| 3      | Ventas             | Precio, sin stock, sede, banco    | 🟠         |
| 4      | Recibos            | Formato, IVA, observaciones       | 🟡         |
| 5      | Traspasos          | Flujo entre sedes, recepción      | 🟡         |
| 6      | Órdenes trabajo    | Datos empresa, insumos, checklist | 🟡         |
| 7      | Ensambles          | Manual, observaciones, búsqueda   | 🟢         |
| 8      | Compras            | UX, caja menor                    | 🟢         |
| 9      | UX + Conteo        | Búsqueda, filtros, conteo         | 🟢 Último  |

🔴 Crítico/fundacional · 🟠 Importante · 🟡 Medio · 🟢 Pulido
