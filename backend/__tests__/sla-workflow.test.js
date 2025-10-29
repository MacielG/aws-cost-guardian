// Mocks for AWS SDK v3 Clients (adjust imports based on actual usage)
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-cost-explorer', () => ({
  CostExplorerClient: jest.fn(() => ({
    send: mockSend // Use the shared mockSend
  })),
  GetCostAndUsageCommand: jest.fn((input) => ({ /* Command input */ input })) // Mock command constructors
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({ // If using v3 DynamoDB client
   DynamoDBClient: jest.fn(() => ({ send: mockSend })),
   // Mock specific commands used (e.g., GetItemCommand, PutItemCommand, UpdateItemCommand, QueryCommand)
   UpdateItemCommand: jest.fn(input => ({ input })),
   PutItemCommand: jest.fn(input => ({ input })),
   GetItemCommand: jest.fn(input => ({ input })),
   QueryCommand: jest.fn(input => ({ input }))
}));
 jest.mock('@aws-sdk/client-s3', () => ({ // If using v3 S3 client
   S3Client: jest.fn(() => ({ send: mockSend })),
   PutObjectCommand: jest.fn(input => ({ input }))
}));
 jest.mock('@aws-sdk/client-secrets-manager', () => ({ // If using v3 SecretsManager client
    SecretsManagerClient: jest.fn(() => ({ send: mockSend })),
    GetSecretValueCommand: jest.fn(input => ({ input }))
 }));
  jest.mock('@aws-sdk/client-sts', () => ({ // If using v3 STS client
    STSClient: jest.fn(() => ({ send: mockSend })),
    AssumeRoleCommand: jest.fn(input => ({ input }))
  }));
  jest.mock('@aws-sdk/client-support', () => ({ // If using v3 Support client
      SupportClient: jest.fn(() => ({ send: mockSend })),
      CreateCaseCommand: jest.fn(input => ({ input }))
  }));


 // Mock AWS SDK v2 (if still partially used, keep relevant parts)
 // ... (v2 mocks for DynamoDB DocumentClient, potentially others) ...
  const mockDynamoUpdate_v2 = jest.fn(); // Keep separate mock for DocumentClient.update

  jest.mock('aws-sdk', () => ({
     config: { update: jest.fn() },
     DynamoDB: {
         DocumentClient: jest.fn(() => ({
             // Keep v2 DocumentClient mocks if functions/sla-workflow directly uses them
             get: jest.fn().mockReturnValue({ promise: jest.fn().mockResolvedValue({ Item: {} }) }), // Default mock
             put: jest.fn().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) }),
             query: jest.fn().mockReturnValue({ promise: jest.fn().mockResolvedValue({ Items: [] }) }),
             update: mockDynamoUpdate_v2 // Use specific v2 mock
         }))
     },
     // Mock v2 STS ONLY if getAssumedClients uses it
     STS: jest.fn(() => ({
        assumeRole: jest.fn().mockReturnValue({
            promise: jest.fn().mockResolvedValue({ Credentials: { AccessKeyId: 'ASIA...', SecretAccessKey: '...', SessionToken: '...' }})
        })
     })),
     // Mock other v2 services ONLY if directly used
  }));

// Reset mocks
beforeEach(() => {
  mockSend.mockClear(); // Clear v3 send mock
   mockDynamoUpdate_v2.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) }); // Reset v2 update

  // Default successful resolutions for v3 send mock based on command input
  mockSend.mockImplementation(async (command) => {
      if (command.input?.TableName && command.constructor.name.includes('DynamoDB')) { // DynamoDB commands
           if (command.constructor.name === 'GetItemCommand') return { Item: { supportLevel: { S: 'premium' } } }; // Default for GetItem
           if (command.constructor.name === 'QueryCommand') return { Items: [] }; // Default for Query
          return {}; // Default for Put/Update
      }
      if (command.constructor.name === 'GetCostAndUsageCommand') { // CostExplorer
           return { ResultsByTime: [{ Total: { BlendedCost: { Amount: '123.45' } } }] };
      }
       if (command.constructor.name === 'AssumeRoleCommand') { // STS
           return { Credentials: { AccessKeyId: 'ASIA...', SecretAccessKey: '...', SessionToken: '...' }};
       }
       if (command.constructor.name === 'CreateCaseCommand') { // Support
           return { caseId: 'case-123'};
       }
       if (command.constructor.name === 'PutObjectCommand') { // S3
           return {};
       }
       if (command.constructor.name === 'GetSecretValueCommand') { // SecretsManager
          return { SecretString: '{"key":"value"}' };
       }

      throw new Error(`Unhandled mock command: ${command?.constructor?.name}`);
  });
});

// Import the functions AFTER mocking
const { calculateImpact, checkSLA, generateReport, submitSupportTicket } = require('../functions/sla-workflow');

describe('SLA Workflow Functions', () => {
  const baseEvent = {
    customerId: 'cust-123',
    awsAccountId: '111122223333',
    incidentId: 'INCIDENT#abc-123',
    healthEvent: {
      startTime: '2023-10-26T10:00:00Z',
      endTime: '2023-10-26T11:00:00Z',
      service: 'EC2',
      resources: ['arn:aws:ec2:us-east-1:111122223333:instance/i-1234567890abcdef0'],
    },
  };

  describe('calculateImpact', () => {
    it('should calculate impacted cost correctly', async () => {
      // This test should now use the default successful mockGetCostAndUsage
      const result = await calculateImpact(baseEvent);
      expect(result.impactedCost).toBeCloseTo(123.45 / 30 / 24); // Example calc based on mock
      expect(mockGetCostAndUsage).toHaveBeenCalled();
    });

     it('should return 0 cost if no resources are affected', async () => {
       const eventNoResources = { ...baseEvent, healthEvent: { ...baseEvent.healthEvent, resources: [] } };
       const result = await calculateImpact(eventNoResources);
       expect(result.impactedCost).toBe(0);
       expect(mockDynamoUpdate).toHaveBeenCalledWith(expect.objectContaining({ // Check update is called
          TableName: process.env.DYNAMODB_TABLE,
          Key: { id: baseEvent.customerId, sk: baseEvent.incidentId },
          ExpressionAttributeValues: { ':status': 'NO_IMPACT' }
       }));
       expect(mockGetCostAndUsage).not.toHaveBeenCalled(); // Cost explorer shouldn't be called
     });

    it('should use basic support level if not configured', async () => {
      // Override DynamoDB Get for this test
      mockDynamoGet.mockReturnValueOnce({ promise: jest.fn().mockResolvedValue({}) }); // No Item found
      const result = await calculateImpact(baseEvent);
      // Check assumes successful cost calculation with default mock
       expect(result.impactedCost).toBeGreaterThan(0);
       expect(result.supportLevel).toBe('basic');
       expect(mockGetCostAndUsage).toHaveBeenCalled();
    });


    // Test for assumeRole failure (assuming v3)
    it('should throw an error if assumeRole fails', async () => {
     mockSend.mockImplementationOnce(async (command) => { // Override mockSend for this call
           if (command.constructor.name === 'AssumeRoleCommand') {
               throw new Error('AssumeRole failed');
           }
             // Fallback for other potential calls in the function, if any
             return {};
        });
    // Error thrown inside getAssumedClients (adjust message if needed)
    await expect(calculateImpact(baseEvent)).rejects.toThrow('Falha ao assumir role: AssumeRole failed');
    });

    // Test for CostExplorer error (assuming v3)
     it('should handle CostExplorer errors', async () => {
         mockSend.mockImplementationOnce(async (command) => { // Override mockSend for CE call
             if (command.constructor.name === 'GetCostAndUsageCommand') {
                 throw new Error('CE Error');
             }
             // Handle assumeRole call successfully
              if (command.constructor.name === 'AssumeRoleCommand') {
                   return { Credentials: { AccessKeyId: 'ASIA...', SecretAccessKey: '...', SessionToken: '...' }};
               }
             return {};
         });
         // Error message thrown by calculateImpact itself
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
      it('should generate report and save claim', async () => {
           process.env.REPORTS_BUCKET_NAME = 'test-bucket';
           // Provide necessary event data for successful report generation
           const reportEvent = {
               violation: true, credit: 25, customerId: 'cust-123',
               incidentId: 'INCIDENT#abc-123', awsAccountId: '111122223333',
               healthEvent: { service: 'RDS', startTime: '...', endTime: '...' },
               durationMinutes: 150, impactedCost: 250
           };
           // Override get mock if needed to simulate subscription status check
           mockDynamoGet.mockReturnValueOnce({ promise: jest.fn().mockResolvedValue({ Item: { subscriptionStatus: 'active' } }) });

           const result = await generateReport(reportEvent);
           expect(result.claimId).toMatch(/CLAIM#/); // Check claimId is returned
           expect(mockS3PutObject).toHaveBeenCalledWith(expect.objectContaining({ Bucket: 'test-bucket' }));
           expect(mockDynamoPut).toHaveBeenCalledWith(expect.objectContaining({ TableName: process.env.DYNAMODB_TABLE })); // Check claim saved to DB
           // Check if Stripe mock was NOT called (if applicable)
      });

       // Fix generateReport test
       it('should do nothing if there is no violation', async () => {
       const noViolationEvent = { violation: false, credit: 0, customerId: 'c1', incidentId: 'i1' }; // Added IDs
       const result = await generateReport(noViolationEvent);
       expect(result.claimGenerated).toBe(false); // Check output indicates no claim
       // Check V2 update mock
       expect(mockDynamoUpdate_v2).toHaveBeenCalledWith(expect.objectContaining({
           TableName: process.env.DYNAMODB_TABLE, // Ensure env var is set
           Key: { id: 'c1', sk: 'i1' },
             ExpressionAttributeValues: { ':status': 'NO_VIOLATION' }
          }));
         });
  });

    // Fix submitSupportTicket tests (Provide full event)
    describe('submitSupportTicket', () => {
         const ticketBaseEvent = { // Use a more complete event structure
             claimId: 'CLAIM#abc-123',
             customerId: 'cust-123',
             awsAccountId: '111122223333',
             credit: 25,
             durationMinutes: 150,
             healthEvent: {
                 service: 'EC2',
                 eventArn: 'arn:event',
                 startTime: '2023-10-26T10:00:00Z',
                 endTime: '2023-10-26T11:00:00Z',
                 resources: [ 'i-123' ]
             },
             // supportLevel added per test
         };

         it('should create a support case and update claim status', async () => {
            await submitSupportTicket({ ...ticketBaseEvent, supportLevel: 'premium' });
            expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ // Check v3 send
                input: expect.objectContaining({ // Check CreateCaseCommand input
                    subject: expect.stringContaining('CLAIM#abc-123')
                })
            }));
             expect(mockDynamoUpdate_v2).toHaveBeenCalledWith(expect.objectContaining({ // Check v2 update
               ExpressionAttributeValues: { ':status': 'TICKET_SUBMITTED', ':caseId': 'case-123' }
             }));
         });

        it('should handle ticket submission failure', async () => {
             mockSend.mockImplementationOnce(async (command) => { // Mock v3 send to fail for CreateCase
                 if (command.constructor.name === 'CreateCaseCommand') {
                    throw new Error('CreateCase failed');
                 }
                 return {};
             });
             await expect(submitSupportTicket({ ...ticketBaseEvent, supportLevel: 'premium' })).rejects.toThrow('Falha ao enviar ticket de suporte: CreateCase failed'); // Match function error
             expect(mockDynamoUpdate_v2).toHaveBeenCalledWith(expect.objectContaining({ // Check v2 update
                 ExpressionAttributeValues: { ':status': 'SUBMISSION_FAILED', ':error': 'CreateCase failed' }
             }));
         });

        it('should require manual submission for basic plan', async () => {
             await submitSupportTicket({ ...ticketBaseEvent, supportLevel: 'basic' });
             expect(mockSend).not.toHaveBeenCalledWith(expect.objectContaining({ constructor: { name: 'CreateCaseCommand' } })); // Check v3 send NOT called for CreateCase
             expect(mockDynamoUpdate_v2).toHaveBeenCalledWith(expect.objectContaining({ // Check v2 update
                 ExpressionAttributeValues: { ':status': 'MANUAL_ACTION_REQ' } // Check correct status
             }));
         });
     });
});
