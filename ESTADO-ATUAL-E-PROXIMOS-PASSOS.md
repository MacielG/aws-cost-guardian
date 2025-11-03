# 📊 Estado Atual do Projeto e Próximos Passos

**Data:** 02 de Novembro de 2025  
**Versão:** 1.0  
**Projeto:** AWS Cost Guardian

---

## 🎯 Visão Geral Executiva

O AWS Cost Guardian é uma plataforma SaaS de otimização de custos AWS com arquitetura CDK, frontend Next.js e backend serverless. O projeto está **90% funcional**, com CORS corrigido mas enfrentando erro **502 Bad Gateway** na API Lambda devido a problemas de empacotamento de dependências.

### Status Geral
- ✅ **CORS:** Totalmente corrigido
- ✅ **Infraestrutura CDK:** Deployada com sucesso
- ✅ **Frontend:** Funcional (localhost:3000)
- ⚠️ **Backend Lambda:** Erro 502 (dependências não empacotadas)
- ⚠️ **Migração SDK:** 60% completa (handler.js ✅, functions/ parcial)
- ❌ **Segurança:** ExternalId faltando no AssumeRole (CRÍTICO)

---

## 🏗️ Arquitetura Atual

```
┌─────────────────────────────────────────────────────────────┐
│                     FRONTEND (Amplify)                      │
│  Next.js 14 + Tailwind + Cognito Auth + i18n              │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS + CORS
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              API GATEWAY (REST API)                         │
│  - CORS dinâmico (ALLOWED_ORIGINS)                         │
│  - JWT Authorizer (Cognito)                                │
│  - Lambda Integration                                       │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                 LAMBDA: ApiHandler                          │
│  Runtime: Node.js 18                                        │
│  Handler: handler.app (Express + serverless-http)          │
│  ⚠️ VPC: PRIVATE_WITH_EGRESS (desnecessário!)              │
│  ❌ Problema: node_modules não empacotado corretamente      │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  DynamoDB │ Secrets Manager │ Stripe │ Step Functions     │
└─────────────────────────────────────────────────────────────┘
```

---

## ✅ O Que Está Funcionando

### 1. CORS (100% Corrigido)
- ✅ Backend: CORS dinâmico via `ALLOWED_ORIGINS`
- ✅ CDK: `allowOrigins` específicas, credentials: true
- ✅ Preflight OPTIONS sem autenticação
- ✅ Headers corretos: `Access-Control-Allow-Credentials: true`
- ✅ Teste curl: 204 No Content (perfeito)

### 2. Infraestrutura AWS
- ✅ Stack CDK: `CostGuardianStack` deployada
- ✅ API Gateway: `https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod`
- ✅ DynamoDB: `CostGuardianTable` com 6 GSIs
- ✅ Cognito: User Pool + Identity Pool configurados
- ✅ S3: Buckets para templates e relatórios
- ✅ EventBridge: Regras de ingestão diária (05:00 UTC)
- ✅ Step Functions: Workflow SLA implementado

### 3. Migração SDK v3
- ✅ **handler.js:** 100% migrado para @aws-sdk v3
- ✅ **ingest-costs.js:** 100% migrado
- ⚠️ **demais functions/:** Ainda em aws-sdk v2

---

## ❌ Problemas Críticos

### 🔴 1. Erro 502 Bad Gateway na API Lambda
**Causa Raiz:** Lambda não encontra dependências do aws-sdk

**Evidência:**
```bash
curl https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod/api/health
# Retorna: {"message": "Internal server error"} (502)
```

**Motivo:** 
- CDK usa `lambda.Function` com `Code.fromAsset(backendPath)`
- O diretório `backend/` tem aws-sdk como `extraneous` (não no package.json)
- Runtime Node 18 tem aws-sdk v2 builtin, mas código usa @aws-sdk v3
- node_modules não está sendo empacotado corretamente

**Impacto:** API completamente inacessível

---

### 🔴 2. Segurança: ExternalId Ausente (CRÍTICO)

**Problema:** AssumeRole não passa `ExternalId`, permitindo **Confused Deputy Attack**

**Código Atual (INSEGURO):**
```javascript
// backend/handler.js - getAssumedClients()
const command = new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: 'GuardianAdvisorExecution',
    DurationSeconds: 900,
    // ❌ FALTA: ExternalId
});
```

**Correto:**
```javascript
const command = new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: 'GuardianAdvisorExecution',
    DurationSeconds: 900,
    ExternalId: externalId, // ✅ Buscar de CONFIG#ONBOARD
});
```

**Impacto:** Vulnerabilidade de segurança grave

---

### ⚠️ 3. VPC Desnecessária nas Lambdas

**Problema:** Lambdas em VPC causam:
- Cold start lento (5-10s)
- Dependência de NAT Gateway ($$$)
- Possíveis timeouts/falhas de rede

**Lambdas com VPC (sem necessidade):**
- ApiHandler (só chama DynamoDB/Secrets/Stripe - serviços públicos AWS)
- CostIngestor
- SLA Workflow handlers
- execute-recommendation

**Quando usar VPC:**
- ✅ Acesso a RDS privado
- ✅ Acesso a recursos EC2 em VPC privada
- ❌ Chamadas a serviços AWS públicos (DynamoDB, S3, etc.)

---

### ⚠️ 4. DynamoDB: GSIs Redundantes

**Duplicação Identificada:**
```typescript
// CustomerDataIndex
pk: 'id', sk: 'sk'

// RecommendationsIndex  
pk: 'id', sk: 'sk'  // ❌ IDÊNTICO!
```

**Impacto:**
- Custo duplicado de armazenamento
- Overhead de escrita (cada write = 2x WCU)

**Solução:** Remover `RecommendationsIndex`, usar `CustomerDataIndex` com filtro por prefixo `sk.startsWith('RECO#')`

---

### ⚠️ 5. Migração SDK Incompleta

**Arquivos Ainda em aws-sdk v2:**
```
backend/functions/sla-workflow.js          ❌
backend/functions/sla-submit-ticket.js     ❌
backend/functions/sla-generate-pdf.js      ❌
backend/functions/correlate-health.js      ❌
backend/functions/execute-recommendation.js ❌
backend/functions/delete-unused-ebs.js     ❌
backend/functions/marketplace-metering.js  ❌
backend/functions/recommend-*.js           ❌
```

**Problema:** Mistura de v2 e v3 aumenta bundle size e pode causar conflitos

---

## 🎯 Plano de Ação Priorizado

### 📍 FASE 1: Correções Críticas (Alta Prioridade - 1-2 dias)

#### 1.1 Resolver Erro 502 - Empacotamento Lambda
**Prioridade:** 🔴 CRÍTICA  
**Tempo:** 2-4 horas

**Opção A: NodejsFunction (Recomendado)**
```typescript
// infra/lib/cost-guardian-stack.ts
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

const apiHandlerLambda = new NodejsFunction(this, 'ApiHandler', {
  entry: path.join(backendPath, 'handler.js'),
  handler: 'app',
  runtime: lambda.Runtime.NODEJS_18_X,
  bundling: {
    externalModules: [], // Bundla tudo
    minify: false, // Para debug
    sourceMap: true,
  },
  // ✅ SEM VPC!
  memorySize: 1024,
  timeout: cdk.Duration.seconds(29),
  environment: { /* ... */ },
});
```

**Opção B: Asset Bundling Manual**
```bash
cd backend
npm install --production
cd ..
# CDK automaticamente inclui node_modules
```

**Checklist:**
- [ ] Remover `vpc`, `securityGroups`, `vpcSubnets` do ApiHandler
- [ ] Trocar `lambda.Function` → `NodejsFunction`
- [ ] Testar localmente: `cd backend && npm install && node -e "require('./handler')"`
- [ ] Deploy: `cd infra && npm run deploy`
- [ ] Testar: `curl https://API/prod/api/health`

---

#### 1.2 Adicionar ExternalId ao AssumeRole
**Prioridade:** 🔴 CRÍTICA (Segurança)  
**Tempo:** 1-2 horas

**Mudanças Necessárias:**

**a) backend/handler.js - getAssumedClients()**
```javascript
// ANTES
async function getAssumedClients(roleArn, region = 'us-east-1') {
    const sts = new STSClient({});
    const command = new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: 'GuardianAdvisorExecution',
        DurationSeconds: 900,
    });
    // ...
}

// DEPOIS
async function getAssumedClients(roleArn, externalId, region = 'us-east-1') {
    if (!externalId) {
        throw new Error('ExternalId is required for AssumeRole');
    }
    const sts = new STSClient({});
    const command = new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: 'GuardianAdvisorExecution',
        DurationSeconds: 900,
        ExternalId: externalId, // ✅ CRÍTICO!
    });
    // ...
}
```

**b) Buscar externalId do DynamoDB antes de assumir role**
```javascript
// Em qualquer endpoint que chama getAssumedClients():
const config = await dynamoDb.send(new GetCommand({
    TableName: process.env.DYNAMODB_TABLE,
    Key: { id: userId, sk: 'CONFIG#ONBOARD' }
}));

const externalId = config.Item?.externalId;
if (!externalId) {
    throw new Error('ExternalId not found for user');
}

const clients = await getAssumedClients(roleArn, externalId, region);
```

**c) Aplicar em TODAS as functions que usam AssumeRole**
- backend/handler.js ✅
- backend/functions/ingest-costs.js ❌
- backend/functions/sla-workflow.js ❌
- backend/functions/execute-recommendation.js ❌

**Checklist:**
- [ ] Atualizar getAssumedClients() para exigir externalId
- [ ] Buscar externalId de CONFIG#ONBOARD antes de assumir role
- [ ] Atualizar TODAS as chamadas (handler + functions)
- [ ] Testar: verificar logs CloudWatch mostrando AssumeRole com ExternalId
- [ ] Documentar no README do cliente

---

#### 1.3 Completar Migração SDK v3
**Prioridade:** 🟠 ALTA  
**Tempo:** 3-4 horas

**Estratégia:** Migrar apenas arquivos usados em produção

**Arquivos Prioritários:**
1. `sla-workflow.js` (mix v2/v3 - urgente!)
2. `correlate-health.js` (EventBridge handler)
3. `execute-recommendation.js` (automação)

**Template de Migração:**
```javascript
// ANTES (v2)
const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const response = await dynamoDb.get(params).promise();

// DEPOIS (v3)
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const dynamoDb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const response = await dynamoDb.send(new GetCommand(params));
```

**Checklist:**
- [ ] sla-workflow.js: Migrar DynamoDB + S3
- [ ] correlate-health.js: Migrar completo
- [ ] execute-recommendation.js: Migrar completo
- [ ] Verificar: `grep -r "require('aws-sdk')" backend/functions/`
- [ ] Testar localmente (se possível)

---

### 📍 FASE 2: Otimizações e Limpeza (Média Prioridade - 2-3 dias)

#### 2.1 Remover VPC das Lambdas
**Prioridade:** 🟡 MÉDIA  
**Tempo:** 1 hora

**Lambdas para Atualizar:**
```typescript
// infra/lib/cost-guardian-stack.ts

// ApiHandler
const apiHandlerLambda = new NodejsFunction(this, 'ApiHandler', {
  // ❌ REMOVER:
  // vpc,
  // securityGroups: [lambdaSecurityGroup],
  // vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
});

// CostIngestor
const costIngestor = new lambda.Function(this, 'CostIngestor', {
  // ❌ REMOVER VPC
});

// Manter VPC SOMENTE se precisar acessar recursos privados
```

**Benefícios:**
- ⚡ Cold start: 5s → <1s
- 💰 Economia: Sem NAT Gateway ($0.045/hora)
- 🛡️ Menos pontos de falha

**Checklist:**
- [ ] Identificar Lambdas que NÃO precisam VPC
- [ ] Remover vpc/securityGroups/vpcSubnets do CDK
- [ ] Deploy incremental (uma Lambda por vez)
- [ ] Monitorar: verificar que continua funcionando
- [ ] Documentar decisão

---

#### 2.2 Consolidar GSIs do DynamoDB
**Prioridade:** 🟡 MÉDIA  
**Tempo:** 2 horas  
**Risco:** 🔴 Requer reprocessamento de dados

**Ação:**
```typescript
// infra/lib/cost-guardian-stack.ts

// ❌ REMOVER (duplicado):
// {
//   indexName: 'RecommendationsIndex',
//   partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
//   sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
// }

// ✅ MANTER CustomerDataIndex e usar filtros:
const recommendations = await dynamoDb.send(new QueryCommand({
  TableName: TABLE_NAME,
  IndexName: 'CustomerDataIndex',
  KeyConditionExpression: 'id = :id AND begins_with(sk, :prefix)',
  ExpressionAttributeValues: {
    ':id': userId,
    ':prefix': 'RECO#'
  }
}));
```

**Atenção:** Remover GSI em produção pode causar downtime!

**Checklist:**
- [ ] Auditoria: verificar se RecommendationsIndex está sendo usado
- [ ] Atualizar código para usar CustomerDataIndex
- [ ] Testar em dev/staging
- [ ] Remover índice do CDK
- [ ] Deploy (DynamoDB recria índice automaticamente)

---

#### 2.3 Adicionar DLQs e CloudWatch Alarms
**Prioridade:** 🟡 MÉDIA  
**Tempo:** 3-4 horas

**DLQs (Dead Letter Queues):**
```typescript
// Para Lambdas assíncronas
const dlq = new sqs.Queue(this, 'LambdaDLQ', {
  retentionPeriod: cdk.Duration.days(14),
});

const costIngestor = new lambda.Function(this, 'CostIngestor', {
  deadLetterQueue: dlq,
  deadLetterQueueEnabled: true,
  retryAttempts: 2,
});
```

**CloudWatch Alarms:**
```typescript
// API Gateway 5xx
const api5xxAlarm = new cloudwatch.Alarm(this, 'Api5xxAlarm', {
  metric: api.metricServerError(),
  threshold: 10,
  evaluationPeriods: 2,
  alarmDescription: 'API Gateway 5xx errors',
});

// Lambda Errors
const lambdaErrorAlarm = new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
  metric: apiHandlerLambda.metricErrors(),
  threshold: 5,
  evaluationPeriods: 1,
});

// SNS para notificações
api5xxAlarm.addAlarmAction(new cw_actions.SnsAction(alarmTopic));
```

**Checklist:**
- [ ] Criar SQS DLQ
- [ ] Adicionar DLQ a Lambdas assíncronas
- [ ] Criar CloudWatch Alarms (5xx, Errors, Latency)
- [ ] Configurar SNS para alertas
- [ ] Testar: forçar erro e verificar DLQ

---

#### 2.4 Revisar EventBusPolicy e S3 Buckets
**Prioridade:** 🟢 BAIXA  
**Tempo:** 1-2 horas

**EventBusPolicy:**
```typescript
// Revisar necessidade de Principal: '*'
// Restringir por contas específicas se possível
new events.CfnEventBusPolicy(this, 'EventBusPolicy', {
  statementId: 'AllowCrossAccountEvents',
  principal: '123456789012', // ✅ Conta específica
  // ❌ EVITAR: principal: '*'
});
```

**CfnTemplateBucket:**
```typescript
// Remover website hosting se não necessário
const templateBucket = new s3.Bucket(this, 'CfnTemplateBucket', {
  versioned: true,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // ✅
  // ❌ REMOVER se não precisa:
  // websiteIndexDocument: 'template.yaml'
});

// Usar presigned URL para compartilhar template
const url = s3.getSignedUrl('getObject', {
  Bucket: templateBucket.bucketName,
  Key: 'template.yaml',
  Expires: 3600,
});
```

---

### 📍 FASE 3: Auditoria e Limpeza de Recursos (1 dia)

#### 3.1 Auditar Recursos AWS Duplicados/Abandonados
**Prioridade:** 🟠 ALTA (Custo)  
**Tempo:** 2-3 horas

**Comandos de Auditoria:**
```bash
# Listar todas as stacks
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE

# Buscar stacks antigas/duplicadas
aws cloudformation describe-stacks --query "Stacks[?contains(StackName, 'Cost') || contains(StackName, 'Guardian')]"

# Verificar recursos órfãos
aws ec2 describe-vpcs --filters "Name=tag:Project,Values=CostGuardian"
aws dynamodb list-tables | grep -i cost
aws s3 ls | grep -i cost
aws lambda list-functions | grep -i cost

# NAT Gateways (CUSTO ALTO!)
aws ec2 describe-nat-gateways --filter "Name=state,Values=available"
```

**Checklist de Limpeza:**
- [ ] Identificar stacks antigas/duplicadas
- [ ] Verificar NAT Gateways não utilizados ($0.045/hora = $32/mês!)
- [ ] Buckets S3 vazios ou não utilizados
- [ ] Lambdas órfãs (sem trigger)
- [ ] CloudWatch Log Groups antigos (retention)
- [ ] DynamoDB tables duplicadas
- [ ] VPCs não utilizadas
- [ ] Elastic IPs não associados ($0.005/hora)

**Script de Auditoria:**
```bash
# Criar script de auditoria
cat > audit-resources.sh << 'EOF'
#!/bin/bash
echo "=== AWS Cost Guardian - Auditoria de Recursos ==="
echo ""
echo "Stacks CloudFormation:"
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query "StackSummaries[?contains(StackName, 'Cost')].{Name:StackName,Status:StackStatus,Created:CreationTime}" \
  --output table

echo ""
echo "NAT Gateways (CUSTO: ~$32/mês cada):"
aws ec2 describe-nat-gateways --filter "Name=state,Values=available" \
  --query "NatGateways[].{ID:NatGatewayId,VPC:VpcId,State:State}" \
  --output table

echo ""
echo "Buckets S3:"
aws s3 ls | grep -i cost

echo ""
echo "Lambdas:"
aws lambda list-functions --query "Functions[?contains(FunctionName, 'Cost')].FunctionName" --output table

echo ""
echo "DynamoDB Tables:"
aws dynamodb list-tables --query "TableNames[?contains(@, 'Cost')]" --output table

echo ""
echo "Elastic IPs não associados (CUSTO: $0.005/hora):"
aws ec2 describe-addresses --query "Addresses[?AssociationId==null].PublicIp" --output table

echo ""
echo "=== Fim da Auditoria ==="
EOF

chmod +x audit-resources.sh
./audit-resources.sh > audit-report.txt
```

---

#### 3.2 Remover Recursos Duplicados
**Prioridade:** 🟠 ALTA  
**Tempo:** 1-2 horas

**CUIDADO:** Sempre fazer backup antes de deletar!

```bash
# ANTES de deletar QUALQUER recurso:
# 1. Exportar configurações
aws cloudformation describe-stacks --stack-name OLD_STACK > backup-old-stack.json

# 2. Deletar stack antiga (SE CONFIRMADO que não está em uso)
aws cloudformation delete-stack --stack-name OLD_STACK

# 3. Aguardar conclusão
aws cloudformation wait stack-delete-complete --stack-name OLD_STACK

# 4. Verificar órfãos (recursos que não foram deletados)
# Ex: S3 buckets com versionamento (precisam ser esvaziados primeiro)
```

**Checklist:**
- [ ] Backup de todas as configurações
- [ ] Identificar recursos órfãos
- [ ] Deletar stacks antigas (via CloudFormation se possível)
- [ ] Esvaziar e deletar S3 buckets não utilizados
- [ ] Liberar Elastic IPs
- [ ] Deletar Log Groups antigos
- [ ] Verificar custos após limpeza (AWS Cost Explorer)

---

### 📍 FASE 4: Deploy e Testes (1 dia)

#### 4.1 Deploy Completo
```bash
# 1. Instalar dependências
cd backend && npm install && cd ..
cd infra && npm install && cd ..
cd frontend && npm install && cd ..

# 2. Build
cd infra && npm run build

# 3. Deploy
npm run deploy

# 4. Exportar outputs para frontend
node scripts/export-outputs.js
```

#### 4.2 Testes End-to-End

**a) Health Check:**
```bash
curl -v https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod/api/health
# Esperado: 200 OK { "status": "ok" }
```

**b) CORS Preflight:**
```bash
curl -v -X OPTIONS \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type,Authorization" \
  https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod/api/onboard-init
# Esperado: 204 No Content com headers CORS
```

**c) Onboard Init (Trial):**
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"email":"test@example.com","awsAccountId":"123456789012"}' \
  https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod/api/onboard-init
# Esperado: 200 OK com externalId e templateUrl
```

**d) Frontend Login:**
```bash
# No browser:
# 1. http://localhost:3000
# 2. Login com Cognito
# 3. Verificar dashboard carrega
# 4. Testar navegação entre páginas
```

**e) CloudWatch Logs:**
```bash
# Verificar logs da Lambda
aws logs tail /aws/lambda/CostGuardianStack-ApiHandler* --follow

# Verificar métricas
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=CostGuardianStack-ApiHandler* \
  --start-time 2025-11-02T00:00:00Z \
  --end-time 2025-11-02T23:59:59Z \
  --period 3600 \
  --statistics Sum
```

---

## 📋 Checklist Completo de Ação

### ✅ Imediato (Hoje/Amanhã)
- [ ] Resolver erro 502 (Opção A: NodejsFunction sem VPC)
- [ ] Adicionar ExternalId a todos os AssumeRole
- [ ] Completar migração SDK v3 (arquivos críticos)
- [ ] Testar health check e onboard-init
- [ ] Verificar logs CloudWatch

### ⏳ Curto Prazo (Esta Semana)
- [ ] Remover VPC de Lambdas que não precisam
- [ ] Consolidar GSIs duplicados
- [ ] Adicionar DLQs nas Lambdas assíncronas
- [ ] Configurar CloudWatch Alarms básicos
- [ ] Testar fluxo completo end-to-end

### 📅 Médio Prazo (Próximas 2 Semanas)
- [ ] Auditoria completa de recursos AWS
- [ ] Remover recursos duplicados/abandonados
- [ ] Revisar EventBusPolicy e S3 buckets
- [ ] Implementar monitoramento avançado
- [ ] Documentação completa (README, AGENTS.md)

### 🎯 Longo Prazo (Próximo Mês)
- [ ] Testes automatizados (Jest)
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Performance tuning
- [ ] Security audit completo
- [ ] Preparação para produção

---

## 🛡️ Segurança - Checklist

- [ ] **ExternalId em TODOS os AssumeRole** (CRÍTICO!)
- [ ] IAM roles com mínimo privilégio
- [ ] Secrets no Secrets Manager (nunca hardcoded)
- [ ] CORS restrito a origens conhecidas
- [ ] API Gateway com rate limiting
- [ ] Lambda timeout < 30s
- [ ] CloudWatch Logs com retention policy
- [ ] S3 buckets com Block Public Access
- [ ] DynamoDB com encryption at rest (KMS)
- [ ] VPC com Security Groups restritos (se usar VPC)

---

## 💰 Custos Estimados Atuais vs. Otimizados

| Recurso | Atual (mês) | Otimizado (mês) | Economia |
|---------|-------------|-----------------|----------|
| NAT Gateway (2x) | $64 | $0 | **-$64** |
| DynamoDB (GSIs duplicados) | ~$10 | ~$5 | **-$5** |
| Lambda (VPC cold starts) | ~$20 | ~$10 | **-$10** |
| CloudWatch Logs | ~$5 | ~$3 | **-$2** |
| **TOTAL** | **$99** | **$18** | **-$81 (82%)** |

**Nota:** Valores estimados para baixo tráfego (dev/staging). Produção terá custos maiores.

---

## 📞 Próximos Passos Recomendados

### Hoje (Prioridade Máxima):
1. **Resolver 502:** NodejsFunction + remover VPC do ApiHandler
2. **Segurança:** Adicionar ExternalId em handler.js
3. **Teste básico:** `curl /api/health` deve retornar 200

### Amanhã:
1. Completar migração SDK v3 (sla-workflow.js, correlate-health.js)
2. Deploy completo e teste end-to-end
3. Iniciar auditoria de recursos

### Esta Semana:
1. Implementar DLQs e Alarms
2. Consolidar GSIs
3. Limpar recursos duplicados
4. Documentação final

---

## 📚 Documentação de Referência

- [CORS-FIX-SUMMARY.md](./CORS-FIX-SUMMARY.md) - Correções CORS aplicadas
- [CORRECOES-APLICADAS.md](./CORRECOES-APLICADAS.md) - Histórico de correções
- [como-funciona.md](./como-funciona.md) - Arquitetura do sistema
- [README.md](./README.md) - Documentação geral

---

**Última Atualização:** 02/11/2025  
**Responsável:** Equipe de Desenvolvimento  
**Status:** 🟡 Em Progresso (90% funcional, correções críticas pendentes)
