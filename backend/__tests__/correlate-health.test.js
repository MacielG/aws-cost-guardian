// Primeiro, declare todos os mocks antes de qualquer jest.mock
const mockDynamoQuery = jest.fn();
const mockDynamoPut = jest.fn();
const mockSfnStartExecution = jest.fn();

const { handler } = require('../functions/correlate-health');

// Mock AWS SDK depois das declarações
jest.mock('aws-sdk', () => ({
  DynamoDB: {
    DocumentClient: jest.fn().mockImplementation(() => ({
      query: mockDynamoQuery.mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Items: [] })
      }),
      put: mockDynamoPut.mockReturnValue({
        promise: jest.fn().mockResolvedValue({})
      })
    }))
  },
  StepFunctions: jest.fn().mockImplementation(() => ({
    startExecution: mockSfnStartExecution.mockReturnValue({
      promise: jest.fn().mockResolvedValue({})
    })
  }))
}));

describe('correlate-health handler', () => {
  const AWS = require('aws-sdk');
  const mockDdb = new AWS.DynamoDB.DocumentClient();
  const mockSfn = new AWS.StepFunctions();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE = 'test-table';
    process.env.SFN_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:test';
  });

  it('should query DynamoDB and start the Step Function with correct input', async () => {
    const event = {
      detail: {
        id: 'evt-1',
        affectedAccount: '111122223333',
        startTime: '2025-10-26T10:00:00Z',
        service: 'EC2',
        resources: ['arn:aws:ec2:us-east-1:111122223333:instance/i-123']
      }
    };

    // Mock DynamoDB query to return a customer mapping
    mockDynamoQuery.mockReturnValue({
      promise: jest.fn().mockResolvedValue({ Items: [{ id: 'cust-abc' }] })
    });

    // Mock SFN startExecution to resolve
    mockSfnStartExecution.mockReturnValue({
      promise: jest.fn().mockResolvedValue({ executionArn: 'arn:exec' })
    });

    const result = await handler(event);

    expect(mockDynamoQuery).toHaveBeenCalled();
    expect(mockDynamoPut).toHaveBeenCalledWith(expect.objectContaining({ TableName: 'test-table' }));

    expect(mockSfnStartExecution).toHaveBeenCalledWith(expect.objectContaining({
      stateMachineArn: process.env.SFN_ARN,
      input: expect.any(String),
    }));

    const calledInput = JSON.parse(mockSfnStartExecution.mock.calls[0][0].input);
    expect(calledInput.customerId).toBe('cust-abc');
    expect(calledInput.awsAccountId).toBe('111122223333');
    expect(result.status).toBe('success');
    expect(result.customerId).toBe('cust-abc');
  });

  it('should return error when no customer found', async () => {
    const event = { detail: { id: 'evt-2', affectedAccount: '999988887777', resources: [] } };
    mockDynamoQuery.mockReturnValue({
      promise: jest.fn().mockResolvedValue({ Items: [] })
    });

    const result = await handler(event);
    expect(result.status).toBe('error');
    expect(result.reason).toMatch(/Customer not found/i);
  });
});
