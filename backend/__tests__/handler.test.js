// Tests for API endpoints using supertest
const request = require('supertest');

// Primeiro, declare todos os mocks antes de qualquer require ou jest.mock
const mockStsAssumeRole = jest.fn();
const mockDynamoGet = jest.fn();
const mockDynamoPut = jest.fn();
const mockDynamoQuery = jest.fn();
const mockDynamoUpdate = jest.fn();
const mockSecretsGetSecretValue = jest.fn();

// Mock AWS SDK depois das declarações
jest.mock('aws-sdk', () => ({
  STS: jest.fn().mockImplementation(() => ({
    assumeRole: mockStsAssumeRole.mockReturnValue({
      promise: jest.fn().mockResolvedValue({
        Credentials: {
          AccessKeyId: 'mockAccessKeyId',
          SecretAccessKey: 'mockSecretAccessKey',
          SessionToken: 'mockSessionToken',
        }
      })
    })
  })),
  DynamoDB: {
    DocumentClient: jest.fn().mockImplementation(() => ({
      get: mockDynamoGet.mockReturnValue({
        promise: jest.fn().mockResolvedValue({})
      }),
      put: mockDynamoPut.mockReturnValue({
        promise: jest.fn().mockResolvedValue({})
      }),
      query: mockDynamoQuery.mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Items: [] })
      }),
      update: mockDynamoUpdate.mockReturnValue({
        promise: jest.fn().mockResolvedValue({})
      })
    }))
  },
  SecretsManager: jest.fn().mockImplementation(() => ({
  getSecretValue: mockSecretsGetSecretValue.mockReturnValue({
  promise: jest.fn().mockResolvedValue({ SecretString: '{}' })
  })
  })),
  // V-- Add EC2 mock constructor V--
  EC2: jest.fn(() => ({
  // Add mock methods if getAssumedClients calls any EC2 methods
   // e.g., describeInstances: jest.fn().mockReturnValue({ promise: jest.fn() })
  })),
  RDS: jest.fn(() => ({
    describeDBInstances: jest.fn().mockReturnValue({
      promise: jest.fn().mockResolvedValue({ DBInstances: [] })
    })
  })),
   StepFunctions: jest.fn().mockImplementation(() => ({
     startExecution: jest.fn().mockReturnValue({
       promise: jest.fn().mockResolvedValue({})
     })
   }))
}));

// Mock jsonwebtoken to bypass JWKS complexity in tests
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(() => ({ sub: 'user-1', 'cognito:groups': ['Admins'] })),
}));

jest.mock('jwks-rsa', () => jest.fn(() => ({ getSigningKey: jest.fn((kid, cb) => cb(null, { getPublicKey: () => 'public' })) })));

const AWS = require('aws-sdk');
const { rawApp } = require('../handler');

const app = rawApp; // express app exported for tests
const agent = request(app);

describe('API handler endpoints', () => {
  const mockDdb = new AWS.DynamoDB.DocumentClient();
  const mockSecrets = new AWS.SecretsManager();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE = 'test-table';
    process.env.PLATFORM_ACCOUNT_ID = '123456789012';
    process.env.USER_POOL_ID = 'us-east-1_testpool';
  });

  test('GET /api/onboard-init creates and returns externalId when none exists', async () => {
    // Simulate no existing item
    mockDynamoGet.mockReturnValue({
      promise: jest.fn().mockResolvedValue({})
    });
    mockDynamoPut.mockReturnValue({
      promise: jest.fn().mockResolvedValue({})
    });

    const res = await agent.get('/api/onboard-init').set('Authorization', 'Bearer faketoken');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('externalId');
    expect(res.body).toHaveProperty('platformAccountId', process.env.PLATFORM_ACCOUNT_ID);
    // Ensure we attempted to put the item
    expect(mockDynamoPut).toHaveBeenCalled();
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

    mockDynamoPut.mockReturnValue({
      promise: jest.fn().mockResolvedValue({})
    });

    const res = await agent.post('/api/onboard').send(payload);
    expect(res.status).toBe(200);
    expect(mockDynamoPut).toHaveBeenCalledWith(expect.objectContaining({ TableName: process.env.DYNAMODB_TABLE }));
  });

  test('GET /api/dashboard/costs returns most recent cost data', async () => {
    const fakeData = { data: { total: 123.45 } };
    mockDynamoQuery.mockReturnValue({
      promise: jest.fn().mockResolvedValue({ Items: [fakeData] })
    });

    const res = await agent.get('/api/dashboard/costs').set('Authorization', 'Bearer faketoken');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeData.data);
  });

  test('POST /api/settings/automation saves automation preferences', async () => {
    mockDynamoUpdate.mockReturnValue({
      promise: jest.fn().mockResolvedValue({})
    });

    const payload = { automation: { stopIdle: true, deleteUnusedEbs: false } };
    const res = await agent.post('/api/settings/automation').set('Authorization', 'Bearer faketoken').send(payload);
    expect(res.status).toBe(200);
    expect(mockDynamoUpdate).toHaveBeenCalledWith(expect.objectContaining({ TableName: process.env.DYNAMODB_TABLE }));
  });

  test('GET /api/admin/claims requires admin and returns items', async () => {
    mockDynamoQuery.mockReturnValue({
      promise: jest.fn().mockResolvedValue({ Items: [{ id: 'cust-1', sk: 'CLAIM#1' }] })
    });

    const res = await agent.get('/api/admin/claims').set('Authorization', 'Bearer faketoken');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items || res.body)).toBeTruthy();
  });

  test('PUT /api/admin/claims/:customerId/:claimId/status updates status', async () => {
    mockDynamoUpdate.mockReturnValue({
      promise: jest.fn().mockResolvedValue({})
    });
    const res = await agent.put('/api/admin/claims/cust-1/claim-1/status').set('Authorization', 'Bearer faketoken').send({ status: 'READY_TO_SUBMIT' });
    expect(res.status).toBe(200);
    expect(mockDynamoUpdate).toHaveBeenCalled();
  });
});
