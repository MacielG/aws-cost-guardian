# Guia de Deploy e Conexão AWS

**Versão 1.0** | **Data: 21/10/2025**

## Pré-requisitos
- AWS Free Tier.
- Node 18+, Git.
- `npm i -g aws-cdk@2 serverless amplify-cli`.

## Passos
1. **Env**: Copie `.env.example` para `.env`.
2. **Deploy**: `./deploy-all.sh`.
3. **Conectar Conta Cliente**: No app, "Connect" gera CF link → Cliente implanta role → Cola ARN.
4. **Teste**: Trigger event Health manual via console; verifique dashboard.

## Custos
$0 até escala. Monitore budgets.

## Troubleshooting
- CDK errors: `cdk bootstrap`.
- Amplify: `amplify init` se novo.