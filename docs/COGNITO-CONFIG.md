# Configuração do AWS Cognito - Guia Completo

## ✅ Status Atual da Configuração

O AWS Cost Guardian utiliza **exclusivamente AWS Cognito** para autenticação. Não há integração com Supabase ou qualquer outro serviço de autenticação.

## 🔑 Variáveis de Ambiente Necessárias

### Frontend (`frontend/.env.local`)

```env
# Obrigatórias
NEXT_PUBLIC_API_URL=https://[your-api-id].execute-api.us-east-1.amazonaws.com/prod/
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
NEXT_PUBLIC_AMPLIFY_REGION=us-east-1

# Opcionais
NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID=us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_XXXXXXXXXXXXXXXXXXXXXXXX
NEXT_PUBLIC_CFN_TEMPLATE_URL=https://your-bucket.s3.amazonaws.com/template.yaml
```

### Backend (via CDK/CloudFormation)

O backend recebe as seguintes variáveis via Lambda environment:

- `USER_POOL_ID` - ID do User Pool do Cognito
- `USER_POOL_CLIENT_ID` - ID do Client do User Pool
- `AWS_REGION` - Região AWS (padrão: us-east-1)

## 🛡️ Sistema de Proteção contra Erros

### 1. Validação Automática de Tokens

- **Local**: `frontend/components/auth/AuthProvider.tsx`
- **Funcionalidade**:
  - Detecta tokens inválidos ou corrompidos
  - Limpa automaticamente localStorage/sessionStorage em caso de erro
  - Trata `InvalidCharacterError` causado por tokens malformados
  - Valida se `session.tokens.idToken` existe antes de usar

### 2. Validação de Variáveis de Ambiente

- **Local**: `frontend/lib/validate-env.ts`
- **Funcionalidade**:
  - Verifica se todas as variáveis obrigatórias estão presentes
  - Detecta valores de exemplo não configurados
  - Valida formato de URLs e IDs
  - Executa automaticamente em desenvolvimento

### 3. Tratamento de Erros na API

- **Local**: `frontend/lib/api.ts`
- **Funcionalidade**:
  - Valida tokens antes de fazer requisições
  - Limpa storage em caso de erros 401
  - Fornece mensagens de erro claras
  - Trata casos onde `fetchAuthSession()` falha

## 🚨 Resolução de Problemas Comuns

### Erro: "Failed to load resource: 400 (Bad Request)"

**Causa**: Token inválido ou variáveis de ambiente incorretas

**Solução**:
1. Verifique se `frontend/.env.local` existe e contém valores corretos
2. Limpe o cache do navegador: localStorage e sessionStorage
3. Faça logout e login novamente
4. Verifique se os IDs do Cognito estão corretos no AWS Console

### Erro: "InvalidCharacterError" ao fazer parse de token

**Causa**: Token corrompido no localStorage

**Solução**: 
- O sistema agora limpa automaticamente o storage
- Se persistir, execute no console do navegador:
  ```javascript
  localStorage.clear();
  sessionStorage.clear();
  location.reload();
  ```

### Erro: "Sessão expirada"

**Causa**: Token JWT expirado (padrão: 1 hora)

**Solução**: 
- Faça login novamente
- Configure refresh tokens no Cognito User Pool (nas configurações do App Client)

## 🔧 Como Obter as Credenciais do Cognito

### Via AWS Console:

1. Acesse **Amazon Cognito** no AWS Console
2. Selecione **User Pools**
3. Clique no seu User Pool
4. Copie o **Pool ID** (ex: `us-east-1_bYYJpnkWn`)
5. Vá em **App Integration** > **App clients**
6. Copie o **Client ID** (ex: `2p3ucdspq8eptvot6tv0hhnsb`)

### Via AWS CLI:

```bash
# Listar User Pools
aws cognito-idp list-user-pools --max-results 10

# Obter detalhes do User Pool
aws cognito-idp describe-user-pool --user-pool-id us-east-1_XXXXXXXXX

# Listar App Clients
aws cognito-idp list-user-pool-clients --user-pool-id us-east-1_XXXXXXXXX
```

## 📋 Checklist de Configuração

- [ ] Arquivo `frontend/.env.local` criado
- [ ] `NEXT_PUBLIC_COGNITO_USER_POOL_ID` configurado
- [ ] `NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID` configurado
- [ ] `NEXT_PUBLIC_API_URL` apontando para API Gateway correto
- [ ] `NEXT_PUBLIC_AMPLIFY_REGION` configurado (padrão: us-east-1)
- [ ] Backend Lambda tem `USER_POOL_ID` e `USER_POOL_CLIENT_ID` configurados
- [ ] User Pool criado no Cognito com App Client
- [ ] App Client configurado sem Client Secret (para aplicações públicas)

## 🔐 Segurança

### Backend (handler.js)

O backend valida tokens JWT usando:
- **JWKS** (JSON Web Key Set) do Cognito
- Verificação de assinatura RS256
- Validação de `audience` (Client ID)
- Validação de `issuer` (Cognito User Pool)

```javascript
// Exemplo de middleware de autenticação
const decoded = jwt.verify(token, getKey, {
  algorithms: ['RS256'],
  audience: process.env.USER_POOL_CLIENT_ID,
  issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
});
```

### Frontend

- Tokens são obtidos via AWS Amplify
- Armazenados de forma segura pelo Amplify (IndexedDB)
- Enviados como Bearer token em headers Authorization
- Renovados automaticamente quando possível

## 📚 Recursos Adicionais

- [AWS Amplify Auth Documentation](https://docs.amplify.aws/lib/auth/getting-started/q/platform/js/)
- [AWS Cognito User Pools](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools.html)
- [JWT Verification](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html)
