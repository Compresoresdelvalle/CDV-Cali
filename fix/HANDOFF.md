# Handoff para Claude Code — Fix de navegación móvil + Panel Admin

Repo: `jdconsultors369-ai/Compresores-del-Valle`
Stack: React 19 + Vite + React Router + Tailwind + Zustand + Supabase.

## Contexto

La app móvil bloquea el acceso a la mayoría de los módulos de cada rol. Causa raíz:
la única navegación en celular es una barra inferior con tope fijo de 5 botones
(`buildBottomNav` en `src/components/layout/AppShell.jsx`), sin menú de overflow.
El sidebar con la lista completa está oculto con `hidden lg:flex`.

Cobertura actual de módulos alcanzables en celular:

- Vendedor 4/12 · Bodeguero 3/8 · Técnico 2/4 · Admin 4/14 (+ Panel Admin entero inaccesible).

## Qué hay que arreglar

### 1. `src/components/layout/AppShell.jsx` (PRINCIPAL)

Reemplazar por el archivo incluido en este paquete:
`src/components/layout/AppShell.jsx`. Aplica todo esto:

- **Drawer "Más"** (hoja inferior) con TODOS los módulos del rol agrupados por
  sección + Panel Admin + búsqueda global. Se abre desde el 5º botón de la barra
  y desde el avatar del header. → cobertura 100%.
- **`buildBottomNav` reescrito**: 5 columnas fijas, sin duplicar el módulo del
  FAB, claves únicas por `id`, relleno con spacers si el rol tiene <2 destinos.
- **FAB al ras** (no flotante): la acción primaria va dentro de la barra,
  resaltada con un chip claro — ya no usa `-top-5` ni sobresale.
- **Header móvil** con campana de alertas (contador de stock bajo/agotado),
  chip de sede activa y acceso a búsqueda global.
- **Safe-areas**: `env(safe-area-inset-top)` en el header y
  `env(safe-area-inset-bottom)` en la barra inferior (iPhone/Android).

> El archivo es JavaScript plano, sin dependencias nuevas (solo añade el icono
> `X` de `lucide-react`, ya instalado). No toca rutas ni el layout de escritorio.

### 2. Panel Admin móvil — `src/components/layout/AdminShell.jsx` (PENDIENTE, no incluido)

Aplicar el MISMO patrón que AppShell, pero con **barra contextual de
administración**: cuando el Admin está en `/admin`, la barra inferior NO debe
mostrar accesos de Operaciones (Inventario/Vender/Órdenes). Debe mostrar
navegación admin (Resumen · Alertas · Conteo · Auditoría) + una salida clara a
**Operaciones** (volver a `/ops`). Las 12 herramientas del panel
(`ADMIN_MODULES` en `src/lib/constants.js`) deben ser todas alcanzables en
celular (grid + drawer admin). Hoy AdminShell tiene el mismo problema de acceso
que tenía AppShell.

### 3. (Opcional, P2) FAB de QR unificado

Hoy el botón flotante de escáner QR se dibuja a mano en cada página
(`fixed bottom-24 right-5`). Centralizarlo en `AppShell` para que sea consistente
y aparezca solo en los módulos que lo usan.

## Cómo aplicarlo (rama nueva)

```bash
git checkout -b fix/navegacion-movil
cp -f AppShell.jsx src/components/layout/AppShell.jsx   # ajusta la ruta al copiar
git add src/components/layout/AppShell.jsx
git commit -m "fix(movil): drawer Mas con acceso total, FAB al ras, safe-areas"
git push -u origin fix/navegacion-movil
```

Abrir PR `fix/navegacion-movil` → `main`.

## Criterios de aceptación

- Con cada rol, desde "Más" (o el avatar) se llega a TODOS sus módulos.
- El FAB central no sobresale de la barra.
- En iPhone/Android el header y la barra respetan notch e indicador de gestos.
- En el Panel Admin la barra inferior es de administración, no de operaciones,
  y hay una salida a Operaciones.
- Escritorio (≥ lg) sin cambios: sidebar + topbar intactos.

## Referencia visual

Prototipo interactivo del resultado esperado (rol × dispositivo iPhone/Android/PC):
`Rediseño Móvil CDV.dc.html` y la auditoría `Auditoría Móvil CDV.dc.html`
(en la raíz del proyecto de diseño). Ábrelos en el navegador.
