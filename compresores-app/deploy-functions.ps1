# deploy-functions.ps1
# Despliega las 4 Edge Functions al proyecto de Supabase.
#
# Cómo usar:
#   1. Ve a: https://supabase.com/dashboard/account/tokens
#   2. Genera un Personal Access Token
#   3. Ejecuta en PowerShell:
#        $env:SUPABASE_ACCESS_TOKEN = "tu_token_aqui"
#        .\deploy-functions.ps1

$PROJECT_REF = "kbgwygnmhjeyiyyxosmb"
$FUNCTIONS = @("registrar-venta", "registrar-devolucion", "convertir-cotizacion", "procesar-traspaso")

if (-not $env:SUPABASE_ACCESS_TOKEN) {
    Write-Error "SUPABASE_ACCESS_TOKEN no está definido."
    Write-Host "Pasos:"
    Write-Host "  1. Ve a https://supabase.com/dashboard/account/tokens"
    Write-Host "  2. Crea un token"
    Write-Host "  3. Ejecuta: `$env:SUPABASE_ACCESS_TOKEN = 'tu_token'"
    Write-Host "  4. Vuelve a ejecutar este script"
    exit 1
}

Write-Host "=== Desplegando Edge Functions al proyecto $PROJECT_REF ===" -ForegroundColor Cyan

foreach ($fn in $FUNCTIONS) {
    Write-Host ""
    Write-Host ">> Desplegando: $fn" -ForegroundColor Yellow
    npx supabase functions deploy $fn --project-ref $PROJECT_REF --no-verify-jwt
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   OK $fn desplegada" -ForegroundColor Green
    } else {
        Write-Host "   ERROR al desplegar $fn" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "=== Todas las funciones desplegadas ===" -ForegroundColor Green
Write-Host "Ahora ejecuta: npm test"
