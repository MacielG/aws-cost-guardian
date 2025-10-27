# AWS Cost Guardian - Validacao Pre-Deploy (Windows PowerShell)

Write-Host "🔍 AWS Cost Guardian - Validacao Pre-Deploy" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$Errors = 0
$Warnings = 0

function Check-Command {
    param($CommandName)
    
    if (Get-Command $CommandName -ErrorAction SilentlyContinue) {
        Write-Host "✓ $CommandName instalado" -ForegroundColor Green
        return $true
    }
    else {
        Write-Host "✗ $CommandName nao encontrado" -ForegroundColor Red
        $script:Errors++
        return $false
    }
}

function Check-AWSCredentials {
    try {
        $identity = aws sts get-caller-identity --output json 2>&1 | ConvertFrom-Json
        $account = $identity.Account
        Write-Host "✓ AWS credentials validas (Account: $account)" -ForegroundColor Green
        
        if ($account -eq "404513223764") {
            Write-Host "✓ Conta AWS correta (404513223764)" -ForegroundColor Green
        }
        else {
            Write-Host "⚠ Conta AWS diferente. Esperado: 404513223764, Atual: $account" -ForegroundColor Yellow
            $script:Warnings++
        }
        return $true
    }
    catch {
        Write-Host "✗ AWS credentials nao configuradas" -ForegroundColor Red
        $script:Errors++
        return $false
    }
}

function Check-AWSRegion {
    try {
        $region = aws configure get region 2>&1
        if ([string]::IsNullOrEmpty($region)) {
            Write-Host "⚠ Regiao AWS nao configurada. Usando us-east-1 como padrao" -ForegroundColor Yellow
            $env:AWS_DEFAULT_REGION = "us-east-1"
            $script:Warnings++
        }
        else {
            Write-Host "✓ Regiao AWS configurada: $region" -ForegroundColor Green
            if ($region -ne "us-east-1") {
                Write-Host "⚠ Nota: O stack sera deployado em us-east-1 (necessario para Amplify)" -ForegroundColor Yellow
            }
        }
    }
    catch {
        Write-Host "⚠ Erro ao verificar regiao" -ForegroundColor Yellow
        $script:Warnings++
    }
}

function Check-Secret {
    param($SecretName)
    
    try {
        $result = aws secretsmanager describe-secret --secret-id $SecretName --region us-east-1 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✓ Segredo '$SecretName' existe" -ForegroundColor Green
            return $true
        }
        else {
            Write-Host "✗ Segredo '$SecretName' nao encontrado" -ForegroundColor Red
            $script:Errors++
            return $false
        }
    }
    catch {
        Write-Host "✗ Segredo '$SecretName' nao encontrado" -ForegroundColor Red
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
                Write-Host "✓ Estrutura do segredo github/amplify-token correta" -ForegroundColor Green
                
                $tokenValue = $secret.'github-token'
                if (![string]::IsNullOrEmpty($tokenValue) -and ($tokenValue -ne "null")) {
                    Write-Host "✓ Token do GitHub nao esta vazio" -ForegroundColor Green
                }
                else {
                    Write-Host "✗ Token do GitHub esta vazio" -ForegroundColor Red
                    $script:Errors++
                }
            }
            else {
                Write-Host "✗ Estrutura incorreta. Esperado: {`"github-token`": `"...`"}" -ForegroundColor Red
                Write-Host "Execute: aws secretsmanager put-secret-value --secret-id github/amplify-token --secret-string '{`"github-token`":`"SEU_TOKEN`"}' --region us-east-1" -ForegroundColor Yellow
                $script:Errors++
            }
        }
        else {
            Write-Host "✗ Nao foi possivel ler o segredo github/amplify-token" -ForegroundColor Red
            $script:Errors++
        }
    }
    catch {
        Write-Host "✗ Erro ao verificar estrutura do segredo: $_" -ForegroundColor Red
        $script:Errors++
    }
}

function Check-HostedZone {
    try {
        $zone = aws route53 get-hosted-zone --id Z07181301GESJJW3HIM10 --query 'HostedZone.Name' --output text 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✓ Hosted Zone existe: $zone" -ForegroundColor Green
        }
        else {
            Write-Host "✗ Hosted Zone Z07181301GESJJW3HIM10 nao encontrada" -ForegroundColor Red
            $script:Errors++
        }
    }
    catch {
        Write-Host "✗ Hosted Zone Z07181301GESJJW3HIM10 nao encontrada" -ForegroundColor Red
        $script:Errors++
    }
}

function Check-NodeDependencies {
    param($Dir, $Name)
    
    if (Test-Path "$Dir\node_modules") {
        Write-Host "✓ Dependencias do $Name instaladas" -ForegroundColor Green
    }
    else {
        Write-Host "⚠ Dependencias do $Name nao instaladas. Execute: cd $Dir; npm install" -ForegroundColor Yellow
        $script:Warnings++
    }
}

function Check-File {
    param($FilePath)
    
    if (Test-Path $FilePath) {
        Write-Host "✓ $FilePath existe" -ForegroundColor Green
        return $true
    }
    else {
        Write-Host "✗ $FilePath nao encontrado" -ForegroundColor Red
        $script:Errors++
        return $false
    }
}

# Executar verificacoes
Write-Host "1️⃣  Verificando comandos necessarios..." -ForegroundColor Cyan
Check-Command "node"
Check-Command "npm"
Check-Command "aws"
Write-Host ""

Write-Host "2️⃣  Verificando AWS..." -ForegroundColor Cyan
Check-AWSCredentials
Check-AWSRegion
Write-Host ""

Write-Host "3️⃣  Verificando segredos no Secrets Manager..." -ForegroundColor Cyan
Check-Secret "github/amplify-token"
Check-GitHubSecretStructure
Check-Secret "StripeSecret80A38A68-b8L7a52OBjnP"
Write-Host ""

Write-Host "4️⃣  Verificando Route53..." -ForegroundColor Cyan
Check-HostedZone
Write-Host ""

Write-Host "5️⃣  Verificando dependencias Node.js..." -ForegroundColor Cyan
Check-NodeDependencies "infra" "Infra"
Check-NodeDependencies "frontend" "Frontend"
Write-Host ""

Write-Host "6️⃣  Verificando arquivos criticos..." -ForegroundColor Cyan
Check-File "infra\lib\cost-guardian-stack.ts"
Check-File "infra\bin\app.ts"
Check-File "frontend\next.config.js"
Check-File "frontend\amplify-config.ts"
Check-File "frontend\.env.example"
Check-File "docs\cost-guardian-template.yaml"
Write-Host ""

# Resumo
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "📊 Resumo da Validacao" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

if ($Errors -eq 0 -and $Warnings -eq 0) {
    Write-Host "✓ Tudo OK! Pronto para deploy." -ForegroundColor Green
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
    Write-Host "⚠ $Warnings avisos encontrados" -ForegroundColor Yellow
    Write-Host "Voce pode prosseguir, mas revise os avisos acima."
    exit 0
}
else {
    Write-Host "✗ $Errors erros encontrados" -ForegroundColor Red
    if ($Warnings -gt 0) {
        Write-Host "⚠ $Warnings avisos encontrados" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "Corrija os erros acima antes de fazer o deploy." -ForegroundColor Red
    exit 1
}
