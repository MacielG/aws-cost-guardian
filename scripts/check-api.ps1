<#
PowerShell script de verificação rápida dos endpoints públicos do backend.
Uso: .\scripts\check-api.ps1 -ApiHost "0s4kvds1a2.execute-api.us-east-1.amazonaws.com" -Stage prod
Require: AWS CLI configured if you want to use CloudWatch helper scripts later.
#>
param(
    [Parameter(Mandatory=$true)]
    [string]$ApiHost,
    [string]$Stage = 'prod'
)

$base = "https://$ApiHost/$Stage"
Write-Host "Verificando API base: $base" -ForegroundColor Cyan

$endpoints = @(
    '/api/health',
    '/api/incidents',
    '/billing/summary',
    '/recommendations?limit=5',
    '/api/user/status',
    '/api/dashboard/costs'
)

foreach ($ep in $endpoints) {
    $url = "$base$ep"
    Write-Host "\n--- $url" -ForegroundColor Yellow
    try {
        $resp = Invoke-WebRequest -Method Get -Uri $url -Headers @{ Origin='http://localhost:3000' } -UseBasicParsing -TimeoutSec 20
        Write-Host "Status: $($resp.StatusCode)" -ForegroundColor Green
        foreach ($h in $resp.Headers.GetEnumerator()) {
            if ($h.Name -match 'Access-Control') { Write-Host "$($h.Name): $($h.Value)" }
        }
        # Show small body preview
        $body = $resp.Content
        if ($body.Length -gt 500) { $preview = $body.Substring(0,500) + '...'; } else { $preview = $body }
        Write-Host "Body preview:\n$preview" -ForegroundColor DarkGray
    } catch {
        Write-Host "Erro: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.Exception.Response) {
            try {
                $r = $_.Exception.Response
                $status = $r.StatusCode.Value__
                Write-Host "Status: $status" -ForegroundColor Red
                $stream = $r.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream)
                $text = $reader.ReadToEnd()
                Write-Host "Response body:\n$text" -ForegroundColor DarkGray
            } catch { }
        }
    }
}

Write-Host "\nVerificação concluída." -ForegroundColor Cyan
Write-Host "Se receber 502/500, execute o script scripts/get-cloudwatch-logs.ps1 para coletar logs da Lambda." -ForegroundColor Yellow
