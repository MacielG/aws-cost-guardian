# Script para criar ZIP do Lambda com handler-simple.js
Write-Host "Preparando Lambda deployment package..." -ForegroundColor Green

# Criar diretório temporário
$tempDir = "G:\aws-cost-guardian\lambda-package-temp"
if (Test-Path $tempDir) {
    Remove-Item -Recurse -Force $tempDir
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

# Copiar arquivos necessários
Write-Host "Copiando arquivos..." -ForegroundColor Yellow
Copy-Item "G:\aws-cost-guardian\backend\handler-simple.js" "$tempDir\handler-simple.js"
Copy-Item "G:\aws-cost-guardian\backend\package.json" "$tempDir\package.json"

# Instalar dependências
Write-Host "Instalando dependências (isso pode demorar alguns minutos)..." -ForegroundColor Yellow
Set-Location $tempDir
npm install --production --no-optional 2>&1 | Out-Null

# Criar ZIP
Write-Host "Criando arquivo ZIP..." -ForegroundColor Yellow
$zipPath = "G:\aws-cost-guardian\lambda-deployment.zip"
if (Test-Path $zipPath) {
    Remove-Item $zipPath
}

# Comprimir todos os arquivos
Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -CompressionLevel Optimal

# Limpar diretório temporário
Remove-Item -Recurse -Force $tempDir

# Mostrar informações
$zipSize = (Get-Item $zipPath).Length / 1MB
Write-Host "`n✅ ZIP criado com sucesso!" -ForegroundColor Green
Write-Host "📁 Arquivo: $zipPath" -ForegroundColor Cyan
Write-Host "📊 Tamanho: $([math]::Round($zipSize, 2)) MB" -ForegroundColor Cyan
Write-Host "`n📋 PRÓXIMOS PASSOS:" -ForegroundColor Yellow
Write-Host "1. No console AWS Lambda, clique em 'Upload from' > '.zip file'" -ForegroundColor White
Write-Host "2. Selecione o arquivo: lambda-deployment.zip" -ForegroundColor White
Write-Host "3. Clique em 'Save'" -ForegroundColor White
Write-Host "4. Em 'Runtime settings', clique em 'Edit'" -ForegroundColor White
Write-Host "5. Altere Handler para: handler-simple.app" -ForegroundColor White
Write-Host "6. Clique em 'Save'" -ForegroundColor White
