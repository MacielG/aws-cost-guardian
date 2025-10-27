#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CostGuardianStack } from '../lib/cost-guardian-stack';

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      CDK_DEFAULT_ACCOUNT: string;
      CDK_DEFAULT_REGION: string;
    }
  }
}

const app = new cdk.App();

// Configurações do projeto
const config = {
  domainName: 'awscostguardian.com',
  hostedZoneId: 'Z07181301GESJJW3HIM10',
  githubRepo: 'MacielG/aws-cost-guardian',
  githubBranch: 'main',
  githubTokenSecretName: 'github/amplify-token',
};

new CostGuardianStack(app, 'CostGuardianStack', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: 'us-east-1'
  },
  domainName: config.domainName,
  hostedZoneId: config.hostedZoneId,
  githubRepo: config.githubRepo,
  githubBranch: config.githubBranch,
  githubTokenSecretName: config.githubTokenSecretName,
});