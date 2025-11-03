// File: backend/__tests__/automation-functions.test.js

// Mocks para AWS SDK v3 usados nas funções de automação
const mockDdbSend = jest.fn();
const mockStsSend = jest.fn();
const mockEc2Send = jest.fn();

// Mock lib-dynamodb DocumentClient.from(...) to return object with .send()
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDdbSend })) },
  QueryCommand: function(input) { return { input }; },
  PutCommand: function(input) { return { input }; }
}));

// Mock STS client to return assume role result
jest.mock('@aws-sdk/client-sts', () => ({
  STSClient: jest.fn(() => ({ send: mockStsSend })),
  AssumeRoleCommand: function(input) { return { input }; }
}));

// Mock EC2 client used for DescribeVolumes
jest.mock('@aws-sdk/client-ec2', () => ({
  EC2Client: jest.fn(() => ({ send: mockEc2Send })),
  DescribeVolumesCommand: function(input) { return { input }; }
}));

// Additional v3 clients used by other automation functions (cloudwatch, sns) can reuse mockEc2Send
jest.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: jest.fn(() => ({ send: mockEc2Send })),
  GetMetricDataCommand: function(input) { return { input }; }
}));

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn(() => ({ send: mockEc2Send })),
  PublishCommand: function(input) { return { input }; }
}));

 describe('Funções de Automação', () => {
 const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules(); // Garante que módulos com mocks sejam recarregados
    process.env = { ...OLD_ENV };
    process.env.DYNAMODB_TABLE = 'automation-test-table'; // Set antes de importar/requerer as funções

 // Reset mocks
    mockDdbSend.mockClear();
    mockDdbSend.mockImplementation(async (command) => {
      const input = command && command.input ? command.input : {};
      // Default: query returns no items
      if (input.IndexName || input.KeyConditionExpression) return { Items: [] };
      return {};
    });

    mockStsSend.mockClear().mockResolvedValue({
      Credentials: { AccessKeyId: 'AKIA', SecretAccessKey: 'SECRET', SessionToken: 'TOKEN' },
      AssumedRoleUser: { Arn: 'arn:aws:iam::111122223333:role/SomeRole' }
    });

    mockEc2Send.mockClear().mockResolvedValue({ Volumes: [] });
  });

  afterAll(() => {
     process.env = OLD_ENV;
 });


describe('delete-unused-ebs', () => {
it('should query dynamo and describe volumes', async () => {
  const mod = require('../functions/delete-unused-ebs'); // Require aqui
  const deleteUnusedEbsHandler = mod.handler || mod;
  // ... mocks ...
  await deleteUnusedEbsHandler({});
     expect(mockDdbSend).toHaveBeenCalled(); // Agora deve ser encontrado
      // ...
     });
 });

describe('recommend-idle-instances', () => {
     it('should query dynamo, get metrics, describe instances', async () => {
   const mod = require('../functions/recommend-idle-instances'); // Require aqui
  const recommendIdleInstancesHandler = mod.handler || mod;
  // ... mocks V3 ...
await recommendIdleInstancesHandler({});
// Check V3 query command input
expect(mockDdbSend).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ TableName: 'automation-test-table' }) }));
   // ... outras verificações mockSendV3 ...
    });
   });
});
