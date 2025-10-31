# Erros e Problemas Encontrados - AWS Cost Guardian v2.0.1

Data: 2025-10-30  
Severidade: 🔴 **CRÍTICO** - Bloqueadores de Deploy  

---

## 🚨 ERROS CRÍTICOS ENCONTRADOS

### 1. ❌ ERRO CRÍTICO: Export Name Incorreto em `recommend-idle-instances.js`

**Severidade**: 🔴 **BLOQUEADOR**

#### Problema
```javascript
// Arquivo: backend/functions/recommend-idle-instances.js linha 29
exports.recommendIdleInstancesHandler = async (event) => {
  // ...
};
```

#### Por que é um erro?
O CDK stack **NÃO** tem uma definição de Lambda para este arquivo. Todos os outros Lambdas usam `exports.handler`, mas este usa `exports.recommendIdleInstancesHandler`.

#### Comparação com outros arquivos
```javascript
// ✅ CORRETO - stop-idle-instances.js
exports.handler = async (event) => { ... }

// ✅ CORRETO - delete-unused-ebs.js
exports.handler = async (event) => { ... }

// ✅ CORRETO - execute-recommendation.js
exports.handler = async (event) => { ... }

// ❌ ERRADO - recommend-idle-instances.js
exports.recommendIdleInstancesHandler = async (event) => { ... }
```

#### Impacto
- **Lambda não poderá ser invocado**
- **Runtime error**: Handler not found
- **Automação de recomendações não funcionará**

#### Solução Necessária
```javascript
// ANTES (ERRADO)
exports.recommendIdleInstancesHandler = async (event) => {

// DEPOIS (CORRETO)
exports.handler = async (event) => {
```

---

### 2. ❌ ERRO CRÍTICO: Lambda para `recommend-idle-instances.js` Não Existe no CDK

**Severidade**: 🔴 **BLOQUEADOR**

#### Problema
Busquei por `recommend-idle-instances` no stack CDK:
```bash
Grep: "recommend-idle-instances" em infra/
Result: No results found
```

#### Evidência
- ✅ `stop-idle-instances.js` → Lambda `StopIdleInstances` existe (linha 720)
- ✅ `delete-unused-ebs.js` → Lambda `DeleteUnusedEbs` existe (linha 780)
- ✅ `execute-recommendation.js` → Lambda `StopIdleInstances` usa este handler (linha 723)
- ❌ `recommend-idle-instances.js` → **NENHUM Lambda definido**

#### Impacto
- **Lambda não será deployado**
- **Função não estará disponível**
- **Recomendações não serão geradas**
- **EventBridge rules não poderão acionar este Lambda**

#### Solução Necessária
Adicionar Lambda no CDK stack:
```typescript
const recommendIdleInstancesLambda = new lambda.Function(this, 'RecommendIdleInstances', {
  runtime: lambda.Runtime.NODEJS_18_X,
  code: lambda.Code.fromAsset(backendFunctionsPath),
  handler: 'recommend-idle-instances.handler', // Após corrigir o export
  timeout: cdk.Duration.minutes(5),
  vpc,
  securityGroups: [lambdaSecurityGroup],
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
  environment: { 
    DYNAMODB_TABLE: table.tableName,
    SNS_TOPIC_ARN: anomalyAlertsTopic.topicArn
  },
  // ... outras configurações
});
```

---

### 3. 🟡 PROBLEMA GRAVE: trackSavings Não Atualiza Array `items[]`

**Severidade**: 🟡 **ALTO** - Impacto no Dashboard

#### Problema
```javascript
// Linha 181-200: Quando SAVINGS#REALIZED já existe
if (existing) {
  const updateCommand = new UpdateCommand({
    UpdateExpression: 'SET totalSavings = :newTotal, breakdown.#key = :newBreakdown, commission = :commission, updatedAt = :now',
    // ⚠️ FALTA: Não adiciona novo item ao array items[]
  });
}
```

#### Por que é um problema?
- **Primeira execução**: `items[]` criado com 1 item ✅
- **Segunda execução**: `items[]` NÃO é atualizado ❌
- **Resultado**: Dashboard só mostra o primeiro item do mês

#### Comparação
```javascript
// ✅ CORRETO - Primeira vez (linha 216-222)
items: [{
  type: savingType,
  recommendationId: recommendationId,
  amount: amount,
  executedAt: new Date().toISOString(),
  executedBy: 'AUTO'
}]

// ❌ ERRADO - Execuções subsequentes (linha 186-200)
// Sem atualização de items[]
```

#### Impacto
- Dashboard mostrará total correto ✅
- Dashboard mostrará breakdown correto ✅
- Dashboard **NÃO mostrará histórico detalhado** ❌
- Auditoria de economias incompleta ❌

#### Solução Necessária
```javascript
if (existing) {
  const updateCommand = new UpdateCommand({
    UpdateExpression: 'SET totalSavings = :newTotal, breakdown.#key = :newBreakdown, commission = :commission, updatedAt = :now, #items = list_append(if_not_exists(#items, :emptyList), :newItem)',
    ExpressionAttributeNames: {
      '#key': breakdownKey,
      '#items': 'items'  // ADICIONAR
    },
    ExpressionAttributeValues: {
      ':newTotal': newTotal,
      ':newBreakdown': (currentBreakdown[breakdownKey] || 0) + amount,
      ':commission': newTotal * 0.30,
      ':now': new Date().toISOString(),
      ':emptyList': [],  // ADICIONAR
      ':newItem': [{     // ADICIONAR
        type: savingType,
        recommendationId: recommendationId,
        amount: amount,
        executedAt: new Date().toISOString(),
        executedBy: 'AUTO'
      }]
    }
  });
}
```

---

### 4. 🟢 AVISO: Pricing Client Hardcoded em `us-east-1`

**Severidade**: 🟢 **BAIXO** - Não é um bug, é correto

#### Observação
```javascript
// Linha 12
const pricing = new PricingClient({ region: 'us-east-1' });
```

#### Por que está correto?
A **AWS Pricing API só está disponível em `us-east-1`**. Mesmo que o recurso esteja em outra região, o cliente Pricing **deve** usar `us-east-1`.

**Status**: ✅ **CORRETO** - NÃO é um erro

---

## 📊 RESUMO DE ERROS

| # | Erro | Severidade | Impacto | Bloqueante |
|---|------|------------|---------|------------|
| 1 | Export name incorreto | 🔴 CRÍTICO | Lambda não executa | ✅ SIM |
| 2 | Lambda não definido no CDK | 🔴 CRÍTICO | Lambda não deployado | ✅ SIM |
| 3 | items[] não atualizado | 🟡 ALTO | Dashboard incompleto | ❌ NÃO |
| 4 | Pricing em us-east-1 | 🟢 BAIXO | Nenhum (correto) | ❌ NÃO |

**Total de Bloqueadores**: 2  
**Total de Problemas Graves**: 1  
**Total de Avisos**: 1

---

## 🔍 ANÁLISE DE IMPACTO

### Deploy Atual
Se deployar **AGORA**:
1. ❌ `recommend-idle-instances.js` **NÃO será deployado** (sem definição no CDK)
2. ❌ Recomendações de instâncias ociosas **NÃO serão geradas**
3. ⚠️ Dashboard de economias mostrará dados parciais
4. ✅ Outras funcionalidades funcionarão (execute, delete-ebs, stop)

### Funcionalidades Afetadas
- ❌ **Geração de recomendações EC2**: QUEBRADO
- ❌ **High-value lead detection**: QUEBRADO (depende de recommend-idle)
- ⚠️ **Dashboard de economias detalhado**: PARCIAL
- ✅ **Execução de recomendações**: OK
- ✅ **Remoção de EBS**: OK
- ✅ **Stop instances manual**: OK

---

## ✅ CORREÇÕES NECESSÁRIAS (Em Ordem de Prioridade)

### CRÍTICO - Deve ser feito ANTES do deploy

#### 1. Corrigir Export Name
```bash
Arquivo: backend/functions/recommend-idle-instances.js
Linha: 29
Mudança: exports.recommendIdleInstancesHandler → exports.handler
```

#### 2. Adicionar Lambda ao CDK Stack
```bash
Arquivo: infra/lib/cost-guardian-stack.ts
Localização: Após linha 778 (depois de recommendRdsIdleLambda)
Ação: Criar novo Lambda.Function para recommend-idle-instances.handler
```

### ALTO - Recomendado antes do deploy

#### 3. Corrigir trackSavings para Atualizar items[]
```bash
Arquivo: backend/functions/execute-recommendation.js
Linha: 186-200
Ação: Adicionar list_append para items[]
```

---

## 🎯 PRÓXIMOS PASSOS

### Imediato (Antes de Deploy)
1. ❌ **CORRIGIR** export em `recommend-idle-instances.js`
2. ❌ **ADICIONAR** Lambda no CDK stack
3. ⚠️ **CORRIGIR** trackSavings items[] (recomendado)
4. ✅ **TESTAR** build: `cd backend && npm run build`
5. ✅ **TESTAR** CDK: `cd infra && npm run build`

### Deploy
Apenas após **todas as correções críticas** aplicadas.

### Validação Pós-Deploy
1. Verificar Lambda `RecommendIdleInstances` existe
2. Testar invocação manual
3. Verificar logs do CloudWatch
4. Validar criação de recomendações
5. Validar tracking de economias

---

## 📝 LIÇÕES APRENDIDAS

### O Que Deu Errado?
1. **Falta de validação end-to-end**: Não verificamos se o Lambda estava definido no CDK
2. **Copy-paste error**: O export name foi copiado de uma versão anterior
3. **Falta de testes de integração**: Não testamos se trackSavings realmente funciona em múltiplas chamadas

### O Que Fazer Diferente?
1. **Sempre verificar CDK stack** após modificar Lambdas
2. **Padronizar exports**: Sempre usar `exports.handler`
3. **Criar testes unitários** para funções críticas como trackSavings
4. **Validar com grep** se todos os arquivos .js têm Lambda correspondente no CDK

---

## ⚠️ AVISO IMPORTANTE

**O projeto NÃO está pronto para deploy em produção** até que as correções críticas (#1 e #2) sejam aplicadas.

**Status Atual**: 🔴 **BLOQUEADO PARA DEPLOY**

**Status Após Correções**: 🟢 **APROVADO PARA STAGING**

---

**Descoberto por**: Análise de Auditoria  
**Data**: 2025-10-30  
**Prioridade**: 🔴 **URGENTE**  
**Ação Requerida**: Aplicar correções antes do próximo commit
