# AWS Cost Guardian 🛡️💰

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![AWS Free Tier](https://img.shields.io/badge/AWS-Free%20Tier-blue)](https://aws.amazon.com/free/)
[![React](https://img.shields.io/badge/React-18-green)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Node-18-blue)](https://nodejs.org/)
[![CDK](https://img.shields.io/badge/AWS%20CDK-v2-orange)](https://aws.amazon.com/cdk/)
[![Serverless](https://img.shields.io/badge/Serverless-First-red)](https://aws.amazon.com/serverless/)

**Plataforma FinOps automatizada para otimização de custos AWS: Visibilidade, automação e inteligência proativa. Recupere créditos SLA automaticamente e correlacione incidentes com impactos financeiros. Modelo: 30% sobre economias recuperadas.**

Baseado na [Análise Estratégica e Arquitetônica](docs/analise-estrategica.md) (PT-BR). MVP em 3 semanas, escalável via serverless.

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

## 🛠️ Stack Técnica (Serverless-First)

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

1. **Clone o Repo**:
git clone https://github.com/guilherme-maciel/aws-cost-guardian.git
   cd aws-cost-guardian

2. **Setup Env** (crie `.env` baseado em `.env.example`):
- AWS Account ID, Stripe Keys, ExternalId secrets.
- Para Marketplace: Seller Account ARN.

3. **Instale Dependências**:
 npm ci  # Raiz (instala em subpastas)


4. **Deploy Autônomo**: 
./deploy-all.sh  # CDK + Serverless + Amplify

- Gera: API URL, Cognito Pool, DynamoDB Table.
- Teste onboarding: Clique "Conectar AWS" → CloudFormation link.

5. **Dev Local**:
cd frontend && npm run dev  # localhost:3000
   cd backend && npm run dev   # API local via serverless-offline


## 📊 Estrutura do Projeto
aws-cost-guardian/
├── frontend/              # Next.js + Amplify
│   ├── app/               # Páginas: dashboard, onboard, sla-claims
│   ├── lib/               # Amplify config + i18n
│   └── locales/           # pt-BR, en-US, etc.
├── backend/               # Serverless Framework
│   ├── handler.js         # Express + Stripe webhooks
│   ├── functions/         # detect-anomalies.js, submit-sla.js
│   └── serverless.yml     # Lambda + DynamoDB
├── infra/                 # AWS CDK
│   ├── lib/               # CostGuardianStack.ts (Step Functions + EventBridge)
│   ├── bin/app.ts         # Deploy script
│   └── cdk.json
├── docs/                  # Documentos
│   ├── analise-estrategica.md  # O documento traduzido
│   └── deploy.md          # Guia de conexão AWS
├── locales/               # i18n global
└── deploy-all.sh          # Script único de deploy


## 🧩 Funcionalidades Chave (por Fase do Roadmap)

### Fase 1: Fundação (MVP)
- Onboarding: CloudFormation StackSet para multi-contas.
- Visibilidade: Dashboard com Cost Explorer API (filtros/tags).
- Armazenamento: DynamoDB para custos granulares.

### Fase 2: Automação
- Rightsizing/Limpeza: Lambda para parar instâncias ociosas (opt-in role).
- Compromissos: Análise SP/RI com recomendações (Step Functions).

### Fase 3: Diferenciação
- Correlação Health: EventBridge rule para eventos `aws.health` → Alertas contextuais.
- Créditos SLA: Fluxo automatizado (calcular impacto + relatório PDF via Lambda).

### Fase 4: Escala
- Marketplace: ResolveCustomer + BatchMeterUsage.
- Observabilidade: CloudWatch + X-Ray (rastreamento distribuído).

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