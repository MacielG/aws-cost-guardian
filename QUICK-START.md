# 🚀 Quick Start - Deploy em 5 Passos

## Pré-requisitos ✅

Você já tem:
- ✅ Segredo `github/amplify-token` criado no AWS Secrets Manager
- ✅ Hosted Zone `awscostguardian.com` no Route53
- ✅ AWS CLI configurado com credenciais válidas

---

## 📝 Passo 1: Validar o Segredo do GitHub

O segredo DEVE ter este formato exato:

```json
{
  "github-token": "ghp_SEU_TOKEN_AQUI"
}
```

**Verificar:**
```bash
aws secretsmanager get-secret-value --secret-id github/amplify-token --region us-east-1 --query SecretString --output text
```

**Se estiver errado, corrigir:**
```bash
aws secretsmanager put-secret-value \
  --secret-id github/amplify-token \
  --secret-string '{"github-token":"ghp_SEU_TOKEN_AQUI"}' \
  --region us-east-1
```

> **Nota:** Obtenha seu token em https://github.com/settings/tokens/new
> - Permissões necessárias: `repo` e `admin:repo_hook`

---

## 📦 Passo 2: Instalar Dependências

```bash
# Infra (CDK)
cd infra
npm install

# Frontend
cd ../frontend
npm install
```

---

## ✅ Passo 3: Validar Configuração (Opcional mas Recomendado)

```bash
# Voltar para a raiz
cd ..

# No Windows (Git Bash):
bash validate-setup.sh

# Ou manualmente verificar:
aws secretsmanager describe-secret --secret-id github/amplify-token --region us-east-1
aws route53 get-hosted-zone --id Z07181301GESJJW3HIM10
```

---

## 🏗️ Passo 4: Build e Deploy

```bash
cd infra

# Build do TypeScript
npm run build

# Synth (teste antes do deploy - opcional)
npx cdk synth

# Deploy completo
npm run cdk deploy -- --require-approval never
```

**Tempo estimado:** 45-60 minutos

O que será criado:
- ✅ DynamoDB, Cognito, API Gateway, Lambdas, Step Functions
- ✅ Amplify App conectado ao GitHub
- ✅ Certificado SSL (validação DNS automática)
- ✅ Primeiro build e deploy do frontend

---

## 🖥️ Passo 5: Configurar Desenvolvimento Local

Após o deploy ser concluído:

```bash
# Exportar variáveis de ambiente
cd infra
npm run export-outputs

# Isso cria frontend/.env.local automaticamente

# Iniciar frontend local
cd ../frontend
npm run dev
```

Abra: http://localhost:3000

---

## 🎉 Pronto!

Seu aplicativo está rodando em:
- **Produção:** https://awscostguardian.com
- **API:** https://[ID].execute-api.us-east-1.amazonaws.com/prod/
- **Local:** http://localhost:3000

---

## 🔄 Workflows

### Deploy Automático (Produção)
```bash
git add .
git commit -m "feat: nova funcionalidade"
git push origin main
```
→ Amplify detecta e faz deploy automaticamente

### Deploy Manual do Frontend
Console Amplify → Selecionar app → Branch: main → "Redeploy this version"

### Atualizar Backend
```bash
cd infra
npm run build
npm run cdk deploy
```

### Sincronizar .env Local após mudanças no Backend
```bash
cd infra
npm run export-outputs
```

---

## 🐛 Problemas Comuns

### "Invalid request provided: Invalid token"
→ Token do GitHub inválido ou sem permissões. Gere um novo e atualize o segredo.

### "Stack drift detected"
→ Normal após primeiro deploy. Ignore ou execute `cdk deploy` novamente.

### "Certificate validation timed out"
→ Aguarde 30 minutos. A validação DNS é automática mas lenta.

### Build do Amplify falhou
→ Console Amplify → Ver logs do build → Procurar por erros de npm

### Frontend não conecta à API
→ Verifique se executou `npm run export-outputs` após o deploy

---

## 📚 Referências

- [DEPLOY-CHECKLIST.md](./DEPLOY-CHECKLIST.md) - Checklist completo e troubleshooting detalhado
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Guia de contribuição
- [docs/](./docs/) - Documentação técnica

---

## 🆘 Suporte

Problemas? Execute a validação:
```bash
bash validate-setup.sh
```

Ainda com problemas? Verifique:
1. AWS CloudFormation Console → Stacks → CostGuardianStack → Events
2. AWS Amplify Console → Apps → CostGuardianApp → Builds
3. CloudWatch Logs para detalhes de erros

---

**Boa sorte! 🚀**
