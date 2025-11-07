# Backend Development Guide

## 🏗️ Arquitetura

O backend do AWS Cost Guardian é **serverless** e roda na **AWS Lambda** via API Gateway.

- **Framework**: Express.js com `serverless-http`
- **Deploy**: AWS Lambda + API Gateway via CDK
- **Database**: DynamoDB
- **Auth**: AWS Cognito (validação JWT)

## 🚀 Como Executar

### Opção 1: Serverless Offline (Recomendado para Dev Local)

```bash
cd backend
npm install
npm run offline
```

Isso iniciará um servidor local que simula o Lambda na porta 3000.

### Opção 2: Deploy na AWS

```bash
cd backend
npm run deploy
```

Ou use o CDK na raiz do projeto:

```bash
cd infra
cdk deploy
```

## ⚠️ Por Que Não Há `npm run dev` Tradicional?

Este backend **não é um servidor Node.js tradicional**. Ele usa:

- `serverless-http` para adaptar Express para Lambda
- Variáveis de ambiente fornecidas pela AWS Lambda
- Recursos AWS (DynamoDB, Secrets Manager, etc.) que precisam estar configurados

**Não é possível rodar simplesmente com `node handler.js`** porque:

1. Faltam variáveis de ambiente (USER_POOL_ID, DYNAMODB_TABLE, etc.)
2. Precisa de credenciais AWS configuradas
3. Precisa de recursos AWS (DynamoDB, Cognito, etc.)

## 🔧 Desenvolvimento Local

### Usando Serverless Offline

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Configure credenciais AWS:
   ```bash
   aws configure
   ```

3. Crie um arquivo `serverless.yml` (se não existir):
   ```yaml
   service: cost-guardian-backend
   
   provider:
     name: aws
     runtime: nodejs18.x
     region: us-east-1
     environment:
       DYNAMODB_TABLE: ${env:DYNAMODB_TABLE}
       USER_POOL_ID: ${env:USER_POOL_ID}
       USER_POOL_CLIENT_ID: ${env:USER_POOL_CLIENT_ID}
   
   functions:
     api:
       handler: handler.handler
       events:
         - http:
             path: /{proxy+}
             method: ANY
   
   plugins:
     - serverless-offline
   ```

4. Execute:
   ```bash
   npm run offline
   ```

### Usando o Frontend Contra a AWS

A forma **mais fácil** é apontar o frontend para a API já deployada na AWS:

```env
# frontend/.env.local
NEXT_PUBLIC_API_URL=https://fw5woyjdw6.execute-api.us-east-1.amazonaws.com/prod/
```

## 📋 Variáveis de Ambiente Necessárias

O backend precisa das seguintes variáveis (fornecidas automaticamente pela Lambda quando deployado):

```bash
# AWS Services
DYNAMODB_TABLE=CostGuardianTable
USER_POOL_ID=us-east-1_bYYJpnkWn
USER_POOL_CLIENT_ID=2p3ucdspq8eptvot6tv0hhnsb
AWS_REGION=us-east-1

# Stripe
STRIPE_SECRET_ARN=arn:aws:secretsmanager:us-east-1:...
STRIPE_WEBHOOK_SECRET=whsec_...

# CloudFormation
CFN_TEMPLATE_URL=https://...
```

## 🧪 Testes

```bash
npm test
```

Os testes usam mocks dos serviços AWS e não precisam de credenciais reais.

## 📦 Estrutura do Código

```
backend/
├── handler.js              # Express app + Lambda handler
├── functions/              # Funções Lambda auxiliares
│   ├── analyze-costs.js    # Análise de custos
│   ├── detect-incidents.js # Detecção de incidentes
│   └── generate-claim.js   # Geração de claims
├── __tests__/              # Testes unitários
└── integration-tests/      # Testes de integração
```

## 🔐 Autenticação

O backend valida tokens JWT do Cognito:

```javascript
// Middleware automático em handler.js
app.use(authenticateUser);

// Rotas protegidas automaticamente
app.get('/api/dashboard/costs', async (req, res) => {
  const userId = req.user.sub; // Extraído do token
  // ...
});
```

## 🚀 Workflow Completo

1. **Desenvolvimento Local (Frontend)**:
   ```bash
   cd frontend
   npm run dev
   ```
   Frontend aponta para API na AWS (`.env.local`)

2. **Modificações no Backend**:
   - Edite `handler.js` ou `functions/`
   - Execute testes: `npm test`
   - Deploy: `cd ../infra && cdk deploy`

3. **Teste End-to-End**:
   - Frontend local → API na AWS
   - Sem necessidade de rodar backend localmente

## 💡 Dicas

- Use **CloudWatch Logs** para debug de Lambda em produção
- Use `serverless offline` apenas se precisar testar integrações AWS localmente
- Prefira **testes unitários** para desenvolvimento rápido
- Use **CDK** para deploy (não serverless framework)
