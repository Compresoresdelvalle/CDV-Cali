// Tema claro/oscuro global (Zustand).
//
// El modo oscuro es la clase `.dark` en <html> (sistema de diseño de Lovable
// en src/index.css). Persistimos la elección en localStorage y, en la primera
// visita, respetamos la preferencia del sistema operativo.
//
// Anti-parpadeo (FOUC): index.html aplica la clase antes de que cargue React.
// Aquí re-sincronizamos por si ese script no corrió.
import { create } from "zustand";

const STORAGE_KEY = "cdv-theme";

function getInitialTheme() {
  if (typeof window === "undefined") return "light";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* localStorage no disponible (modo privado / bloqueado) */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

const initialTheme = getInitialTheme();
applyTheme(initialTheme);

export const useTheme = create((set, get) => ({
  theme: initialTheme,
  setTheme: (theme) => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore — la preferencia simplemente no se persistirá */
    }
    set({ theme });
  },
  toggle: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
}));
