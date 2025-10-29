// Define mocks FIRST
const mockDynamoGet = jest.fn();
const mockDynamoPut = jest.fn();
const mockDynamoQuery = jest.fn();
const mockDynamoUpdate = jest.fn(); // <-- Add mock for update
const mockAssumeRole = jest.fn(); // <-- Correct name
const mockS3PutObject = jest.fn();
const mockSupportCreateCase = jest.fn();
// ... other mocks (SecretsManager, S3, Support, CostExplorer) ...
const mockGetCostAndUsage = jest.fn(); // <-- Add mock for CostExplorer

// THEN mock the SDK
jest.mock('aws-sdk', () => ({
  config: { update: jest.fn() },
  DynamoDB: {
    DocumentClient: jest.fn(() => ({
      get: mockDynamoGet,
      put: mockDynamoPut,
      query: mockDynamoQuery,
      update: mockDynamoUpdate // <-- Add update to mock
    }))
  },
  STS: jest.fn(() => ({
     assumeRole: mockAssumeRole // <-- Use correct name
  })),
  CostExplorer: jest.fn(() => ({ // <-- Add CostExplorer mock
     getCostAndUsage: mockGetCostAndUsage
  })),
  S3: jest.fn(() => ({
    putObject: mockS3PutObject
  })),
  Support: jest.fn(() => ({
    createCase: mockSupportCreateCase
  })),
  // ... other services ...
}));



// Reset mocks before each test
beforeEach(() => {
// Reset with default *successful* resolutions unless overridden in a test
mockDynamoGet.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({ Item: { supportLevel: 'premium' } }) });
mockDynamoPut.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
  mockDynamoQuery.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({ Items: [] }) });
  mockDynamoUpdate.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) }); // <-- Reset update
  mockAssumeRole.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({ Credentials: { /* ... */ } }) });
  // Reset CostExplorer mock to return some default cost data
mockGetCostAndUsage.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({ ResultsByTime: [{ Total: { BlendedCost: { Amount: '123.45' } } }] }) });
mockS3PutObject.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) });
mockSupportCreateCase.mockClear().mockReturnValue({ promise: jest.fn().mockResolvedValue({ caseId: 'case-123' }) });
// ... reset other mocks ...
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


    it('should throw an error if assumeRole fails', async () => {
      mockAssumeRole.mockReturnValueOnce({ // <-- Use correct mock name
        promise: jest.fn().mockRejectedValue(new Error('AssumeRole failed'))
      });
      await expect(calculateImpact(baseEvent)).rejects.toThrow('Falha ao assumir role: AssumeRole failed'); // Match error msg in sla-workflow.js
      expect(mockGetCostAndUsage).not.toHaveBeenCalled();
    });

     it('should handle CostExplorer errors', async () => {
         mockGetCostAndUsage.mockReturnValueOnce({
             promise: jest.fn().mockRejectedValue(new Error('CE Error'))
         });
         await expect(calculateImpact(baseEvent)).rejects.toThrow('Falha ao calcular impacto: CE Error'); // Match error
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

       it('should do nothing if there is no violation', async () => {
         const noViolationEvent = { violation: false, credit: 0, /* ... */ };
         const result = await generateReport(noViolationEvent);
         expect(result.claimGenerated).toBe(false); // Check output indicates no claim
         expect(mockDynamoUpdate).toHaveBeenCalledWith(expect.objectContaining({ // Verify status update
             ExpressionAttributeValues: { ':status': 'NO_VIOLATION' }
         }));
         expect(mockS3PutObject).not.toHaveBeenCalled();
         expect(mockDynamoPut).not.toHaveBeenCalled(); // No claim PUT
       });
  });

  describe('submitSupportTicket', () => {
    const ticketBaseEvent = { claimId: 'CLAIM#abc-123', /* ... other required fields */ };

    it('should create a support case and update claim status', async () => {
      await submitSupportTicket({ ...ticketBaseEvent, supportLevel: 'premium' });
      expect(mockSupportCreateCase).toHaveBeenCalled();
      expect(mockDynamoUpdate).toHaveBeenCalledWith(expect.objectContaining({
        ExpressionAttributeValues: { ':status': 'TICKET_SUBMITTED', ':caseId': 'case-123' }
      }));
    });

     it('should handle ticket submission failure', async () => {
       mockSupportCreateCase.mockReturnValueOnce({
         promise: jest.fn().mockRejectedValue(new Error('CreateCase failed'))
       });
       await expect(submitSupportTicket({ ...ticketBaseEvent, supportLevel: 'premium' })).rejects.toThrow('CreateCase failed'); // Check if error is re-thrown
       expect(mockDynamoUpdate).toHaveBeenCalledWith(expect.objectContaining({
         ExpressionAttributeValues: { ':status': 'SUBMISSION_FAILED', ':error': 'CreateCase failed' }
       }));
     });

     it('should require manual submission for basic plan', async () => {
        await submitSupportTicket({ ...ticketBaseEvent, supportLevel: 'basic' });
        expect(mockSupportCreateCase).not.toHaveBeenCalled();
        expect(mockDynamoUpdate).toHaveBeenCalledWith(expect.objectContaining({
            ExpressionAttributeValues: { ':status': 'MANUAL_ACTION_REQ' }
        }));
     });
  });
});
