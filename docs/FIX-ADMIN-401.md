# ✅ CORREÇÃO - Admin recebendo 401 (Unauthorized)

## 🔍 Problema Identificado

Usuário no grupo "Admins" do Cognito estava recebendo 401 ao acessar endpoints `/admin/*`.

**Causa Raiz**: Frontend enviava `idToken`, mas o `accessToken` é que contém `cognito:groups`.

## ✅ Correções Aplicadas

### 1. Frontend - Usar accessToken (FEITO)
**Arquivo**: `frontend/lib/api.ts`  
**Mudança**: `idToken` → `accessToken`  
**Commit**: `174496f`  
**Status**: ✅ Em deploy (automático via Amplify)

### 2. Cognito - Verificar Configuração de Grupos

**AÇÃO NECESSÁRIA**: Verificar se o App Client está configurado para incluir grupos no token.

#### Passo a Passo:

1. **Acessar Console AWS Cognito**:
   ```
   https://console.aws.amazon.com/cognito/v2/idp/user-pools
   ```

2. **Selecionar User Pool**:
   - Nome: `CostGuardianPoolF8005E80-WC8S93fCVZ73`
   - ID: `us-east-1_Y8MPqisuQ`

3. **Navegar para App Integration**:
   - Clique na aba "App integration"
   - Clique em "App clients and analytics"
   - Selecione o client: `73m8bkd6mf0l85v1n9s4ub1e6i`

4. **Editar Token Configuration**:
   - Role até "Token configuration"
   - Clique em "Edit"
   
5. **Habilitar Group Claims**:
   - ✅ Marque "Include group claims in ID token"
   - ✅ Marque "Include group claims in Access token"
   - Clique em "Save changes"

#### Via AWS CLI (Alternativa):
```bash
aws cognito-idp update-user-pool-client \
  --user-pool-id us-east-1_Y8MPqisuQ \
  --client-id 73m8bkd6mf0l85v1n9s4ub1e6i \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --read-attributes name email cognito:groups \
  --region us-east-1
```

### 3. Renovar Sessão do Usuário

**IMPORTANTE**: Após alterar a configuração do Cognito, o usuário precisa fazer logout/login para obter novos tokens.

#### Opção A - Logout/Login Manual:
1. Acesse https://awscostguardian.com
2. Faça logout
3. Faça login novamente

#### Opção B - Forçar Refresh (Browser Console):
```javascript
// Abra o Console do navegador (F12)
localStorage.clear();
sessionStorage.clear();
location.reload();
```

## 🧪 Como Testar

### 1. Verificar Token JWT
```javascript
// No console do navegador após login
import { fetchAuthSession } from 'aws-amplify/auth';
const session = await fetchAuthSession();
console.log('Groups:', session.tokens?.accessToken?.payload?.['cognito:groups']);
// Deve mostrar: ['Admins']
```

### 2. Decodificar Token Manualmente
1. Abra DevTools (F12) > Network
2. Acesse https://awscostguardian.com/admin
3. Procure requisição para `/admin/metrics`
4. Copie o valor do header `Authorization` (após "Bearer ")
5. Cole em https://jwt.io
6. Verifique se tem:
   - `token_use`: "access"
   - `cognito:groups`: ["Admins"]

### 3. Teste Completo
```bash
# Execute após deploy completar (5-10 min)
# Faça logout e login novamente
# Acesse:
https://awscostguardian.com/login

# Login como admin deve redirecionar para:
https://awscostguardian.com/admin

# Não deve haver erros 401 no console
```

## 📊 Timeline de Deploy

### Commits Aplicados:
1. ✅ `c3ce7d0` - Redirecionar admins para /admin + corrigir /onboard-init
2. ✅ `174496f` - Usar accessToken em vez de idToken

### Status do Deploy:
- **Backend**: ✅ Já em produção (não precisou mudar)
- **Frontend**: 🔄 Build automático em andamento (~5-10 min)
- **Cognito Config**: ⏸️ Aguardando configuração manual

## 🔍 Diagnóstico de Problemas

### Ainda recebe 401 após deploy?

**Debug Passo a Passo**:

1. **Limpar cache**:
   ```javascript
   localStorage.clear();
   sessionStorage.clear();
   location.reload();
   ```

2. **Verificar token no Network**:
   - F12 > Network > `/admin/metrics`
   - Request Headers > Authorization
   - Deve começar com "Bearer eyJ..."

3. **Decodificar token em jwt.io**:
   - Verificar `cognito:groups` presente
   - Verificar `token_use` = "access"

4. **CloudWatch Logs (Backend)**:
   ```bash
   aws logs tail /aws/lambda/cost-guardian-api --follow --region us-east-1
   ```

### Ainda redireciona para /dashboard?

- **Aguardar deploy do Amplify** (5-10 min)
- **Verificar build**: https://console.aws.amazon.com/amplify/
- **Forçar refresh**: Ctrl+Shift+R ou Cmd+Shift+R

### 403 (Forbidden) em vez de 401?

- ✅ Token válido
- ❌ Usuário não está no grupo Admins
- Solução: Verificar no Cognito se usuário está no grupo

## 📝 Resumo das Mudanças

| Item | Antes | Depois | Status |
|------|-------|--------|--------|
| Token usado | idToken | accessToken | ✅ Corrigido |
| Redirecionamento admin | /dashboard | /admin | ✅ Corrigido |
| Endpoint onboarding | /onboard-init | /api/onboard-init | ✅ Corrigido |
| Group claims no token | ❓ | ✅ | ⏸️ Verificar config |

## 🎯 Próximos Passos

1. ⏳ **Aguardar deploy do Amplify** (5-10 min)
2. 🔧 **Configurar Group Claims no Cognito** (manual, 2 min)
3. 🔄 **Fazer logout/login** (1 min)
4. ✅ **Testar acesso admin** (1 min)

**Tempo total estimado**: ~15-20 minutos

---

**Criado**: 2025-11-06  
**Última atualização**: 2025-11-06  
**Status**: 🔄 Em progresso
