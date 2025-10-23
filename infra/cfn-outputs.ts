import * as cdk from 'aws-cdk-lib';
import { CostGuardianStack } from './lib/cost-guardian-stack';

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      CDK_DEFAULT_ACCOUNT: string;
      CDK_DEFAULT_REGION: string;
    }
  }
}

const app = new cdk.App();
new CostGuardianStack(app, 'CostGuardianStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});

// Observação: Os outputs do CDK são impressos pelo comando 'cdk deploy' quando
// --outputs-file é usado. Este arquivo não precisa reexportar variáveis localmente.