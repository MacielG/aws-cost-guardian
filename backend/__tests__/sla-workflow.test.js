const { calculateImpact, checkSLA, generateReport, submitSupportTicket } = require('../functions/sla-workflow');

// Mock de todas as dependências externas
jest.mock('@aws-sdk/client-cost-explorer', () => ({
  CostExplorerClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  GetCostAndUsageCommand: jest.fn(),
}));

jest.mock('aws-sdk', () => ({
  STS: jest.fn().mockImplementation(() => ({
    assumeRole: jest.fn().mockReturnThis(),
    promise: jest.fn(),
  })),
  DynamoDB: {
    DocumentClient: jest.fn().mockImplementation(() => ({
      put: jest.fn().mockReturnThis(),
      get: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      promise: jest.fn(),
    })),
  },
  S3: jest.fn().mockImplementation(() => ({
    putObject: jest.fn().mockReturnThis(),
    promise: jest.fn(),
  })),
  Support: jest.fn().mockImplementation(() => ({
    createCase: jest.fn().mockReturnThis(),
    promise: jest.fn(),
  })),
}));

jest.mock('stripe', () => jest.fn().mockImplementation(() => ({
  customers: { create: jest.fn() },
  invoiceItems: { create: jest.fn() },
  invoices: { create: jest.fn() },
})));

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

const { CostExplorerClient } = require('@aws-sdk/client-cost-explorer');
const AWS = require('aws-sdk');
const stripe = require('stripe');

const mockSts = new AWS.STS();
const mockDynamoDb = new AWS.DynamoDB.DocumentClient();
const mockS3 = new AWS.S3();
const mockSupport = new AWS.Support();
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
        resources: ['arn:aws:ec2:us-east-1:111122223333:instance/i-1234567890abcdef0'],
      },
    };

    it('should calculate impacted cost correctly', async () => {
      mockSts.promise.mockResolvedValueOnce({
        Credentials: { AccessKeyId: 'key', SecretAccessKey: 'secret', SessionToken: 'token' },
      });
      mockCostExplorer.send.mockResolvedValueOnce({
        ResultsByTime: [{ Total: { UnblendedCost: { Amount: '15.75' } } }],
      });

      const result = await calculateImpact(baseEvent);

      expect(mockSts.assumeRole).toHaveBeenCalled();
      expect(mockCostExplorer.send).toHaveBeenCalled();
      expect(result.impactedCost).toBe(15.75);
    });

    it('should return 0 cost if no resources are affected', async () => {
      const eventWithoutResources = { ...baseEvent, healthEvent: { ...baseEvent.healthEvent, resources: [] } };
      const result = await calculateImpact(eventWithoutResources);

      expect(mockDynamoDb.update).toHaveBeenCalledWith(expect.objectContaining({
        ExpressionAttributeValues: { ':status': 'NO_RESOURCES_LISTED' },
      }));
      expect(result.impactedCost).toBe(0);
      expect(result.status).toBe('NO_RESOURCES');
    });

    it('should throw an error if assumeRole fails', async () => {
      mockSts.promise.mockRejectedValueOnce(new Error('AssumeRole failed'));
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
      mockDynamoDb.promise.mockResolvedValueOnce({ Item: {} });

      const result = await generateReport(baseEvent);

      expect(mockS3.putObject).toHaveBeenCalled();
      // Não deveria mais criar um cliente ou fatura no Stripe
      expect(mockStripe.customers.create).not.toHaveBeenCalled();
      expect(mockStripe.invoices.create).not.toHaveBeenCalled();
      // Deveria apenas salvar a claim como READY_TO_SUBMIT
      expect(mockDynamoDb.put).toHaveBeenCalledWith(expect.objectContaining({
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

      expect(mockDynamoDb.update).toHaveBeenCalledWith(expect.objectContaining({
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
      mockSts.promise.mockResolvedValueOnce({
        Credentials: { AccessKeyId: 'key', SecretAccessKey: 'secret', SessionToken: 'token' },
      });
      mockSupport.promise.mockResolvedValueOnce({ caseId: 'case-xyz-789' });

      const result = await submitSupportTicket(baseEvent);

      expect(mockSupport.createCase).toHaveBeenCalled();
      expect(mockDynamoDb.update).toHaveBeenCalledWith(expect.objectContaining({
        ExpressionAttributeValues: { ':status': 'SUBMITTED', ':caseId': 'case-xyz-789' },
      }));
      expect(result.status).toBe('submitted');
      expect(result.caseId).toBe('case-xyz-789');
    });

    it('should handle ticket submission failure', async () => {
      mockSts.promise.mockResolvedValueOnce({
        Credentials: { AccessKeyId: 'key', SecretAccessKey: 'secret', SessionToken: 'token' },
      });
      mockSupport.promise.mockRejectedValueOnce(new Error('CreateCase failed'));

      await expect(submitSupportTicket(baseEvent)).rejects.toThrow('CreateCase failed');
      expect(mockDynamoDb.update).toHaveBeenCalledWith(expect.objectContaining({
        ExpressionAttributeValues: { ':status': 'SUBMISSION_FAILED', ':error': 'CreateCase failed' },
      }));
    });
  });
});
