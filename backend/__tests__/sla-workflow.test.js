const { calculateImpact, checkSLA, generateReport, submitSupportTicket } = require('../functions/sla-workflow');

// Primeiro, declare todos os mocks antes de qualquer jest.mock
const mockStsAssumeRole = jest.fn();
const mockDynamoGet = jest.fn();
const mockDynamoPut = jest.fn();
const mockDynamoUpdate = jest.fn();
const mockDynamoQuery = jest.fn();
const mockS3PutObject = jest.fn();
const mockSupportCreateCase = jest.fn();

// Mock AWS SDK com simulações de falha de rede e timeout
const mockNetworkError = new Error('Network Error');
mockNetworkError.code = 'NetworkingError';

const mockTimeout = new Error('TimeoutError');
mockTimeout.code = 'TimeoutError';

// Mock Cost Explorer com cenários de erro
const mockCostExplorerWithRetry = jest.fn()
  .mockRejectedValueOnce(mockNetworkError)  // Primeira chamada falha
  .mockRejectedValueOnce(mockTimeout)       // Segunda chamada timeout
  .mockResolvedValueOnce({                  // Terceira chamada sucesso
    ResultsByTime: [{ Total: { UnblendedCost: { Amount: '15.75' } } }],
  });

jest.mock('@aws-sdk/client-cost-explorer', () => ({
  CostExplorerClient: jest.fn().mockImplementation(() => ({
    send: mockCostExplorerWithRetry,
  })),
  GetCostAndUsageCommand: jest.fn(),
}));

// Mock AWS SDK com retry logic
jest.mock('aws-sdk', () => ({
  STS: jest.fn().mockImplementation(() => ({
    assumeRole: mockStsAssumeRole.mockReturnValue({
      promise: jest.fn().mockResolvedValue({
        Credentials: {
          AccessKeyId: 'test-key',
          SecretAccessKey: 'test-secret',
          SessionToken: 'test-token'
        }
      })
    }),
  })),
  DynamoDB: {
    DocumentClient: jest.fn().mockImplementation(() => ({
      get: mockDynamoGet.mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Item: { supportLevel: 'premium' } })
      }),
      put: mockDynamoPut.mockReturnValue({
        promise: jest.fn().mockResolvedValue({})
      }),
      update: mockDynamoUpdate.mockReturnValue({
      promise: jest.fn().mockResolvedValue({})
      }),
      query: mockDynamoQuery.mockReturnValue({
      promise: jest.fn().mockResolvedValue({ Items: [] })
      }),
    })),
  },
  S3: jest.fn().mockImplementation(() => ({
    putObject: mockS3PutObject.mockReturnValue({
      promise: jest.fn().mockResolvedValue({})
    }),
  })),
  Support: jest.fn().mockImplementation(() => ({
    createCase: mockSupportCreateCase.mockReturnValue({
      promise: jest.fn().mockResolvedValue({ caseId: 'test-case-id' })
    }),
  })),
  StepFunctions: jest.fn().mockImplementation(() => ({
    startExecution: jest.fn().mockReturnValue({
      promise: jest.fn().mockResolvedValue({})
    }),
  })),
}));

// Mock Cost Explorer
jest.mock('@aws-sdk/client-cost-explorer', () => ({
  CostExplorerClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({
      ResultsByTime: [{ Total: { UnblendedCost: { Amount: '15.75' } } }],
    }),
  })),
  GetCostAndUsageCommand: jest.fn(),
}));

// Mock Stripe
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({
  customers: { create: jest.fn() },
  invoiceItems: { create: jest.fn() },
  invoices: { create: jest.fn() },
})));

// Mock PDF-lib
jest.mock('pdf-lib', () => ({
  PDFDocument: {
    create: jest.fn().mockResolvedValue({
      addPage: jest.fn().mockReturnValue({
        getSize: jest.fn().mockReturnValue({ width: 600, height: 800 }),
        drawText: jest.fn(),
      }),
      embedFont: jest.fn().mockResolvedValue({
        heightAtSize: jest.fn().mockReturnValue(12),
      }),
      save: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }),
  },
  StandardFonts: {
    Helvetica: 'Helvetica',
  },
  rgb: jest.fn(),
}));

// Mock process.env
process.env.DYNAMODB_TABLE = 'test-table';
process.env.STRIPE_SECRET_KEY = 'test-key';

const { CostExplorerClient } = require('@aws-sdk/client-cost-explorer');
const AWS = require('aws-sdk');
const stripe = require('stripe');

// Create mock instances
const mockSts = new AWS.STS();
const mockDynamoDb = new AWS.DynamoDB.DocumentClient();
const mockS3 = new AWS.S3();
const mockSupport = new AWS.Support();
const mockStepFunctions = new AWS.StepFunctions();
const mockCostExplorer = new CostExplorerClient();
const mockStripe = new stripe();

describe('SLA Workflow Functions', () => {
  beforeEach(() => {
    // Limpa todos os mocks antes de cada teste
    jest.clearAllMocks();
  });

  // --- Testes para calculateImpact ---
  describe('calculateImpact', () => {
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

    it('should calculate impacted cost correctly', async () => {
      const result = await calculateImpact(baseEvent);

      expect(mockStsAssumeRole).toHaveBeenCalled();
      expect(mockCostExplorer.send).toHaveBeenCalled();
      expect(result.impactedCost).toBe(15.75);
    });

    it('should return 0 cost if no resources are affected', async () => {
      const eventWithoutResources = { ...baseEvent, healthEvent: { ...baseEvent.healthEvent, resources: [] } };
      const result = await calculateImpact(eventWithoutResources);

      expect(mockDynamoUpdate).toHaveBeenCalledWith(expect.objectContaining({
        ExpressionAttributeValues: { ':status': 'NO_RESOURCES_LISTED' },
      }));
      expect(result.impactedCost).toBe(0);
      expect(result.status).toBe('NO_RESOURCES');
    });

    it('should use basic support level if not configured', async () => {
      // Temporarily change the mock to return no Item
      mockDynamoGet.mockReturnValueOnce({
        promise: jest.fn().mockResolvedValue({}) // No Item
      });

      const result = await calculateImpact(baseEvent);

      expect(result.supportLevel).toBe('basic');
    });

    it('should throw an error if assumeRole fails', async () => {
      mockStsAssumeRole.mockReturnValueOnce({
        promise: jest.fn().mockRejectedValue(new Error('AssumeRole failed'))
      });
      await expect(calculateImpact(baseEvent)).rejects.toThrow('AssumeRole failed');
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

  // --- Testes para generateReport ---
  describe('generateReport', () => {
    const baseEvent = {
      violation: true,
      credit: 25,
      customerId: 'cust-123',
      incidentId: 'INCIDENT#abc-123',
      awsAccountId: '111122223333',
      healthEvent: { service: 'RDS' },
      durationMinutes: 150,
      impactedCost: 250,
    };

    it('should generate report and save claim without generating Stripe invoice', async () => {
      process.env.REPORTS_BUCKET_NAME = 'test-bucket';
      // Temporarily change the mock to return an Item with subscription status
      mockDynamoDb.get.mockReturnValueOnce({
        promise: jest.fn().mockResolvedValue({ Item: { subscriptionStatus: 'active' } })
      });

      const result = await generateReport(baseEvent);

      expect(mockS3PutObject).toHaveBeenCalled();
      // Não deveria mais criar um cliente ou fatura no Stripe
      expect(mockStripe.customers.create).not.toHaveBeenCalled();
      expect(mockStripe.invoices.create).not.toHaveBeenCalled();
      // Deveria apenas salvar a claim como READY_TO_SUBMIT
      expect(mockDynamoPut).toHaveBeenCalledWith(expect.objectContaining({
        Item: expect.objectContaining({
          status: 'READY_TO_SUBMIT',
          stripeInvoiceId: null,
          entityType: 'CLAIM',
          createdAt: expect.any(String),
        }),
      }));
      expect(result.status).toBe('generated');
      expect(result.claimId).toBe('CLAIM#abc-123');
    });

    it('should do nothing if there is no violation', async () => {
      const eventNoViolation = { ...baseEvent, violation: false };
      const result = await generateReport(eventNoViolation);

      expect(mockDynamoUpdate).toHaveBeenCalledWith(expect.objectContaining({
        ExpressionAttributeValues: { ':status': 'NO_VIOLATION' },
      }));
      expect(result.status).toBe('no-claim');
    });
  });

  // --- Testes para submitSupportTicket ---
  describe('submitSupportTicket', () => {
    const baseEvent = {
      claimId: 'CLAIM#abc-123',
      customerId: 'cust-123',
      awsAccountId: '111122223333',
      credit: 25,
      durationMinutes: 150,
      healthEvent: { service: 'EC2', eventArn: 'arn:event', startTime: '2023-10-26T10:00:00Z', resources: ['i-123'] },
    };

    it('should create a support case and update claim status', async () => {
      const result = await submitSupportTicket({ ...baseEvent, supportLevel: 'premium' });

      expect(mockSupportCreateCase).toHaveBeenCalled();
      expect(mockDynamoUpdate).toHaveBeenCalledWith(expect.objectContaining({
        ExpressionAttributeValues: { ':status': 'SUBMITTED', ':caseId': 'test-case-id' },
      }));
      expect(result.status).toBe('submitted');
      expect(result.caseId).toBe('test-case-id');
    });

    it('should handle ticket submission failure', async () => {
      // Temporarily change the mock to reject
      mockSupportCreateCase.mockReturnValueOnce({
        promise: jest.fn().mockRejectedValue(new Error('CreateCase failed'))
      });

      await expect(submitSupportTicket({ ...baseEvent, supportLevel: 'premium' })).rejects.toThrow('CreateCase failed');
      expect(mockDynamoUpdate).toHaveBeenCalledWith(expect.objectContaining({
        ExpressionAttributeValues: { ':status': 'SUBMISSION_FAILED', ':error': 'CreateCase failed' },
      }));
    });

    it('should require manual submission for basic plan', async () => {
      const result = await submitSupportTicket({ ...baseEvent, supportLevel: 'basic' });

      expect(mockSupportCreateCase).not.toHaveBeenCalled();
      expect(mockDynamoUpdate).toHaveBeenCalledWith(expect.objectContaining({
        ExpressionAttributeValues: { ':status': 'PENDING_MANUAL_SUBMISSION' },
      }));
      expect(result.status).toBe('manual-submission-required');
    });
  });
});
