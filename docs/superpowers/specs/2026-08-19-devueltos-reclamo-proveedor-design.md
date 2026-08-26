# Devolver al proveedor una pieza que quedó en chatarra — diseño

**Fecha:** 2026-08-19
**Estado:** aprobado, pendiente de plan

## El problema

Cuando un cliente devuelve una pieza defectuosa bajo garantía de venta, la app la
reingresa como chatarra: un producto aparte `CHAT-<ref>`, `vendible=false`, precio y
costo 0.

Si esa pieza venía de un proveedor y hay que reclamársela, hoy nadie sabe cómo
hacerlo. La creencia era que la app no lo permitía.

**No es cierto: la capacidad ya existe. Lo que falta es el camino.**

Verificado en el código:

- `DevolucionNueva.jsx:94-98` busca productos con `.eq("activo", true)` y **no filtra
  `vendible`**. Las chatarras se crean con `activo=true`, así que aparecen en la
  búsqueda.
- El stock de una chatarra vive en `inventario.cantidad` del producto `CHAT-`, igual
  que cualquier otro, así que la validación de stock de la devolución a proveedor pasa
  sin problema.
- `TraspasoNuevo.jsx:66-68` filtra igual, así que una chatarra también se puede
  traspasar entre sedes.
- Los movimientos ya ligan cada chatarra con la garantía que la produjo:
  `referencia_id = <garantia_id>`, `referencia_tipo = 'garantia_venta'`,
  `tipo = 'garantia_entrada'`.

O sea que hoy alguien podría buscar `CHAT-FA-2236` en Devoluciones y mandarla al
proveedor. Nadie lo hace porque no hay nada que lo sugiera.

## La decisión

**No se pregunta nada al recibir la pieza.** Todo sigue yendo a chatarra, exactamente
como hoy. Desde el detalle de la garantía, Bodega y Admin ven la chatarra que se
generó y tienen ahí el botón para mandarla al proveedor.

### Por qué así y no preguntando al recibirla

Se evaluó un diseño alternativo —preguntar el destino al recibir la pieza, con un
compartimento `inventario.cantidad_reclamo` aparte— y **se descartó por
sobreingeniería.** El motivo, en orden de peso:

1. **Funciona con lo que ya existe.** El diseño alternativo solo servía para garantías
   futuras; este arregla también todas las chatarras que ya están en el sistema.
2. **No toca `fn_abrir_garantia_venta`**, que es la función de más tráfico y la de más
   riesgo del módulo.
3. **No hace falta ninguna columna ni tabla nueva.** La chatarra ya es no vendible, así
   que la garantía de "no revender una pieza que falló" viene gratis; no hay que
   construir un compartimento para conseguirla.
4. **La decisión se toma cuando se sabe.** La vendedora que recibe la pieza no tiene
   forma de saber si el proveedor la va a aceptar. Bodega sí, y más tarde.

También se descartó la opción "buena → vuelve a stock vendible" que se había
considerado antes: al no preguntar nada en el momento de la garantía, deja de tener
dónde vivir. Si alguna vez hace falta, se resuelve con un ajuste de inventario, que
además deja constancia de quién lo decidió.

## Alcance

Solo se contempla la **devolución a proveedor**. Se descartó a propósito habilitar
también la **garantía de compra** desde la chatarra: exigiría enseñarle a
`fn_abrir_garantia_compra` a resolver `CHAT-<ref>` hasta su producto original y a
validar contra `detalle_compra`, tocando una función de producción. A cambio daría el
costo real de la compra y el tope de "no reclamar más de lo comprado" — control que en
una pieza de garantía rara vez se puede aprovechar, porque casi nunca se sabe de qué
compra salió.

Si más adelante se ve que hace falta, es una ampliación aparte.

## El flujo

La chatarra nace en la sede donde el cliente devolvió la pieza. La devolución a
proveedor solo se ofrece desde BODEGA, así que la pieza tiene que llegar allí — que es
justo lo que pasa físicamente para poder despacharla.

```
CHV: garantía de venta → chatarra CHAT-FA-2236 (1 ud)
  │
  │  traspaso a BODEGA        ← refleja el envío real de la pieza
  ▼
BODEGA: chatarra CHAT-FA-2236 (1 ud)
  │
  │  devolución a proveedor
  ▼
PROVEEDOR
```

## Los cambios

### 1. Detalle de la garantía de venta — el camino que falta

**Archivo:** `src/pages/ops/Garantias/GarantiaVentaDetalle.jsx`

Un bloque nuevo, **Piezas devueltas por el cliente**, que consulta los movimientos de
esta garantía (`referencia_tipo='garantia_venta'`, `tipo='garantia_entrada'`) y por
cada chatarra muestra producto, cantidad, sede y stock actual.

El botón es contextual según dónde esté la pieza y cuánto quede:

| Situación                        | Botón                                | A dónde lleva                                          |
| -------------------------------- | ------------------------------------ | ------------------------------------------------------ |
| Chatarra en BODEGA, con stock    | **Devolver al proveedor**            | `/ops/devoluciones/nueva?tipo=proveedor&producto=<id>` |
| Chatarra en otra sede, con stock | **Traspasar a bodega para devolver** | `/ops/traspasos/nuevo?producto=<id>&destino=BODEGA`    |
| Sin stock                        | ninguno, con la razón escrita        | —                                                      |

Ese último caso importa: si la pieza ya salió, el botón no debe aparecer. Ofrecer un
botón que va a fallar es justo lo que la regla del proyecto prohíbe.

Visible solo para Admin y Bodeguero, que son quienes tratan con proveedores.

### 2. `DevolucionNueva` — aceptar preselección por URL

**Archivo:** `src/pages/ops/DevolucionNueva.jsx`

Hoy no lee la query string. Se le añade `?tipo=proveedor&producto=<id>` para llegar
con el tipo y el producto ya puestos.

Dos cuidados, aprendidos del trabajo de ayer con `Inventario.jsx`:

- **Reaccionar al cambio de parámetros, no solo al montaje.** Si el usuario ya está en
  la página y llega otra vez con otros parámetros, React Router no remonta el
  componente y la preselección se ignoraría en silencio.
- **Lista blanca en `tipo`**: solo `cliente` o `proveedor`. El `producto` es un uuid
  que va parametrizado a la consulta, y si no existe o no tiene stock, la página
  simplemente no preselecciona nada.

### 3. `TraspasoNuevo` — aceptar preselección por URL

**Archivo:** `src/pages/ops/TraspasoNuevo.jsx`

Igual: `?producto=<id>&destino=BODEGA`, con las mismas dos precauciones. El destino se
valida contra las sedes reales, no se pasa crudo.

### 4. El mensaje de la anulación

**Archivo:** migración nueva sobre `fn_anular_garantia_venta`

Hoy dice la causa pero no el producto ni la salida:

> No se puede anular: la chatarra ingresada (1 uds en CHV) ya no está disponible (stock 0).

Pasa a decir:

> No se puede anular: la chatarra de "Filtro de aire P-3320" (1 ud en CHV) ya no está
> en inventario, seguramente porque ya se devolvió al proveedor o se dio de baja.
> Revisa su historial en Auditoría; si de verdad hay que anular esta garantía, primero
> haz un ajuste de entrada de esa pieza.

Es el único cambio de base de datos de todo el trabajo, y solo toca el texto de un
`raise exception`.

## Lo que NO se toca

- `fn_abrir_garantia_venta` — sin cambios de ningún tipo.
- `fn_abrir_garantia_compra` — fuera de alcance por decisión explícita.
- `fn_registrar_devolucion` — no hace falta, ya funciona con chatarras.
- Devoluciones de cliente — su selector de destino ya existe y funciona.
- Permisos y roles — sin cambios.
- Esquema de base de datos — ninguna tabla ni columna nueva.

## Riesgos

- **Bajo, y es la principal virtud de este diseño.** El único cambio de servidor es el
  texto de un mensaje de error; toda la lógica de inventario queda intacta.
- La pieza pasa por un traspaso antes de poder devolverse. Es un paso más, pero
  corresponde a lo que ocurre físicamente y deja el inventario contando la verdad.
- El botón depende de leer movimientos por `referencia_id`. Si una garantía muy vieja
  no dejó ese rastro, el bloque saldrá vacío; no rompe nada, simplemente no ofrece el
  atajo.
