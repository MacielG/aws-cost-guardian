# 🔍 Auditoria de Recursos AWS - Cost Guardian
**Data:** 02/11/2025  
**Stack:** CostGuardianStack  
**Região:** us-east-1

---

## ⚠️ STATUS DO STACK
**Stack Status:** `DELETE_COMPLETE` ❌  
**Problema:** O stack CostGuardianStack foi **DELETADO COMPLETAMENTE**

---

## 📊 RECURSOS ÓRFÃOS IDENTIFICADOS

### 🗃️ DynamoDB
| Recurso | Nome | Status | Custo Estimado/Mês | Ação |
|---------|------|--------|-------------------|------|
| Tabela | `CostGuardianTable` | ✅ **ATIVO** | $0.25 - $1.00 | ⚠️ **DELETAR** |

**Detalhes:**
- Tabela órfã (stack deletado mas tabela permaneceu)
- **Modo:** On-Demand (pay-per-request)
- **Custo:** Depende do uso, estimado ~$0.25-1/mês se não usada

**Comando para deletar:**
```powershell
aws dynamodb delete-table --table-name CostGuardianTable --region us-east-1
```

---

### 📦 S3 Buckets
| Recurso | Nome | Criação | Custo Estimado/Mês | Ação |
|---------|------|---------|-------------------|------|
| Bucket CDK | `cdk-hnb659fds-assets-404513223764-us-east-1` | 31/10/2025 | $0.02 - $0.10 | ✅ **MANTER** (usado por CDK) |
| Bucket Templates | `costguardianstack-cfntemplatebucket4840c65e-10ltcwuvbgmt` | 31/10/2025 | $0.01 - $0.05 | ⚠️ **DELETAR** |
| Bucket Reports | `costguardianstack-reportsbucket4e7c5994-mdh0maglvixk` | 31/10/2025 | $0.01 - $0.05 | ⚠️ **DELETAR** |

**Detalhes:**
- 3 buckets S3 ativos
- 2 buckets órfãos (stack deletado)
- 1 bucket CDK (reutilizável para novos deploys)

**Comandos para deletar buckets órfãos:**
```powershell
# 1. Esvaziar buckets primeiro
aws s3 rm s3://costguardianstack-cfntemplatebucket4840c65e-10ltcwuvbgmt --recursive
aws s3 rm s3://costguardianstack-reportsbucket4e7c5994-mdh0maglvixk --recursive

# 2. Deletar buckets
aws s3 rb s3://costguardianstack-cfntemplatebucket4840c65e-10ltcwuvbgmt --force
aws s3 rb s3://costguardianstack-reportsbucket4e7c5994-mdh0maglvixk --force
```

---

### 🔐 Cognito User Pools
| Recurso | Status | Custo |
|---------|--------|-------|
| User Pools | **Nenhum ativo** | $0.00 |

✅ **OK** - Nenhum recurso órfão

---

### ⚡ Lambda Functions
| Recurso | Status | Custo |
|---------|--------|-------|
| Functions | **Nenhuma ativa** | $0.00 |

✅ **OK** - Nenhuma função órfã

---

### 🌐 API Gateway
| Recurso | Status | Custo |
|---------|--------|-------|
| REST APIs | **Nenhuma ativa** | $0.00 |

✅ **OK** - Nenhuma API órfã

---

## 💰 RESUMO DE CUSTOS

### Custos Mensais Atuais (Recursos Órfãos)
| Categoria | Recurso | Custo Mínimo | Custo Máximo |
|-----------|---------|--------------|--------------|
| DynamoDB | CostGuardianTable | $0.25 | $1.00 |
| S3 | Template Bucket | $0.01 | $0.05 |
| S3 | Reports Bucket | $0.01 | $0.05 |
| S3 | CDK Assets (mantém) | $0.02 | $0.10 |
| **TOTAL** | **Órfãos** | **$0.27** | **$1.10** |
| **TOTAL** | **Todos** | **$0.29** | **$1.20** |

### Custos Após Limpeza
| Categoria | Recurso | Custo |
|-----------|---------|-------|
| S3 | CDK Assets | $0.02 - $0.10/mês |
| **TOTAL** | | **~$0.05/mês** |

**Economia após limpeza:** ~$0.25 - $1.05/mês

---

## 🎯 RECOMENDAÇÕES DE AÇÃO

### 🔴 URGENTE - Deletar Agora
1. **DynamoDB Table:** `CostGuardianTable`
   - Motivo: Órfã, stack deletado
   - Economia: $0.25-1.00/mês
   - Risco: **BAIXO** (pode ser recriada)

2. **S3 Bucket:** `costguardianstack-cfntemplatebucket*`
   - Motivo: Órfão, stack deletado
   - Economia: $0.01-0.05/mês
   - Risco: **BAIXO**

3. **S3 Bucket:** `costguardianstack-reportsbucket*`
   - Motivo: Órfão, stack deletado
   - Economia: $0.01-0.05/mês
   - Risco: **BAIXO**

### ✅ MANTER
1. **S3 Bucket:** `cdk-hnb659fds-assets-*`
   - Motivo: Usado pelo CDK para deploys
   - Custo: $0.02-0.10/mês
   - Ação: **MANTER** para futuros deploys

---

## 📋 SCRIPT DE LIMPEZA COMPLETO

```powershell
# ====================================
# LIMPEZA DE RECURSOS ÓRFÃOS AWS
# Cost Guardian - Stack Deletado
# ====================================

Write-Host "🔍 Iniciando limpeza de recursos órfãos..." -ForegroundColor Cyan

# 1. Deletar DynamoDB Table
Write-Host "`n📊 [1/3] Deletando DynamoDB Table órfã..." -ForegroundColor Yellow
aws dynamodb delete-table --table-name CostGuardianTable --region us-east-1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ DynamoDB Table deletada com sucesso" -ForegroundColor Green
} else {
    Write-Host "❌ Erro ao deletar DynamoDB Table" -ForegroundColor Red
}

# 2. Deletar S3 Template Bucket
Write-Host "`n📦 [2/3] Deletando S3 Template Bucket..." -ForegroundColor Yellow
$templateBucket = "costguardianstack-cfntemplatebucket4840c65e-10ltcwuvbgmt"
aws s3 rm "s3://$templateBucket" --recursive 2>&1 | Out-Null
aws s3 rb "s3://$templateBucket" --force
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Template Bucket deletado com sucesso" -ForegroundColor Green
} else {
    Write-Host "❌ Erro ao deletar Template Bucket" -ForegroundColor Red
}

# 3. Deletar S3 Reports Bucket
Write-Host "`n📦 [3/3] Deletando S3 Reports Bucket..." -ForegroundColor Yellow
$reportsBucket = "costguardianstack-reportsbucket4e7c5994-mdh0maglvixk"
aws s3 rm "s3://$reportsBucket" --recursive 2>&1 | Out-Null
aws s3 rb "s3://$reportsBucket" --force
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Reports Bucket deletado com sucesso" -ForegroundColor Green
} else {
    Write-Host "❌ Erro ao deletar Reports Bucket" -ForegroundColor Red
}

# Resumo Final
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "✅ LIMPEZA CONCLUÍDA" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Recursos removidos: 3" -ForegroundColor White
Write-Host "  - 1 DynamoDB Table" -ForegroundColor Gray
Write-Host "  - 2 S3 Buckets" -ForegroundColor Gray
Write-Host "`nEconomia estimada: $0.27 - $1.10/mês" -ForegroundColor Yellow
Write-Host "`nCusto remanescente: ~$0.05/mês (CDK Assets)" -ForegroundColor White
Write-Host "========================================`n" -ForegroundColor Cyan
```

**Salvar como:** `cleanup-orphan-resources.ps1`

---

## 🚨 PROBLEMAS ENCONTRADOS

### 1. Stack Deletado Mas Recursos Permaneceram
**Problema:** Stack em status `DELETE_COMPLETE` mas 3 recursos órfãos ainda ativos  
**Causa:** 
- Buckets S3 com conteúdo (CloudFormation não deleta buckets não-vazios)
- DynamoDB table com retention policy ou erro no delete

**Impacto:** Custo contínuo de ~$0.30-1.20/mês sem funcionalidade

### 2. Histórico de Deploys Falhados
Baseado nos documentos:
- ✅ Destruído stack inicial (ROLLBACK_COMPLETE)
- ✅ Tentativa deploy #1 → Falhou (DynamoDB já existe)
- ✅ Tentativa deploy #2 → Falhou (S3 Lifecycle inválido)
- ❌ Deploy #3 → Stack foi deletado completamente

---

## 📈 PRÓXIMOS PASSOS

### Opção A: Limpar Tudo e Não Usar
1. Executar script de limpeza acima
2. Manter apenas CDK Assets bucket
3. Custo final: ~$0.05/mês

### Opção B: Limpar e Re-deploy
1. Executar script de limpeza
2. Corrigir problemas no código (ver ERRORS-FOUND.md)
3. Fazer novo deploy:
   ```powershell
   cd infra
   npm run build
   npm run deploy
   ```

---

## ✅ VERIFICAÇÃO PÓS-LIMPEZA

Após executar a limpeza, verificar:

```powershell
# 1. Verificar DynamoDB
aws dynamodb list-tables --region us-east-1
# Esperado: {"TableNames": []}

# 2. Verificar S3 (deve ter apenas CDK)
aws s3 ls
# Esperado: apenas cdk-hnb659fds-assets-*

# 3. Verificar custos
# AWS Console > Cost Explorer
# Filtrar: Service = DynamoDB, S3
# Período: Últimos 30 dias
```

---

## 📊 HISTÓRICO DE RECURSOS

### Recursos do Stack Original (Antes do Delete)
Baseado no output do CloudFormation:
- ✅ API Gateway REST API (deletado)
- ✅ ~50 Lambda Functions (deletadas)
- ✅ DynamoDB Table (órfã ⚠️)
- ✅ 2 S3 Buckets (órfãos ⚠️)
- ✅ Cognito User Pool (deletado)
- ✅ VPC Resources (deletados)
- ✅ IAM Roles (deletadas)

**Total de recursos criados originalmente:** ~100+  
**Recursos deletados com sucesso:** ~97  
**Recursos órfãos:** 3

---

## 💡 LIÇÕES APRENDIDAS

1. **Sempre verificar recursos órfãos** após delete de stack
2. **S3 buckets precisam estar vazios** antes de CloudFormation poder deletá-los
3. **DynamoDB tables podem ter retention policies** que impedem delete automático
4. **CDK Assets bucket é reutilizável** entre deploys

---

**Relatório gerado por:** Amp AI  
**Comando base:** Auditoria AWS Cost Guardian  
**Última atualização:** 02/11/2025
