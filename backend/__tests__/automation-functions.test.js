// Mock AWS SDK v2 DocumentClient (for delete-unused-ebs)
const mockDynamoQueryV2 = jest.fn();
const mockDynamoDeleteV2 = jest.fn(); // Assume it uses delete too
const mockEC2DescribeVolumes = jest.fn();
const mockEC2DeleteVolume = jest.fn();

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


// Mock V2 services used by delete-unused-ebs
jest.mock('aws-sdk', () => ({
  config: { update: jest.fn() },
  DynamoDB: {
    DocumentClient: jest.fn(() => ({
      query: mockDynamoQueryV2,
      delete: mockDynamoDeleteV2,
    }))
  },
  EC2: jest.fn(() => ({
    describeVolumes: mockEC2DescribeVolumes,
    deleteVolume: mockEC2DeleteVolume
  }))
}));

 // Import AFTER mocks
 const { deleteUnusedEbsHandler } = require('../functions/delete-unused-ebs');
 const { recommendIdleInstancesHandler } = require('../functions/recommend-idle-instances');

describe('Funções de Automação', () => {
const OLD_ENV = process.env;

beforeEach(() => {
    jest.resetModules(); // Important if functions read env vars at module level
  process.env = { ...OLD_ENV };
process.env.DYNAMODB_TABLE = 'automation-test-table'; // Set table name for ALL tests

// Reset V2 mocks
mockDynamoQueryV2.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({ Items: [] }) });
mockDynamoDeleteV2.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
    mockEC2DescribeVolumes.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({ Volumes: [] }) });
mockEC2DeleteVolume.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });

// Reset V3 mock
mockSendV3.mockClear();
mockSendV3.mockImplementation(async (command) => { // Default successful v3 mock
 if (command.constructor.name === 'QueryCommand') { return { Items: [] }; }
 if (command.constructor.name === 'PutCommand') { return {}; }
 if (command.constructor.name === 'PublishCommand') { return {}; }
      if (command.constructor.name === 'GetMetricDataCommand') { return { MetricDataResults: [] }; }
          if (command.constructor.name === 'DescribeInstancesCommand') { return { Reservations: [] }; }
     // Add other default command handlers
 return {};
 });

});

afterAll(() => {
 process.env = OLD_ENV;
});


describe('delete-unused-ebs', () => {
     it('should query dynamo and describe volumes', async () => {
   // Setup specific mock returns for this test
   mockDynamoQueryV2.mockReturnValueOnce({ promise: jest.fn().mockResolvedValue({ Items: [{ pk: 'CUST#c1', sk: 'AWS#111', roleArn: 'arn:role' }] }) });
   mockEC2DescribeVolumes.mockReturnValueOnce({ promise: jest.fn().mockResolvedValue({ Volumes: [{ VolumeId: 'v-123', State: 'available' }] }) });

 await deleteUnusedEbsHandler({}); // Pass empty event if needed

 expect(mockDynamoQueryV2).toHaveBeenCalled();
   expect(mockEC2DescribeVolumes).toHaveBeenCalled();
     expect(mockEC2DeleteVolume).toHaveBeenCalledWith({ VolumeId: 'v-123' });
     });
});

describe('recommend-idle-instances', () => {
it('should query dynamo, get metrics, describe instances', async () => {
   // Setup specific V3 mock returns
   mockSendV3.mockImplementation(async (command) => {
         if (command.constructor.name === 'QueryCommand') { return { Items: [{ pk: 'CUST#c1', sk: 'AWS#111', roleArn: 'arn:role', config: { idleInstanceThreshold: 5 } }] }; } // Customer config
             if (command.constructor.name === 'DescribeInstancesCommand') { return { Reservations: [{ Instances: [{ InstanceId: 'i-abc', State: { Name: 'running' } }] }] }; }
         if (command.constructor.name === 'GetMetricDataCommand') { return { MetricDataResults: [{ Id: 'cpu', Timestamps: [new Date()], Values: [1.0] }] }; } // Low CPU
       if (command.constructor.name === 'PutCommand') { return {}; } // Recommendation save
     if (command.constructor.name === 'PublishCommand') { return {}; } // SNS publish
   return {};
});

await recommendIdleInstancesHandler({});

// Check that mockSendV3 was called with specific command types
expect(mockSendV3).toHaveBeenCalledWith(expect.objectContaining({ constructor: { name: 'QueryCommand' } }));
expect(mockSendV3).toHaveBeenCalledWith(expect.objectContaining({ constructor: { name: 'DescribeInstancesCommand' } }));
expect(mockSendV3).toHaveBeenCalledWith(expect.objectContaining({ constructor: { name: 'GetMetricDataCommand' } }));
expect(mockSendV3).toHaveBeenCalledWith(expect.objectContaining({ constructor: { name: 'PutCommand' } })); // Check recommendation saved
expect(mockSendV3).toHaveBeenCalledWith(expect.objectContaining({ constructor: { name: 'PublishCommand' } })); // Check SNS called
});
});
});
