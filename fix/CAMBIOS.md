# Fix: navegación móvil — AppShell.jsx

Reemplaza `src/components/layout/AppShell.jsx` por la versión de esta carpeta.

## Qué arregla

1. **Acceso completo en celular (P0).** Nuevo drawer "Más" (hoja inferior) con
   TODOS los módulos del rol agrupados por sección + Panel Admin + búsqueda
   global. Se abre desde el 5º botón de la barra inferior o tocando el avatar
   del header. La cobertura sube del 29–50% al 100%.
2. **`buildBottomNav` reescrito (P1).** Siempre 5 columnas, FAB centrado en el
   índice 2, el módulo del FAB ya no se repite como ítem, claves únicas por
   `id`, y relleno con spacers si el rol tuviera <2 destinos.
3. **Header móvil con search / alertas / sede (P1).** Campana con contador de
   stock bajo/agotado, chip de sede activa y búsqueda global (dentro del
   drawer). El logout se movió al drawer.
4. **FAB al ras (sin sobresalir).** La acción primaria ya no flota sobre la
   barra (`-top-5`): va dentro de la barra, resaltada con un chip claro. No
   tapa contenido y se ve más limpio.
5. **Safe-areas iOS/Android.** Header con `env(safe-area-inset-top)` (notch) y
   barra inferior con `env(safe-area-inset-bottom)` (indicador de gestos), para
   que no se solapen con el chrome del sistema en iPhone/Android.

No cambia el comportamiento de escritorio (sidebar + topbar intactos) ni
ninguna ruta. Sin dependencias nuevas (usa lucide `X`, ya disponible).

## Crear la rama y aplicar

```bash
# desde la raíz del repo, en main actualizado
git checkout -b fix/navegacion-movil

# copia el archivo corregido sobre el original
cp ruta/al/fix/src/components/layout/AppShell.jsx src/components/layout/AppShell.jsx

git add src/components/layout/AppShell.jsx
git commit -m "fix(móvil): drawer Más con acceso completo + barra inferior de 5 columnas con FAB centrado"
git push -u origin fix/navegacion-movil
```

Luego abre el Pull Request de `fix/navegacion-movil` → `main` en GitHub.

## Probar

- Inicia sesión con cada rol y verifica que desde el drawer "Más" se llega a
  todos sus módulos, incluido el Panel Admin (rol Admin).
- Confirma que el FAB queda centrado y que el Técnico ya no muestra una columna
  vacía.
