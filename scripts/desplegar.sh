#!/usr/bin/env bash
# Despliega main al repo de produccion (remoto cdv-cali) SIN la carpeta .claude.
#
# El repo de jd (origin) conserva .claude; el de despliegue no. Por eso ya no
# sirve "git push cdv-cali main": cdv-cali/main es main + un commit que borra
# .claude. Este script mezcla main encima de cdv-cali/main en un worktree
# temporal, vuelve a borrar .claude si main lo trajo de nuevo y sube el resultado.
#
# Uso (desde la raiz del repo, con main ya commiteado):  bash scripts/desplegar.sh
set -euo pipefail

REMOTO=cdv-cali
TMP="$(mktemp -d)/despliegue"

git fetch -q "$REMOTO" main
git worktree add -q --detach "$TMP" "$REMOTO/main"
trap 'git worktree remove --force "$TMP"' EXIT

cd "$TMP"
# Un conflicto solo puede venir de .claude (lo unico en que difieren); se
# resuelve borrandolo. Cualquier otro conflicto aborta el despliegue.
if ! git merge -q --no-edit main; then
  git rm -r -q --ignore-unmatch .claude
  if [ -n "$(git diff --name-only --diff-filter=U)" ]; then
    echo "Conflicto fuera de .claude: revisa a mano." >&2
    git merge --abort
    exit 1
  fi
  git commit -q --no-edit
fi

if [ -n "$(git ls-files .claude)" ]; then
  git rm -r -q .claude
  git commit -q -m "chore(despliegue): sin carpeta .claude"
fi

git push "$REMOTO" HEAD:main
echo "Desplegado: $(git log -1 --format='%h %s')"
