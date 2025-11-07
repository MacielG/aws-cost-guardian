# Script para executar testes com autenticacao
$env:TEST_USER_EMAIL = "testuser@awscostguardian.com"
$env:TEST_USER_PASSWORD = "TestUser123!"
$env:TEST_ADMIN_EMAIL = "testadmin@awscostguardian.com"
$env:TEST_ADMIN_PASSWORD = "TestAdmin123!"

Write-Host "Executando testes de integracao completos..." -ForegroundColor Cyan
node test-production-integration.js
