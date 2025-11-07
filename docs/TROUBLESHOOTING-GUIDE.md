# 🔧 Guia de Troubleshooting - AWS Cost Guardian

## ✅ Correções Implementadas

### 1. Autenticação Cognito - Erros 400 ✅
**Status**: Resolvido

Arquivos corrigidos:
- `frontend/components/auth/AuthProvider.tsx` - Tratamento robusto de tokens
- `frontend/lib/api.ts` - Validação preventiva  
- `frontend/lib/validate-env.ts` - Validação automática (NOVO)
- `frontend/amplify-config.ts` - Integração de validação

**Leia**: [docs/COGNITO-CONFIG.md](./docs/COGNITO-CONFIG.md) para configuração completa

---

### 2. Backend "Not Implemented" ✅
**Status**: Esclarecido

O backend é **serverless** (AWS Lambda), não roda localmente com `npm run dev`.

**Soluções**:
- Use a API já deployada na AWS (recomendado)
- Ou use `serverless offline` para dev local

**Leia**: [backend/README-DEV.md](./backend/README-DEV.md) para detalhes

---

### 3. Erros de Build TypeScript - Framer Motion ✅
**Status**: Resolvido

Conflitos entre event handlers do React e framer-motion foram corrigidos em:
- `button.tsx`
- `card.tsx`
- `input.tsx`
- `EmptyState.tsx`
- `PageAnimator.tsx`

---

## 🚀 Primeiros Passos

### 1. Limpar o Navegador
```javascript
// Execute no console do navegador (F12)
localStorage.clear();
sessionStorage.clear();
location.reload();
```

### 2. Verificar Variáveis de Ambiente
```bash
# Verifique se existe
cat frontend/.env.local

# Deve conter:
NEXT_PUBLIC_API_URL=https://fw5woyjdw6.execute-api.us-east-1.amazonaws.com/prod/
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_bYYJpnkWn
NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=2p3ucdspq8eptvot6tv0hhnsb
NEXT_PUBLIC_AMPLIFY_REGION=us-east-1
```

### 3. Executar o Frontend
```bash
cd frontend
npm install
npm run dev
```

### 4. Acessar a Aplicação
```
http://localhost:3000
```

---

## 🔥 Problemas Comuns

### ❌ Erro: "cognito-idp 400 Bad Request"

**Causa**: Token inválido ou variáveis de ambiente incorretas

**Solução**:
1. Limpe localStorage/sessionStorage
2. Verifique `frontend/.env.local`
3. Faça logout e login novamente

---

### ❌ Erro: "InvalidCharacterError parsing token"

**Status**: ✅ Auto-corrigido

O sistema agora detecta e limpa automaticamente tokens corrompidos.

Se persistir:
```javascript
localStorage.clear();
sessionStorage.clear();
location.reload();
```

---

### ❌ Backend: "dev script not implemented"

**Causa**: Backend é serverless, não roda localmente de forma tradicional

**Solução**:
- **Frontend aponta para AWS**: Configurado em `.env.local`
- **Não precisa rodar backend localmente** para desenvolvimento frontend
- **Para modificar backend**: Deploy via CDK (`cd infra && cdk deploy`)

Leia: [backend/README-DEV.md](./backend/README-DEV.md)

---

### ❌ Erro: "Sessão expirada"

**Causa**: Token JWT expirado (1 hora de validade)

**Solução**: Faça login novamente

**Futuro**: Configure refresh tokens no Cognito User Pool Settings

---

### ❌ Build Error: "Type error in motion.button"

**Status**: ✅ Resolvido

Todos os componentes framer-motion foram corrigidos.

Se encontrar novos erros, adicione `Omit`:
```typescript
interface Props extends Omit<React.HTMLAttributes<HTMLElement>, 
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration'
> {
  // suas props
}
```

---

## 📋 Checklist de Verificação

### Frontend
- [ ] `frontend/.env.local` existe e está correto
- [ ] `npm install` executado
- [ ] `npm run dev` roda sem erros
- [ ] Navegador: localStorage/sessionStorage limpos
- [ ] Console sem erros 400

### Backend
- [ ] Entendeu que é serverless (Lambda)
- [ ] Frontend aponta para API na AWS
- [ ] Não precisa rodar backend localmente

### Autenticação
- [ ] Cognito User Pool criado
- [ ] USER_POOL_ID e CLIENT_ID corretos
- [ ] App Client sem Client Secret
- [ ] Usuários criados no Cognito

---

## 🛠️ Comandos Úteis

### Frontend
```bash
cd frontend
npm run dev          # Desenvolvimento
npm run build        # Build de produção
npm test             # Testes
```

### Backend
```bash
cd backend
npm test             # Testes unitários
```

### Infraestrutura
```bash
cd infra
cdk deploy           # Deploy completo
cdk diff             # Ver mudanças
```

---

## 📚 Documentação Adicional

- [COGNITO-CONFIG.md](./docs/COGNITO-CONFIG.md) - Configuração completa do Cognito
- [AUTENTICACAO-MELHORIAS.md](./docs/AUTENTICACAO-MELHORIAS.md) - Melhorias implementadas
- [backend/README-DEV.md](./backend/README-DEV.md) - Desenvolvimento backend

---

## 🆘 Ainda com Problemas?

### 1. Verifique os Logs
```bash
# Frontend (navegador)
Console do navegador (F12)

# Backend (Lambda)
AWS CloudWatch Logs
```

### 2. Validação Automática
O sistema agora valida automaticamente:
- ✅ Variáveis de ambiente (em desenvolvimento)
- ✅ Tokens corrompidos
- ✅ Sessões inválidas

### 3. Reset Completo
```bash
# Frontend
cd frontend
rm -rf node_modules .next
npm install
npm run dev

# Navegador
localStorage.clear();
sessionStorage.clear();
location.reload();
```

---

## 🎯 Status Geral

| Componente | Status | Observações |
|------------|--------|-------------|
| Autenticação Cognito | ✅ Funcionando | Auto-validação implementada |
| Frontend Build | ✅ Funcionando | Framer Motion corrigido |
| Backend Lambda | ✅ Deployado | Serverless via CDK |
| Variáveis .env | ✅ Validadas | Validação automática |
| Documentação | ✅ Completa | 3 novos guias criados |

---

## 💡 Dicas

1. **Sempre limpe localStorage** quando tiver problemas de autenticação
2. **Backend não precisa rodar localmente** - use a API na AWS
3. **Validação automática** em dev mostra erros de configuração
4. **Logs são seus amigos** - console do navegador e CloudWatch
5. **CDK para deploy** - não use serverless framework
