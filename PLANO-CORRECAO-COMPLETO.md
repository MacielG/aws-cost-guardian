# 📋 Plano de Correção Completo - Sistema AWS Cost Guardian

**Data:** 02/11/2025  
**Objetivo:** Corrigir problemas CORS, 404, e garantir sistema automático, dinâmico e seguro

---

## 🔍 Análise do Sistema Atual

### 1. Fluxo de Geração de Configuração

```
┌─────────────────────────────────────────────────────────────┐
│ 1. CDK Deploy (infra/)                                      │
│    ├─ Cria recursos AWS                                     │
│    ├─ API Gateway, Lambda, Cognito, DynamoDB, etc          │
│    └─ Outputs do CloudFormation:                            │
│       ├─ APIUrl (URL do API Gateway)                        │
│       ├─ UserPoolId                                         │
│       ├─ UserPoolClientId                                   │
│       └─ IdentityPoolId                                     │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Script export-outputs.js                                 │
│    ├─ Lê outputs do CloudFormation                          │
│    ├─ Mapeia para variáveis NEXT_PUBLIC_*                   │
│    ├─ Normaliza URLs (função normalizeApiUrl)               │
│    └─ Gera frontend/.env.local automaticamente              │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Frontend Next.js                                         │
│    ├─ Lê .env.local                                         │
│    ├─ Valida variáveis (validate-env.cli.ts)                │
│    └─ Usa em runtime (process.env.NEXT_PUBLIC_*)            │
└─────────────────────────────────────────────────────────────┘
```

### 2. Arquivos Envolvidos

| Arquivo | Responsabilidade | Modificável? |
|---------|------------------|--------------|
| `infra/lib/cost-guardian-stack.ts` | Define infraestrutura AWS | ✅ SIM |
| `infra/scripts/export-outputs.js` | Gera .env.local | ✅ SIM |
| `frontend/.env.local` | Configuração runtime | ❌ NÃO (auto-gerado) |
| `frontend/lib/validate-env.cli.ts` | Valida env vars | ✅ SIM |
| `frontend/lib/api.ts` | Cliente HTTP | ✅ SIM |
| `backend/handler.js` | Express app (CORS, rotas) | ✅ SIM |

---

## ❌ Problemas Identificados

### Problema 1: URL da API sem barra final

**Atual:**
```
Output CDK: https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod
Gerado:     NEXT_PUBLIC_API_URL=https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod
```

**Problema:**
- Script `export-outputs.js` linha 175-180 REMOVE barra final
- Frontend `api.ts` usa `joinUrl()` que adiciona `/`
- Resultado: Algumas URLs ficam sem `/` entre prod e o path

**Exemplo:**
```javascript
// URL base: https://.../prod (sem /)
joinUrl(baseUrl, '/billing/summary')
// Pode resultar: https://.../prod/billing/summary ✅
// OU: https://.../prodbilling/summary ❌ (depende do joinUrl)
```

### Problema 2: GatewayResponses com wildcard '*'

**Atual (CDK):**
```typescript
new apigw.GatewayResponse(this, 'CorsGatewayResponse4xx', {
  responseHeaders: {
    'Access-Control-Allow-Origin': "'*'",        // ❌ WILDCARD
    'Access-Control-Allow-Credentials': "'true'" // ❌ CONFLITO
  }
});
```

**Problema:**
- Navegador rejeita: `*` com `credentials: 'include'` é inválido
- Erro: "must not be the wildcard '*' when the request's credentials mode is 'include'"

**Causa:**
- GatewayResponses são para erros 4xx/5xx ANTES da Lambda
- Se API Gateway retornar erro (ex: timeout), usa esses headers
- Mas `*` + credentials não é permitido pelo spec CORS

### Problema 3: Rota /api/onboard-init retorna 404

**Request:**
```
GET /api/onboard-init?mode=trial
```

**Problema:**
- API Gateway tem proxy: `ANY /{proxy+}`
- Request chega como: `/api/onboard-init?mode=trial`
- Express espera: `/api/onboard-init` (rota definida em backend/routes/)
- Mas pode estar faltando a rota ou há problema no routing

**Possíveis causas:**
1. Rota não definida no Express
2. Path incorreto no proxy
3. Middleware bloqueando antes de chegar na rota

---

## ✅ Solução Proposta

### Solução 1: Garantir barra final na URL da API

**Onde:** `infra/scripts/export-outputs.js`

**Mudança:**
```javascript
// ANTES (linha 175-180)
function normalizeApiUrl(raw) {
  // ... código existente ...
  pathPart = pathPart.replace(/\/$/, ''); // REMOVE barra final
  return `${protocol}://${host}${pathPart}`;
}

// DEPOIS
function normalizeApiUrl(raw) {
  // ... código existente ...
  pathPart = pathPart.replace(/\/$/, ''); // Remove barras duplicadas
  // ADICIONAR barra final SEMPRE
  return `${protocol}://${host}${pathPart}/`;
}
```

**Validação adicional:**
```javascript
// Garantir que sempre termina com /
if (envVars['NEXT_PUBLIC_API_URL'] && !envVars['NEXT_PUBLIC_API_URL'].endsWith('/')) {
  envVars['NEXT_PUBLIC_API_URL'] += '/';
}
```

**Justificativa:**
- `joinUrl()` no frontend funciona melhor com base terminando em `/`
- Previne URLs como `prod/billing` → `prodbilling`
- Padrão consistente

### Solução 2: Remover GatewayResponses ou usar origins específicas

**Opção A: Remover GatewayResponses (RECOMENDADO)**

**Onde:** `infra/lib/cost-guardian-stack.ts` (linhas 1063-1106)

**Mudança:**
```typescript
// REMOVER completamente as 4 GatewayResponses
// Motivo: Express já retorna CORS correto em TODOS os casos
// GatewayResponses só são usados para erros do API Gateway ANTES da Lambda
// Como usamos proxy, quase nunca chegamos nesses erros
```

**Vantagem:**
- Mais simples
- Menos chance de conflito
- Express já handle CORS corretamente

**Opção B: GatewayResponses sem credentials (ALTERNATIVA)**

```typescript
new apigw.GatewayResponse(this, 'CorsGatewayResponse4xx', {
  restApi: api,
  type: apigw.ResponseType.DEFAULT_4XX,
  responseHeaders: {
    'Access-Control-Allow-Origin': "'*'",
    // REMOVER Allow-Credentials (não é necessário em erros)
    'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
    'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'"
  }
});
```

**Quando usar:**
- Se houver muitos erros de timeout/rate limit no API Gateway
- Para debugging (ver headers mesmo em erros do Gateway)

**DECISÃO:** Usar Opção A (remover) por simplicidade

### Solução 3: Verificar e corrigir rotas do Express

**Onde:** `backend/routes/` ou `backend/handler.js`

**Investigação necessária:**
1. Verificar se rota `/api/onboard-init` existe
2. Verificar se middleware de auth está bloqueando
3. Adicionar logging para debug

**Ação:**
```javascript
// Em backend/handler.js, ANTES de definir rotas:
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.path} - Origin: ${req.get('origin')}`);
  next();
});

// Verificar se a rota existe:
// backend/routes/onboard.js ou similar
app.get('/api/onboard-init', (req, res) => {
  // handler
});
```

**Se rota não existir, criar:**
```javascript
app.get('/api/onboard-init', async (req, res) => {
  try {
    const mode = req.query.mode; // 'trial' or 'full'
    // Retornar configuração de onboarding
    res.json({
      mode,
      // ... configuração
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

---

## 📝 Passo a Passo de Implementação

### Fase 1: Correção do Script export-outputs.js (5 min)

```bash
# Arquivo: infra/scripts/export-outputs.js
```

**Passo 1.1:** Modificar função `normalizeApiUrl` (linha 147-172)
```javascript
function normalizeApiUrl(raw) {
  if (!raw || typeof raw !== 'string') return raw;
  let u = raw.trim();
  
  const parts = u.split('://');
  if (parts.length < 2) {
    return u.replace(/\/{2,}/g, '/').replace(/\/$/, '') + '/';
  }
  
  const protocol = parts.shift();
  const rest = parts.join('://');
  const slashIndex = rest.indexOf('/');
  let host = rest;
  let pathPart = '';
  
  if (slashIndex !== -1) {
    host = rest.slice(0, slashIndex);
    pathPart = rest.slice(slashIndex);
  }
  
  pathPart = pathPart.replace(/\/{2,}/g, '/');
  pathPart = pathPart.replace(/\/$/, ''); // Remove trailing slash
  
  // GARANTIR barra final SEMPRE
  return `${protocol}://${host}${pathPart}/`;
}
```

**Passo 1.2:** Adicionar validação extra (linha 175-181)
```javascript
// Aplicar normalização ao endpoint da API se presente
if (envVars['NEXT_PUBLIC_API_URL']) {
  const normalized = normalizeApiUrl(envVars['NEXT_PUBLIC_API_URL']);
  
  // GARANTIR barra final
  const finalUrl = normalized.endsWith('/') ? normalized : normalized + '/';
  
  if (finalUrl !== envVars['NEXT_PUBLIC_API_URL']) {
    console.log(`ℹ️  Normalizando NEXT_PUBLIC_API_URL: '${envVars['NEXT_PUBLIC_API_URL']}' → '${finalUrl}'`);
    envVars['NEXT_PUBLIC_API_URL'] = finalUrl;
  }
}
```

**Teste:**
```bash
cd infra
npm run export-outputs
# Verificar que .env.local tem URL com / no final
cat ../frontend/.env.local | grep API_URL
# Deve mostrar: NEXT_PUBLIC_API_URL=https://...amazonaws.com/prod/
```

### Fase 2: Remover GatewayResponses (3 min)

```bash
# Arquivo: infra/lib/cost-guardian-stack.ts
```

**Passo 2.1:** Deletar linhas 1063-1106 (4 GatewayResponses)

**ANTES:**
```typescript
    // GatewayResponses para adicionar CORS em erros 4xx/5xx
    new apigw.GatewayResponse(this, 'CorsGatewayResponse4xx', {
      // ... 40 linhas ...
    });
```

**DEPOIS:**
```typescript
    // CORS é tratado completamente pelo Express Lambda
    // GatewayResponses removidos para evitar conflito com credentials: true
    // Express retorna headers corretos em todos os casos, incluindo erros
```

**Passo 2.2:** Deploy
```bash
cd infra
npm run build
cdk diff # Verificar que vai DELETAR os 4 GatewayResponses
npm run deploy
```

### Fase 3: Investigar e Corrigir Rota /api/onboard-init (10 min)

**Passo 3.1:** Procurar definição da rota
```bash
cd backend
grep -r "onboard-init" .
# OU no Windows:
findstr /s /i "onboard-init" *.js
```

**Passo 3.2:** Se rota NÃO existir, criar

**Localização:** `backend/routes/onboard.js` ou `backend/handler.js`

**Código:**
```javascript
// GET /api/onboard-init - Retorna configuração para onboarding
app.get('/api/onboard-init', async (req, res) => {
  try {
    const mode = req.query.mode || 'full'; // 'trial' ou 'full'
    const customerId = req.user?.sub; // Se autenticado
    
    // Verificar se já tem onboarding
    let existingOnboard = null;
    if (customerId) {
      const result = await dynamoDb.get({
        TableName: process.env.DYNAMODB_TABLE,
        Key: { id: customerId, sk: 'CONFIG#ONBOARD' }
      }).promise();
      existingOnboard = result.Item;
    }
    
    res.json({
      mode,
      existingConfig: existingOnboard,
      cfnTemplateUrl: process.env.CFN_TEMPLATE_URL,
      // ... outras configs
    });
  } catch (error) {
    console.error('Error in /api/onboard-init:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});
```

**Passo 3.3:** Verificar se rota precisa de auth

**Análise:**
- URL é acessada ANTES de login (no trial mode)
- Logo, NÃO deve ter `authenticateUser` middleware
- Deve ser pública

**Garantir:**
```javascript
// Rota pública - ANTES do middleware authenticateUser
app.get('/api/onboard-init', handlerFunction);

// Rotas protegidas - DEPOIS do middleware
app.use(authenticateUser);
app.get('/api/dashboard', ...);
```

**Passo 3.4:** Testar localmente
```bash
cd backend
npm run dev # Se tiver script dev
# OU testar direto:
node handler.js
```

**Teste HTTP:**
```bash
curl http://localhost:3001/api/onboard-init?mode=trial
# Deve retornar JSON, não 404
```

### Fase 4: Validação e Teste Completo (15 min)

**Passo 4.1:** Rebuild e redeploy completo
```bash
# Backend
cd backend
# (não tem build, código é deployado direto)

# Infra
cd ../infra
npm run build
npm run deploy
```

**Passo 4.2:** Regenerar .env.local
```bash
cd infra
npm run export-outputs
```

**Passo 4.3:** Validar .env.local
```bash
cat ../frontend/.env.local
```

**Esperado:**
```env
NEXT_PUBLIC_API_URL=https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod/
                                                                              ↑
                                                                         DEVE TER /
```

**Passo 4.4:** Testar CORS via curl
```bash
# Teste OPTIONS (preflight)
curl -i -X OPTIONS \
  "https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod/billing/summary" \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Authorization"
```

**Esperado:**
```
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: http://localhost:3000  ← ESPECÍFICO, não *
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD
```

**Passo 4.5:** Testar GET real
```bash
curl -i -X GET \
  "https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod/onboard-init?mode=trial" \
  -H "Origin: http://localhost:3000"
```

**Esperado:**
```
HTTP/1.1 200 OK
Access-Control-Allow-Origin: http://localhost:3000
Content-Type: application/json
{ "mode": "trial", ... }
```

**Passo 4.6:** Testar frontend
```bash
cd frontend
npm run dev
# Abrir http://localhost:3000
```

**Checklist:**
- [ ] Página inicial carrega sem erros
- [ ] Login funciona
- [ ] Dashboard carrega (sem erros CORS)
- [ ] Network tab mostra requests com status 200
- [ ] Network tab mostra headers CORS corretos
- [ ] Não há erro "wildcard '*' when credentials mode is 'include'"
- [ ] /api/onboard-init retorna 200 (não 404)

---

## 🔒 Segurança e Boas Práticas

### 1. Validação de Ambiente

**Arquivo:** `frontend/lib/validate-env.cli.ts`

**Adicionar validação de barra final:**
```typescript
const apiUrl = process.env.NEXT_PUBLIC_API_URL;
if (!apiUrl) {
  throw new Error('NEXT_PUBLIC_API_URL não definida');
}

// Validar formato
if (!apiUrl.startsWith('https://') && !apiUrl.startsWith('http://localhost')) {
  throw new Error('API_URL deve usar HTTPS (ou http://localhost em dev)');
}

// Validar barra final
if (!apiUrl.endsWith('/')) {
  console.warn('⚠️  API_URL deve terminar com / - Corrigindo automaticamente');
  process.env.NEXT_PUBLIC_API_URL = apiUrl + '/';
}
```

### 2. CORS Origins Dinâmicos

**Problema:** Hardcoded origins não escalam

**Solução:** Usar variável de ambiente

**Arquivo:** `backend/handler.js`

```javascript
// LER de variável de ambiente
const allowedOriginsEnv = process.env.ALLOWED_ORIGINS || 'http://localhost:3000';
const allowedOrigins = [
  ...allowedOriginsEnv.split(','),
  /^https:\/\/.+\.execute-api\.us-east-1\.amazonaws\.com$/,
];
```

**Configurar no CDK:**
```typescript
apiHandler.addEnvironment('ALLOWED_ORIGINS', [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://awscostguardian.com',
  'https://www.awscostguardian.com'
].join(','));
```

### 3. Logging para Debug

**Backend:**
```javascript
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[${req.method}] ${req.path}`, {
      origin: req.get('origin'),
      contentType: req.get('content-type')
    });
  }
  next();
});
```

### 4. Health Check

**Adicionar endpoint de health:**
```javascript
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    cors: {
      allowedOrigins: process.env.ALLOWED_ORIGINS,
      credentials: true
    }
  });
});
```

---

## 📊 Automação Completa

### Script de Deploy Completo

**Criar:** `scripts/deploy-full.sh` (ou `.ps1` no Windows)

```bash
#!/bin/bash

echo "🚀 Deploy Completo - AWS Cost Guardian"
echo "======================================="

# 1. Build Infra
echo "📦 1. Building infrastructure..."
cd infra
npm run build
if [ $? -ne 0 ]; then
  echo "❌ Build falhou"
  exit 1
fi

# 2. Deploy CDK
echo "☁️  2. Deploying to AWS..."
npm run deploy
if [ $? -ne 0 ]; then
  echo "❌ Deploy falhou"
  exit 1
fi

# 3. Export outputs (já roda automaticamente após deploy)
echo "✅ 3. .env.local gerado automaticamente"

# 4. Validar .env.local
echo "🔍 4. Validando configuração..."
cd ../frontend
npm run validate-env
if [ $? -ne 0 ]; then
  echo "❌ Validação falhou"
  exit 1
fi

echo ""
echo "✅ Deploy completo!"
echo "📝 Próximo passo: cd frontend && npm run dev"
```

### CI/CD GitHub Actions

**Criar:** `.github/workflows/deploy.yml`

```yaml
name: Deploy AWS Cost Guardian

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Install dependencies
        run: |
          cd infra
          npm ci
      
      - name: Deploy CDK
        run: |
          cd infra
          npm run deploy
      
      - name: Validate environment
        run: |
          cd frontend
          npm run validate-env
```

---

## 🎯 Checklist Final

### Antes de Implementar
- [ ] Backup do código atual (`git commit`)
- [ ] Ler este plano completamente
- [ ] Entender cada mudança

### Durante Implementação
- [ ] Fase 1: export-outputs.js modificado
- [ ] Fase 2: GatewayResponses removidos
- [ ] Fase 3: Rota /api/onboard-init corrigida
- [ ] Fase 4: Testes completos

### Após Implementação
- [ ] .env.local tem URL com `/` final
- [ ] CORS funciona (sem erro wildcard)
- [ ] Todas as rotas retornam 200 (não 404)
- [ ] Frontend carrega dashboard sem erros
- [ ] Documentação atualizada

---

## 📚 Referências

- **CORS Spec:** https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
- **API Gateway CORS:** https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
- **Express CORS:** https://expressjs.com/en/resources/middleware/cors.html

---

**Tempo Estimado Total:** 30-45 minutos  
**Complexidade:** Média  
**Risco:** Baixo (mudanças incrementais com testes)

---

## 📋 STATUS DA IMPLEMENTAÇÃO (ATUALIZADO: 02/11/2025)

**Data da atualização:** 02/11/2025
**STATUS:** Em progresso — melhorias aplicadas em infra e runtime; migração do SDK em andamento; alguns testes e ajustes finais pendentes.

Resumo rápido:
- CORS: ✅ configurado e testado localmente para os fluxos principais.
- Lambda: ✅ correção de bundling aplicada (NodejsFunction) — monitore para regressões 502 em staging. 
- Migração SDK: parcialmente completa — vários handlers (SLA, automations, correlate-health, etc.) migrados para `@aws-sdk` v3; testes adaptados. Temporariamente mantido `aws-sdk` v2 como shim até a migração completa dos testes.
- Testes: suites críticas (SLA, correlate-health, automation-functions, handler) foram adaptadas para v3 e estão passando individualmente; ainda falta rodar toda a suíte completa end-to-end antes de remover o shim.
- Infra: DLQ(s) e remoção/consolidação de GSI aplicada em infra onde seguro.
- ExternalId: implementado onde o código assume roles de clientes (STS AssumeRole agora inclui ExternalId verificável).

### Mudanças realizadas (resumo importante)

- NodejsFunction bundling para o handler da API aplicado no CDK (`infra/lib/cost-guardian-stack.ts`). Resultado: reduz sinais de 502 causados por bundle incorreto.
- `backend/functions/*` — Várias funções migradas para SDK v3 (ex.: `sla-workflow.js`, `correlate-health.js`, `delete-unused-ebs.js`, `recommend-idle-instances.js`, entre outras). Substituídas chamadas `.promise()` por `client.send(new Command(...))` e uso de `DynamoDBDocumentClient.from(...)`.
- `backend/__tests__/*` — Muitos testes atualizados para mockar clientes v3 (mocking de `DocumentClient.from(...).send`, `client.send`, e command constructors). O teste `__tests__/sla-workflow.test.js` foi ajustado e agora está passando (7/7).
- `backend/package.json` — adicionadas dependências `@aws-sdk/*` necessárias (ex.: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/lib-dynamodb`, etc.) e mantido `aws-sdk` v2 temporariamente como shim.
- Infra: adicionados SQS DLQ(s) para lambdas críticas e removido GSI redundante conforme revisão (CDK changes applied).
- ExternalId: implementado onde o código assume roles de clientes (STS AssumeRole agora inclui ExternalId verificável).

### Testes e verificação

- Testes unitários locais executados por arquivo (ex.: `backend/__tests__/sla-workflow.test.js`) passaram após migração dos mocks para v3.
- Próximo marco: rodar a suíte completa do `backend` e ajustar quaisquer testes restantes que dependam do modelo v2. Só então removeremos o `aws-sdk` v2 do `backend/package.json`.

### Pendências / Próximos passos

1. Rodar todos os testes do `backend` (completo) e ajustar mocks restantes (prioridade alta).
2. Remover `aws-sdk` v2 do `backend/package.json` depois que toda a suíte estiver verde.
3. Verificar e adicionar CloudWatch alarms e métricas para lambdas recém-bundleadas (DLQs já adicionadas para lambdas críticas).
4. Revisar e consolidar índices DynamoDB restantes em produção (GSI sweep), se aplicável.
5. CI: atualizar workflows para garantir ambiente compatível com v3 (node flags não devem ser necessários) e garantir instalação correta das dependências.
6. Smoke tests em staging (deploy incremental) e monitoramento dos logs para confirmar ausência de 502s.

### Arquivos-chave alterados (não exaustivo)

- `infra/lib/cost-guardian-stack.ts` — bundling, DLQ, envs
- `infra/scripts/export-outputs.js` — normalização da NEXT_PUBLIC_API_URL (barra final garantida)
- `backend/handler.js` — CORS dinâmico, logging, health endpoint, rota `/api/onboard-init` ajustada
- `backend/functions/sla-workflow.js` — migração para @aws-sdk v3 (Cost Explorer, STS assume role, DynamoDB DocumentClient)
- `backend/functions/correlate-health.js`, `delete-unused-ebs.js`, `recommend-idle-instances.js` — migração v3
- `backend/__tests__/sla-workflow.test.js`, `correlate-health.test.js`, `automation-functions.test.js`, `handler.test.js` — mocks atualizados para SDK v3
- `backend/package.json` — dependências v3 adicionadas; `aws-sdk` v2 mantido temporariamente

### Observações finais

O trabalho principal (infra + migração crítica de runtime + atualização de testes para algumas suítes) está concluído. O foco agora é finalizar a migração dos testes restantes, remover o shim `aws-sdk` v2 e executar a suíte completa no CI. Posso rodar a suíte completa do `backend` agora e aplicar correções onde falhar — quer que eu execute isso em seguida?

- CORS origins são configurados via variável de ambiente para facilitar mudanças sem redeploy
- Logging está habilitado apenas em ambiente de desenvolvimento
