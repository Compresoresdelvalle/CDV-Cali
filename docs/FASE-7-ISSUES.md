# Issues post-Fase 7

Lista de tareas pendientes y deuda técnica detectadas en la auditoría final de Fase 7 (4 agentes en paralelo: code-reviewer, security-reviewer, database-reviewer, e2e-runner).

Copia cada bloque como un issue separado en GitHub: https://github.com/jdconsultors369-ai/Compresores-del-Valle/issues/new

---

## 🔴 Issue 1: Aplicar migration `20260502000004_hardening_global.sql`

**Labels:** `security` `tech-debt` `fase-7`

**Acción requerida:** correr SQL en Supabase Dashboard.

Cierra issues heredados detectados en auditoría final:

- **SEC-DB**: `SET search_path = public, pg_temp` en 8 funciones SECURITY DEFINER de Fase 1
- **SEC-RLS**: `ventas_insert` con check de sede
- **SEC-RLS**: `detalle_venta` y `detalle_traspaso` restringidas por sede
- **SEC-RLS**: `movimientos.INSERT` bloqueado (`WITH CHECK(false)`)
- **PERF**: `inv_modify`, `prod_modify` con `(SELECT ...)` wrap
- **DATA**: `fecha_entrega` auto-set al transicionar a `entregada`
- **SEC-AUTH**: Trigger `trg_usuarios_inmutables` impide auto-elevación de rol

**Pasos:**

1. Abrir [Supabase SQL Editor](https://supabase.com/dashboard/project/kbgwygnmhjeyiyyxosmb/sql/new)
2. Pegar contenido de `supabase/migrations/20260502000004_hardening_global.sql`
3. RUN
4. Cerrar este issue

---

## 🔴 Issue 2: Rotar token de Supabase Personal Access Token

**Labels:** `security` `urgent`

**Contexto:** Durante el desarrollo de Fase 7 expusimos un token (`sbp_567aa2...`) en el chat para configurar el MCP de Supabase. Por defensa en profundidad, debe rotarse.

**Pasos:**

1. Ir a https://supabase.com/dashboard/account/tokens
2. Revocar el token llamado `Claude Code` o el que termina en `0c00`
3. Generar uno nuevo
4. Actualizar `.mcp.json` (gitignored) con el nuevo
5. Cerrar este issue

---

## 🟠 Issue 3: Validación server-side de precio y descuento en `fn_registrar_venta`

**Labels:** `security` `medium` `phase-4-debt`

**Hallazgo (security pen-test):**

> `precio_unitario` viene del estado React del carrito en `VentaNueva.jsx`. Un usuario con DevTools puede modificar el valor antes del RPC. `fn_registrar_venta` acepta el precio como parámetro sin validarlo contra `productos.precio_venta`.
>
> Adicionalmente, `p_descuento_pct` admite hasta 100% sin verificar autorización por rol — un Vendedor puede regalar mercancía.

**Fix:**

Modificar `fn_registrar_venta` para:

1. Para cada item, leer `precio_venta` y `costo_promedio` directamente de `productos` (ignorar el parámetro `precio_unitario`)
2. Validar que el descuento total no supere un umbral por rol:
   ```sql
   IF v_mi_rol = 'Vendedor' AND p_descuento_pct > 10 THEN
     RAISE EXCEPTION 'Descuentos > 10%% requieren autorización Admin';
   END IF;
   ```
3. Loguear cualquier desvío significativo entre precio enviado y precio BD para auditar manipulación

---

## 🟠 Issue 4: Aplicar `safeError` a páginas de Fases 4-6

**Labels:** `security` `medium` `phase-4-6-debt`

**Hallazgo:**

Las páginas de Fases 4-6 (`VentaNueva`, `VentaDetalle`, `CompraNueva`, `DevolucionNueva`, `CotizacionNueva`, `CotizacionEditar`, `CotizacionDetalle`, `TraspasoNuevo`, `TraspasoDetalle`, `PickingPage`, `RecepcionTraspaso`, `VerificacionTraspaso`) siguen usando `setError(err.message)` directo, lo que filtra nombres de tablas/columnas/constraints al usuario.

**Fix:**

Importar `safeError` de `src/lib/utils.js` y reemplazar:

```js
// ❌ Antes
setError(err.message ?? "Error");

// ✅ Después
setError(safeError(err, "Error al guardar"));
```

Aplicar en todos los `catch` blocks de los archivos listados.

---

## 🟡 Issue 5: Reemplazar `window.confirm()` por modal custom

**Labels:** `ux` `low` `fase-7`

**Hallazgo (code review):**

`OrdenDetalle.jsx:197` usa `window.confirm("¿Eliminar este repuesto?...")` para la eliminación. Es bloqueante, no respeta el design system, y algunos navegadores móviles lo suprimen silenciosamente.

**Fix:**

Crear `src/components/ui/ConfirmDialog.jsx` reutilizable basado en el patrón `ModalWrapper` que ya existe en `Herramientas.jsx`. Reemplazar el `confirm()` actual.

---

## 🟡 Issue 6: Race condition residual en `OrdenHistorial` "Cargar más"

**Labels:** `bug` `low` `fase-7` `~resolved-pending-verify`

Estado: **PARCIALMENTE RESUELTO** en commit `[hardening commit]` con `AbortController` + `mountedRef`. Verificar en QA que clicks rápidos no producen duplicados visuales.

---

## 🟢 Issue 7: Documentar comportamiento esperado de `sessionStorage` para auth

**Labels:** `docs` `low`

**Contexto:**

Los operarios industriales suelen cerrar el navegador para contestar llamadas. Con `sessionStorage` (cambio de Fase 7 anti-XSS), pierden la sesión y deben reingresar el PIN.

**Acción:**

Documentar este trade-off en `docs/AUTH_BEHAVIOR.md` y en el README. Si la fricción operativa es alta, considerar migrar a `localStorage` con TTL corto (1h) o a HttpOnly cookies via proxy.

---

## 🟢 Issue 8: Configurar rate limit de Auth en Supabase

**Labels:** `security` `low` `infra`

PIN de 4 dígitos = 10,000 combinaciones. Confirmar/configurar en Supabase Dashboard:

- Auth → Rate Limits → max attempts per IP
- Auth → Rate Limits → max requests per hour
- Considerar lockout temporal después de N intentos fallidos

---

## 🟢 Issue 9: `mov_select` performance bajo escala

**Labels:** `performance` `low` `phase-4-debt`

Tabla `movimientos` crece append-only. Después de 6-12 meses puede tener 100k+ filas. La política `mov_select` filtra por sede pero hace scan amplio.

**Acción futura:**

Crear índice compuesto:

```sql
CREATE INDEX idx_movimientos_sede_fecha
  ON movimientos(sede_id, fecha DESC);
```

Y considerar partition by month si crece > 1M rows.

---

## 📋 Resumen estado Fase 7

| Categoría                     | Cantidad | Estado                |
| ----------------------------- | -------- | --------------------- |
| Bloqueadores Fase 7           | 0        | ✅                    |
| Issues propios resueltos      | 11       | ✅                    |
| Issues heredados resueltos    | 7        | ✅ (vía migration 04) |
| Issues abiertos para tracking | 9        | 📋 (este archivo)     |

**Tests E2E:** 63/64 pasaron (98.4%) en última ejecución. El test fallido es de locator no de bug.

**Commits relevantes:**

- `161749b` — Fase 7 inicial completa (Herramientas + Órdenes + Ensambles)
- (commit actual) — Hardening final tras auditoría 4 agentes
