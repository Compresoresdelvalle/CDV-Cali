# Fase 12 — Ajustes Inventario + Compras + Traspasos

> **Estado:** pendiente de planeación detallada (`/plan mode`).
> **Fuente cliente:** `requerimientos_reunion_cliente.md` §3, §4.

## Propósito

Ajustar Inventario, Compras y Traspasos según las reglas operativas finales del cliente: doble código de producto, categoría nuevo/segunda mano, multi-proveedor sin comparación de precios, alertas adicionales, distinción compras completadas vs devolución por garantía, traspasos especiales.

## Alcance

### 12.1 Inventario — Categorías de producto (§3.1)

- **Nuevo / primera mano**
- **Segunda mano / reparado / manufacturado**

> _"Usted coge esa chancla y como está rota, usted la arregla, coge un repuesto de otro lado de segunda y la pone como nueva. Pero ya es un producto de segunda."_

→ Productos reparados internamente con piezas de segunda van a esta categoría.

### 12.2 Inventario — Estructura del producto (§3.2)

- **Código de proveedor** (código externo del fabricante/distribuidor)
- **Código interno** (código de la empresa)
- Referencia, Nombre, Cantidad, Categoría, Proveedor(es) asociado(s)

**Por qué dos códigos:** el proveedor maneja su propio código y la empresa lleva uno interno. Ambos deben coexistir y ser **buscables**.

### 12.3 Inventario — Multi-proveedor por producto (§3.3)

- Un producto puede tener varios proveedores asociados.
- Al abrir el producto, visualizar todos.
- **NO hay comparación automática de precios** — el sistema no tiene la base de datos de precios de los proveedores.
- Lo que SÍ se muestra: **el último proveedor al que se compró**.
- _"Que te diga la última vez a qué proveedor lo compraste, y pues yo asumo que tú cuando vas a comprar, compras al más barato."_

### 12.4 Inventario — Alertas automáticas (§3.4)

- Stock bajo / próximo a agotarse **(ya existe — validar)**.
- **Sobre stock** (mucho tiempo sin movimiento; producto estancado) — NUEVA.
- **Mayor rotación** (alto movimiento) — NUEVA.
- **Menor rotación** (bajo movimiento) — NUEVA.

### 12.5 Inventario — Movimientos automáticos de stock (§3.5)

- Venta → resta automática **(ya existe)**.
- Traslado → resta de origen + suma en destino **(ya existe)**.
- Piezas usadas en OT → resta automática **(ya existe — validar en Fase 10 §10.5)**.
- **Ensamble de compresor** → resta componentes individuales y crea el compresor armado como nuevo ítem → **POSTERGADO a Fase 18 (post-v1.0).** _"Vamos por partes, luego vemos ensambles."_

### 12.6 Inventario — Conteo cíclico (§3.6)

> _"Al final del mes o al final de cada tres meses ya saben si está bien el inventario o no."_

- Módulo Conteo (`admin/Conteo.jsx`) ya existe — validar que está funcional.
- Cadencia configurable vía `fn_get_parametro('dias_conteo_ciclico')` (Fase 9, default 15 días).
- Alerta admin: "Próximo conteo cíclico en X días" cuando se acerque la fecha.
- Reporte de discrepancias mensual / trimestral.

### 12.7 Inventario — Códigos QR (§3.7) **(ya existe estructura)**

- QR por cada producto/ítem.
- Carga inicial de 2000 QR es trabajo operativo manual (Fase 17).

### 12.8 Compras — estado completada vs devolución por garantía (§3.8)

- Estado nuevo en `compras`: enum {`completada`, `devolucion_garantia`, ...}.
- Distinguir en UI (lista compras + filtros).
- Coordina con Fase 13 (Garantías de Compras).

### 12.9 Traspasos — tipos internos (§4.1) **(ya existe)**

- Bodega → Almacén / Almacén → Bodega / Almacén → Almacén (entre los 3).

### 12.10 Traspasos — casos especiales (§4.2)

- **Mercancía abandonada en almacenes** → retroceso a bodega.
- **Devoluciones internas por garantía** → coordina con Fase 13.

> **Nota:** El movimiento físico del equipo de OT a bodega tras 30 días NO es un traslado de inventario, porque el equipo nunca estuvo en inventario. Es un cambio de estado interno de la OT (Fase 10 §10.4).

### 12.11 Traspasos — picking (§4.3) **(ya existe — validar)**

### 12.12 Traspasos — organización física (§4.4)

- Estructura por **stand** y **espacio**. Cada stand tiene **3 a 4 pisos**.
- Validar tabla `ubicaciones` existente; si no tiene esos campos, agregar:
  - `ubicaciones.stand` (text)
  - `ubicaciones.piso` (smallint, 1–4)
  - `ubicaciones.espacio` (text, opcional)
- UI Traspasos / Inventario debe permitir filtrar por stand y piso al hacer picking.
- Etiqueta QR del producto incluye stand/piso para localización rápida.

## Tablas / migrations

- **Columnas nuevas en `productos`:** `codigo_proveedor`, `tipo` (enum `nuevo` | `segunda_mano`).
- **Columnas nuevas en `compras`:** `estado` (enum `completada` | `devolucion_garantia` | ...).
- **Columnas nuevas en `ubicaciones` (§4.4):** `stand`, `piso` (1–4), `espacio` opcional.
- **Tablas nuevas:** `productos_proveedores` (M2M, si no existe).
- **Vista o RPC:** `fn_ultimo_proveedor(producto_id)`.

## Frontend afectado

- `src/pages/ops/Inventario.jsx`
- `src/pages/ops/CompraNueva.jsx`
- `src/pages/ops/CompraHistorial.jsx`
- `src/pages/admin/Alertas.jsx` (alertas adicionales)

## Verificación

- Producto puede crearse con `codigo_proveedor` + `codigo_interno` + `tipo`.
- Al abrir producto → muestra lista de proveedores + último proveedor al que se compró.
- Módulo Alertas muestra 4 categorías: stock bajo, sobre-stock, mayor rotación, menor rotación.
- Compra puede marcarse como `devolucion_garantia` y se filtra distinto.
- E2E cubre los 3 módulos.
