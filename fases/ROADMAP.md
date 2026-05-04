# ROADMAP — Compresores del Valle

> **Última actualización:** 2026-05-03
> **Estado:** Fases 0–8 cerradas. Fase 9 en preparación.
> **Plan maestro:** `C:\Users\davi-\.claude\plans\reactive-sprouting-kitten.md`
> **Fuente requerimientos cliente:** `C:\Users\davi-\Downloads\requerimientos_reunion_cliente.md` (v3 corregida)

## Fases cerradas (v0.x)

| Fase | Tema               | Archivo                    |
| ---- | ------------------ | -------------------------- |
| 0    | Setup              | `FASE-00-SETUP.md`         |
| 1    | Base de datos      | `FASE-01-BASE-DATOS.md`    |
| 2    | Login + Layout     | `FASE-02-LOGIN-LAYOUT.md`  |
| 3    | Inventario         | `FASE-03-INVENTARIO.md`    |
| 4–8  | Módulos operativos | `FASE-04-AL-09-MODULOS.md` |

## Fases extra (camino a v1.0)

Cada fase tiene su propio `/plan mode` cuando llegue su turno. **Deploy v1.0 (Fase 17) es la última.**

| Fase | Tema                                                                      | Archivo                                           |
| ---- | ------------------------------------------------------------------------- | ------------------------------------------------- |
| 9    | **Configuración General** (cuentas, parámetros, checklist) — prerequisito | `FASE-09-CONFIGURACION-GENERAL.md`                |
| 10   | Ajustes Órdenes de Trabajo (consume catálogos de F9)                      | `FASE-10-AJUSTES-OT.md`                           |
| 11   | Ajustes Cotizaciones (PDF, IVA, validez, cuentas)                         | `FASE-11-AJUSTES-COTIZACIONES.md`                 |
| 12   | Ajustes Inventario + Compras + Traspasos                                  | `FASE-12-AJUSTES-INVENTARIO-COMPRAS-TRASPASOS.md` |
| 13   | Garantías (compras + ventas) — módulo nuevo                               | `FASE-13-GARANTIAS.md`                            |
| 14   | Recibos manuales completos — módulo nuevo                                 | `FASE-14-RECIBOS.md`                              |
| 15   | Dashboard expandido + Cierres                                             | `FASE-15-DASHBOARD-CIERRES.md`                    |
| 16   | Frontend Redesign + Reestructura `src/` feature-based                     | `FASE-16-FRONTEND-REDESIGN.md`                    |
| 17   | **Deploy v1.0** — PWA, QR lote, CSV, UptimeRobot, tag                     | `FASE-17-DEPLOY-V1.md`                            |

## Post-v1.0

| Fase | Tema                                              | Archivo                                 |
| ---- | ------------------------------------------------- | --------------------------------------- |
| 18   | Ensambles avanzados v2 (BOM + receta)             | `POST-V1-FASE-18-ENSAMBLES-V2.md`       |
| 19   | Métricas avanzadas dashboard (garantías, recibos) | `POST-V1-FASE-19-DASHBOARD-AVANZADO.md` |

## Decisiones clave del cliente (resumen)

- **NO hay módulo de clientes** — texto libre (§7).
- **OT autorizada** → anticipo obligatorio. **NO autorizada** → valor por revisión manual (§2.5).
- **Equipo del cliente NUNCA entra al inventario**, ni siquiera tras 30 días (§2.8, §2.9).
- **Piezas usadas en OT SÍ se descuentan** del inventario (§2.7).
- **Garantía de venta = 3 meses** sobre reparación/mantenimiento (§5.2).
- **Cuentas bancarias diferentes** según con/sin IVA (§1.5).
- **IVA configurable** por cotización, default 19%, permite 0% (§1.6).
- **Recibos manuales**, no automáticos (§6.1).
- **Dashboard separa** ingresos productos vs servicios (§8.2).
- **Ensambles v2 y métricas avanzadas dashboard → post-v1.0** (decisión explícita).
