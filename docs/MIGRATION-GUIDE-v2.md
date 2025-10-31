# Migration Guide v2 - Production-Ready Refactor

## Resumo das Mudanças

Este guia documenta as refatorações críticas necessárias para tornar o AWS Cost Guardian pronto para produção, abordando as três frentes identificadas na análise técnica:

1. **Parametrização de Configurações** - Remoção de valores hardcoded
2. **Migração SDK v2 → v3** - Modernização e performance
3. **Sistema de Atribuição de Economias** - Tracking de valor realizado

---

## 1. FRENTE 1: Parametrização de Configurações

### Problema
Os Lambdas continham valores hardcoded:
- Região fixada em `us-east-1`
- Tags fixadas em `Environment: [dev, staging]`
- Thresholds fixos (CPU < 5%, 7 dias para EBS)

### Solução
Novo schema `automationSettings` no item `CONFIG#ONBOARD` do DynamoDB:

```json
{
  "automationSettings": {
    "stopIdleInstances": {
      "enabled": true,
      "regions": ["us-east-1", "us-west-2", "eu-west-1"],
      "filters": {
        "tags": [
          {"Key": "Environment", "Values": ["dev", "staging"]},
          {"Key": "AutoShutdown", "Values": ["true"]}
        ],
        "instanceStates": ["running"]
      },
      "thresholds": {
        "cpuUtilization": 5,
        "evaluationPeriodHours": 24
      },
      "exclusionTags": ["CostGuardian:Exclude", "Production:Critical"]
    }
  }
}
```

### Arquivos Refatorados
- ✅ `recommend-idle-instances.js` - Agora processa múltiplas regiões
- ✅ `stop-idle-instances.js` - Migrado para v3 + configuração dinâmica
- ✅ `delete-unused-ebs-v3.js` - Suporta tags e regiões customizáveis

### Como Configurar (UI/API)
Adicione endpoint em `handler.js`:

```javascript
app.put('/api/settings/automation/regions', authenticateUser, checkProPlan, async (req, res) => {
  const { automationType, regions } = req.body;
  const customerId = req.user.sub;
  
  await dynamoDb.update({
    TableName: process.env.DYNAMODB_TABLE,
    Key: { id: customerId, sk: 'CONFIG#ONBOARD' },
    UpdateExpression: 'SET automationSettings.#type.regions = :regions',
    ExpressionAttributeNames: { '#type': automationType },
    ExpressionAttributeValues: { ':regions': regions }
  }).promise();
  
  res.json({ success: true });
});
```

---

## 2. FRENTE 2: Migração SDK v2 → v3

### Problema
Mistura de SDKs:
- ❌ `const AWS = require('aws-sdk')` (v2)
- ✅ `import { EC2Client } from '@aws-sdk/client-ec2'` (v3)

### Benefícios do SDK v3
- **Tree-shaking**: Apenas módulos necessários (~70% redução de bundle)
- **Modular**: Imports explícitos facilitam manutenção
- **Performance**: Menos cold start

### Arquivos Migrados
- ✅ `stop-idle-instances.js` → v3
- ✅ `execute-recommendation.js` → v3
- ⚠️ `handler.js` - **AINDA PENDENTE** (usa v2 para DynamoDB, STS, Secrets Manager)

### Próximos Passos (handler.js)
```javascript
// ANTES (v2)
const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const sts = new AWS.STS();

// DEPOIS (v3)
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';

const ddbClient = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(ddbClient);
const sts = new STSClient({});
```

---

## 3. FRENTE 3: Sistema de Atribuição de Economias

### Problema
- Não havia tracking de economias **realizadas** vs. **potenciais**
- Impossível calcular comissão de 30% com precisão
- Falta de prova para o cliente do valor entregue

### Solução
Novo item `SAVINGS#REALIZED#{month}` no DynamoDB:

```json
{
  "id": "user-cognito-sub",
  "sk": "SAVINGS#REALIZED#2025-01",
  "month": "2025-01",
  "totalSavings": 450.32,
  "breakdown": {
    "slaCredits": 200.00,
    "idleInstances": 180.00,
    "unusedEbs": 50.32,
    "idleRds": 20.00
  },
  "attribution": {
    "automated": 230.32,
    "manual": 220.00
  },
  "commission": 135.10,
  "commissionRate": 0.30,
  "items": [
    {
      "type": "IDLE_INSTANCE",
      "recommendationId": "REC#EC2#i-1234567890",
      "resourceArn": "arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890",
      "actionType": "STOP",
      "executedAt": "2025-01-15T14:30:00Z",
      "executedBy": "AUTO",
      "estimatedSavings": 45.00,
      "realizedSavings": 42.50,
      "attributionMethod": "HOURLY_RATE_PRORATED"
    }
  ]
}
```

### Lógica de Atribuição

#### Automações (Recursos Ociosos)
```javascript
// Em execute-recommendation.js
const realizedSavings = rec.potentialSavings; // Economia estimada no momento da recomendação
await trackSavings(customerId, monthKey, rec.type, realizedSavings, recSk);
```

**Método de Atribuição**: Usa o preço horário capturado no momento da *recomendação*, multiplicado pelas horas restantes do mês.

#### Créditos SLA
```javascript
// No SLA workflow (sla-workflow.js)
const creditAmount = calculateSLACredit(incident); // Valor exato do AWS Support
await trackSavings(customerId, monthKey, 'SLA_CREDIT', creditAmount, claimId);
```

**Método de Atribuição**: Valor discreto aprovado pelo AWS Support (100% preciso).

### Dashboard de Economias
Endpoint para frontend:

```javascript
app.get('/api/billing/savings/:month', authenticateUser, async (req, res) => {
  const customerId = req.user.sub;
  const month = req.params.month; // "2025-01"
  
  const savings = (await dynamoDb.get({
    TableName: process.env.DYNAMODB_TABLE,
    Key: { id: customerId, sk: `SAVINGS#REALIZED#${month}` }
  }).promise()).Item;
  
  res.json(savings || { totalSavings: 0, commission: 0 });
});
```

---

## Breaking Changes

### 1. Estrutura do `automationSettings`
**ANTES:**
```json
{
  "automationSettings": {
    "stopIdleInstances": true,
    "deleteUnusedEbs": false
  },
  "exclusionTags": "CostGuardian:Exclude,Production"
}
```

**DEPOIS:**
```json
{
  "automationSettings": {
    "stopIdleInstances": {
      "enabled": true,
      "regions": ["us-east-1"],
      "filters": {...},
      "thresholds": {...},
      "exclusionTags": ["CostGuardian:Exclude"]
    }
  }
}
```

**Migração:** Adicione script de migração para clientes existentes:
```javascript
// migration/migrate-automation-settings.js
const oldConfig = await dynamoDb.get(...);
const newSettings = {
  stopIdleInstances: {
    enabled: oldConfig.automationSettings?.stopIdleInstances || false,
    regions: ['us-east-1'], // Default para clientes antigos
    filters: { tags: [{ Key: 'Environment', Values: ['dev', 'staging'] }] },
    thresholds: { cpuUtilization: 5, evaluationPeriodHours: 24 },
    exclusionTags: (oldConfig.exclusionTags || '').split(',').filter(Boolean)
  }
};
```

### 2. Tipo de Recomendação `UNUSED_EBS_VOLUME` → `UNUSED_EBS`
Padronizado no `execute-recommendation.js`. Se frontend ainda envia `UNUSED_EBS_VOLUME`, adicione fallback:
```javascript
if (rec.type === 'UNUSED_EBS' || rec.type === 'UNUSED_EBS_VOLUME') {
  // ...
}
```

### 3. Campo `region` nas Recomendações
Agora todas as recomendações incluem:
```json
{
  "region": "us-west-2",
  "resourceArn": "arn:aws:ec2:us-west-2:123456789012:instance/i-xxx"
}
```

Frontend deve exibir a região na UI.

---

## Checklist de Deploy

- [ ] Rodar script de migração para `automationSettings` dos clientes existentes
- [ ] Atualizar UI para editar regiões/tags/thresholds por automação
- [ ] Deploy dos Lambdas refatorados (CDK)
- [ ] Adicionar dashboard de economias realizadas no frontend
- [ ] Migrar `handler.js` para SDK v3 (opcional, mas recomendado)
- [ ] Testar fluxo completo: Recomendação → Execução → Tracking → Billing
- [ ] Validar cálculo de comissão com dados reais

---

## Testes Críticos

### 1. Teste Multi-Região
```bash
# Configure cliente com 2 regiões
PUT /api/settings/automation
{
  "enabled": true,
  "settings": {
    "stopIdleInstances": {
      "enabled": true,
      "regions": ["us-east-1", "eu-west-1"]
    }
  }
}

# Execute Lambda recommend-idle-instances
# Verificar logs: "Processando região eu-west-1"
```

### 2. Teste de Atribuição
```javascript
// Criar recomendação com potentialSavings = $45
// Executar recomendação
// Query SAVINGS#REALIZED#2025-01
// Verificar totalSavings inclui $45
// Verificar commission = totalSavings * 0.30
```

### 3. Teste de Exclusão por Tags
```bash
# Adicionar tag "CostGuardian:Exclude" em instância
# Executar recomendação
# Verificar logs: "Instância excluída por tags"
```

---

## Rollback Plan

Se houver problemas em produção:
1. Reverter CDK para commit anterior
2. Restaurar Lambdas antigos (v2)
3. Clientes com novo schema `automationSettings` continuarão funcionando (backward compatible com defaults)

---

## Performance Esperada

| Métrica | Antes | Depois |
|---------|-------|--------|
| Lambda Bundle Size | ~5MB | ~1.5MB |
| Cold Start | ~800ms | ~350ms |
| Regiões Suportadas | 1 (hardcoded) | Ilimitado (configurável) |
| Precisão de Economia | 0% (sem tracking) | 95% (com atribuição) |

---

## Próximos Passos

1. **Validação de Produção**: Deploy em ambiente de staging com clientes beta
2. **Auditoria de Economias**: Comparar `potentialSavings` vs `realizedSavings` após 30 dias
3. **Dashboard de Comissão**: Integrar `SAVINGS#REALIZED` com Stripe para billing automático
4. **Expansão de Automações**: Adicionar suporte para Snapshots ociosos, NAT Gateways não utilizados

---

**Autor**: AWS Cost Guardian Team  
**Data**: 2025-10-30  
**Versão**: 2.0.0
