# Fase 17 — Deploy v1.0 (cierre del roadmap)

> **Estado:** pendiente de planeación detallada (`/plan mode`).
> **Era originalmente la Fase 9** del roadmap inicial. Postergada hasta que todas las features y el rediseño estén cerrados.

## Propósito

Cerrar la versión 1.0 con todo lo construido en Fases 1–16 productivo, monitoreado y entregado al cliente.

## Alcance

### 17.1 PWA

- Validar `manifest.webmanifest` con todos los iconos (192/512/maskable).
- Service worker (workbox) con estrategia de caché correcta.
- Offline básico funcional (Inventario, Productos, OT en modo lectura).
- "Add to Home Screen" probado en Android + iOS.

### 17.2 Carga masiva inicial de QR (§3.7)

> _"Eso se vuelve un trabajo horrible, pero una vez lo hagas estás en la gloria."_

- Generar QR para los **~2000 ítems** del catálogo.
- App debe tener herramienta de **generación masiva de QR** (no solo uno a uno).
- La impresión física de etiquetas y pegado físico es **trabajo operativo manual**, no de código.

### 17.3 Importación CSV inicial del catálogo

- Página admin para importar productos desde CSV (referencia, nombre, categoría, costo, precio, stock_minimo, stock_maximo, sede_id).
- Validación de columnas + reporte de errores por fila.
- Idempotente: re-correr el mismo CSV no duplica.

### 17.4 Monitoreo en producción

- **UptimeRobot** apuntando al endpoint healthcheck (e.g., `/api/health` o vista pública).
- Alerta a email/Slack si downtime > 1 minuto.
- Dashboard simple de uptime para el cliente.

### 17.5 Deploy a Netlify Free

- Validar que **uso comercial** está permitido en plan Free (verificar TOS actualizados).
- Si no, evaluar Vercel Free / Cloudflare Pages.
- Variables de entorno en Netlify: SUPABASE_URL, SUPABASE_ANON_KEY (jamás SERVICE_ROLE).
- Dominio custom si el cliente provee uno.

### 17.6 Tag `v1.0.0` + release notes

- Tag git: `git tag -a v1.0.0 -m "Compresores del Valle v1.0"`
- Release notes en GitHub Releases con changelog desde Fase 1.
- Captura del dashboard final + screenshots de cada módulo.

### 17.7 Smoke test E2E completo en producción

- Los 6 usuarios reales (Carlos Admin, Pedro Bodeguero, María/Juan/Ana Vendedores, Luis Técnico) prueban el flujo end-to-end de su rol.
- Checklist firmado por cada usuario antes de declarar v1.0 estable.

### 17.8 Rotación de tokens expuestos

- Issue #3 abierto en GitHub: rotar Supabase service role token + GitHub PAT que estuvieron en `.mcp.json` durante desarrollo.
- Generar tokens nuevos en producción.
- `.mcp.json` queda solo con tokens de DEV / staging.

### 17.9 Documentación final

- README.md con cómo desplegar.
- `docs/USER-GUIDE.md` para los 6 usuarios reales (en español, con capturas).
- `docs/ADMIN-GUIDE.md` para Carlos (parámetros, cuentas bancarias, checklist OT, cierres, etc.).
- `docs/DEV-GUIDE.md` para futuro desarrollador (estructura feature-based, convenciones, RLS, migrations).

## Verificación

- `https://compresores-del-valle.netlify.app` (o dominio asignado) responde 200 público.
- PWA instalable en Android + iOS.
- Tag `v1.0.0` visible en GitHub.
- UptimeRobot reporta uptime > 99% durante 24h consecutivas.
- 6 usuarios reales firman checklist de smoke.
- Tokens rotados; Issue #3 cerrado.
- READMEs y guías PDF entregadas al cliente.
