#!/bin/bash
# deploy-functions.sh
# Despliega las 4 Edge Functions al proyecto de Supabase
# Prerrequisito: npx supabase login (solo una vez)

PROJECT_REF="kbgwygnmhjeyiyyxosmb"
FUNCTIONS=(
  "registrar-venta"
  "registrar-devolucion"
  "convertir-cotizacion"
  "procesar-traspaso"
)

echo "=== Desplegando Edge Functions al proyecto $PROJECT_REF ==="

for fn in "${FUNCTIONS[@]}"; do
  echo ""
  echo ">> Desplegando: $fn"
  npx supabase functions deploy "$fn" \
    --project-ref "$PROJECT_REF" \
    --no-verify-jwt=false
  if [ $? -eq 0 ]; then
    echo "   ✓ $fn desplegada exitosamente"
  else
    echo "   ✗ Error al desplegar $fn"
    exit 1
  fi
done

echo ""
echo "=== Todas las funciones desplegadas. Ejecuta: npm test ==="
