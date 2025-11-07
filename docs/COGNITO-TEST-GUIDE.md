# 🧪 Guia de Teste do Cognito - AWS Cost Guardian

**Data:** 01/11/2025  
**Objetivo:** Validar funcionamento completo da autenticação Cognito

---

## ✅ Status da Configuração

| Item | Status | Detalhes |
|------|--------|----------|
| User Pool | ✅ CONFIGURADO | `us-east-1_VsN8wZ32M` |
| Client ID | ✅ CONFIGURADO | `7bi5nil8r30fgfjqs5rvfi8trs` |
| Usuário Existente | ✅ SIM | `gguilherme.costantino.maciel@gmail.com` |
| Email Verificado | ✅ SIM | Confirmado |
| Status | ✅ CONFIRMED | Ativo |
| MFA | ⚠️ OFF | Opcional para dev |

---

## 🧪 TESTE 1: Autenticação via Script (Backend)

### Executar:
```bash
cd G:\aws-cost-guardian
node test-cognito.js
```

### Credenciais:
- **Email:** `gguilherme.costantino.maciel@gmail.com`
- **Senha:** [Use a senha que você definiu ao criar a conta]

### O que deve acontecer:
1. ✅ Script solicita email e senha
2. ✅ Autentica com sucesso
3. ✅ Mostra informações do token JWT
4. ✅ Mostra informações do usuário
5. ✅ Token é válido e decodificável

### Se der erro:
- **NotAuthorizedException**: Senha incorreta
- **UserNotFoundException**: Email incorreto
- **InvalidParameterException**: Formato inválido

**Solução:** Resetar senha via AWS CLI:
```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id us-east-1_VsN8wZ32M \
  --username gguilherme.costantino.maciel@gmail.com \
  --password "NovaSenha123!" \
  --permanent \
  --region us-east-1
```

---

## 🧪 TESTE 2: Login via Frontend

### Pré-requisitos:
1. ✅ Servidor frontend rodando: `npm run dev` (porta 3000)
2. ✅ Variáveis de ambiente configuradas no `.env.local`

### Passos:

#### 2.1. Acessar Página de Login
```
URL: http://localhost:3000/login
```

**Verificar:**
- [ ] Página carrega sem erros
- [ ] Formulário de login aparece
- [ ] Opção de "Criar conta" está disponível
- [ ] Logo e título aparecem

#### 2.2. Fazer Login
**Credenciais:**
- Email: `gguilherme.costantino.maciel@gmail.com`
- Senha: [Sua senha]

**Ações:**
1. Digitar email
2. Digitar senha
3. Clicar em "Sign In"

**Verificar:**
- [ ] Sem erros no console do navegador
- [ ] Loading state aparece
- [ ] Redirecionamento acontece após login

**Redirecionamento esperado:**
- Se `?mode=trial` → `/onboard?mode=trial`
- Caso contrário → `/dashboard`

#### 2.3. Verificar Token JWT

**Abrir DevTools (F12):**

1. **Console Tab:**
   - [ ] Sem erros de autenticação
   - [ ] Sem erros de "token inválido"

2. **Application Tab (Storage):**
   ```
   Local Storage → http://localhost:3000
   ```
   - [ ] Verificar se há chaves relacionadas ao Cognito
   - [ ] Exemplo: `CognitoIdentityServiceProvider.*.idToken`

3. **Network Tab:**
   - [ ] Fazer uma chamada para API (ex: acessar `/dashboard`)
   - [ ] Clicar em uma request para a API
   - [ ] Verificar Headers
   - [ ] Deve ter: `Authorization: Bearer eyJraWQ...`

**Exemplo de token válido:**
```
Authorization: Bearer eyJraWQiOiJ...longo_token_aqui...
```

#### 2.4. Verificar Informações do Usuário

**No Console do DevTools:**
```javascript
// Ver dados do usuário logado
console.log(JSON.parse(atob(
  localStorage.getItem('CognitoIdentityServiceProvider.7bi5nil8r30fgfjqs5rvfi8trs.LastAuthUser')
)));
```

**Deve mostrar:**
- Username (UUID)
- Email
- Email verificado

---

## 🧪 TESTE 3: Proteção de Rotas

### 3.1. Testar Acesso SEM Login

**Ações:**
1. Abrir uma aba anônima/privada
2. Tentar acessar: `http://localhost:3000/dashboard`

**Resultado esperado:**
- [ ] Redireciona para `/login`
- [ ] Mostra mensagem de "não autenticado" (opcional)

### 3.2. Testar Acesso COM Login

**Ações:**
1. Fazer login (seguir Teste 2)
2. Após login, acessar: `http://localhost:3000/dashboard`

**Resultado esperado:**
- [ ] Dashboard carrega
- [ ] Dados do usuário são exibidos
- [ ] Sem redirecionamento

### 3.3. Outras Rotas Protegidas

Testar se redirecionam para `/login` quando não autenticado:
- [ ] `/recommendations`
- [ ] `/billing`
- [ ] `/settings/connections`
- [ ] `/settings/automation`
- [ ] `/admin`

---

## 🧪 TESTE 4: Logout

### 4.1. Verificar se Logout Existe

**Problema atual:** Pode não haver botão de logout visível

**Ações:**
1. Após login, procurar por botão "Logout" ou "Sair"
2. Se não existir, usar o console:

```javascript
// No Console do DevTools
import { signOut } from 'aws-amplify/auth';
await signOut();
```

**Ou usar o AuthProvider:**
```javascript
// Se o componente tiver acesso ao useAuth()
const { signOut } = useAuth();
await signOut();
```

### 4.2. Testar Logout

**Ações:**
1. Clicar em "Logout" (ou executar via console)
2. Verificar o que acontece

**Resultado esperado:**
- [ ] Redireciona para `/login`
- [ ] Local Storage é limpo
- [ ] Session Storage é limpo
- [ ] Tentar acessar `/dashboard` redireciona para `/login`

### 4.3. Verificar Limpeza de Dados

**No DevTools Application Tab:**
- [ ] Local Storage está vazio (ou sem tokens Cognito)
- [ ] Session Storage está vazio

---

## 🧪 TESTE 5: Chamadas à API

### 5.1. Verificar Token em Requests

**Pré-requisitos:**
1. Estar logado
2. DevTools Network tab aberto

**Ações:**
1. Navegar para uma página que faz chamadas API (ex: `/dashboard`)
2. Na Network tab, filtrar por `XHR` ou `Fetch`
3. Clicar em uma request para a API (ex: `/api/recommendations`)

**Verificar Headers da Request:**
```
Authorization: Bearer eyJraWQiOi...
```

**Se NÃO tiver o header:**
- [ ] Verificar `frontend/lib/api.ts`
- [ ] Verificar se `fetchAuthSession()` está retornando token
- [ ] Verificar console por erros

### 5.2. Testar Endpoint Protegido

**Usar o Postman ou curl:**

```bash
# Obter token do Local Storage primeiro
# Depois testar:

curl -X GET https://wdj68z2t62.execute-api.us-east-1.amazonaws.com/prod/api/recommendations \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -H "Content-Type: application/json"
```

**Resultado esperado:**
- Com token válido: Status 200 + dados
- Sem token: Status 401 Unauthorized
- Token inválido: Status 401 Unauthorized

---

## 🧪 TESTE 6: Criar Nova Conta (Sign Up)

### 6.1. Acessar Sign Up

```
URL: http://localhost:3000/login
```

**Ações:**
1. Clicar em "Create Account" ou "Sign Up"
2. Preencher formulário:
   - Email: `teste@example.com`
   - Senha: `Test@123456` (deve atender requisitos)

**Requisitos de senha:**
- Mínimo 8 caracteres
- Pelo menos 1 maiúscula
- Pelo menos 1 minúscula
- Pelo menos 1 número
- Pelo menos 1 símbolo

### 6.2. Confirmar Email

**Após criar conta:**
- [ ] Verificar email recebido
- [ ] Copiar código de confirmação
- [ ] Inserir código na tela de confirmação

**Ou confirmar via AWS CLI:**
```bash
aws cognito-idp admin-confirm-sign-up \
  --user-pool-id us-east-1_VsN8wZ32M \
  --username teste@example.com \
  --region us-east-1
```

### 6.3. Login com Nova Conta

**Ações:**
1. Após confirmação, fazer login
2. Verificar se tudo funciona normalmente

---

## 🧪 TESTE 7: Recuperação de Senha

### 7.1. Esqueci Minha Senha

**Ações:**
1. Na tela de login, clicar em "Forgot Password"
2. Inserir email
3. Solicitar código

**Verificar:**
- [ ] Email com código chega
- [ ] Código pode ser usado para resetar senha

### 7.2. Resetar Senha

**Ações:**
1. Inserir código recebido
2. Definir nova senha
3. Fazer login com nova senha

---

## 📊 CHECKLIST DE VALIDAÇÃO COMPLETA

### Configuração
- [x] User Pool existe
- [x] Client configurado corretamente
- [x] Região correta (us-east-1)
- [x] Variáveis de ambiente no `.env.local`

### Autenticação
- [ ] Login funciona (script backend)
- [ ] Login funciona (frontend)
- [ ] Token JWT é gerado
- [ ] Token é válido
- [ ] Token contém claims corretos (sub, email, etc.)

### Proteção de Rotas
- [ ] Rotas protegidas redirecionam para `/login`
- [ ] Após login, rotas protegidas são acessíveis
- [ ] Redirecionamento pós-login funciona

### Logout
- [ ] Logout limpa sessão
- [ ] Logout redireciona para `/login`
- [ ] Após logout, rotas protegidas não são acessíveis

### API
- [ ] Token é enviado em requests API
- [ ] Header `Authorization` está correto
- [ ] Backend aceita e valida token

### Fluxos Adicionais
- [ ] Sign Up funciona
- [ ] Confirmação de email funciona
- [ ] Recuperação de senha funciona

---

## ❌ PROBLEMAS CONHECIDOS E SOLUÇÕES

### Problema 1: "InvalidCharacterError: Failed to execute 'atob'"
**Causa:** Token corrompido no localStorage  
**Solução:**
```javascript
localStorage.clear();
sessionStorage.clear();
// Fazer login novamente
```

### Problema 2: "Token inválido" na API
**Causa:** Token expirado ou formato incorreto  
**Solução:**
- Verificar se `fetchAuthSession()` está sendo chamado
- Verificar se token não expirou (validade: 1h)
- Fazer logout e login novamente

### Problema 3: Redirect loop infinito
**Causa:** Lógica de redirecionamento incorreta  
**Solução:**
- Verificar `AuthProvider` e `ProtectedRoute`
- Verificar condições de redirecionamento em `login/page.tsx`

### Problema 4: "User does not exist"
**Causa:** Usuário não criado ou email incorreto  
**Solução:**
```bash
# Listar usuários
aws cognito-idp list-users \
  --user-pool-id us-east-1_VsN8wZ32M \
  --region us-east-1
```

---

## 🎯 PRÓXIMOS PASSOS APÓS VALIDAÇÃO

Se todos os testes passarem:
1. ✅ Marcar "PLANO A" como completo
2. ➡️ Avançar para "PLANO B": Implementar funcionalidades
3. ➡️ Implementar Header com Logout
4. ➡️ Implementar Sidebar de Navegação
5. ➡️ Conectar Dashboard à API

---

## 📝 NOTAS

**Usuário de Teste Atual:**
- Email: `gguilherme.costantino.maciel@gmail.com`
- Status: CONFIRMED
- Email verificado: SIM

**Para resetar senha (se necessário):**
```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id us-east-1_VsN8wZ32M \
  --username gguilherme.costantino.maciel@gmail.com \
  --password "NovaSenha123!" \
  --permanent \
  --region us-east-1
```

**Para criar novo usuário de teste:**
```bash
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_VsN8wZ32M \
  --username teste@example.com \
  --user-attributes Name=email,Value=teste@example.com Name=email_verified,Value=true \
  --temporary-password "TempPassword123!" \
  --region us-east-1
```

---

**Próximo passo:** Execute `node test-cognito.js` para validar autenticação!
