# CLAUDE.md — Compresores del Valle S.A.S.

## Proyecto

App de gestión de inventarios y operaciones para empresa colombiana de compresores y repuestos neumáticos. Reemplaza sistema fallido en AppSheet.

## Escala

- ~2.000-3.000 productos en catálogo
- 1 bodega principal + 3 almacenes (4 sedes total)
- 6 usuarios operativos con roles distintos
- Uso diario desde celular/tablet/PC simultáneamente

## Stack técnico

- **Frontend:** React 19 + Vite + Tailwind CSS (PWA)
- **Estado global:** Zustand (NO usar Context API para estado)
- **Base de datos:** Supabase (PostgreSQL + Realtime + Auth + Edge Functions)
- **Auth:** 6 usuarios reales en Supabase Auth — PIN de 4 dígitos como password
- **Hosting:** Cloudflare
- **QR:** qrcode.react (generar) + html5-qrcode (escanear con cámara)

## Sistema de Diseño (REGLAS OBLIGATORIAS)

> Fuente de verdad: `src/index.css` (`:root`) y `src/design-tokens.css` (referencia documentada).
> Tailwind config: `tailwind.config.js` mapea los tokens a clases Tailwind.

### Regla #1 — NUNCA hardcodear colores

```jsx
// ❌ PROHIBIDO
style={{ color: "#14352A" }}
style={{ backgroundColor: "#F4F1EB" }}
className="bg-white"
className="text-gray-500"

// ✅ CORRECTO
style={{ color: "hsl(var(--foreground))" }}
style={{ backgroundColor: "hsl(var(--card))" }}
style={{ borderColor: "hsl(var(--border))" }}
style={{ backgroundColor: "hsl(var(--muted) / 0.3)" }}
style={{ color: "hsl(var(--muted-foreground))" }}
```

### Tokens disponibles

| Token                  | Uso                             |
| ---------------------- | ------------------------------- |
| `--background`         | Fondo general de páginas        |
| `--foreground`         | Texto principal                 |
| `--card`               | Fondo de cards y paneles        |
| `--card-foreground`    | Texto dentro de cards           |
| `--primary`            | Color de marca (azul)           |
| `--primary-foreground` | Texto sobre primario            |
| `--muted`              | Fondos sutiles                  |
| `--muted-foreground`   | Texto secundario/labels         |
| `--border`             | Bordes de componentes           |
| `--destructive`        | Rojo — errores, anulaciones     |
| `--success`            | Verde — stock OK, aprobado      |
| `--warning`            | Naranja — stock bajo, descuento |
| `--info`               | Azul claro — información        |
| `--sidebar-*`          | Tokens exclusivos del sidebar   |

### Regla #2 — Hover con onMouseEnter/Leave (no Tailwind hover con CSS vars)

```jsx
// ✅ CORRECTO para elementos con inline styles
onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "hsl(var(--muted) / 0.5)"}
onMouseLeave={(e) => e.currentTarget.style.backgroundColor = ""}
```

### Regla #3 — Patrón de página ops

```jsx
// Wrapper de página — SIEMPRE este patrón
<div
  className="p-4 sm:p-6 space-y-4 animate-fade-in"
  style={{ backgroundColor: "hsl(var(--background))" }}
>
  <PageHeader title="..." description="..." actions={<>...</>} />
  {/* contenido */}
</div>
```

### Regla #4 — SectionCard (card con header)

```jsx
// Tarjeta con encabezado de sección
<div
  className="rounded-xl border overflow-hidden"
  style={{
    backgroundColor: "hsl(var(--card))",
    borderColor: "hsl(var(--border))",
  }}
>
  <div
    className="px-4 py-3 border-b"
    style={{
      borderColor: "hsl(var(--border))",
      backgroundColor: "hsl(var(--muted) / 0.3)",
    }}
  >
    <p
      className="text-xs font-semibold uppercase tracking-wide"
      style={{ color: "hsl(var(--muted-foreground))" }}
    >
      Título
    </p>
  </div>
  <div className="p-4">{/* contenido */}</div>
</div>
```

### Regla #5 — Desktop tabla / Mobile cards

```jsx
// Desktop
<div className="hidden md:block overflow-x-auto rounded-xl border"
     style={{ borderColor: "hsl(var(--border))" }}>
  <table className="w-full border-collapse">...</table>
</div>

// Mobile
<ul className="md:hidden space-y-2.5" role="list">
  {items.map(item => <li key={item.id}><button className="w-full text-left rounded-xl px-4 py-4 border ..." style={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>...</button></li>)}
</ul>
```

### Regla #6 — StatusBadge y estados

Usar siempre `<StatusBadge status="..." />` de `src/components/ui/StatusBadge.jsx`. No crear spans inline con colores hardcodeados para estados.

## Colores (referencia — NO usar directo en código)

Los colores abajo son los valores aproximados de los tokens. Usar SIEMPRE los tokens CSS, no estos hex.

- Primario: `hsl(213 56% 33%)` ≈ `#245A8C`
- Fondo: `hsl(210 20% 98%)` ≈ `#F6F8FA`
- Card: `hsl(0 0% 100%)` = `#FFFFFF`
- Éxito (stock OK): `hsl(142 64% 38%)` ≈ `#259A55`
- Warning (stock bajo): `hsl(38 92% 50%)` ≈ `#F59E0B`
- Destructivo: `hsl(0 72% 51%)` ≈ `#DC2626`
- Info: `hsl(200 80% 44%)` ≈ `#0EA5C9`

## Tipografía

Font: `"IBM Plex Sans", system-ui, -apple-system, sans-serif`

## Roles y permisos

- **Admin (Carlos):** Ve y hace todo. Acceso a Panel Admin.
- **Bodeguero (Pedro):** Inventario, Compras, Traspasos, Picking, Ensambles, Devoluciones, Herramientas.
- **Vendedor (María, Juan, Ana):** Inventario (solo su sede), Ventas, Cotizaciones, Herramientas.
- **Técnico (Luis):** Órdenes de servicio, Ensambles, Herramientas.

## Convenciones de código

- Componentes funcionales con hooks
- TypeScript cuando sea posible (pero JavaScript es aceptable)
- Zustand stores en `src/stores/`
- Cliente Supabase en `src/lib/supabase.js`
- Operaciones de stock usan funciones PG con `FOR UPDATE` (nunca modificar stock directo)
- Soft delete con columna `activo`, NUNCA `DELETE` real
- IDs de sedes son TEXT legible: `'BOD-PRINCIPAL'`, `'ALM-01'`, etc.
- Moneda en COP: `new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 })`
- Fechas en zona Colombia: `America/Bogota`

## Seguridad (reglas obligatorias)

- RLS activo en TODAS las tablas
- `auth.uid()` valida permisos via funciones `get_my_rol()` y `get_my_sede_id()`
- Tabla `movimientos` es append-only (trigger impide UPDATE/DELETE)
- Edge Functions solo para operaciones multi-tabla transaccionales
- La `anon` key NUNCA se usa para escrituras — solo `authenticated` con JWT de usuario

## UX para operarios industriales

- Botones mínimo 48px de alto (uso con guantes)
- Cards en móvil, tabla en desktop
- Botón flotante de QR scanner siempre visible en módulos que lo usan
- Colores de estado de stock con alto contraste (visible sin leer texto)
- Búsqueda con debounce 400ms, server-side con `ilike`
- Teclado numérico grande para el PIN (no teclado del sistema)

## Estructura del proyecto

```
src/
├── lib/           # supabase.js, constants.js, utils.js
├── stores/        # authStore.js, inventarioStore.js, uiStore.js
├── hooks/         # useRealtime.js, useInventario.js, useDebounce.js
├── components/
│   ├── layout/    # AppShell, AdminShell, Sidebar, BottomNav, Header, RoleGuard
│   ├── ui/        # Badge, Button, Card, Modal, Toast, StatusDot, NumericKeypad
│   ├── forms/     # ProductPicker, QRScanner, QuantityInput
│   └── qr/        # QRGenerator, QRPrintLabel
├── pages/
│   ├── Login.jsx
│   ├── ops/       # Inventario, Ventas, Compras, Traspasos, Ordenes, Ensambles, etc.
│   └── admin/     # Dashboard, Alertas, Conteo, ABC, Reorden, Auditoria, etc.
└── styles/        # tokens.css (si no va todo en tailwind.config.js)
```

## Instrucciones de fase

Cada fase tiene su propio MD en `fases/`. Al trabajar en una fase:

1. Lee este CLAUDE.md (contexto global)
2. Lee el MD de la fase correspondiente (instrucciones específicas)
3. Ejecuta lo que dice el MD de la fase
4. Verifica los criterios de aceptación antes de considerar la fase completa
