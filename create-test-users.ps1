# Script PowerShell para criar usuarios de teste no Cognito
# Requer AWS CLI configurado

param(
    [string]$UserEmail = "testuser@awscostguardian.com",
    [string]$UserPassword = "TestUser123!",
    [string]$AdminEmail = "testadmin@awscostguardian.com",
    [string]$AdminPassword = "TestAdmin123!"
)

$UserPoolId = "us-east-1_Y8MPqisuQ"
$Region = "us-east-1"

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  AWS Cost Guardian - Criar Usuarios de Teste" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Funcao para criar usuario
function Create-CognitoUser {
    param(
        [string]$Email,
        [string]$Password,
        [bool]$IsAdmin = $false
    )

    $UserType = if ($IsAdmin) { "Admin" } else { "User" }
    Write-Host "Criando $UserType : $Email" -ForegroundColor Yellow

    try {
        # Criar usuario
        aws cognito-idp admin-create-user `
            --user-pool-id $UserPoolId `
            --username $Email `
            --user-attributes Name=email,Value=$Email Name=email_verified,Value=true `
            --temporary-password "TempPass123!" `
            --region $Region `
            --message-action SUPPRESS 2>&1 | Out-Null

        if ($LASTEXITCODE -eq 0) {
            Write-Host "  OK Usuario criado" -ForegroundColor Green
        } else {
            Write-Host "  INFO Usuario pode ja existir" -ForegroundColor Yellow
        }

        # Definir senha permanente
        aws cognito-idp admin-set-user-password `
            --user-pool-id $UserPoolId `
            --username $Email `
            --password $Password `
            --permanent `
            --region $Region 2>&1 | Out-Null

        if ($LASTEXITCODE -eq 0) {
            Write-Host "  OK Senha definida" -ForegroundColor Green
        }

        # Se for admin, adicionar ao grupo Admins
        if ($IsAdmin) {
            aws cognito-idp admin-add-user-to-group `
                --user-pool-id $UserPoolId `
                --username $Email `
                --group-name Admins `
                --region $Region 2>&1 | Out-Null

            if ($LASTEXITCODE -eq 0) {
                Write-Host "  OK Adicionado ao grupo Admins" -ForegroundColor Green
            }
        }

        Write-Host "  OK $UserType configurado com sucesso!" -ForegroundColor Green
        Write-Host ""
        return $true
    }
    catch {
        Write-Host "  ERRO ao criar usuario: $_" -ForegroundColor Red
        Write-Host ""
        return $false
    }
}

# Verificar se AWS CLI esta instalado
try {
    aws --version | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "AWS CLI nao encontrado"
    }
}
catch {
    Write-Host "ERRO AWS CLI nao instalado ou nao configurado" -ForegroundColor Red
    Write-Host "Instale via: https://aws.amazon.com/cli/" -ForegroundColor Yellow
    exit 1
}

# Criar usuarios
Write-Host "Criando usuarios de teste..." -ForegroundColor Cyan
Write-Host ""

$userCreated = Create-CognitoUser -Email $UserEmail -Password $UserPassword -IsAdmin $false
$adminCreated = Create-CognitoUser -Email $AdminEmail -Password $AdminPassword -IsAdmin $true

# Resumo
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  RESUMO" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

if ($userCreated) {
    Write-Host "OK Usuario Normal:" -ForegroundColor Green
    Write-Host "   Email: $UserEmail"
    Write-Host "   Senha: $UserPassword"
    Write-Host ""
}

if ($adminCreated) {
    Write-Host "OK Usuario Admin:" -ForegroundColor Green
    Write-Host "   Email: $AdminEmail"
    Write-Host "   Senha: $AdminPassword"
    Write-Host ""
}

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  PROXIMOS PASSOS" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Execute os testes:" -ForegroundColor Yellow
Write-Host ""
Write-Host "Salve este script e execute:" -ForegroundColor Cyan
Write-Host ".\run-tests.ps1"
Write-Host ""
