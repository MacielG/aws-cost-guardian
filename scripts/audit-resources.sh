#!/bin/bash

echo "=== AWS Cost Guardian - Auditoria de Recursos ==="
echo ""

echo "Stacks CloudFormation:"
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query "StackSummaries[?contains(StackName, 'Cost')].{Name:StackName,Status:StackStatus,Created:CreationTime}" \
  --output table

echo ""
echo "NAT Gateways (CUSTO: ~$32/mês cada):"
aws ec2 describe-nat-gateways --filter "Name=state,Values=available" \
  --query "NatGateways[].{ID:NatGatewayId,VPC:VpcId,State:State}" \
  --output table

echo ""
echo "Buckets S3:"
aws s3 ls | grep -i cost

echo ""
echo "Lambdas:"
aws lambda list-functions --query "Functions[?contains(FunctionName, 'Cost')].FunctionName" --output table

echo ""
echo "DynamoDB Tables:"
aws dynamodb list-tables --query "TableNames[?contains(@, 'Cost')]" --output table

echo ""
echo "Elastic IPs não associados (CUSTO: $0.005/hora):"
aws ec2 describe-addresses --query "Addresses[?AssociationId==null].PublicIp" --output table

echo ""
echo "=== Fim da Auditoria ==="
