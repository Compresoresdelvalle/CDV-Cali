# Picking de recepción de compras — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el bodeguero cuente lo que realmente llegó de una compra antes de recibirla, y que las diferencias terminen donde corresponde: la factura ajustada, un reclamo al proveedor, o un ingreso por sobrante.

**Architecture:** Casi todo se apoya en piezas que ya existen. `fn_recibir_compra` ya acepta recepción parcial por su parámetro `p_recepciones` (que la pantalla nunca usa); `fn_abrir_garantia_compra` con `resolucion='pendiente'` ya deja el reclamo esperando la decisión del Admin; `generarEtiquetasPDF` ya imprime QR; la tabla `notificaciones` ya está en producción con `dedupe_key` y su hook con realtime ya está montado en los dos shells. Lo nuevo es una RPC orquestadora que hace todo en una transacción, dos tablas de bitácora, y una pantalla que sigue los dos idiomas de picking que el proyecto ya tiene.

**Tech Stack:** React 19 + Vite, Zustand, Supabase (PostgreSQL + RLS + Realtime), Tailwind con tokens CSS, Vitest, `qr-scanner`, jsPDF.

**Spec:** `docs/superpowers/specs/2026-09-06-picking-recepcion-compras-design.md`
**Rama / worktree:** `feat/picking-compras` en `C:\Users\davi-\cdv-picking-compras`

---

## Estructura de archivos

**Bloque 0 — Aviso urgente al Admin**

| Archivo                                           | Responsabilidad                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| `supabase/migrations/<ts>_fn_escalar_a_admin.sql` | RPC con el tope de 2 del lado del servidor                                  |
| `src/components/avisos/BotonAvisarAdmin.jsx`      | Botón reutilizable: pide motivo, llama la RPC, muestra los avisos restantes |
| `src/components/avisos/AvisoUrgenteModal.jsx`     | Modal bloqueante que solo ve el Admin                                       |
| `src/components/layout/AppShell.jsx`              | Montar el modal (modificar)                                                 |
| `src/components/layout/AdminShell.jsx`            | Montar el modal (modificar)                                                 |

**Bloque 1 — Picking**

| Archivo                                                   | Responsabilidad                                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/lib/picking-compras.js`                              | Lógica pura: derivar buenas/faltan/sobran, estado por línea, resumen y payload. Sin React ni Supabase |
| `supabase/migrations/<ts>_compra_picking_tablas.sql`      | `compra_picking` + `compra_picking_detalle` + RLS                                                     |
| `supabase/migrations/<ts>_fn_procesar_picking_compra.sql` | RPC orquestadora                                                                                      |
| `src/pages/ops/PickingCompra/index.jsx`                   | Pantalla: carga, guardas, estado, confirmación                                                        |
| `src/pages/ops/PickingCompra/LineaEnfoque.jsx`            | Tarjeta de un producto (celular)                                                                      |
| `src/pages/ops/PickingCompra/LineaLista.jsx`              | Fila de un producto (tablet/escritorio)                                                               |
| `src/pages/ops/PickingCompra/ModalConfirmar.jsx`          | El modal de consecuencias                                                                             |
| `src/pages/ops/PickingCompra/PanelEtiquetas.jsx`          | Impresión de QR sobre lo contado                                                                      |
| `src/pages/ops/CompraDetalle.jsx`                         | Botón "Contar y recibir" (modificar)                                                                  |
| `src/App.jsx`                                             | Ruta nueva (modificar)                                                                                |
| `tests/integration/picking-compras.test.js`               | Tests de la lógica pura                                                                               |

La pantalla se parte en carpeta porque `CompraDetalle.jsx` ya tiene 785 líneas y `PickingPage.jsx` 727: un archivo único aquí nacería con 900 y sería difícil de editar con fiabilidad.

---

# BLOQUE 0 · Aviso urgente al Admin

### Task 1: RPC `fn_escalar_a_admin`

**Files:**

- Create: `supabase/migrations/<ts>_fn_escalar_a_admin.sql`

Contexto que hay que tener presente: `notificaciones` **no tiene política de INSERT**, solo SELECT y UPDATE. Por eso la escalación obligatoriamente pasa por una función `SECURITY DEFINER`; no es una preferencia de diseño.

- [ ] **Step 1: Escribir la migración**

```sql
-- Escalamiento al Admin desde cualquier pantalla operativa.
--
-- El tope de 2 avisos vive AQUI y no en el frontend: en la pantalla bastaria
-- recargar para reiniciar el contador y el spam volveria. Se cuenta contra
-- dedupe_key, que agrupa todos los avisos del mismo documento.
--
-- Reusa la tabla `notificaciones` tal cual. No hay tabla nueva: `para_rol`,
-- `leida` y `dedupe_key` ya existen y el hook useNotificaciones ya carga las no
-- leidas al montar, que es lo que hace que el aviso sea lo primero que ve el
-- Admin al abrir la app aunque no estuviera conectado.

CREATE OR REPLACE FUNCTION public.fn_escalar_a_admin(
  p_origen    text,
  p_origen_id uuid,
  p_motivo    text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_rol        text;
  v_nombre     text;
  v_sede       text;
  v_dedupe     text;
  v_enviados   int;
  v_ultimo     timestamptz;
  v_admin      text;
  v_numero     int;
  v_titulo     text;
  v_ruta       text;
  v_tope       constant int := 2;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT u.rol::text, u.nombre, u.sede_id INTO v_rol, v_nombre, v_sede
    FROM usuarios u WHERE u.id = v_uid;
  IF v_rol IS NULL THEN
    RAISE EXCEPTION 'Sesion no valida. Vuelve a iniciar sesion.';
  END IF;
  IF v_rol = 'Admin' THEN
    RAISE EXCEPTION 'Ya eres el administrador: no hay a quien escalarle esto.';
  END IF;
  IF p_origen IS NULL OR p_origen NOT IN ('compra') THEN
    RAISE EXCEPTION 'Origen no soportado: %', COALESCE(p_origen, 'ninguno');
  END IF;
  IF p_origen_id IS NULL THEN
    RAISE EXCEPTION 'Falta el documento sobre el que se avisa.';
  END IF;
  IF length(TRIM(COALESCE(p_motivo, ''))) < 5 THEN
    RAISE EXCEPTION 'Escribe brevemente que esta pasando (minimo 5 letras), o el aviso no le sirve de nada a quien lo recibe.';
  END IF;

  v_dedupe := 'escalamiento:' || p_origen || ':' || p_origen_id::text;

  SELECT count(*), max(created_at) INTO v_enviados, v_ultimo
    FROM notificaciones WHERE dedupe_key = v_dedupe;

  SELECT u.nombre INTO v_admin
    FROM usuarios u WHERE u.rol::text = 'Admin' AND u.activo LIMIT 1;

  IF v_enviados >= v_tope THEN
    RAISE EXCEPTION 'Ya le avisaste % veces a % por esto (la ultima hace %). Si es urgente, buscala directamente: el sistema no va a insistir mas.',
      v_enviados, COALESCE(v_admin, 'Administracion'),
      COALESCE(age(now(), v_ultimo)::text, 'un momento');
  END IF;

  SELECT c.numero INTO v_numero FROM compras c WHERE c.id = p_origen_id;
  IF v_numero IS NULL THEN
    RAISE EXCEPTION 'Esa compra no existe.';
  END IF;
  v_titulo := format('%s necesita ayuda con la compra #%s', v_nombre, v_numero);
  v_ruta   := '/ops/compras/' || p_origen_id::text;

  INSERT INTO notificaciones (tipo, titulo, mensaje, data, para_rol, created_by, dedupe_key)
  VALUES ('escalamiento', v_titulo, TRIM(p_motivo),
          jsonb_build_object('origen', p_origen, 'origen_id', p_origen_id,
                             'numero', v_numero, 'sede_id', v_sede,
                             'usuario_nombre', v_nombre, 'ruta', v_ruta),
          'Admin', v_uid, v_dedupe);

  RETURN jsonb_build_object(
    'avisos_enviados', v_enviados + 1,
    'restantes',       v_tope - (v_enviados + 1),
    'admin_nombre',    COALESCE(v_admin, 'Administracion'),
    'ultimo_aviso',    now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_escalar_a_admin(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_escalar_a_admin(text, uuid, text) TO authenticated;
```

- [ ] **Step 2: Aplicar la migración**

Aplicar con `mcp__supabase__apply_migration`, nombre `fn_escalar_a_admin`. Después renombrar el archivo local al timestamp que devuelva `supabase_migrations.schema_migrations`, para que el historial y el repo no se contradigan.

- [ ] **Step 3: Probarla contra producción, revertida**

```sql
BEGIN;
CREATE TEMP TABLE r(paso text, resultado text, detalle text);
SET LOCAL request.jwt.claims = '{"sub":"<uuid de un Bodeguero>","role":"authenticated"}';
DO $$
DECLARE v_compra uuid; v_res jsonb;
BEGIN
  SELECT id INTO v_compra FROM compras WHERE NOT recibida AND estado <> 'cancelada' LIMIT 1;
  v_res := fn_escalar_a_admin('compra', v_compra, 'Llego un bulto roto, necesito instrucciones');
  INSERT INTO r VALUES ('1er aviso','ok', v_res::text);
  v_res := fn_escalar_a_admin('compra', v_compra, 'Sigo esperando');
  INSERT INTO r VALUES ('2do aviso','ok','restantes='||(v_res->>'restantes'));
  BEGIN
    PERFORM fn_escalar_a_admin('compra', v_compra, 'Tercer intento');
    INSERT INTO r VALUES ('3er aviso','FALLO: lo dejo pasar', null);
  EXCEPTION WHEN others THEN
    INSERT INTO r VALUES ('3er aviso','rebota (correcto)', left(SQLERRM,140));
  END;
  BEGIN
    PERFORM fn_escalar_a_admin('compra', v_compra, 'no');
    INSERT INTO r VALUES ('motivo corto','FALLO: lo dejo pasar', null);
  EXCEPTION WHEN others THEN
    INSERT INTO r VALUES ('motivo corto','rebota (correcto)', left(SQLERRM,90));
  END;
END $$;
SELECT * FROM r ORDER BY paso;
ROLLBACK;
```

Esperado: los dos primeros pasan (`restantes=1`, luego `restantes=0`), el tercero rebota con el mensaje que da salida, y el motivo corto rebota.

Después del ROLLBACK, confirmar que no quedó nada:
`select count(*) from notificaciones where tipo='escalamiento';` → debe dar 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(avisos): RPC para escalar una situacion al Admin con tope de 2"
```

---

### Task 2: `BotonAvisarAdmin`

**Files:**

- Create: `src/components/avisos/BotonAvisarAdmin.jsx`

- [ ] **Step 1: Escribir el componente**

```jsx
import { useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { avisarError } from "../../lib/notify";
import { safeError } from "../../lib/utils";

/**
 * Escala una situación al Admin desde donde el operario esté trabajando.
 *
 * El tope de avisos NO se lleva aquí: lo cuenta la RPC contra `dedupe_key`. Si
 * viviera en este estado, recargar la página lo reiniciaría. Lo que sí hace el
 * componente es reflejar lo que la RPC le responde.
 *
 * Props:
 *   origen    : "compra"
 *   origenId  : uuid del documento
 *   className : clases extra opcionales
 */
export default function BotonAvisarAdmin({ origen, origenId, className = "" }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(null); // { admin_nombre, restantes }

  const enviar = async () => {
    if (enviando) return;
    setEnviando(true);
    try {
      const { data, error } = await supabase.rpc("fn_escalar_a_admin", {
        p_origen: origen,
        p_origen_id: origenId,
        p_motivo: motivo,
      });
      if (error) throw error;
      setEnviado(data);
      setAbierto(false);
      setMotivo("");
    } catch (err) {
      avisarError(err, "No se pudo avisar");
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <div
        className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${className}`}
        style={{
          borderColor: "hsl(var(--success) / 0.35)",
          backgroundColor: "hsl(var(--success) / 0.08)",
          color: "hsl(var(--foreground))",
        }}
        role="status"
      >
        <Check
          className="mt-0.5 h-3.5 w-3.5 shrink-0"
          style={{ color: "hsl(var(--success))" }}
        />
        <span>
          Ya se le avisó a <strong>{enviado.admin_nombre}</strong>.{" "}
          {enviado.restantes > 0
            ? `Queda ${enviado.restantes} aviso si la cosa sigue.`
            : "No quedan más avisos: si es urgente, búscala directamente."}
        </span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium ${className}`}
        style={{
          minHeight: 48,
          borderColor: "hsl(var(--warning) / 0.4)",
          backgroundColor: "hsl(var(--warning) / 0.08)",
          color: "hsl(var(--warning))",
        }}
      >
        <AlertTriangle className="h-4 w-4" />
        Avisar al administrador
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => !enviando && setAbierto(false)}
        >
          <div
            className="w-full max-w-md space-y-3 rounded-xl border p-5"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              className="text-lg font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              ¿Qué está pasando?
            </h3>
            <p
              className="text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Escríbelo corto y concreto. Le va a salir en pantalla apenas abra
              la aplicación, así que entre más claro, menos llamadas.
            </p>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              autoFocus
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                backgroundColor: "hsl(var(--background))",
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--foreground))",
              }}
              placeholder="Llegaron 3 cajas rotas y no sé si recibirlas"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAbierto(false)}
                disabled={enviando}
                className="flex-1 rounded-lg border text-sm"
                style={{
                  minHeight: 48,
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={enviar}
                disabled={enviando || motivo.trim().length < 5}
                className="flex-1 rounded-lg text-sm font-medium text-white disabled:opacity-40"
                style={{
                  minHeight: 48,
                  backgroundColor: "hsl(var(--warning))",
                }}
              >
                {enviando ? "Avisando…" : "Avisar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Verificar que compila y pasa lint**

Run: `npx eslint src/components/avisos/BotonAvisarAdmin.jsx`
Expected: sin salida (limpio)

- [ ] **Step 3: Commit**

```bash
git add src/components/avisos/BotonAvisarAdmin.jsx
git commit -m "feat(avisos): boton reutilizable para escalar al Admin"
```

---

### Task 3: `AvisoUrgenteModal` y su montaje

**Files:**

- Create: `src/components/avisos/AvisoUrgenteModal.jsx`
- Modify: `src/components/layout/AppShell.jsx` (donde ya está `const notifs = useNotificaciones(perfil)`, línea ~741)
- Modify: `src/components/layout/AdminShell.jsx` (ídem, línea ~479)

- [ ] **Step 1: Escribir el modal**

```jsx
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { formatDate } from "../../lib/utils";

/**
 * Modal bloqueante para los escalamientos.
 *
 * Solo lo ve el Admin y solo para `tipo === 'escalamiento'`: las notificaciones
 * normales siguen tranquilas en la campana. Se apoya en que
 * `useNotificaciones` ya carga las NO LEIDAS al montar, así que si el Admin no
 * estaba conectado cuando le avisaron, esto es lo primero que ve al abrir la
 * app sin necesidad de nada extra.
 *
 * Si hay varios sin leer se muestran en cola, uno por uno.
 *
 * Props:
 *   items     : notificaciones del hook (ya filtradas por para_rol)
 *   perfil    : usuario en sesión
 *   onMarcar  : (id) => Promise<void>  — el `marcarUna` del hook
 */
export default function AvisoUrgenteModal({ items, perfil, onMarcar }) {
  const navigate = useNavigate();

  const pendientes = useMemo(
    () => (items ?? []).filter((n) => n.tipo === "escalamiento" && !n.leida),
    [items],
  );

  if (perfil?.rol !== "Admin" || pendientes.length === 0) return null;

  const n = pendientes[0];
  const ruta = n.data?.ruta ?? null;
  const numero = n.data?.numero ?? null;

  const entendido = async () => {
    await onMarcar?.(n.id);
  };

  const irAlDocumento = async () => {
    await onMarcar?.(n.id);
    if (ruta) navigate(ruta);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.72)" }}
      role="alertdialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg space-y-4 rounded-xl border p-6"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--warning) / 0.5)",
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg"
            style={{ backgroundColor: "hsl(var(--warning) / 0.15)" }}
          >
            <AlertTriangle
              className="h-5 w-5"
              style={{ color: "hsl(var(--warning))" }}
            />
          </div>
          <div className="flex-1">
            <h2
              className="text-lg font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {n.titulo}
            </h2>
            <p
              className="mt-0.5 text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {n.data?.usuario_nombre ?? "Un operario"}
              {n.data?.sede_id ? ` · ${n.data.sede_id}` : ""} ·{" "}
              {formatDate(n.created_at)}
            </p>
          </div>
        </div>

        <p
          className="rounded-lg border px-4 py-3 text-sm"
          style={{
            backgroundColor: "hsl(var(--muted) / 0.3)",
            borderColor: "hsl(var(--border))",
            color: "hsl(var(--foreground))",
          }}
        >
          {n.mensaje}
        </p>

        {pendientes.length > 1 && (
          <p
            className="text-xs"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Hay {pendientes.length - 1} aviso
            {pendientes.length - 1 === 1 ? "" : "s"} más esperando.
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          {ruta && (
            <button
              type="button"
              onClick={irAlDocumento}
              className="flex-1 rounded-lg text-sm font-medium text-white"
              style={{ minHeight: 48, backgroundColor: "hsl(var(--primary))" }}
            >
              Ir a la compra{numero ? ` #${numero}` : ""}
            </button>
          )}
          <button
            type="button"
            onClick={entendido}
            className="flex-1 rounded-lg border text-sm font-medium"
            style={{
              minHeight: 48,
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Montarlo en `AppShell.jsx`**

Añadir el import junto a los demás:

```jsx
import AvisoUrgenteModal from "../avisos/AvisoUrgenteModal";
```

Y en el mismo componente donde ya vive `const notifs = useNotificaciones(perfil);`, renderizarlo dentro del JSX que ese componente devuelve, como último hijo:

```jsx
<AvisoUrgenteModal
  items={notifs.items}
  perfil={perfil}
  onMarcar={notifs.marcarUna}
/>
```

- [ ] **Step 3: Montarlo igual en `AdminShell.jsx`**

Mismo import y mismo bloque, junto a su `const notifs = useNotificaciones(perfil);`.

Ojo con el detalle que ya documenta `useNotificaciones`: los headers de escritorio y móvil se montan los dos a la vez y solo se ocultan por CSS. El modal debe montarse **una sola vez por shell**, no dentro de cada header, o saldrían dos superpuestos.

- [ ] **Step 4: Lint y build**

Run: `npx eslint src/components/avisos src/components/layout/AppShell.jsx src/components/layout/AdminShell.jsx && npm run build`
Expected: lint sin salida, build `✓ built in …`

- [ ] **Step 5: Commit**

```bash
git add src/components/avisos/AvisoUrgenteModal.jsx src/components/layout/AppShell.jsx src/components/layout/AdminShell.jsx
git commit -m "feat(avisos): modal bloqueante de escalamiento para el Admin"
```

---

# BLOQUE 1 · Picking de recepción

### Task 4: Lógica pura del conteo (TDD)

Esta va primero y sin base de datos: es la que decide qué se reclama y qué se ajusta, y es donde un error se paga caro. Se prueba entera antes de que exista pantalla.

**Files:**

- Create: `src/lib/picking-compras.js`
- Test: `tests/integration/picking-compras.test.js`

- [ ] **Step 1: Escribir los tests que fallan**

```js
import { describe, it, expect } from "vitest";
import {
  lineaNueva,
  derivar,
  resumen,
  construirPayload,
  metodoReal,
  METODO,
  BADGE,
} from "../../src/lib/picking-compras";

const det = (over = {}) => ({
  id: "d1",
  producto_id: "p1",
  cantidad: 10,
  destino: "venta",
  producto: { referencia: "MAT6", nombre: "MANGUERA 6MM" },
  ...over,
});

describe("lineaNueva", () => {
  it("arranca en cero y sin contar, que es lo que hace de esto un conteo", () => {
    const l = lineaNueva(det());
    expect(l.llegaron).toBe(0);
    expect(l.danadas).toBe(0);
    expect(l.contada).toBe(false);
    expect(l.pedido).toBe(10);
  });
});

describe("derivar", () => {
  it("sin contar no afirma nada: el cero no significa que no llegó", () => {
    const d = derivar(lineaNueva(det()));
    expect(d.estado).toBe("sin_contar");
  });

  it("llegó todo", () => {
    const d = derivar({ ...lineaNueva(det()), llegaron: 10, contada: true });
    expect(d).toMatchObject({
      buenas: 10,
      faltan: 0,
      sobran: 0,
      estado: "completo",
    });
  });

  it("faltaron", () => {
    const d = derivar({ ...lineaNueva(det()), llegaron: 8, contada: true });
    expect(d).toMatchObject({
      buenas: 8,
      faltan: 2,
      sobran: 0,
      estado: "faltan",
    });
  });

  it("sobraron", () => {
    const d = derivar({ ...lineaNueva(det()), llegaron: 12, contada: true });
    expect(d).toMatchObject({
      buenas: 12,
      faltan: 0,
      sobran: 2,
      estado: "sobran",
    });
  });

  it("dañadas mandan sobre el resto en el semáforo", () => {
    const d = derivar({
      ...lineaNueva(det()),
      llegaron: 8,
      danadas: 2,
      contada: true,
    });
    expect(d).toMatchObject({ buenas: 6, faltan: 2, estado: "danadas" });
  });

  it("una línea contada en cero no es lo mismo que una sin contar", () => {
    const d = derivar({ ...lineaNueva(det()), llegaron: 0, contada: true });
    expect(d.estado).toBe("faltan");
    expect(d.faltan).toBe(10);
  });
});

describe("resumen", () => {
  const base = lineaNueva(det());

  it("no deja confirmar mientras falten líneas por contar", () => {
    const r = resumen([
      base,
      { ...base, detalle_id: "d2", llegaron: 5, contada: true },
    ]);
    expect(r.contadas).toBe(1);
    expect(r.total).toBe(2);
    expect(r.listo).toBe(false);
    expect(r.motivoBloqueo).toMatch(/1 línea/);
  });

  it("no deja confirmar si hay faltante sin decidir qué hacer", () => {
    const r = resumen([
      { ...base, llegaron: 8, contada: true, faltante_accion: null },
    ]);
    expect(r.listo).toBe(false);
    expect(r.motivoBloqueo).toMatch(/faltante/i);
  });

  it("no deja confirmar si hay sobrante sin decidir", () => {
    const r = resumen([
      { ...base, llegaron: 12, contada: true, sobrante_accion: null },
    ]);
    expect(r.listo).toBe(false);
    expect(r.motivoBloqueo).toMatch(/sobrante/i);
  });

  it("suma lo que se reclama: faltante reclamado más dañadas", () => {
    const r = resumen([
      {
        ...base,
        llegaron: 8,
        danadas: 1,
        contada: true,
        faltante_accion: "reclamar",
      },
    ]);
    expect(r.aReclamar).toBe(3);
    expect(r.aAjustar).toBe(0);
    expect(r.listo).toBe(true);
  });

  it("el faltante ajustado no se reclama, baja la factura", () => {
    const r = resumen([
      { ...base, llegaron: 8, contada: true, faltante_accion: "ajustar" },
    ]);
    expect(r.aAjustar).toBe(2);
    expect(r.aReclamar).toBe(0);
  });

  it("cuenta el sobrante", () => {
    const r = resumen([
      { ...base, llegaron: 12, contada: true, sobrante_accion: "entra" },
    ]);
    expect(r.deMas).toBe(2);
    expect(r.listo).toBe(true);
  });
});

describe("todo en cero", () => {
  it("no deja recibir una compra en la que no llego nada: manda a cancelar", () => {
    const l = {
      ...lineaNueva(det()),
      llegaron: 0,
      contada: true,
      faltante_accion: "ajustar",
    };
    const r = resumen([l, { ...l, detalle_id: "d2" }]);
    expect(r.todoEnCero).toBe(true);
    expect(r.listo).toBe(false);
    expect(r.motivoBloqueo).toMatch(/cancelarla/i);
  });

  it("si al menos una linea trae algo, no es el caso de todo en cero", () => {
    const cero = {
      ...lineaNueva(det()),
      llegaron: 0,
      contada: true,
      faltante_accion: "ajustar",
    };
    const algo = {
      ...lineaNueva(det({ id: "d2" })),
      llegaron: 10,
      contada: true,
    };
    const r = resumen([cero, algo]);
    expect(r.todoEnCero).toBe(false);
    expect(r.listo).toBe(true);
  });
});

describe("metodoReal", () => {
  it("'completo' que despues se corrige a mano deja de ser 'completo'", () => {
    const l = {
      ...lineaNueva(det()),
      llegaron: 8,
      contada: true,
      metodo: METODO.COMPLETO,
    };
    expect(metodoReal(l)).toBe(METODO.MANUAL);
  });

  it("'completo' que sigue cuadrando con el pedido se conserva", () => {
    const l = {
      ...lineaNueva(det()),
      llegaron: 10,
      contada: true,
      metodo: METODO.COMPLETO,
    };
    expect(metodoReal(l)).toBe(METODO.COMPLETO);
  });

  it("'nada' al que despues le suman unidades deja de ser 'nada'", () => {
    const l = {
      ...lineaNueva(det()),
      llegaron: 2,
      contada: true,
      metodo: METODO.NADA,
    };
    expect(metodoReal(l)).toBe(METODO.MANUAL);
  });

  it("el escaner se respeta tal cual", () => {
    const l = {
      ...lineaNueva(det()),
      llegaron: 7,
      contada: true,
      metodo: METODO.ESCANER,
    };
    expect(metodoReal(l)).toBe(METODO.ESCANER);
  });
});

describe("BADGE", () => {
  it("cubre todos los estados que puede devolver derivar", () => {
    const estados = ["sin_contar", "completo", "faltan", "danadas", "sobran"];
    for (const e of estados) {
      expect(BADGE[e]).toBeDefined();
      // StatusBadge solo entiende estos cinco: cualquier otro se pinta mal.
      expect(["success", "warning", "danger", "info", "neutral"]).toContain(
        BADGE[e].status,
      );
      expect(BADGE[e].texto.length).toBeGreaterThan(0);
    }
  });
});

describe("construirPayload", () => {
  it("manda los conteos y las decisiones, no los derivados", () => {
    const p = construirPayload([
      {
        ...lineaNueva(det()),
        llegaron: 8,
        danadas: 1,
        contada: true,
        metodo: METODO.ESCANER,
        faltante_accion: "reclamar",
      },
    ]);
    expect(p).toEqual([
      {
        detalle_id: "d1",
        llegaron: 8,
        danadas: 1,
        faltante_accion: "reclamar",
        sobrante_accion: null,
        metodo_conteo: "escaner",
      },
    ]);
  });

  it("el servidor deriva: el payload no lleva buenas ni faltan", () => {
    const p = construirPayload([
      { ...lineaNueva(det()), llegaron: 10, contada: true },
    ]);
    expect(p[0]).not.toHaveProperty("buenas");
    expect(p[0]).not.toHaveProperty("faltan");
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run tests/integration/picking-compras.test.js`
Expected: FAIL — no existe `src/lib/picking-compras.js`

- [ ] **Step 3: Escribir la implementación**

```js
/**
 * Lógica pura del picking de recepción de compras.
 *
 * Sin React y sin Supabase a propósito: es la parte donde un error cuesta plata
 * (una unidad mal clasificada termina en un reclamo que no era, o en una
 * factura mal ajustada), así que tiene que poder probarse sola.
 *
 * La regla que gobierna todo: el campo "llegaron" arranca en CERO, y por eso el
 * cero es ambiguo entre "no llegó nada" y "todavía no lo cuento". La bandera
 * `contada` es la que desambigua, y NADA puede confirmarse mientras alguna
 * línea siga sin contar. Importa de verdad: `fn_recibir_compra` BORRA la línea
 * que reciba en cero.
 */

export const METODO = {
  MANUAL: "manual",
  ESCANER: "escaner",
  COMPLETO: "completo",
  NADA: "nada",
};

/**
 * Estado de línea → props de StatusBadge.
 *
 * Vive aquí y no en cada pantalla para que el modo lista y el modo enfoque no
 * puedan discrepar. StatusBadge SOLO acepta success|warning|danger|info|neutral.
 * Siempre color Y texto: con guantes, polvo y contraluz el color solo no alcanza.
 */
export const BADGE = {
  sin_contar: { status: "neutral", texto: "Sin contar" },
  completo: { status: "success", texto: "Completo" },
  faltan: { status: "warning", texto: "Faltan" },
  danadas: { status: "danger", texto: "Dañadas" },
  sobran: { status: "info", texto: "Sobran" },
};

/** Estado inicial de una línea a partir de su `detalle_compra`. */
export function lineaNueva(detalle) {
  return {
    detalle_id: detalle.id,
    producto_id: detalle.producto_id,
    referencia: detalle.producto?.referencia ?? "",
    nombre: detalle.producto?.nombre ?? "",
    destino: detalle.destino ?? "venta",
    costo_unitario: Number(detalle.costo_unitario ?? 0),
    pedido: Number(detalle.cantidad ?? 0),
    llegaron: 0,
    danadas: 0,
    contada: false,
    metodo: null,
    faltante_accion: null, // 'ajustar' | 'reclamar'
    sobrante_accion: null, // 'entra' | 'entra_y_reporta'
  };
}

const num = (v) => Math.max(0, Math.round(Number(v) || 0));

/** Números derivados y el estado que pinta el semáforo. */
export function derivar(linea) {
  const llegaron = num(linea.llegaron);
  const danadas = Math.min(num(linea.danadas), llegaron);
  const pedido = num(linea.pedido);

  const buenas = llegaron - danadas;
  const faltan = Math.max(0, pedido - llegaron);
  const sobran = Math.max(0, llegaron - pedido);

  // El orden importa: se muestra lo más grave primero. Una línea puede tener
  // faltante Y dañadas a la vez, y el badge tiene que enseñar lo peor.
  let estado = "completo";
  if (!linea.contada) estado = "sin_contar";
  else if (danadas > 0) estado = "danadas";
  else if (faltan > 0) estado = "faltan";
  else if (sobran > 0) estado = "sobran";

  return { llegaron, danadas, buenas, faltan, sobran, pedido, estado };
}

/** Totales de la pantalla y si se puede confirmar (con el porqué si no). */
export function resumen(lineas) {
  const total = lineas.length;
  let contadas = 0;
  let aReclamar = 0;
  let aAjustar = 0;
  let deMas = 0;
  let sinDecidirFaltante = 0;
  let sinDecidirSobrante = 0;

  for (const l of lineas) {
    const d = derivar(l);
    if (l.contada) contadas += 1;
    if (!l.contada) continue;

    aReclamar += d.danadas;
    if (d.faltan > 0) {
      if (l.faltante_accion === "reclamar") aReclamar += d.faltan;
      else if (l.faltante_accion === "ajustar") aAjustar += d.faltan;
      else sinDecidirFaltante += 1;
    }
    if (d.sobran > 0) {
      if (l.sobrante_accion) deMas += d.sobran;
      else sinDecidirSobrante += 1;
    }
  }

  const sinContar = total - contadas;
  // Todo en cero no es un picking, es una compra que no llego. fn_recibir_compra
  // borraria TODAS las lineas y rebotaria con "usa Cancelar compra". Mejor
  // atajarlo aqui y mandar a cancelar, que dejar que reviente contra la base.
  const todoEnCero =
    total > 0 && lineas.every((l) => l.contada && derivar(l).llegaron === 0);

  let motivoBloqueo = null;
  if (todoEnCero) {
    motivoBloqueo =
      "No llegó nada de esta compra. Eso no se recibe: hay que cancelarla desde su detalle.";
  } else if (sinContar > 0) {
    motivoBloqueo = `Faltan ${sinContar} línea${sinContar === 1 ? "" : "s"} por contar`;
  } else if (sinDecidirFaltante > 0) {
    motivoBloqueo = `Falta decidir qué se hace con el faltante en ${sinDecidirFaltante} línea${sinDecidirFaltante === 1 ? "" : "s"}`;
  } else if (sinDecidirSobrante > 0) {
    motivoBloqueo = `Falta decidir qué se hace con el sobrante en ${sinDecidirSobrante} línea${sinDecidirSobrante === 1 ? "" : "s"}`;
  }

  return {
    total,
    contadas,
    sinContar,
    aReclamar,
    aAjustar,
    deMas,
    todoEnCero,
    listo: motivoBloqueo === null && total > 0,
    motivoBloqueo,
  };
}

/**
 * Payload para `fn_procesar_picking_compra`.
 *
 * Van los conteos y las decisiones, NO los derivados: el servidor los recalcula.
 * Si la pantalla mandara `faltan` o `buenas`, un cliente manipulado podría
 * pedir un reclamo por más unidades de las que corresponden.
 */
export function construirPayload(lineas) {
  return lineas.map((l) => {
    const d = derivar(l);
    return {
      detalle_id: l.detalle_id,
      llegaron: d.llegaron,
      danadas: d.danadas,
      faltante_accion: d.faltan > 0 ? l.faltante_accion : null,
      sobrante_accion: d.sobran > 0 ? l.sobrante_accion : null,
      metodo_conteo: metodoReal(l),
    };
  });
}

/**
 * El método que de verdad se usó.
 *
 * Si alguien pulsa "Llegó completo" y después corrige con +/−, el método ya no
 * es 'completo'. Dejarlo así haría que la columna mienta justo en lo que se
 * quiere medir: distinguir un conteo real de uno de trámite. Misma idea con
 * 'nada' si después suma unidades.
 */
export function metodoReal(linea) {
  const d = derivar(linea);
  if (linea.metodo === METODO.COMPLETO && d.llegaron !== d.pedido) {
    return METODO.MANUAL;
  }
  if (linea.metodo === METODO.NADA && d.llegaron !== 0) return METODO.MANUAL;
  return linea.metodo ?? METODO.MANUAL;
}
```

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run tests/integration/picking-compras.test.js`
Expected: PASS, 22 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/picking-compras.js tests/integration/picking-compras.test.js
git commit -m "feat(picking): logica pura del conteo de recepcion"
```

---

### Task 5: Tablas de bitácora

**Files:**

- Create: `supabase/migrations/<ts>_compra_picking_tablas.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- Bitacora del conteo de recepcion.
--
-- No es burocracia: cuando dentro de un mes pregunten por que una compra bajo
-- $60.000, la respuesta tiene que tener nombre y fecha. `metodo_conteo` guarda
-- COMO se conto cada linea, que es lo que despues permite distinguir un conteo
-- real de uno de tramite.

CREATE TABLE IF NOT EXISTS public.compra_picking (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id       uuid NOT NULL UNIQUE REFERENCES public.compras(id),
  usuario_id      uuid NOT NULL REFERENCES public.usuarios(id),
  fecha           timestamptz NOT NULL DEFAULT now(),
  omitido         boolean NOT NULL DEFAULT false,
  lineas_total    integer NOT NULL DEFAULT 0,
  lineas_contadas integer NOT NULL DEFAULT 0,
  notas           text
);

CREATE TABLE IF NOT EXISTS public.compra_picking_detalle (
  id                bigserial PRIMARY KEY,
  picking_id        uuid NOT NULL REFERENCES public.compra_picking(id) ON DELETE CASCADE,
  -- Sin FK a proposito: fn_recibir_compra BORRA la linea que reciba en cero,
  -- y la bitacora del conteo tiene que sobrevivir a eso. Es justo el caso que
  -- despues hay que poder explicar.
  detalle_compra_id uuid NOT NULL,
  producto_id       uuid NOT NULL REFERENCES public.productos(id),
  pedido            integer NOT NULL,
  llegaron          integer NOT NULL,
  danadas           integer NOT NULL DEFAULT 0,
  faltante_accion   text,
  sobrante_accion   text,
  metodo_conteo     text NOT NULL DEFAULT 'manual',
  CONSTRAINT chk_picking_cantidades CHECK (
    llegaron >= 0 AND danadas >= 0 AND danadas <= llegaron AND pedido >= 0
  ),
  CONSTRAINT chk_picking_faltante CHECK (
    faltante_accion IS NULL OR faltante_accion IN ('ajustar','reclamar')
  ),
  CONSTRAINT chk_picking_sobrante CHECK (
    sobrante_accion IS NULL OR sobrante_accion IN ('entra','entra_y_reporta')
  ),
  CONSTRAINT chk_picking_metodo CHECK (
    metodo_conteo IN ('manual','escaner','completo','nada')
  )
);

CREATE INDEX IF NOT EXISTS idx_picking_detalle_picking
  ON public.compra_picking_detalle(picking_id);

ALTER TABLE public.compra_picking          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compra_picking_detalle  ENABLE ROW LEVEL SECURITY;

-- Lectura: Admin ve todo; los demas ven el picking de las compras de su sede.
-- Escritura: NINGUNA politica, a proposito. Solo entra por la RPC
-- SECURITY DEFINER, igual que la recepcion misma.
CREATE POLICY picking_select ON public.compra_picking FOR SELECT
  USING (
    (SELECT get_my_rol()) = 'Admin'
    OR EXISTS (SELECT 1 FROM compras c
                WHERE c.id = compra_picking.compra_id
                  AND c.sede_destino_id = (SELECT get_my_sede_id()))
  );

CREATE POLICY picking_det_select ON public.compra_picking_detalle FOR SELECT
  USING (
    (SELECT get_my_rol()) = 'Admin'
    OR EXISTS (SELECT 1 FROM compra_picking cp JOIN compras c ON c.id = cp.compra_id
                WHERE cp.id = compra_picking_detalle.picking_id
                  AND c.sede_destino_id = (SELECT get_my_sede_id()))
  );

REVOKE INSERT, UPDATE, DELETE ON public.compra_picking         FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.compra_picking_detalle FROM anon, authenticated;
GRANT SELECT ON public.compra_picking         TO authenticated;
GRANT SELECT ON public.compra_picking_detalle TO authenticated;
```

- [ ] **Step 2: Aplicar y verificar la RLS**

Aplicar con `apply_migration`, nombre `compra_picking_tablas`. Luego:

```sql
select tablename, rowsecurity from pg_tables where tablename like 'compra_picking%';
select polname, cmd from pg_policies where tablename like 'compra_picking%';
```

Expected: `rowsecurity = true` en las dos, y solo políticas de SELECT.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(picking): tablas de bitacora del conteo de recepcion"
```

---

### Task 6: RPC `fn_procesar_picking_compra`

**Files:**

- Create: `supabase/migrations/<ts>_fn_procesar_picking_compra.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- Orquesta el picking en UNA transaccion. Hoy serian tres operaciones sueltas
-- (recibir, reclamar, ajustar el sobrante) y quedarse a mitad dejaria el
-- inventario mintiendo.
--
-- Orden de operaciones, que no es arbitrario:
--   1. Se recibe (fn_recibir_compra). Si una linea tiene faltante AJUSTADO, se
--      le pasa `cantidad_recibida` y la factura baja. Si el faltante se
--      RECLAMA, la linea va completa y la factura no se toca.
--   2. Solo despues se abre la garantia, porque fn_abrir_garantia_compra exige
--      que la compra este recibida y saca las unidades del stock que acaba de
--      entrar.
--   3. El sobrante entra por ajuste al final, al costo de la linea.
--
-- Las lineas ajustadas y las reclamadas son disjuntas por construccion, asi que
-- el tope de "no reclamar mas de lo comprado" de la garantia nunca choca con el
-- ajuste de la factura.

CREATE OR REPLACE FUNCTION public.fn_procesar_picking_compra(
  p_compra_id uuid,
  p_lineas    jsonb DEFAULT NULL,
  p_omitido   boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_rol        text;
  v_mi_sede    text;
  v_compra     record;
  v_total_lin  int;
  v_picking_id uuid;
  v_l          jsonb;
  v_det        record;
  v_llegaron   int;
  v_danadas    int;
  v_faltan     int;
  v_sobran     int;
  v_recep      jsonb := '[]'::jsonb;
  v_items_gar  jsonb := '[]'::jsonb;
  v_recl_prod  jsonb := '{}'::jsonb;
  v_distintas  int;
  v_reclamo    int;
  v_gar_id     uuid;
  v_contadas   int := 0;
  v_stock_ant  int;
  v_sobran_tot int := 0;
  v_ajust_tot  int := 0;
  v_recl_tot   int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT u.rol::text, u.sede_id INTO v_rol, v_mi_sede FROM usuarios u WHERE u.id = v_uid;
  IF v_rol NOT IN ('Admin','Bodeguero') THEN
    RAISE EXCEPTION 'El conteo de recepcion lo hacen Bodega o Administracion. Tu rol (%) puede recibir la compra, pero no contarla.', v_rol;
  END IF;

  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra no encontrada'; END IF;
  IF v_rol <> 'Admin' AND v_compra.sede_destino_id IS DISTINCT FROM v_mi_sede THEN
    RAISE EXCEPTION 'Esta compra es de la sede %, y tu estas en %. Pidesela a quien reciba alli o a Maritza.',
      v_compra.sede_destino_id, COALESCE(v_mi_sede,'ninguna');
  END IF;
  IF v_compra.estado = 'cancelada' THEN
    RAISE EXCEPTION 'La compra #% esta cancelada: no hay nada que recibir.', v_compra.numero;
  END IF;
  IF COALESCE(v_compra.recibida,false) THEN
    RAISE EXCEPTION 'La compra #% ya fue recibida el %.', v_compra.numero,
      to_char(v_compra.fecha_recepcion AT TIME ZONE 'America/Bogota','DD/MM/YYYY HH24:MI');
  END IF;

  SELECT count(*) INTO v_total_lin FROM detalle_compra WHERE compra_id = p_compra_id;
  IF v_total_lin = 0 THEN
    RAISE EXCEPTION 'La compra #% no tiene productos que contar. Recibela directamente.', v_compra.numero;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('picking:' || p_compra_id::text));

  -- ── Camino corto: recibir sin contar ──────────────────────────────────
  IF p_omitido THEN
    INSERT INTO compra_picking (compra_id, usuario_id, omitido, lineas_total, lineas_contadas, notas)
    VALUES (p_compra_id, v_uid, true, v_total_lin, 0, 'Recibida sin contar')
    RETURNING id INTO v_picking_id;

    PERFORM fn_recibir_compra(p_compra_id, NULL);

    RETURN jsonb_build_object('picking_id', v_picking_id, 'omitido', true,
      'numero', v_compra.numero, 'lineas', v_total_lin);
  END IF;

  -- ── Validacion del conteo ─────────────────────────────────────────────
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' THEN
    RAISE EXCEPTION 'No llego ningun conteo. Vuelve a la pantalla y cuenta la mercancia.';
  END IF;

  -- Contar elementos NO alcanza: mandar dos veces la misma linea y omitir otra
  -- daria la misma longitud y dejaria una linea sin contar recibiendose
  -- completa. Se exige cobertura por lineas DISTINTAS.
  SELECT count(DISTINCT (e->>'detalle_id')) INTO v_distintas
    FROM jsonb_array_elements(p_lineas) e;
  IF v_distintas <> v_total_lin THEN
    RAISE EXCEPTION 'El conteo no cubre toda la compra: tiene % lineas y llegaron % distintas. Vuelve a la pantalla y termina de contar.',
      v_total_lin, v_distintas;
  END IF;

  INSERT INTO compra_picking (compra_id, usuario_id, omitido, lineas_total, lineas_contadas)
  VALUES (p_compra_id, v_uid, false, v_total_lin, v_total_lin)
  RETURNING id INTO v_picking_id;

  FOR v_l IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    SELECT dc.*, p.nombre AS pnombre INTO v_det
      FROM detalle_compra dc JOIN productos p ON p.id = dc.producto_id
     WHERE dc.id = (v_l->>'detalle_id')::uuid AND dc.compra_id = p_compra_id
     FOR UPDATE OF dc;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Una de las lineas contadas no pertenece a esta compra.';
    END IF;

    v_llegaron := GREATEST(0, COALESCE((v_l->>'llegaron')::int, 0));
    v_danadas  := GREATEST(0, COALESCE((v_l->>'danadas')::int, 0));
    IF v_danadas > v_llegaron THEN
      RAISE EXCEPTION 'En % marcaste % dañadas pero solo llegaron %.',
        v_det.pnombre, v_danadas, v_llegaron;
    END IF;

    v_faltan := GREATEST(0, v_det.cantidad - v_llegaron);
    v_sobran := GREATEST(0, v_llegaron - v_det.cantidad);

    IF v_faltan > 0 AND COALESCE(v_l->>'faltante_accion','') NOT IN ('ajustar','reclamar') THEN
      RAISE EXCEPTION 'Falta decidir que se hace con las % unidades que faltaron de %.',
        v_faltan, v_det.pnombre;
    END IF;
    IF v_sobran > 0 AND COALESCE(v_l->>'sobrante_accion','') NOT IN ('entra','entra_y_reporta') THEN
      RAISE EXCEPTION 'Falta decidir que se hace con las % unidades de mas de %.',
        v_sobran, v_det.pnombre;
    END IF;

    INSERT INTO compra_picking_detalle (picking_id, detalle_compra_id, producto_id,
      pedido, llegaron, danadas, faltante_accion, sobrante_accion, metodo_conteo)
    VALUES (v_picking_id, v_det.id, v_det.producto_id, v_det.cantidad,
      v_llegaron, v_danadas,
      NULLIF(v_l->>'faltante_accion',''), NULLIF(v_l->>'sobrante_accion',''),
      COALESCE(NULLIF(v_l->>'metodo_conteo',''), 'manual'));

    -- Solo el faltante AJUSTADO baja la factura.
    IF v_faltan > 0 AND v_l->>'faltante_accion' = 'ajustar' THEN
      v_recep := v_recep || jsonb_build_array(jsonb_build_object(
        'detalle_id', v_det.id, 'cantidad_recibida', v_llegaron));
      v_ajust_tot := v_ajust_tot + v_faltan;
    END IF;

    -- Lo que se le reclama al proveedor: dañadas siempre, mas el faltante que
    -- el operario marco como facturado.
    v_reclamo := v_danadas
               + CASE WHEN v_faltan > 0 AND v_l->>'faltante_accion' = 'reclamar'
                      THEN v_faltan ELSE 0 END;
    -- Se acumula por PRODUCTO, no por linea. Nada impide que el mismo producto
    -- venga en dos lineas de la misma compra (una para venta y otra para
    -- insumo es un caso legitimo, y no hay constraint que lo prohiba). Con dos
    -- entradas del mismo producto, el tope de fn_abrir_garantia_compra se
    -- evaluaria por partes en vez de contra el total.
    IF v_reclamo > 0 THEN
      v_recl_prod := v_recl_prod || jsonb_build_object(
        v_det.producto_id::text,
        COALESCE((v_recl_prod->>v_det.producto_id::text)::int, 0) + v_reclamo);
      v_recl_tot := v_recl_tot + v_reclamo;
    END IF;

    v_sobran_tot := v_sobran_tot + v_sobran;
  END LOOP;

  -- ── 1. Recibir ────────────────────────────────────────────────────────
  PERFORM fn_recibir_compra(p_compra_id,
    CASE WHEN jsonb_array_length(v_recep) > 0 THEN v_recep ELSE NULL END);

  -- ── 2. Reclamar al proveedor, si hay que reclamar ─────────────────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'producto_id', e.k::uuid, 'cantidad', e.v::int)), '[]'::jsonb)
    INTO v_items_gar
    FROM jsonb_each_text(v_recl_prod) AS e(k, v)
   WHERE e.v::int > 0;

  IF jsonb_array_length(v_items_gar) > 0 THEN
    v_gar_id := fn_abrir_garantia_compra(jsonb_build_object(
      'compra_id',  p_compra_id,
      'resolucion', 'pendiente',
      'motivo',     'Diferencia detectada en el conteo de recepcion',
      'items',      v_items_gar));
  END IF;

  -- ── 3. Sobrante: entra al costo de la linea ───────────────────────────
  IF v_sobran_tot > 0 THEN
    FOR v_det IN
      SELECT d.producto_id, d.destino, dc.costo_unitario,
             (d.llegaron - d.pedido) AS sobran
        FROM compra_picking_detalle d
        JOIN detalle_compra dc ON dc.id = d.detalle_compra_id
       WHERE d.picking_id = v_picking_id AND d.llegaron > d.pedido
    LOOP
      INSERT INTO inventario (producto_id, sede_id, cantidad, cantidad_insumo)
      VALUES (v_det.producto_id, v_compra.sede_destino_id, 0, 0)
      ON CONFLICT (producto_id, sede_id) DO NOTHING;

      IF v_det.destino = 'insumo' THEN
        SELECT COALESCE(cantidad_insumo,0) INTO v_stock_ant FROM inventario
         WHERE producto_id = v_det.producto_id AND sede_id = v_compra.sede_destino_id FOR UPDATE;
        UPDATE inventario SET cantidad_insumo = COALESCE(cantidad_insumo,0) + v_det.sobran,
               ultimo_movimiento = now(), updated_at = now()
         WHERE producto_id = v_det.producto_id AND sede_id = v_compra.sede_destino_id;
      ELSE
        SELECT COALESCE(cantidad,0) INTO v_stock_ant FROM inventario
         WHERE producto_id = v_det.producto_id AND sede_id = v_compra.sede_destino_id FOR UPDATE;
        UPDATE inventario SET cantidad = cantidad + v_det.sobran,
               ultimo_movimiento = now(), updated_at = now()
         WHERE producto_id = v_det.producto_id AND sede_id = v_compra.sede_destino_id;
      END IF;

      INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad,
        stock_anterior, stock_posterior, referencia_id, referencia_tipo,
        usuario_id, observaciones)
      VALUES ('ajuste', v_det.producto_id, v_compra.sede_destino_id, v_det.sobran,
        v_stock_ant, v_stock_ant + v_det.sobran, p_compra_id, 'compra', v_uid,
        format('Sobrante en la recepcion de la compra #%s (entra al costo de la linea, $%s)',
               v_compra.numero, to_char(v_det.costo_unitario,'FM999G999G999G990')));

      PERFORM fn_actualizar_estado_stock(v_det.producto_id, v_compra.sede_destino_id);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'picking_id', v_picking_id, 'omitido', false, 'numero', v_compra.numero,
    'lineas', v_total_lin, 'ajustadas', v_ajust_tot,
    'reclamadas', v_recl_tot, 'sobrantes', v_sobran_tot,
    'garantia_id', v_gar_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_procesar_picking_compra(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_procesar_picking_compra(uuid, jsonb, boolean) TO authenticated;
```

Nota sobre `costo_promedio`: el sobrante **no** lo recalcula. El ponderado ya lo movió `trg_compra_sumar_stock` con lo facturado, y volver a moverlo con unidades que nadie facturó lo distorsionaría. El costo queda anotado en la observación del movimiento, que es donde sirve para auditar.

- [ ] **Step 2: Aplicar la migración**

Con `apply_migration`, nombre `fn_procesar_picking_compra`. Renombrar el archivo local al timestamp real.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(picking): RPC que orquesta conteo, recepcion, reclamo y sobrante"
```

---

### Task 7: Probar la RPC contra producción

Todas las pruebas van dentro de `BEGIN … ROLLBACK`.

**Cada prueba tiene que CREAR su propia compra**, no buscar una. Verificado
contra producción: de 737 compras, **cero** están sin recibir, y el 98% se
registran y reciben en el mismo segundo. Buscar una pendiente no encuentra nada.

Al inicio de cada transacción:

```sql
SET LOCAL request.jwt.claims = '{"sub":"<uuid Bodeguero>","role":"authenticated"}';
SELECT fn_registrar_compra(
  'BODEGA', 'PROVEEDOR DE PRUEBA', 'FAC-TEST', 'Prueba de picking, se revierte',
  false,  -- p_recibir: se deja SIN recibir, que es lo que el picking necesita
  jsonb_build_array(
    jsonb_build_object('producto_id', '<producto de prueba A>', 'cantidad', 10,
                       'costo_unitario', 1000, 'destino', 'venta'),
    jsonb_build_object('producto_id', '<producto de prueba B>', 'cantidad', 5,
                       'costo_unitario', 2000, 'destino', 'venta')),
  19, 'Efectivo', NULL, NULL
) AS creada;
```

Devuelve `{compra_id, numero, …}`. Usar productos `INVENTARIO DE PRUEBA (999)`.

- [ ] **Step 1: Caso completo — todo llegó bien**

Esta plantilla es completa y ejecutable. Los pasos 2 a 6 son la misma con otro
`jsonb_build_object` por linea: cambiar `llegaron`, `danadas` y las acciones.

```sql
BEGIN;
SET LOCAL request.jwt.claims = '{"sub":"<uuid Bodeguero>","role":"authenticated"}';
CREATE TEMP TABLE r(paso text, resultado text, detalle text);

DO $$
DECLARE
  v_compra uuid; v_lineas jsonb := '[]'::jsonb; v_d record;
  v_total_ant numeric; v_res jsonb; v_stock_ant jsonb; v_ok boolean;
BEGIN
  -- Una compra sin recibir, de BODEGA, con al menos 2 lineas.
  SELECT c.id, c.total INTO v_compra, v_total_ant
    FROM compras c
   WHERE NOT COALESCE(c.recibida,false) AND c.estado <> 'cancelada'
     AND c.sede_destino_id = 'BODEGA'
     AND (SELECT count(*) FROM detalle_compra d WHERE d.compra_id = c.id) >= 2
   ORDER BY c.fecha DESC LIMIT 1;
  IF v_compra IS NULL THEN
    INSERT INTO r VALUES ('0 datos','SIN COMPRA DISPONIBLE',
      'crear una con fn_registrar_compra y productos de prueba'); RETURN;
  END IF;

  -- Foto del stock antes, por producto.
  SELECT jsonb_object_agg(d.producto_id::text, COALESCE(i.cantidad,0))
    INTO v_stock_ant
    FROM detalle_compra d
    LEFT JOIN inventario i ON i.producto_id = d.producto_id AND i.sede_id = 'BODEGA'
   WHERE d.compra_id = v_compra;

  -- Todo llego completo.
  SELECT jsonb_agg(jsonb_build_object(
           'detalle_id', d.id, 'llegaron', d.cantidad, 'danadas', 0,
           'faltante_accion', NULL, 'sobrante_accion', NULL,
           'metodo_conteo', 'completo'))
    INTO v_lineas FROM detalle_compra d WHERE d.compra_id = v_compra;

  v_res := fn_procesar_picking_compra(v_compra, v_lineas, false);
  INSERT INTO r VALUES ('1 resultado de la RPC','ok', v_res::text);

  SELECT recibida INTO v_ok FROM compras WHERE id = v_compra;
  INSERT INTO r VALUES ('2 quedo recibida',
    CASE WHEN v_ok THEN 'si (correcto)' ELSE 'FALLO' END, null);

  INSERT INTO r VALUES ('3 el total no cambio',
    CASE WHEN (SELECT total FROM compras WHERE id=v_compra) = v_total_ant
         THEN 'si (correcto)' ELSE 'FALLO' END,
    'antes '||v_total_ant);

  INSERT INTO r VALUES ('4 sin garantia',
    CASE WHEN v_res->>'garantia_id' IS NULL THEN 'si (correcto)' ELSE 'FALLO' END, null);

  SELECT bool_and(COALESCE(i.cantidad,0) = (v_stock_ant->>d.producto_id::text)::int + d.cantidad)
    INTO v_ok
    FROM detalle_compra d
    LEFT JOIN inventario i ON i.producto_id = d.producto_id AND i.sede_id = 'BODEGA'
   WHERE d.compra_id = v_compra;
  INSERT INTO r VALUES ('5 el stock subio exactamente lo pedido',
    CASE WHEN v_ok THEN 'si (correcto)' ELSE 'FALLO' END, null);
END $$;

SELECT * FROM r ORDER BY paso;
ROLLBACK;
```

Expected: los cinco pasos en "si (correcto)", y en el paso 1
`ajustadas=0, reclamadas=0, sobrantes=0, garantia_id=null`.

- [ ] **Step 2: Faltante ajustado — la factura baja**

Una línea con `llegaron = pedido - 2` y `faltante_accion='ajustar'`.
Expected: `compras.total` baja en `2 × costo_unitario` (más su IVA), `detalle_compra.cantidad` queda en lo que llegó, `ajustadas=2`, sin garantía.

- [ ] **Step 3: Faltante reclamado — se abre garantía y el total no cambia**

Misma línea con `faltante_accion='reclamar'`.
Expected: `compras.total` **igual que antes**, `garantias_compra` con una fila en `estado='abierta'` y `resolucion='pendiente'`, `compras.estado='devolucion_garantia'`, e inventario neto = lo que llegó.

- [ ] **Step 4: Dañadas**

`llegaron = pedido`, `danadas = 2`.
Expected: total sin cambios, garantía por 2, inventario neto = pedido − 2.

- [ ] **Step 5: Sobrante**

`llegaron = pedido + 2`, `sobrante_accion='entra'`.
Expected: inventario = pedido + 2; un movimiento `ajuste` de +2 con la observación citando la compra; `productos.costo_promedio` **sin cambios** respecto al valor que dejó la recepción.

- [ ] **Step 6: Caso mixto**

`pedido=10, llegaron=8, danadas=1, faltante_accion='reclamar'`.
Expected: garantía por 3 (2 faltantes + 1 dañada), inventario neto 7, total sin cambios.

- [ ] **Step 7: Los rechazos**

Verificar que cada uno rebota con su mensaje: compra ya recibida, compra cancelada, otra sede con rol Bodeguero, rol Vendedor, conteo incompleto (menos líneas que la compra), `danadas > llegaron`, y faltante sin `faltante_accion`.

- [ ] **Step 8: Confirmar que producción quedó intacta**

```sql
select (select count(*) from compra_picking) pickings,
       (select count(*) from garantias_compra) garantias,
       (select count(*) from movimientos where fecha > now() - interval '1 hour') movs;
```

Expected: `pickings = 0` y los otros dos en el valor que tenían antes de empezar.

- [ ] **Step 9: Commit de las notas de prueba**

```bash
git commit --allow-empty -m "test(picking): verificacion de la RPC contra produccion, revertida"
```

---

### Task 8: Pantalla — esqueleto, carga y guardas

**Files:**

- Create: `src/pages/ops/PickingCompra/index.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Registrar la ruta en `App.jsx`**

Junto a las demás rutas de compras (alrededor de la línea 224), con el mismo patrón de `RoleGuard`:

```jsx
<Route
  path="compras/:id/picking"
  element={
    <RoleGuard roles={["Admin", "Bodeguero"]}>
      <PickingCompra />
    </RoleGuard>
  }
/>
```

Y el import arriba: `import PickingCompra from "./pages/ops/PickingCompra";`

- [ ] **Step 2: Escribir la carga y las guardas**

La consulta, con todo lo que la lógica pura necesita:

```js
const { data: compra } = await supabase
  .from("compras")
  .select(
    `id, numero, proveedor, factura_proveedor, sede_destino_id,
           total, recibida, fecha_recepcion, estado,
           detalle_compra ( id, producto_id, cantidad, costo_unitario, destino,
                            producto:producto_id ( referencia, nombre ) )`,
  )
  .eq("id", id)
  .maybeSingle();
```

Las guardas van **antes de pintar nada**, cada una con su mensaje y su salida; nunca una pantalla en blanco ni un "no autorizado" pelado:

```js
const lineasCompra = compra?.detalle_compra ?? [];

const bloqueo = !compra
  ? { txt: "Esa compra no existe o fue eliminada.", a: "/ops/compras" }
  : compra.estado === "cancelada"
    ? {
        txt: `La compra #${compra.numero} está cancelada: no hay nada que recibir.`,
        a: `/ops/compras/${id}`,
      }
    : compra.recibida
      ? {
          txt: `La compra #${compra.numero} ya se recibió el ${formatDate(compra.fecha_recepcion)}.`,
          a: `/ops/compras/${id}`,
        }
      : lineasCompra.length === 0
        ? {
            txt: `La compra #${compra.numero} no tiene productos que contar. Recíbela directamente desde su detalle.`,
            a: `/ops/compras/${id}`,
          }
        : perfil.rol !== "Admin" && compra.sede_destino_id !== perfil.sede_id
          ? {
              txt: `Esta compra es de la sede ${compra.sede_destino_id} y tú estás en ${perfil.sede_id}. Pídesela a quien reciba allí o a Maritza.`,
              a: `/ops/compras/${id}`,
            }
          : null;
```

Si `bloqueo` no es nulo, se pinta solo ese mensaje con un botón que lleva a `bloqueo.a`.

El estado arranca con `lineasCompra.map(lineaNueva)`.

**Persistencia del conteo.** En cada cambio se guarda; al montar, si hay algo, se ofrece retomarlo. Sin esto, la primera vez que se apague un celular en la línea 38 de 40 no vuelven a contar nunca:

```js
const CLAVE = `picking:${id}`;

// Guardar (en un useEffect que dependa de `lineas`)
try {
  localStorage.setItem(CLAVE, JSON.stringify({ ts: Date.now(), lineas }));
} catch {
  // Modo privado o cuota llena: perder el borrador no puede tumbar la pantalla.
}

// Recuperar al montar
try {
  const crudo = localStorage.getItem(CLAVE);
  if (crudo) {
    const { ts, lineas: guardadas } = JSON.parse(crudo);
    // Se compara el CONJUNTO de detalle_id, no la cantidad. Si alguien editó la
    // compra entre el borrador y la vuelta, dos listas del mismo largo pueden
    // ser de productos distintos, y restaurar ahí pondría los conteos sobre las
    // líneas equivocadas. Perder el borrador es molesto; aplicarlo mal es peor.
    const idsAhora = new Set(lineasCompra.map((d) => d.id));
    const mismasLineas =
      Array.isArray(guardadas) &&
      guardadas.length === idsAhora.size &&
      guardadas.every((g) => idsAhora.has(g.detalle_id));
    if (mismasLineas) setBorrador({ ts, lineas: guardadas });
    else localStorage.removeItem(CLAVE);
  }
} catch {
  localStorage.removeItem(CLAVE);
}
```

El aviso dice de cuándo es: _"Tienes un conteo sin terminar de hace 12 minutos, ¿lo retomo?"_, con "Retomar" y "Empezar de nuevo". Se borra con `localStorage.removeItem(CLAVE)` al confirmar con éxito.

- [ ] **Step 3: Lint y build**

Run: `npx eslint src/pages/ops/PickingCompra src/App.jsx && npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/pages/ops/PickingCompra src/App.jsx
git commit -m "feat(picking): ruta y esqueleto de la pantalla de conteo"
```

---

### Task 9: Modo enfoque

**Files:**

- Create: `src/pages/ops/PickingCompra/LineaEnfoque.jsx`
- Modify: `src/pages/ops/PickingCompra/index.jsx`

- [ ] **Step 1: Escribir la tarjeta**

Un producto por pantalla, siguiendo el layout del spec. Los controles: `−` y `+` de 56px, un `<input type="number">` con el número grande y `tabular-nums` en el medio — el patrón de `QtyBtn` que ya usa `PickingPage`. **No existe ningún `NumericKeypad` en el proyecto**, así que no se puede usar.

Los dos atajos, visibles solo mientras la línea siga sin contar:

- **"Llegó completo (24)"** → `llegaron = pedido`, `contada = true`, `metodo = METODO.COMPLETO`
- **"No llegó nada"** → pide confirmación (`useConfirm` de `src/components/ui/ConfirmDialog`) explicando que esa línea se borra de la factura, y deja `llegaron = 0`, `contada = true`, `metodo = METODO.NADA`

Cualquier toque en `+`, `−` o el input marca `contada = true` y `metodo = METODO.MANUAL`.

El badge usa el mapa `BADGE` que ya quedó definido en `picking-compras.js`
(Task 4), para que el modo lista y el modo enfoque no puedan discrepar:

```js
import { derivar, BADGE } from "../../../lib/picking-compras";
```

Se usa como `<StatusBadge status={BADGE[d.estado].status}>{BADGE[d.estado].texto}</StatusBadge>`, y al lado el detalle numérico (_"faltan 2 · 1 dañada"_).

**El control de dañadas hay que construirlo, no solo mencionarlo.** En la primera
versión del plan las dañadas aparecían únicamente como _texto de salida_ (ese
"1 dañada" de arriba), sin ningún control para ponerlas en más de cero: toda la
rama de `danadas` y `aReclamar` de la lógica pura —probada con 23 tests— habría
quedado inalcanzable desde la pantalla. Va un segundo stepper pequeño, **"De
esas, ¿cuántas llegaron dañadas?"**, que solo aparece cuando `llegaron > 0` y
queda acotado a `[0, llegaron]`.

Las preguntas de faltante y sobrante aparecen debajo solo cuando corresponden, como dos botones grandes cada una.

- [ ] **Step 2: Conectar el escáner**

`QRScanner` acepta `{ onFound, onClose, continuo }`. Se usa **`continuo = true`**: en una descarga se escanean muchas piezas seguidas y cerrar el escáner en cada lectura sería inservible.

**OJO, esto lo tuve mal en la primera version del plan.** `QRScanner` NO entrega
el texto crudo del QR: entrega `data.id`, el **uuid del producto**. Se ve en
`QRScanner.jsx` (`onFoundRef.current(data.id)`) y es como lo consumen todas las
pantallas que ya lo usan — `PickingPage`, `CompraNueva`, `CotizacionNueva`,
`TraspasoNuevo`, `EnsambleNuevo` — que comparan por `producto_id`. Comparar
contra `referencia` no habria hecho match jamas: cada escaneo habria respondido
"este producto no esta en la compra", y el escaner es el metodo principal para
contar.

En `onFound(productoId)`: buscar **todas** las lineas de ese producto.

```js
const coincidencias = lineas.filter((l) => l.producto_id === productoId);

if (coincidencias.length === 0) {
  // Por su nombre, no un error mudo: el operario tiene la pieza en la mano y
  // necesita saber si se equivocó de caja o si falta registrarla.
  avisarInfo(`Ese producto no está en la compra #${compra.numero}`);
} else if (coincidencias.length === 1) {
  sumarUno(coincidencias[0].detalle_id, METODO.ESCANER);
} else {
  // Nada impide que el mismo producto venga en dos líneas de una compra (una
  // para venta y otra para insumo es legítimo). Adivinar cuál sumar sería
  // meter un error de inventario en silencio: se pregunta.
  setDesambiguar(coincidencias);
}
```

`setDesambiguar` abre una hoja con las líneas candidatas mostrando su **destino**
(venta / insumo) y lo que lleva contado cada una, para que el operario elija.
El escáner no se cierra en ningún caso: es modo continuo.

- [ ] **Step 3: Lint y build**

Run: `npx eslint src/pages/ops/PickingCompra && npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/pages/ops/PickingCompra
git commit -m "feat(picking): modo enfoque con atajos y escaner continuo"
```

---

### Task 10: Modo lista, resumen y confirmación

**Files:**

- Create: `src/pages/ops/PickingCompra/LineaLista.jsx`
- Create: `src/pages/ops/PickingCompra/ModalConfirmar.jsx`
- Modify: `src/pages/ops/PickingCompra/index.jsx`

- [ ] **Step 1: Escribir la fila de lista**

Misma información que la tarjeta pero en horizontal. En `md` cards de una columna con controles grandes; en `lg` tabla, siguiendo la Regla #5 del proyecto (desktop tabla / mobile cards).

- [ ] **Step 2: El conmutador y la barra de resumen**

Toggle **Enfoque | Lista** que recuerda la preferencia en `localStorage` bajo `picking-modo`; el valor inicial sale del ancho de pantalla, no de una pregunta al usuario.

Barra fija abajo con `resumen(lineas)`: **"contadas 12 de 15 · 3 a reclamar · 2 de más"**. El botón de confirmar va deshabilitado mientras `resumen.listo` sea falso, y **muestra `resumen.motivoBloqueo`** en vez de quedarse mudo. En celular la barra va por encima del bottom-nav: ya hubo antes un botón de recepción que quedaba tapado y no se puede repetir.

- [ ] **Step 3: El modal de confirmación**

Redacta la consecuencia en prosa, con los números reales calculados desde `resumen` y los costos de las líneas: cuánto sube el inventario, a cuánto baja la factura y por qué, cuántas unidades quedan para reclamar y a qué proveedor, y cuántas entran de más. Cierra con "Esto no se puede deshacer".

- [ ] **Step 4: Confirmar de verdad**

```js
const { data, error } = await supabase.rpc("fn_procesar_picking_compra", {
  p_compra_id: id,
  p_lineas: construirPayload(lineas),
  p_omitido: false,
});
```

Con éxito: borrar el `localStorage` del conteo, avisar con `avisarOk` y navegar a `/ops/compras/<id>`. Con error: `safeError` para conservar el mensaje P0001 de la RPC, que es el que explica el porqué.

- [ ] **Step 5: Lint, build y toda la suite**

Run: `npx eslint src tests && npm run build && npm test`
Expected: lint limpio en lo tocado, build en verde, suite completa pasando.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ops/PickingCompra
git commit -m "feat(picking): modo lista, resumen bloqueante y modal de consecuencias"
```

---

### Task 11: Enganche en `CompraDetalle` y etiquetas QR

**Files:**

- Create: `src/pages/ops/PickingCompra/PanelEtiquetas.jsx`
- Modify: `src/pages/ops/CompraDetalle.jsx`

- [ ] **Step 1: El panel de etiquetas**

Lista las líneas contadas con un contador de copias por producto, con el default en las **buenas** (no en lo pedido: se etiqueta lo que de verdad entró). Al generar:

```js
import {
  generarEtiquetasPDF,
  MAX_COPIAS_POR_PRODUCTO,
} from "../../../lib/pdf/etiquetasPDF";
import { derivar } from "../../../lib/picking-compras";

const r = await generarEtiquetasPDF({
  productos: lineas
    .filter((l) => l.contada)
    .map((l) => ({
      referencia: l.referencia,
      nombre: l.nombre,
      cantidad: derivar(l).buenas,
    }))
    .filter((p) => p.cantidad > 0),
  formato: "hoja",
});
```

Mostrar `r.omitidos` si los hay: son productos sin referencia, para los que no se puede generar QR.

- [ ] **Step 2: Cambiar el botón en `CompraDetalle`**

Donde hoy está `onConfirmar={() => setModalRecibir(true)}` (línea ~269), y **solo si** la compra tiene al menos una línea de producto y el rol es Admin o Bodeguero, el botón principal pasa a ser **"Contar y recibir"** navegando a `/ops/compras/<id>/picking`, con **"Recibir sin contar"** debajo como enlace secundario.

Ese enlace secundario abre un modal cuya advertencia dice el daño concreto, con los números de esa compra:

> Si recibes sin contar, el inventario va a decir que llegaron 47 unidades aunque hayan llegado 40. Cualquier faltante que aparezca después va a quedar como pérdida de bodega, no como algo que el proveedor debía.

y al aceptar llama `fn_procesar_picking_compra` con `p_omitido: true`.

Para una compra **sin líneas de producto** o para un **Vendedor**, la pantalla queda exactamente como está hoy: sin picking, sin advertencia y sin fricción. No hay nada que contar en un recibo de transporte.

- [ ] **Step 3: Añadir el botón de avisar al Admin**

En la barra de acciones del picking, `<BotonAvisarAdmin origen="compra" origenId={id} />`.

- [ ] **Step 4: Lint, build y suite**

Run: `npx eslint src tests && npm run build && npm test`

- [ ] **Step 5: Commit**

```bash
git add src/pages/ops/PickingCompra src/pages/ops/CompraDetalle.jsx
git commit -m "feat(picking): entrada desde la compra, etiquetas QR y aviso al Admin"
```

---

### Task 12: La puerta desde el registro de la compra

**Files:**

- Modify: `src/pages/ops/CompraNueva.jsx`

Ésta es la tarea que decide si la feature se usa o no se usa nunca. Verificado
contra producción: **de 737 compras, cero están sin recibir**, y 713 de 729 (98%)
se registran y se reciben en el mismo segundo. La mercancía ya está en el
mostrador cuando digitan la factura. Si el picking solo se alcanza desde el
detalle de una compra pendiente, no lo alcanza nadie.

El flujo que pidió el dueño: **llega la mercancía → la registran → pasan al
picking → cuentan → recibido.** Y da igual si cuentan de una o si dejan la
compra pendiente y cuentan después: las dos puertas quedan abiertas.

- [ ] **Step 1: Capturar el `compra_id` que la RPC ya devuelve**

Hoy `CompraNueva` descarta la respuesta (`const { error: rpcErr } = await …`).
`fn_registrar_compra` devuelve `{compra_id, numero, subtotal, iva, total,
recibida}`. Cambiar a:

```js
const { data: creada, error: rpcErr } = await supabase.rpc(
  "fn_registrar_compra",
  {/* … los mismos parámetros que ya se pasan … */},
);
if (rpcErr) throw new Error(rpcErr.message);
```

- [ ] **Step 2: Decidir a dónde va después de guardar**

```js
// El picking solo tiene sentido si hay productos que contar y si quien registra
// puede contarlos. Una compra de caja menor (un recibo de transporte) no se
// cuenta, y meterle fricción sería castigar a la vendedora por hacer bien su
// trabajo.
const puedeContar = ["Admin", "Bodeguero"].includes(perfil?.rol);
const hayQueContar = carrito.length > 0;

if (!recibirAhora && hayQueContar && puedeContar) {
  avisarOk(`Compra #${creada.numero} registrada. Ahora cuenta lo que llegó.`);
  navigate(`/ops/compras/${creada.compra_id}/picking`);
} else {
  avisarOk(
    recibirAhora ? "Compra registrada y recibida." : "Compra registrada.",
  );
  navigate("/ops/compras");
}
```

- [ ] **Step 3: Cambiar el checkbox por la decisión real**

Donde hoy está el checkbox "Marcar como recibida ahora", para Admin/Bodeguero
con carrito no vacío se muestran dos opciones, con el conteo como la principal:

- **"Registrar y contar"** (por defecto, `recibirAhora = false`) → va al picking.
- **"Registrar y recibir sin contar"** (`recibirAhora = true`) → como hoy, pero
  con la advertencia concreta antes de ejecutar:

  > Si recibes sin contar, el inventario va a decir que llegaron N unidades
  > aunque hayan llegado menos. Cualquier faltante que aparezca después va a
  > quedar como pérdida de bodega, no como algo que el proveedor debía.

Para una vendedora, o para una compra sin productos, **la pantalla queda
exactamente como está hoy**: el checkbox de siempre, sin fricción y sin
advertencias.

- [ ] **Step 4: Lint, build y suite**

Run: `npx eslint src tests && npm run build && npm test`

- [ ] **Step 5: Commit**

```bash
git add src/pages/ops/CompraNueva.jsx
git commit -m "feat(picking): del registro de la compra se pasa a contar"
```

---

### Task 13: Verificación final

- [ ] **Step 1: Responsive de verdad**

Revisar a **360px**, **768px** y **1280px**:

- ningún control por debajo de 48px de alto
- la barra de resumen no tapa el bottom-nav en celular
- el modo enfoque es el default en 360px y el de lista en 768px y 1280px
- el número del contador no se desborda con cantidades de 4 cifras

- [ ] **Step 2: Recorrido por rol**

- **Bodeguero de BODEGA, camino principal:** registra una compra con productos,
  cae directo en el picking, cuenta, confirma.
- **Bodeguero de BODEGA, camino diferido:** registra sin recibir, sale de la
  pantalla, y la encuentra después en Compras con el filtro "Registrada" (ese
  filtro y su contador de pendientes ya existen en `CompraHistorial`).
- **Bodeguero de BODEGA:** ve "Contar y recibir" en el detalle, cuenta, confirma.
- **Bodeguero con una compra de CV:** el mensaje nombra las dos sedes.
- **Vendedora:** no ve el picking ni en el registro ni en el detalle; su compra
  de caja menor se registra y recibe como siempre, sin advertencias.
- **Compra sin líneas de producto:** no ofrece picking a nadie.
- **Admin:** puede en cualquier sede, y recibe el modal de escalamiento.

- [ ] **Step 3: Suite completa y advisors**

Run: `npm test && npm run build`
Y `mcp__supabase__get_advisors` tipo `security`, verificando que ninguna de las funciones o tablas nuevas aparezca.

- [ ] **Step 4: Commit final**

```bash
git commit --allow-empty -m "chore(picking): verificacion responsive y por rol"
```

---

## Notas para quien ejecute

- **`fn_tiempo_humano` se crea en su propia migración** y `fn_escalar_a_admin` la
  usa. En plpgsql las llamadas a otras funciones se resuelven en tiempo de
  EJECUCIÓN, no de creación, así que el orden entre las dos no rompe un replay
  del repo desde cero. Aun así, si se toca alguna de las dos, conviene dejar la
  del helper antes.
- **Los timestamps de las migraciones:** `apply_migration` del MCP registra la migración con **su propio timestamp**, no con el del nombre del archivo. Después de aplicar cada una, consultar `supabase_migrations.schema_migrations` y renombrar el archivo local para que coincida. Si no, el repo y la base cuentan historias distintas.
- **Producción es el único ambiente.** Todo lo que escriba se prueba dentro de `BEGIN … ROLLBACK`, y al terminar se verifica con un conteo que no quedó nada. Los productos de prueba son los `INVENTARIO DE PRUEBA (999)`.
- **Hay otras sesiones trabajando en este repo.** Este plan vive en su propio worktree (`C:\Users\davi-\cdv-picking-compras`, rama `feat/picking-compras`); no cambiar de rama ahí ni hacer `git add .` a ciegas, que ya pasó una vez que un commit ajeno se llevó archivos de otra sesión.
- **Nada de colores en duro.** Todo con `hsl(var(--token))`, y `StatusBadge` solo acepta `success | warning | danger | info | neutral`.
