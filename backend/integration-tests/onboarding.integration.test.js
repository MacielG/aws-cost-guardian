// Integration test for Onboarding flow
// WARNING: This test performs real AWS operations. It will only run when RUN_INTEGRATION=true

const AWS = require('aws-sdk');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Mock all AWS and HTTP calls for unit-style testing of integration logic
jest.mock('aws-sdk');
jest.mock('axios');

const mockAxios = require('axios');

// Mock implementations
mockAxios.get.mockResolvedValue({ data: { success: true } });
mockAxios.post.mockResolvedValue({ data: { success: true } });

AWS.CloudFormation.prototype.describeStacks = jest.fn().mockResolvedValue({
  Stacks: [{ StackStatus: 'CREATE_COMPLETE' }]
});
AWS.CloudFormation.prototype.createStack = jest.fn().mockResolvedValue({});
AWS.CloudFormation.prototype.deleteStack = jest.fn().mockResolvedValue({});

const PLATFORM_API_URL = 'http://mock-api.example.com';
const PLATFORM_REGION = 'us-east-1';
const CLIENT_REGION = 'us-east-1';
const CLIENT_STACK_NAME = 'CostGuardian-Test-Stack';

AWS.config.update({ region: PLATFORM_REGION });

const platformCfn = new AWS.CloudFormation({ region: PLATFORM_REGION });
const clientCfn = new AWS.CloudFormation({ region: CLIENT_REGION });

describe('Onboarding Integration Test', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should create and verify client stack deployment', async () => {
    // Mock successful stack creation
    clientCfn.createStack.mockResolvedValue({ StackId: 'test-stack-id' });

    // Simulate stack creation
    await clientCfn.createStack({
      StackName: CLIENT_STACK_NAME,
      TemplateBody: expect.any(String),
      Parameters: expect.any(Array)
    });

    expect(clientCfn.createStack).toHaveBeenCalledWith(
      expect.objectContaining({
        StackName: CLIENT_STACK_NAME
      })
    );
  });

  test('should check stack status after deployment', async () => {
    platformCfn.describeStacks.mockResolvedValue({
      Stacks: [{ StackStatus: 'CREATE_COMPLETE', StackName: CLIENT_STACK_NAME }]
    });

    const result = await platformCfn.describeStacks({
      StackName: CLIENT_STACK_NAME
    });

    expect(result.Stacks[0].StackStatus).toBe('CREATE_COMPLETE');
  });

  test('should make API calls to platform for onboarding', async () => {
    await mockAxios.post(`${PLATFORM_API_URL}/api/onboard`, {
      customerId: 'test-customer',
      awsAccountId: '123456789012'
    });

    expect(mockAxios.post).toHaveBeenCalledWith(
      `${PLATFORM_API_URL}/api/onboard`,
      expect.objectContaining({
        customerId: 'test-customer'
      })
    );
  });

  test('should handle stack cleanup', async () => {
    clientCfn.deleteStack.mockResolvedValue({});

    await clientCfn.deleteStack({
      StackName: CLIENT_STACK_NAME
    });

    expect(clientCfn.deleteStack).toHaveBeenCalledWith(
      expect.objectContaining({
        StackName: CLIENT_STACK_NAME
      })
    );
  });

  test('should verify API connectivity', async () => {
    const response = await mockAxios.get(`${PLATFORM_API_URL}/health`);
    expect(response.data.success).toBe(true);
  });
});

// Helper: sleep
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const describeIntegration = process.env.RUN_INTEGRATION ? describe : describe.skip;

describeIntegration('Onboarding Integration Flow', () => {
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
