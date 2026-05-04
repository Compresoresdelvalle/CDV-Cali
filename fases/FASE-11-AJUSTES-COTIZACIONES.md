# Fase 11 — Ajustes Cotizaciones

> **Estado:** pendiente de planeación detallada (`/plan mode`).
> **Fuente cliente:** `requerimientos_reunion_cliente.md` §1.

## Propósito

Dejar el módulo Cotizaciones alineado con lo que el cliente entrega al cliente externo: PDF profesional, IVA y cuentas bancarias configurables por venta, validez ajustable, edición posterior.

## Alcance

### 11.1 Datos del cliente (§1.1)

- Nombre, NIT, Teléfono — **todos como texto libre**. NO hay módulo CRUD de clientes (decisión §7).
- Identificación fiscal y contacto del comprador. Se llena cada vez para mantener flujo ágil.

### 11.2 Detalle del producto cotizado (§1.2)

- Múltiples ítems por cotización: descripción, cantidad, valor unitario, valor total. **(ya existe — validar)**.

### 11.3 Tiempo de entrega como NOTA (§1.3)

- Campo tipo nota (texto libre). NO campo fijo.
- _"No todo es igual, no todo tiene el mismo tiempo de entrega."_

### 11.4 Condiciones de pago variables (§1.4)

- Campo configurable por cotización. **NO confundir con métodos de pago (tarjeta, efectivo).**
- Significa **términos** (contado, 70% inicial, etc.).
- _"Hay cotizaciones que son de contado, sí o sí. Pero hay cotizaciones que el equipo no está listo, entonces para dar inicio se debe consignar un 70%, entonces también va a ser variable."_

### 11.5 Cuentas bancarias en la cotización (§1.5)

- Mostrar las cuentas bancarias disponibles en el pie del PDF.
- Usuario elige **cuáles cuentas mostrar** en cada cotización (multiselección).
- La cuenta a usar depende de si el cliente paga con IVA o sin IVA.
- Implica: leer `cuentas_bancarias` (Fase 10), filtrar por marca con/sin IVA según el % IVA aplicado.

### 11.6 IVA configurable por cotización (§1.6)

- Casilla con porcentaje editable. Default = `parametros_sistema.iva` (Fase 10), normalmente 19%.
- Permite 0%.
- _"Le hacemos una casilla IVA y si la pones en cero pues que no la tenga... que el IVA sea cambiable, porque el IVA puede subir o puede bajar."_
- En el PDF: reflejar explícitamente el % aplicado (ej: "IVA 0%" o "IVA 19%").

### 11.7 Fecha + Validez (§1.7)

- Fecha automática + campo "validez" editable. Default = 15 días hábiles (de `parametros_sistema`).
- _"Pues uno ya entraría a negociar con el cliente. Hagamos que esos 15 no sean fijos, sino que los puedas elegir."_

### 11.8 Pie "Cotizado por" (§1.8)

- Auto-rellenar con el nombre del usuario logueado. **NO firma. NO cédula.**
- _"No hay necesidad. Para qué."_

### 11.9 Texto fijo de condiciones de entrega (§1.9)

Siempre presente en el PDF, palabra por palabra:

> "El producto se entrega únicamente en nuestras instalaciones sin ningún costo. Fuera de nuestras instalaciones el flete corre por cuenta del cliente."

- _"Siempre ser claros con los clientes porque a veces son equipos que hay que llevar a otras ciudades y mejor dicho se vuelve un camello eso."_

### 11.10 Notas adicionales libres (§1.10)

- Campo libre para anotaciones específicas (ej: especificar tiempo de entrega de cada ítem, condiciones especiales).

### 11.11 Salida: PDF tamaño carta (§1.11)

- Hoja **tamaño carta** (no oficio, no A4).
- PDF descargable + impresión directa.
- _"Para que no haya ningún tipo de modificación... la envía uno en PDF."_

### 11.12 Cotización editable post-creada (§1.12)

- Usuario interno SÍ puede modificar la cotización después de creada y reemitirla.
- _"'Yo quiero que esto me salga más económico, no me le pongas esto, quitarme esto y hacemos solo esto.'"_
- **Ya existe** `CotizacionEditar.jsx` — validar que reemite con nueva fecha/versión.

## Tablas / migrations

- **Columnas nuevas en `cotizaciones`:** `iva_pct`, `validez_dias`, `condiciones_pago` (text), `tiempo_entrega_nota` (text), `notas` (text), `cotizado_por_usuario_id` (FK).
- **Tabla nueva M2M:** `cotizacion_cuentas_bancarias` (FK a `cotizaciones`, FK a `cuentas_bancarias`).

## Frontend afectado

- `src/pages/ops/CotizacionNueva.jsx`
- `src/pages/ops/CotizacionEditar.jsx`
- `src/pages/ops/CotizacionDetalle.jsx`
- Generador PDF — revisar `src/lib/pdf*` o similar.

## Verificación

- PDF de cotización contiene: cuentas bancarias seleccionadas + IVA editable visible + validez editable + "Cotizado por: [nombre]" + texto fijo de entrega + notas adicionales.
- E2E `tests/e2e/cotizaciones.spec.js` valida los nuevos campos.
- Snapshot del PDF generado para una cotización tipo.
