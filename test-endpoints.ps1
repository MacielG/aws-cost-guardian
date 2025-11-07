# Script de teste dos endpoints atualizados
$API_URL = "https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod"

Write-Host "=== Testando Endpoints Atualizados ===" -ForegroundColor Green

# 1. Health Check
Write-Host "`n1. Testando Health Check..." -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$API_URL/health" -Method Get
    Write-Host "✓ Health Check OK" -ForegroundColor Green
    $response | ConvertTo-Json
} catch {
    Write-Host "✗ Health Check FALHOU" -ForegroundColor Red
    Write-Host $_.Exception.Message
}

# 2. Public Metrics
Write-Host "`n2. Testando Public Metrics..." -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$API_URL/api/public/metrics" -Method Get
    Write-Host "✓ Public Metrics OK" -ForegroundColor Green
    $response | ConvertTo-Json
} catch {
    Write-Host "✗ Public Metrics FALHOU" -ForegroundColor Red
    Write-Host $_.Exception.Message
}

# 3. Endpoint protegido (deve retornar 401 sem auth)
Write-Host "`n3. Testando endpoint protegido /api/user/status (deve retornar 401)..." -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$API_URL/api/user/status" -Method Get -ErrorAction Stop
    Write-Host "✗ Deveria ter retornado 401" -ForegroundColor Red
} catch {
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Host "✓ Endpoint protegido corretamente (401)" -ForegroundColor Green
    } else {
        Write-Host "✗ Status inesperado: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    }
}

# 4. Billing Summary (protegido)
Write-Host "`n4. Testando /billing/summary (deve retornar 401)..." -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$API_URL/billing/summary" -Method Get -ErrorAction Stop
    Write-Host "✗ Deveria ter retornado 401" -ForegroundColor Red
} catch {
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Host "✓ Endpoint protegido corretamente (401)" -ForegroundColor Green
    } else {
        Write-Host "✗ Status inesperado: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    }
}

# 5. Dashboard Costs (protegido)
Write-Host "`n5. Testando /api/dashboard/costs (deve retornar 401)..." -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$API_URL/api/dashboard/costs" -Method Get -ErrorAction Stop
    Write-Host "✗ Deveria ter retornado 401" -ForegroundColor Red
} catch {
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Host "✓ Endpoint protegido corretamente (401)" -ForegroundColor Green
    } else {
        Write-Host "✗ Status inesperado: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    }
}

Write-Host "`n=== Testes Concluidos ===" -ForegroundColor Green
