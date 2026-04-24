# FASE 2: LOGIN CON PIN + LAYOUT + MENÚ POR ROL

## Qué instalar en Claude Code

```bash
npx claude-code-templates@latest \
  --skill creative-design/ui-ux-pro-max \
  --skill creative-design/frontend-design \
  --agent ui-ux-designer \
  --yes
```

## Qué decirle a Claude Code

```
Lee CLAUDE.md y fases/FASE-02-LOGIN-LAYOUT.md. Construye la pantalla de Login con PIN numérico, el auth store con Supabase Auth real (6 usuarios), el componente Guard de roles, el AppShell (layout ops con verde), el AdminShell (layout admin con azul oscuro), y todas las rutas de React Router con guards. Usa los design tokens del CLAUDE.md. Los botones deben ser grandes (48px) porque los operarios usan guantes. El PIN pad debe ser como un teclado de teléfono, grande y fácil de tocar.
```

## Lo que debe crear

### 1. `src/lib/constants.js`

```javascript
// Mapa de nombres a emails de Supabase Auth
export const EMAIL_MAP = {
  "Carlos Dueño": "carlos@compresores.local",
  "Pedro Bodeguero": "pedro@compresores.local",
  "María Vendedora": "maria@compresores.local",
  "Juan Vendedor": "juan@compresores.local",
  "Ana Vendedora": "ana@compresores.local",
  "Luis Técnico": "luis@compresores.local",
};

// Módulos visibles por rol
export const ROLE_MODULES = {
  Admin: [
    "Inventario",
    "Ventas",
    "Compras",
    "Traspasos",
    "Órdenes",
    "Ensambles",
    "Cotizaciones",
    "Herramientas",
    "Devoluciones",
    "Productos",
    "→ Panel Admin",
  ],
  Bodeguero: [
    "Inventario",
    "Compras",
    "Traspasos",
    "Ensambles",
    "Devoluciones",
    "Herramientas",
    "Productos",
  ],
  Vendedor: [
    "Inventario",
    "Ventas",
    "Cotizaciones",
    "Herramientas",
    "Productos",
  ],
  Tecnico: ["Órdenes", "Ensambles", "Herramientas", "Productos"],
};

// Iconos de módulos
export const MODULE_ICONS = {
  Inventario: "📋",
  Ventas: "💰",
  Compras: "🛍️",
  Traspasos: "🔄",
  Órdenes: "⚙️",
  Ensambles: "🔩",
  Cotizaciones: "📝",
  Herramientas: "🛠️",
  Devoluciones: "↩️",
  Productos: "🏷️",
  "→ Panel Admin": "📊",
};
```

### 2. `src/stores/authStore.js`

Usar Zustand con Supabase Auth real. Ver el código completo en CLAUDE.md sección "Zustand + Supabase Auth". Funciones: `init()`, `login(nombre, pin)`, `logout()`.

### 3. `src/pages/Login.jsx`

- Fondo: color surface (#F4F1EB)
- Logo o título "Compresores del Valle" arriba
- Dropdown grande con los 6 nombres (solo usuarios activos)
- Teclado numérico tipo teléfono (3x4 grid) con dígitos grandes
- Indicador de PIN: 4 círculos (llenos/vacíos)
- Botón "Entrar" prominente con color accent (#C8993E)
- Animación de shake si PIN incorrecto
- Los usuarios se cargan de la tabla `usuarios` (SELECT nombre, rol FROM usuarios WHERE activo=true)

### 4. `src/components/layout/RoleGuard.jsx`

```jsx
// Wrapper que verifica si el rol del usuario tiene acceso
// Si no tiene acceso: redirige a /ops (o /login si no autenticado)
// Props: roles (array de roles permitidos), children
```

### 5. `src/components/layout/AppShell.jsx`

- Layout de la App Operaciones
- Color primario: #14352A (verde oscuro)
- Header con nombre del usuario logueado + botón cerrar sesión
- En móvil: BottomNav con los módulos del rol
- En desktop: Sidebar izquierda con los módulos del rol
- Solo mostrar módulos permitidos para el rol actual
- Si es Admin: mostrar botón "→ Panel Admin" que lleva a /admin

### 6. `src/components/layout/AdminShell.jsx`

- Layout del Panel Admin
- Color primario: #1A1A2E (azul oscuro)
- Módulos admin: Dashboard, Alertas, Conteo, ABC, Reorden, Slotting, Auditoría, Usuarios, Top 10
- Botón "← Volver a Operaciones" que lleva a /ops

### 7. `src/App.jsx` — Router completo

```jsx
<BrowserRouter>
  <Routes>
    <Route path="/login" element={<Login />} />

    {/* App Operaciones */}
    <Route
      path="/ops"
      element={
        <Guard roles={["Admin", "Bodeguero", "Vendedor", "Tecnico"]}>
          <AppShell />
        </Guard>
      }
    >
      <Route index element={<Navigate to="inventario" />} />
      <Route
        path="inventario"
        element={
          <Guard roles={["Admin", "Bodeguero", "Vendedor"]}>
            <Placeholder name="Inventario" />
          </Guard>
        }
      />
      <Route
        path="ventas/*"
        element={
          <Guard roles={["Admin", "Vendedor"]}>
            <Placeholder name="Ventas" />
          </Guard>
        }
      />
      <Route
        path="compras/*"
        element={
          <Guard roles={["Admin", "Bodeguero"]}>
            <Placeholder name="Compras" />
          </Guard>
        }
      />
      <Route
        path="traspasos/*"
        element={
          <Guard roles={["Admin", "Bodeguero", "Vendedor"]}>
            <Placeholder name="Traspasos" />
          </Guard>
        }
      />
      <Route
        path="ordenes/*"
        element={
          <Guard roles={["Admin", "Tecnico"]}>
            <Placeholder name="Órdenes" />
          </Guard>
        }
      />
      <Route
        path="ensambles/*"
        element={
          <Guard roles={["Admin", "Bodeguero", "Tecnico"]}>
            <Placeholder name="Ensambles" />
          </Guard>
        }
      />
      <Route
        path="cotizaciones/*"
        element={
          <Guard roles={["Admin", "Vendedor"]}>
            <Placeholder name="Cotizaciones" />
          </Guard>
        }
      />
      <Route
        path="herramientas"
        element={<Placeholder name="Herramientas" />}
      />
      <Route
        path="devoluciones"
        element={
          <Guard roles={["Admin", "Bodeguero"]}>
            <Placeholder name="Devoluciones" />
          </Guard>
        }
      />
      <Route path="productos" element={<Placeholder name="Productos" />} />
    </Route>

    {/* App Admin */}
    <Route
      path="/admin"
      element={
        <Guard roles={["Admin"]}>
          <AdminShell />
        </Guard>
      }
    >
      <Route index element={<Placeholder name="Dashboard" />} />
      <Route path="alertas" element={<Placeholder name="Alertas" />} />
      <Route path="conteo" element={<Placeholder name="Conteo" />} />
      <Route path="abc" element={<Placeholder name="Análisis ABC" />} />
      <Route path="reorden" element={<Placeholder name="Reorden" />} />
      <Route path="auditoria" element={<Placeholder name="Auditoría" />} />
      <Route path="usuarios" element={<Placeholder name="Usuarios" />} />
      <Route path="top10" element={<Placeholder name="Top 10" />} />
    </Route>

    <Route path="*" element={<Navigate to="/login" />} />
  </Routes>
</BrowserRouter>
```

Los `<Placeholder>` son componentes temporales que solo muestran el nombre del módulo. Se reemplazan en fases siguientes.

### 8. `src/main.jsx`

Inicializar el authStore al montar la app:

```jsx
import { useAuthStore } from "./stores/authStore";
// En App o en main: useEffect(() => { useAuthStore.getState().init() }, [])
```

## Criterios de aceptación

- [ ] Pedro (PIN 1234) inicia sesión y ve: Inventario, Compras, Traspasos, Ensambles, Devoluciones, Herramientas, Productos
- [ ] María (PIN 5678) ve: Inventario, Ventas, Cotizaciones, Herramientas, Productos
- [ ] Luis (PIN 7890) ve: Órdenes, Ensambles, Herramientas, Productos
- [ ] Carlos (PIN 0001) ve TODO + botón "Panel Admin"
- [ ] PIN incorrecto muestra error (animación shake)
- [ ] Al navegar a /admin con María → redirige a /ops
- [ ] Al refrescar la página, la sesión se mantiene (no pide PIN otra vez)
- [ ] Botón "Cerrar sesión" funciona y lleva al login
- [ ] En móvil: bottom nav. En desktop: sidebar.
- [ ] `git commit -m "Fase 2: Login PIN + Layout + Guards de rol"`
