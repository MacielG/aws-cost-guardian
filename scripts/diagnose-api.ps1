<#
Diagnóstico automático para API Gateway + Lambda

Uso:
  .\scripts\diagnose-api.ps1 -ApiId 0s4kvds1a2 -RequestId ff79a5db-e4bc-47e0-945d-a89e981a7333 -Region us-east-1

O script faz:
 - valida credenciais (sts get-caller-identity)
 - calcula um start-time seguro (inteiro ms)
 - coleta resources da REST API e imprime URIs de integração
 - extrai ARNs de Lambda das URIs de integração
 - lista log-groups que parecem corresponder ao ApiHandler
 - busca eventos de CloudWatch filtrando pelo RequestId (se fornecido)

Requisitos: AWS CLI configurado e permissões para apigateway, lambda e logs.
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$ApiId,
    [Parameter(Mandatory=$false)]
    [string]$RequestId = '',
    [string]$Region = 'us-east-1',
    [int]$Minutes = 60,
    [switch]$ScanAll
)

Write-Host "Região: $Region" -ForegroundColor Cyan

try {
    $identity = aws sts get-caller-identity --region $Region | ConvertFrom-Json
    Write-Host "Conta AWS: $($identity.Account)  Arn: $($identity.Arn)" -ForegroundColor Green
} catch {
    Write-Host "Erro ao obter identidade AWS. Verifique aws configure / perfil." -ForegroundColor Red
    throw $_
}

$start = [long][math]::Floor((Get-Date).AddMinutes(-$Minutes).ToUniversalTime().Subtract((Get-Date "1970-01-01")).TotalMilliseconds)
Write-Host "Procurando logs a partir de (ms epoch): $start (últimos $Minutes minutos)" -ForegroundColor Cyan

Write-Host "\n1) Obtendo resources da REST API $ApiId..." -ForegroundColor Cyan
try {
    $resourcesJson = aws apigateway get-resources --rest-api-id $ApiId --region $Region --output json
} catch {
    Write-Host "Falha ao obter resources da API: $($_.Exception.Message)" -ForegroundColor Red
    throw $_
}

$resources = $resourcesJson | ConvertFrom-Json
$uris = @()
if ($resources.items) {
    foreach ($r in $resources.items) {
        if ($r.resourceMethods) {
            foreach ($m in $r.resourceMethods.Keys) {
                $meth = $r.resourceMethods.$m
                if ($meth.methodIntegration -and $meth.methodIntegration.uri) { $uris += $meth.methodIntegration.uri }
                elseif ($meth.integration -and $meth.integration.uri) { $uris += $meth.integration.uri }
            }
        }
    }
}

$uris = $uris | Sort-Object -Unique
if (-not $uris) { Write-Host "Nenhuma URI de integração encontrada." -ForegroundColor Yellow } else {
    Write-Host "Integrações encontradas:" -ForegroundColor Green
    $uris | ForEach-Object { Write-Host " - $_" }
}

Write-Host "\n2) Extraindo possíveis ARNs de Lambda das URIs..." -ForegroundColor Cyan
$lambdaArns = @()
foreach ($u in $uris) {
    if ($u -match 'functions/(arn:aws:lambda:[^/]+/function:[^/]+)/invocations') {
        $lambdaArns += $Matches[1]
    } elseif ($u -match 'arn:aws:lambda:[^:]+:[0-9]+:function:[^/]+') {
        # direto
        if ($u -match '(arn:aws:lambda:[^/]+:function:[^/]+)') { $lambdaArns += $Matches[1] }
    }
}

$lambdaArns = $lambdaArns | Sort-Object -Unique
if (-not $lambdaArns) { Write-Host "Nenhum ARN de Lambda extraído das integrações." -ForegroundColor Yellow } else {
    Write-Host "Lambdas integradas (ARNs):" -ForegroundColor Green
    $lambdaArns | ForEach-Object { Write-Host " - $_" }
}

Write-Host "\n3) Listando log-groups relacionados ao ApiHandler (padrão do CDK)..." -ForegroundColor Cyan
$lgMatches = aws logs describe-log-groups --log-group-name-prefix "/aws/lambda" --region $Region --output json | ConvertFrom-Json
$candidates = @()
foreach ($g in $lgMatches.logGroups) {
    if ($g.logGroupName -match 'ApiHandler') { $candidates += $g.logGroupName }
}

if (-not $candidates) {
    Write-Host "Nenhum log-group específico ApiHandler encontrado. Mostrando top 20 log-groups /aws/lambda..." -ForegroundColor Yellow
    ($lgMatches.logGroups | Select-Object -First 20).logGroupName | ForEach-Object { Write-Host " - $_" }
} else {
    Write-Host "Log-groups candidatos:" -ForegroundColor Green
    $candidates | ForEach-Object { Write-Host " - $_" }
}

if ($RequestId) {
    Write-Host "\n4) Buscando eventos contendo RequestId $RequestId nos log-groups candidatos..." -ForegroundColor Cyan
    $foundAny = $false
    $groupsToSearch = if ($ScanAll) { ($lgMatches.logGroups | ForEach-Object { $_.logGroupName }) } else { ($candidates | Sort-Object -Unique) }

    if ($ScanAll) { Write-Host "ScanAll ligado: vou buscar em todos os log-groups /aws/lambda (isso pode gerar muito output)..." -ForegroundColor Yellow }

    foreach ($lg in $groupsToSearch) {
        Write-Host "`n-- Procurando em:" $lg -ForegroundColor DarkCyan
        try {
            $out = aws logs filter-log-events --log-group-name $lg --filter-pattern $RequestId --start-time $start --limit 200 --region $Region --output json
            $obj = $out | ConvertFrom-Json
            if ($obj.events.Count -gt 0) {
                Write-Host ("Encontrados {0} eventos em {1}:" -f $obj.events.Count, $lg) -ForegroundColor Green
                $obj.events | ForEach-Object { Write-Host $_.message }
                $foundAny = $true
            } else { Write-Host ("Nenhum evento com o RequestId em {0}." -f $lg) -ForegroundColor Yellow }
        } catch {
            Write-Host ("Erro ao consultar {0}: {1}" -f $lg, $_.Exception.Message) -ForegroundColor Red
        }
    }
    if (-not $foundAny) { Write-Host "Não localizei o RequestId nos log-groups candidatos. Tente expandir o prefix ou buscar outros log-groups." -ForegroundColor Yellow }
} else {
    Write-Host "RequestId não fornecido; pulando busca por RequestId. Forneça -RequestId para filtrar" -ForegroundColor Yellow
}

Write-Host "\nFinalizado. Se quiser, rode novamente com -RequestId para buscar por um request específico." -ForegroundColor Cyan
