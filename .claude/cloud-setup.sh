#!/bin/bash
# Setup script para Claude Code on the web (claude.ai/code)
#
# INSTRUCCIONES:
# 1. Ve a https://claude.ai/code
# 2. Abre la configuracion del environment de este proyecto
# 3. Copia el contenido de este archivo en el campo "Setup script"
# 4. En "Environment variables" agrega:
#      SUPABASE_PROJECT_REF=<tu-project-ref>
#      SUPABASE_ACCESS_TOKEN=<tu-personal-access-token>
#
# Este script corre UNA VEZ cuando se crea el environment (despues se cachea).

set -e

echo "[cloud-setup] Instalando dependencias del frontend..."
cd compresores-app
npm install
cd ..

echo "[cloud-setup] Instalando Supabase CLI..."
npm install -g supabase || true

echo "[cloud-setup] Instalando gh CLI..."
apt-get update -qq && apt-get install -y -qq gh || true

echo "[cloud-setup] Listo."
