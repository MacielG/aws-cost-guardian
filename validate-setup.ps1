# AWS Cost Guardian - Validacao Pre-Deploy (Windows PowerShell)

Write-Host "AWS Cost Guardian - Validacao Pre-Deploy" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$script:Errors = 0
$script:Warnings = 0

function Check-Command {
    param ([string]$CommandName)
    
    if (Get-Command $CommandName -ErrorAction SilentlyContinue) {
        Write-Host "[OK] $CommandName instalado" -ForegroundColor Green
        return $true
    }
    else {
        Write-Host "[ERRO] $CommandName nao encontrado" -ForegroundColor Red
        $script:Errors++
        return $false
    }
}

function Check-AWSCredentials {
    try {
        $identity = aws sts get-caller-identity --output json 2>&1 | ConvertFrom-Json
        $account = $identity.Account
        Write-Host "[OK] AWS credentials validas (Account: $account)" -ForegroundColor Green
        
        if ($account -eq "404513223764") {
            Write-Host "[OK] Conta AWS correta (404513223764)" -ForegroundColor Green
        }
        else {
            Write-Host "[AVISO] Conta AWS diferente. Esperado: 404513223764, Atual: $account" -ForegroundColor Yellow
            $script:Warnings++
        }
        return $true
    }
    catch {
        Write-Host "[ERRO] AWS credentials nao configuradas" -ForegroundColor Red
        $script:Errors++
        return $false
    }
}

function Check-AWSRegion {
    $region = aws configure get region 2>&1
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrEmpty($region)) {
        Write-Host "[AVISO] Regiao AWS nao configurada. Usando us-east-1 como padrao" -ForegroundColor Yellow
        $env:AWS_DEFAULT_REGION = "us-east-1"
        $script:Warnings++
    }
    else {
        Write-Host "[OK] Regiao AWS configurada: $region" -ForegroundColor Green
        if ($region -ne "us-east-1") {
            Write-Host "[AVISO] Nota: O stack sera deployado em us-east-1 (necessario para Amplify)" -ForegroundColor Yellow
        }
    }
}

function Check-Secret {
    param($SecretName)
    
    try {
        $result = aws secretsmanager describe-secret --secret-id $SecretName --region us-east-1 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[OK] Segredo '$SecretName' existe" -ForegroundColor Green
            return $true
        }
        else {
            Write-Host "[ERRO] Segredo '$SecretName' nao encontrado" -ForegroundColor Red
            $script:Errors++
            return $false
        }
    }
    catch {
        Write-Host "[ERRO] Segredo '$SecretName' nao encontrado" -ForegroundColor Red
        $script:Errors++
        return $false
    }
}

function Check-GitHubSecretStructure {
    try {
        $secretValue = aws secretsmanager get-secret-value --secret-id github/amplify-token --region us-east-1 --query SecretString --output text 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            $secret = $secretValue | ConvertFrom-Json
            
            if ($secret.'github-token') {
                Write-Host "[OK] Estrutura do segredo github/amplify-token correta" -ForegroundColor Green
                
                $tokenValue = $secret.'github-token'
                if (![string]::IsNullOrEmpty($tokenValue) -and ($tokenValue -ne "null")) {
                    Write-Host "[OK] Token do GitHub nao esta vazio" -ForegroundColor Green
                }
                else {
                    Write-Host "[ERRO] Token do GitHub esta vazio" -ForegroundColor Red
                    $script:Errors++
                }
            }
            else {
                Write-Host "[ERRO] Estrutura incorreta. Esperado: {github-token: ...}" -ForegroundColor Red
                Write-Host "Execute: aws secretsmanager put-secret-value --secret-id github/amplify-token --secret-string '{`"github-token`":`"SEU_TOKEN`"}' --region us-east-1" -ForegroundColor Yellow
                $script:Errors++
            }
        }
        else {
            Write-Host "[ERRO] Nao foi possivel ler o segredo github/amplify-token" -ForegroundColor Red
            $script:Errors++
        }
    }
    catch {
        Write-Host "[ERRO] Erro ao verificar estrutura do segredo: $_" -ForegroundColor Red
        $script:Errors++
    }
}

function Check-HostedZone {
    try {
        $zone = aws route53 get-hosted-zone --id Z07181301GESJJW3HIM10 --query 'HostedZone.Name' --output text 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[OK] Hosted Zone existe: $zone" -ForegroundColor Green
        }
        else {
            Write-Host "[ERRO] Hosted Zone Z07181301GESJJW3HIM10 nao encontrada" -ForegroundColor Red
            $script:Errors++
        }
    }
    catch {
        Write-Host "[ERRO] Hosted Zone Z07181301GESJJW3HIM10 nao encontrada" -ForegroundColor Red
        $script:Errors++
    }
}

function Check-NodeDependencies {
    param($Dir, $Name)
    
    if ((Test-Path "$Dir\node_modules") -or (Test-Path "node_modules")) {
        Write-Host "[OK] Dependencias do $Name instaladas" -ForegroundColor Green
    }
    else {
        Write-Host "[AVISO] Dependencias do $Name nao instaladas. Execute: cd $Dir; npm install" -ForegroundColor Yellow
        $script:Warnings++
    }
}

function Check-File {
    param($FilePath)
    
    if (Test-Path $FilePath) {
        Write-Host "[OK] $FilePath existe" -ForegroundColor Green
        return $true
    }
    else {
        Write-Host "[ERRO] $FilePath nao encontrado" -ForegroundColor Red
        $script:Errors++
        return $false
    }
}

# Executar verificacoes
Write-Host "Passo 1: Verificando comandos necessarios..." -ForegroundColor Cyan
Check-Command "node"
Check-Command "npm"
Check-Command "aws"
Write-Host ""

Write-Host "Passo 2: Verificando AWS..." -ForegroundColor Cyan
Check-AWSCredentials
Check-AWSRegion
Write-Host ""

Write-Host "Passo 3: Verificando segredos no Secrets Manager..." -ForegroundColor Cyan
Check-Secret "github/amplify-token"
Check-GitHubSecretStructure
Check-Secret "StripeSecret80A38A68-b8L7a52OBjnP"
Write-Host ""

Write-Host "Passo 4: Verificando Route53..." -ForegroundColor Cyan
Check-HostedZone
Write-Host ""

Write-Host "Passo 5: Verificando dependencias Node.js..." -ForegroundColor Cyan
Check-NodeDependencies "infra" "Infra"
Check-NodeDependencies "frontend" "Frontend"
Write-Host ""

Write-Host "Passo 6: Verificando arquivos criticos..." -ForegroundColor Cyan
Check-File "infra\lib\cost-guardian-stack.ts"
Check-File "infra\bin\app.ts"
Check-File "frontend\next.config.js"
Check-File "frontend\amplify-config.ts"
Check-File "frontend\.env.example"
Check-File "docs\cost-guardian-template.yaml"
Write-Host ""

# Resumo
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Resumo da Validacao" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

if ($Errors -eq 0 -and $Warnings -eq 0) {
    Write-Host "[OK] Tudo OK! Pronto para deploy." -ForegroundColor Green
    Write-Host ""
    Write-Host "Proximos passos:" -ForegroundColor Cyan
    Write-Host "1. cd infra; npm install (se necessario)"
    Write-Host "2. cd ..\frontend; npm install (se necessario)"
    Write-Host "3. cd ..\infra; npm run build"
    Write-Host "4. npx cdk synth (para testar)"
    Write-Host "5. npm run cdk deploy -- --require-approval never"
    exit 0
}
elseif ($Errors -eq 0) {
    Write-Host "[AVISO] $Warnings avisos encontrados" -ForegroundColor Yellow
    Write-Host "Voce pode prosseguir, mas revise os avisos acima."
    exit 0
}
else {
    Write-Host "[ERRO] $Errors erros encontrados" -ForegroundColor Red
    if ($Warnings -gt 0) {
        Write-Host "[AVISO] $Warnings avisos encontrados" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "Corrija os erros acima antes de fazer o deploy." -ForegroundColor Red
    exit 1
}
