// Mocks for AWS SDK v3 Clients
const mockSend = jest.fn();
const mockDdbSend = jest.fn();

// Additional mocks for V2
const mockGetCostAndUsage = jest.fn();
const mockAssumeRole = jest.fn();
const mockSupportCreateCase = jest.fn();
const mockS3PutObject = jest.fn();
jest.mock('@aws-sdk/client-cost-explorer', () => ({
  CostExplorerClient: jest.fn(() => ({
    send: mockSend
  })),
  GetCostAndUsageCommand: jest.fn((input) => ({ 
    input, 
    constructor: { name: 'GetCostAndUsageCommand' }
  }))
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockSend })),
  UpdateItemCommand: jest.fn(input => ({ input })),
  PutItemCommand: jest.fn(input => ({ input })),
  GetItemCommand: jest.fn(input => ({ input })),
  QueryCommand: jest.fn(input => ({ input }))
}));
// Mock lib-dynamodb DocumentClient.from(...) to return object with .send()
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDdbSend })) },
  GetCommand: function(input) { return { input }; },
  PutCommand: function(input) { return { input }; },
  UpdateCommand: function(input) { return { input }; },
  QueryCommand: function(input) { return { input }; }
}));
 jest.mock('@aws-sdk/client-s3', () => ({
   S3Client: jest.fn(() => ({ send: mockSend })),
   PutObjectCommand: jest.fn(input => ({ input }))
 }));
 jest.mock('@aws-sdk/client-secrets-manager', () => ({
    SecretsManagerClient: jest.fn(() => ({ send: mockSend })),
    GetSecretValueCommand: jest.fn(input => ({ input }))
  }));
  jest.mock('@aws-sdk/client-sts', () => ({
    STSClient: jest.fn(() => ({ send: mockSend })),
    AssumeRoleCommand: jest.fn(input => ({ input }))
  }));
  jest.mock('@aws-sdk/client-support', () => ({
      SupportClient: jest.fn(() => ({ send: mockSend })),
      CreateCaseCommand: jest.fn(input => ({ input }))
  }));

// Note: we mock AWS SDK v3 clients above (mockSend). The legacy aws-sdk v2 mocks were removed
// because this function now uses @aws-sdk v3 modular clients.

// Reset mocks
beforeEach(() => {
  // Reset v3 mocks
  mockSend.mockReset();
  mockDdbSend.mockClear();

  // DynamoDBDocumentClient.from(...).send default behavior
  mockDdbSend.mockImplementation(async (command) => {
    const input = command && command.input ? command.input : {};
    // debug
    // console.log('mockDdbSend called with input:', JSON.stringify(input));
    // GetCommand (single item) - some tests don't set TableName in env; match on Key only
    if (input.Key) {
      return { Item: { externalId: 'ext-123', supportLevel: 'premium', stripeCustomerId: null } };
    }
    // QueryCommand
    if (input.IndexName || input.KeyConditionExpression) {
      return { Items: [] };
    }
    if (input.UpdateExpression) return {};
    return {};
  });

  // Default successful resolutions for v3 send mock
  mockSend.mockImplementation(async (command) => {
    const name = command && command.constructor && command.constructor.name;
    if (name === 'GetCostAndUsageCommand') return { ResultsByTime: [{ Total: { UnblendedCost: { Amount: '123.45' } } }] };
    if (name === 'AssumeRoleCommand') return { Credentials: { AccessKeyId: 'ASIA...', SecretAccessKey: '...', SessionToken: '...' } };
    if (name === 'CreateCaseCommand') return { caseId: 'case-123' };
    if (name === 'PutObjectCommand') return {};
    if (name === 'GetSecretValueCommand') return { SecretString: '{"key":"value"}' };
    return { ResultsByTime: [] };
  });
});

// Import the functions AFTER mocking
const { calculateImpact, checkSLA, generateReport, submitSupportTicket } = require('../functions/sla-workflow');

describe('SLA Workflow Functions', () => {
  // ... (baseEvent completo) ...
  const baseEvent = {
      customerId: 'cust-123', awsAccountId: '111122223333',
      incidentId: 'INCIDENT#abc-123',
      healthEvent: {
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        service: 'EC2',
        resources: ['arn:aws:ec2:us-east-1:111122223333:instance/i-12345'],
        detail: {
          affectedEntities: [{ entityValue: 'dummy-resource-arn' }]
        }
      }
  };

  describe('calculateImpact', () => {

     it('should handle invalid credentials after assumeRole', async () => {
       // Ensure AssumeRole returns credentials, then CostExplorer throws credential error
       // First send() call (AssumeRole) -> return credentials
       mockSend.mockImplementationOnce(async () => ({ Credentials: { AccessKeyId: 'ASIA...', SecretAccessKey: 'SECRET', SessionToken: 'TOKEN' } }));
       mockSend.mockImplementationOnce(async (command) => {
         if (command && command.constructor && command.constructor.name === 'GetCostAndUsageCommand') {
           const error = new Error('Resolved credential object is not valid');
           error.$metadata = { attempts: 1, totalRetryDelay: 0 };
           throw error;
         }
         return { ResultsByTime: [] };
       });

       // Espera a mensagem de erro final lançada pela função calculateImpact
       await expect(calculateImpact(baseEvent)).rejects.toThrow('Falha ao calcular impacto: Resolved credential object is not valid');
     });


     it('should throw an error if assumeRole fails', async () => {
        // Mock STS AssumeRole to fail (v3 path) - first send call will throw
        mockSend.mockImplementationOnce(async () => { throw new Error('AssumeRole failed'); });

         // Espera a mensagem de erro lançada por calculateImpact após capturar o erro de assumeRole
         await expect(calculateImpact(baseEvent)).rejects.toThrow('Falha ao assumir role: STS AssumeRole failed: AssumeRole failed');
         expect(mockGetCostAndUsage).not.toHaveBeenCalled(); // V2
         expect(mockSend).not.toHaveBeenCalledWith(expect.objectContaining({ constructor: { name: 'GetCostAndUsageCommand' } })); // V3
     });


        it('should handle CostExplorer errors', async () => {
            // AssumeRole succeeds, then CostExplorer send fails
            // AssumeRole succeeds (first send call)
            mockSend.mockImplementationOnce(async () => ({ Credentials: { AccessKeyId: 'ASIA...', SecretAccessKey: 'SECRET', SessionToken: 'TOKEN' } }));
            mockSend.mockImplementationOnce(async (command) => {
              if (command && command.constructor && command.constructor.name === 'GetCostAndUsageCommand') {
                throw new Error('CE Error');
              }
              return { ResultsByTime: [] };
            });

            // Espera a mensagem de erro final
            await expect(calculateImpact(baseEvent)).rejects.toThrow('Falha ao calcular impacto: CE Error');
      });

  });

  // --- Testes para checkSLA ---
  describe('checkSLA', () => {
    it('should return no violation when impactedCost is 0', async () => {
      const event = { impactedCost: 0, healthEvent: { startTime: new Date().toISOString(), endTime: new Date().toISOString() }, slaThreshold: 0.999 };
      const result = await checkSLA(event);
      expect(result.violation).toBe(false);
      expect(result.credit).toBe(0);
    });

    it('should calculate credit when duration exceeds SLA', async () => {
      const start = new Date(Date.now() - 1000 * 60 * 120).toISOString(); // 2 hours ago
      const end = new Date().toISOString();
      const event = { impactedCost: 100, healthEvent: { startTime: start, endTime: end, service: 'ec2' }, slaThreshold: 0.999 };
      const result = await checkSLA(event);
      expect(result.violation).toBe(true);
      expect(result.credit).toBe(10); // 10% de 100
    });
  });

  describe('generateReport', () => {
  it('should do nothing if there is no violation', async () => {
  const noViolationEvent = { violation: false, credit: 0, customerId: 'c1', incidentId: 'i1' };
  const result = await generateReport(noViolationEvent);
  expect(result.claimGenerated).toBe(false); // Verifica o retorno explícito
  expect(mockDdbSend).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ ExpressionAttributeValues: { ':status': 'NO_VIOLATION' } }) }));
  });
  });

    describe('submitSupportTicket', () => {
    // ... (ticketBaseEvent completo como no plano anterior) ...
    const ticketBaseEvent = { /* ... */ };

    it('should require manual submission for basic plan', async () => {
    await submitSupportTicket({ ...ticketBaseEvent, supportLevel: 'basic' });
    expect(mockSupportCreateCase).not.toHaveBeenCalled(); // V2 mock
    expect(mockSend).not.toHaveBeenCalledWith(expect.objectContaining({ constructor: { name: 'CreateCaseCommand' } })); // V3 mock
  expect(mockDdbSend).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ ExpressionAttributeValues: { ':status': 'PENDING_MANUAL_SUBMISSION' } }) }));
    });

    // ... outros testes de submitSupportTicket (verificar se usam ticketBaseEvent completo) ...
    });
});
