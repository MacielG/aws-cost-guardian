# Script RÁPIDO para criar ZIP do Lambda
Write-Host "Preparando Lambda package (modo rápido)..." -ForegroundColor Green

$backendDir = "G:\aws-cost-guardian\backend"
$zipPath = "G:\aws-cost-guardian\lambda-deployment.zip"

# Remover ZIP antigo se existir
if (Test-Path $zipPath) {
    Remove-Item $zipPath
}

# Criar ZIP com os arquivos do backend
Write-Host "Criando ZIP..." -ForegroundColor Yellow
Set-Location $backendDir

# Comprimir handler-simple.js, package.json e node_modules
Compress-Archive -Path "handler-simple.js","package.json","node_modules" -DestinationPath $zipPath -CompressionLevel Fastest

$zipSize = (Get-Item $zipPath).Length / 1MB
Write-Host "`n✅ ZIP criado!" -ForegroundColor Green
Write-Host "📁 Local: $zipPath" -ForegroundColor Cyan
Write-Host "📊 Tamanho: $([math]::Round($zipSize, 2)) MB`n" -ForegroundColor Cyan

Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "  PASSO A PASSO NO CONSOLE AWS LAMBDA" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════`n" -ForegroundColor Yellow

Write-Host "1️⃣  FAZER UPLOAD DO ZIP:" -ForegroundColor Cyan
Write-Host "   • Clique no botão 'Upload from' (lado direito)" -ForegroundColor White
Write-Host "   • Selecione '.zip file'" -ForegroundColor White
Write-Host "   • Escolha: lambda-deployment.zip" -ForegroundColor Green
Write-Host "   • Clique 'Save'`n" -ForegroundColor White

Write-Host "2️⃣  ALTERAR O HANDLER (IMPORTANTE!):" -ForegroundColor Cyan
Write-Host "   • Role para baixo até 'Runtime settings'" -ForegroundColor White
Write-Host "   • Clique em 'Edit'" -ForegroundColor White
Write-Host "   • Altere Handler de:" -ForegroundColor White
Write-Host "     handler.app" -ForegroundColor Red
Write-Host "     para:" -ForegroundColor White
Write-Host "     handler-simple.app" -ForegroundColor Green
Write-Host "   • Clique 'Save'`n" -ForegroundColor White

Write-Host "3️⃣  TESTAR:" -ForegroundColor Cyan
Write-Host "   • Vá para aba 'Test'" -ForegroundColor White
Write-Host "   • Crie um novo test event com:" -ForegroundColor White
Write-Host '     {"path":"/api/public/metrics","httpMethod":"GET"}' -ForegroundColor Green
Write-Host "   • Clique 'Test'" -ForegroundColor White
Write-Host "   • Deve retornar status 200 com métricas`n" -ForegroundColor White

Write-Host "═══════════════════════════════════════════════════════`n" -ForegroundColor Yellow
