// File: backend/__tests__/automation-functions.test.js

// ... (Mocks V3 como no plano anterior) ...
const mockDynamoQueryV2 = jest.fn();
const mockDynamoDeleteV2 = jest.fn();
const mockEC2DescribeVolumes = jest.fn();
const mockEC2DeleteVolume = jest.fn();
const mockSTSAssumeRoleV2 = jest.fn(); // Mock para STS V2

// Mock AWS SDK v3 clients (for recommend-idle-instances)
const mockSendV3 = jest.fn(); // Separate mock send if needed, or reuse global one
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockSendV3 })),
  QueryCommand: jest.fn(input => ({ input })),
  PutCommand: jest.fn(input => ({ input })), // Mock if PutCommand is used
}));
 jest.mock('@aws-sdk/lib-dynamodb', () => ({ // Mock the DocumentClient v3 lib
    DynamoDBDocumentClient: {
        from: jest.fn(() => ({ send: mockSendV3 }))
    },
    QueryCommand: jest.requireActual('@aws-sdk/lib-dynamodb').QueryCommand, // Use actual command objects
    PutCommand: jest.requireActual('@aws-sdk/lib-dynamodb').PutCommand, // Use actual command objects
 }));
 // Mock other v3 clients used by recommend-idle-instances (SNS, EC2, CloudWatch?)
  jest.mock('@aws-sdk/client-sns', () => ({
      SNSClient: jest.fn(() => ({ send: mockSendV3 })),
      PublishCommand: jest.fn(input => ({ input }))
  }));
   jest.mock('@aws-sdk/client-cloudwatch', () => ({
       CloudWatchClient: jest.fn(() => ({ send: mockSendV3 })),
       GetMetricDataCommand: jest.fn(input => ({ input })) // Or GetMetricStatisticsCommand
   }));
    jest.mock('@aws-sdk/client-ec2', () => ({
       EC2Client: jest.fn(() => ({ send: mockSendV3 })),
       DescribeInstancesCommand: jest.fn(input => ({ input }))
   }));


// Mock V2 services
jest.mock('aws-sdk', () => ({
config: { update: jest.fn() },
DynamoDB: {
DocumentClient: jest.fn(() => ({
query: mockDynamoQueryV2,   // <-- Adiciona query
delete: mockDynamoDeleteV2,
}))
},
EC2: jest.fn(() => ({
describeVolumes: mockEC2DescribeVolumes,
deleteVolume: mockEC2DeleteVolume
})),
  STS: jest.fn(() => ({ // <-- Adiciona STS
    assumeRole: mockSTSAssumeRoleV2
  }))
}));

 describe('Funções de Automação', () => {
 const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules(); // Garante que módulos com mocks sejam recarregados
    process.env = { ...OLD_ENV };
    process.env.DYNAMODB_TABLE = 'automation-test-table'; // Set antes de importar/requerer as funções

 // Reset V2 mocks
   mockDynamoQueryV2.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({ Items: [] }) });
    mockDynamoDeleteV2.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
    mockEC2DescribeVolumes.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({ Volumes: [] }) });
    mockEC2DeleteVolume.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
    mockSTSAssumeRoleV2.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({ Credentials: { /* ... */ } }) }); // Reset STS V2

 // Reset V3 mock
    mockSendV3.mockClear();
    mockSendV3.mockImplementation(async (command) => { /* ... default impl ... */ });
  });

  afterAll(() => {
     process.env = OLD_ENV;
 });


describe('delete-unused-ebs', () => {
it('should query dynamo and describe volumes', async () => {
    const { deleteUnusedEbsHandler } = require('../functions/delete-unused-ebs'); // Require aqui
    // ... mocks ...
    await deleteUnusedEbsHandler({});
       expect(mockDynamoQueryV2).toHaveBeenCalled(); // Agora deve ser encontrado
      // ...
     });
 });

describe('recommend-idle-instances', () => {
     it('should query dynamo, get metrics, describe instances', async () => {
    const { recommendIdleInstancesHandler } = require('../functions/recommend-idle-instances'); // Require aqui
   // ... mocks V3 ...
await recommendIdleInstancesHandler({});
// Check V3 query command input
expect(mockSendV3).toHaveBeenCalledWith(expect.objectContaining({
 input: expect.objectContaining({ TableName: 'automation-test-table' }) // Verifica se TableName está no input
 }));
   // ... outras verificações mockSendV3 ...
    });
   });
});
