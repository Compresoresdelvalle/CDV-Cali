# Reinstalar Claude Code — Plugins, Skills y Marketplaces

> Guía para dejar el terminal igual que antes tras reinstalar Claude Code.
> Generada: **2026-05-17**.

---

## ⚠️ ANTES QUE NADA — LEE ESTO

**Reinstalar el paquete de Claude Code NO borra la carpeta `~/.claude/`.**
Esa carpeta (`C:\Users\davi-\.claude\`) guarda tus plugins, skills, settings y
credenciales — vive aparte del paquete npm. Si solo reinstalas Claude Code
(`npm`), **todo esto sobrevive y no tienes que reinstalar nada.**

Solo pierdes los plugins/skills si:

- Borras manualmente `~/.claude/`, o
- Cambias de PC / de usuario de Windows.

### ✅ Lo más seguro: HAZ UN BACKUP de la carpeta antes de tocar nada

Copia estas 2 carpetas a un lugar seguro (USB, Drive, etc.):

```
C:\Users\davi-\.claude\skills\      ← tus skills (incluye las CUSTOM de CSC)
C:\Users\davi-\.claude\plugins\     ← plugins y marketplaces
```

Opcional pero recomendado, copia también:

```
C:\Users\davi-\.claude\settings.json
```

Con ese backup, restaurar = pegar las carpetas de vuelta. Cero reinstalación.

---

## 1. Marketplaces (6) — comandos para re-agregarlos

Dentro de Claude Code, ejecuta:

```
/plugin marketplace add https://github.com/anthropics/claude-plugins-official.git
/plugin marketplace add https://github.com/anthropics/claude-code.git
/plugin marketplace add https://github.com/obra/superpowers.git
/plugin marketplace add https://github.com/affaan-m/everything-claude-code.git
/plugin marketplace add mksglu/context-mode
/plugin marketplace add https://github.com/quant-sentiment-ai/claude-equity-research.git
```

| Marketplace                        | Repo                                                 |
| ---------------------------------- | ---------------------------------------------------- |
| claude-plugins-official            | github.com/anthropics/claude-plugins-official        |
| claude-code-plugins                | github.com/anthropics/claude-code                    |
| superpowers-dev                    | github.com/obra/superpowers                          |
| everything-claude-code             | github.com/affaan-m/everything-claude-code           |
| context-mode                       | github.com/mksglu/context-mode                       |
| claude-equity-research-marketplace | github.com/quant-sentiment-ai/claude-equity-research |

---

## 2. Plugins instalados (10) — comandos para reinstalarlos

```
/plugin install superpowers@superpowers-dev
/plugin install frontend-design@claude-code-plugins
/plugin install everything-claude-code@everything-claude-code
/plugin install context-mode@context-mode
/plugin install claude-code-setup@claude-plugins-official
/plugin install netlify-skills@claude-plugins-official
/plugin install code-review@claude-plugins-official
/plugin install commit-commands@claude-plugins-official
/plugin install skill-creator@claude-plugins-official
/plugin install context7@claude-plugins-official
```

| Plugin                 | Marketplace             | Versión instalada |
| ---------------------- | ----------------------- | ----------------- |
| superpowers            | superpowers-dev         | 5.0.6             |
| frontend-design        | claude-code-plugins     | 1.0.0             |
| everything-claude-code | everything-claude-code  | 1.9.0             |
| context-mode           | context-mode            | 1.0.75            |
| claude-code-setup      | claude-plugins-official | 1.0.0             |
| netlify-skills         | claude-plugins-official | 1.1.0             |
| code-review            | claude-plugins-official | (commit 183a6ca)  |
| commit-commands        | claude-plugins-official | (commit 183a6ca)  |
| skill-creator          | claude-plugins-official | (commit 183a6ca)  |
| context7               | claude-plugins-official | (commit 183a6ca)  |

> **Nota:** la mayoría de los "namespaces" de skills que ves en Claude
> (`everything-claude-code:*`, `superpowers:*`, `netlify-skills:*`,
> `context-mode:*`, etc.) vienen de estos 10 plugins. Reinstalando los plugins
> recuperas todas esas skills automáticamente.
>
> El plugin `everything-claude-code` es el más grande — trae cientos de skills
> y agentes. `claude-code-setup` trae el setup de Cowork (roles design/finance/
> engineering/marketing/operations/data/etc.).

> Hubo además un plugin `trading-ideas@claude-equity-research-marketplace`
> instalado en algún momento (aparece en los manifests) pero **no está activo**
> ahora. Reinstálalo solo si lo quieres:
> `/plugin install trading-ideas@claude-equity-research-marketplace`

---

## 3. Skills sueltas en `~/.claude/skills/` (24)

Estas NO vienen de plugins — están sueltas en la carpeta. **No guardan de qué
repo salieron**, así que la única forma segura de conservarlas es el **backup
de la carpeta `~/.claude/skills/`** (ver arriba).

### 🔴 CUSTOM — IRREEMPLAZABLES (tuyas, de CSC licitaciones)

Estas las creaste tú; **no se pueden volver a descargar de ningún lado**.
Si no haces backup, se pierden para siempre:

- `csc-evaluador-licitaciones`
- `analizar-pliego`
- `comparar-aliados`
- `cruzar-codigos-unspsc`
- `detectar-pyme`
- `llenar-seguimiento`
- `validar-cronograma`

### ⚪ Públicas / genéricas (se pueden re-conseguir, pero no tengo el repo exacto)

`brandkit`, `design-taste-frontend`, `find-skills`, `full-output-enforcement`,
`gpt-taste`, `high-end-visual-design`, `humanizer`, `image-to-code`,
`imagegen-frontend-mobile`, `imagegen-frontend-web`, `industrial-brutalist-ui`,
`minimalist-ui`, `pdf`, `redesign-existing-projects`, `skill-creator`,
`stitch-design-taste`, `learned` (artefacto auto-generado).

> Para re-buscar las públicas: usa la skill `find-skills` dentro de Claude,
> o el comando `npx skills add <owner>/<repo>`. Pero de nuevo: **el backup de
> la carpeta es lo más rápido y 100% confiable.**

---

## 4. settings.json — ojo con el token

`~/.claude/settings.json` tiene una variable de entorno:

```json
"env": { "GITHUB_TOKEN": "PEGA_TU_NUEVO_TOKEN_AQUI" }
```

Está como placeholder. Si usas un GITHUB_TOKEN real, vuélvelo a pegar ahí
después de reinstalar. NUNCA lo subas a un repo público.

---

## 5. Resumen — pasos para reinstalar limpio

1. **Backup** de `~/.claude/skills/`, `~/.claude/plugins/` y `settings.json`.
2. Reinstala Claude Code.
3. Si la carpeta `~/.claude/` sigue intacta → no haces nada más, todo está.
4. Si se perdió → restaura el backup, **o** ejecuta los comandos de las
   secciones 1 y 2, y pega de vuelta la carpeta `skills/` del backup para
   recuperar las 7 skills custom de CSC.
5. Re-pega el GITHUB_TOKEN en `settings.json` si lo usabas.
