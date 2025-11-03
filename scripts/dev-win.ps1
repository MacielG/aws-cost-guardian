<#
Script de ajuda para desenvolvimento no Windows.
- Limpa a pasta .next
- Ajusta variáveis de ambiente para Watchpack/Chokidar usar polling
- Inicia `npm run dev`
Uso: .\scripts\dev-win.ps1
#>
Write-Host "Limpando .next e iniciando dev (polling)" -ForegroundColor Cyan
Try {
    if (Test-Path -Path .next) {
        Write-Host "Removendo .next..." -ForegroundColor Yellow
        Remove-Item -Recurse -Force .next
    }
} catch {
    Write-Host "Falha ao remover .next: $($_.Exception.Message)" -ForegroundColor Red
}

# Set env for the child process only
$env:CHOKIDAR_USEPOLLING = 'true'
$env:WATCHPACK_POLLING = 'true'
$env:CHOKIDAR_INTERVAL = '100'

Write-Host "Variáveis de polling setadas. Iniciando npm run dev..." -ForegroundColor Cyan
npm run dev
