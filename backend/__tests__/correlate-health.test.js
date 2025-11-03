// Mocks para AWS SDK v3 (lib-dynamodb e client-sfn)
const mockDdbSend = jest.fn();
const mockSfnSend = jest.fn();

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDdbSend })) },
  QueryCommand: function(input) { return { input }; },
  PutCommand: function(input) { return { input }; }
}));

jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn(() => ({ send: mockSfnSend })),
  StartExecutionCommand: function(input) { return { input }; }
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
    mockDdbSend.mockClear().mockImplementation((cmd) => {
      // If it's a QueryCommand (has IndexName in input) return Items
      const input = cmd && cmd.input ? cmd.input : {};
      if (input.IndexName || input.KeyConditionExpression) {
        return Promise.resolve({ Items: [{ id: 'cust-abc' }] });
      }
      // For PutCommand and others, return empty
      return Promise.resolve({});
    });
    mockSfnSend.mockClear().mockResolvedValue({});
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
    expect(mockDdbSend).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ TableName: 'test-table' }) }));
    expect(mockSfnSend).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ stateMachineArn: 'dummy-sfn-arn' }) }));
  });

   test('should handle customer not found', async () => {
       // Override mock for this specific test (no items returned)
       mockDdbSend.mockImplementationOnce((cmd) => {
         const input = cmd && cmd.input ? cmd.input : {};
         if (input.IndexName || input.KeyConditionExpression) {
           return Promise.resolve({ Items: [] });
         }
         return Promise.resolve({});
       });
       process.env.DYNAMODB_TABLE = 'test-table';
       process.env.SFN_ARN = 'dummy-sfn-arn';
     const handler = require('../functions/correlate-health').handler;
       const event = { detail: { affectedAccount: '999988887777', id: 'evt-123', startTime: '2025-10-26T10:00:00Z', service: 'EC2' } };
       const result = await handler(event);
     expect(result).toEqual({ status: 'error', reason: 'Customer not found' });
     expect(mockSfnSend).not.toHaveBeenCalled();
   });

   test('should handle SFN_ARN not set', async () => {
   delete process.env.SFN_ARN;
   process.env.DYNAMODB_TABLE = 'test-table';
   mockDdbSend.mockImplementationOnce((cmd) => {
     const input = cmd && cmd.input ? cmd.input : {};
     if (input.IndexName || input.KeyConditionExpression) {
       return Promise.resolve({ Items: [{ id: 'cust-abc' }] });
     }
     return Promise.resolve({});
   });
   const handler = require('../functions/correlate-health').handler;
   // V-- Provide minimal event structure V--
   const event = { detail: { affectedAccount: '111122223333', id: 'evt-456', startTime: '2025-10-26T10:00:00Z', service: 'RDS' } }; // Add necessary properties
   const result = await handler(event);
   expect(result).toEqual({ status: 'error', reason: 'SFN_ARN not set' });
    expect(mockSfnSend).not.toHaveBeenCalled();
    });
});
