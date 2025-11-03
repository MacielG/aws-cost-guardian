<#
Coleta eventos do CloudWatch Logs para um log group e período recente.
Uso: .\scripts\get-cloudwatch-logs.ps1 -LogGroupName "/aws/lambda/aws-cost-guardian-backend-prod-api" -Minutes 30
Requer AWS CLI configurado (perfil/default) e jq se quiser filtrar localmente.
#>
param(
    [Parameter(Mandatory=$true)]
    [string]$LogGroupName,
    [int]$Minutes = 30,
    [int]$Limit = 200
)

# Convertendo tempo para milissegundos epoch
# Use inteiro 64-bit para evitar overflow em valores de epoch em ms
$start = [long][math]::Floor((Get-Date).AddMinutes(-$Minutes).ToUniversalTime().Subtract((Get-Date "1970-01-01")).TotalMilliseconds)
Write-Host "Coletando logs de $LogGroupName desde os últimos $Minutes minutos (start-time: $start)" -ForegroundColor Cyan

$cmd = "aws logs filter-log-events --log-group-name `"$LogGroupName`" --start-time $start --limit $Limit --output json"
Write-Host "Executando: $cmd" -ForegroundColor DarkGray

try {
    $json = Invoke-Expression $cmd | Out-String
    if (-not $json) { Write-Host "Nenhuma saída do comando AWS CLI." -ForegroundColor Yellow; exit 1 }
    # Salvar em arquivo timestamped
    $outFile = Join-Path -Path $PWD -ChildPath ("cloudwatch-logs-$(Get-Date -Format yyyyMMdd-HHmmss).json")
    $json | Out-File -FilePath $outFile -Encoding utf8
    Write-Host "Logs salvos em: $outFile" -ForegroundColor Green
    Write-Host "Exibindo os 2000 primeiros caracteres para fácil cópia..." -ForegroundColor Cyan
    Write-Host ($json.Substring(0, [math]::Min(2000, $json.Length)))
} catch {
    Write-Host "Erro ao executar AWS CLI: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Certifique-se que aws CLI está instalado e configurado com credenciais/region corretas." -ForegroundColor Yellow
}
