# 🚀 AWS Cost Guardian - Performance & Monitoring Guide

## 📊 Visão Geral

Este documento descreve as otimizações de performance, monitoramento avançado e ferramentas de desenvolvimento implementadas no AWS Cost Guardian.

## ⚡ Otimizações de Performance

### Lambda Functions
- **Memória**: Aumentada de 1024MB para 2048MB
- **Provisioned Concurrency**: 2 instâncias sempre ativas
- **Auto-scaling**: 2-20 instâncias baseado em utilização (70% target)
- **X-Ray Tracing**: Habilitado para debugging distribuído
- **Source Maps**: Habilitados para melhor debugging

### API Gateway
- **Throttling**: 1000 req/s (burst: 2000)
- **Caching**: 5 minutos para endpoints GET
- **Usage Plans**: Controle de quota mensal (1M requests)
- **API Keys**: Monitoramento de uso

### DynamoDB
- **PITR**: Point-in-Time Recovery habilitado em produção
- **Contributor Insights**: Análise de performance de queries
- **Table Class**: STANDARD_INFREQUENT_ACCESS para otimização de custos
- **Encryption**: KMS com rotação automática

## 📈 Monitoramento Avançado

### CloudWatch Dashboards
- **API Gateway**: Contagem de requests, erros, latência
- **Lambda**: Invocações, erros, duração
- **DynamoDB**: Throttling, unidades de leitura/escrita

### Alertas Inteligentes
- **API 5xx**: >5 erros em 2 períodos consecutivos
- **API 4xx**: >50 erros (possível ataque)
- **Latência**: >2s por 2 períodos
- **Lambda Errors**: >5 erros em 2 períodos
- **Lambda Duration**: >25s (próximo do timeout)
- **DynamoDB Throttling**: >10 requests throttled

### X-Ray Tracing
- **Distributed Tracing**: Rastreamento completo de requests
- **Performance Analysis**: Identificação de gargalos
- **Error Tracking**: Debugging de problemas em produção

## 🛠️ Ferramentas de Desenvolvimento

### Load Testing
```bash
# Teste básico (10 concorrentes, 100 requests)
npm run load-test

# Teste personalizado
npm run load-test https://api-endpoint/dev 20 500

# Resultado esperado:
# ✅ Excellent performance! (>100 req/s)
# ✅ Fast response times (<1000ms p95)
# ✅ No errors detected
```

### Health Monitoring
```bash
# Monitoramento contínuo (60s interval)
npm run health-check

# Monitoramento personalizado
npm run health-check https://api-endpoint/dev 30

# Features:
# 🔍 Verifica todos os endpoints críticos
# 🚨 Alerta após 3 falhas consecutivas
# 📊 Relatório detalhado de status
```

### Validação de Produção
```bash
# Validação completa antes do deploy
node scripts/validate-production.js

# Verifica:
# ✅ Environment variables
# ✅ Dependencies
# ✅ Infrastructure config
# ✅ API connectivity
```

### Scripts Úteis
```bash
# Deploy
npm run deploy

# Visualizar logs recentes
npm run logs

# Métricas do Serverless
npm run metrics
```

## 🎯 Métricas de Performance

### Targets de Performance
- **Throughput**: >100 requests/segundo
- **Latência P95**: <1000ms
- **Error Rate**: <1%
- **Cold Start**: <2s (com provisioned concurrency)

### Monitoramento em Tempo Real
1. **CloudWatch Dashboard**: `CostGuardian-Monitoring`
2. **X-Ray Service Map**: Para análise de dependências
3. **Contributor Insights**: Para análise de DynamoDB

## 🔧 Troubleshooting

### Performance Issues
1. **Alta Latência**: Verificar X-Ray traces
2. **Throttling**: Aumentar provisioned concurrency
3. **Errors**: Verificar CloudWatch logs

### Debugging
1. **Load Testing**: Identificar gargalos
2. **Health Monitoring**: Status dos serviços
3. **X-Ray**: Rastreamento de requests problemáticos

## 🚀 Próximos Passos

### Otimizações Futuras
1. **Edge Locations**: CloudFront Functions
2. **DynamoDB DAX**: Cache em memória
3. **API Gateway HTTP API**: Menor latência
4. **Lambda@Edge**: Computação na borda

### Monitoramento Avançado
1. **Custom Metrics**: Métricas de negócio
2. **Anomaly Detection**: ML-based alerting
3. **Cost Monitoring**: Otimização de custos AWS

---

## 📞 Suporte

Para questões de performance ou monitoramento:
- Verificar CloudWatch Dashboards
- Usar ferramentas de debugging incluídas
- Consultar logs estruturados

**Sistema totalmente otimizado e monitorado! 🎉**
