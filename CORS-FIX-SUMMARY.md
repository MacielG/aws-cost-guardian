# 🔧 Resumo das Correções CORS - AWS Cost Guardian

**Data:** 02/11/2025  
**Problema Reportado:** Erro CORS ao acessar API do `localhost:3000`

---

## 🔴 Problema Original

```
Access to fetch at 'https://wdj68z2t62.execute-api.us-east-1.amazonaws.com/prod/billing/summary' 
from origin 'http://localhost:3000' has been blocked by CORS policy: 
Response to preflight request doesn't pass access control check: 
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

---

## 🔍 Causa Raiz Identificada

1. **Regex inválida no backend** - String wildcard não funciona em verificação de origin
2. **CORS incompleto no API Gateway CDK** - Faltavam headers e credentials
3. **Credentials incorretos no frontend** - Usava `'same-origin'` ao invés de `'include'`
4. **Falta de headers CORS em Lambda standalone** - Funções execute-recommendation e marketplace-metering

---

## ✅ Correções Aplicadas

### 1️⃣ Backend - `backend/handler.js` (linhas 44-71)

**ANTES:**
```javascript
const allowedOrigins = [
  'http://localhost:3000',
  'https://*.execute-api.us-east-1.amazonaws.com' // ❌ String wildcard não funciona
];
```

**DEPOIS:**
```javascript
const allowedOrigins = [
  'http://localhost:3000',
  /^https:\/\/.+\.execute-api\.us-east-1\.amazonaws\.com$/,  // ✅ Regex correto
  'https://awscostguardian.com',
  'https://www.awscostguardian.com'
];

// Corrigida lógica de verificação
if (allowedOrigins.some(allowedOrigin => {
  if (allowedOrigin instanceof RegExp) {
    return allowedOrigin.test(origin);
  }
  return allowedOrigin === origin;
}))
```

### 2️⃣ Frontend - `frontend/lib/api.ts`

**ANTES:**
```typescript
credentials: 'same-origin'  // ❌ Não funciona para CORS cross-origin
```

**DEPOIS:**
```typescript
credentials: 'include'  // ✅ Permite envio de cookies/credenciais CORS
```

### 3️⃣ Infraestrutura - `infra/lib/cost-guardian-stack.ts` (linha 1030)

**ANTES:**
```typescript
defaultCorsPreflightOptions: { 
  allowOrigins: apigw.Cors.ALL_ORIGINS  // ❌ Incompleto
}
```

**DEPOIS:**
```typescript
defaultCorsPreflightOptions: {
  allowOrigins: [
    'http://localhost:3000',
    'https://awscostguardian.com',
    'https://www.awscostguardian.com'
  ],
  allowMethods: apigw.Cors.ALL_METHODS,
  allowHeaders: [
    'Content-Type',
    'Authorization',
    'X-Amz-Date',
    'X-Api-Key',
    'X-Amz-Security-Token',
    'X-Amz-User-Agent'
  ],
  allowCredentials: true,
  maxAge: cdk.Duration.hours(1)
}
```

### 4️⃣ Lambda Functions - Headers CORS

**Arquivos corrigidos:**
- `backend/functions/execute-recommendation.js` (6 respostas HTTP)
- `backend/functions/marketplace-metering.js` (1 resposta HTTP)

**Headers adicionados:**
```javascript
headers: {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': true,
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
}
```

---

## 🚀 Deploy Realizado

```bash
cd infra
npm run deploy
```

**Resultado:**
- ✅ **ApiHandler Lambda** atualizada (novo código CORS)
- ✅ **HealthEventHandler Lambda** atualizada
- ✅ **11 Lambda functions** redesployadas
- ✅ **API Gateway** - Deployment novo criado
- ✅ **31 métodos OPTIONS** atualizados no API Gateway
- ✅ **Amplify App** configuração atualizada

**Tempo de deploy:** ~2 minutos

---

## 📝 Configuração Atual

### URLs da API
```
API Gateway: https://wdj68z2t62.execute-api.us-east-1.amazonaws.com/prod/
Frontend Local: http://localhost:3000
Frontend Prod: https://awscostguardian.com (Amplify)
```

### Origens Permitidas (CORS)
- ✅ `http://localhost:3000` (desenvolvimento)
- ✅ `https://awscostguardian.com` (produção)
- ✅ `https://www.awscostguardian.com` (www)
- ✅ Regex para subdomínios execute-api

### Cognito
```
User Pool: us-east-1_VsN8wZ32M
Client ID: 7bi5nil8r30fgfjqs5rvfi8trs
Identity Pool: us-east-1:f2c544d8-2315-4e15-ae3b-d311c2dd0a02
```

---

## 🧪 Como Testar

### Opção 1: Arquivo de Teste HTML
Abra o arquivo `test-cors.html` no navegador e clique nos botões de teste.

### Opção 2: Frontend Local
```bash
cd frontend
npm run dev
# Acesse http://localhost:3000
```

### Opção 3: cURL
```bash
# Testar endpoint /health
curl -X GET https://wdj68z2t62.execute-api.us-east-1.amazonaws.com/prod/health \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -v

# Verificar headers CORS na resposta:
# < Access-Control-Allow-Origin: http://localhost:3000
# < Access-Control-Allow-Credentials: true
```

---

## ⏰ Tempo de Propagação

**Importante:** A Lambda pode levar **2-5 minutos** para atualizar completamente após o deploy.

Se ainda vir erros CORS:
1. Aguarde 5 minutos
2. Faça hard refresh no navegador (Ctrl+Shift+R)
3. Limpe o cache do navegador
4. Teste novamente

---

## 📊 Checklist de Validação

- [x] Backend CORS configurado corretamente
- [x] Frontend credentials atualizado
- [x] CDK API Gateway CORS completo
- [x] Lambda functions com headers CORS
- [x] Deploy realizado com sucesso
- [x] .env.local configurado
- [ ] Teste manual no navegador (aguardar 5 min)
- [ ] Verificar logs CloudWatch se houver erros

---

## 🆘 Troubleshooting

### Se ainda houver erro CORS:

1. **Verificar logs da Lambda:**
```bash
aws logs tail /aws/lambda/CostGuardianStack-ApiHandler --follow --region us-east-1
```

2. **Verificar se .env.local está correto:**
```bash
cat frontend/.env.local
```

3. **Limpar cache do Next.js:**
```bash
cd frontend
rm -rf .next
npm run dev
```

4. **Verificar Network tab no DevTools:**
   - Procurar pelo request OPTIONS (preflight)
   - Verificar response headers
   - Ver se `Access-Control-Allow-Origin` está presente

---

## 📚 Arquivos Modificados

```
✅ backend/handler.js (linhas 44-71)
✅ backend/functions/execute-recommendation.js
✅ backend/functions/marketplace-metering.js
✅ frontend/lib/api.ts (linha 44, 95)
✅ infra/lib/cost-guardian-stack.ts (linhas 1030-1047)
```

---

## 🎯 Próximos Passos

1. **Aguardar propagação da Lambda** (2-5 minutos)
2. **Testar frontend** em `http://localhost:3000`
3. **Verificar dashboard** carrega sem erros CORS
4. **Deploy do Amplify** (quando necessário para produção)

---

**Status:** ✅ Correções aplicadas e deployadas  
**Próxima ação:** Aguardar propagação e testar
