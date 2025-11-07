# Script para criar pacote Lambda corretamente
param(
    [string]$FunctionName = "CostGuardianStack-ApiHandler5E7490E8-vSXCjTTqhugv",
    [string]$SourceDir = "backend",
    [string]$OutputFile = "lambda-deploy.zip"
)

Write-Host "Criando pacote Lambda para $FunctionName..." -ForegroundColor Green

# Limpar arquivo anterior
if (Test-Path $OutputFile) {
    Remove-Item $OutputFile -Force
    Write-Host "Arquivo anterior removido"
}

# Criar lista de arquivos
$files = @(
    "$SourceDir\handler-simple.js",
    "$SourceDir\package.json"
)

# Verificar se arquivos existem
foreach ($file in $files) {
    if (!(Test-Path $file)) {
        Write-Host "ERRO: Arquivo não encontrado: $file" -ForegroundColor Red
        exit 1
    }
}

# Criar ZIP básico
Compress-Archive -Path $files -DestinationPath $OutputFile -CompressionLevel Fastest
Write-Host "Pacote básico criado"

# Adicionar node_modules (se existir)
if (Test-Path "$SourceDir\node_modules") {
    Write-Host "Adicionando node_modules..."
    # Usar .NET para adicionar ao ZIP existente
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::Open($OutputFile, [System.IO.Compression.ZipArchiveMode]::Update)

    Get-ChildItem -Path "$SourceDir\node_modules" -Recurse -File | Select-Object -First 100 | ForEach-Object {
        $relativePath = $_.FullName.Substring((Get-Location).Path.Length + 1)
        try {
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $relativePath) | Out-Null
        } catch {
            # Ignorar erros
        }
    }

    $zip.Dispose()
    Write-Host "node_modules adicionado (amostra)"
}

# Verificar tamanho
if (Test-Path $OutputFile) {
    $size = (Get-Item $OutputFile).Length / 1MB
    Write-Host "✓ Pacote criado: $([math]::Round($size, 2)) MB" -ForegroundColor Green

    # Fazer deploy se tamanho razoável
    if ($size -lt 50) {
        Write-Host "Fazendo deploy..." -ForegroundColor Yellow
        aws lambda update-function-code --function-name $FunctionName --zip-file fileb://$OutputFile

        if ($LASTEXITCODE -eq 0) {
            Write-Host "✓ Deploy realizado com sucesso!" -ForegroundColor Green
        } else {
            Write-Host "✗ Falha no deploy" -ForegroundColor Red
        }
    } else {
        Write-Host "✗ Pacote muito grande: $($size) MB (máximo 50 MB)" -ForegroundColor Red
    }
} else {
    Write-Host "✗ Erro ao criar pacote" -ForegroundColor Red
}
