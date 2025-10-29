// Declare mocks
const mockDynamoQuery = jest.fn();
const mockDynamoPut = jest.fn();
const mockSfnStartExecution = jest.fn();

// Mock AWS SDK
jest.mock('aws-sdk', () => ({
  DynamoDB: {
    DocumentClient: jest.fn(() => ({
      query: mockDynamoQuery,
      put: mockDynamoPut
    }))
  },
  StepFunctions: jest.fn(() => ({
    startExecution: mockSfnStartExecution
  }))
}));

describe('correlate-health handler', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules(); // Important: Clears cache
    process.env = { ...OLD_ENV }; // Make a copy
    // Set env vars needed by the handler
    process.env.DYNAMODB_TABLE = 'test-table'; // Set table name
    process.env.SFN_ARN = 'dummy-sfn-arn';      // Set SFN ARN
    // Reset mocks
    mockDynamoQuery.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({ Items: [{ id: 'cust-abc' }] }) }); // Default successful query
    mockDynamoPut.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
    mockSfnStartExecution.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
  });

  afterAll(() => {
    process.env = OLD_ENV; // Restore old environment
  });



  test('should query DynamoDB and start the Step Function...', async () => {
     // The handler will now have process.env.SFN_ARN and process.env.DYNAMODB_TABLE
     const handler = require('../functions/correlate-health').handler; // Require inside test or beforeEach after setting env
     const event = { detail: { affectedAccount: '111122223333', startTime: '2025-10-26T10:00:00Z', service: 'EC2', resources: ['arn:aws:ec2:us-east-1:111122223333:instance/i-123'] } };
     await handler(event);

     // Assertions should now pass if correlate-health.js uses process.env.DYNAMODB_TABLE
     expect(mockDynamoPut).toHaveBeenCalledWith(expect.objectContaining({
        TableName: 'test-table', // Check it uses the env var value
        Item: expect.any(Object)
     }));
      expect(mockSfnStartExecution).toHaveBeenCalledWith(expect.objectContaining({
         stateMachineArn: 'dummy-sfn-arn', // Check it uses the env var value
         input: expect.any(String)
      }));
  });

   test('should handle customer not found', async () => {
       // Override mock for this specific test
       mockDynamoQuery.mockReturnValue({ promise: jest.fn().mockResolvedValue({ Items: [] }) });
       process.env.DYNAMODB_TABLE = 'test-table';
       process.env.SFN_ARN = 'dummy-sfn-arn';
       const handler = require('../functions/correlate-health').handler;
       const event = { detail: { affectedAccount: '999988887777', /* ... */ } };
       const result = await handler(event);
       expect(result).toEqual({ status: 'error', reason: 'Customer not found' });
       expect(mockSfnStartExecution).not.toHaveBeenCalled();
   });

   test('should handle SFN_ARN not set', async () => {
   delete process.env.SFN_ARN;
   process.env.DYNAMODB_TABLE = 'test-table';
   mockDynamoQuery.mockReturnValue({ promise: jest.fn().mockResolvedValue({ Items: [{ id: 'cust-abc' }] }) });
   const handler = require('../functions/correlate-health').handler;
   // V-- Provide minimal event structure V--
   const event = { detail: { affectedAccount: '111122223333' } }; // Add necessary properties
   const result = await handler(event);
   expect(result).toEqual({ status: 'error', reason: 'SFN_ARN not set' });
     expect(mockSfnStartExecution).not.toHaveBeenCalled();
    });
});
