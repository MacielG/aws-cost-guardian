# Guia de Contribuições para AWS Cost Guardian

Obrigado por considerar contribuir! Este projeto é open-source sob MIT e bem-vindo a todos.

## Como Contribuir

1. **Fork o Repo**: Crie um fork no GitHub.
2. **Branch**: Crie branch `feat/nome-da-feature` ou `fix/bug-desc` do `develop`.
3. **Desenvolva**: 
   - Siga o estilo: ESLint/Prettier (raiz).
   - Testes: Adicione unit tests (Jest para backend, React Testing Library para frontend).
   - CDK: Use `cdk diff` antes de commit.
4. **Commit**: Mensagens claras, ex.: `feat: add SLA correlation via Health API`.
5. **PR**: Abra Pull Request para `develop`. Inclua:
   - Descrição da mudança.
   - Testes passados.
   - Impacto em custos AWS (Free Tier?).
6. **Review**: Responda feedbacks; merge após aprovação.

## Convenções
- **Branching**: Git Flow (develop/main).
- **i18n**: Adicione traduções em `/locales`.
- **Segurança**: Nunca commit secrets; use SSM/Secrets Manager.
- **Fases**: Contribua por fase (veja README).

## Ferramentas
- Local: `npm run dev` em pastas.
- CI: GitHub Actions (futuro: adicione workflow).

Perguntas? Abra issue! 😊