# Panel de decisiones — Plan de implementación

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usar
> `superpowers:subagent-driven-development` o `superpowers:executing-plans` para
> ejecutar tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** convertir el Dashboard en un panel con el que se pueda decidir:
rango de fechas real que manda sobre todo, margen y resultado, desglose de en
qué se pierde, y composición de la venta hasta el documento individual.

**Arquitectura:** ruta nueva `/admin/panel` cargada con `React.lazy`, alimentada
por cinco RPC pequeñas con la misma firma de rango en vez de una función grande.
Cada sección carga y falla sola. Los costos y el margen solo para Admin,
validado en el servidor.

**Stack:** PostgreSQL (Supabase, RPC `SECURITY DEFINER` + RLS), React 19 + Vite,
recharts, react-day-picker, date-fns, vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-panel-decisiones-design.md`

---

## Estado al 2026-09-06

**Las cinco fases están implementadas, en producción y verificadas.** Faltan
solo los dos últimos pasos de E4, que no los puede hacer quien implementa:

- **E4 paso 8** — el recorrido manual de quien decide (los 8 puntos de la lista).
- **E4 paso 9** — merge a `main` y push a los dos repos.

Dos cosas salieron distintas de lo planeado, las dos a propósito:

**`fn_panel_composicion` reparte la venta neta completa, no solo la retención.**
El plan asumía que las líneas sumaban el total; no lo hacen, porque
`ventas.total` lleva además IVA y domicilio, y menos el descuento. Con el
reparto del plan el desglose habría mostrado 405.499.719 contra los 436.524.418
de la cascada, 31 millones de diferencia sin explicación. Repartiendo la venta
neta completa en proporción al subtotal de cada línea, las partes suman el total
exactamente.

**No se usó recharts.** Las dos únicas visualizaciones que pedía el diseño (la
barra de participación y la barra apilada de cartera) son barras proporcionales,
que en CSS son cuatro líneas y respetan los tokens sin pelear con la paleta de
la librería. `recharts` sigue instalado pero no entra en el bundle.

---

## Las fases

|       | Entrega                                      | Por qué en este orden                                                            |
| ----- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| **A** | Lazy + rango de fechas + esqueleto del panel | Nada más se puede construir sin el rango: es lo que gobierna todas las consultas |
| **B** | Categorías de gasto y su clasificación       | Desbloquea el Resultado. Puede avanzar en paralelo con A                         |
| **C** | Resultado y pérdidas                         | El corazón: la cascada y los $6,5M vendidos bajo costo                           |
| **D** | Composición de la venta                      | El desglose por sede, vendedora, producto y cliente                              |
| **E** | Cartera, inventario y exportar               | Cierra el panel                                                                  |

Cada fase deja algo usable. Al terminar A ya hay un panel con rango que
funciona; al terminar C ya sirve para decidir.

## Convenciones que valen para todo el plan

**Fechas.** El frontend manda `desde` y `hasta` como `date` (YYYY-MM-DD) en hora
de Colombia. Toda RPC filtra con
`(fecha at time zone 'America/Bogota')::date between p_desde and p_hasta`, igual
que el cierre. En las pruebas, la fecha de hoy se saca con
`(now() at time zone 'America/Bogota')::date`, **nunca con `current_date`**: de
noche el día UTC ya es otro y la prueba pasa por la razón equivocada.

**Permisos.** Cada RPC nueva termina con:

```sql
REVOKE EXECUTE ON FUNCTION public.<nombre>(<firma>) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.<nombre>(<firma>) TO authenticated, service_role;
```

Hay dos caminos por los que `anon` termina con EXECUTE —el grant por defecto a
`PUBLIC` y las default privileges de Supabase— y hay que cerrar los dos.
Revocar solo uno deja el otro en pie.

**Archivos de migración.** Después de aplicar, verificar el timestamp con
`mcp__supabase__list_migrations` y guardar el archivo en `supabase/migrations/`
con **ese** timestamp y el mismo contenido. Ya pasó que una migración quedara en
la base sin archivo en el repo.

**Colores.** Nunca un hex ni `bg-*` de Tailwind: solo `hsl(var(--token))`. Es la
Regla #1 del sistema de diseño y la Tarea A6 la vuelve una prueba automática.

---

# FASE A — Cimientos: el rango que manda

---

### Tarea A1: Cargar rutas pesadas con `React.lazy`

El build es **un solo archivo de 2.439 KB sin ningún `React.lazy`**. Meter
recharts ahí se lo cobra a la vendedora que solo entra a facturar.

**Archivos:**

- Modificar: `src/App.jsx`

- [ ] **Paso 1: Medir el bundle ANTES**

```bash
npm run build && ls -la dist/assets/*.js | awk '{printf "%.0f KB  %s\n", $5/1024, $NF}' | sort -rn | head -5
```

Anotar el resultado. El 2026-09-06 era `2439 KB` en un solo archivo.

- [ ] **Paso 2: Envolver el árbol de rutas en Suspense**

En `src/App.jsx`, añadir a los imports de React:

```jsx
import { lazy, Suspense } from "react";
```

- [ ] **Paso 3: Convertir el panel (y el resto de admin) a lazy**

Reemplazar los imports estáticos de las páginas de admin por `lazy`. Empezar por
las tres más pesadas, que son las que más pesan y menos se abren:

```jsx
const AdminDashboard = lazy(() => import("./pages/admin/Dashboard"));
const Conteo = lazy(() => import("./pages/admin/Conteo"));
const Cierres = lazy(() => import("./pages/admin/Cierres"));
```

(borrar las líneas `import AdminDashboard from ...`, `import Conteo from ...` e
`import Cierres from ...`).

- [ ] **Paso 4: Poner el fallback**

Envolver el `<Routes>` de admin (la ruta `path="/admin"`, línea ~490) con:

```jsx
<Suspense
  fallback={
    <div
      className="p-6 text-[13px]"
      style={{ color: "hsl(var(--muted-foreground))" }}
    >
      Cargando…
    </div>
  }
>
  {/* el <Route path="/admin" ...> que ya existe */}
</Suspense>
```

- [ ] **Paso 5: Medir el bundle DESPUÉS**

```bash
npm run build && ls -la dist/assets/*.js | awk '{printf "%.0f KB  %s\n", $5/1024, $NF}' | sort -rn | head -8
```

Esperado: el archivo principal **más chico** que los 2.439 KB del paso 1, y
trozos nuevos para las páginas convertidas. Si no bajó, algo quedó importado
estáticamente desde otro sitio: buscarlo con
`grep -rn "pages/admin/Conteo" src/`.

- [ ] **Paso 6: Comprobar que la app sigue abriendo**

```bash
npm test && npm run lint
```

Y abrir la app: entrar a Admin, navegar a Conteo y a Cierres. Tienen que cargar
(con un parpadeo de "Cargando…" la primera vez) y funcionar igual.

- [ ] **Paso 7: Commit**

```bash
git add src/App.jsx
git commit -m "perf(app): cargar las paginas pesadas de admin con lazy"
```

---

### Tarea A2: La lógica de rangos, en una función pura

Toda la aritmética de fechas vive aparte y se prueba sola. Es lo que evita que
el "mes pasado" del panel y el "mes pasado" de la comparación se desincronicen.

**Archivos:**

- Crear: `src/lib/panel-rango.js`
- Probar: `tests/integration/panel-rango.test.js`

- [ ] **Paso 1: Escribir la prueba que falla**

```js
import { describe, it, expect } from "vitest";
import {
  ATAJOS,
  rangoDeAtajo,
  periodoAnterior,
  etiquetaRango,
  hayDatosParaComparar,
  PRIMER_DIA_CON_DATOS,
} from "../../src/lib/panel-rango";

// Fecha fija para que las pruebas no dependan del día en que corran.
const HOY = new Date(2026, 8, 15); // 15 de septiembre de 2026

describe("rangoDeAtajo", () => {
  it("hoy es un solo día", () => {
    const r = rangoDeAtajo("hoy", HOY);
    expect(r.desde).toBe("2026-09-15");
    expect(r.hasta).toBe("2026-09-15");
  });

  it("este mes va del 1 al día de hoy, no a fin de mes", () => {
    // Contar hasta el 30 cuando estamos a 15 haría ver una caída falsa.
    const r = rangoDeAtajo("mes", HOY);
    expect(r.desde).toBe("2026-09-01");
    expect(r.hasta).toBe("2026-09-15");
  });

  it("mes pasado va completo", () => {
    const r = rangoDeAtajo("mes_pasado", HOY);
    expect(r.desde).toBe("2026-08-01");
    expect(r.hasta).toBe("2026-08-31");
  });

  it("este año arranca el 1 de enero", () => {
    const r = rangoDeAtajo("ano", HOY);
    expect(r.desde).toBe("2026-01-01");
    expect(r.hasta).toBe("2026-09-15");
  });

  it("ultimos 30 dias incluye hoy", () => {
    const r = rangoDeAtajo("30d", HOY);
    expect(r.hasta).toBe("2026-09-15");
    expect(r.desde).toBe("2026-08-17"); // 30 días contando hoy
  });
});

describe("periodoAnterior", () => {
  it("toma la misma cantidad de dias, justo antes", () => {
    const p = periodoAnterior({ desde: "2026-09-01", hasta: "2026-09-15" });
    expect(p.hasta).toBe("2026-08-31");
    expect(p.desde).toBe("2026-08-17"); // 15 días
  });

  it("un solo dia se compara contra el dia anterior", () => {
    const p = periodoAnterior({ desde: "2026-09-15", hasta: "2026-09-15" });
    expect(p.desde).toBe("2026-09-14");
    expect(p.hasta).toBe("2026-09-14");
  });
});

describe("hayDatosParaComparar", () => {
  it("dice que no cuando el periodo anterior cae antes del primer dato", () => {
    // La app arrancó el 1 de junio de 2026: comparar contra mayo daría -100%
    // falso, así que la comparación se apaga.
    expect(
      hayDatosParaComparar({ desde: "2026-06-01", hasta: "2026-06-30" }),
    ).toBe(false);
  });

  it("dice que si cuando el periodo anterior tiene datos", () => {
    expect(
      hayDatosParaComparar({ desde: "2026-09-01", hasta: "2026-09-30" }),
    ).toBe(true);
  });

  it("el primer dia con datos es el 1 de junio de 2026", () => {
    expect(PRIMER_DIA_CON_DATOS).toBe("2026-06-01");
  });
});

describe("etiquetaRango", () => {
  it("un solo dia se dice corto", () => {
    expect(etiquetaRango({ desde: "2026-09-15", hasta: "2026-09-15" })).toBe(
      "15 de septiembre de 2026",
    );
  });

  it("dentro del mismo mes no repite el mes", () => {
    expect(etiquetaRango({ desde: "2026-09-01", hasta: "2026-09-30" })).toBe(
      "Del 1 al 30 de septiembre de 2026",
    );
  });

  it("entre meses distintos nombra los dos", () => {
    expect(etiquetaRango({ desde: "2026-08-15", hasta: "2026-09-15" })).toBe(
      "Del 15 de agosto al 15 de septiembre de 2026",
    );
  });
});

describe("ATAJOS", () => {
  it("trae los ocho del diseno, en orden", () => {
    expect(ATAJOS.map((a) => a.id)).toEqual([
      "hoy",
      "ayer",
      "semana",
      "mes",
      "mes_pasado",
      "ano",
      "30d",
      "90d",
    ]);
  });
});
```

- [ ] **Paso 2: Correr y ver fallar**

```bash
npx vitest run tests/integration/panel-rango.test.js
```

Esperado: `Failed to resolve import "../../src/lib/panel-rango"`.

- [ ] **Paso 3: Escribir el módulo**

```js
/**
 * Rangos de fecha del panel.
 *
 * Toda la aritmética vive aquí y se prueba sola: es lo que impide que el "mes
 * pasado" que se consulta y el "mes pasado" contra el que se compara se
 * desincronicen.
 *
 * Convención: los rangos se manejan como texto `YYYY-MM-DD` en hora de Colombia,
 * que es exactamente lo que esperan las RPC. Nunca se manda un `Date` al
 * servidor: la conversión de zona es justo donde se cuelan los errores de un día.
 */
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  differenceInCalendarDays,
  parseISO,
} from "date-fns";
import { es } from "date-fns/locale";

/**
 * Primer día con datos en producción. Antes de esto no hay nada que comparar,
 * y pintar un −100% contra la nada sería mentir.
 */
export const PRIMER_DIA_CON_DATOS = "2026-06-01";

const iso = (d) => format(d, "yyyy-MM-dd");

export const ATAJOS = [
  { id: "hoy", label: "Hoy" },
  { id: "ayer", label: "Ayer" },
  { id: "semana", label: "Esta semana" },
  { id: "mes", label: "Este mes" },
  { id: "mes_pasado", label: "Mes pasado" },
  { id: "ano", label: "Este año" },
  { id: "30d", label: "Últimos 30" },
  { id: "90d", label: "Últimos 90" },
];

/**
 * @param {string} id  uno de ATAJOS
 * @param {Date} [hoy] inyectable para poder probar sin depender del día real
 * @returns {{desde:string, hasta:string}}
 */
export function rangoDeAtajo(id, hoy = new Date()) {
  switch (id) {
    case "ayer": {
      const a = subDays(hoy, 1);
      return { desde: iso(a), hasta: iso(a) };
    }
    case "semana":
      // La semana arranca el lunes, como se cuenta aquí.
      return {
        desde: iso(startOfWeek(hoy, { weekStartsOn: 1 })),
        hasta: iso(hoy),
      };
    case "mes":
      // Hasta HOY, no hasta fin de mes: contar días que no han pasado haría
      // ver una caída que no existe.
      return { desde: iso(startOfMonth(hoy)), hasta: iso(hoy) };
    case "mes_pasado": {
      const m = subMonths(hoy, 1);
      return { desde: iso(startOfMonth(m)), hasta: iso(endOfMonth(m)) };
    }
    case "ano":
      return { desde: iso(startOfYear(hoy)), hasta: iso(hoy) };
    case "30d":
      return { desde: iso(subDays(hoy, 29)), hasta: iso(hoy) };
    case "90d":
      return { desde: iso(subDays(hoy, 89)), hasta: iso(hoy) };
    case "hoy":
    default:
      return { desde: iso(hoy), hasta: iso(hoy) };
  }
}

/**
 * El periodo anterior equivalente: la misma cantidad de días, inmediatamente
 * antes. No es "el mes pasado": si se piden 12 días, compara contra los 12
 * anteriores, que es lo que hace comparable la cifra.
 */
export function periodoAnterior({ desde, hasta }) {
  const d = parseISO(desde);
  const h = parseISO(hasta);
  const dias = differenceInCalendarDays(h, d) + 1;
  const nuevoHasta = subDays(d, 1);
  return { desde: iso(subDays(nuevoHasta, dias - 1)), hasta: iso(nuevoHasta) };
}

/** ¿El periodo anterior cae dentro de los datos que existen? */
export function hayDatosParaComparar(rango) {
  return periodoAnterior(rango).desde >= PRIMER_DIA_CON_DATOS;
}

/**
 * El rango dicho en español, que es lo que va debajo de los chips. Es la frase
 * que evita tener que adivinar qué periodo está aplicado.
 */
export function etiquetaRango({ desde, hasta }) {
  const d = parseISO(desde);
  const h = parseISO(hasta);
  const opt = { locale: es };

  if (desde === hasta) return format(d, "d 'de' MMMM 'de' yyyy", opt);

  const mismoAno = format(d, "yyyy") === format(h, "yyyy");
  const mismoMes = mismoAno && format(d, "MM") === format(h, "MM");

  if (mismoMes) {
    return `Del ${format(d, "d", opt)} al ${format(h, "d 'de' MMMM 'de' yyyy", opt)}`;
  }
  if (mismoAno) {
    return `Del ${format(d, "d 'de' MMMM", opt)} al ${format(h, "d 'de' MMMM 'de' yyyy", opt)}`;
  }
  return `Del ${format(d, "d 'de' MMMM 'de' yyyy", opt)} al ${format(h, "d 'de' MMMM 'de' yyyy", opt)}`;
}
```

- [ ] **Paso 4: Correr y ver pasar**

```bash
npx vitest run tests/integration/panel-rango.test.js
```

Esperado: `Tests 13 passed`.

- [ ] **Paso 5: Commit**

```bash
git add src/lib/panel-rango.js tests/integration/panel-rango.test.js
git commit -m "feat(panel): la aritmetica de rangos, probada aparte"
```

---

### Tarea A3: La barra de rango

**Archivos:**

- Crear: `src/components/panel/BarraRango.jsx`
- Probar: `tests/integration/panel-render.test.js`

- [ ] **Paso 1: Escribir la prueba de humo que falla**

```js
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import BarraRango from "../../src/components/panel/BarraRango";

/**
 * Ni el build ni eslint ejecutan un componente: un error de render pasa las dos
 * y llega a producción con la pantalla inservible. Ya ocurrió dos veces aquí.
 */
const montar = (props) =>
  renderToStaticMarkup(
    createElement(BarraRango, {
      rango: { desde: "2026-09-01", hasta: "2026-09-15" },
      atajo: "mes",
      onCambio() {},
      sede: "",
      sedes: [{ id: "CV", nombre: "Cali Valle" }],
      onSede() {},
      actualizado: new Date("2026-09-15T10:00:00Z"),
      cargando: false,
      onRefrescar() {},
      ...props,
    }),
  );

describe("BarraRango", () => {
  it("monta sin reventar", () => {
    expect(() => montar()).not.toThrow();
  });

  it("dice el rango en espanol, no solo las fechas", () => {
    const html = montar();
    expect(html).toContain("Del 1 al 15 de septiembre de 2026");
  });

  it("dice contra que se compara", () => {
    expect(montar()).toContain("comparando contra");
  });

  it("avisa cuando no hay con que comparar, en vez de callarse", () => {
    // Junio es el primer mes con datos: no hay mayo contra el cual comparar.
    const html = montar({
      rango: { desde: "2026-06-01", hasta: "2026-06-30" },
      atajo: "mes_pasado",
    });
    expect(html).toContain("sin datos para comparar");
    expect(html).not.toContain("comparando contra");
  });

  it("trae los ocho atajos", () => {
    const html = montar();
    for (const t of [
      "Hoy",
      "Ayer",
      "Esta semana",
      "Este mes",
      "Mes pasado",
      "Este año",
      "Últimos 30",
      "Últimos 90",
    ]) {
      expect(html).toContain(t);
    }
  });

  it("muestra hace cuanto se actualizo", () => {
    expect(montar()).toContain("Actualizado");
  });

  it("mientras carga lo dice y no deja pulsar de nuevo", () => {
    const html = montar({ cargando: true });
    expect(html).toContain("disabled");
  });
});
```

- [ ] **Paso 2: Correr y ver fallar**

```bash
npx vitest run tests/integration/panel-render.test.js
```

Esperado: `Failed to resolve import ".../BarraRango"`.

- [ ] **Paso 3: Escribir el componente**

```jsx
import { useState } from "react";
import { RefreshCw, CalendarDays } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { es } from "date-fns/locale";
import { format, parseISO } from "date-fns";
import {
  ATAJOS,
  rangoDeAtajo,
  periodoAnterior,
  etiquetaRango,
  hayDatosParaComparar,
} from "../../lib/panel-rango";

/**
 * La barra que gobierna el panel entero.
 *
 * Lo más importante de la pantalla: si el rango no se entiende, ningún número
 * de abajo se entiende. Por eso debajo de los chips va SIEMPRE la frase en
 * español con lo que está aplicado y contra qué se compara — es lo que quita el
 * tener que adivinar.
 *
 * Se pega arriba al bajar, porque al llegar a la cartera uno ya no recuerda qué
 * periodo puso.
 */
export default function BarraRango({
  rango,
  atajo,
  onCambio,
  sede,
  sedes = [],
  onSede,
  actualizado,
  cargando,
  onRefrescar,
}) {
  const [abrirCal, setAbrirCal] = useState(false);

  const comparable = hayDatosParaComparar(rango);
  const anterior = periodoAnterior(rango);

  const chip = (activo) => ({
    minHeight: 48,
    borderColor: activo ? "hsl(var(--primary))" : "hsl(var(--border))",
    backgroundColor: activo ? "hsl(var(--primary) / 0.1)" : "hsl(var(--card))",
    color: activo ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
  });

  return (
    <div
      className="sticky top-0 z-20 border-b px-4 py-3 sm:px-6"
      style={{
        backgroundColor: "hsl(var(--background))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* En móvil los chips ruedan; no se apilan en tres filas. */}
        <div className="-mx-1 flex flex-1 gap-1.5 overflow-x-auto px-1 pb-1">
          {ATAJOS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onCambio(rangoDeAtajo(a.id), a.id)}
              className="shrink-0 rounded-lg border px-3 text-[12.5px] font-medium"
              style={chip(atajo === a.id)}
            >
              {a.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAbrirCal((v) => !v)}
            className="shrink-0 rounded-lg border px-3 text-[12.5px] font-medium"
            style={chip(atajo === "personalizado")}
            aria-expanded={abrirCal}
          >
            <CalendarDays className="mr-1 inline h-3.5 w-3.5" />
            Personalizado
          </button>
        </div>

        {sedes.length > 0 && (
          <select
            value={sede}
            onChange={(e) => onSede(e.target.value)}
            className="rounded-lg border px-2 text-[12.5px]"
            style={{
              minHeight: 48,
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
            aria-label="Sede"
          >
            <option value="">Todas las sedes</option>
            {sedes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          onClick={onRefrescar}
          disabled={cargando}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium disabled:opacity-50"
          style={{
            minHeight: 48,
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--card))",
            color: "hsl(var(--muted-foreground))",
          }}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${cargando ? "animate-spin" : ""}`}
            strokeWidth={1.5}
          />
          {cargando ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {/* La frase que quita el adivinar. */}
      <p
        className="mt-2 text-[12px]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        <span style={{ color: "hsl(var(--foreground))" }}>
          {etiquetaRango(rango)}
        </span>
        {comparable ? (
          <> · comparando contra {etiquetaRango(anterior)}</>
        ) : (
          <> · sin datos para comparar: la app arrancó en junio de 2026</>
        )}
        {actualizado && <> · Actualizado {haceCuanto(actualizado)}</>}
      </p>

      {abrirCal && (
        <div
          className="mt-3 rounded-xl border p-3"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          <DayPicker
            mode="range"
            locale={es}
            numberOfMonths={1}
            defaultMonth={parseISO(rango.desde)}
            selected={{
              from: parseISO(rango.desde),
              to: parseISO(rango.hasta),
            }}
            onSelect={(r) => {
              if (!r?.from) return;
              const desde = format(r.from, "yyyy-MM-dd");
              const hasta = format(r.to ?? r.from, "yyyy-MM-dd");
              onCambio({ desde, hasta }, "personalizado");
              if (r.to) setAbrirCal(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** "hace 2 min" — el cambio visible es lo que confirma que el botón sirvió. */
function haceCuanto(fecha) {
  const seg = Math.max(0, Math.round((Date.now() - fecha.getTime()) / 1000));
  if (seg < 45) return "hace unos segundos";
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return `hace ${h} h`;
}
```

- [ ] **Paso 4: Correr y ver pasar**

```bash
npx vitest run tests/integration/panel-render.test.js
```

Esperado: `Tests 7 passed`.

Si falla el caso de "sin datos para comparar", revisar `PRIMER_DIA_CON_DATOS`:
la prueba asume que el primer dato es del 1 de junio de 2026.

- [ ] **Paso 5: Los estilos de react-day-picker**

`react-day-picker` trae su propio CSS. Añadirlo **al componente**, no al global,
para que no viaje en el bundle principal:

```jsx
import "react-day-picker/style.css";
```

(justo debajo del import de `DayPicker`).

Y comprobar que respeta el modo oscuro: si el calendario sale con fondo blanco
en oscuro, añadir en `src/index.css`:

```css
/* El calendario del panel usa los tokens, no su paleta propia. */
.rdp-root {
  --rdp-accent-color: hsl(var(--primary));
  --rdp-background-color: hsl(var(--card));
  --rdp-today-color: hsl(var(--primary));
  color: hsl(var(--foreground));
}
```

- [ ] **Paso 6: Commit**

```bash
git add src/components/panel/BarraRango.jsx tests/integration/panel-render.test.js src/index.css
git commit -m "feat(panel): barra de rango que dice en espanol que esta aplicado"
```

---

### Tarea A4: El esqueleto del panel

**Archivos:**

- Crear: `src/pages/admin/Panel.jsx`
- Crear: `src/components/panel/Seccion.jsx`
- Modificar: `src/App.jsx`
- Modificar: `src/lib/admin-shell-ui.js`

- [ ] **Paso 1: El envoltorio de sección, con sus cuatro estados**

Crear `src/components/panel/Seccion.jsx`. Es lo que hace que una sección caída
no tumbe las demás:

```jsx
/**
 * Envoltorio de cada bloque del panel.
 *
 * Los cuatro estados se diseñan; ninguno es un descuido. Es donde un panel se
 * siente terminado o a medio hacer:
 *   - cargando: esqueleto con la FORMA del contenido, no un spinner. El salto
 *     de layout es lo que hace sentir lenta una pantalla que no lo es.
 *   - vacío: dice qué pasó y qué hacer. Nunca una tarjeta en blanco.
 *   - error: dentro de la sección, con reintento propio. El resto sigue en pie.
 *   - sin permiso: explica. Un error de permisos parece una falla; esto no.
 */
export default function Seccion({
  titulo,
  subtitulo,
  acciones,
  cargando,
  error,
  onReintentar,
  sinPermiso,
  vacio,
  mensajeVacio,
  filasEsqueleto = 4,
  children,
}) {
  return (
    <section
      className="overflow-hidden rounded-xl border"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <header
        className="flex items-center justify-between gap-3 border-b px-4 py-3"
        style={{
          borderColor: "hsl(var(--border))",
          backgroundColor: "hsl(var(--muted) / 0.3)",
        }}
      >
        <div className="min-w-0">
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {titulo}
          </p>
          {subtitulo && (
            <p
              className="mt-0.5 truncate text-[12px]"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {subtitulo}
            </p>
          )}
        </div>
        {acciones}
      </header>

      <div className="p-4">
        {sinPermiso ? (
          <p
            className="text-[13px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            El margen y los costos son información de administración.
          </p>
        ) : error ? (
          <div className="space-y-2">
            <p
              className="text-[13px]"
              style={{ color: "hsl(var(--destructive))" }}
            >
              {error}
            </p>
            {onReintentar && (
              <button
                type="button"
                onClick={onReintentar}
                className="rounded-lg border px-3 text-[12.5px] font-medium"
                style={{
                  minHeight: 48,
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                }}
              >
                Reintentar esta sección
              </button>
            )}
          </div>
        ) : cargando ? (
          <div className="space-y-2" aria-busy="true" aria-label="Cargando">
            {Array.from({ length: filasEsqueleto }).map((_, i) => (
              <div
                key={i}
                className="h-6 animate-pulse rounded"
                style={{ backgroundColor: "hsl(var(--muted))" }}
              />
            ))}
          </div>
        ) : vacio ? (
          <p
            className="text-[13px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {mensajeVacio ?? "No hay datos en este rango."}
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
```

- [ ] **Paso 2: La página**

Crear `src/pages/admin/Panel.jsx`:

```jsx
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../stores/authStore";
import BarraRango from "../../components/panel/BarraRango";
import Seccion from "../../components/panel/Seccion";
import { rangoDeAtajo } from "../../lib/panel-rango";

const CLAVE_RANGO = "cdv.panel.rango";

/**
 * Panel de decisiones.
 *
 * A diferencia del Dashboard —que responde "qué necesita atención hoy"— este
 * responde "cómo va el negocio". El rango manda sobre todas las secciones.
 *
 * Cada sección pide sus datos por su cuenta: si una RPC falla, las demás
 * siguen mostrando. El panel viejo hacía lo contrario y una falla se llevaba
 * por delante todas las secciones avanzadas a la vez.
 */
export default function Panel() {
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";

  // El rango elegido sobrevive entre visitas: volver y tener que reponerlo
  // cada vez es de las cosas que más cansan de un panel.
  const [{ rango, atajo }, setSeleccion] = useState(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem(CLAVE_RANGO) ?? "null");
      if (guardado?.rango?.desde && guardado?.rango?.hasta) return guardado;
    } catch {
      /* si no se puede leer, se arranca en "este mes" */
    }
    return { rango: rangoDeAtajo("mes"), atajo: "mes" };
  });

  const [sede, setSede] = useState("");
  const [sedes, setSedes] = useState([]);
  const [actualizado, setActualizado] = useState(null);
  const [cargando, setCargando] = useState(false);
  // Sube en cada "Actualizar". Las secciones de las fases siguientes lo llevan
  // en sus dependencias para recargarse; en la fase A todavía no hay ninguna
  // que lo escuche, y eso está bien: el contrato queda fijo desde ahora.
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    supabase
      .from("sedes")
      .select("id, nombre")
      .eq("activa", true)
      .order("nombre")
      .then(({ data }) => setSedes(data ?? []));
  }, []);

  const cambiarRango = useCallback((nuevo, id) => {
    const sel = { rango: nuevo, atajo: id };
    setSeleccion(sel);
    try {
      localStorage.setItem(CLAVE_RANGO, JSON.stringify(sel));
    } catch {
      /* modo privado: se pierde el recuerdo, no pasa nada */
    }
  }, []);

  // NO hay auto-refresco cada 60 s: en un panel con rango histórico no tiene
  // sentido, y era justo lo que hacía parecer inútil el botón del panel viejo
  // (los números no cambiaban porque ya se acababan de refrescar solos).
  //
  // En la fase A no hay secciones que carguen, así que el spinner es simbólico.
  // En la fase C se reemplaza por una cuenta de secciones pendientes.
  const refrescar = useCallback(() => {
    setCargando(true);
    setRecarga((r) => r + 1);
    setActualizado(new Date());
    setCargando(false);
  }, []);

  return (
    <div
      className="animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <BarraRango
        rango={rango}
        atajo={atajo}
        onCambio={cambiarRango}
        sede={sede}
        sedes={sedes}
        onSede={setSede}
        actualizado={actualizado}
        cargando={cargando}
        onRefrescar={refrescar}
      />

      <div className="space-y-4 p-4 sm:p-6">
        <Seccion
          titulo="Resultado del periodo"
          sinPermiso={!esAdmin}
          vacio={esAdmin}
          mensajeVacio="Se construye en la fase C."
        />
        <Seccion
          titulo="En qué se pierde"
          sinPermiso={!esAdmin}
          vacio={esAdmin}
          mensajeVacio="Se construye en la fase C."
        />
        <Seccion
          titulo="Cómo se compone la venta"
          vacio
          mensajeVacio="Se construye en la fase D."
        />
      </div>

      {/* `recarga` lo consumen las secciones desde la fase C: va en su lista de
          dependencias para que "Actualizar" las vuelva a pedir. */}
      <span hidden data-recarga={recarga} />
    </div>
  );
}
```

- [ ] **Paso 3: Enrutarla, con lazy**

En `src/App.jsx`, junto a los demás lazy de admin:

```jsx
const Panel = lazy(() => import("./pages/admin/Panel"));
```

Y dentro de las rutas de `/admin`, después de `<Route index .../>`:

```jsx
<Route path="panel" element={<Panel />} />
```

- [ ] **Paso 4: Ponerla en el menú**

En `src/lib/admin-shell-ui.js`, dentro del grupo `vision`, después de
`dashboard`:

```js
      {
        id: "panel",
        label: "Panel",
        href: "/admin/panel",
        icon: LineChart,
      },
```

Y añadir `LineChart` al import de `lucide-react` de ese archivo.

- [ ] **Paso 5: Prueba de humo de la página**

Añadir a `tests/integration/panel-render.test.js`, arriba con los demás imports:

```js
import { vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../src/lib/supabase", () => {
  const q = {
    select: () => q,
    eq: () => q,
    order: () => q,
    then: (r) => Promise.resolve({ data: [], error: null }).then(r),
  };
  return {
    supabase: {
      from: () => q,
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  };
});

let perfilActual = { rol: "Admin", sede_id: "BODEGA", nombre: "Admin Maritza" };
vi.mock("../../src/stores/authStore", () => ({
  get useAuthStore() {
    const usar = (sel) =>
      typeof sel === "function"
        ? sel({ perfil: perfilActual })
        : { perfil: perfilActual };
    usar.getState = () => ({ perfil: perfilActual });
    usar.setState = () => {};
    usar.subscribe = () => () => {};
    return usar;
  },
}));
```

Y al final del archivo:

```js
describe("Panel", () => {
  const montar = async () => {
    const Panel = (await import("../../src/pages/admin/Panel")).default;
    return renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(Panel)),
    );
  };

  it("monta como Admin", async () => {
    perfilActual = { rol: "Admin", sede_id: "BODEGA", nombre: "Admin Maritza" };
    await expect(montar()).resolves.toBeTruthy();
  });

  it("a una vendedora le explica por que no ve el margen, no le da error", async () => {
    perfilActual = { rol: "Vendedor", sede_id: "CV", nombre: "Deyanira" };
    const html = await montar();
    expect(html).toContain("información de administración");
    expect(html).not.toContain("Reintentar");
  });
});
```

- [ ] **Paso 6: Verificar todo**

```bash
npx vitest run tests/integration/panel-render.test.js && npm test && npm run lint && npm run build
```

Esperado: todo en verde. Y abrir `/admin/panel` en la app: la barra tiene que
responder a los atajos, la frase de abajo cambiar con cada uno, y el calendario
personalizado abrir.

- [ ] **Paso 7: Commit**

```bash
git add src/pages/admin/Panel.jsx src/components/panel/ src/App.jsx src/lib/admin-shell-ui.js tests/integration/panel-render.test.js
git commit -m "feat(panel): esqueleto del panel con el rango gobernando"
```

---

# FASE B — Categorías de gasto

Sin esto el Resultado se puede mostrar, pero con un margen de error enorme: hoy
los 465 egresos están todos sin clasificar. Esta fase es la que va bajando ese
margen hasta cero.

Puede avanzar en paralelo con la fase A: no comparten archivos.

---

### Tarea B1: El catálogo y la columna

**Archivos:**

- Crear: `supabase/migrations/<TS>_panel_categorias_gasto.sql`

- [ ] **Paso 1: Medir el punto de partida**

```sql
SELECT count(*) AS egresos, coalesce(sum(total),0) AS monto
FROM compras
WHERE estado <> 'cancelada' AND es_caja_menor = true;
```

Guardar el resultado: es contra lo que se va a medir el avance de la
clasificación.

- [ ] **Paso 2: Escribir la prueba que falla**

```sql
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.tables
   WHERE table_schema='public' AND table_name='categorias_gasto';
  IF v_n <> 1 THEN RAISE EXCEPTION 'no existe categorias_gasto'; END IF;

  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='compras' AND column_name='categoria_gasto_id';
  IF v_n <> 1 THEN RAISE EXCEPTION 'compras no tiene categoria_gasto_id'; END IF;

  -- Las dos que NO restan del resultado tienen que existir desde el arranque:
  -- son las que evitan contar dos veces los abonos a proveedores.
  SELECT count(*) INTO v_n FROM categorias_gasto
   WHERE afecta_resultado = false AND activa = true;
  IF v_n < 2 THEN RAISE EXCEPTION 'faltan las categorias que no afectan el resultado'; END IF;

  RAISE EXCEPTION 'OK - el catalogo existe (se revierte a proposito)';
END $$;
```

Esperado: `ERROR: no existe categorias_gasto`.

- [ ] **Paso 3: Aplicar la migración**

Nombre `panel_categorias_gasto`:

```sql
-- Categorias de gasto: lo que hace posible calcular un Resultado.
--
-- Hoy `es_caja_menor` es el cajon donde cae toda la plata que sale y no es
-- mercancia: 465 movimientos y 111M en 90 dias, ninguno con items. Ahi estan
-- mezcladas tres cosas distintas y con el concepto en texto libre y revuelto
-- ('NOMIN', 'NOMINAS', 'NOM E' son todos nomina escritos diferente):
--
--   1. gastos de verdad (nomina, arriendo) -> restan del resultado
--   2. abonos a proveedores -> NO son gasto: pagan mercancia que ya esta
--      contada dentro del costo de lo vendido. Restarlos seria contar dos veces.
--   3. traslados entre cuentas ('BANCOS') -> no son ni gasto ni ingreso
--
-- `afecta_resultado` es lo que separa el 1 del 2 y el 3. Sin esa distincion
-- cualquier Resultado que se calcule esta mal por construccion.
CREATE TABLE public.categorias_gasto (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre            text NOT NULL UNIQUE,
  afecta_resultado  boolean NOT NULL DEFAULT true,
  descripcion       text,
  activa            boolean NOT NULL DEFAULT true,
  orden             int NOT NULL DEFAULT 100,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.categorias_gasto.afecta_resultado IS
  'false = la salida de plata no es un gasto del periodo (abono a proveedor, traslado entre cuentas). Restarla del resultado seria contarla dos veces.';

INSERT INTO public.categorias_gasto (nombre, afecta_resultado, descripcion, orden) VALUES
  ('Nómina',              true,  'Sueldos, prestaciones y pagos al personal', 10),
  ('Arriendo',            true,  'Arriendo de locales y bodega', 20),
  ('Servicios públicos',  true,  'Energía, agua, internet, teléfono', 30),
  ('Transporte',          true,  'Fletes, mensajería, combustible', 40),
  ('Mantenimiento',       true,  'Reparaciones y mantenimiento de la operación', 50),
  ('Impuestos y bancos',  true,  'Impuestos, comisiones y gastos bancarios', 60),
  ('Otros gastos',        true,  'Gasto real que no cabe en las demás', 90),
  ('Abono a proveedor',   false, 'Paga mercancía ya contada en el costo de lo vendido: NO es gasto del periodo', 100),
  ('Traslado entre cuentas', false, 'Mover plata de un lado a otro: no es ni gasto ni ingreso', 110);

ALTER TABLE public.compras
  ADD COLUMN categoria_gasto_id bigint REFERENCES public.categorias_gasto(id);

-- Solo los egresos puros se clasifican. Una compra de mercancia no lleva
-- categoria de gasto: su plata ya vive en el costo de lo vendido.
CREATE INDEX idx_compras_categoria_gasto
  ON public.compras (categoria_gasto_id)
  WHERE es_caja_menor = true;

-- Para la pantalla de clasificacion, que lista lo pendiente por fecha.
CREATE INDEX idx_compras_egresos_sin_clasificar
  ON public.compras (fecha DESC)
  WHERE es_caja_menor = true AND categoria_gasto_id IS NULL;

ALTER TABLE public.categorias_gasto ENABLE ROW LEVEL SECURITY;

-- Cualquiera autenticado lee (la pantalla de compras muestra la categoria);
-- solo Admin toca el catalogo.
CREATE POLICY categorias_gasto_select ON public.categorias_gasto
  FOR SELECT TO authenticated USING (true);
CREATE POLICY categorias_gasto_admin ON public.categorias_gasto
  FOR ALL TO authenticated
  USING ((SELECT get_my_rol()) = 'Admin')
  WITH CHECK ((SELECT get_my_rol()) = 'Admin');
```

- [ ] **Paso 4: Correr la prueba del paso 2**

Esperado: `ERROR: OK - el catalogo existe (se revierte a proposito)`.

- [ ] **Paso 5: Comprobar que no se movió nada**

```sql
SELECT count(*) AS egresos, coalesce(sum(total),0) AS monto,
       count(*) FILTER (WHERE categoria_gasto_id IS NULL) AS sin_clasificar
FROM compras WHERE estado <> 'cancelada' AND es_caja_menor = true;
```

Esperado: `egresos` y `monto` idénticos al paso 1, y `sin_clasificar` igual a
`egresos` (todavía no se ha clasificado nada).

- [ ] **Paso 6: Advisors**

Correr `mcp__supabase__get_advisors` con `type: "security"` y comparar el conteo
total contra el de antes. La tabla nueva tiene RLS, así que no debería aparecer
en `rls_disabled_in_public`. Si aparece, falta el `ENABLE ROW LEVEL SECURITY`.

- [ ] **Paso 7: Guardar el archivo y commitear**

```bash
git add supabase/migrations/
git commit -m "feat(panel): catalogo de categorias de gasto"
```

---

### Tarea B2: Clasificar por lotes

Son 465 movimientos: uno por uno no lo hace nadie. La pantalla agrupa por
concepto parecido para poder marcar veinte "NOMINA" de un golpe.

**Archivos:**

- Crear: `supabase/migrations/<TS>_panel_clasificar_egresos.sql`

- [ ] **Paso 1: Escribir la prueba que falla**

```sql
DO $$
DECLARE v_uid uuid; v_ids uuid[]; v_cat bigint; v_n int;
BEGIN
  SELECT id INTO v_uid FROM usuarios WHERE rol = 'Admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  SELECT id INTO v_cat FROM categorias_gasto WHERE nombre = 'Nómina';
  SELECT array_agg(id) INTO v_ids FROM (
    SELECT id FROM compras
     WHERE es_caja_menor = true AND estado <> 'cancelada' LIMIT 3) t;

  v_n := public.fn_clasificar_egresos(v_ids, v_cat);
  IF v_n <> 3 THEN RAISE EXCEPTION 'clasifico % (esperado 3)', v_n; END IF;

  SELECT count(*) INTO v_n FROM compras
   WHERE id = ANY(v_ids) AND categoria_gasto_id = v_cat;
  IF v_n <> 3 THEN RAISE EXCEPTION 'quedaron % con categoria (esperado 3)', v_n; END IF;

  RAISE EXCEPTION 'OK - clasifica por lotes (se revierte a proposito)';
END $$;
```

Esperado: `ERROR: function public.fn_clasificar_egresos(...) does not exist`.

- [ ] **Paso 2: Aplicar la migración**

Nombre `panel_clasificar_egresos`:

```sql
-- Clasificar egresos por lotes. Son 465 movimientos: uno por uno no lo hace
-- nadie, y un panel cuyo Resultado depende de una tarea que nadie va a hacer no
-- sirve.
--
-- Solo Admin: la categoria decide si la plata resta del resultado, asi que es
-- una decision de administracion.
--
-- No se adivina nada automaticamente. Un 'PIDIO PLATA' solo lo puede clasificar
-- quien sabe que fue; agrupar por texto parecido es ayuda para la pantalla, no
-- una regla que asigne sola.
CREATE OR REPLACE FUNCTION public.fn_clasificar_egresos(
  p_ids uuid[],
  p_categoria_id bigint
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_n int;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  if (select get_my_rol()) <> 'Admin' then
    raise exception 'Solo administración clasifica los egresos: la categoría decide si la plata resta del resultado';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'No se recibió ningún egreso para clasificar';
  end if;
  -- p_categoria_id NULL es valido: sirve para DESclasificar y devolver un
  -- movimiento a la bandeja de pendientes cuando se marco mal.
  if p_categoria_id is not null
     and not exists (select 1 from categorias_gasto where id = p_categoria_id and activa = true) then
    raise exception 'La categoría no existe o está inactiva';
  end if;

  update compras
     set categoria_gasto_id = p_categoria_id
   where id = any(p_ids)
     and es_caja_menor = true      -- una compra de mercancia no se clasifica:
     and estado <> 'cancelada';    -- su plata ya vive en el costo de lo vendido
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_clasificar_egresos(uuid[], bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_clasificar_egresos(uuid[], bigint) TO authenticated, service_role;
```

- [ ] **Paso 3: Correr la prueba del paso 1**

Esperado: `ERROR: OK - clasifica por lotes (se revierte a proposito)`.

- [ ] **Paso 4: Comprobar que a un no-Admin lo rechaza**

```sql
DO $$
DECLARE v_uid uuid; v_cat bigint;
BEGIN
  SELECT id INTO v_uid FROM usuarios WHERE rol = 'Vendedor' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  SELECT id INTO v_cat FROM categorias_gasto WHERE nombre = 'Nómina';
  BEGIN
    PERFORM public.fn_clasificar_egresos(
      (SELECT array_agg(id) FROM (SELECT id FROM compras WHERE es_caja_menor LIMIT 1) t),
      v_cat);
    RAISE EXCEPTION 'MAL: una vendedora pudo clasificar egresos';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'MAL:%' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'OK - solo Admin clasifica (se revierte a proposito)';
END $$;
```

Esperado: `ERROR: OK - solo Admin clasifica (se revierte a proposito)`.

- [ ] **Paso 5: Comprobar la firma y los permisos**

```sql
SELECT count(*) AS n_firmas,
       bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) AS algun_anon,
       bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS todas_auth
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'fn_clasificar_egresos';
```

Esperado: `n_firmas = 1`, `algun_anon = false`, `todas_auth = true`.

- [ ] **Paso 6: Guardar el archivo y commitear**

```bash
git add supabase/migrations/
git commit -m "feat(panel): clasificar egresos por lotes, solo Admin"
```

---

### Tarea B3: La pantalla de clasificación

**Archivos:**

- Crear: `src/pages/admin/ClasificarEgresos.jsx`
- Modificar: `src/App.jsx`, `src/lib/admin-shell-ui.js`
- Probar: `tests/integration/panel-render.test.js`

- [ ] **Paso 1: Añadir la prueba de humo**

Al final de `tests/integration/panel-render.test.js`:

```js
describe("ClasificarEgresos", () => {
  it("monta como Admin", async () => {
    perfilActual = { rol: "Admin", sede_id: "BODEGA", nombre: "Admin Maritza" };
    const P = (await import("../../src/pages/admin/ClasificarEgresos")).default;
    expect(() =>
      renderToStaticMarkup(createElement(MemoryRouter, null, createElement(P))),
    ).not.toThrow();
  });
});
```

- [ ] **Paso 2: Correr y ver fallar**

```bash
npx vitest run tests/integration/panel-render.test.js
```

Esperado: `Failed to resolve import ".../ClasificarEgresos"`.

- [ ] **Paso 3: Escribir la pantalla**

```jsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import { avisarOk, avisarError } from "../../lib/notify";

/**
 * Bandeja de egresos sin clasificar.
 *
 * Son 465 movimientos con el concepto en texto libre y revuelto: 'NOMIN',
 * 'NOMINAS', 'NOM E' son todos nómina. Uno por uno no lo hace nadie, así que la
 * pantalla agrupa por concepto normalizado para poder marcar veinte de un golpe.
 *
 * El agrupado es solo ayuda visual: NO asigna categoría solo. Un 'PIDIO PLATA'
 * únicamente lo puede clasificar quien sabe qué fue.
 */
export default function ClasificarEgresos() {
  const [cats, setCats] = useState([]);
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [marcadas, setMarcadas] = useState(() => new Set());
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorMsg("");
    try {
      const [c, e] = await Promise.all([
        supabase
          .from("categorias_gasto")
          .select("id, nombre, afecta_resultado")
          .eq("activa", true)
          .order("orden"),
        supabase
          .from("compras")
          .select("id, numero, fecha, concepto, total, proveedor")
          .eq("es_caja_menor", true)
          .neq("estado", "cancelada")
          .is("categoria_gasto_id", null)
          .order("fecha", { ascending: false })
          .limit(500),
      ]);
      if (c.error) throw c.error;
      if (e.error) throw e.error;
      setCats(c.data ?? []);
      setFilas(e.data ?? []);
      setMarcadas(new Set());
    } catch (err) {
      setErrorMsg(safeError(err, "No se pudieron cargar los egresos"));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Agrupa por concepto normalizado: quita tildes, mayúsculas y números para
  // que "NOMINA M" y "NOM M ABONO MOTO" caigan cerca. Es una ayuda para
  // seleccionar en bloque, no una clasificación automática.
  const grupos = useMemo(() => {
    const norm = (s) =>
      String(s ?? "sin concepto")
        .toUpperCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^A-Z ]/g, "")
        .trim()
        .split(" ")[0] || "SIN CONCEPTO";
    const m = new Map();
    for (const f of filas) {
      const k = norm(f.concepto);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(f);
    }
    return [...m.entries()]
      .map(([k, items]) => ({
        clave: k,
        items,
        monto: items.reduce((s, i) => s + Number(i.total ?? 0), 0),
      }))
      .sort((a, b) => b.monto - a.monto);
  }, [filas]);

  const alternar = (id) =>
    setMarcadas((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  const marcarGrupo = (items) =>
    setMarcadas((prev) => {
      const s = new Set(prev);
      const todas = items.every((i) => s.has(i.id));
      for (const i of items) {
        if (todas) s.delete(i.id);
        else s.add(i.id);
      }
      return s;
    });

  const asignar = async (categoriaId) => {
    if (marcadas.size === 0 || guardando) return;
    setGuardando(true);
    try {
      const { data, error } = await supabase.rpc("fn_clasificar_egresos", {
        p_ids: [...marcadas],
        p_categoria_id: categoriaId,
      });
      if (error) throw error;
      avisarOk(
        `${data} egreso${data === 1 ? "" : "s"} clasificado${data === 1 ? "" : "s"}`,
      );
      await cargar();
    } catch (err) {
      avisarError(err, "No se pudo clasificar");
    } finally {
      setGuardando(false);
    }
  };

  const pendientes = filas.length;
  const montoPendiente = filas.reduce((s, f) => s + Number(f.total ?? 0), 0);

  return (
    <div
      className="animate-fade-in space-y-4 p-4 sm:p-6"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <div>
        <h1
          className="m-0 text-[22px] font-semibold tracking-[-0.01em]"
          style={{ color: "hsl(var(--foreground))" }}
        >
          Clasificar egresos
        </h1>
        <p
          className="mt-1.5 text-[13px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {cargando
            ? "Cargando…"
            : pendientes === 0
              ? "No queda nada por clasificar. El resultado del panel está completo."
              : `Faltan ${pendientes} egresos por ${formatCOP(montoPendiente)}. Mientras no se clasifiquen, el Resultado del panel los reporta como margen de error.`}
        </p>
      </div>

      {errorMsg && (
        <p className="text-[13px]" style={{ color: "hsl(var(--destructive))" }}>
          {errorMsg}
        </p>
      )}

      {/* Barra de acción: aparece solo cuando hay algo marcado, para no ocupar
          espacio ni invitar a pulsar sin haber elegido nada. */}
      {marcadas.size > 0 && (
        <div
          className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border p-3"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--primary))",
          }}
        >
          <span
            className="text-[13px] font-medium"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {marcadas.size} marcado{marcadas.size === 1 ? "" : "s"} →
          </span>
          {cats.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={guardando}
              onClick={() => asignar(c.id)}
              className="rounded-lg border px-3 text-[12.5px] font-medium disabled:opacity-50"
              style={{
                minHeight: 48,
                borderColor: c.afecta_resultado
                  ? "hsl(var(--border))"
                  : "hsl(var(--warning))",
                color: "hsl(var(--foreground))",
              }}
              title={
                c.afecta_resultado
                  ? "Resta del resultado"
                  : "NO resta del resultado: no es un gasto del periodo"
              }
            >
              {c.nombre}
              {!c.afecta_resultado && " ·  no es gasto"}
            </button>
          ))}
        </div>
      )}

      {grupos.map((g) => (
        <div
          key={g.clave}
          className="overflow-hidden rounded-xl border"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          <button
            type="button"
            onClick={() => marcarGrupo(g.items)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
            style={{
              minHeight: 48,
              backgroundColor: "hsl(var(--muted) / 0.3)",
            }}
          >
            <span
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {g.clave} · {g.items.length}
            </span>
            <span
              className="text-[13px] font-semibold tabular-nums"
              style={{ color: "hsl(var(--foreground))" }}
            >
              {formatCOP(g.monto)}
            </span>
          </button>
          <ul>
            {g.items.map((i) => (
              <li
                key={i.id}
                className="flex items-center gap-3 border-t px-4 py-2"
                style={{ borderColor: "hsl(var(--border))" }}
              >
                <input
                  type="checkbox"
                  checked={marcadas.has(i.id)}
                  onChange={() => alternar(i.id)}
                  className="h-4 w-4 cursor-pointer"
                  aria-label={`Marcar egreso ${i.numero}`}
                />
                <span
                  className="w-24 shrink-0 text-[12px] tabular-nums"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {formatDate(i.fecha)}
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-[13px]"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {i.concepto || i.proveedor || "—"}
                </span>
                <span
                  className="shrink-0 text-[13px] tabular-nums"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {formatCOP(i.total)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Paso 4: Enrutar y poner en el menú**

En `src/App.jsx`:

```jsx
const ClasificarEgresos = lazy(() => import("./pages/admin/ClasificarEgresos"));
```

y dentro de las rutas de `/admin`:

```jsx
<Route path="egresos" element={<ClasificarEgresos />} />
```

En `src/lib/admin-shell-ui.js`, en el grupo `operacion-admin`:

```js
      {
        id: "egresos",
        label: "Clasificar egresos",
        href: "/admin/egresos",
        icon: Tags,
      },
```

(añadir `Tags` al import de `lucide-react`).

- [ ] **Paso 5: Verificar**

```bash
npx vitest run tests/integration/panel-render.test.js && npm test && npm run lint && npm run build
```

Y en la app: abrir `/admin/egresos`, marcar un grupo completo, asignarle
"Nómina" y comprobar que desaparece de la lista y baja el contador.

- [ ] **Paso 6: Commit**

```bash
git add src/pages/admin/ClasificarEgresos.jsx src/App.jsx src/lib/admin-shell-ui.js tests/integration/panel-render.test.js
git commit -m "feat(panel): bandeja para clasificar los egresos por lotes"
```

---

### Tarea B4: La categoría al registrar un egreso nuevo

Si solo se limpia lo viejo, la bandeja se vuelve a llenar sola.

**Archivos:**

- Modificar: `src/pages/ops/CompraNueva.jsx`

- [ ] **Paso 1: Ver cómo se registra hoy un egreso de caja menor**

```bash
grep -n "es_caja_menor\|concepto" src/pages/ops/CompraNueva.jsx | head -20
```

- [ ] **Paso 2: Añadir el selector**

Cuando el formulario está en modo caja menor, junto al campo de concepto, un
`<select>` alimentado de `categorias_gasto` (activas, ordenadas por `orden`), y
guardar `categoria_gasto_id` con el resto de la compra.

Marcarlo **obligatorio en modo caja menor**: sin categoría no se puede guardar.
El mensaje si falta: _"Elige la categoría del egreso: es lo que decide si esta
plata resta del resultado del mes."_ — dice la causa y la salida, como manda el
criterio de errores del proyecto.

Las categorías con `afecta_resultado = false` se muestran al final del selector,
bajo un separador que diga "No son gasto del periodo".

- [ ] **Paso 3: Verificar**

```bash
npm test && npm run lint && npm run build
```

Y registrar un egreso de caja menor real en la app: sin categoría no debe
dejar guardar; con categoría, debe aparecer ya clasificado (o sea, **no** debe
aparecer en `/admin/egresos`).

- [ ] **Paso 4: Commit**

```bash
git add src/pages/ops/CompraNueva.jsx
git commit -m "feat(panel): un egreso nuevo nace con su categoria"
```

---

# FASE C — Resultado y pérdidas

El corazón. Al terminar esta fase el panel ya sirve para decidir.

---

### Tarea C1: `fn_panel_resultado`

**Archivos:**

- Crear: `supabase/migrations/<TS>_panel_resultado.sql`

- [ ] **Paso 1: Escribir la prueba que falla**

```sql
DO $$
DECLARE
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_uid uuid; v_r jsonb;
BEGIN
  SELECT id INTO v_uid FROM usuarios WHERE rol = 'Admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  v_r := public.fn_panel_resultado(v_hoy - 89, v_hoy, NULL);

  -- La cascada tiene que cerrar: margen = ventas - costo, resultado = margen - gastos
  IF (v_r->>'margen_bruto')::numeric
     <> (v_r->>'ventas_netas')::numeric - (v_r->>'costo_vendido')::numeric THEN
    RAISE EXCEPTION 'el margen no cuadra con ventas menos costo';
  END IF;
  IF (v_r->>'resultado')::numeric
     <> (v_r->>'margen_bruto')::numeric - (v_r->>'gastos')::numeric THEN
    RAISE EXCEPTION 'el resultado no cuadra con margen menos gastos';
  END IF;

  -- Y tiene que declarar lo que no sabe, en vez de esconderlo
  IF v_r->'sin_clasificar' IS NULL
     OR (v_r->'sin_clasificar'->>'n') IS NULL
     OR (v_r->'sin_clasificar'->>'monto') IS NULL
     OR (v_r->'sin_clasificar'->>'resultado_peor_caso') IS NULL THEN
    RAISE EXCEPTION 'no declara los egresos sin clasificar';
  END IF;

  -- Productos y servicios separados: mezclarlos infla el % de margen
  IF v_r->'margen_productos' IS NULL OR v_r->'margen_servicios' IS NULL THEN
    RAISE EXCEPTION 'no separa margen de productos y de servicios';
  END IF;

  RAISE EXCEPTION 'OK - la cascada cierra y declara lo que falta (se revierte)';
END $$;
```

Esperado: `ERROR: function public.fn_panel_resultado(...) does not exist`.

- [ ] **Paso 2: Aplicar la migración**

Nombre `panel_resultado`:

```sql
-- La cascada del resultado del panel.
--
--   Ventas netas         lo facturado menos retenciones, sin anuladas
-- - Costo de lo vendido  suma de cantidad x costo_unitario del detalle
-- = Margen bruto
-- - Gastos operativos    SOLO los egresos clasificados con afecta_resultado
-- = Resultado
--
-- Dos decisiones que sostienen que el numero no mienta:
--
-- 1. Los gastos cuentan unicamente egresos con categoria y afecta_resultado.
--    Los abonos a proveedor NO restan: pagan mercancia que ya esta contada
--    dentro del costo de lo vendido, y restarla seria contarla dos veces.
--
-- 2. Se devuelve `sin_clasificar` con cuantos faltan, por cuanta plata y a
--    cuanto bajaria el resultado si TODOS resultaran ser gasto. Negarse a
--    mostrar el numero hasta tener todo clasificado significaria no mostrarlo
--    nunca; mostrarlo sin decir que falta seria mentir. Se hacen las dos cosas.
--
-- Productos y servicios van separados a proposito: los servicios entran con
-- costo cero y mezclarlos infla el porcentaje de margen.
--
-- Solo Admin: la validacion esta aqui, no escondiendo la tarjeta en el frontend.
CREATE OR REPLACE FUNCTION public.fn_panel_resultado(
  p_desde date,
  p_hasta date,
  p_sede text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ventas numeric; v_costo numeric;
  v_ventas_prod numeric; v_costo_prod numeric;
  v_ventas_serv numeric;
  v_gastos numeric;
  v_sc_n int; v_sc_monto numeric;
  v_n_ventas int;
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  if (select get_my_rol()) <> 'Admin' then
    raise exception 'El margen y los costos son información de administración';
  end if;

  -- Ventas netas: lo que de verdad representa el periodo. Se descuenta la
  -- retencion porque esa plata nunca entra: se va a la DIAN.
  select coalesce(sum(v.total - coalesce(v.retenciones_total,0)),0), count(*)
    into v_ventas, v_n_ventas
  from ventas v
  where v.anulada = false
    and v.origen in ('directa','ot')
    and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or v.sede_id = p_sede);

  -- Costo de lo vendido, y el desglose producto/servicio.
  select
    coalesce(sum(dv.cantidad * dv.costo_unitario),0),
    coalesce(sum(dv.subtotal) filter (where dv.producto_id is not null),0),
    coalesce(sum(dv.cantidad * dv.costo_unitario) filter (where dv.producto_id is not null),0),
    coalesce(sum(dv.subtotal) filter (where dv.producto_id is null),0)
  into v_costo, v_ventas_prod, v_costo_prod, v_ventas_serv
  from detalle_venta dv
  join ventas v on v.id = dv.venta_id
  where v.anulada = false
    and v.origen in ('directa','ot')
    and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or v.sede_id = p_sede);

  -- Gastos: SOLO lo clasificado como gasto real.
  select coalesce(sum(c.total),0) into v_gastos
  from compras c
  join categorias_gasto g on g.id = c.categoria_gasto_id
  where c.es_caja_menor = true
    and c.estado <> 'cancelada'
    and g.afecta_resultado = true
    and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or c.sede_destino_id = p_sede);

  -- Lo que todavia no se sabe, para poder declararlo.
  select count(*), coalesce(sum(c.total),0) into v_sc_n, v_sc_monto
  from compras c
  where c.es_caja_menor = true
    and c.estado <> 'cancelada'
    and c.categoria_gasto_id is null
    and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or c.sede_destino_id = p_sede);

  return jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta, 'sede', p_sede,
    'ventas_netas',  v_ventas,
    'costo_vendido', v_costo,
    'margen_bruto',  v_ventas - v_costo,
    'margen_pct',    case when v_ventas > 0
                          then round((v_ventas - v_costo) / v_ventas * 100, 1)
                          else null end,
    'gastos',        v_gastos,
    'resultado',     v_ventas - v_costo - v_gastos,
    'n_ventas',      v_n_ventas,
    -- Separados porque los servicios entran con costo cero y mezclarlos
    -- inflaria el porcentaje.
    'margen_productos', jsonb_build_object(
      'venta', v_ventas_prod, 'costo', v_costo_prod,
      'margen', v_ventas_prod - v_costo_prod,
      'pct', case when v_ventas_prod > 0
                  then round((v_ventas_prod - v_costo_prod) / v_ventas_prod * 100, 1)
                  else null end),
    'margen_servicios', jsonb_build_object(
      'venta', v_ventas_serv, 'costo', 0, 'margen', v_ventas_serv, 'pct', 100),
    -- El margen de error declarado.
    'sin_clasificar', jsonb_build_object(
      'n', v_sc_n,
      'monto', v_sc_monto,
      'resultado_peor_caso', v_ventas - v_costo - v_gastos - v_sc_monto)
  );
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_panel_resultado(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_panel_resultado(date, date, text) TO authenticated, service_role;
```

- [ ] **Paso 3: Correr la prueba del paso 1**

Esperado: `ERROR: OK - la cascada cierra y declara lo que falta (se revierte)`.

- [ ] **Paso 4: Comprobar que a un no-Admin lo rechaza**

```sql
DO $$
DECLARE v_uid uuid; v_hoy date := (now() at time zone 'America/Bogota')::date;
BEGIN
  SELECT id INTO v_uid FROM usuarios WHERE rol = 'Vendedor' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.fn_panel_resultado(v_hoy - 30, v_hoy, NULL);
    RAISE EXCEPTION 'MAL: una vendedora vio el margen';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'MAL:%' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'OK - el margen es solo de administracion (se revierte)';
END $$;
```

- [ ] **Paso 5: Reconciliar contra el cierre**

El invariante del spec: las cifras del panel tienen que poder explicarse contra
lo que ya muestra el cierre.

```sql
WITH d AS (SELECT (now() at time zone 'America/Bogota')::date - 30 AS desde,
                  (now() at time zone 'America/Bogota')::date AS hasta)
SELECT
  (SELECT (public.fn_panel_resultado(desde, hasta, NULL)->>'ventas_netas')::numeric FROM d) AS panel_ventas,
  (SELECT (public._fn_cierre_totales(desde, hasta, NULL)->>'ingresos_total')::numeric FROM d) AS cierre_ingresos;
```

**No tienen que coincidir**, y eso está bien: el cierre mide **caja** (cuenta
cobros y abonos el día que entran) y el panel mide **negocio** (cuenta la venta
el día que se factura). Lo que hay que verificar es que la diferencia se
explique por las ventas a crédito del periodo:

```sql
SELECT coalesce(sum(v.total - coalesce(v.retenciones_total,0)),0) AS credito_facturado_sin_cobrar
FROM ventas v
WHERE v.anulada = false AND v.metodo_pago = 'Crédito'
  AND (v.fecha at time zone 'America/Bogota')::date
      between (now() at time zone 'America/Bogota')::date - 30
          and (now() at time zone 'America/Bogota')::date;
```

Anotar los tres números en el commit. Si la diferencia **no** se explica, hay
que entender por qué antes de seguir.

- [ ] **Paso 6: Medir que no sea lenta**

```sql
EXPLAIN ANALYZE
SELECT public.fn_panel_resultado('2026-06-01', (now() at time zone 'America/Bogota')::date, NULL);
```

Esperado: menos de 500 ms sobre todo el histórico. Si se pasa, revisar si falta
un índice en `ventas(fecha)` o `detalle_venta(venta_id)`.

- [ ] **Paso 7: Guardar el archivo y commitear**

```bash
git add supabase/migrations/
git commit -m "feat(panel): la cascada del resultado, con su margen de error declarado"
```

---

### Tarea C2: `fn_panel_perdidas`

**Archivos:**

- Crear: `supabase/migrations/<TS>_panel_perdidas.sql`

- [ ] **Paso 1: Escribir la prueba que falla**

```sql
DO $$
DECLARE
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_uid uuid; v_r jsonb; v_bajo numeric;
BEGIN
  SELECT id INTO v_uid FROM usuarios WHERE rol = 'Admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  v_r := public.fn_panel_perdidas(v_hoy - 89, v_hoy, NULL);

  -- Los seis conceptos del diseno tienen que venir todos, aunque valgan cero:
  -- un concepto ausente no se distingue de uno en cero, y "ningun producto se
  -- vendio bajo costo" es una respuesta, no un hueco.
  IF v_r->'bajo_costo' IS NULL OR v_r->'descuentos' IS NULL
     OR v_r->'devoluciones' IS NULL OR v_r->'garantias' IS NULL
     OR v_r->'retenciones' IS NULL OR v_r->'ot_no_autorizadas' IS NULL THEN
    RAISE EXCEPTION 'falta alguno de los seis conceptos de perdida';
  END IF;

  -- Lo vendido bajo costo tiene que cuadrar con la consulta directa.
  SELECT coalesce(sum(dv.cantidad * dv.costo_unitario - dv.subtotal),0) INTO v_bajo
  FROM detalle_venta dv JOIN ventas v ON v.id = dv.venta_id
  WHERE v.anulada = false
    AND (v.fecha at time zone 'America/Bogota')::date between v_hoy - 89 and v_hoy
    AND dv.producto_id IS NOT NULL AND dv.costo_unitario > 0
    AND dv.subtotal < dv.cantidad * dv.costo_unitario;
  IF (v_r->'bajo_costo'->>'monto')::numeric <> v_bajo THEN
    RAISE EXCEPTION 'bajo costo dice % y la consulta directa dice %',
      v_r->'bajo_costo'->>'monto', v_bajo;
  END IF;

  RAISE EXCEPTION 'OK - las perdidas cuadran (bajo costo: %)', v_bajo;
END $$;
```

Esperado: `ERROR: function public.fn_panel_perdidas(...) does not exist`.

- [ ] **Paso 2: Aplicar la migración**

Nombre `panel_perdidas`:

```sql
-- En que se pierde la plata. La seccion que motivo el rediseno.
--
-- Los seis conceptos vienen SIEMPRE, aunque valgan cero: un concepto ausente no
-- se distingue de uno en cero, y "ningun producto se vendio bajo costo en este
-- periodo" es una respuesta util, no un hueco.
--
-- Cada uno trae monto y conteo. El detalle fila por fila lo sirve
-- fn_panel_perdidas_detalle, para no cargar cientos de lineas cuando solo se
-- quiere el titular.
CREATE OR REPLACE FUNCTION public.fn_panel_perdidas(
  p_desde date,
  p_hasta date,
  p_sede text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_bc_monto numeric; v_bc_n int;
  v_desc_monto numeric; v_desc_n int;
  v_dev_monto numeric; v_dev_n int;
  v_gar_monto numeric; v_gar_n int;
  v_ret_monto numeric; v_ret_n int;
  v_ot_n int; v_ot_monto numeric;
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  if (select get_my_rol()) <> 'Admin' then
    raise exception 'El margen y los costos son información de administración';
  end if;

  -- 1. Vendido por debajo del costo. Linea a linea: una venta puede tener una
  --    linea en perdida y el resto bien.
  select coalesce(sum(dv.cantidad * dv.costo_unitario - dv.subtotal),0), count(*)
    into v_bc_monto, v_bc_n
  from detalle_venta dv join ventas v on v.id = dv.venta_id
  where v.anulada = false
    and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or v.sede_id = p_sede)
    and dv.producto_id is not null
    and dv.costo_unitario > 0
    and dv.subtotal < dv.cantidad * dv.costo_unitario;

  -- 2. Descuentos otorgados.
  select coalesce(sum(greatest(0, least(
           coalesce(v.descuento_valor, v.subtotal * coalesce(v.descuento_pct,0)/100),
           v.subtotal))),0),
         count(*) filter (where coalesce(v.descuento_valor, v.subtotal * coalesce(v.descuento_pct,0)/100) > 0)
    into v_desc_monto, v_desc_n
  from ventas v
  where v.anulada = false
    and v.origen in ('directa','ot')
    and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or v.sede_id = p_sede);

  -- 3. Devoluciones con reembolso.
  select coalesce(sum(d.monto_reembolso),0), count(*)
    into v_dev_monto, v_dev_n
  from devoluciones d
  where d.estado <> 'anulada' and coalesce(d.monto_reembolso,0) > 0
    and (d.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or d.sede_id = p_sede);

  -- 4. Garantias resueltas devolviendo plata.
  select coalesce(sum(g.monto_devuelto),0), count(*)
    into v_gar_monto, v_gar_n
  from garantias_venta g
  left join ventas gv on gv.id = g.venta_id
  left join ordenes_servicio go on go.id = g.orden_servicio_id
  where g.estado <> 'anulada' and g.resolucion = 'devolver_dinero'
    and (g.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or coalesce(gv.sede_id, go.sede_id) = p_sede);

  -- 5. Retenciones: plata facturada que se fue a la DIAN o al municipio.
  select coalesce(sum(v.retenciones_total),0),
         count(*) filter (where coalesce(v.retenciones_total,0) > 0)
    into v_ret_monto, v_ret_n
  from ventas v
  where v.anulada = false
    and v.origen in ('directa','ot')
    and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or v.sede_id = p_sede);

  -- 6. OT diagnosticadas que nadie autorizo: trabajo hecho que no se vendio.
  --    El "monto" es lo que se alcanzo a cobrar por la revision, no la perdida
  --    exacta —el costo del tiempo del tecnico no esta en la base— asi que la
  --    UI lo presenta como conteo, con el valor de revision como referencia.
  select count(*), coalesce(sum(o.valor_revision),0)
    into v_ot_n, v_ot_monto
  from ordenes_servicio o
  where o.estado_autorizacion = 'no_autorizado'
    and (o.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or o.sede_id = p_sede);

  return jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta, 'sede', p_sede,
    'bajo_costo',   jsonb_build_object('monto', v_bc_monto,  'n', v_bc_n,
                      'etiqueta', 'Vendido bajo costo', 'unidad', 'líneas'),
    'descuentos',   jsonb_build_object('monto', v_desc_monto,'n', v_desc_n,
                      'etiqueta', 'Descuentos otorgados', 'unidad', 'ventas'),
    'devoluciones', jsonb_build_object('monto', v_dev_monto, 'n', v_dev_n,
                      'etiqueta', 'Devoluciones reembolsadas', 'unidad', 'casos'),
    'garantias',    jsonb_build_object('monto', v_gar_monto, 'n', v_gar_n,
                      'etiqueta', 'Garantías reembolsadas', 'unidad', 'casos'),
    'retenciones',  jsonb_build_object('monto', v_ret_monto, 'n', v_ret_n,
                      'etiqueta', 'Retenciones', 'unidad', 'facturas'),
    'ot_no_autorizadas', jsonb_build_object('monto', v_ot_monto, 'n', v_ot_n,
                      'etiqueta', 'OT diagnosticadas sin autorizar', 'unidad', 'OT'),
    'total', v_bc_monto + v_desc_monto + v_dev_monto + v_gar_monto + v_ret_monto
  );
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_panel_perdidas(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_panel_perdidas(date, date, text) TO authenticated, service_role;
```

> **Ojo con el total:** las OT no autorizadas **no** suman al total, porque su
> monto es el valor de revisión (lo que sí se cobró), no una pérdida. Sumarlo
> inflaría la cifra. La UI lo muestra aparte, como conteo.

- [ ] **Paso 3: Correr la prueba del paso 1**

Esperado: `ERROR: OK - las perdidas cuadran (bajo costo: 6535825.33)` — o el
número que corresponda al momento de correrla.

- [ ] **Paso 4: Guardar el archivo y commitear**

```bash
git add supabase/migrations/
git commit -m "feat(panel): los seis conceptos de perdida"
```

---

### Tarea C3: El detalle de cada pérdida

Lo que hace que cada cifra sea una puerta y no un callejón.

**Archivos:**

- Crear: `supabase/migrations/<TS>_panel_perdidas_detalle.sql`

- [ ] **Paso 1: Escribir la prueba que falla**

```sql
DO $$
DECLARE
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_uid uuid; v_n int;
BEGIN
  SELECT id INTO v_uid FROM usuarios WHERE rol = 'Admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_n FROM public.fn_panel_perdidas_detalle(
    'bajo_costo', v_hoy - 89, v_hoy, NULL);
  IF v_n = 0 THEN RAISE EXCEPTION 'no devolvio ninguna linea bajo costo'; END IF;

  -- Un concepto inventado tiene que fallar claro, no devolver vacio
  BEGIN
    PERFORM public.fn_panel_perdidas_detalle('inventado', v_hoy - 89, v_hoy, NULL);
    RAISE EXCEPTION 'MAL: acepto un concepto que no existe';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'MAL:%' THEN RAISE; END IF;
  END;

  RAISE EXCEPTION 'OK - el detalle trae % lineas bajo costo (se revierte)', v_n;
END $$;
```

- [ ] **Paso 2: Aplicar la migración**

Nombre `panel_perdidas_detalle`:

```sql
-- El detalle de cada perdida, fila por fila, hasta el documento.
--
-- Devuelve una forma comun para que la tabla del panel sea una sola: fecha,
-- referencia legible, descripcion, monto, y el id del documento al que llevar.
-- Si cada concepto devolviera columnas distintas habria que escribir seis
-- tablas en el frontend.
CREATE OR REPLACE FUNCTION public.fn_panel_perdidas_detalle(
  p_concepto text,
  p_desde date,
  p_hasta date,
  p_sede text DEFAULT NULL,
  p_limite int DEFAULT 200
)
 RETURNS TABLE (
   fecha date,
   referencia text,
   descripcion text,
   monto numeric,
   doc_tipo text,
   doc_id uuid
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  if (select get_my_rol()) <> 'Admin' then
    raise exception 'El margen y los costos son información de administración';
  end if;
  if p_concepto not in ('bajo_costo','descuentos','devoluciones','garantias','retenciones','ot_no_autorizadas') then
    raise exception 'Concepto desconocido: %', p_concepto;
  end if;

  if p_concepto = 'bajo_costo' then
    return query
      select (v.fecha at time zone 'America/Bogota')::date,
             'Venta #' || v.numero::text,
             coalesce(p.nombre, 'Producto') || ' × ' || dv.cantidad::text,
             (dv.cantidad * dv.costo_unitario - dv.subtotal)::numeric,
             'venta'::text, v.id
      from detalle_venta dv
      join ventas v on v.id = dv.venta_id
      left join productos p on p.id = dv.producto_id
      where v.anulada = false
        and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        and (p_sede is null or v.sede_id = p_sede)
        and dv.producto_id is not null and dv.costo_unitario > 0
        and dv.subtotal < dv.cantidad * dv.costo_unitario
      order by (dv.cantidad * dv.costo_unitario - dv.subtotal) desc
      limit p_limite;

  elsif p_concepto = 'descuentos' then
    return query
      select (v.fecha at time zone 'America/Bogota')::date,
             'Venta #' || v.numero::text,
             coalesce(v.cliente_nombre, 'Consumidor final'),
             greatest(0, least(coalesce(v.descuento_valor, v.subtotal * coalesce(v.descuento_pct,0)/100), v.subtotal))::numeric,
             'venta'::text, v.id
      from ventas v
      where v.anulada = false and v.origen in ('directa','ot')
        and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        and (p_sede is null or v.sede_id = p_sede)
        and coalesce(v.descuento_valor, v.subtotal * coalesce(v.descuento_pct,0)/100) > 0
      order by 4 desc limit p_limite;

  elsif p_concepto = 'devoluciones' then
    return query
      select (d.fecha at time zone 'America/Bogota')::date,
             'Devolución #' || d.id::text,
             coalesce(d.motivo, 'Sin motivo'),
             d.monto_reembolso::numeric,
             'devolucion'::text, d.id
      from devoluciones d
      where d.estado <> 'anulada' and coalesce(d.monto_reembolso,0) > 0
        and (d.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        and (p_sede is null or d.sede_id = p_sede)
      order by 4 desc limit p_limite;

  elsif p_concepto = 'garantias' then
    return query
      select (g.fecha at time zone 'America/Bogota')::date,
             'Garantía #' || g.id::text,
             coalesce(g.motivo, 'Sin motivo'),
             g.monto_devuelto::numeric,
             'garantia'::text, g.id
      from garantias_venta g
      left join ventas gv on gv.id = g.venta_id
      left join ordenes_servicio go on go.id = g.orden_servicio_id
      where g.estado <> 'anulada' and g.resolucion = 'devolver_dinero'
        and (g.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        and (p_sede is null or coalesce(gv.sede_id, go.sede_id) = p_sede)
      order by 4 desc limit p_limite;

  elsif p_concepto = 'retenciones' then
    return query
      select (v.fecha at time zone 'America/Bogota')::date,
             'Venta #' || v.numero::text,
             coalesce(v.cliente_nombre, 'Consumidor final'),
             v.retenciones_total::numeric,
             'venta'::text, v.id
      from ventas v
      where v.anulada = false and v.origen in ('directa','ot')
        and coalesce(v.retenciones_total,0) > 0
        and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        and (p_sede is null or v.sede_id = p_sede)
      order by 4 desc limit p_limite;

  else -- ot_no_autorizadas
    return query
      select (o.fecha at time zone 'America/Bogota')::date,
             'OT #' || o.numero::text,
             coalesce(o.equipo_descripcion, 'Equipo'),
             coalesce(o.valor_revision,0)::numeric,
             'orden'::text, o.id
      from ordenes_servicio o
      where o.estado_autorizacion = 'no_autorizado'
        and (o.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        and (p_sede is null or o.sede_id = p_sede)
      order by 1 desc limit p_limite;
  end if;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_panel_perdidas_detalle(text, date, date, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_panel_perdidas_detalle(text, date, date, text, int) TO authenticated, service_role;
```

- [ ] **Paso 3: Correr la prueba del paso 1**

Esperado: `ERROR: OK - el detalle trae 103 lineas bajo costo (se revierte)`.

- [ ] **Paso 4: Guardar el archivo y commitear**

```bash
git add supabase/migrations/
git commit -m "feat(panel): detalle de cada perdida hasta el documento"
```

---

### Tarea C4: La cascada en pantalla

**Archivos:**

- Crear: `src/components/panel/Cascada.jsx`
- Modificar: `src/pages/admin/Panel.jsx`
- Probar: `tests/integration/panel-render.test.js`

- [ ] **Paso 1: Añadir la prueba de humo**

```js
describe("Cascada", () => {
  const DATOS = {
    ventas_netas: 145000000,
    costo_vendido: 38000000,
    margen_bruto: 107000000,
    margen_pct: 73.8,
    gastos: 61770000,
    resultado: 45230000,
    n_ventas: 1204,
    margen_productos: {
      venta: 120000000,
      costo: 38000000,
      margen: 82000000,
      pct: 68.3,
    },
    margen_servicios: { venta: 25000000, costo: 0, margen: 25000000, pct: 100 },
    sin_clasificar: { n: 38, monto: 12400000, resultado_peor_caso: 32830000 },
  };

  const montar = async (datos) => {
    const Cascada = (await import("../../src/components/panel/Cascada"))
      .default;
    return renderToStaticMarkup(
      createElement(Cascada, { datos, onAbrir() {} }),
    );
  };

  it("muestra los cinco renglones de la cascada", async () => {
    const html = await montar(DATOS);
    for (const t of [
      "Ventas netas",
      "Costo de lo vendido",
      "Margen bruto",
      "Gastos",
      "Resultado",
    ]) {
      expect(html).toContain(t);
    }
  });

  it("avisa lo que falta por clasificar y el peor caso", async () => {
    const html = await montar(DATOS);
    expect(html).toContain("38");
    expect(html).toContain("Clasificarlos");
  });

  it("cuando no falta nada, el aviso desaparece", async () => {
    const html = await montar({
      ...DATOS,
      sin_clasificar: { n: 0, monto: 0, resultado_peor_caso: 45230000 },
    });
    expect(html).not.toContain("Clasificarlos");
  });

  it("separa el margen de productos del de servicios", async () => {
    const html = await montar(DATOS);
    expect(html).toContain("productos");
    expect(html).toContain("servicios");
  });
});
```

- [ ] **Paso 2: Correr y ver fallar**

```bash
npx vitest run tests/integration/panel-render.test.js
```

- [ ] **Paso 3: Escribir el componente**

```jsx
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { formatCOP } from "../../lib/utils";

/**
 * La cascada del resultado.
 *
 * Se lee como un recibo: cada renglón dice de qué está hecho, y los de resultado
 * (margen, resultado) van en negrita con una regla arriba.
 *
 * El color: los gastos NO van en rojo. Un gasto es normal, no una alarma; el
 * rojo se guarda para lo que exige actuar. Si todo grita, nada se oye.
 */
export default function Cascada({ datos, onAbrir }) {
  const sc = datos.sin_clasificar ?? { n: 0, monto: 0 };
  const negativo = Number(datos.resultado) < 0;

  const Renglon = ({
    etiqueta,
    nota,
    valor,
    signo,
    fuerte,
    color,
    onClick,
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex w-full items-start justify-between gap-3 py-2 text-left ${
        fuerte ? "border-t pt-3" : ""
      } ${onClick ? "cursor-pointer" : "cursor-default"}`}
      style={fuerte ? { borderColor: "hsl(var(--border))" } : undefined}
    >
      <span className="min-w-0">
        <span
          className={`block text-[13px] ${fuerte ? "font-semibold" : ""}`}
          style={{ color: "hsl(var(--foreground))" }}
        >
          {signo} {etiqueta}
        </span>
        {nota && (
          <span
            className="block text-[11.5px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {nota}
          </span>
        )}
      </span>
      <span
        className={`shrink-0 tabular-nums ${fuerte ? "text-[17px] font-semibold" : "text-[14px]"}`}
        style={{ color: color ?? "hsl(var(--foreground))" }}
      >
        {formatCOP(valor)}
      </span>
    </button>
  );

  return (
    <div>
      <Renglon
        etiqueta="Ventas netas"
        nota={`${datos.n_ventas} facturas, sin retenciones ni anuladas`}
        valor={datos.ventas_netas}
        color="hsl(var(--success))"
        onClick={() => onAbrir?.("ventas")}
      />
      <Renglon
        etiqueta="Costo de lo vendido"
        nota="Costo promedio de cada producto al momento de venderlo"
        valor={datos.costo_vendido}
        signo="−"
        color="hsl(var(--muted-foreground))"
      />
      <Renglon
        etiqueta="Margen bruto"
        nota={
          datos.margen_pct != null
            ? `${datos.margen_pct}% · productos ${datos.margen_productos?.pct ?? 0}% · servicios ${datos.margen_servicios?.pct ?? 0}%`
            : "Sin ventas en el periodo"
        }
        valor={datos.margen_bruto}
        signo="="
        fuerte
      />
      <Renglon
        etiqueta="Gastos operativos"
        nota="Solo los egresos clasificados como gasto real"
        valor={datos.gastos}
        signo="−"
        color="hsl(var(--muted-foreground))"
        onClick={() => onAbrir?.("gastos")}
      />
      <Renglon
        etiqueta="Resultado"
        valor={datos.resultado}
        signo="="
        fuerte
        color={negativo ? "hsl(var(--destructive))" : "hsl(var(--foreground))"}
      />

      {/* El margen de error declarado. Mostrar el número sin decir qué falta
          sería mentir; no mostrarlo hasta tenerlo todo sería no mostrarlo nunca. */}
      {sc.n > 0 && (
        <div
          className="mt-3 flex items-start gap-2 rounded-lg border p-3"
          style={{
            borderColor: "hsl(var(--warning))",
            backgroundColor: "hsl(var(--warning) / 0.08)",
          }}
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0"
            style={{ color: "hsl(var(--warning))" }}
            strokeWidth={1.7}
          />
          <div className="min-w-0 flex-1">
            <p
              className="text-[12.5px]"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Faltan <b>{sc.n}</b> egresos sin clasificar por{" "}
              <b>{formatCOP(sc.monto)}</b>. Si todos fueran gasto, el resultado
              bajaría a <b>{formatCOP(sc.resultado_peor_caso)}</b>.
            </p>
            <Link
              to="/admin/egresos"
              className="mt-1.5 inline-flex items-center rounded-lg border px-3 text-[12.5px] font-medium"
              style={{
                minHeight: 48,
                borderColor: "hsl(var(--warning))",
                color: "hsl(var(--foreground))",
              }}
            >
              Clasificarlos
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Paso 4: El gráfico de cascada**

Crear `src/components/panel/CascadaGrafico.jsx` con recharts. Se oculta en
móvil (`hidden md:block`): en pantalla angosta la lista se lee mejor y el
gráfico solo estorba.

Usar `BarChart` con dos series: una transparente que posiciona la barra y otra
visible con el valor. Los colores **por token**, nunca hex:

```jsx
const COLOR_SUBE = "hsl(var(--success))";
const COLOR_BAJA = "hsl(var(--muted-foreground))";
const COLOR_TOTAL = "hsl(var(--primary))";
```

- [ ] **Paso 5: Conectar en la página**

En `src/pages/admin/Panel.jsx`, reemplazar la `<Seccion titulo="Resultado del
periodo">` vacía por una que llame a `fn_panel_resultado` con el rango y la sede,
maneje sus cuatro estados y pinte `<Cascada>`.

- [ ] **Paso 6: Verificar**

```bash
npx vitest run tests/integration/panel-render.test.js && npm test && npm run lint && npm run build
```

Y en la app, con datos reales: abrir el panel en "Últimos 90", comprobar que la
cascada cierra (margen = ventas − costo, resultado = margen − gastos), que el
aviso de sin clasificar aparece, y que cambiar el rango cambia las cifras.

Revisar a **360 px** que ningún monto se salga ni se monte.

- [ ] **Paso 7: Commit**

```bash
git add src/components/panel/ src/pages/admin/Panel.jsx tests/integration/panel-render.test.js
git commit -m "feat(panel): la cascada del resultado en pantalla"
```

---

### Tarea C5: Pérdidas y el panel lateral de detalle

**Archivos:**

- Crear: `src/components/panel/Perdidas.jsx`
- Crear: `src/components/panel/PanelDetalle.jsx`
- Modificar: `src/pages/admin/Panel.jsx`

- [ ] **Paso 1: Añadir la prueba de humo**

```js
describe("Perdidas y su detalle", () => {
  const P = {
    bajo_costo: {
      monto: 6535825,
      n: 103,
      etiqueta: "Vendido bajo costo",
      unidad: "líneas",
    },
    descuentos: {
      monto: 1522551,
      n: 47,
      etiqueta: "Descuentos otorgados",
      unidad: "ventas",
    },
    devoluciones: {
      monto: 0,
      n: 0,
      etiqueta: "Devoluciones reembolsadas",
      unidad: "casos",
    },
    garantias: {
      monto: 271000,
      n: 3,
      etiqueta: "Garantías reembolsadas",
      unidad: "casos",
    },
    retenciones: {
      monto: 0,
      n: 0,
      etiqueta: "Retenciones",
      unidad: "facturas",
    },
    ot_no_autorizadas: {
      monto: 540000,
      n: 54,
      etiqueta: "OT diagnosticadas sin autorizar",
      unidad: "OT",
    },
    total: 8329376,
  };

  it("ordena de mayor a menor: lo que mas duele va primero", async () => {
    const Perdidas = (await import("../../src/components/panel/Perdidas"))
      .default;
    const html = renderToStaticMarkup(
      createElement(Perdidas, { datos: P, onAbrir() {} }),
    );
    expect(html.indexOf("Vendido bajo costo")).toBeLessThan(
      html.indexOf("Descuentos otorgados"),
    );
  });

  it("un concepto en cero se muestra como respuesta, no se esconde", async () => {
    const Perdidas = (await import("../../src/components/panel/Perdidas"))
      .default;
    const html = renderToStaticMarkup(
      createElement(Perdidas, { datos: P, onAbrir() {} }),
    );
    expect(html).toContain("Devoluciones reembolsadas");
  });

  it("el panel de detalle monta cerrado y abierto", async () => {
    const PD = (await import("../../src/components/panel/PanelDetalle"))
      .default;
    expect(() =>
      renderToStaticMarkup(
        createElement(PD, {
          abierto: false,
          titulo: "x",
          filas: [],
          onCerrar() {},
        }),
      ),
    ).not.toThrow();
    expect(() =>
      renderToStaticMarkup(
        createElement(PD, {
          abierto: true,
          titulo: "Vendido bajo costo",
          subtitulo: "Del 1 al 30 de septiembre",
          filas: [
            {
              fecha: "2026-09-10",
              referencia: "Venta #1234",
              descripcion: "FILTRO × 2",
              monto: 45000,
              doc_tipo: "venta",
              doc_id: "abc",
            },
          ],
          onCerrar() {},
        }),
      ),
    ).not.toThrow();
  });
});
```

- [ ] **Paso 2: Correr y ver fallar, luego escribir los dos componentes**

`Perdidas.jsx`: una lista ordenada de mayor a menor, cada renglón con punto de
color, etiqueta, monto, conteo con su unidad, y chevron. Las OT no autorizadas
van al final y **separadas del total**, con la nota de que su monto es el valor
de revisión, no la pérdida.

`PanelDetalle.jsx`: en escritorio se desliza desde la derecha con 480 px y deja
ver el panel detrás (`fixed right-0 top-0 h-full w-[480px]` + fondo
semitransparente); en móvil ocupa la pantalla casi completa desde abajo. Cierra
con la X, con **Escape** y tocando fuera. Devuelve el foco al cerrarse. Cada
fila enlaza a su documento según `doc_tipo`:

```jsx
const RUTA = {
  venta: (id) => `/ops/ventas/${id}`,
  orden: (id) => `/ops/ordenes/${id}`,
  devolucion: (id) => `/ops/devoluciones/${id}`,
  garantia: (id) => `/ops/garantias/${id}`,
};
```

(verificar cada ruta contra `src/App.jsx` antes de darlas por buenas).

- [ ] **Paso 3: Verificar**

```bash
npx vitest run tests/integration/panel-render.test.js && npm test && npm run lint && npm run build
```

En la app: pulsar "Vendido bajo costo", que abra el panel con las 103 líneas
ordenadas de mayor pérdida a menor, y que al pulsar una llegue a esa venta.

Probar **Escape** y el clic fuera.

- [ ] **Paso 4: Commit**

```bash
git add src/components/panel/ src/pages/admin/Panel.jsx tests/integration/panel-render.test.js
git commit -m "feat(panel): en que se pierde, con el detalle hasta el documento"
```

---

# FASE D — Cómo se compone la venta

---

### Tarea D1: `fn_panel_composicion`

Una función con un parámetro de dimensión, no siete funciones. La forma de
salida es siempre la misma, así el frontend tiene una sola tabla.

**Archivos:**

- Crear: `supabase/migrations/<TS>_panel_composicion.sql`

- [ ] **Paso 1: Escribir la prueba que falla**

```sql
DO $$
DECLARE
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_uid uuid; v_dim text; v_n int; v_suma numeric; v_ventas numeric;
BEGIN
  SELECT id INTO v_uid FROM usuarios WHERE rol = 'Admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  -- Las siete dimensiones tienen que responder
  FOREACH v_dim IN ARRAY ARRAY['sede','vendedora','producto','categoria','tipo','metodo_pago','cliente'] LOOP
    SELECT count(*) INTO v_n
      FROM public.fn_panel_composicion(v_dim, v_hoy - 89, v_hoy, NULL);
    IF v_n = 0 THEN RAISE EXCEPTION 'la dimension % no devolvio nada', v_dim; END IF;
  END LOOP;

  -- INVARIANTE: las partes tienen que sumar el total. Si un desglose no suma
  -- lo mismo que la cifra de arriba, nadie sabe cual creer.
  SELECT coalesce(sum(venta),0) INTO v_suma
    FROM public.fn_panel_composicion('sede', v_hoy - 89, v_hoy, NULL);
  SELECT (public.fn_panel_resultado(v_hoy - 89, v_hoy, NULL)->>'ventas_netas')::numeric
    INTO v_ventas;
  IF abs(v_suma - v_ventas) > 1 THEN
    RAISE EXCEPTION 'las sedes suman % pero el resultado dice %', v_suma, v_ventas;
  END IF;

  -- Una dimension inventada falla claro
  BEGIN
    PERFORM public.fn_panel_composicion('inventada', v_hoy - 89, v_hoy, NULL);
    RAISE EXCEPTION 'MAL: acepto una dimension que no existe';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'MAL:%' THEN RAISE; END IF;
  END;

  RAISE EXCEPTION 'OK - las siete dimensiones responden y las partes suman (se revierte)';
END $$;
```

- [ ] **Paso 2: Aplicar la migración**

Nombre `panel_composicion`:

```sql
-- De que se compone la venta, por la dimension que se pida.
--
-- Una sola funcion con parametro de dimension y una forma de salida comun, no
-- siete funciones: asi el panel tiene UNA tabla que cambia de eje, en vez de
-- siete widgets que hay que mantener por separado.
--
-- Se calcula sobre detalle_venta y no sobre ventas.total porque hay dimensiones
-- (producto, categoria) que solo existen a nivel de linea. Para que las partes
-- sumen exactamente el total, la retencion de cada venta se reparte entre sus
-- lineas en proporcion al subtotal: si no, el desglose no cuadraria con la
-- cascada y no se sabria cual de los dos numeros creer.
CREATE OR REPLACE FUNCTION public.fn_panel_composicion(
  p_dimension text,
  p_desde date,
  p_hasta date,
  p_sede text DEFAULT NULL,
  p_limite int DEFAULT 100
)
 RETURNS TABLE (
   clave text,
   etiqueta text,
   venta numeric,
   costo numeric,
   margen numeric,
   margen_pct numeric,
   n int
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  if (select get_my_rol()) <> 'Admin' then
    raise exception 'El margen y los costos son información de administración';
  end if;
  if p_dimension not in ('sede','vendedora','producto','categoria','tipo','metodo_pago','cliente') then
    raise exception 'Dimensión desconocida: %', p_dimension;
  end if;

  return query
  with lineas as (
    select
      dv.producto_id, dv.cantidad, dv.subtotal, dv.costo_unitario,
      v.id as venta_id, v.sede_id, v.vendedor_id, v.metodo_pago, v.origen,
      coalesce(nullif(btrim(v.cliente_nombre),''), 'Consumidor final') as cliente,
      -- La retencion de la venta, repartida entre sus lineas en proporcion al
      -- subtotal. Es lo que hace que las partes sumen el mismo total que la
      -- cascada, que descuenta la retencion completa.
      dv.subtotal
        - coalesce(v.retenciones_total,0)
          * (dv.subtotal / nullif(sum(dv.subtotal) over (partition by v.id), 0))
        as venta_neta
    from detalle_venta dv
    join ventas v on v.id = dv.venta_id
    where v.anulada = false
      and v.origen in ('directa','ot')
      and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
      and (p_sede is null or v.sede_id = p_sede)
  ),
  agrupado as (
    select
      case p_dimension
        when 'sede'        then l.sede_id
        when 'vendedora'   then l.vendedor_id::text
        when 'producto'    then coalesce(l.producto_id::text, 'servicio')
        when 'categoria'   then coalesce(p.categoria, 'Sin categoría')
        when 'tipo'        then l.origen
        when 'metodo_pago' then coalesce(l.metodo_pago, 'Sin método')
        else l.cliente
      end as clave,
      sum(l.venta_neta) as venta,
      sum(l.cantidad * l.costo_unitario) as costo,
      count(distinct l.venta_id) as n
    from lineas l
    left join productos p on p.id = l.producto_id
    group by 1
  )
  select
    a.clave,
    -- La etiqueta legible se resuelve aqui para que el frontend no tenga que
    -- pedir usuarios ni productos aparte solo para pintar un nombre.
    case p_dimension
      when 'sede'      then coalesce(s.nombre, a.clave)
      when 'vendedora' then coalesce(u.nombre, 'Sin vendedor')
      when 'producto'  then coalesce(pr.nombre, 'Servicios y mano de obra')
      when 'tipo'      then case a.clave when 'directa' then 'Mostrador'
                                         when 'ot' then 'Orden de trabajo'
                                         else a.clave end
      else a.clave
    end::text,
    round(a.venta, 2),
    round(a.costo, 2),
    round(a.venta - a.costo, 2),
    case when a.venta > 0 then round((a.venta - a.costo) / a.venta * 100, 1) else null end,
    a.n::int
  from agrupado a
  left join sedes s     on p_dimension = 'sede'      and s.id = a.clave
  left join usuarios u  on p_dimension = 'vendedora' and u.id::text = a.clave
  left join productos pr on p_dimension = 'producto' and pr.id::text = a.clave
  order by 3 desc
  limit p_limite;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_panel_composicion(text, date, date, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_panel_composicion(text, date, date, text, int) TO authenticated, service_role;
```

> **Ojo con la columna `categoria` de productos:** antes de aplicar, verificar
> que existe con
> `select column_name from information_schema.columns where table_name='productos' and column_name='categoria';`
> Si se llama distinto, ajustar el `case`. Si no existe, quitar la dimensión
> `categoria` de la lista permitida y de la prueba.

- [ ] **Paso 3: Correr la prueba del paso 1**

Esperado: `ERROR: OK - las siete dimensiones responden y las partes suman (se revierte)`.

Si falla el invariante de la suma, es que el reparto de la retención no está
cerrando: revisar el `partition by v.id` y el `nullif` del denominador.

- [ ] **Paso 4: Medir el rendimiento**

```sql
EXPLAIN ANALYZE
SELECT * FROM public.fn_panel_composicion('producto', '2026-06-01',
  (now() at time zone 'America/Bogota')::date, NULL);
```

Es la dimensión más pesada (agrupa por producto sobre todo el histórico).
Esperado: menos de 800 ms. Si se pasa, considerar un índice en
`detalle_venta(venta_id, producto_id)`.

- [ ] **Paso 5: Guardar el archivo y commitear**

```bash
git add supabase/migrations/
git commit -m "feat(panel): composicion de la venta por siete dimensiones"
```

---

### Tarea D2: La tabla de composición

**Archivos:**

- Crear: `src/components/panel/Composicion.jsx`
- Modificar: `src/pages/admin/Panel.jsx`

- [ ] **Paso 1: Añadir la prueba de humo**

```js
describe("Composicion", () => {
  const FILAS = [
    {
      clave: "CV",
      etiqueta: "Cali Valle",
      venta: 80000000,
      costo: 20000000,
      margen: 60000000,
      margen_pct: 75,
      n: 400,
    },
    {
      clave: "CHV",
      etiqueta: "Chipichape",
      venta: 45000000,
      costo: 15000000,
      margen: 30000000,
      margen_pct: 66.7,
      n: 250,
    },
    {
      clave: "L3",
      etiqueta: "Local 3",
      venta: 20000000,
      costo: 12000000,
      margen: 8000000,
      margen_pct: 40,
      n: 120,
    },
  ];

  const montar = async (props) => {
    const C = (await import("../../src/components/panel/Composicion")).default;
    return renderToStaticMarkup(
      createElement(C, {
        dimension: "sede",
        onDimension() {},
        filas: FILAS,
        peores: false,
        onPeores() {},
        ...props,
      }),
    );
  };

  it("trae las siete dimensiones para escoger", async () => {
    const html = await montar();
    for (const t of ["Sede", "Vendedora", "Producto", "Tipo", "Cliente"]) {
      expect(html).toContain(t);
    }
  });

  it("muestra el total al pie para poder verificar que las partes suman", async () => {
    const html = await montar();
    expect(html).toContain("Total");
  });

  it("puede invertir el orden para ver los peores", async () => {
    const html = await montar({ peores: true });
    // Con "ver los peores" el de menor margen queda de primero.
    expect(html.indexOf("Local 3")).toBeLessThan(html.indexOf("Cali Valle"));
  });
});
```

- [ ] **Paso 2: Escribir el componente**

Puntos que no se pueden saltar:

- Selector de dimensión en chips de 48 px de alto.
- Columnas: etiqueta · venta · costo · margen · % · participación.
- **Ordenable por cualquier columna**, con la flecha visible en la activa.
- **Barra de participación** dentro de la celda del %, para comparar sin leer.
- **Pie con el total**, que es lo que permite verificar que las partes suman.
- **Interruptor "ver los peores"** que invierte el orden: los que menos margen
  dejan suelen ser más accionables que los que más venden.
- En móvil, lista de tarjetas (Regla #5 del sistema de diseño).
- Las columnas de costo y margen **no se pintan** si no es Admin — pero además
  la RPC ya rechaza a quien no lo sea, así que esto es solo la segunda capa.

- [ ] **Paso 3: Verificar**

```bash
npx vitest run tests/integration/panel-render.test.js && npm test && npm run lint && npm run build
```

Y en la app: cambiar de dimensión y ver que las cifras cambian; comprobar que
la suma de la columna venta coincide con las "Ventas netas" de la cascada.

- [ ] **Paso 4: Commit**

```bash
git add src/components/panel/Composicion.jsx src/pages/admin/Panel.jsx tests/integration/panel-render.test.js
git commit -m "feat(panel): tabla de composicion con siete ejes y ver los peores"
```

---

# FASE E — Cartera, inventario y exportar

---

### Tarea E1: `fn_panel_cartera` y `fn_panel_inventario`

Estas dos **no reciben rango**: son fotos de hoy. Quién debe ahora, cuánta plata
hay dormida ahora. Aplicarles el rango del panel sería confuso.

**Archivos:**

- Crear: `supabase/migrations/<TS>_panel_cartera_inventario.sql`

- [ ] **Paso 1: Escribir la prueba que falla**

```sql
DO $$
DECLARE v_uid uuid; v_c jsonb; v_i jsonb; v_suma numeric; v_total numeric;
BEGIN
  SELECT id INTO v_uid FROM usuarios WHERE rol = 'Admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  v_c := public.fn_panel_cartera(NULL);
  -- Los cuatro tramos de antiguedad
  IF v_c->'tramos'->0 IS NULL THEN RAISE EXCEPTION 'no trae tramos de antiguedad'; END IF;
  SELECT coalesce(sum((t->>'monto')::numeric),0) INTO v_suma
    FROM jsonb_array_elements(v_c->'tramos') t;
  v_total := (v_c->>'total')::numeric;
  IF abs(v_suma - v_total) > 1 THEN
    RAISE EXCEPTION 'los tramos suman % pero el total dice %', v_suma, v_total;
  END IF;

  v_i := public.fn_panel_inventario(NULL);
  IF v_i->>'valor_costo' IS NULL OR v_i->>'dormido' IS NULL
     OR v_i->>'agotados_a' IS NULL THEN
    RAISE EXCEPTION 'inventario no trae valor, dormido y agotados A';
  END IF;

  RAISE EXCEPTION 'OK - cartera (%) e inventario responden', v_total;
END $$;
```

- [ ] **Paso 2: Aplicar la migración**

Nombre `panel_cartera_inventario`. Dos funciones:

`fn_panel_cartera(p_sede text)` — sobre `v_cuentas_por_cobrar`, agrupa el saldo
en cuatro tramos por días desde la fecha de la venta: `0-30`, `31-60`, `61-90`,
`+90`. Devuelve `{ total, tramos: [{rango, monto, n}], detalle: [...] }`. El
saldo ya viene neto de retenciones porque la vista lo descuenta.

`fn_panel_inventario(p_sede text)` — devuelve:

- `valor_costo`: `sum(cantidad × costo_promedio)` de `inventario` con
  `cantidad > 0`.
- `dormido`: lo mismo, pero solo de productos sin ningún movimiento de salida en
  90 días. Es la plata que está quieta.
- `agotados_a`: cuántos productos de `clasificacion_global = 'A'` están en cero
  con mínimo configurado. Es venta que se está perdiendo.

Las dos con el mismo bloque de permisos (`REVOKE ... FROM PUBLIC, anon` +
`GRANT ... TO authenticated, service_role`) y la misma validación de Admin.

- [ ] **Paso 3: Correr la prueba y guardar el archivo**

- [ ] **Paso 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(panel): cartera por antiguedad e inventario como capital"
```

---

### Tarea E2: Las dos secciones en pantalla

**Archivos:**

- Crear: `src/components/panel/Cartera.jsx`, `src/components/panel/Inventario.jsx`
- Modificar: `src/pages/admin/Panel.jsx`

- [ ] **Paso 1: Prueba de humo de las dos**, con los cuatro estados.

- [ ] **Paso 2: Escribirlas.**

Cartera: barra apilada de los cuatro tramos con su leyenda, y la lista de los
que más deben. El tramo `+90` en `--destructive`; los demás en gradiente de
`--muted-foreground` a `--warning`. Cada fila abre el panel de detalle.

Inventario: tres cifras con su explicación de una línea. "Plata dormida" lleva
enlace a Reorden; "Agotados clase A" a Alertas.

- [ ] **Paso 3: Verificar y commitear**

```bash
npm test && npm run lint && npm run build
git add src/components/panel/ src/pages/admin/Panel.jsx tests/integration/panel-render.test.js
git commit -m "feat(panel): cartera por antiguedad e inventario en pantalla"
```

---

### Tarea E3: Exportar a Excel

**Archivos:**

- Crear: `src/lib/panel-exportar.js`
- Modificar: los componentes de sección

- [ ] **Paso 1: Ver con qué se exporta hoy**

```bash
grep -rn "xlsx\|csv\|Blob(" src/lib/ src/pages/admin/ | head -8
```

Si ya hay un patrón en el proyecto, **usar ese**. Si no, CSV con `Blob` y `<a
download>`, que no agrega dependencias.

- [ ] **Paso 2: Escribir el helper con su prueba**

```js
// tests/integration/panel-exportar.test.js
import { describe, it, expect } from "vitest";
import { aCSV } from "../../src/lib/panel-exportar";

describe("aCSV", () => {
  it("escapa las comas y las comillas de los nombres", () => {
    const csv = aCSV(
      [{ nombre: 'FILTRO 1/2", ROSCA', total: 1000 }],
      [
        { clave: "nombre", titulo: "Producto" },
        { clave: "total", titulo: "Total" },
      ],
    );
    expect(csv).toContain('"FILTRO 1/2"", ROSCA"');
  });

  it("pone los titulos en la primera fila", () => {
    const csv = aCSV([], [{ clave: "a", titulo: "Columna A" }]);
    expect(csv.split("\n")[0]).toBe("Columna A");
  });
});
```

Los nombres de producto de esta empresa traen comillas y comas (`FILTRO 1/2"`),
que es exactamente lo que rompe un CSV mal escapado.

- [ ] **Paso 3: Botón de exportar en cada sección y en el detalle**, que exporta
      **lo que se ve**, con el rango aplicado en el nombre del archivo:
      `panel-perdidas-2026-09-01-a-2026-09-30.csv`.

- [ ] **Paso 4: Verificar y commitear**

```bash
npm test && npm run lint && npm run build
git add src/lib/panel-exportar.js src/components/panel/ tests/integration/panel-exportar.test.js
git commit -m "feat(panel): exportar a CSV lo que se ve en pantalla"
```

---

### Tarea E4: Cierre — la revisión que no hace ninguna prueba

- [ ] **Paso 1: Ningún color fijo**

```js
// tests/integration/panel-tokens.test.js
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Regla #1 del sistema de diseño: nunca hardcodear colores. Una librería de
 * gráficos es justo donde tienta romperla, así que aquí se vuelve automático.
 */
describe("el panel no usa colores fijos", () => {
  const dir = "src/components/panel";
  const archivos = readdirSync(dir).filter((f) => f.endsWith(".jsx"));

  for (const f of archivos) {
    it(`${f} solo usa tokens`, () => {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src).not.toMatch(/className="[^"]*\bbg-(?!transparent)[a-z]+-\d/);
      expect(src).not.toMatch(
        /className="[^"]*\btext-(?:gray|red|green|blue|slate)-\d/,
      );
    });
  }
});
```

Correr y arreglar lo que salga.

- [ ] **Paso 2: Anchos reales**

Abrir el panel a **360 px**, **768 px** y escritorio. Buscar montos que se
salgan, tablas que desborden el ancho de la página (deben rodar dentro de su
propio contenedor, no mover la página entera) y chips que se apilen feo.

Es lo que atrapó el desbordamiento de la tirilla POS.

- [ ] **Paso 3: Con datos de verdad**

Abrir con el rango de todo el histórico (desde el 1 de junio). Los nombres
largos de producto y los montos de ocho cifras son los que rompen los diseños,
no los datos de ejemplo.

- [ ] **Paso 4: Los cuatro estados, a ojo**

- Cargando: cortar la red en las herramientas del navegador y recargar.
- Vacío: elegir un rango sin ventas (por ejemplo, un domingo).
- Error: apagar la red y pulsar Actualizar. Cada sección debe fallar sola y
  poder reintentarse sola.
- Sin permiso: entrar con una vendedora. Las secciones de costo deben
  **explicar**, no dar error ni salir vacías.

- [ ] **Paso 5: Modo oscuro**

Alternar el tema con el panel abierto. Prestar atención al calendario de
`react-day-picker` y a las series de recharts, que son los dos sitios donde una
librería mete su propia paleta.

- [ ] **Paso 6: El bundle no creció para quien no usa el panel**

```bash
npm run build && ls -la dist/assets/*.js | awk '{printf "%.0f KB  %s\n", $5/1024, $NF}' | sort -rn | head -8
```

El archivo principal tiene que seguir **por debajo** del valor que dejó la Tarea
A1, y recharts y react-day-picker deben estar en el trozo del panel, no en el
principal. Comprobar con `grep -l recharts dist/assets/*.js`.

- [ ] **Paso 7: Advisors**

`mcp__supabase__get_advisors` con `type: "security"` y con `type: "performance"`.
Comparar el conteo total contra el de antes de empezar y filtrar los propios:

```bash
python -c "
import json,collections,re
d=json.load(open(r'<ruta que devuelve la herramienta>'))
ls=d['result']['lints']
print('total:',len(ls))
mios=[l for l in ls if 'panel_' in l.get('detail','') or 'categorias_gasto' in l.get('detail','') or 'clasificar_egresos' in l.get('detail','')]
print('mios:',len(mios))
for m in mios: print(' -',m['level'],m['name'],'|',m['detail'])
"
```

Lo esperado es que las RPC nuevas salgan en
`authenticated_security_definer_function_executable` —es el patrón correcto,
son RPC para usuarios autenticados— y **en ninguna** de las de `anon`.

- [ ] **Paso 8: Verificación manual del usuario**

Pedirle a quien decide que recorra esto:

1. Abrir el panel y cambiar entre los ocho atajos. La frase de abajo tiene que
   cambiar siempre y decir la verdad.
2. Elegir un rango personalizado a mano.
3. Pulsar Actualizar: el ícono gira y el "hace X" se reinicia.
4. Comprobar que la cascada cierra: margen = ventas − costo, resultado = margen
   − gastos.
5. Pulsar "Vendido bajo costo" y llegar desde ahí hasta una venta concreta.
6. Cambiar la dimensión de composición y verificar que la columna de venta suma
   lo mismo que las Ventas netas.
7. Clasificar un grupo de egresos y ver que el aviso de la cascada baja.
8. Entrar con una vendedora y confirmar que no ve margen ni costos.

- [ ] **Paso 9: Merge y push a los dos repos**

```bash
npm test && npm run build
git checkout main && git merge --no-ff <rama>
git push origin main
git push cdv-cali main
```

---

## Lo que este plan NO hace

**No toca el Dashboard actual.** Se queda con las alertas, las OT y las
cotizaciones por vencer, que son útiles y responden otra pregunta. Si después se
decide fusionarlos, será con el panel nuevo ya probado.

**No calcula comisiones ni metas.** El panel muestra el desempeño por vendedora;
liquidar comisiones tiene reglas que nadie ha definido.

**No proyecta.** Con 4 meses de datos, cualquier pronóstico sería inventado.

**No es contabilidad.** Es un panel de gestión: no maneja depreciación,
causación ni cierres contables.

## Resumen de lo que se toca

| Capa       | Qué cambia                                          | Tareas                   |
| ---------- | --------------------------------------------------- | ------------------------ |
| Bundle     | lazy en las rutas pesadas de admin                  | A1                       |
| Esquema    | `categorias_gasto` + `compras.categoria_gasto_id`   | B1                       |
| RPC nuevas | 7 (`fn_panel_*` y `fn_clasificar_egresos`)          | B2, C1-C3, D1, E1        |
| Rutas      | `/admin/panel` y `/admin/egresos`, las dos con lazy | A4, B3                   |
| Frontend   | 2 páginas y 9 componentes nuevos                    | A3-A4, B3, C4-C5, D2, E2 |
| Existente  | `App.jsx`, `admin-shell-ui.js`, `CompraNueva.jsx`   | A1, A4, B3, B4           |

**Lo que no cambia:** ninguna función de dinero que ya existe. El panel solo
lee. La única escritura que agrega es la categoría de un egreso, que es un campo
nuevo y no toca ningún total. Por eso esta funcionalidad **no puede descuadrar
la caja**: no hay un solo camino en el que escriba plata.
