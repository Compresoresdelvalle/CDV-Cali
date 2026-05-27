import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../lib/theme";

// Botón de modo claro/oscuro. Pensado para los topbars oscuros (icono blanco).
export default function ThemeToggle() {
  const theme = useTheme((s) => s.theme);
  const toggle = useTheme((s) => s.toggle);
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      title={isDark ? "Modo claro" : "Modo oscuro"}
      className="focus-ring grid h-9 w-9 place-items-center rounded-md text-white/85 hover:bg-white/10"
    >
      {isDark ? (
        <Sun className="h-4 w-4" strokeWidth={1.75} />
      ) : (
        <Moon className="h-4 w-4" strokeWidth={1.75} />
      )}
    </button>
  );
}
