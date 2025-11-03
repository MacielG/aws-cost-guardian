// Tests for API endpoints using supertest
const request = require('supertest');

// Mocks para AWS SDK v3 usados pelo handler (mocks devem ser definidos ANTES de requerir o handler)
const mockDdbSend = jest.fn();
const mockSecretsSend = jest.fn();
const mockStsSend = jest.fn();
const mockSfnSend = jest.fn();

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDdbSend })) },
  GetCommand: function(input) { return { input }; },
  PutCommand: function(input) { return { input }; },
  UpdateCommand: function(input) { return { input }; },
  QueryCommand: function(input) { return { input }; }
}));

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({ send: mockSecretsSend })),
  GetSecretValueCommand: function(input) { return { input }; }
}));

jest.mock('@aws-sdk/client-sts', () => ({
  STSClient: jest.fn(() => ({ send: mockStsSend })),
  AssumeRoleCommand: function(input) { return { input }; }
}));

jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn(() => ({ send: mockSfnSend })),
  StartExecutionCommand: function(input) { return { input }; }
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn() })),
  GetObjectCommand: function(input) { return { input }; }
}));

// Mock jsonwebtoken to bypass JWKS complexity in tests
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(() => ({ sub: 'user-1', 'cognito:groups': ['Admins'] })),
}));

jest.mock('jwks-rsa', () => jest.fn(() => ({ getSigningKey: jest.fn((kid, cb) => cb(null, { getPublicKey: () => 'public' })) })));

const { rawApp } = require('../handler');

const app = rawApp; // express app exported for tests
const agent = request(app);

describe('API handler endpoints', () => {
  // mocks are provided above (mockDdbSend, mockSecretsSend, ...)

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE = 'test-table';
    process.env.PLATFORM_ACCOUNT_ID = '123456789012';
    process.env.USER_POOL_ID = 'us-east-1_testpool';
  });

  test('GET /api/onboard-init creates and returns externalId when none exists', async () => {
    // Simulate no existing item (Get then Put)
    mockDdbSend.mockResolvedValueOnce({}); // get
    mockDdbSend.mockResolvedValueOnce({}); // put

    const res = await agent.get('/api/onboard-init').set('Authorization', 'Bearer faketoken');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('externalId');
    expect(res.body).toHaveProperty('platformAccountId', process.env.PLATFORM_ACCOUNT_ID);
  // Ensure we attempted to put the item (a PutCommand was sent)
  expect(mockDdbSend).toHaveBeenCalled();
  });

  test('POST /api/onboard with CFN ResourceProperties stores config', async () => {
    const payload = {
      ResourceProperties: {
        CustomerId: 'cust-999',
        RoleArn: 'arn:aws:iam::111122223333:role/CostGuardianDelegatedRole',
        AwsAccountId: '111122223333',
        ExternalId: 'ext-123'
      }
    };

    mockDdbSend.mockResolvedValueOnce({});

    const res = await agent.post('/api/onboard').send(payload);
    expect(res.status).toBe(200);
  expect(mockDdbSend).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ TableName: process.env.DYNAMODB_TABLE }) }));
  });

  test('GET /api/dashboard/costs returns most recent cost data', async () => {
    const fakeData = { data: { total: 123.45 } };
    mockDdbSend.mockResolvedValueOnce({ Items: [fakeData] });

    const res = await agent.get('/api/dashboard/costs').set('Authorization', 'Bearer faketoken');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeData.data);
  });

  test('POST /api/settings/automation saves automation preferences', async () => {
    mockDdbSend.mockResolvedValueOnce({});

    const payload = { automation: { stopIdle: true, deleteUnusedEbs: false } };
    const res = await agent.post('/api/settings/automation').set('Authorization', 'Bearer faketoken').send(payload);
    expect(res.status).toBe(200);
  expect(mockDdbSend).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ TableName: process.env.DYNAMODB_TABLE }) }));
  });

  test('GET /api/admin/claims requires admin and returns items', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [{ id: 'cust-1', sk: 'CLAIM#1' }] });

    const res = await agent.get('/api/admin/claims').set('Authorization', 'Bearer faketoken');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items || res.body)).toBeTruthy();
  });

  test('PUT /api/admin/claims/:customerId/:claimId/status updates status', async () => {
    // Atualiza mock para usar mockDdbSend (UpdateCommand é roteado para DynamoDBDocumentClient.send)
    mockDdbSend.mockResolvedValueOnce({});
    const res = await agent.put('/api/admin/claims/cust-1/claim-1/status').set('Authorization', 'Bearer faketoken').send({ status: 'READY_TO_SUBMIT' });
    expect(res.status).toBe(200);
  expect(mockDdbSend).toHaveBeenCalled();
  });
});
