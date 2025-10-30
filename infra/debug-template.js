const cdk = require('aws-cdk-lib');
const { CostGuardianStack } = require('./lib/cost-guardian-stack');

const app = new cdk.App();
const stack = new CostGuardianStack(app, 'DebugStack', {
  githubRepo: 'test/repo',
  githubBranch: 'main',
  githubTokenSecretName: 'dummy-secret',
  domainName: 'test.example.com',
  hostedZoneId: 'Z123456789',
  isTestEnvironment: true,
});

const template = app.synth().getStackByName('DebugStack').template;

// Ver o ReportsBucket
const reportsBucket = Object.entries(template.Resources).find(
  ([key, value]) => key.includes('ReportsBucket')
);
console.log('ReportsBucket:', JSON.stringify(reportsBucket, null, 2));

// Ver o DynamoDB Table
const table = Object.entries(template.Resources).find(
  ([key, value]) => key.includes('CostGuardianTable')
);
console.log('\nDynamoDB Table:', JSON.stringify(table, null, 2));

// Ver State Machine
const stateMachine = Object.entries(template.Resources).find(
  ([key, value]) => key.includes('SLAWorkflow')
);
console.log('\nSLA Workflow:', JSON.stringify(stateMachine, null, 2));
