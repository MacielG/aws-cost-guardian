# 🔑 Sistema de Gerenciamento Automático de Credenciais

## ✅ Como Funciona (Quando Está Funcionando)

O AWS Cost Guardian possui um sistema **totalmente automatizado** para gerenciar credenciais:

### 1. **Deploy Automático da Infraestrutura (CDK)**
```bash
cd infra
npm run deploy
```

Isso cria automaticamente:
- ✅ Cognito User Pool + Client
- ✅ API Gateway com autenticação
- ✅ DynamoDB, Lambdas, Step Functions
- ✅ Secrets Manager para chaves Stripe/GitHub
- ✅ **CloudFormation Outputs** com todas as credenciais

### 2. **Export Automático para Frontend**
```bash
cd infra
npm run export-outputs
```

Esse script:
- ✅ Busca os outputs do CloudFormation automaticamente
- ✅ Cria `frontend/.env.local` com todas as variáveis
- ✅ Valida formato e valores
- ✅ Cria backup antes de sobrescrever

**Resultado:** `frontend/.env.local` populado automaticamente:
```env
NEXT_PUBLIC_API_URL=https://xxxxx.execute-api.us-east-1.amazonaws.com/prod/
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID=us-east-1:xxxx-xxxx-xxxx-xxxx-xxxx
NEXT_PUBLIC_CFN_TEMPLATE_URL=https://bucket.s3.amazonaws.com/template.yaml
NEXT_PUBLIC_AWS_REGION=us-east-1
NEXT_PUBLIC_AMPLIFY_REGION=us-east-1
```

### 3. **Deploy Contínuo do Frontend (Amplify)**
Após o push para GitHub:
- ✅ Amplify detecta automaticamente
- ✅ Faz build do frontend
- ✅ Injeta variáveis de ambiente
- ✅ Deploy em produção

---

## ❌ Problema Atual

O sistema **deveria** funcionar automaticamente, mas a stack CloudFormation está em estado `ROLLBACK_COMPLETE`, o que significa:

```bash
aws cloudformation describe-stacks --stack-name CostGuardianStack --region us-east-1
# Status: ROLLBACK_COMPLETE ❌
```

**Consequência:** 
- Nenhum recurso foi criado
- Não há outputs para exportar
- `npm run export-outputs` falha
- Frontend não tem credenciais

---

## 🔧 Como Corrigir

### Passo 1: Limpar Stack Falhada
```powershell
cd infra
npx cdk destroy
```

### Passo 2: Verificar Pré-requisitos

#### A) Segredo do GitHub (CRÍTICO)
```powershell
# Verificar
aws secretsmanager get-secret-value --secret-id github/amplify-token --region us-east-1 --query SecretString --output text

# Deve retornar: {"github-token":"ghp_XXXXXXX"}
```

Se não existir ou estiver errado:
```powershell
# Criar/Atualizar
aws secretsmanager put-secret-value `
  --secret-id github/amplify-token `
  --secret-string '{\"github-token\":\"SEU_TOKEN_AQUI\"}' `
  --region us-east-1
```

Obtenha token em: https://github.com/settings/tokens/new
- Permissões: `repo` + `admin:repo_hook`

#### B) Hosted Zone do Route53
```powershell
aws route53 get-hosted-zone --id Z07181301GESJJW3HIM10
```

Deve existir para o domínio `awscostguardian.com`.

### Passo 3: Deploy Novamente
```powershell
cd infra
npm install
npm run build
npm run deploy
```

Aguarde 45-60 minutos.

### Passo 4: Export Automático
```powershell
cd infra
npm run export-outputs
```

Isso criará automaticamente `frontend/.env.local`.

### Passo 5: Testar Localmente
```powershell
cd frontend
npm run dev
```

Abra http://localhost:3000 - **Autenticação deve funcionar!**

---

## 📋 Scripts Disponíveis

| Script | Descrição |
|--------|-----------|
| `npm run deploy` (infra) | Deploy completo + export automático |
| `npm run export-outputs` (infra) | Exporta outputs para .env.local |
| `bash deploy-all.sh` | Deploy completo automatizado (Linux/Mac) |
| `.\validate-setup.ps1` | Valida pré-requisitos antes do deploy |

---

## 🔍 Diagnóstico

### Verificar Status da Stack
```powershell
aws cloudformation describe-stacks --stack-name CostGuardianStack --region us-east-1 --query "Stacks[0].StackStatus"
```

**Status Esperados:**
- ✅ `CREATE_COMPLETE` - Tudo OK
- ✅ `UPDATE_COMPLETE` - Tudo OK
- ⚠️ `CREATE_IN_PROGRESS` - Aguardar
- ❌ `ROLLBACK_COMPLETE` - Falhou, precisa destroy
- ❌ `CREATE_FAILED` - Falhou, precisa destroy

### Ver Outputs da Stack
```powershell
aws cloudformation describe-stacks --stack-name CostGuardianStack --region us-east-1 --query "Stacks[0].Outputs"
```

### Ver Último Erro
```powershell
aws cloudformation describe-stack-events --stack-name CostGuardianStack --region us-east-1 --max-items 20 --query "StackEvents[?ResourceStatus=='CREATE_FAILED']"
```

---

## 🎯 Resumo

✅ **Sistema funcionando corretamente:**
1. `npm run deploy` → Cria tudo automaticamente
2. `npm run export-outputs` → Popula `.env.local`
3. `npm run dev` → Frontend com autenticação funcionando

❌ **Estado atual:**
- Stack falhada (`ROLLBACK_COMPLETE`)
- Precisa de `cdk destroy` + novo deploy
- Verificar segredo GitHub antes de tentar novamente

---

## 📞 Troubleshooting

**Erro: "Stack não possui outputs"**
→ Stack não foi criada com sucesso. Execute `cdk destroy` e tente novamente.

**Erro: "Invalid token" no deploy**
→ Segredo GitHub inválido. Atualize com `aws secretsmanager put-secret-value`.

**Erro: "Certificate validation timed out"**
→ Normal. Aguarde até 30 minutos para validação DNS.

**Frontend: "400 Bad Request" do Cognito**
→ Execute `npm run export-outputs` após deploy bem-sucedido.

---

## 📚 Arquivos Relacionados

- `infra/scripts/export-outputs.js` - Script de export automático
- `deploy-all.sh` - Deploy completo em um comando
- `QUICK-START.md` - Guia passo a passo
- `DEPLOY-NOW.md` - Comandos prontos para copiar
