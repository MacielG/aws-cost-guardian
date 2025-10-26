const { handler } = require('../functions/correlate-health');

jest.mock('aws-sdk', () => {
  const mDocumentClient = jest.fn();
  mDocumentClient.prototype.query = jest.fn().mockReturnThis();
  mDocumentClient.prototype.put = jest.fn().mockReturnThis();
  mDocumentClient.prototype.promise = jest.fn();

  const mStepFunctions = jest.fn();
  mStepFunctions.prototype.startExecution = jest.fn().mockReturnThis();
  mStepFunctions.prototype.promise = jest.fn();

  return {
    DynamoDB: { DocumentClient: mDocumentClient },
    StepFunctions: mStepFunctions,
  };
});

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
    mockDdb.query().promise.mockResolvedValueOnce({ Items: [{ id: 'cust-abc' }] });

    // Mock DynamoDB put and SFN startExecution to resolve
    mockDdb.put().promise.mockResolvedValueOnce({});
    mockSfn.startExecution().promise.mockResolvedValueOnce({ executionArn: 'arn:exec' });

    const result = await handler(event);

    expect(mockDdb.query).toHaveBeenCalled();
    expect(mockDdb.put).toHaveBeenCalledWith(expect.objectContaining({ TableName: 'test-table' }));

    expect(mockSfn.startExecution).toHaveBeenCalledWith(expect.objectContaining({
      stateMachineArn: process.env.SFN_ARN,
      input: expect.any(String),
    }));

    const calledInput = JSON.parse(mockSfn.startExecution.mock.calls[0][0].input);
    expect(calledInput.customerId).toBe('cust-abc');
    expect(calledInput.awsAccountId).toBe('111122223333');
    expect(result.status).toBe('success');
    expect(result.customerId).toBe('cust-abc');
  });

  it('should return error when no customer found', async () => {
    const event = { detail: { id: 'evt-2', affectedAccount: '999988887777', resources: [] } };
    mockDdb.query().promise.mockResolvedValueOnce({ Items: [] });

    const result = await handler(event);
    expect(result.status).toBe('error');
    expect(result.reason).toMatch(/Customer not found/i);
  });
});
