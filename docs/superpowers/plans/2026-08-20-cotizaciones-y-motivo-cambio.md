# Cotizaciones y motivo del cambio — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quitar de las cotizaciones el texto de embalaje que la empresa no ofrece, hacer que salgan a nombre de "Compresores CV", y permitir escribir el porqué de un cambio de producto.

**Architecture:** Todo es frontend, sin una sola línea de base de datos. Los textos duplicados en tres archivos se consolidan en `pdfStyles.js`, que ya es la fuente única de los demás textos fijos. El nombre comercial reutiliza la constante que ya existe para los recibos, renombrada porque deja de ser exclusiva de ellos. El motivo del cambio se concatena con la referencia automática en vez de sustituirla.

**Tech Stack:** React 19, Vite, jsPDF, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-20-ajustes-permisos-cotizaciones-design.md` (grupos A y B)

---

## Antes de empezar

**Rama:** crear `feat/cotizaciones-y-motivo-cambio` desde `main`. No trabajar sobre `main`.

**Verificación:** los tests de integración de este repo usan fixtures que no existen en
esta base y se saltan solos, así que no sirven aquí. La verificación real es
`npx eslint` sobre lo tocado, `npm run build`, y **mirar un PDF de verdad** — que en
este trabajo es lo único que prueba que salió bien.

**Lo que NO se toca, y es lo más importante de este plan:** `MARCA.nombre`
(`"Compresores del Valle S.A.S."`) se queda intacto. Aparece en
`cotizacionPDF.js:279` en la línea _"A nombre de …"_ de la cuenta bancaria, que
identifica al titular ante el banco. Cambiarlo ahí haría que los clientes consignaran a
un titular que el banco no reconoce.

## Estructura de archivos

| Archivo                                         | Responsabilidad                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/lib/pdf/pdfStyles.js`                      | Fuente única: los dos textos fijos y el nombre comercial                       |
| `src/lib/pdf/cotizacionPDF.js`                  | Usar el nombre comercial en las 3 zonas de marca y el texto legal sin embalaje |
| `src/lib/pdf/ventaPOS.js`                       | Solo actualizar el nombre del import renombrado                                |
| `src/pages/ops/CotizacionNueva.jsx`             | Borrar la copia local del texto, importar la compartida                        |
| `src/pages/ops/CotizacionEditar.jsx`            | Igual                                                                          |
| `src/components/ventas/ModalCambioProducto.jsx` | Campo de motivo y su concatenación                                             |

---

# GRUPO A — Cotizaciones

## Task 1: Fuente única de textos y nombre comercial

**Files:**

- Modify: `src/lib/pdf/pdfStyles.js:20-28`

- [ ] **Step 1: Renombrar la constante del nombre comercial**

Hoy es:

```js
// #14 — Nombre comercial corto que va en los RECIBOS (no el nombre legal).
export const RECIBO_NOMBRE = "Compresores CV";
```

Pasa a:

```js
// Nombre comercial corto de la empresa. NO es el nombre legal: para eso está
// MARCA.nombre, que debe seguir usándose donde el nombre tenga valor jurídico
// —en particular el titular de la cuenta bancaria de la cotización—.
// Nació para los recibos (#14) y ahora lo comparten recibos y cotizaciones.
export const NOMBRE_COMERCIAL = "Compresores CV";
```

- [ ] **Step 2: Añadir los dos textos fijos que hoy están duplicados**

Justo debajo de `TEXTO_ENTREGA_COTIZACION`, añadir:

```js
// Condiciones que se muestran en el paso 3 de Cotizaciones (nueva y edición).
// Vivía copiado en CotizacionNueva.jsx y CotizacionEditar.jsx; se unifica aquí
// porque tenerlo por duplicado es justo por qué la mención al embalaje
// sobrevivió tanto: se corregía en un sitio y no en el otro.
// Sin la nota de embalaje: la empresa no presta ese servicio.
export const TEXTO_FIJO_ENTREGA =
  "El cliente se compromete a recibir la mercancía en las condiciones físicas " +
  "en que se entrega. Cualquier reclamo sobre defectos visibles debe realizarse " +
  "al momento de la entrega. Las garantías aplican según política de fábrica del " +
  "producto.";

// Nota legal al pie del PDF de cotización. También sin la mención al embalaje.
export const TEXTO_LEGAL_COTIZACION =
  "Esta cotización es válida hasta la fecha indicada. Las garantías aplican " +
  "según política de fábrica del producto.";
```

- [ ] **Step 3: Borrar la constante muerta que quedaría al lado**

`TEXTO_CONDICIONES_ENTREGA` (líneas 9-11) **no la usa nadie** — verificado con
`grep -rn "TEXTO_CONDICIONES_ENTREGA" src/`, solo aparece en su propia definición.

Es casi idéntica a `TEXTO_ENTREGA_COTIZACION`, que sí se usa. Dejar tres constantes de
nombre parecido, una de ellas muerta, en el archivo donde acabamos de centralizar los
textos, es sembrar exactamente el problema que este trabajo viene a arreglar: alguien
editará la que no toca.

Borrar estas líneas:

```js
export const TEXTO_CONDICIONES_ENTREGA =
  "El producto se entrega únicamente en nuestras instalaciones sin ningún " +
  "costo. Fuera de nuestras instalaciones el flete corre por cuenta del cliente.";
```

Y el comentario de cabecera que la anunciaba (`* Texto fijo de condiciones de entrega
(§1.9 del cliente — INMUTABLE):`), que se queda sin referente.

Run: `grep -rn "TEXTO_CONDICIONES_ENTREGA" src/`
Expected: sin resultados.

- [ ] **Step 4: Verificar que compila**

Run: `npx eslint src/lib/pdf/pdfStyles.js`
Expected: 0 problemas.

Run: `grep -rn "RECIBO_NOMBRE" src/`
Expected: solo queda `src/lib/pdf/ventaPOS.js` (dos líneas: el import y su uso). Se
arregla en la Task 3. `pdfStyles.js` ya no debe aparecer.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdf/pdfStyles.js
git commit -m "refactor(pdf): fuente unica de textos de cotizacion y nombre comercial"
```

---

## Task 2: El PDF de cotización

**Files:**

- Modify: `src/lib/pdf/cotizacionPDF.js:16-21` (imports), `78`, `83`, `303`, `313`

- [ ] **Step 1: Actualizar los imports**

Hoy (líneas 16-21):

```js
import {
  MARCA,
  RECIBO_DIRECCION,
  SEDE_TELEFONO,
  TEXTO_ENTREGA_COTIZACION,
  formatCOP,
} from "./pdfStyles";
```

Pasa a:

```js
import {
  MARCA,
  NOMBRE_COMERCIAL,
  RECIBO_DIRECCION,
  SEDE_TELEFONO,
  TEXTO_ENTREGA_COTIZACION,
  TEXTO_LEGAL_COTIZACION,
  formatCOP,
} from "./pdfStyles";
```

`MARCA` se conserva en los imports: sigue usándose para `MARCA.ciudad` y para el
titular de la cuenta bancaria.

- [ ] **Step 2: Encabezado pequeño (línea 78)**

Hoy:

```js
doc.text("COMPRESORES DEL VALLE", L, y + 17, { charSpace: 0.2 });
```

Pasa a:

```js
doc.text(NOMBRE_COMERCIAL.toUpperCase(), L, y + 17, { charSpace: 0.2 });
```

- [ ] **Step 3: Nombre grande bajo el logo (línea 83)**

Hoy:

```js
doc.text(MARCA.nombre, R, y + 2, { align: "right" });
```

Pasa a:

```js
doc.text(NOMBRE_COMERCIAL, R, y + 2, { align: "right" });
```

- [ ] **Step 4: Nota legal al pie (línea 302-305)**

Hoy:

```js
const legal = doc.splitTextToSize(
  "Esta cotización es válida hasta la fecha indicada. Los precios incluyen embalaje estándar. Las garantías aplican según política de fábrica del producto.",
  W,
);
```

Pasa a:

```js
const legal = doc.splitTextToSize(TEXTO_LEGAL_COTIZACION, W);
```

- [ ] **Step 5: Pie de página (línea 313)**

Hoy:

```js
    `Página ${totalPages} de ${totalPages} · #${cotizacion?.numero ?? "—"} · ${MARCA.nombre}`,
```

Pasa a:

```js
    `Página ${totalPages} de ${totalPages} · #${cotizacion?.numero ?? "—"} · ${NOMBRE_COMERCIAL}`,
```

- [ ] **Step 6: Confirmar que la línea del banco NO se tocó**

Este es el control que impide el error grave de esta tarea.

Run: `grep -n "MARCA.nombre" src/lib/pdf/cotizacionPDF.js`

Expected: **exactamente una línea**, la 279, que es la del titular de la cuenta
bancaria (`A nombre de ${c.titular || MARCA.nombre}`). Si aparecen más, alguna
sustitución se quedó sin hacer. Si aparecen cero, se cambió la del banco por error y
hay que revertirla.

- [ ] **Step 7: Verificar**

Run: `npx eslint src/lib/pdf/cotizacionPDF.js && npm run build`
Expected: 0 problemas y build exitoso.

- [ ] **Step 8: Commit**

```bash
git add src/lib/pdf/cotizacionPDF.js
git commit -m "feat(cotizaciones): PDF a nombre de Compresores CV y sin nota de embalaje"
```

---

## Task 3: El recibo POS sigue funcionando

**Files:**

- Modify: `src/lib/pdf/ventaPOS.js:15`, `112`

- [ ] **Step 1: Actualizar el import y su uso**

Línea 15, dentro del bloque de imports de `./pdfStyles`, cambiar `RECIBO_NOMBRE` por
`NOMBRE_COMERCIAL`.

Línea 112, hoy:

```js
doc.text(RECIBO_NOMBRE, center, y, { align: "center" });
```

Pasa a:

```js
doc.text(NOMBRE_COMERCIAL, center, y, { align: "center" });
```

El recibo imprime exactamente lo mismo que antes: solo cambió el nombre de la
constante, no su valor.

- [ ] **Step 2: Verificar que no queda ningún rastro**

Run: `grep -rn "RECIBO_NOMBRE" src/`
Expected: sin resultados.

Run: `npx eslint src/lib/pdf/ventaPOS.js && npm run build`
Expected: 0 problemas y build exitoso.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pdf/ventaPOS.js
git commit -m "refactor(pdf): ventaPOS usa NOMBRE_COMERCIAL"
```

---

## Task 4: Las dos pantallas de cotización

**Files:**

- Modify: `src/pages/ops/CotizacionNueva.jsx:35-37`
- Modify: `src/pages/ops/CotizacionEditar.jsx:29-31`

- [ ] **Step 1: `CotizacionNueva.jsx` — borrar la copia local**

Borrar estas tres líneas (35-37):

```js
// Texto fijo de condiciones de entrega (Lovable paso 3 · locked, idéntico al PDF).
const TEXTO_FIJO_ENTREGA =
  "El cliente se compromete a recibir la mercancía en las condiciones físicas en que se entrega. Cualquier reclamo sobre defectos visibles debe realizarse al momento de la entrega. Las garantías aplican según política de fábrica del producto. Los precios incluyen embalaje estándar. Embalaje especial bajo cotización adicional.";
```

Y añadir el import desde la fuente única. El archivo ya importa de `../../lib/`, así
que añadir junto a los demás imports:

```js
import { TEXTO_FIJO_ENTREGA } from "../../lib/pdf/pdfStyles";
```

El uso de la línea ~1395 (`{TEXTO_FIJO_ENTREGA}`) no cambia: el nombre es el mismo.

- [ ] **Step 2: `CotizacionEditar.jsx` — lo mismo**

Borrar las líneas 29-31:

```js
// Texto fijo de condiciones de entrega (Lovable · locked, idéntico al PDF).
const TEXTO_FIJO_ENTREGA =
  "El cliente se compromete a recibir la mercancía en las condiciones físicas en que se entrega. Cualquier reclamo sobre defectos visibles debe realizarse al momento de la entrega. Las garantías aplican según política de fábrica del producto. Los precios incluyen embalaje estándar. Embalaje especial bajo cotización adicional.";
```

Y añadir:

```js
import { TEXTO_FIJO_ENTREGA } from "../../lib/pdf/pdfStyles";
```

El uso de la línea ~991 no cambia.

- [ ] **Step 3: Verificar que la palabra desapareció del código**

Run: `grep -rni "embalaje" src/`
Expected: **sin resultados.** Si queda alguno, falta un sitio.

- [ ] **Step 4: Verificar**

Run: `npx eslint src/pages/ops/CotizacionNueva.jsx src/pages/ops/CotizacionEditar.jsx && npm run build`
Expected: 0 problemas y build exitoso.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ops/CotizacionNueva.jsx src/pages/ops/CotizacionEditar.jsx
git commit -m "refactor(cotizaciones): las dos pantallas usan el texto compartido"
```

---

# GRUPO B — Motivo del cambio de producto

## Task 5: Campo de motivo en el cambio

**Files:**

- Modify: `src/components/ventas/ModalCambioProducto.jsx`

- [ ] **Step 1: Añadir el estado**

Junto a los demás `useState` del componente (después de la línea ~96, donde está
`cuentasBanco`):

```jsx
// Por qué se hace el cambio. Hasta ahora el motivo iba escrito a fuego y
// siempre decía lo mismo, así que en el historial no había forma de saber
// qué había pasado en cada cambio.
const [motivo, setMotivo] = useState("");
```

- [ ] **Step 2: Añadir el campo antes del pie del modal**

Localizar el cierre del bloque `{accion === "devolucion" && (...)}` que termina con
`</Section>` y `)}` alrededor de la línea 647-649, justo antes del `</div>` que cierra
el cuerpo y del comentario `{/* Footer */}`.

Insertar ahí, **después** del `)}` que cierra ese bloque condicional y **antes** del
`</div>`:

```jsx
<Section titulo="Motivo del cambio">
  <textarea
    value={motivo}
    onChange={(e) => setMotivo(e.target.value)}
    rows={2}
    maxLength={300}
    placeholder="Por qué se hace el cambio — opcional, pero ayuda a entender el historial después"
    className="w-full rounded-lg border px-3 py-2 text-sm"
    style={{
      backgroundColor: "hsl(var(--card))",
      borderColor: "hsl(var(--border))",
      color: "hsl(var(--foreground))",
    }}
  />
</Section>
```

El `maxLength` de 300 es deliberado: el motivo va a una columna de texto que también
guarda la referencia automática, y un campo sin tope invita a pegar párrafos enteros
que luego no se leen.

- [ ] **Step 3: Concatenar el motivo, no sustituir la referencia**

En la llamada al RPC (línea ~246), hoy:

```jsx
          p_motivo: `Cambio desde venta #${venta.numero}`,
```

Pasa a:

```jsx
          // Se concatena en vez de sustituir: el vínculo con la venta original
          // es lo que permite rastrear el cambio, y no se puede perder porque
          // alguien escriba un motivo.
          p_motivo: motivo.trim()
            ? `Cambio desde venta #${venta.numero} — ${motivo.trim()}`
            : `Cambio desde venta #${venta.numero}`,
```

- [ ] **Step 4: Verificar**

Run: `npx eslint src/components/ventas/ModalCambioProducto.jsx && npm run build`
Expected: 0 problemas y build exitoso.

- [ ] **Step 5: Commit**

```bash
git add src/components/ventas/ModalCambioProducto.jsx
git commit -m "feat(ventas): motivo escribible en el cambio de producto"
```

---

## Task 6: Verificación final

- [ ] **Step 1: Los tres controles de que no quedó nada suelto**

Run: `grep -rni "embalaje" src/`
Expected: sin resultados.

Run: `grep -rn "RECIBO_NOMBRE" src/`
Expected: sin resultados.

Run: `grep -n "MARCA.nombre" src/lib/pdf/cotizacionPDF.js`
Expected: exactamente una línea, la del titular de la cuenta bancaria.

- [ ] **Step 2: Lint y build de todo lo tocado**

Run: `npx eslint src/lib/pdf/ src/pages/ops/CotizacionNueva.jsx src/pages/ops/CotizacionEditar.jsx src/components/ventas/ModalCambioProducto.jsx && npm run build`
Expected: 0 problemas y build exitoso.

- [ ] **Step 3: Prueba manual, la que de verdad cuenta**

Run: `npm run dev`

Con sesión de vendedora o Admin:

1. **Cotizaciones → Nueva.** En el paso 3, las condiciones ya no mencionan embalaje.
2. **Descargar el PDF de una cotización que YA existía.** Debe salir sin la nota de
   embalaje —porque el texto nunca se guardó en la base, se genera al imprimir— y con
   "Compresores CV" en el encabezado, bajo el logo y en el pie.
3. **En ese mismo PDF, mirar la sección de cuentas bancarias.** Debe seguir diciendo
   _"A nombre de Compresores del Valle S.A.S."_. Si dice "Compresores CV", hay que
   revertir ese cambio: es el titular ante el banco.
4. **Imprimir un recibo POS de una venta.** Debe salir exactamente igual que antes.
5. **Abrir una venta y hacer un cambio de producto.** Aparece el campo de motivo;
   escribir algo y confirmar. En el historial o en Auditoría, el motivo debe leerse
   como `Cambio desde venta #N — <lo que se escribió>`.
6. **Hacer otro cambio dejando el motivo vacío.** Debe guardar igual, con solo
   `Cambio desde venta #N`.

- [ ] **Step 4: Commit final si hubo ajustes**

```bash
git add -A
git commit -m "chore(cotizaciones): ajustes de verificacion final"
```

---

## Alcance

No se toca la base de datos. No se toca `MARCA.nombre` ni la línea del titular
bancario. No se tocan los grupos C1 (cuentas por cobrar/pagar) ni C2 (herramientas),
que van en ramas aparte. No se cambian permisos ni roles.
