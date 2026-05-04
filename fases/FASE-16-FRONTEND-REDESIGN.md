# Fase 16 — Frontend Redesign + Reestructura `src/` feature-based

> **Estado:** pendiente de planeación detallada (`/plan mode`).
> **Fuente:** decisión arquitectural del usuario tras ver el producto con todas las features ya construidas.

## Propósito

1. **Rediseño estético completo** del frontend (la nueva estética la define el usuario en el `/plan mode` propio de esta fase).
2. **Reestructurar `src/`** de page-based a **feature-based** para mejorar escalabilidad y mantener código relacionado junto.

## Alcance

### 16.1 Nueva estética

- A definir por el usuario en el `/plan mode` propio.
- Mantener tokens del CLAUDE.md (`hsl(var(--*))`) — **NUNCA hardcodear colores**.
- Mantener accesibilidad: botones ≥ 48px, contraste alto, IBM Plex Sans.
- Mantener patrón mobile (cards) / desktop (tablas) del CLAUDE.md.
- Conservar el estilo `.admin-shell` distinto del shell de operaciones.

### 16.2 Reestructura `src/` a feature-based

```
src/
├── features/
│   ├── auth/              (login, authStore, RoleGuard)
│   ├── inventario/        (pages, components, hooks, api)
│   ├── ventas/
│   ├── cotizaciones/
│   ├── ot/                (órdenes de trabajo, abonos, checklist)
│   ├── ensambles/
│   ├── traspasos/
│   ├── compras/
│   ├── devoluciones/
│   ├── garantias/         (NUEVO en F13)
│   ├── recibos/           (NUEVO en F14)
│   ├── herramientas/
│   ├── admin/             (dashboard, alertas, ABC, conteo, auditoría, configuración, cierres)
│   └── shared/            (PageHeader, ConfirmDialog, StatusBadge, AppShell, AdminShell)
├── lib/                   (supabase, utils, pdf, qr)
├── stores/                (uiStore — global no-feature)
├── hooks/                 (genéricos: useDebouncedCallback, etc.)
└── styles/                (tokens, theme)
```

Cada `features/<x>/` contiene:

- `pages/` — páginas top-level del dominio.
- `components/` — componentes específicos del dominio (no compartidos).
- `hooks/` — hooks específicos del dominio.
- `api.js` — queries Supabase del dominio (centraliza llamadas).
- `index.js` — barrel export para el resto de la app.

### 16.3 Estrategia de migración (anti-big-bang)

- **Un dominio a la vez.** Después de cada dominio:
  - `npm run build` debe pasar.
  - `npx eslint src/` debe pasar.
  - Tests E2E del dominio migrado deben pasar.
- Actualizar imports con búsqueda guiada (no codemod ciego).
- Branches separadas por dominio: `refactor/feature-cotizaciones`, `refactor/feature-ot`, etc.
- Merge a `main` solo cuando un dominio queda 100% funcional.

### 16.4 Tests E2E (`tests/e2e/`)

- Si las rutas en `react-router` cambian, actualizar paths en specs.
- Si rutas se mantienen iguales (recomendado para no romper deeplinks), específicas no se tocan.

## Riesgo principal

Romper imports → mitigación con migración incremental, lint continuo, build continuo.

## Verificación

- `src/features/` con todos los dominios listados arriba.
- `src/pages/` ya no existe (o solo contiene un barrel histórico transitorio).
- `npm run build` limpio.
- `npx eslint src/` limpio (0 errores, 0 warnings).
- Lighthouse mobile + desktop > 90 en performance, accesibilidad, mejores prácticas.
- 6 usuarios reales prueban smoke E2E sobre nueva estética y reportan OK.
- Bundle size no aumenta > 10% vs versión anterior.
