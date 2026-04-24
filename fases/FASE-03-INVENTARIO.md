# FASE 3: INVENTARIO + BÚSQUEDA + QR + REALTIME

## Qué instalar en Claude Code

```bash
npx claude-code-templates@latest \
  --agent database/supabase-realtime-optimizer \
  --skill react-best-practices \
  --yes
```

## Qué decirle a Claude Code

```
Lee CLAUDE.md y fases/FASE-03-INVENTARIO.md. Construye el módulo de Inventario completo: lista de productos con cards en móvil y tabla en desktop, filtros por sede/estado/categoría, búsqueda fuzzy server-side, vista de detalle de producto con QR imprimible, escáner QR con cámara, y suscripción Realtime a la tabla inventario. Los colores de estado de stock deben ser de alto contraste (verde OK, naranja Bajo, rojo Agotado). Todo debe funcionar bien en celular de gama media.
```

## Lo que debe crear

### 1. `src/stores/inventarioStore.js`

- Estado: items[], loading, filtroSede, filtroBusqueda, filtroEstado, filtroCategoria
- Acciones: fetchInventario(filtros), updateItem(id, changes), setFiltros()
- Usar Zustand con selectores granulares

### 2. `src/hooks/useRealtime.js`

- Suscripción a tabla `inventario` via Supabase Realtime
- Cuando llega un UPDATE, actualizar el item en el store
- Cleanup al desmontar

### 3. `src/hooks/useInventario.js`

- Paginación con infinite scroll (cargar 50 items, luego más al scrollear)
- Búsqueda server-side con debounce 300ms usando `ilike`
- Query: `inventario` JOIN `productos` JOIN `sedes`
- Filtros aplicados en la query, no en el frontend
- El vendedor solo ve su sede (RLS lo maneja, pero el filtro por defecto debe ser su sede)

### 4. `src/pages/ops/Inventario.jsx`

**Vista principal: lista de productos con stock**

- En MÓVIL: cards con referencia, nombre, cantidad, estado (badge de color), sede
- En DESKTOP: tabla con columnas: Referencia, Nombre, Categoría, Sede, Stock, Min, Max, Estado
- Barra superior con:
  - Buscador (input con ícono de lupa)
  - Filtro de sede (dropdown: Todas, BOD-PRINCIPAL, ALM-01, ALM-02, ALM-03)
  - Filtro de estado (chips: Todos, OK, Bajo, Agotado)
- Botón flotante de QR scanner (esquina inferior derecha)
- Al tocar un producto → navega a detalle

### 5. `src/components/ui/StatusBadge.jsx`

```jsx
// Props: status ('OK' | 'Bajo' | 'Agotado' | 'Sobrestock')
// Renderiza badge con color según estado:
// OK → bg-stock-ok/10 text-stock-ok
// Bajo → bg-stock-low/10 text-stock-low
// Agotado → bg-stock-out/10 text-stock-out
```

### 6. `src/pages/ops/ProductoDetalle.jsx`

- Nombre, referencia, categoría, marca, precios
- QR del producto (componente QRGenerator con la referencia)
- Botón "Imprimir QR" (abre ventana de impresión)
- Stock actual por sede (mini tabla)
- Últimos 10 movimientos del producto (query a tabla movimientos)

### 7. `src/components/qr/QRGenerator.jsx`

- Usa `qrcode.react` para generar QR SVG
- Valor del QR: la referencia del producto (ej: 'CMP-2HP-24')
- Tamaño: 128px con level 'M'

### 8. `src/components/qr/QRPrintLabel.jsx`

- Genera ventana de impresión con el QR + referencia + nombre
- Formato: 5cm x 3cm (ideal para impresora térmica)
- Usa `window.open` + `window.print()`

### 9. `src/components/forms/QRScanner.jsx`

- Modal que abre la cámara trasera del celular
- Usa `html5-qrcode`
- Al escanear: busca producto por referencia → navega al detalle
- Botón de cerrar prominente

### 10. `src/hooks/useDebounce.js`

```javascript
// Hook estándar de debounce (300ms por defecto)
export function useDebounce(value, delay = 300) { ... }
```

## Query principal de inventario

```javascript
const query = supabase
  .from("inventario")
  .select(
    `
    id, cantidad, estado_stock, ubicacion_id, sede_id,
    producto:productos(id, referencia, nombre, categoria, marca, precio_venta, stock_minimo, stock_maximo),
    sede:sedes(id, nombre)
  `,
  )
  .eq("producto.activo", true)
  .order("producto(nombre)", { ascending: true })
  .range(offset, offset + 49); // paginación

// Aplicar filtros
if (filtroSede) query.eq("sede_id", filtroSede);
if (filtroEstado) query.eq("estado_stock", filtroEstado);
if (filtroBusqueda) query.ilike("producto.nombre", `%${filtroBusqueda}%`);
```

## Criterios de aceptación

- [ ] Se ven los 8+ productos semilla con badges de color por estado
- [ ] Filtrar por "Bajo" muestra solo los que tienen stock bajo
- [ ] La búsqueda "filtro" encuentra "Filtro Aire P/N 2236" en <300ms
- [ ] Al tocar un producto se ve el detalle con QR
- [ ] El QR se puede imprimir (botón abre ventana de impresión)
- [ ] El escáner QR abre la cámara y al escanear un QR navega al producto
- [ ] Si cambio stock en Supabase SQL Editor, el inventario se actualiza SIN refrescar
- [ ] María (Vendedora ALM-01) solo ve inventario de ALM-01
- [ ] Pedro (Bodeguero) ve inventario de TODAS las sedes
- [ ] En móvil: cards. En desktop: tabla.
- [ ] `git commit -m "Fase 3: Inventario + Búsqueda + QR + Realtime"`
