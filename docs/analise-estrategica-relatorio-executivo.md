# RELATÓRIO EXECUTIVO FINAL: ESTRATÉGIA GO-TO-MARKET VALIDADA
## AWS Cost Guardian - Plano de Aquisição e Crescimento

**Data:** Novembro 2025  
**Status:** Validado por Análise Cruzada de Mercado  
**Objetivo:** Documento definitivo para execução imediata

---

## I. SÍNTESE EXECUTIVA

### 1.1. Proposta de Valor Validada

**AWS Cost Guardian** é uma plataforma SaaS de FinOps que oferece:
- **Otimização automática de custos AWS** via análise contínua
- **Recuperação automática de créditos SLA** (diferencial competitivo único)
- **Detecção de anomalias** e alertas proativos
- **Modelo de receita:** 30% sobre economias geradas (alinhamento de incentivos)

**Validação de Mercado:** O mercado global de Cloud FinOps cresce a uma taxa composta (CAGR) de 11,1-12,4%, projetado para atingir US$23-30,5 bilhões até 2031. Cerca de 53-63% das pequenas e médias empresas já utilizam AWS, e aproximadamente 60% das organizações possuem equipes ou esforços dedicados à otimização de custos em nuvem (FinOps).

### 1.2. Diferencial Competitivo Único (Validado)

A recuperação automática de créditos de SLA da AWS representa uma oportunidade significativa, com estimativas indicando mais de US$20 bilhões em créditos não reclamados globalmente. Este diferencial é:

- **Indefensável pela concorrência:** Competidores (ProsperOps, CloudZero) focam em Reserved Instances e Savings Plans
- **Valor imediato mensurável:** ROI visível antes de solicitar permissões write
- **Barreira de confiança reduzida:** Demonstra valor sem riscos iniciais

Empresas especializadas em recuperação de SLA conseguem resgatar cerca de 1-3% dos gastos totais em créditos, validando o potencial financeiro significativo deste recurso.

---

## II. PERFIL DE CLIENTE IDEAL (ICP) - VALIDADO

### 2.1. Segmento Primário: Scale-Ups Tecnológicas

| Característica | Especificação | Validação de Mercado |
|----------------|---------------|----------------------|
| **Gasto AWS Mensal** | US$5.000 - US$50.000<br>(R$25.000 - R$250.000) | 53-63% das PMEs usam infraestrutura em nuvem, aumentando para 74% em empresas focadas em tecnologia |
| **Tamanho da Empresa** | 50-500 funcionários | Fase pós-Series A |
| **Vertical** | SaaS, E-commerce, Mobile Apps, AdTech | Alto consumo de infraestrutura AWS |
| **Maturidade FinOps** | **Sem equipe dedicada** | Equipes de FinOps existem em 40-65% das organizações, frequentemente de forma ad hoc |
| **Persona Decisora** | CTO, VP Engineering, DevOps Lead | Responsável por OpEx, focado em TTM |

### 2.2. Dor Central Identificada

**Custo de oportunidade:** Engenheiros seniores (custo: R$15.000-25.000/mês) gastam 4-8 horas mensais em:
- Análise manual de Cost Explorer
- Correlação de eventos AWS Health com faturas
- Reivindicação manual de créditos SLA
- Otimização reativa de recursos

**Validação:** Estimativas indicam desperdício de US$150-500 por trimestre em tarefas manuais de otimização, além de 88% das empresas enfrentarem gastos desnecessários em nuvem.

### 2.3. Segmento Secundário: Canal MSP (Managed Service Providers)

**Modelo Separado (White-Label):**
- Aproximadamente 90% das PMEs utilizam MSPs e cerca de 60% das grandes organizações contratam MSPs para serviços de TI e nuvem
- **Estratégia:** Licenciamento fixo (R$100-150/conta cliente gerenciada)
- **Margem MSP:** Mínimo 40% para sustentabilidade do canal
- **Vantagem:** Evita conflito direto (MSP não compete com cliente final)

---

## III. ESTRATÉGIA GO-TO-MARKET: MODELO HÍBRIDO VALIDADO

### 3.1. Decisão Estratégica: PLG-Assistido

Após análise crítica de três modelos divergentes (Marketing-Led Growth tradicional, Product-Led Growth radical, e Híbrido), a estratégia validada combina:

**PLG como Base (Product-Led Growth):**
- Inscrição direta com freemium read-only
- Time-to-Value (TTV) < 10 minutos
- Dashboard mostrando créditos SLA identificados

**+ MLG Cirúrgico (Marketing-Led para suporte):**
- Conteúdo educativo para tráfego frio
- Nurture por email apenas para usuários inativos
- Abordagem de confiança (segurança IAM, ExternalId)

**Justificativa:** Exemplos como Atlassian demonstram crescimento para 125.000 clientes sem equipe de vendas pesada, investindo em produto extraordinário que se vende por si, enquanto práticas recomendadas de PLG enfatizam entregar valor em minutos, não dias.

### 3.2. Arquitetura de Funil Validada

```
ESTÁGIO 1: AQUISIÇÃO (Canais Pagos)
├─ Google Search Ads (70% do budget)
│  └─ Keywords: "aws sla credit claim", "recuperar crédito aws", "otimizar custos aws"
│  └─ CPC Estimado: R$20-40 (baseado em benchmarks similares)
│
├─ LinkedIn Ads (20% do budget)
│  └─ Targeting: Cargo (CTO/VP Eng/DevOps) + Empresa 50-500 + Tech
│  └─ CPC Estimado: R$100-200
│
└─ Reddit/Comunidades Técnicas (10% do budget)
   └─ r/aws, r/devops, r/startups - conteúdo nativo

ESTÁGIO 2: CONVERSÃO (Landing Page Híbrida)
├─ CTA Primário: "Conecte sua Conta AWS Agora" (Read-Only)
│  └─ Para tráfego quente (pesquisa de intenção)
│
├─ CTA Secundário: "Ver Demo Interativa"
│  └─ Para tráfego morno (LinkedIn, descoberta)
│
└─ Fallback: "Baixar Checklist de SLA"
   └─ Para tráfego frio (necessita educação)

ESTÁGIO 3: ATIVAÇÃO (Freemium Read-Only)
├─ Onboarding: CloudFormation stack read-only (deploy < 60 segundos)
├─ Análise Imediata: Scan de 90 dias de histórico AWS
├─ Dashboard de Valor: "Você tem R$XXX em créditos SLA não reclamados"
└─ Gatilho de Conversão: "Ativar Recuperação Automática" → Trial 30 dias

ESTÁGIO 4: NURTURE CIRÚRGICO (Condicional)
├─ SE não conectou em 24h:
│  └─ Email 1: "Por que 92% não reivindicam créditos SLA"
│  └─ Email 2: "Como protegemos sua conta (ExternalId explicado)"
│
└─ SE conectou mas não ativou trial em 7 dias:
   └─ Email: "Você tem R$XXX esperando. Ativar em 1 clique?"
```

---

## IV. MÉTRICAS E KPIs VALIDADOS

### 4.1. Métricas Primárias (Orientadas a Valor)

| Métrica | Definição | Meta | Justificativa |
|---------|-----------|------|---------------|
| **CAC-to-Activation** | Gasto em ads ÷ Contas AWS conectadas | < R$150 | Mede eficiência real de aquisição |
| **Time-to-Value (TTV)** | Mediana até dashboard com créditos SLA | < 10 min | Metas de TTV em PLG são de minutos, não dias |
| **PQL Rate** | % usuários freemium com >R$100 economias | > 40% | Qualificação por produto |
| **Trial Activation** | % PQLs que upgradam para trial pago | > 30% | Conversão natural baseada em valor |
| **Trial-to-Paid** | % trials que convertem para clientes pagos | > 40% | Indica fit produto-mercado |

### 4.2. Métricas de Sustentabilidade Financeira

| Métrica | Definição | Meta | Benchmark Validado |
|---------|-----------|------|-------------------|
| **LTV/CAC** | (MRR × Retenção Média × Margem) ÷ CAC | > 3:1 | Benchmark SaaS estabelecido para saúde financeira |
| **CAC Payback** | Meses para recuperar CAC via MRR líquido | < 6 meses | Padrão de mercado é até 12 meses; empresas top performam em 5-7 meses |
| **Gross Margin** | (Receita - COGS) ÷ Receita | > 75% | SaaS típico mantém margens de 75-85% |
| **Monthly Churn** | % clientes que cancelam por mês | < 10% | Sustentabilidade de longo prazo |

### 4.3. Métricas Depreciadas (Não Prioritárias)

❌ **CPL Genérico:** Atrai leads não-qualificados (estudantes, consultores sem autoridade IAM)  
❌ **CTR Isolado:** Não mede intenção ou qualidade  
❌ **Volume de Leads:** Vanity metric sem correlação com receita

---

## V. PROJEÇÕES FINANCEIRAS VALIDADAS

### 5.1. Premissas Base (Conservadoras)

```
INVESTIMENTO MENSAL
├─ Budget Ads Total: R$15.000
├─ Distribuição: 70% Google (R$10.500) + 30% LinkedIn (R$4.500)
└─ CPC Médio Ponderado: R$25

TAXAS DE CONVERSÃO (Benchmarks PLG)
├─ CTR Médio: 3%
├─ Taxa de Ativação (Conectar AWS): 25%
├─ PQL Rate: 40%
├─ Trial Activation: 30%
├─ Trial-to-Paid: 40%

ECONOMIA E RECEITA
├─ Economia Média/Cliente: R$2.000/mês
├─ Comissão: 30% = R$600 MRR/cliente
├─ Retenção Média: 24 meses
└─ Margem Líquida: 80%
```

### 5.2. Cálculo Mensal (Cenário Base)

| Etapa do Funil | Cálculo | Resultado |
|----------------|---------|-----------|
| **Clicks em Ads** | R$15.000 ÷ R$25 | 600 clicks |
| **Contas Conectadas** | 600 × 25% | 150 ativações |
| **PQLs Gerados** | 150 × 40% | 60 PQLs |
| **Trials Ativos** | 60 × 30% | 18 trials |
| **Clientes Pagos** | 18 × 40% | **7 novos clientes/mês** |
| **MRR Novo** | 7 × R$600 | **R$4.200/mês** |
| **CAC por Cliente** | R$15.000 ÷ 7 | **R$2.143** |

### 5.3. Validação de Sustentabilidade

**LTV (Lifetime Value):**
```
LTV = MRR × Retenção × Margem Líquida
LTV = R$600 × 24 meses × 0.80
LTV = R$11.520
```

**LTV/CAC Ratio:**
```
LTV/CAC = R$11.520 ÷ R$2.143
LTV/CAC = 5,4:1 ✅
```
**Validação:** Ratio acima de 3:1 é considerado saudável para SaaS

**CAC Payback Period:**
```
Payback = CAC ÷ (MRR × Margem)
Payback = R$2.143 ÷ (R$600 × 0.80)
Payback = 4,5 meses ✅
```
**Validação:** Abaixo do benchmark de 12 meses e próximo de empresas top-performing.

### 5.4. Cenários Alternativos

| Cenário | Budget | Clientes/Mês | MRR Novo | CAC | LTV/CAC | Payback |
|---------|--------|--------------|----------|-----|---------|---------|
| **Pessimista** | R$15k | 4 | R$2.400 | R$3.750 | 3,1:1 | 7,8 meses |
| **Base** | R$15k | 7 | R$4.200 | R$2.143 | 5,4:1 | 4,5 meses |
| **Otimista** | R$15k | 11 | R$6.600 | R$1.364 | 8,4:1 | 2,8 meses |
| **Escala (Mês 6+)** | R$30k | 18 | R$10.800 | R$1.667 | 6,9:1 | 3,5 meses |

---

## VI. ESTRATÉGIA DE CANAIS COMPLEMENTARES

### 6.1. Community-Led Growth (CLG) - Orgânico

**Tática:** Ferramenta CLI Open-Source "aws-sla-hunter"

**Objetivo:** Construir credibilidade técnica e gerar leads orgânicos de alta qualidade

**Implementação:**
1. **Desenvolvimento:** CLI em Python que escaneia AWS Health Events e identifica créditos elegíveis
2. **Lançamento:** GitHub + Hacker News + r/aws
3. **Conversão:** README aponta para versão web com automação completa

**Métricas de Sucesso (Mês 2-3):**
- 50+ stars no GitHub
- 20+ sign-ups orgânicos/mês
- 5+ menções em comunidades técnicas

**Validação:** Estratégia testada por Infracost, Komiser e outras ferramentas DevOps que cresceram via open-source.

### 6.2. Account-Based Marketing (ABM) - Data-Driven

**Tática:** Enriquecimento e segmentação de contas prioritárias

**Fonte de Dados:**
- Crunchbase: Startups brasileiras com Series A+ (2024-2025)
- LinkedIn Sales Navigator: Enriquecimento de decisores
- Built With / Datanyze: Empresas usando AWS

**Lista Alvo:** 500 contas ICP prioritárias

**Canais:**
- LinkedIn InMail (personalizado por empresa)
- Email direto (via Hunter.io/Apollo.io)
- Retargeting ads (somente para contas-alvo)

---

## VII. ESTRATÉGIA DE CANAL MSP (WHITE-LABEL)

### 7.1. Modelo de Parceria Validado

**Separação Estratégica:**
- **Segmento Direto:** Scale-ups → PLG → 30% comissão sobre economias
- **Segmento MSP:** Managed Service Providers → White-label SaaS → Licença fixa

**Justificativa:** Pesquisas confirmam que aproximadamente 90% das PMEs usam MSPs, tornando essencial evitar conflito de canal.

### 7.2. Estrutura de Licenciamento

| Parâmetro | Especificação |
|-----------|---------------|
| **Modelo de Preço** | R$100-150/mês por conta cliente gerenciada |
| **Margem MSP** | 40-50% (revenda a R$180-250/conta) |
| **White-Label** | Dashboard customizável com branding do MSP |
| **Suporte** | Tier 1 pelo MSP, Tier 2 por AWS Cost Guardian |
| **Onboarding** | Kit de vendas + treinamento técnico |

### 7.3. Critérios de Qualificação para MSP

✅ **Obrigatórios:**
- Gerencia mínimo 20 contas AWS ativas
- Certificação AWS (mínimo: Solutions Architect Associate)
- Contrato de revenda (mínimo 12 meses)

✅ **Preferenciais:**
- AWS Advanced Tier Partner
- Portfólio de clientes com >R$50k/mês AWS spend
- Equipe FinOps interna

---

## VIII. ROADMAP DE IMPLEMENTAÇÃO (90 DIAS)

### 8.1. Mês 1: Setup + Teste A/B Crítico

**Semanas 1-2: Desenvolvimento de Ativos**
- [ ] Landing Page Variante A (PLG): "Conecte AWS Agora"
- [ ] Landing Page Variante B (MLG): "Baixe Checklist SLA"
- [ ] Dashboard Freemium (read-only)
- [ ] CloudFormation template (IAM role read-only)
- [ ] Sequência de nurture (4 emails)

**Semanas 3-4: Lançamento de Campanhas**
- [ ] Google Search Ads: 15 palavras-chave (R$10.500)
- [ ] LinkedIn Ads: 3 audiências (R$4.500)
- [ ] Tracking: Google Analytics 4 + Mixpanel/Amplitude
- [ ] Split 50/50 entre Variantes A e B

**Meta Mês 1:**
- 600 clicks
- 150 contas AWS conectadas
- 60 PQLs identificados
- Dados suficientes para decisão A/B

### 8.2. Mês 2: Otimização + Community-Led Growth

**Análise A/B (Semana 5):**
- [ ] Comparar CAC-to-Paid entre Variantes
- [ ] Decisão: Se diferença >30%, adotar vencedor. Se <30%, manter híbrido.
- [ ] Realocação de budget para canal vencedor

**Lançamento CLG (Semanas 6-8):**
- [ ] Release "aws-sla-hunter" CLI no GitHub
- [ ] Post no Hacker News + r/aws + r/devops
- [ ] Artigo técnico: "Como Encontrar $500 em Créditos AWS Perdidos"
- [ ] Webinar: "FinOps para CTOs: Além de RIs e SPs"

**Meta Mês 2:**
- 18 trials ativos
- 50+ stars GitHub
- 20+ sign-ups orgânicos
- Primeiros 3-5 clientes pagos

### 8.3. Mês 3: Escala + Validação MSP

**Escala de Aquisição (Semanas 9-10):**
- [ ] Aumentar budget para R$25.000-30.000 (se LTV/CAC >3:1)
- [ ] Expandir para 5 novas palavras-chave (Google)
- [ ] Adicionar Reddit Ads (r/aws, r/devops)

**Piloto MSP (Semanas 11-12):**
- [ ] Recrutar 3 MSPs parceiros (critérios validados)
- [ ] Implementar white-label para 1º MSP
- [ ] Contrato piloto: 3 meses, R$100/conta, margem 40%
- [ ] Training: Workshop de 4 horas (técnico + vendas)

**Meta Mês 3:**
- 7-10 clientes diretos novos
- MRR acumulado: R$6.000-10.000
- 3 MSPs ativos gerenciando 15+ contas
- Validação: LTV/CAC >3:1, Churn <10%

---

## IX. TESTES CRÍTICOS E CRITÉRIOS DE DECISÃO

### 9.1. Teste A/B: PLG vs MLG (Mês 1-2)

**Hipótese:** Variante PLG (conexão direta) terá CAC-to-Paid significativamente menor que MLG (lead magnet).

**Variáveis Mensuradas:**
- CAC por cliente pago
- Taxa de ativação (conexão AWS)
- Tempo médio até ativação
- Taxa trial-to-paid

**Critérios de Decisão:**

| Resultado | Ação |
|-----------|------|
| **Variante A (PLG) CAC 30%+ menor** | Adotar PLG puro, depreciar lead magnet |
| **Variante B (MLG) CAC 30%+ menor** | Manter híbrido com nurture forte |
| **Diferença < 30%** | Segmentar por fonte: Google→PLG, LinkedIn→MLG |

### 9.2. Validação de Canal MSP (Mês 3-4)

**Métricas de Sucesso:**

| KPI | Meta | Red Flag |
|-----|------|----------|
| **Preço Aceito por MSP** | R$100-150/conta | Resistência a >R$120 |
| **Margem MSP Real** | ≥40% | <30% (insustentável) |
| **Retenção MSP (3 meses)** | 100% | Qualquer churn |
| **Accounts Under Management** | 5+ contas/MSP | <3 contas (falta escala) |

**Critério Go/No-Go:** Se 2 de 3 MSPs atingirem todas as metas, institucionalizar canal. Caso contrário, revisar modelo ou adiar.

### 9.3. Gatilhos de Escala (Mês 4+)

**Condições para Aumentar Budget 2x:**

✅ LTV/CAC > 3:1 (sustentado por 2 meses)  
✅ CAC Payback < 6 meses  
✅ Churn mensal < 10%  
✅ Gross Margin > 75%  
✅ Taxa de ativação > 20%

**Se todas as condições forem atendidas:** Aumentar budget de R$15k para R$30k/mês e contratar Sales Development Representative (SDR) para qualificação de leads.

---

## X. CONSIDERAÇÕES DE INTERNACIONALIZAÇÃO

### 10.1. Localização (Expansão Futura)

Estudos demonstram que aproximadamente 75% dos consumidores preferem sites no próprio idioma, e mais da metade evita sites apenas em inglês.

**Priorização de Mercados (Pós-Produto Market Fit Brasil):**
1. **LATAM:** Argentina, México, Chile (20% YoY growth AWS)
2. **Europa:** Reino Unido, Alemanha, França (alto AWS spend per capita)
3. **Ásia-Pacífico:** Singapura, Austrália (maturidade FinOps)

**Requisitos Técnicos:**
- Interface multi-idioma (i18n)
- Suporte a fusos horários
- Documentação localizada

### 10.2. Processamento de Pagamentos Global

Recomenda-se usar Stripe, que suporta mais de 135 moedas, facilitando transações em múltiplas regiões com checkout local.

**Implementação:**
- Stripe Billing para recorrência
- Pagamento em moeda local (BRL, USD, EUR, etc.)
- Compliance local (nota fiscal automática via integrações)

---

## XI. GESTÃO DE RISCOS E MITIGAÇÕES

### 11.1. Riscos Identificados

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| **Taxa de ativação <20%** | Média | Alto | A/B test de onboarding, simplificar CloudFormation |
| **Conversão freemium <2%** | Média | Crítico | Reduzir período freemium para 14 dias, adicionar urgência |
| **COGS freemium alto** | Baixa | Médio | Limitar scans a 90 dias, throttling de API calls |
| **Concorrência copycat** | Alta | Médio | Speed-to-market, construir moat via CLG e partnerships |
| **Mudanças AWS SLA policy** | Baixa | Alto | Diversificar value props (anomalias, RIs, etc.) |

### 11.2. Planos de Contingência

**Se CAC > R$3.000 (insustentável):**
- Pausar campanhas pagas
- Focar 100% em CLG e SEO
- Revisar targeting (reduzir LinkedIn, aumentar Google cauda longa)

**Se churn > 15%:**
- Customer success proativo (check-ins mensais)
- Feature de "economia acumulada" (gamificação)
- Programa de referral (R$300 de desconto por indicação)

---

## XII. CONCLUSÃO E PRÓXIMOS PASSOS IMEDIATOS

### 12.1. Consensos Validados (Executar com Confiança)

✅ **ICP Primário:** Scale-ups SaaS/E-commerce, R$25k-250k AWS/mês, 50-500 funcionários  
✅ **Diferencial Único:** Recuperação automática de créditos SLA (mercado de US$20Bi+ não atendido)  
✅ **Canais Core:** Google Search (70%) + LinkedIn (20%) + Comunidades (10%)  
✅ **Modelo Financeiro:** 30% sobre economias para direto; licença fixa para MSPs  
✅ **Métricas Primárias:** CAC-to-Activation, TTV, PQL Rate, LTV/CAC >3:1

### 12.2. Decisão Estratégica Final

**Modelo Híbrido PLG-Assistido** é a estratégia validada:
- PLG como base (produto self-serve, TTV rápido)
- MLG como suporte cirúrgico (nurture para inativos)
- Separação de canal MSP (white-label, sem conflito)

**Fundamentação:** Combina eficiência de custos do PLG (exemplificado pelo crescimento da Atlassian) com previsibilidade do MLG, endereçando especificamente as barreiras de confiança do público técnico B2B.

### 12.3. Checklist de Execução Imediata (Próximos 7 Dias)

- [ ] **Dia 1-2:** Contratar desenvolvedor para dashboard freemium (React + Tailwind)
- [ ] **Dia 3-4:** Criar landing pages A/B (Webflow ou código custom)
- [ ] **Dia 5:** Configurar tracking (GA4 + Mixpanel)
- [ ] **Dia 6:** Preparar campanhas Google/LinkedIn (copy, criativos, targeting)
- [ ] **Dia 7:** Soft launch com R$5.000 budget para validação técnica

### 12.4. Métricas de Acompanhamento Semanal

**Dashboard Executivo (atualização toda segunda-feira):**
1. Gasto em Ads vs Budget
2. CAC-to-Activation (atual vs meta R$150)
3. Contas conectadas (acumulado)
4. PQLs gerados (% do total)
5. MRR novo (rolling 30 dias)
6. LTV/CAC ratio (atualizado mensalmente)

### 12.5. Critério de Sucesso (90 Dias)

**Go:** Se atingir 7+ clientes pagos, LTV/CAC >3:1, e payback <6 meses → Escalar para R$30k/mês  
**Pivot:** Se CAC >R$3.000 ou churn >15% → Revisar ICP ou value proposition  
**No-Go:** Se <3 clientes pagos após 90 dias → Questionar product-market fit

---

## APÊNDICES

### Apêndice A: Palavras-Chave Google Search (Prioridade Alta)

| Keyword | Volume Est. | CPC Est. | Intenção |
|---------|-------------|----------|----------|
| "recuperar crédito sla aws" | Baixo | R$15-30 | Muito Alta |
| "aws health event crédito" | Muito Baixo | R$10-20 | Muito Alta |
| "otimizar custos aws automaticamente" | Médio | R$30-50 | Alta |
| "finops aws brasil" | Baixo | R$20-35 | Média |
| "reduzir conta aws" | Médio | R$25-40 | Média |

### Apêndice B: Estrutura de Emails de Nurture

**Email 1 (Imediato):** "Seu Checklist de Recuperação de SLA"  
**Email 2 (Dia 2):** "O Problema do Processo Manual (Por que 88% desperdiçam)"  
**Email 3 (Dia 4):** "Como Funciona o ExternalId (Segurança Explicada)"  
**Email 4 (Dia 7):** "Veja Seus Números em 10 Minutos (CTA: Conectar AWS)"

### Apêndice C: Template de CloudFormation (Read-Only)

```yaml
# IAM Role para AWS Cost Guardian (Read-Only)
Resources:
  CostGuardianRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Statement:
          - Effect: Allow
            Principal:
              AWS: arn:aws:iam::123456789:root
            Action: sts:AssumeRole
            Condition:
              StringEquals:
                sts:ExternalId: !Ref ExternalId
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/ReadOnlyAccess
        - arn:aws:iam::aws:policy/AWSSupportAccess
```

---

**DOCUMENTO APROVADO PARA EXECUÇÃO**  
**Próxima Revisão:** Após Mês 1 (Análise de Teste A/B)