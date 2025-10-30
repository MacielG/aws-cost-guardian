# Análise de Falhas nos Testes - Infra

## Status Atual
- ✅ 4 testes passando
- ❌ 18 testes falhando

## Categorização dos Problemas

### 🔴 PROBLEMA 1: Asset Backend não encontrado (15 testes)
**Erro**: `ValidationError: Cannot find asset at G:\aws-cost-guardian\backend`

**Causa Raiz**: Durante os testes, o CDK tenta criar assets mas o caminho `__dirname` aponta para a pasta compilada `lib/` ao invés do source `src/`. Quando compilado, `__dirname` = `infra/lib`, então `path.join(__dirname, '../../backend')` aponta incorretamente.

**Testes Afetados**:
- Secrets Manager deve usar KMS com rotação automática
- Lambdas devem ter configuração de VPC
- API Gateway deve ter WAF associado
- Todos os buckets devem ter as configurações de segurança adequadas
- Todos os buckets devem ter lifecycle rules completas
- DynamoDB deve ter GSIs configurados corretamente
- Lambda functions devem ter configurações de memória e timeout apropriadas
- Step Functions devem ter tratamento de erro configurado
- Cognito User Pool deve ter políticas de senha fortes
- Lambda roles devem seguir o princípio do menor privilégio
- Step Functions devem ter permissões para invocar Lambdas
- EventBridge deve ter permissão para acionar Step Functions
- EventBridge deve ter regras para eventos do Health
- API Gateway deve ter integrações com Lambda configuradas
- Step Functions devem ter integrações com serviços AWS

**Solução**: Usar caminhos absolutos baseados no workspace root ou criar variáveis de ambiente

### 🟡 PROBLEMA 2: BucketDeployment em ambiente de teste (1 teste)
**Erro**: `Cannot find a package lock file`

**Causa Raiz**: BucketDeployment cria custom resources que tentam encontrar package lock files mesmo em teste

**Teste Afetado**:
- Ambiente de teste não deve criar BucketDeployment

**Solução**: Mock melhor ou ajustar condição

### 🟡 PROBLEMA 3: Expectativa de BucketDeployment (1 teste)
**Erro**: `Expected value undefined`

**Teste Afetado**:
- Ambiente de produção deve criar BucketDeployment

**Solução**: Verificar expectativa do teste

### 🟡 PROBLEMA 4: Log level em teste (1 teste)
**Erro**: Similar ao problema 1

**Teste Afetado**:
- Ambiente de teste deve ter logs aprimorados

## Warnings (Não críticos mas devem ser corrigidos)
- ⚠️ CfnEventBusPolicy deprecated properties (action, condition, principal)
- ⚠️ pointInTimeRecovery deprecated (já corrigido mas warning persiste)

## Plano de Correção

### Fase 1: Corrigir Problema 1 (Asset paths) ✅ PRÓXIMO
1. Adicionar propriedade backendPath nas props do stack
2. Passar caminho absoluto nos testes
3. Usar caminho relativo correto em produção

### Fase 2: Corrigir CfnEventBusPolicy deprecated
1. Migrar para nova sintaxe com Statement

### Fase 3: Ajustar testes BucketDeployment
1. Melhorar mocks
2. Ajustar expectativas

### Fase 4: Validação Final
1. Rodar todos os testes
2. Verificar 100% de sucesso
