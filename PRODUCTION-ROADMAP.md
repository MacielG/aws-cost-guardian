# 🎯 AWS Cost Guardian - Roadmap para Produção

**Versão:** 3.0  
**Data:** 01/11/2025  
**Status Atual:** Deploy AWS completo, Backend funcional, Frontend 70% completo

---

## 📊 Status Geral

| Componente | Status | Prioridade |
|------------|--------|------------|
| ✅ Infraestrutura AWS (CDK) | DEPLOYADO | - |
| ✅ Backend API (Serverless) | FUNCIONAL | - |
| ✅ Cognito Setup | CONFIGURADO | - |
| ⚠️ Frontend - Autenticação | 80% | 🔴 CRÍTICO |
| ⚠️ Frontend - UX/UI | 60% | 🟡 ALTO |
| ❌ Testes de Integração | 0% | 🟡 ALTO |
| ❌ Documentação do Usuário | 0% | 🟢 MÉDIO |

---

## 🎯 FASE 1: AUTENTICAÇÃO & NAVEGAÇÃO (CRÍTICO)
**Prazo:** 1-2 dias  
**Objetivo:** Garantir que login/logout funcione perfeitamente e navegação seja clara

### 1.1 ✅ Verificar Cognito (PRIORITÁRIO)

**Tarefas:**
- [ ] **Teste 1.1.1**: Acessar `/login` e tentar criar conta nova
  - Verificar se email de confirmação chega
  - Confirmar código funciona
  - Redirecionamento pós-login funciona
  
- [ ] **Teste 1.1.2**: Login com usuário existente
  - Verificar se token JWT é gerado
  - Verificar se `AuthProvider` detecta usuário logado
  - Verificar se chamadas API incluem token

- [ ] **Teste 1.1.3**: Proteção de rotas
  - Tentar acessar `/dashboard` sem login → deve redirecionar para `/login`
  - Após login, acessar `/dashboard` → deve funcionar

**Critério de Aceitação:**
- ✅ Usuário consegue criar conta
- ✅ Usuário consegue fazer login
- ✅ Token JWT é enviado em todas as chamadas API
- ✅ Rotas protegidas redirecionam para login

**Complexidade:** 🟢 Baixa (já implementado, apenas testar)

---

### 1.2 ⚠️ Implementar Logout Universal

**Problema Atual:** Logout pode existir no `AuthProvider` mas não em todas as páginas

**Tarefas:**
- [ ] **1.2.1**: Criar componente `Header` com botão de logout
  ```tsx
  // frontend/components/layout/Header.tsx
  - Logo
  - Nome do usuário
  - Botão "Logout"
  - Link para Dashboard/Settings
  ```

- [ ] **1.2.2**: Adicionar Header em `layout.tsx` (global)
  ```tsx
  <AuthProvider>
    <Header /> {/* Só aparece se logado */}
    {children}
  </AuthProvider>
  ```

- [ ] **1.2.3**: Implementar função de logout no Header
  ```tsx
  const handleLogout = async () => {
    await signOut();
    router.push('/login');
  };
  ```

- [ ] **1.2.4**: Testar logout de todas as páginas

**Critério de Aceitação:**
- ✅ Botão de logout visível em todas as páginas autenticadas
- ✅ Logout limpa sessão e redireciona para `/login`
- ✅ Após logout, usuário não consegue acessar rotas protegidas

**Complexidade:** 🟡 Média  
**Prioridade:** 🔴 MUST-HAVE

---

### 1.3 ⚠️ Melhorar UX do Login

**Tarefas:**
- [ ] **1.3.1**: Adicionar modo Trial vs Produção no login
  - Botão "Começar Trial Grátis" → `/login?mode=trial`
  - Botão "Login" → `/login`

- [ ] **1.3.2**: Customizar `Authenticator` do Amplify
  - Remover campos desnecessários
  - Adicionar logo da empresa
  - Melhorar mensagens de erro

- [ ] **1.3.3**: Adicionar "Esqueci minha senha"
  - Amplify já suporta, apenas habilitar

**Critério de Aceitação:**
- ✅ Login visualmente profissional
- ✅ Diferenciação clara entre Trial e Produção
- ✅ Recuperação de senha funciona

**Complexidade:** 🟡 Média  
**Prioridade:** 🟡 SHOULD-HAVE

---

### 1.4 ❌ Implementar Navegação Principal

**Problema Atual:** Usuário não sabe como navegar entre páginas

**Tarefas:**
- [ ] **1.4.1**: Criar componente `Sidebar` ou `Navigation`
  ```
  - Dashboard
  - Recomendações
  - SLA Claims
  - Billing
  - Settings
    - Conexões AWS
    - Automação
  - Admin (só para admin)
  ```

- [ ] **1.4.2**: Adicionar indicador de página ativa

- [ ] **1.4.3**: Responsividade mobile (menu hambúrguer)

**Critério de Aceitação:**
- ✅ Usuário consegue navegar facilmente entre todas as páginas
- ✅ Navegação clara e intuitiva
- ✅ Funciona em mobile

**Complexidade:** 🟡 Média  
**Prioridade:** 🔴 MUST-HAVE

---

## 🎯 FASE 2: FUNCIONALIDADES CORE (ALTO)
**Prazo:** 3-4 dias  
**Objetivo:** Garantir que fluxos principais funcionem end-to-end

### 2.1 ⚠️ Onboarding AWS (Conectar Conta)

**Status Atual:** Página existe (`/onboard`) mas precisa de teste

**Tarefas:**
- [ ] **2.1.1**: Testar fluxo completo de onboarding
  - Usuário clica "Conectar AWS"
  - Recebe template CloudFormation
  - Executa stack na AWS
  - Stack faz callback para `/api/onboard`
  - Backend salva configuração

- [ ] **2.1.2**: Melhorar UX do onboarding
  - Instruções passo-a-passo visuais
  - Loading state durante callback
  - Mensagem de sucesso clara
  - Redirecionamento para Dashboard

- [ ] **2.1.3**: Tratamento de erros
  - Se stack falhar, mostrar erro claro
  - Botão "Tentar novamente"
  - Link para suporte/documentação

**Critério de Aceitação:**
- ✅ Usuário consegue conectar conta AWS sem dificuldade
- ✅ Erros são tratados graciosamente
- ✅ Callback do CloudFormation funciona

**Complexidade:** 🔴 Alta  
**Prioridade:** 🔴 MUST-HAVE

---

### 2.2 ⚠️ Dashboard - Visão Geral

**Status Atual:** Página existe mas precisa de dados reais

**Tarefas:**
- [ ] **2.2.1**: Implementar cards de métricas
  ```
  - Total de Economias Potenciais
  - Economias Realizadas (este mês)
  - Recomendações Ativas
  - SLA Credits Recuperados
  ```

- [ ] **2.2.2**: Criar gráfico de economia ao longo do tempo
  - Biblioteca: recharts ou chart.js
  - Dados: economias por mês

- [ ] **2.2.3**: Lista de últimas recomendações (top 5)
  - Com botão "Ver todas"

- [ ] **2.2.4**: Conectar com API real
  - `GET /api/billing/summary`
  - `GET /api/recommendations?limit=5`

**Critério de Aceitação:**
- ✅ Dashboard mostra dados reais da API
- ✅ Gráficos funcionam
- ✅ Performance boa (< 2s para carregar)

**Complexidade:** 🟡 Média  
**Prioridade:** 🔴 MUST-HAVE

---

### 2.3 ⚠️ Recomendações - Listar e Executar

**Status Atual:** Página existe, precisa de teste

**Tarefas:**
- [ ] **2.3.1**: Testar listagem de recomendações
  - `GET /api/recommendations`
  - Mostrar tipo, impacto, status

- [ ] **2.3.2**: Implementar filtros
  - Por tipo (IDLE_INSTANCE, UNUSED_EBS, etc.)
  - Por status (ACTIVE, EXECUTED, DISMISSED)
  - Por região

- [ ] **2.3.3**: Testar execução de recomendação
  - Botão "Executar"
  - Confirmação modal
  - Loading state
  - Mensagem de sucesso/erro

- [ ] **2.3.4**: Atualização em tempo real
  - Após executar, status muda para "EXECUTING"
  - Polling ou WebSocket para atualizar status

**Critério de Aceitação:**
- ✅ Usuário consegue ver recomendações
- ✅ Usuário consegue executar recomendação
- ✅ Feedback visual claro

**Complexidade:** 🟡 Média  
**Prioridade:** 🔴 MUST-HAVE

---

### 2.4 ⚠️ SLA Claims - Visualização

**Status Atual:** Página existe (`/sla-claims`)

**Tarefas:**
- [ ] **2.4.1**: Listar claims existentes
  - `GET /api/sla-claims`
  - Mostrar incidente, status, valor recuperado

- [ ] **2.4.2**: Mostrar detalhes do claim
  - Timeline do processo
  - Status atual (DETECTED, SUBMITTED, RECOVERED)
  - Link para download do PDF

- [ ] **2.4.3**: Implementar download de PDF
  - `GET /api/sla-reports/{claimId}`
  - Abrir em nova aba ou fazer download

**Critério de Aceitação:**
- ✅ Usuário consegue ver claims de SLA
- ✅ Download de PDF funciona
- ✅ Status é claro

**Complexidade:** 🟡 Média  
**Prioridade:** 🟡 SHOULD-HAVE

---

### 2.5 ⚠️ Billing - Transparência de Cobranças

**Status Atual:** Página existe, precisa de dados

**Tarefas:**
- [ ] **2.5.1**: Mostrar resumo de billing
  - Total economizado
  - Comissão (30%)
  - Seu savings líquido

- [ ] **2.5.2**: Histórico de economias
  - Por mês
  - Breakdown por tipo (recomendações vs SLA)

- [ ] **2.5.3**: Explicação do modelo de cobrança
  - "Como funciona"
  - FAQ

**Critério de Aceitação:**
- ✅ Usuário entende quanto está economizando
- ✅ Usuário entende quanto está pagando
- ✅ Transparência total

**Complexidade:** 🟢 Baixa  
**Prioridade:** 🔴 MUST-HAVE

---

### 2.6 ⚠️ Settings - Configurações

**Tarefas:**
- [ ] **2.6.1**: Gerenciar conexões AWS
  - Listar contas conectadas
  - Botão "Adicionar nova conta"
  - Botão "Remover" (com confirmação)

- [ ] **2.6.2**: Configurar automação (se Pro plan)
  - Toggle para habilitar/desabilitar
  - Configurar threshold de automação

- [ ] **2.6.3**: Profile do usuário
  - Email (read-only)
  - Nome
  - Foto (opcional)
  - Mudar senha (via Cognito)

**Critério de Aceitação:**
- ✅ Usuário consegue gerenciar configurações
- ✅ Mudanças são salvas corretamente

**Complexidade:** 🟡 Média  
**Prioridade:** 🟡 SHOULD-HAVE

---

## 🎯 FASE 3: POLIMENTO UX/UI (MÉDIO)
**Prazo:** 2-3 dias  
**Objetivo:** Aplicação profissional e agradável de usar

### 3.1 ⚠️ Design System Consistente

**Tarefas:**
- [ ] **3.1.1**: Escolher paleta de cores
  - Primária (brand)
  - Secundária
  - Sucesso/Erro/Aviso
  - Tons de cinza

- [ ] **3.1.2**: Tipografia consistente
  - Headings (H1-H6)
  - Body text
  - Captions

- [ ] **3.1.3**: Componentes reutilizáveis
  - Button (variants: primary, secondary, danger)
  - Card
  - Input
  - Modal
  - Alert/Toast

- [ ] **3.1.4**: Aplicar design em todas as páginas

**Critério de Aceitação:**
- ✅ Visual profissional
- ✅ Consistência entre páginas
- ✅ Fácil de usar

**Complexidade:** 🔴 Alta  
**Prioridade:** 🟡 SHOULD-HAVE

---

### 3.2 ⚠️ Loading States e Feedback

**Tarefas:**
- [ ] **3.2.1**: Implementar skeleton screens
  - Enquanto carrega dados

- [ ] **3.2.2**: Loading spinners
  - Em botões durante ações

- [ ] **3.2.3**: Toast notifications
  - Sucesso: "Recomendação executada!"
  - Erro: "Falha ao executar. Tente novamente."

- [ ] **3.2.4**: Empty states
  - "Nenhuma recomendação encontrada"
  - "Conecte sua primeira conta AWS"

**Critério de Aceitação:**
- ✅ Usuário sempre sabe o que está acontecendo
- ✅ Feedback imediato para ações

**Complexidade:** 🟡 Média  
**Prioridade:** 🟡 SHOULD-HAVE

---

### 3.3 ⚠️ Responsividade Mobile

**Tarefas:**
- [ ] **3.3.1**: Testar todas as páginas em mobile
- [ ] **3.3.2**: Ajustar layout para tablets
- [ ] **3.3.3**: Menu hambúrguer funcional

**Critério de Aceitação:**
- ✅ Funciona perfeitamente em mobile
- ✅ Experiência não degradada

**Complexidade:** 🟡 Média  
**Prioridade:** 🟢 NICE-TO-HAVE

---

## 🎯 FASE 4: TESTES & QUALIDADE (ALTO)
**Prazo:** 2-3 dias  
**Objetivo:** Garantir que tudo funciona sem bugs

### 4.1 ❌ Testes de Integração

**Tarefas:**
- [ ] **4.1.1**: Criar testes para fluxo de autenticação
  - Signup → Login → Logout

- [ ] **4.1.2**: Criar testes para onboarding
  - Conectar AWS → Callback → Salvar config

- [ ] **4.1.3**: Criar testes para recomendações
  - Listar → Executar → Atualizar status

- [ ] **4.1.4**: Criar testes para billing
  - Calcular economias → Mostrar na UI

**Ferramentas:** Jest, React Testing Library, Cypress (E2E)

**Critério de Aceitação:**
- ✅ Cobertura de testes > 60%
- ✅ Fluxos críticos testados

**Complexidade:** 🔴 Alta  
**Prioridade:** 🟡 SHOULD-HAVE

---

### 4.2 ❌ Testes Manuais (QA)

**Tarefas:**
- [ ] **4.2.1**: Criar checklist de QA
- [ ] **4.2.2**: Testar manualmente todos os fluxos
- [ ] **4.2.3**: Testar edge cases
  - Usuário sem contas AWS
  - Sem recomendações
  - Erro de rede

- [ ] **4.2.4**: Documentar bugs encontrados

**Critério de Aceitação:**
- ✅ Todos os fluxos principais funcionam
- ✅ Bugs críticos corrigidos

**Complexidade:** 🟡 Média  
**Prioridade:** 🔴 MUST-HAVE

---

## 🎯 FASE 5: PREPARAÇÃO PARA PRODUÇÃO (CRÍTICO)
**Prazo:** 1-2 dias  
**Objetivo:** Deploy seguro e monitorado

### 5.1 ⚠️ Configuração de Ambiente

**Tarefas:**
- [ ] **5.1.1**: Separar `.env.local` (dev) de `.env.production`
  - Dev: Backend local (localhost:3001)
  - Prod: Backend AWS (API Gateway)

- [ ] **5.1.2**: Configurar variáveis de ambiente no Amplify Hosting
  - NEXT_PUBLIC_API_URL
  - NEXT_PUBLIC_COGNITO_*

- [ ] **5.1.3**: Verificar configuração de CORS no backend
  - Permitir domínio do Amplify

**Critério de Aceitação:**
- ✅ Ambientes separados
- ✅ Variáveis corretas em produção

**Complexidade:** 🟢 Baixa  
**Prioridade:** 🔴 MUST-HAVE

---

### 5.2 ⚠️ Segurança

**Tarefas:**
- [ ] **5.2.1**: Revisar permissões IAM
  - Princípio do menor privilégio

- [ ] **5.2.2**: Habilitar MFA para usuários admin

- [ ] **5.2.3**: Configurar rate limiting no API Gateway

- [ ] **5.2.4**: Revisar logs para não vazar informações sensíveis

**Critério de Aceitação:**
- ✅ Sem vulnerabilidades conhecidas
- ✅ Logs limpos

**Complexidade:** 🟡 Média  
**Prioridade:** 🔴 MUST-HAVE

---

### 5.3 ⚠️ Monitoramento

**Tarefas:**
- [ ] **5.3.1**: Configurar alarmes CloudWatch
  - Erros Lambda > X por minuto
  - Latência API > Y ms

- [ ] **5.3.2**: Dashboard CloudWatch
  - Métricas principais

- [ ] **5.3.3**: Configurar alertas SNS
  - Email/SMS para erros críticos

**Critério de Aceitação:**
- ✅ Equipe é notificada de erros
- ✅ Métricas visíveis

**Complexidade:** 🟡 Média  
**Prioridade:** 🟡 SHOULD-HAVE

---

### 5.4 ⚠️ Documentação

**Tarefas:**
- [ ] **5.4.1**: README para usuários
  - Como usar o sistema
  - FAQ

- [ ] **5.4.2**: Documentação de API (interno)
  - Endpoints disponíveis
  - Autenticação

- [ ] **5.4.3**: Runbook de operação
  - Como fazer deploy
  - Como resolver problemas comuns

**Critério de Aceitação:**
- ✅ Documentação clara e completa
- ✅ Novos membros conseguem entender

**Complexidade:** 🟡 Média  
**Prioridade:** 🟢 NICE-TO-HAVE

---

## 📋 RESUMO DE PRIORIDADES

### 🔴 MUST-HAVE (Bloqueador para Produção)
1. ✅ Verificar Cognito (Fase 1.1)
2. ⚠️ Logout Universal (Fase 1.2)
3. ⚠️ Navegação Principal (Fase 1.4)
4. ⚠️ Onboarding AWS (Fase 2.1)
5. ⚠️ Dashboard com Dados Reais (Fase 2.2)
6. ⚠️ Recomendações - Executar (Fase 2.3)
7. ⚠️ Billing Transparente (Fase 2.5)
8. ⚠️ Testes Manuais (Fase 4.2)
9. ⚠️ Configuração de Ambiente (Fase 5.1)
10. ⚠️ Segurança (Fase 5.2)

### 🟡 SHOULD-HAVE (Importante mas não bloqueador)
1. ⚠️ Melhorar UX do Login (Fase 1.3)
2. ⚠️ SLA Claims (Fase 2.4)
3. ⚠️ Settings (Fase 2.6)
4. ⚠️ Design System (Fase 3.1)
5. ⚠️ Loading States (Fase 3.2)
6. ⚠️ Testes de Integração (Fase 4.1)
7. ⚠️ Monitoramento (Fase 5.3)

### 🟢 NICE-TO-HAVE (Pode ser pós-lançamento)
1. ⚠️ Responsividade Mobile (Fase 3.3)
2. ⚠️ Documentação (Fase 5.4)

---

## 🗓️ CRONOGRAMA SUGERIDO

### Semana 1 (5 dias úteis)
- **Dia 1-2**: Fase 1 (Autenticação & Navegação)
- **Dia 3-5**: Fase 2.1-2.3 (Onboarding, Dashboard, Recomendações)

### Semana 2 (5 dias úteis)
- **Dia 1-2**: Fase 2.4-2.6 (SLA, Billing, Settings)
- **Dia 3-4**: Fase 3 (Polimento UX/UI)
- **Dia 5**: Fase 4.2 (Testes Manuais)

### Semana 3 (3 dias úteis)
- **Dia 1**: Fase 5 (Preparação para Produção)
- **Dia 2**: Deploy em ambiente de staging
- **Dia 3**: Go-Live 🚀

**Total: ~13 dias úteis (~3 semanas)**

---

## ✅ CHECKLIST DE GO-LIVE

Antes de fazer deploy em produção, verificar:

- [ ] Todos os itens MUST-HAVE concluídos
- [ ] Cognito configurado e testado
- [ ] Onboarding funcional end-to-end
- [ ] Dashboard mostra dados reais
- [ ] Recomendações podem ser executadas
- [ ] Billing transparente
- [ ] Logout funciona
- [ ] Navegação clara
- [ ] Testes manuais completos (zero bugs críticos)
- [ ] Variáveis de ambiente corretas em produção
- [ ] Segurança revisada
- [ ] Pelo menos 1 usuário beta testou tudo

---

## 🚀 PRÓXIMOS PASSOS IMEDIATOS

### AGORA (Próximas 2 horas):
1. **Testar Login Cognito**
   ```bash
   # Acessar: http://localhost:3000/login
   # Criar conta de teste
   # Verificar se email chega
   # Fazer login
   ```

2. **Verificar Token JWT**
   ```bash
   # No DevTools Console:
   # Após login, inspecionar Network tab
   # Verificar se requests têm header Authorization
   ```

3. **Testar Logout**
   ```bash
   # Clicar em logout (se existir)
   # Verificar se redireciona para /login
   # Verificar se não consegue mais acessar /dashboard
   ```

### HOJE (Próximas 8 horas):
1. Implementar Header com Logout
2. Implementar Navegação/Sidebar
3. Conectar Dashboard com API real

### ESTA SEMANA:
1. Completar Fase 1 e 2
2. Começar Fase 3

---

**Quer começar testando o Cognito agora ou prefere que eu implemente alguma funcionalidade específica primeiro?**
