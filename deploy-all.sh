#!/bin/bash
set -e  # Exit on error

echo "🚀 Iniciando deploy do AWS Cost Guardian..."

# Removendo arquivos Amplify se existirem
echo "1. Limpando configurações antigas..."
rm -f frontend/amplify_outputs.json frontend/lib/amplify.ts 2>/dev/null || true

# Infra (CDK)
echo "2. Realizando deploy da infraestrutura via CDK..."
cd infra
npm install
npm run build

# Deploy a stack e captura as saídas em um arquivo temporário
CDK_OUTPUTS_FILE=$(mktemp)

# Garante que o arquivo temporário seja limpo ao sair do script
trap "rm -f \"$CDK_OUTPUTS_FILE\"" EXIT

if ! cdk deploy --all --require-approval never --outputs-file "$CDK_OUTPUTS_FILE"; then
    echo "Erro: Falha no deploy do CDK. Verifique os logs acima para detalhes."
    exit 1 # Sai do script se o deploy do CDK falhar
fi

# Extrai as saídas necessárias do arquivo JSON
STACK_NAME=$(jq -r 'keys[0]' $CDK_OUTPUTS_FILE)
API_URL=$(jq -r '."'$STACK_NAME'".APIUrl' $CDK_OUTPUTS_FILE)
USER_POOL_ID=$(jq -r '."'$STACK_NAME'".UserPoolId' $CDK_OUTPUTS_FILE)
USER_POOL_CLIENT_ID=$(jq -r '."'$STACK_NAME'".UserPoolClientId' $CDK_OUTPUTS_FILE)

cd ..

# Cria o arquivo .env.local para o frontend
echo "--------------------------------------------------"
echo "✅ Backend Deploy completo!"
echo "⚙️  Configurando o ambiente do Frontend..."

FRONTEND_ENV_FILE="frontend/.env.local"
echo "NEXT_PUBLIC_API_URL=${API_URL}" > $FRONTEND_ENV_FILE
echo "NEXT_PUBLIC_USER_POOL_ID=${USER_POOL_ID}" >> $FRONTEND_ENV_FILE
echo "NEXT_PUBLIC_USER_POOL_CLIENT_ID=${USER_POOL_CLIENT_ID}" >> $FRONTEND_ENV_FILE

echo "✅ Arquivo '$FRONTEND_ENV_FILE' criado com sucesso com os outputs do backend."
echo "--------------------------------------------------"

echo "🚀 Deploy completo!"
echo "Outputs:"
echo "- API URL: $API_URL"
echo "- Cognito User Pool ID: $USER_POOL_ID"
echo "Onboarding: Use CloudFormation link para conectar contas."
echo "Monitore: CloudWatch Logs no console AWS."

# Desabilita 'exit on error' para garantir que a mensagem final e a pausa sejam exibidas
set +e
# Adiciona uma pausa para que o usuário possa ver a saída
read -p "Pressione Enter para fechar o terminal..."

# Reabilita 'exit on error' (opcional, se o script continuasse depois disso)
set -e