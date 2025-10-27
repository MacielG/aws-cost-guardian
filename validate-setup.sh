#!/bin/bash

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔍 AWS Cost Guardian - Validação Pré-Deploy"
echo "==========================================="
echo ""

ERRORS=0
WARNINGS=0

# Função para verificar comandos
check_command() {
    if command -v $1 &> /dev/null; then
        echo -e "${GREEN}✓${NC} $1 instalado"
        return 0
    else
        echo -e "${RED}✗${NC} $1 não encontrado"
        ERRORS=$((ERRORS+1))
        return 1
    fi
}

# Função para verificar AWS credentials
check_aws_credentials() {
    if aws sts get-caller-identity &> /dev/null; then
        ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
        echo -e "${GREEN}✓${NC} AWS credentials válidas (Account: $ACCOUNT)"
        
        # Verificar se é a conta correta
        if [ "$ACCOUNT" = "404513223764" ]; then
            echo -e "${GREEN}✓${NC} Conta AWS correta (404513223764)"
        else
            echo -e "${YELLOW}⚠${NC} Conta AWS diferente. Esperado: 404513223764, Atual: $ACCOUNT"
            WARNINGS=$((WARNINGS+1))
        fi
        return 0
    else
        echo -e "${RED}✗${NC} AWS credentials não configuradas"
        ERRORS=$((ERRORS+1))
        return 1
    fi
}

# Função para verificar região
check_aws_region() {
    REGION=$(aws configure get region)
    if [ -z "$REGION" ]; then
        echo -e "${YELLOW}⚠${NC} Região AWS não configurada. Usando us-east-1 como padrão"
        export AWS_DEFAULT_REGION=us-east-1
        WARNINGS=$((WARNINGS+1))
    else
        echo -e "${GREEN}✓${NC} Região AWS configurada: $REGION"
        if [ "$REGION" != "us-east-1" ]; then
            echo -e "${YELLOW}⚠${NC} Nota: O stack será deployado em us-east-1 (necessário para Amplify)"
        fi
    fi
}

# Função para verificar segredo
check_secret() {
    SECRET_NAME=$1
    if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region us-east-1 &> /dev/null; then
        echo -e "${GREEN}✓${NC} Segredo '$SECRET_NAME' existe"
        return 0
    else
        echo -e "${RED}✗${NC} Segredo '$SECRET_NAME' não encontrado"
        ERRORS=$((ERRORS+1))
        return 1
    fi
}

# Função para verificar estrutura do segredo do GitHub
check_github_secret_structure() {
    SECRET_VALUE=$(aws secretsmanager get-secret-value --secret-id github/amplify-token --region us-east-1 --query SecretString --output text 2>/dev/null)
    
    if [ $? -eq 0 ]; then
        # Verificar se contém a chave "github-token"
        if echo "$SECRET_VALUE" | jq -e '.["github-token"]' &> /dev/null; then
            echo -e "${GREEN}✓${NC} Estrutura do segredo github/amplify-token correta"
            
            # Verificar se o token não está vazio
            TOKEN=$(echo "$SECRET_VALUE" | jq -r '.["github-token"]')
            if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
                echo -e "${GREEN}✓${NC} Token do GitHub não está vazio"
            else
                echo -e "${RED}✗${NC} Token do GitHub está vazio"
                ERRORS=$((ERRORS+1))
            fi
        else
            echo -e "${RED}✗${NC} Estrutura incorreta. Esperado: {\"github-token\": \"...\"}"
            echo "Execute: aws secretsmanager put-secret-value --secret-id github/amplify-token --secret-string '{\"github-token\":\"SEU_TOKEN\"}' --region us-east-1"
            ERRORS=$((ERRORS+1))
        fi
    else
        echo -e "${RED}✗${NC} Não foi possível ler o segredo github/amplify-token"
        ERRORS=$((ERRORS+1))
    fi
}

# Função para verificar Hosted Zone
check_hosted_zone() {
    if aws route53 get-hosted-zone --id Z07181301GESJJW3HIM10 --region us-east-1 &> /dev/null; then
        ZONE_NAME=$(aws route53 get-hosted-zone --id Z07181301GESJJW3HIM10 --query 'HostedZone.Name' --output text)
        echo -e "${GREEN}✓${NC} Hosted Zone existe: $ZONE_NAME"
    else
        echo -e "${RED}✗${NC} Hosted Zone Z07181301GESJJW3HIM10 não encontrada"
        ERRORS=$((ERRORS+1))
    fi
}

# Função para verificar dependências Node
check_node_dependencies() {
    DIR=$1
    NAME=$2
    
    if [ -d "$DIR/node_modules" ]; then
        echo -e "${GREEN}✓${NC} Dependências do $NAME instaladas"
    else
        echo -e "${YELLOW}⚠${NC} Dependências do $NAME não instaladas. Execute: cd $DIR && npm install"
        WARNINGS=$((WARNINGS+1))
    fi
}

# Função para verificar script no package.json
check_npm_script() {
    DIR=$1
    SCRIPT_NAME=$2
    
    if grep -q "\"$SCRIPT_NAME\"" "$DIR/package.json"; then
        echo -e "${GREEN}✓${NC} Script '$SCRIPT_NAME' encontrado em $DIR/package.json"
    else
        echo -e "${YELLOW}⚠${NC} Script '$SCRIPT_NAME' não encontrado em $DIR/package.json"
        WARNINGS=$((WARNINGS+1))
    fi
}

echo "1️⃣  Verificando comandos necessários..."
check_command "node"
check_command "npm"
check_command "aws"
check_command "jq"
echo ""

echo "2️⃣  Verificando AWS..."
check_aws_credentials
check_aws_region
echo ""

echo "3️⃣  Verificando segredos no Secrets Manager..."
check_secret "github/amplify-token"
check_github_secret_structure
check_secret "StripeSecret80A38A68-b8L7a52OBjnP"
echo ""

echo "4️⃣  Verificando Route53..."
check_hosted_zone
echo ""

echo "5️⃣  Verificando dependências Node.js..."
check_node_dependencies "infra" "Infra"
check_node_dependencies "frontend" "Frontend"
echo ""

echo "6️⃣  Verificando scripts NPM..."
check_npm_script "infra" "cdk"
check_npm_script "infra" "deploy"
echo ""

echo "7️⃣  Verificando arquivos críticos..."
FILES=(
    "infra/lib/cost-guardian-stack.ts"
    "infra/bin/app.ts"
    "frontend/next.config.js"
    "frontend/amplify-config.ts"
    "frontend/.env.example"
    "docs/cost-guardian-template.yaml"
)

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓${NC} $file existe"
    else
        echo -e "${RED}✗${NC} $file não encontrado"
        ERRORS=$((ERRORS+1))
    fi
done
echo ""

# Resumo
echo "==========================================="
echo "📊 Resumo da Validação"
echo "==========================================="

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ Tudo OK! Pronto para deploy.${NC}"
    echo ""
    echo "Próximos passos:"
    echo "1. cd infra && npm install (se necessário)"
    echo "2. cd ../frontend && npm install (se necessário)"
    echo "3. cd ../infra && npm run build"
    echo "4. npx cdk synth (para testar)"
    echo "5. npm run cdk deploy -- --require-approval never"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ $WARNINGS avisos encontrados${NC}"
    echo "Você pode prosseguir, mas revise os avisos acima."
    exit 0
else
    echo -e "${RED}✗ $ERRORS erros encontrados${NC}"
    if [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}⚠ $WARNINGS avisos encontrados${NC}"
    fi
    echo ""
    echo "Corrija os erros acima antes de fazer o deploy."
    exit 1
fi
