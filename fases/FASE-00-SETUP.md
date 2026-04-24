# FASE 0: SETUP DEL PROYECTO

## Qué instalar antes en Claude Code (una sola vez)

```bash
npx claude-code-templates@latest \
  --mcp database/supabase \
  --mcp devtools/context7 \
  --skill creative-design/ui-ux-pro-max \
  --skill creative-design/ui-design-system \
  --skill development/senior-frontend \
  --agent development-team/frontend-developer \
  --hook git/pre-commit-validation \
  --yes
```

## Qué decirle a Claude Code

```
Lee CLAUDE.md y fases/FASE-00-SETUP.md. Crea el proyecto completo de React con Vite y Tailwind CSS según las instrucciones. Usa los design tokens del CLAUDE.md para configurar Tailwind. Instala todas las dependencias listadas. Configura la PWA con vite-plugin-pwa. Crea el netlify.toml. Crea la estructura de carpetas completa. No crees componentes todavía, solo la estructura vacía con archivos placeholder.
```

## Instrucciones exactas

### 1. Inicializar proyecto

```bash
npm create vite@latest compresores-app -- --template react
cd compresores-app
npm install
```

### 2. Instalar dependencias

```bash
npm install @supabase/supabase-js zustand react-router-dom qrcode.react html5-qrcode
npm install -D tailwindcss @tailwindcss/vite vite-plugin-pwa
```

### 3. Configurar Tailwind (`tailwind.config.js`)

Usar los design tokens del CLAUDE.md:

```javascript
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#14352A", light: "#1E5740", mid: "#2D7A5A" },
        accent: { DEFAULT: "#C8993E", light: "#DFBA6E" },
        admin: { DEFAULT: "#1A1A2E", accent: "#E94560", bg: "#F5F5FA" },
        surface: { DEFAULT: "#F4F1EB", alt: "#EDE9E0" },
        stock: {
          ok: "#0B8A57",
          low: "#C47F17",
          out: "#C0392B",
          info: "#2563EB",
        },
      },
      fontFamily: {
        sans: ["'Segoe UI'", "'SF Pro Display'", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
};
```

### 4. Configurar Vite (`vite.config.js`)

```javascript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Compresores del Valle - Gestión",
        short_name: "CDV Gestión",
        start_url: "/",
        display: "standalone",
        background_color: "#F4F1EB",
        theme_color: "#14352A",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
});
```

### 5. Crear cliente Supabase (`src/lib/supabase.js`)

```javascript
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

### 6. Crear `.env.local`

```
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key-aqui
```

### 7. Crear `netlify.toml`

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### 8. Crear estructura de carpetas

```
src/
├── lib/supabase.js
├── lib/constants.js      # (vacío, se llena en Fase 2)
├── lib/utils.js           # (vacío)
├── stores/                # (vacía)
├── hooks/                 # (vacía)
├── components/layout/     # (vacía)
├── components/ui/         # (vacía)
├── components/forms/      # (vacía)
├── components/qr/         # (vacía)
├── pages/ops/             # (vacía)
├── pages/admin/           # (vacía)
├── pages/Login.jsx        # (placeholder: return <div>Login</div>)
└── App.jsx                # (placeholder con BrowserRouter vacío)
```

### 9. Crear iconos PWA placeholder

Crear `public/icons/` con archivos `icon-192.png` e `icon-512.png` (pueden ser placeholder verdes con las iniciales "CDV").

### 10. Git init

```bash
git init
echo "node_modules\n.env.local\ndist" > .gitignore
git add .
git commit -m "Fase 0: Setup proyecto Vite + React + Tailwind + Supabase + PWA"
```

## Criterios de aceptación

- [ ] `npm run dev` abre la app sin errores
- [ ] Los colores de Tailwind funcionan (probar `bg-primary` muestra verde oscuro)
- [ ] El archivo `.env.local` existe con las variables de Supabase
- [ ] `netlify.toml` existe en la raíz
- [ ] La estructura de carpetas está completa
- [ ] `git log` muestra el commit de Fase 0
