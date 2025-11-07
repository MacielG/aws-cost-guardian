# Guia de Testes de Integração - AWS Cost Guardian

## 📋 Visão Geral

Este guia explica como executar testes completos de integração entre frontend e backend em produção.

## 🔧 Pré-requisitos

1. Node.js instalado (v14+)
2. Acesso à internet
3. (Opcional) Credenciais de usuário/admin para testes autenticados

## 🚀 Executando os Testes

### 1. Testes Básicos (Sem Autenticação)

Testa apenas endpoints públicos e páginas do frontend:

```bash
node test-production-integration.js
```

### 2. Testes com Usuário Normal

Testa todos os endpoints de usuário autenticado:

```bash
TEST_USER_EMAIL=seu.email@exemplo.com TEST_USER_PASSWORD=SuaSenha123! node test-production-integration.js
```

### 3. Testes com Admin

Testa todos os endpoints incluindo os de administrador:

```bash
TEST_ADMIN_EMAIL=admin@exemplo.com TEST_ADMIN_PASSWORD=AdminPass123! node test-production-integration.js
```

### 4. Testes Completos (Usuário + Admin)

Testa tudo:

```bash
TEST_USER_EMAIL=user@exemplo.com TEST_USER_PASSWORD=UserPass123! TEST_ADMIN_EMAIL=admin@exemplo.com TEST_ADMIN_PASSWORD=AdminPass123! node test-production-integration.js
```

## 📊 Interpretando os Resultados

### Símbolos

- ✅ **Verde**: Teste passou com sucesso
- ❌ **Vermelho**: Teste falhou
- ℹ️ **Azul**: Informação adicional

### Taxa de Sucesso

- **100%**: Sistema perfeito
- **≥80%**: Sistema operacional com pequenas falhas
- **<80%**: Sistema precisa de correções

### Relatório JSON

Após execução, o arquivo `test-results.json` contém:

```json
{
  "timestamp": "2025-11-06T...",
  "summary": {
    "total": 50,
    "passed": 48,
    "failed": 2,
    "successRate": "96.0"
  },
  "duration": "5.23s",
  "results": [...]
}
```

## 🧪 O que é Testado

### Endpoints Públicos (Sem Auth)
- ✅ GET /health
- ✅ GET /api/health
- ✅ Proteção de rotas (401/403)

### Endpoints de Usuário (Com Auth)
- ✅ GET /api/user/status
- ✅ GET /billing/summary
- ✅ GET /recommendations
- ✅ GET /api/incidents
- ✅ GET /api/dashboard/costs
- ✅ GET /onboard-init

### Endpoints de Admin (Com Auth Admin)
- ✅ GET /admin/metrics
- ✅ GET /admin/settings
- ✅ GET /admin/claims

### Páginas do Frontend
- ✅ Home/Landing (/)
- ✅ Login (/login)
- ✅ Onboarding (/onboard)
- ✅ Dashboard Cliente (/dashboard)
- ✅ Dashboard Admin (/admin)
- ✅ Billing (/billing)
- ✅ Recommendations (/recommendations)
- ✅ Settings (/settings)
- ✅ SLA Claims (/sla-claims)
- ✅ Profile (/profile)
- ✅ Alerts (/alerts)
- ✅ Claims (/claims)
- ✅ Terms (/terms)

### Testes de Performance
- ⚡ Tempo de resposta da API (<300ms = Excelente)
- ⚡ Tempo de resposta do Frontend (<1000ms = Excelente)

### Testes de Segurança
- 🔒 HTTPS ativo
- 🔒 CORS configurado
- 🔒 Security Headers

## 🔐 Criando Usuários de Teste

### Usuário Normal

1. Acesse o Cognito User Pool: `us-east-1_Y8MPqisuQ`
2. Crie um novo usuário
3. Confirme o email
4. Use as credenciais nos testes

### Usuário Admin

1. Crie um usuário normal (passos acima)
2. No console Cognito, adicione o usuário ao grupo **"Admins"**
3. Use as credenciais com `TEST_ADMIN_EMAIL` e `TEST_ADMIN_PASSWORD`

### Via AWS CLI

```bash
# Criar usuário
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_Y8MPqisuQ \
  --username test@example.com \
  --user-attributes Name=email,Value=test@example.com Name=email_verified,Value=true \
  --temporary-password TempPass123! \
  --region us-east-1

# Definir senha permanente
aws cognito-idp admin-set-user-password \
  --user-pool-id us-east-1_Y8MPqisuQ \
  --username test@example.com \
  --password UserPass123! \
  --permanent \
  --region us-east-1

# Adicionar ao grupo Admins (para admin)
aws cognito-idp admin-add-user-to-group \
  --user-pool-id us-east-1_Y8MPqisuQ \
  --username admin@example.com \
  --group-name Admins \
  --region us-east-1
```

## 🐛 Troubleshooting

### Erro: "Request timeout"
- Verifique sua conexão com internet
- API/Frontend pode estar offline

### Erro: "Cognito Auth - Falhou"
- Verifique se email e senha estão corretos
- Verifique se usuário está confirmado no Cognito
- Verifique se a senha atende aos requisitos (mín. 8 chars, maiúscula, número, especial)

### Erro: "403 Forbidden" no /admin/*
- Usuário não está no grupo "Admins"
- Adicione ao grupo via console ou CLI

### Taxa de sucesso baixa (<80%)
- Verifique logs do backend (CloudWatch)
- Verifique se DynamoDB está acessível
- Verifique se Lambda tem permissões corretas

## 📝 Validações de Dados

### Dados Ausentes (Esperado)
O script testa corretamente quando:
- Conta nova sem análises → `monthlySavings: []`
- Sem recomendações → `recommendations: []`
- Sem incidentes → `incidents: []`

### Dados Presentes (Validado)
Quando há dados, valida:
- Tipos corretos (number, string, array)
- Estruturas obrigatórias presentes
- Valores dentro de ranges esperados

## 🔄 Integração CI/CD

Para usar em pipeline:

```yaml
# .github/workflows/integration-test.yml
- name: Run Integration Tests
  env:
    TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
    TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}
    TEST_ADMIN_EMAIL: ${{ secrets.TEST_ADMIN_EMAIL }}
    TEST_ADMIN_PASSWORD: ${{ secrets.TEST_ADMIN_PASSWORD }}
  run: node test-production-integration.js
```

## 📞 Suporte

Se os testes falharem consistentemente:

1. Verifique `test-results.json` para detalhes
2. Consulte CloudWatch Logs da Lambda
3. Verifique status do API Gateway
4. Verifique deploy do Amplify

---

**Última atualização:** 2025-11-06
**Versão do Script:** 1.0.0
