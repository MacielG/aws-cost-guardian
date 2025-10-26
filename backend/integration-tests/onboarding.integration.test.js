// Integration test for Onboarding flow
// WARNING: This test performs real AWS operations. It will only run when RUN_INTEGRATION=true

if (!process.env.RUN_INTEGRATION) {
  console.log('Skipping onboarding integration test (set RUN_INTEGRATION=true to enable)');
  module.exports = {};
  return;
}

const AWS = require('aws-sdk');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Required env variables (set these before running):
// PLATFORM_API_URL - the base URL of the deployed platform API (e.g. https://api.example.com)
// PLATFORM_AWS_REGION - region for platform resources (also default region for platform SDK usage)
// CLIENT_AWS_REGION - region for client account
// CLIENT_AWS_ACCESS_KEY_ID, CLIENT_AWS_SECRET_ACCESS_KEY (client account credentials)
// PLATFORM_AWS_ACCESS_KEY_ID, PLATFORM_AWS_SECRET_ACCESS_KEY (platform admin credentials)
// PLATFORM_COGNITO_USER - username for created test user (optional)
// CLIENT_STACK_NAME - name to use for the deployed test stack in client account

const PLATFORM_API_URL = process.env.PLATFORM_API_URL;
const PLATFORM_REGION = process.env.PLATFORM_AWS_REGION || 'us-east-1';
const CLIENT_REGION = process.env.CLIENT_AWS_REGION || PLATFORM_REGION;
const CLIENT_STACK_NAME = process.env.CLIENT_STACK_NAME || 'CostGuardian-Test-Stack';

if (!PLATFORM_API_URL) {
  throw new Error('PLATFORM_API_URL must be set to run integration onboarding test');
}

AWS.config.update({ region: PLATFORM_REGION });

const platformCfn = new AWS.CloudFormation({ region: PLATFORM_REGION });
const clientCfn = new AWS.CloudFormation({ region: CLIENT_REGION });

// Helper: sleep
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('Onboarding Integration Flow', () => {
  jest.setTimeout(1000 * 60 * 30); // 30 minutes for slow operations

  it('should perform full onboarding from platform -> client stack deployment -> webhook', async () => {
    // 1) Authenticate as a platform user and call GET /api/onboard-init
    console.log('Calling platform /api/onboard-init to retrieve ExternalId...');
    const onboardInit = await axios.get(`${PLATFORM_API_URL}/api/onboard-init`, { headers: { Authorization: `Bearer ${process.env.PLATFORM_TEST_TOKEN}` } });

    const { externalId, platformAccountId } = onboardInit.data;
    console.log('Received externalId:', externalId, 'platformAccountId:', platformAccountId);

    // 2) Deploy the client-side CloudFormation template to the client account using the ExternalId
    const templatePath = path.join(__dirname, '..', '..', 'docs', 'cost-guardian-template.yaml');
    if (!fs.existsSync(templatePath)) throw new Error('Template file not found: ' + templatePath);

    const templateBody = fs.readFileSync(templatePath, 'utf8');

    console.log('Creating stack in client account...');
    const params = {
      StackName: CLIENT_STACK_NAME,
      TemplateBody: templateBody,
      Parameters: [
        { ParameterKey: 'ExternalId', ParameterValue: externalId },
        { ParameterKey: 'PlatformAccountId', ParameterValue: platformAccountId },
      ],
      Capabilities: ['CAPABILITY_NAMED_IAM'],
    };

    const createResp = await clientCfn.createStack(params).promise();
    console.log('Stack creation started:', createResp.StackId);

    // 3) Wait for the stack to complete
    let status = 'CREATE_IN_PROGRESS';
    while (status === 'CREATE_IN_PROGRESS') {
      await wait(5000);
      const desc = await clientCfn.describeStacks({ StackName: CLIENT_STACK_NAME }).promise();
      status = desc.Stacks[0].StackStatus;
      console.log('Stack status:', status);
      if (status.endsWith('_FAILED') || status.endsWith('_ROLLBACK_COMPLETE')) {
        throw new Error('Stack failed: ' + status);
      }
    }

    if (status !== 'CREATE_COMPLETE') throw new Error('Unexpected stack status: ' + status);

    // 4) Verify that the platform DynamoDB was updated by the onboarding webhook
    const dynamo = new AWS.DynamoDB.DocumentClient({ region: PLATFORM_REGION });

    // Query the table for an item with sk = CONFIG#ONBOARD and externalId
    const tableName = process.env.DYNAMODB_TABLE;
    if (!tableName) throw new Error('DYNAMODB_TABLE env var required to verify platform DB');

    // Poll for DynamoDB update
    let found = false;
    for (let i = 0; i < 30; i++) {
      const q = await dynamo.query({ TableName: tableName, IndexName: 'ExternalIdIndex', KeyConditionExpression: 'externalId = :e', ExpressionAttributeValues: { ':e': externalId } }).promise();
      if (q.Items && q.Items.length) {
        console.log('Found platform config item:', q.Items[0]);
        found = true;
        break;
      }
      await wait(2000);
    }

    expect(found).toBe(true);
  });
});
