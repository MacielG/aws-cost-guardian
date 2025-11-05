# 🚀 AWS Cost Guardian

**Sistema completo de otimização e monitoramento de custos AWS com arquitetura serverless de alta performance.**

[![CI/CD](https://github.com/your-org/aws-cost-guardian/actions/workflows/deploy.yml/badge.svg)](https://github.com/your-org/aws-cost-guardian/actions/workflows/deploy.yml)
[![Coverage](https://codecov.io/gh/your-org/aws-cost-guardian/branch/main/graph/badge.svg)](https://codecov.io/gh/your-org/aws-cost-guardian)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[![Deploy Status](https://img.shields.io/badge/Deploy-✅%20Success-brightgreen)](https://awscostguardian.com)
[![Domain](https://img.shields.io/badge/Domain-✅%20Active-blue)](https://awscostguardian.com)
[![Payments](https://img.shields.io/badge/Payments-✅%20Stripe%20Integrated-purple)](https://awscostguardian.com) 🛡️💰

## ✨ Funcionalidades

### 🎯 Otimização de Custos
- **Recomendações Inteligentes**: Identificação automática de recursos idle e subutilizados
- **Execução Automática**: Aplicação de otimizações com um clique
- **Relatórios Detalhados**: Análises completas de economia potencial
- **SLA Claims**: Reembolso automático por violações de SLA

### 📊 Dashboard Administrativo
- **Métricas em Tempo Real**: Clientes ativos, conversão, churn
- **Análise de Receita**: Rastreamento de MRR e crescimento
- **Monitoramento de Leads**: Conversão de trial para pago
- **Relatórios de Performance**: ROI das recomendações

### 🔐 Sistema de Autenticação
- **AWS Cognito**: Autenticação segura e escalável
- **JWT Tokens**: Autorização stateless
- **Grupos de Usuários**: Controle de acesso baseado em roles
- **Multi-tenant**: Isolamento completo por cliente

### 💳 Sistema de Pagamento
- **Stripe Integration**: Processamento seguro de pagamentos
- **Portal do Cliente**: Gerenciamento de assinaturas
- **Webhooks**: Sincronização automática de status
- **Promoções**: Sistema de descontos configurável

### 📈 Monitoramento Avançado
- **CloudWatch Dashboards**: Visualização completa de métricas
- **Alertas Inteligentes**: Notificações automáticas de problemas
- **X-Ray Tracing**: Debugging distribuído de requests
- **Health Checks**: Monitoramento contínuo de disponibilidade

## 🏗️ Arquitetura

### Backend (AWS Lambda)
```
API Gateway → Lambda → DynamoDB
    ↓         ↓         ↓
  CloudWatch  X-Ray   Streams
```

### Frontend (Next.js)
```
Next.js → Amplify → S3/CloudFront
    ↓         ↓         ↓
  Cognito   API Gateway  Lambda
```

### Infraestrutura (CDK)
- **Auto-scaling**: Lambda escala automaticamente
- **Caching**: API Gateway + CloudFront
- **Backup**: DynamoDB PITR + S3 versioning
- **Security**: WAF + Cognito + KMS

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![AWS Free Tier](https://img.shields.io/badge/AWS-Free%20Tier-blue)](https://aws.amazon.com/free/)
[![React](https://img.shields.io/badge/React-18-green)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Node-18-blue)](https://nodejs.org/)

## 🚀 Instalação e Uso

### Pré-requisitos
- Node.js 18+
- AWS CLI configurado
- Conta AWS com permissões adequadas

### Instalação Rápida

```bash
# Clone o repositório
git clone https://github.com/your-org/aws-cost-guardian.git
cd aws-cost-guardian

# Instale todas as dependências
npm run install:all

# Configure o ambiente de desenvolvimento
npm run setup:dev
```

### Desenvolvimento Local

```bash
# Inicie todos os serviços
npm run dev

# Acesse:
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:3001/dev
```

### Testes

```bash
# Testes unitários
npm test

# Testes de integração
npm run test:integration

# Load testing
npm run load-test http://localhost:3001/dev 10 100

# Health monitoring
npm run health-check http://localhost:3001/dev 60

# Validação de produção
npm run validate-production
```

### Deploy

```bash
# Desenvolvimento
npm run setup:dev
npm run deploy

# Staging
npm run setup:staging
npm run deploy

# Produção
npm run setup:prod
npm run deploy
```

## 📚 API Documentation

### Endpoints Principais

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/health` | Health check público | ❌ |
| `GET` | `/api/health` | Health check detalhado | ❌ |
| `GET` | `/api/onboard-init` | Configuração de onboarding | ✅ |
| `GET` | `/billing/subscription` | Status da assinatura | ✅ |
| `GET` | `/recommendations` | Lista recomendações | ✅ (Pro) |
| `GET` | `/admin/metrics` | Métricas administrativas | ✅ (Admin) |

### Autenticação
```bash
# Bearer token JWT
Authorization: Bearer <your-jwt-token>
```

### Exemplo de Request
```bash
curl -X GET \
  https://api.costguardian.com/prod/api/onboard-init \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json"
```

**[📖 Documentação Completa da API](API-DOCS.md)**

## 🛠️ Desenvolvimento

### Estrutura do Projeto
```
aws-cost-guardian/
├── backend/              # API Lambda
│   ├── handler-simple.js # Handler principal
│   ├── __tests__/       # Testes
│   └── package.json
├── frontend/            # Next.js App
│   ├── app/            # App Router
│   └── components/
├── infra/              # CDK Infrastructure
│   └── lib/
├── scripts/            # Utilitários
├── config/             # Configurações
└── docs/               # CloudFormation templates
```

### Scripts Disponíveis
```bash
# Desenvolvimento
npm run dev              # Inicia frontend + backend
npm run lint            # Executa ESLint
npm run test            # Testes unitários
npm run test:integration # Testes de integração

# Qualidade de Código
npm run lint:fix        # Corrige problemas de linting
npm run test:coverage   # Testes com coverage

# Deploy & Setup
npm run setup:dev       # Configura ambiente dev
npm run setup:staging   # Configura ambiente staging
npm run setup:prod      # Configura ambiente prod
npm run deploy          # Deploy via CDK

# Monitoramento
npm run health-check    # Monitor de saúde
npm run load-test       # Teste de carga
npm run validate-production # Validação pré-deploy
```

### Contribuição

1. **Fork** o projeto
2. Crie uma **branch** (`git checkout -b feature/AmazingFeature`)
3. Faça suas **modificações**
4. Execute os **testes** (`npm test`)
5. Faça o **commit** (`git commit -m 'Add AmazingFeature'`)
6. **Push** para a branch (`git push origin feature/AmazingFeature`)
7. Abra um **Pull Request**

### Padrões de Código

- **ESLint**: Configurado para manter consistência
- **Prettier**: Formatação automática
- **Jest**: Testes unitários e integração
- **TypeScript**: Para infraestrutura CDK

## 📊 Monitoramento & Observabilidade

### Dashboards
- **CloudWatch**: `CostGuardian-Monitoring`
- **X-Ray**: Tracing distribuído
- **Custom Metrics**: Performance de negócio

### Alertas
- **API 5xx**: >5 erros em 2 períodos
- **Latência**: >2s por 2 períodos
- **Lambda Duration**: >25s
- **DynamoDB Throttling**: >10 requests

### Health Checks
```bash
# Monitoramento contínuo
npm run health-check https://api.costguardian.com/prod 60
```

## 🔒 Segurança

- **Cognito**: Autenticação e autorização
- **KMS**: Criptografia de dados sensíveis
- **WAF**: Proteção contra ataques comuns
- **Secrets Manager**: Gerenciamento seguro de secrets
- **VPC**: Isolamento de rede (opcional)

## 📈 Performance

### Benchmarks
- **Throughput**: >1000 req/s
- **Latência P95**: <500ms
- **Cold Start**: <2s (provisioned concurrency)
- **Availability**: 99.9% SLA

### Otimizações
- **Lambda Provisioned Concurrency**: Reduz cold starts
- **API Gateway Caching**: 5min cache para GETs
- **DynamoDB GSI**: Queries otimizadas
- **CloudFront**: CDN global

## 🤝 Suporte

- 📧 **Email**: support@costguardian.com
- 💬 **Discord**: [AWS Cost Guardian Community](https://discord.gg/costguardian)
- 📖 **Docs**: [Documentação Completa](https://docs.costguardian.com)
- 🐛 **Issues**: [GitHub Issues](https://github.com/your-org/aws-cost-guardian/issues)

## 📄 Licença

Este projeto está licenciado sob a Licença MIT - veja o arquivo [LICENSE](LICENSE) para detalhes.

## 🙏 Agradecimentos

- **AWS**: Por fornecer uma plataforma incrível
- **Stripe**: Por uma integração de pagamentos perfeita
- **Open Source Community**: Por ferramentas e bibliotecas incríveis

---

**⭐ Star este repo se achou útil!**

**[🚀 Experimente agora](https://awscostguardian.com)** | **[📖 Leia a documentação](API-DOCS.md)** | **[🤝 Contribua](CONTRIBUTING.md)**
[![CDK](https://img.shields.io/badge/AWS%20CDK-v2-orange)](https://aws.amazon.com/cdk/)
[![Implementation](https://img.shields.io/badge/Implementation-95%25-success)](./FINAL-SUMMARY.md)

**Plataforma FinOps SaaS completa para otimização automatizada de custos AWS. Análise Trial gratuita, execução de recomendações, recuperação de créditos SLA e billing automático via AWS Marketplace. Modelo: 30% sobre economias realizadas.**

> 🎉 **Status**: MVP completo e pronto para deploy! Ver [FINAL-SUMMARY.md](./FINAL-SUMMARY.md) para detalhes.

Baseado na [Análise Estratégica e Arquitetônica](docs/analise-estrategica.md) (PT-BR).

## 📋 Visão Geral

O AWS Cost Guardian resolve o paradoxo da nuvem: flexibilidade que leva a desperdícios. Automatiza detecção de anomalias, agendamento de recursos, gerenciamento de Savings Plans e recuperação de créditos SLA via correlação AWS Health + Cost Explorer. Diferencial: Inteligência proativa, onboarding sem toque via CloudFormation e segurança cross-account.

### Problema Resolvido
- 92% das contas AWS elegíveis a créditos SLA não reclamam (processo manual).
- Ferramentas nativas (Cost Explorer, Anomaly Detection) são consultivas, não acionáveis.
- Impacto: Desperdício médio de USD $150-500/trimestre por conta.

### Proposta de Valor
- **Automação Total**: Implementa recomendações (ex.: desligar instâncias ociosas).
- **Inteligência Única**: Correlaciona custos com eventos Health para alertas contextuais.
- **Sem Risco**: Pague apenas sobre valor recuperado (30% comissão).
- **Mercado**: TAM $18M/trimestre (12M+ contas AWS).

Veja a [matriz competitiva](docs/analise-estrategica.md#parte-i-funcionalidade-essencial-e-posicionamento-competitivo) para posicionamento vs. CloudZero, ProsperOps.

## 🛠️ Stack Técnica (CDK-First)

| Camada | Tecnologia |
|--------|------------|
| **Frontend** | Next.js 14 + Tailwind + Amplify (i18n com 7 idiomas) |
| **Backend** | Node.js + Express em Lambda (EventBridge + Step Functions) |
| **Banco** | DynamoDB (dados de custo granular) + S3 (logs/relatórios) |
| **Auth/Segurança** | Cognito + IAM Cross-Account (ExternalId) |
| **Orquestração** | Step Functions (fluxos SLA) + EventBridge (ingestão Health) |
| **API** | API Gateway (JWT + Throttling) |
| **Infra** | AWS CDK (IaC multi-ambiente) |
| **Pagamentos** | Stripe (webhooks idempotentes) + Marketplace |

Arquitetura EDA: Desacoplada, resiliente. Custos: $0 no Free Tier até 100 clientes.

## 🚀 Quick Start

### 📚 **NOVO: Documentação de Deploy Completa**

Escolha seu guia de deploy:

| Documento | Para Quem | O Que Tem |
|-----------|-----------|-----------|
| **[🚀 DEPLOY-NOW.md](./DEPLOY-NOW.md)** | Quer fazer deploy AGORA | Comandos prontos para copiar/colar |
| **[📖 QUICK-START.md](./QUICK-START.md)** | Primeira vez com CDK/Amplify | Guia passo a passo detalhado |
| **[✅ DEPLOY-CHECKLIST.md](./DEPLOY-CHECKLIST.md)** | Quer garantir que está tudo OK | Checklist completo + troubleshooting |
| **[📋 SETUP-SUMMARY.md](./SETUP-SUMMARY.md)** | Quer entender o que foi feito | Resumo de toda arquitetura |

### ⚡ Deploy em 5 Minutos

```bash
# 1. Validar configuração (Windows PowerShell)
.\validate-setup.ps1

# 2. Instalar dependências
cd infra && npm install
cd ../frontend && npm install

# 3. Deploy!
cd ../infra
npm run build
npm run cdk deploy -- --require-approval never

# 4. Configurar ambiente local (após deploy)
npm run export-outputs
cd ../frontend && npm run dev
```

**Tempo total:** ~45-60 minutos (deploy) + ~5 minutos (config local)

---

### 📖 Clone e Setup Manual

1. **Clone o Repo**:
```bash
git clone https://github.com/MacielG/aws-cost-guardian.git
cd aws-cost-guardian
```

2. **Setup Env** (crie `.env` baseado em `.env.example`):
- AWS Account ID, Stripe Keys, ExternalId secrets.
- Para Marketplace: Seller Account ARN.

3. **Instale Dependências**:
 npm ci  # Raiz (instala em subpastas)


4. **Deploy Autônomo**: 
./deploy-all.sh  # Apenas CDK + Amplify

- Gera: API URL, Cognito Pool, DynamoDB Table.
- Teste onboarding: Clique "Conectar AWS" → CloudFormation link.

5. **Dev Local**:
   cd frontend && npm run dev  # localhost:3000
   # O desenvolvimento do backend é feito via deploy em ambiente de dev/sandbox
   cd infra && cdk deploy --hotswap # Para atualizações rápidas de Lambdas


## 📊 Estrutura do Projeto

## 🔁 Deploy & export de variáveis de ambiente (infra)

O projeto usa o AWS CDK para construir a infra e um script `export-outputs` para exportar os
CloudFormation Outputs para `frontend/.env.local`. O script realiza normalização e validação para
garantir que o `NEXT_PUBLIC_API_URL` não contenha barras duplicadas ou trailing slash, evitando
`//` indesejados quando o frontend concatena rotas.

Prerequisitos
- Credenciais AWS configuradas (profile ou variáveis de ambiente)
- Node.js instalado

Comandos (PowerShell)

```powershell
cd infra
npm run build
npm run cdk -- synth

# Deploy e export automático de outputs
npm run deploy

# Apenas exportar os outputs (stack já deployada)
npm run export-outputs
```

Notas
- O `deploy` em `infra/package.json` executa `cdk deploy` e depois `npm run export-outputs`.
- O script falha explicitamente (com logs/CloudWatch/SNS se configurado) se outputs críticos estiverem faltando,
  prevenindo a criação de um `.env.local` incompleto.
- Para desenvolvimento local rápido, coloque manualmente `frontend/.env.local` com `http://localhost:3001`.

Utilitário frontend

Use `frontend/lib/url.js` (função `joinUrl(base, path)`) para compor URLs no frontend sem gerar barras duplicadas.

aws-cost-guardian/
├── frontend/              # Next.js + Amplify
│   ├── app/               # Páginas: dashboard, onboard, sla-claims
│   ├── lib/               # Amplify config + i18n
│   └── public/locales/    # Arquivos i18n (CORRIGIDO)
├── backend/               # Lógica dos Lambdas
│   ├── handler.js         # API (Express) + Webhooks
│   └── functions/         # Handlers (correlate-health, sla-workflow)
├── infra/                 # AWS CDK (Fonte única da Infra)
│   ├── lib/               # CostGuardianStack.ts (Step Functions + EventBridge)
│   ├── bin/app.ts         # Deploy script
│   └── cdk.json
├── docs/                  # Documentos
│   ├── analise-estrategica.md  # O documento traduzido
│   └── deploy.md          # Guia de conexão AWS
└── deploy-all.sh          # Script único de deploy


## ✨ Funcionalidades Implementadas

### ✅ Autenticação & Segurança
- Login/Signup completo com Cognito
- JWT automático em todas as chamadas API
- Proteção de rotas e endpoints
- Multi-tenant isolado por userId (Cognito sub)
- ExternalId validation para cross-account

### ✅ Trial Funnel (Lead Magnet)
- Landing page profissional (`/trial`)
- Template CloudFormation Read-Only
- Dashboard com economia **potencial**
- Upgrade Trial → Active sem fricção

### ✅ Análise & Recomendações
- Detecção automática de:
  - Instâncias EC2 ociosas (< 5% CPU)
  - Volumes EBS não utilizados (> 7 dias)
  - Instâncias RDS ociosas (< 1 conexão/dia)
- Dashboard com priorização por impacto
- **Execução automática** via API
- Exclusão por tags customizáveis

### ✅ SLA & Créditos AWS
- Correlação AWS Health + Cost Explorer
- Cálculo automático de impacto financeiro
- Geração de PDF profissional
- Abertura automática de ticket AWS Support
- Download de relatórios

### ✅ Billing & Monetização
- Dashboard de economias realizadas
- Cálculo de comissão 30% automático
- Integração AWS Marketplace (BatchMeterUsage)
- Histórico mensal detalhado

### ✅ Admin Dashboard
- Métricas de negócio (Trials, Conversão, Receita)
- Funil de conversão visual
- Alertas de leads de alto valor
- Performance de recomendações

## 📈 Métricas de Sucesso (do Documento)

| Indicador | Meta |
|-----------|------|
| Precisão Detecções | >90% |
| MTTR Incidentes | <5 min |
| ROI Cliente | ≥30x |
| Uptime | 99.9% |
| Churn | <5% |

## 🤝 Contribuições & Suporte

- **Issues**: [Abra uma issue](https://github.com/guilherme-maciel/aws-cost-guardian/issues).
- **Comunidade**: Junte-se ao [Discord FinOps Brasil](https://discord.gg/finops-br) ou Reddit r/AWS.
- **Contribua**: Fork → PR no `develop`. Siga [CONTRIBUTING.md](CONTRIBUTING.md).
- **Licença**: MIT. Veja [LICENSE](LICENSE).

## 📄 Anexos

- [Análise Estratégica Completa (PT-BR)](docs/analise-estrategica.md)
- [Diagrama Arquitetural](docs/arch-diagram.drawio) (gere via draw.io com EDA + Step Functions)
- [Projeção Financeira](docs/financeiro.md): Mês 12: 1000 clientes, $85k lucro.

**"Transforme dados de custo em ação: Otimize, recupere, prospere."**  
— *AWS Cost Guardian Manifesto*

*Desenvolvido com ❤️ para devs AWS. Free Tier ready.*