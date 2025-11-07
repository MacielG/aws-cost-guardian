#!/bin/bash
# Script Bash para criar usuários de teste no Cognito
# Requer AWS CLI configurado

USER_EMAIL="${1:-testuser@awscostguardian.com}"
USER_PASSWORD="${2:-TestUser123!}"
ADMIN_EMAIL="${3:-testadmin@awscostguardian.com}"
ADMIN_PASSWORD="${4:-TestAdmin123!}"

USER_POOL_ID="us-east-1_Y8MPqisuQ"
REGION="us-east-1"

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}======================================${NC}"
echo -e "${CYAN}  AWS Cost Guardian - Criar Usuários de Teste${NC}"
echo -e "${CYAN}======================================${NC}"
echo ""

# Função para criar usuário
create_cognito_user() {
    local email=$1
    local password=$2
    local is_admin=$3
    local user_type="User"
    
    if [ "$is_admin" = true ]; then
        user_type="Admin"
    fi
    
    echo -e "${YELLOW}Criando $user_type: $email${NC}"
    
    # Criar usuário
    aws cognito-idp admin-create-user \
        --user-pool-id "$USER_POOL_ID" \
        --username "$email" \
        --user-attributes Name=email,Value="$email" Name=email_verified,Value=true \
        --temporary-password "TempPass123!" \
        --region "$REGION" \
        --message-action SUPPRESS &>/dev/null
    
    if [ $? -eq 0 ]; then
        echo -e "  ${GREEN}✅ Usuário criado${NC}"
    else
        echo -e "  ${YELLOW}⚠️  Usuário pode já existir${NC}"
    fi
    
    # Definir senha permanente
    aws cognito-idp admin-set-user-password \
        --user-pool-id "$USER_POOL_ID" \
        --username "$email" \
        --password "$password" \
        --permanent \
        --region "$REGION" &>/dev/null
    
    if [ $? -eq 0 ]; then
        echo -e "  ${GREEN}✅ Senha definida${NC}"
    fi
    
    # Se for admin, adicionar ao grupo
    if [ "$is_admin" = true ]; then
        aws cognito-idp admin-add-user-to-group \
            --user-pool-id "$USER_POOL_ID" \
            --username "$email" \
            --group-name Admins \
            --region "$REGION" &>/dev/null
        
        if [ $? -eq 0 ]; then
            echo -e "  ${GREEN}✅ Adicionado ao grupo Admins${NC}"
        fi
    fi
    
    echo -e "  ${GREEN}✅ $user_type configurado com sucesso!${NC}"
    echo ""
}

# Verificar AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI não instalado${NC}"
    echo -e "${YELLOW}Instale via: https://aws.amazon.com/cli/${NC}"
    exit 1
fi

# Criar usuários
echo -e "Criando usuários de teste..."
echo ""

create_cognito_user "$USER_EMAIL" "$USER_PASSWORD" false
create_cognito_user "$ADMIN_EMAIL" "$ADMIN_PASSWORD" true

# Resumo
echo -e "${CYAN}======================================${NC}"
echo -e "${CYAN}  RESUMO${NC}"
echo -e "${CYAN}======================================${NC}"
echo ""

echo -e "${GREEN}✅ Usuário Normal:${NC}"
echo -e "   Email: $USER_EMAIL"
echo -e "   Senha: $USER_PASSWORD"
echo ""

echo -e "${GREEN}✅ Usuário Admin:${NC}"
echo -e "   Email: $ADMIN_EMAIL"
echo -e "   Senha: $ADMIN_PASSWORD"
echo ""

echo -e "${CYAN}======================================${NC}"
echo -e "${CYAN}  PRÓXIMOS PASSOS${NC}"
echo -e "${CYAN}======================================${NC}"
echo ""
echo -e "${YELLOW}Execute os testes com:${NC}"
echo ""
echo -e "${CYAN}# Teste com usuário normal:${NC}"
echo -e "TEST_USER_EMAIL='$USER_EMAIL' TEST_USER_PASSWORD='$USER_PASSWORD' node test-production-integration.js"
echo ""
echo -e "${CYAN}# Teste com admin:${NC}"
echo -e "TEST_ADMIN_EMAIL='$ADMIN_EMAIL' TEST_ADMIN_PASSWORD='$ADMIN_PASSWORD' node test-production-integration.js"
echo ""
echo -e "${CYAN}# Teste completo (usuário + admin):${NC}"
echo -e "TEST_USER_EMAIL='$USER_EMAIL' TEST_USER_PASSWORD='$USER_PASSWORD' TEST_ADMIN_EMAIL='$ADMIN_EMAIL' TEST_ADMIN_PASSWORD='$ADMIN_PASSWORD' node test-production-integration.js"
echo ""
