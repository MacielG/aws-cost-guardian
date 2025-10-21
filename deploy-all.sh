#!/bin/bash
set -e  # Exit on error

echo "🚀 Deploying AWS Cost Guardian (CDK-First)..."

# Infra (CDK)
echo "1. Deploying Infra (CDK) e Backend Lambdas..."
cd infra
npm ci
npm run build
cdk deploy --all --require-approval never
CDK_OUTPUTS_FILE=$(mktemp)
cdk deploy --all --require-approval never --outputs-file $CDK_OUTPUTS_FILE
STACK_NAME=$(jq -r 'keys[0]' $CDK_OUTPUTS_FILE)
API_URL=$(jq -r '."'$STACK_NAME'".APIUrl' $CDK_OUTPUTS_FILE)
USER_POOL_ID=$(jq -r '."'$STACK_NAME'".UserPoolId' $CDK_OUTPUTS_FILE)
rm $CDK_OUTPUTS_FILE

# Frontend (Amplify)
echo "2. Deploying Frontend via Amplify..."
cd ../frontend
npm ci
amplify pull --yes
amplify push --yes

cd ..

echo "✅ Deploy completo!"
echo "Outputs:"
echo "- API URL: $API_URL"
echo "- Cognito User Pool ID: $USER_POOL_ID"
echo "Onboarding: Use CloudFormation link para conectar contas."
echo "Monitore: CloudWatch Logs no console AWS."