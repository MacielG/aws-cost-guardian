# 🚀 DEPLOY AGORA - Comandos Prontos Para Copiar e Colar

## ✅ Pré-requisito: Validar Segredo do GitHub

**IMPORTANTE:** O segredo deve estar neste formato exato:

```json
{
  "github-token": "ghp_XXXXXXXXXXXXXXXXXXXXXXXX"
}
```

### Verificar se está correto:
```powershell
aws secretsmanager get-secret-value --secret-id github/amplify-token --region us-east-1 --query SecretString --output text
```

### Se NÃO estiver no formato correto, execute (substitua SEU_TOKEN):
```powershell
aws secretsmanager put-secret-value --secret-id github/amplify-token --secret-string '{\"github-token\":\"SEU_TOKEN_AQUI\"}' --region us-east-1
```

> 💡 **Como obter o token:** https://github.com/settings/tokens/new
> - Marque: `repo` e `admin:repo_hook`
> - Clique em "Generate token" e copie

---

## 📋 Comandos Para Deploy (Copie e Cole)

### 1️⃣ Validação (Recomendado)
```powershell
# No PowerShell (Windows):
.\validate-setup.ps1

# Ou no Git Bash:
bash validate-setup.sh
```

Se houver erros, corrija antes de continuar.

---

### 2️⃣ Instalar Dependências
```powershell
# Infra
cd infra
npm install

# Frontend
cd ..\frontend
npm install

# Voltar para infra
cd ..\infra
```

---

### 3️⃣ Build e Deploy
```powershell
# Build do TypeScript
npm run build

# (Opcional) Testar antes do deploy:
npx cdk synth

# DEPLOY! 🚀
npm run cdk deploy -- --require-approval never
```

**⏰ Tempo: ~45-60 minutos**

Você verá progresso em tempo real. Aguarde até ver:
```
✅ CostGuardianStack

Outputs:
CostGuardianStack.APIUrl = https://...
CostGuardianStack.UserPoolId = ...
...
```

---

### 4️⃣ Configurar Ambiente Local (Após Deploy)
```powershell
# Exportar variáveis do CloudFormation para .env.local
npm run export-outputs

# Iniciar frontend local
cd ..\frontend
npm run dev
```

Abra: http://localhost:3000

---

## 🎯 Tudo Pronto!

✅ **Produção:** https://awscostguardian.com (após DNS propagar)
✅ **Local:** http://localhost:3000
✅ **API:** Veja o output `APIUrl`

---

## 🔄 Próximos Commits

### Deploy Automático do Frontend:
```bash
git add .
git commit -m "feat: nova feature"
git push origin main
```
→ Amplify detecta e faz deploy automaticamente em ~5 min

### Atualizar Backend:
```powershell
cd infra
npm run build
npm run cdk deploy
```

### Sincronizar .env local após atualizar backend:
```powershell
cd infra
npm run export-outputs
```

---

## ❌ Se Algo Der Errado

### 1. Verificar logs do CloudFormation:
```powershell
aws cloudformation describe-stack-events --stack-name CostGuardianStack --region us-east-1 --max-items 20
```

### 2. Verificar status do Amplify:
Console: https://console.aws.amazon.com/amplify/home?region=us-east-1

### 3. Rollback (se necessário):
```powershell
cd infra
npx cdk destroy
```

### 4. Erro comum: "Invalid token"
→ Token do GitHub inválido. Gere um novo e atualize:
```powershell
aws secretsmanager put-secret-value --secret-id github/amplify-token --secret-string '{\"github-token\":\"NOVO_TOKEN\"}' --region us-east-1
```

---

## 📚 Documentação Completa

- [QUICK-START.md](./QUICK-START.md) - Guia passo a passo detalhado
- [DEPLOY-CHECKLIST.md](./DEPLOY-CHECKLIST.md) - Checklist completo com troubleshooting

---

**Boa sorte! 🚀**
