#!/bin/bash
set -e  # Exit on error

echo "🚀 Deploying AWS Cost Guardian (Serverless-First)..."

# Infra (CDK)
echo "1. Deploying Infra via CDK..."
cd infra
npm ci
npm run build
cdk deploy --all --require-approval never
API_URL=$(cdk synth | grep "CostGuardianAPIEndpoint" | awk '{print $2}')
echo "API URL: $API_URL"

# Backend (Serverless)
echo "2. Deploying Backend via Serverless..."
cd ../backend
npm ci
npm run deploy

# Frontend (Amplify)
echo "3. Deploying Frontend via Amplify..."
cd ../frontend
npm ci
amplify env pull  # Se já init
amplify push --yes

cd ..

echo "✅ Deploy completo!"
echo "Outputs:"
echo "- API: $API_URL"
echo "- Cognito Pool: $(aws cognito-idp describe-user-pool --user-pool-id $(cdk synth | grep UserPoolId | awk '{print $2}') --query 'UserPool.Id')"
echo "Teste: Acesse frontend em $(amplify status | grep 'GraphQL endpoint' | awk '{print $3}')"
echo "Onboarding: Use CloudFormation link para conectar contas."
echo "Monitore: CloudWatch Logs no console AWS."