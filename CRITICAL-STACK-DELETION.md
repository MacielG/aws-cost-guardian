# ⚠️ CRÍTICO: Stack em Deleção

**Data:** 02/11/2025  
**Status:** Stack CostGuardianStack em DELETE_IN_PROGRESS

## 🚨 O que aconteceu

O stack CloudFormation está sendo deletado. Isso pode ter sido:
1. Comando `cdk destroy` acidental que iniciou há 5 minutos (timeout de 300s)
2. Deleção manual no console AWS
3. Erro em deploy anterior que acionou rollback de deleção

## 📊 Impacto

### Recursos que serão DELETADOS:
- ✅ API Gateway (pode ser recriado)
- ✅ Lambdas (código está no backend/)
- ✅ Cognito User Pool (⚠️ **USUÁRIOS SERÃO PERDIDOS**)
- ✅ DynamoDB (⚠️ **DADOS SERÃO PERDIDOS** se não tiver backup)
- ✅ S3 Buckets (depende de retention policy)
- ✅ WAF
- ✅ Amplify App

### Dados em Risco:
- 🔴 **Usuários Cognito** - serão perdidos
- 🔴 **Dados DynamoDB** - serão perdidos se não tiver PITR
- 🟡 **Configurações** - podem ser recuperadas do código

## 🔄 Ação Imediata

### 1. Aguardar deleção completar (5-15 minutos)
```bash
# Monitorar status
aws cloudformation describe-stacks \
  --stack-name CostGuardianStack \
  --region us-east-1 \
  --query "Stacks[0].StackStatus"
```

### 2. Verificar se DynamoDB tem backup
```bash
# Verificar PITR
aws dynamodb describe-continuous-backups \
  --table-name CostGuardianTable \
  --region us-east-1
```

### 3. Após deleção completar, redeployar limpo
```bash
cd infra
npm run deploy
```

## 💾 Recuperação de Dados

### Se tiver backup DynamoDB:
```bash
# Restaurar de backup PITR
aws dynamodb restore-table-to-point-in-time \
  --source-table-name CostGuardianTable \
  --target-table-name CostGuardianTableRestored \
  --use-latest-restorable-time \
  --region us-east-1
```

### Usuários Cognito:
⚠️ **NÃO HÁ BACKUP AUTOMÁTICO**
- Usuários precisarão se re-registrar
- Senhas serão resetadas

## ✅ Lado Positivo

Esta é uma oportunidade para:
1. ✅ Fazer deploy limpo sem recursos órfãos
2. ✅ Resolver problema CORS definitivamente
3. ✅ Eliminar Lambda policy size issue
4. ✅ Arquitetura simples e robusta desde o início

## 📝 Próximos Passos

1. **Aguardar** deleção completar
2. **Verificar** se há backups de dados críticos
3. **Deploy** limpo com arquitetura corrigida:
   - Proxy integration simples
   - CORS no Express
   - Sem authorizer órfão
   - Sem rotas individuais duplicadas
4. **Testar** CORS funcionando
5. **Documentar** nova arquitetura

## 🎯 Nova Arquitetura (Pós-Redeploy)

```
API Gateway (RestApi)
├─ / (ANY) ──────────────┐
└─ /{proxy+} (ANY) ──────┤
                          ├──> Lambda (ApiHandler)
                          │     └─ Express App
                          │        ├─ CORS middleware
                          │        ├─ OPTIONS handler
                          │        └─ authenticateUser
                          │
GatewayResponses (4xx/5xx com CORS)
```

## ⏱️ Timeline Estimado

- **Agora:** DELETE_IN_PROGRESS
- **+5-15 min:** DELETE_COMPLETE
- **+15-20 min:** Deploy limpo
- **+20-25 min:** Teste e validação
- **+30 min:** Sistema funcionando com CORS

---

**Status será atualizado conforme progresso.**
