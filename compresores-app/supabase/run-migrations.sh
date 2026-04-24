#!/usr/bin/env bash
# ============================================================
# run-migrations.sh
# Applies all Phase 1 migrations to Supabase via Management API
#
# Usage:
#   SUPABASE_ACCESS_TOKEN=sbp_xxxx bash supabase/run-migrations.sh
#
# Where to get SUPABASE_ACCESS_TOKEN:
#   https://app.supabase.com/account/tokens
#   (Personal Access Token — NOT the service_role key)
# ============================================================

set -e

PROJECT_REF="kbgwygnmhjeyiyyxosmb"
MIGRATIONS_DIR="$(dirname "$0")/migrations"

if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  echo "ERROR: SUPABASE_ACCESS_TOKEN is not set."
  echo ""
  echo "Get your token at: https://app.supabase.com/account/tokens"
  echo ""
  echo "Then run:"
  echo "  SUPABASE_ACCESS_TOKEN=sbp_xxxx bash supabase/run-migrations.sh"
  exit 1
fi

MIGRATIONS=(
  "20260404000001_fase1_01_extensions_enums_tables.sql"
  "20260404000002_fase1_02_functions_triggers.sql"
  "20260404000003_fase1_03_seed_data.sql"
  "20260404000004_fase1_04_rls_policies.sql"
)

run_sql() {
  local file="$1"
  local sql
  sql=$(cat "$file")

  echo "Applying: $(basename "$file")..."

  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST \
    "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"query\": $(echo "$sql" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | head -n -1)

  if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
    echo "  FAILED (HTTP $HTTP_CODE): $BODY"
    exit 1
  fi

  echo "  OK"
}

echo "==========================================="
echo " Compresores del Valle - Phase 1 Migrations"
echo "==========================================="
echo ""

for migration in "${MIGRATIONS[@]}"; do
  run_sql "$MIGRATIONS_DIR/$migration"
done

echo ""
echo "All migrations applied successfully!"
echo ""
echo "Running verification query..."

VERIFY_SQL="SELECT p.referencia, p.nombre, i.sede_id, i.cantidad, p.stock_minimo, p.stock_maximo, i.estado_stock FROM inventario i JOIN productos p ON p.id = i.producto_id ORDER BY p.referencia, i.sede_id;"

curl -s \
  -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"$VERIFY_SQL\"}" | python3 -m json.tool 2>/dev/null || echo "Verification query done."

echo ""
echo "Done. Check the Supabase Dashboard to confirm."
