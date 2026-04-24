# FASE 4: VENTAS + COTIZACIONES

## Qué instalar: `npx claude-code-templates@latest --skill development/senior-fullstack --yes`

## Qué decirle a Claude Code

```
Lee CLAUDE.md y fases/FASE-04-VENTAS.md. Construye el módulo de Ventas con carrito, búsqueda de productos (texto + QR), cálculo de totales en tiempo real, y la Edge Function de registrar-venta que valida stock con FOR UPDATE, descuenta inventario, y registra movimientos. También construye Cotizaciones con el mismo flujo pero sin descontar stock, y botón para convertir cotización en venta.
```

## Componentes a crear

- `src/pages/ops/VentaNueva.jsx` — Carrito: buscar productos por nombre/QR, agregar al carrito con cantidad, ver subtotales en tiempo real, seleccionar método de pago, campo cliente opcional, botón confirmar
- `src/pages/ops/VentaHistorial.jsx` — Lista de ventas con filtro fecha/sede
- `src/pages/ops/VentaDetalle.jsx` — Resumen de venta, botón anular (solo Admin)
- `src/pages/ops/CotizacionNueva.jsx` — Mismo flujo que venta sin descontar stock
- `src/pages/ops/CotizacionHistorial.jsx` — Lista con estado (vigente/aceptada/vencida)
- `supabase/functions/registrar-venta/index.ts` — Edge Function transaccional
- `supabase/functions/convertir-cotizacion/index.ts` — Copia detalles a venta nueva

## Edge Function: registrar-venta

Recibe: `{ sede_id, cliente_nombre, cliente_nit, metodo_pago, descuento_pct, items: [{producto_id, cantidad, precio_unitario}] }`
Proceso: Crear venta → Para cada item: llamar `descontar_stock_seguro()` → insertar detalle → registrar movimiento → Retornar venta con totales

## Criterios de aceptación

- [ ] Vendedor crea venta de 3 productos → stock baja en inventario → movimientos registrados
- [ ] Si intento vender más stock del disponible → error claro "Stock insuficiente"
- [ ] Cotización creada NO descuenta stock
- [ ] Botón "Convertir a Venta" en cotización → crea venta real → descuenta stock
- [ ] Solo Admin puede anular venta
- [ ] `git commit -m "Fase 4: Ventas + Cotizaciones"`

---

# FASE 5: COMPRAS + DEVOLUCIONES

## Qué instalar: nada nuevo (ya tiene lo de fases anteriores)

## Qué decirle a Claude Code

```
Lee CLAUDE.md y fases/FASE-04-VENTAS.md (solo la sección de Fase 5 al final). Construye Compras y Devoluciones siguiendo el mismo patrón que Ventas pero con lógica inversa: compras suman stock, devoluciones de cliente suman stock. Usa triggers PG para las actualizaciones de stock (ya existen en la BD: trg_compra_sumar_stock). Crea las páginas y los formularios.
```

## Componentes a crear

- `src/pages/ops/CompraNueva.jsx` — Seleccionar proveedor (o escribir nuevo), agregar productos con costo unitario, número factura, campo para foto factura URL
- `src/pages/ops/CompraHistorial.jsx` — Lista con estados (Registrada/Recibida)
- `src/pages/ops/DevolucionNueva.jsx` — Tipo (cliente/proveedor), vincular a venta/compra, producto, cantidad, motivo
- `src/pages/ops/DevolucionHistorial.jsx` — Lista con estados

## Lógica de stock

- Compra: al marcar `recibida = true`, el trigger `trg_compra_sumar_stock` suma automáticamente
- Devolución cliente: Edge Function que suma stock + registra movimiento tipo 'devolucion'
- Devolución proveedor: Edge Function que resta stock + registra movimiento

## Criterios de aceptación

- [ ] Compra de 10 filtros → marcar recibida → stock sube 10 → movimiento registrado
- [ ] Costo promedio se recalcula al recibir compra
- [ ] Devolución de cliente de 2 unidades → stock sube 2
- [ ] `git commit -m "Fase 5: Compras + Devoluciones"`

---

# FASE 6: TRASPASOS + PICKING

## Qué instalar: `npx claude-code-templates@latest --agent ui-ux-designer --yes`

## Qué decirle a Claude Code

```
Lee CLAUDE.md y fases/FASE-04-VENTAS.md (sección Fase 6). Construye el módulo de Traspasos con flujo multi-etapa: crear traspaso → picking (lista ordenada por ubicación) → verificación (persona diferente) → envío → recepción en sede destino. Los triggers de stock ya existen en la BD (trg_traspaso_salida y trg_traspaso_entrada). La lista de picking debe estar ordenada por prioridad de ubicación para recorrido óptimo en bodega. Los checkboxes deben ser GRANDES (48px) para uso con guantes.
```

## Componentes a crear

- `src/pages/ops/TraspasoNuevo.jsx` — Seleccionar sede origen/destino, agregar productos
- `src/pages/ops/TraspasoHistorial.jsx` — Lista con estado visual (badges de color por estado)
- `src/pages/ops/TraspasoDetalle.jsx` — Detalle con acciones según estado actual
- `src/pages/ops/PickingList.jsx` — Lista ordenada por ubicación, checkboxes grandes, campo de cantidad pickeada
- `src/pages/ops/VerificacionTraspaso.jsx` — Verificador confirma cantidades (picker ≠ verificador)
- `src/pages/ops/RecepcionTraspaso.jsx` — Sede destino confirma cantidades recibidas

## Flujo de estados

```
Pendiente → En Picking (picker asignado)
  → Verificado (verificador confirma, picker ≠ verificador)
    → En Tránsito (stock sale de origen via trigger)
      → Recibido (stock entra a destino via trigger)
```

## Criterios de aceptación

- [ ] Traspaso pasa por los 5 estados correctamente
- [ ] Lista de picking ordenada por ubicación (prioridad)
- [ ] Picker y verificador NO pueden ser la misma persona
- [ ] Stock baja en sede origen al cambiar a "En Tránsito"
- [ ] Stock sube en sede destino al cambiar a "Recibido"
- [ ] Si hay diferencia entre enviado y recibido → estado "con_diferencia"
- [ ] `git commit -m "Fase 6: Traspasos + Picking"`

---

# FASE 7: ÓRDENES DE SERVICIO + ENSAMBLES + HERRAMIENTAS

## Qué instalar: nada nuevo

## Qué decirle a Claude Code

```
Lee CLAUDE.md y fases/FASE-04-VENTAS.md (sección Fase 7). Construye 3 módulos: Órdenes de servicio (técnico registra reparaciones y consume repuestos), Ensambles con BOM (verificar componentes y ensamblar producto), y Herramientas (préstamo y devolución). Los triggers de ensamble ya existen en la BD.
```

## Componentes a crear

### Órdenes de Servicio

- `src/pages/ops/OrdenNueva.jsx` — Cliente, equipo, diagnóstico, costo mano de obra
- `src/pages/ops/OrdenDetalle.jsx` — Agregar repuestos (búsqueda/QR), cambiar estado, fotos (URL)
- `src/pages/ops/OrdenHistorial.jsx` — Filtro por estado

### Ensambles

- `src/pages/ops/EnsambleNuevo.jsx` — Seleccionar producto a ensamblar, verificar BOM (verde=hay componentes, rojo=faltan)
- `src/pages/ops/EnsambleHistorial.jsx` — Lista de ensambles

### Herramientas

- `src/pages/ops/Herramientas.jsx` — Lista de herramientas con estado, botón prestar, botón devolver
- Modal de préstamo: seleccionar quién, fecha esperada de devolución

## Criterios de aceptación

- [ ] Técnico crea orden → agrega 2 repuestos por búsqueda → stock baja
- [ ] Ensamble: verificar BOM muestra verde/rojo por componente → completar → componentes bajan, producto final sube
- [ ] Herramienta prestada aparece con estado "prestada" y nombre del usuario
- [ ] Herramienta devuelta vuelve a "disponible"
- [ ] `git commit -m "Fase 7: Órdenes + Ensambles + Herramientas"`

---

# FASE 8: DASHBOARD ADMIN + GESTIÓN

## Qué instalar: `npx claude-code-templates@latest --command database/supabase-security-audit --yes`

## Qué decirle a Claude Code

```
Lee CLAUDE.md y fases/FASE-04-VENTAS.md (sección Fase 8). Construye el Dashboard Admin con los 16 KPIs usando la función fn_dashboard_kpis() que ya existe en la BD. Usa gráficos con recharts o Chart.js. Construye las páginas de Alertas, Auditoría de movimientos, Gestión de usuarios, Top 10, Análisis ABC, y Sugerencias de reorden. Todo con el tema visual azul oscuro de AdminShell.
```

## Componentes a crear

- `src/pages/admin/Dashboard.jsx` — 16 KPIs en cards + gráficos de ventas por sede y tendencia semanal
- `src/pages/admin/Alertas.jsx` — Stock bajo, agotados, vencimientos próximos, herramientas prestadas
- `src/pages/admin/Auditoria.jsx` — Tabla de movimientos filtrable por producto/sede/usuario/fecha/tipo
- `src/pages/admin/Usuarios.jsx` — CRUD: crear usuario, editar rol/sede/PIN, desactivar
- `src/pages/admin/Top10.jsx` — Productos más vendidos del mes (query)
- `src/pages/admin/AnalisisABC.jsx` — Clasificación ABC con porcentajes acumulados
- `src/pages/admin/Reorden.jsx` — Lista de productos que necesitan reorden (view v_sugerencias_reorden)
- `src/pages/admin/Conteo.jsx` — Conteo cíclico: lista de productos a contar, registrar conteo

## KPIs vía RPC

```javascript
const { data: kpis } = await supabase.rpc("fn_dashboard_kpis");
// kpis = { ventas_hoy, ventas_semana, ventas_mes, compras_mes, stock_bajo, agotados, ... }
```

## Criterios de aceptación

- [ ] Dashboard muestra KPIs con datos reales de fases anteriores
- [ ] Gráfico de ventas por sede funciona
- [ ] Auditoría muestra movimientos de ventas/compras/traspasos con filtros
- [ ] Admin puede desactivar un usuario → ese usuario ya no puede hacer login
- [ ] Top 10 muestra productos correctos
- [ ] `git commit -m "Fase 8: Dashboard Admin + KPIs + Gestión"`

---

# FASE 9: DEPLOY + PWA + TESTING + MIGRACIÓN

## Qué instalar: `npx claude-code-templates@latest --agent development-tools/code-reviewer --yes`

## Qué decirle a Claude Code

```
Lee CLAUDE.md y fases/FASE-04-VENTAS.md (sección Fase 9). Haz una revisión completa del código: verifica que todos los componentes funcionan, que los guards de rol están en todas las rutas, que RLS está bien en todas las tablas. Optimiza el bundle size. Verifica que la PWA se instala correctamente. Prepara el script de migración de datos. Genera un documento de troubleshooting para el dueño.
```

## Tareas

1. **Auditoría de código:** Revisar imports, eliminar console.logs, verificar error handling
2. **PWA:** Verificar que manifest.json es correcto, iconos existen, service worker funciona
3. **QR en lote:** Crear página `/admin/qr-lote` que genera QR de todos los productos para impresión masiva
4. **Script de migración:** `scripts/migrate.mjs` que lee CSV de Google Sheets y carga productos + inventario
5. **UptimeRobot:** Documentar cómo configurar ping anti-pausa de Supabase
6. **Troubleshooting doc:** PDF con "Qué hacer si..." para el dueño
7. **Deploy a Netlify:** Conectar repo GitHub o subir dist/
8. **Testing en dispositivos reales:** Celular bodeguero, tablet vendedor, PC admin

## Script de migración

```javascript
// scripts/migrate.mjs
// Lee productos.csv y inventario.csv
// Inserta en Supabase con upsert por referencia
// Valida: COUNT(*) coincide, no hay duplicados, estados de stock calculados
```

## Criterios de aceptación

- [ ] La PWA se instala en Android (agregar a pantalla de inicio)
- [ ] Todos los flujos funcionan sin errores en celular
- [ ] QR en lote genera etiquetas de todos los productos
- [ ] El script de migración funciona con CSV de prueba
- [ ] UptimeRobot configurado y haciendo ping
- [ ] Documento de troubleshooting creado
- [ ] App deployada en compresores.netlify.app
- [ ] `git commit -m "Fase 9: Deploy + PWA + Testing"`
- [ ] `git tag v1.0.0`
