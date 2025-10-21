import * as cdk from 'aws-cdk-lib';
import { CostGuardianStack } from './lib/cost-guardian-stack';

const app = new cdk.App();
const stack = new CostGuardianStack(app, 'CostGuardianStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});

console.log('Outputs:', {
  APIUrl: cdk.Fn.importValue('APIUrl'),  // Use exports
  // Adicione mais
});