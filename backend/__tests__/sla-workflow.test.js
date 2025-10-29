// Mocks for AWS SDK v3 Clients
const mockSend = jest.fn();

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

const mockDynamoUpdate_v2 = jest.fn(); // Mock V2 separado

jest.mock('aws-sdk', () => ({
config: { update: jest.fn() },
DynamoDB: {
    DocumentClient: jest.fn(() => ({
      get: jest.fn().mockReturnValue({ promise: jest.fn().mockResolvedValue({ Item: {} }) }),
   put: jest.fn().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) }),
   query: jest.fn().mockReturnValue({ promise: jest.fn().mockResolvedValue({ Items: [] }) }),
   update: mockDynamoUpdate_v2 // Associar o mock V2
 }))
},
STS: jest.fn(() => ({ // Mock V2 STS (se usado por getAssumedClients)
    assumeRole: mockAssumeRole
 })),
CostExplorer: jest.fn(() => ({
    getCostAndUsage: mockGetCostAndUsage
 })),
Support: jest.fn(() => ({
createCase: mockSupportCreateCase
})),
S3: jest.fn(() => ({
    putObject: mockS3PutObject
  })),
// Adicione outros serviços V2 se sla-workflow.js os usar diretamente
}));

// Reset mocks
beforeEach(() => {
mockSend.mockClear();
mockDynamoUpdate_v2.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
mockAssumeRole.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({ Credentials: { AccessKeyId: 'ASIA...', SecretAccessKey: 'SECRET', SessionToken: 'TOKEN' } }) });
mockGetCostAndUsage.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({ ResultsByTime: [{ Total: { BlendedCost: { Amount: '123.45' } } }] }) });
mockSupportCreateCase.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({ caseId: 'case-123' }) });
mockS3PutObject.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });

 // Default successful resolutions for v3 send mock
  mockSend.mockReset();
  mockSend.mockImplementation(async (command) => {
      if (command.input?.TableName && command.constructor.name.includes('DynamoDB')) {
           if (command.constructor.name === 'GetItemCommand') return { Item: { supportLevel: { S: 'premium' } } };
           if (command.constructor.name === 'QueryCommand') return { Items: [] };
          return {};
      }
      // Garantir que GetCostAndUsageCommand sempre retorne ResultsByTime para evitar forEach errors
      if (command.constructor.name === 'GetCostAndUsageCommand') {
           return { ResultsByTime: [{ Total: { UnblendedCost: { Amount: '123.45' } } }] };
      }
       if (command.constructor.name === 'AssumeRoleCommand') {
           return { Credentials: { AccessKeyId: 'ASIA...', SecretAccessKey: '...', SessionToken: '...' }};
       }
       if (command.constructor.name === 'CreateCaseCommand') {
           return { caseId: 'case-123'};
       }
       if (command.constructor.name === 'PutObjectCommand') {
           return {};
       }
       if (command.constructor.name === 'GetSecretValueCommand') {
          return { SecretString: '{\"key\":\"value\"}' };
       }

      // Retorna resultado padrão em vez de lançar erro
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
       // Mock successful assumeRole (v2 SDK)
       mockAssumeRole.mockReturnValueOnce({
         promise: jest.fn().mockResolvedValue({
           Credentials: {
             AccessKeyId: 'ASIA...',
             SecretAccessKey: 'SECRET',
             SessionToken: 'TOKEN'
           }
         })
       });
       
       // Mock CostExplorer send to fail with credential error
       mockSend.mockImplementationOnce(async (command) => {
          if (command.input) { // This is GetCostAndUsageCommand
              const error = new Error("Resolved credential object is not valid");
              error.$metadata = { attempts: 1, totalRetryDelay: 0 };
              throw error;
          }
          return { ResultsByTime: [] }; // Default return for other commands
       });
       
       // Espera a mensagem de erro final lançada pela função calculateImpact
       await expect(calculateImpact(baseEvent)).rejects.toThrow('Falha ao calcular impacto: Resolved credential object is not valid');
     });

     // Teste de falha no assumeRole
     it('should throw an error if assumeRole fails', async () => {
         mockAssumeRole.mockReturnValueOnce({ // Mock V2 STS
             promise: jest.fn().mockRejectedValue(new Error('AssumeRole failed'))
         });
          // OU Mock V3 STS (se estiver usando v3 para assumeRole)
         // mockSend.mockImplementationOnce(async cmd => { if (cmd.constructor.name === 'AssumeRoleCommand') throw new Error('AssumeRole failed'); });

         // Espera a mensagem de erro lançada por calculateImpact após capturar o erro de assumeRole
         // The actual error message changes to "Falha ao assumir role" when it detects "AssumeRole failed"
         await expect(calculateImpact(baseEvent)).rejects.toThrow('Falha ao assumir role: STS AssumeRole failed: AssumeRole failed');
         expect(mockGetCostAndUsage).not.toHaveBeenCalled(); // V2
         expect(mockSend).not.toHaveBeenCalledWith(expect.objectContaining({ constructor: { name: 'GetCostAndUsageCommand' } })); // V3
     });

      // Teste de falha no Cost Explorer (após assumeRole bem-sucedido)
      it('should handle CostExplorer errors', async () => {
          // Mock successful assumeRole (v2 SDK)
          mockAssumeRole.mockReturnValueOnce({
            promise: jest.fn().mockResolvedValue({
              Credentials: {
                AccessKeyId: 'ASIA...',
                SecretAccessKey: 'SECRET',
                SessionToken: 'TOKEN'
              }
            })
          });
          
          // Mock CostExplorer send to fail
          mockSend.mockImplementationOnce(async (command) => {
            if (command.input) { // This is GetCostAndUsageCommand
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
  expect(mockDynamoUpdate_v2).toHaveBeenCalledWith(expect.objectContaining({ // Usa o mock V2
  ExpressionAttributeValues: { ':status': 'NO_VIOLATION' } // Verifica o status correto
  }));
  });
  });

    describe('submitSupportTicket', () => {
    // ... (ticketBaseEvent completo como no plano anterior) ...
    const ticketBaseEvent = { /* ... */ };

    it('should require manual submission for basic plan', async () => {
    await submitSupportTicket({ ...ticketBaseEvent, supportLevel: 'basic' });
    expect(mockSupportCreateCase).not.toHaveBeenCalled(); // V2 mock
    expect(mockSend).not.toHaveBeenCalledWith(expect.objectContaining({ constructor: { name: 'CreateCaseCommand' } })); // V3 mock
    expect(mockDynamoUpdate_v2).toHaveBeenCalledWith(expect.objectContaining({
    // V-- Corrigir o status esperado V--
    ExpressionAttributeValues: { ':status': 'PENDING_MANUAL_SUBMISSION' }
    }));
    });

    // ... outros testes de submitSupportTicket (verificar se usam ticketBaseEvent completo) ...
    });
});
