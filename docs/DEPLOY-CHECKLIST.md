# 🚀 Deploy Checklist - AWS Cost Guardian

## 📋 Pré-requisitos

### 1. Segredos no AWS Secrets Manager ✅
- [x] **StripeSecret80A38A68-b8L7a52OBjnP** - Criado
- [x] **github/amplify-token** - Criado

### 2. Verificar Estrutura do Segredo do GitHub

O segredo `github/amplify-token` DEVE ter este formato JSON:

```json
{
  "github-token": "ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
}
```

**Como verificar:**
```bash
aws secretsmanager get-secret-value --secret-id github/amplify-token --region us-east-1 --query SecretString --output text
```

**Como corrigir se necessário:**
```bash
aws secretsmanager put-secret-value \
  --secret-id github/amplify-token \
  --secret-string '{"github-token":"SEU_TOKEN_AQUI"}' \
  --region us-east-1
```

### 3. Verificar Token do GitHub

Seu GitHub Personal Access Token deve ter estas permissões:
- ✅ `repo` (Full control of private repositories)
- ✅ `admin:repo_hook` (Full control of repository hooks)

**Como gerar um novo token:**
1. Vá para: https://github.com/settings/tokens/new
2. Nome: `Amplify Deployment Token`
3. Expiration: `No expiration` (ou escolha um período)
4. Selecione: `repo` e `admin:repo_hook`
5. Clique em "Generate token"
6. Copie e salve o token

### 4. Verificar Hosted Zone no Route53

```bash
aws route53 get-hosted-zone --id Z07181301GESJJW3HIM10 --region us-east-1
```

Deve retornar detalhes da zona `awscostguardian.com`.

---

## 🔧 Instalação de Dependências

### 1. Infra (CDK)
```bash
cd infra
npm install
```

**Verificar se instalou corretamente:**
```bash
npm list @aws-cdk/aws-amplify-alpha
```
Deve mostrar: `@aws-cdk/aws-amplify-alpha@2.100.0-alpha.0`

### 2. Frontend
```bash
cd frontend
npm install
```

**Verificar se instalou corretamente:**
```bash
npm list dotenv
```
Deve mostrar: `dotenv@16.3.1`

---

## ✅ Validação Pré-Deploy

### 1. Compilar TypeScript do CDK
```bash
cd infra
npm run build
```
✅ **Sem erros = OK para continuar**

### 2. Sintetizar o Stack (Dry Run)
```bash
cd infra
npx cdk synth
```
✅ **Deve gerar um template CloudFormation sem erros**

### 3. Verificar Diferenças (Se já fez deploy antes)
```bash
cd infra
npx cdk diff
```

---

## 🚀 Deploy

### Deploy Completo
```bash
cd infra
npm run cdk deploy -- --require-approval never
```

**O que esperar:**
1. ⏳ Criação do Cognito User Pool (~2 min)
2. ⏳ Criação do DynamoDB (~1 min)
3. ⏳ Criação das Lambdas (~3 min)
4. ⏳ Criação do API Gateway (~2 min)
5. ⏳ Criação do Amplify App (~1 min)
6. ⏳ Criação do Certificado SSL (~30 min - validação DNS automática)
7. ⏳ Primeiro build do Amplify (~5-10 min)

**Tempo total estimado: ~45-60 minutos**

---

## 🔍 Verificação Pós-Deploy

### 1. Verificar Outputs do Stack
```bash
aws cloudformation describe-stacks \
  --stack-name CostGuardianStack \
  --region us-east-1 \
  --query 'Stacks[0].Outputs' \
  --output table
```

Deve mostrar:
- ✅ APIUrl
- ✅ UserPoolId
- ✅ UserPoolClientId
- ✅ IdentityPoolId
- ✅ CfnTemplateUrl

### 2. Verificar Amplify App
```bash
aws amplify list-apps --region us-east-1
```

### 3. Verificar Status do Build
```bash
# Obter App ID do comando anterior, depois:
aws amplify list-branches \
  --app-id <APP_ID> \
  --region us-east-1
```

**Monitorar build em tempo real:**
- Console AWS: https://console.aws.amazon.com/amplify/home?region=us-east-1
- Ou via CLI (substitua APP_ID e BRANCH_NAME):
```bash
aws amplify list-jobs \
  --app-id <APP_ID> \
  --branch-name main \
  --region us-east-1
```

### 4. Testar API
```bash
# Obter a URL da API dos outputs
API_URL=$(aws cloudformation describe-stacks \
  --stack-name CostGuardianStack \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`APIUrl`].OutputValue' \
  --output text)

# Testar endpoint público
curl ${API_URL}api/health
```

Deve retornar: `{"status":"ok"}`

### 5. Verificar Domínio
```bash
# Verificar DNS (pode levar até 48h para propagar)
nslookup awscostguardian.com
nslookup www.awscostguardian.com
```

---

## 💻 Desenvolvimento Local

### 1. Exportar Variáveis de Ambiente
```bash
cd infra
npm run export-outputs
```

Isso criará `frontend/.env.local` com todas as variáveis.

### 2. Iniciar Frontend
```bash
cd frontend
npm run dev
```

Abra: http://localhost:3000

---

## 🐛 Troubleshooting

### Erro: "Resource handler returned message: Invalid request provided"

**Causa:** Token do GitHub inválido ou sem permissões.

**Solução:**
1. Gere um novo token: https://github.com/settings/tokens/new
2. Atualize o segredo:
```bash
aws secretsmanager put-secret-value \
  --secret-id github/amplify-token \
  --secret-string '{"github-token":"NOVO_TOKEN"}' \
  --region us-east-1
```

### Erro: "Certificate validation timed out"

**Causa:** Validação DNS do certificado ACM demorando.

**Solução:**
- Aguarde. Pode levar até 30 minutos.
- Verifique se a Hosted Zone está correta.

### Erro: "No named resource found with name 'github/amplify-token'"

**Causa:** Segredo não existe ou está em região diferente.

**Solução:**
```bash
# Verificar se existe
aws secretsmanager describe-secret \
  --secret-id github/amplify-token \
  --region us-east-1
```

### Build do Amplify Falhando

**Verificar logs:**
1. Console: https://console.aws.amazon.com/amplify/home?region=us-east-1
2. Clique no app → Branch: main → Ver logs do último build

**Causas comuns:**
- `npm ci` falhou: Verifique `frontend/package.json`
- `npm run build` falhou: Variáveis de ambiente não foram injetadas

### Frontend não conecta à API

**Verificar variáveis:**
```bash
cat frontend/.env.local
```

Deve conter todas as variáveis do `.env.example`.

---

## 🔄 Atualização Contínua

### Deploy Automático
Qualquer push para `main` dispara automaticamente:
1. ✅ Amplify detecta mudanças no GitHub
2. ✅ Executa build com variáveis injetadas
3. ✅ Publica nova versão

### Deploy Manual do Frontend
```bash
# Via Amplify Console ou:
aws amplify start-job \
  --app-id <APP_ID> \
  --branch-name main \
  --job-type RELEASE \
  --region us-east-1
```

### Atualizar Infraestrutura (Backend)
```bash
cd infra
npm run build
npm run cdk deploy
```

---

## 📞 Comandos Úteis

```bash
# Verificar status de todos os recursos
aws cloudformation describe-stack-resources \
  --stack-name CostGuardianStack \
  --region us-east-1

# Ver eventos do stack (útil para debug)
aws cloudformation describe-stack-events \
  --stack-name CostGuardianStack \
  --region us-east-1 \
  --max-items 20

# Exportar outputs do stack
aws cloudformation describe-stacks \
  --stack-name CostGuardianStack \
  --region us-east-1 \
  --query 'Stacks[0].Outputs'

# Destruir tudo (CUIDADO!)
cd infra
npx cdk destroy
```
