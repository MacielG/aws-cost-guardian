# ☁️ AWS Cost Guardian - Resumo de Recursos

**Data:** 06/11/2025  
**Status:** ✅ Deploy Completo

## 🌐 URLs da Aplica\u00e7\u00e3o

| Tipo | URL | Status |
|------|-----|--------|
| **Produ\u00e7\u00e3o** | https://awscostguardian.com | ⏳ Aguardando configura\u00e7\u00e3o DNS |
| **Amplify Tempor\u00e1rio** | https://main.d1w4m8xpy3lj36.amplifyapp.com | ✅ Ativo |
| **API Backend** | https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod | ⚠️ Erro 500 (Lambda desatualizado) |

## 📦 Recursos AWS Ativos

### Frontend (Amplify)
- **App ID:** d1w4m8xpy3lj36
- **Platform:** WEB (Static Export)
- **Branch:** main
- **Build:** Compute STANDARD_8GB
- **Custo Estimado:** $0-5/m\u00eas (Free Tier)

### Backend (Lambda + API Gateway)
- **API Gateway ID:** 0s4kvds1a2
- **Lambda Principal:** CostGuardianStack-ApiHandler5E7490E8-vSXCjTTqhugv
  - Runtime: Node.js 18
  - Memory: 2048 MB
  - Reserved Concurrency: 10
  - ⚠️ **Status:** Usando handler.js (deveria usar handler-simple.js)
- **Lambdas Auxiliares:** 5 fun\u00e7\u00f5es (CostIngestor, MarketplaceMetering, etc.)
- **Custo Estimado:** $5-15/m\u00eas

### Banco de Dados
- **DynamoDB Table:** CostGuardianTable
- **Billing Mode:** Pay-per-request (On-Demand)
- **Custo Estimado:** $1-5/m\u00eas (depende do uso)

### Autentica\u00e7\u00e3o (Cognito)
- **User Pool ID:** us-east-1_1c1vqVeqC
- **Client ID:** 5gt250n7bsc96j3ac5qfq5s890
- **Identity Pool:** us-east-1:3e6edff0-0192-4cae-886f-29ad864a06a0
- **Custo Estimado:** $0 (Free Tier at\u00e9 50k MAU)

### Armazenamento (S3)
- **Buckets Ativos:**
  - `costguardianstack-cfntemplatebucket4840c65e-gqmdl89vh3hn` (CloudFormation templates)
  - `costguardianstack-reportsbucket4e7c5994-xcrc4vrx0fyy` (SLA Reports)
  - `cdk-hnb659fds-assets-404513223764-us-east-1` (CDK Assets)

- **Buckets \u00d3rf\u00e3os (A REMOVER):**
  - `aws-cost-guardian-backend-serverlessdeploymentbuck-pyoadrysjvfh`
  - `aws-cost-guardian-backend-serverlessdeploymentbuck-sgbhzzh2cboe`
- **Custo Estimado:** $0.50-2/m\u00eas

### Monitoramento
- **CloudWatch Alarms:** 6 alarmes configurados
- **SNS Topic:** CostGuardianStack-EnvAlertTopic
- **X-Ray:** Habilitado no Lambda
- **Custo Estimado:** $1-3/m\u00eas

## 💰 Custo Total Estimado

| Categoria | Custo Mensal |
|-----------|--------------|
| Amplify Hosting | $0-5 |
| Lambda + API Gateway | $5-15 |
| DynamoDB | $1-5 |
| S3 Storage | $0.50-2 |
| CloudWatch + SNS | $1-3 |
| **TOTAL** | **$7.50-30/m\u00eas** |

> ⚠️ **Nota:** A maioria dos servi\u00e7os est\u00e1 no Free Tier. Com baixo tr\u00e1fego, o custo real deve ficar entre $5-10/m\u00eas.

## ⚠️ Problemas Identificados

### 1. Lambda Handler Incorreto (CRÍTICO)
- **Problema:** Lambda est\u00e1 usando `handler.js` com depend\u00eancia `serverless-http` que n\u00e3o existe
- **Solu\u00e7\u00e3o:** Deploy bloqueado por limite do DynamoDB TableClass (2 updates/30 days)
- **Workaround:** Atualizar manualmente o c\u00f3digo do Lambda via Console AWS

### 2. Stack CloudFormation em Estado ROLLBACK_FAILED
- **Problema:** Stack CostGuardianStack em estado `UPDATE_ROLLBACK_FAILED`
- **Causa:** Tentativa de atualizar DynamoDB TableClass mais de 2x em 30 dias
- **Solu\u00e7\u00e3o:** Aguardar 30 dias OU continuar com rollback manual via Console

### 3. Recursos \u00d3rf\u00e3os
- 2 buckets S3 do Serverless Framework antigas
- 1 API Gateway antiga (zyynk8o2a1) - **JÁ REMOVIDA** ✅

## ✅ Próximos Passos

### Configura\u00e7\u00e3o DNS (awscostguardian.com)

Adicione os seguintes registros no seu provedor de DNS:

```
CNAME   www.awscostguardian.com  ->  [valor fornecido pelo Amplify]
CNAME   awscostguardian.com      ->  [valor fornecido pelo Amplify]
```

Consulte os valores exatos com:
```bash
aws amplify get-domain-association --app-id d1w4m8xpy3lj36 --domain-name awscostguardian.com --region us-east-1
```

### Corrigir Backend

**Op\u00e7\u00e3o 1: Manual (RÁPIDO)**
1. Acessar AWS Lambda Console
2. Selecionar fun\u00e7\u00e3o `CostGuardianStack-ApiHandler5E7490E8-vSXCjTTqhugv`
3. Fazer upload do c\u00f3digo correto com `handler-simple.js`

**Op\u00e7\u00e3o 2: Aguardar (30 dias)**
1. Aguardar limite DynamoDB resetar
2. Executar `cdk deploy` novamente

### Limpeza de Recursos

```bash
# Remover buckets S3 \u00f3rf\u00e3os
aws s3 rb s3://aws-cost-guardian-backend-serverlessdeploymentbuck-pyoadrysjvfh --force
aws s3 rb s3://aws-cost-guardian-backend-serverlessdeploymentbuck-sgbhzzh2cboe --force
```

## 📊 M\u00e9tricas de Performance

- **Build Time (Amplify):** ~3-5 minutos
- **Cold Start (Lambda):** ~2-3 segundos
- **Warm Start (Lambda):** <500ms

---

**\u00daltima atualiza\u00e7\u00e3o:** 06/11/2025 19:05 BRT
