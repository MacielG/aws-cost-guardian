/**
 * Unit Tests for Cost Guardian Handler
 */

const { handler } = require('../handler-simple');

// Mock AWS SDK calls
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(),
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
  QueryCommand: jest.fn(),
  UpdateCommand: jest.fn()
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({
      send: jest.fn()
    }))
  },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
  QueryCommand: jest.fn(),
  UpdateCommand: jest.fn()
}));

describe('Cost Guardian Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Health Endpoints', () => {
    test('GET /health returns 200', async () => {
      const event = {
        path: '/health',
        httpMethod: 'GET',
        headers: { origin: 'http://localhost:3000' }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toHaveProperty('status', 'ok');
      expect(result.headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
    });

    test('GET /api/health returns 200', async () => {
      const event = {
        path: '/api/health',
        httpMethod: 'GET',
        headers: {}
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toHaveProperty('status', 'ok');
    });

    test('GET /api/public/metrics returns metrics', async () => {
      const event = {
        path: '/api/public/metrics',
        httpMethod: 'GET'
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('status', 'ok');
      expect(body).toHaveProperty('version', '2.0.0');
      expect(body).toHaveProperty('service', 'aws-cost-guardian-backend');
      expect(body).toHaveProperty('metrics');
    });
  });

  describe('CORS Handling', () => {
    test('OPTIONS request returns 204', async () => {
      const event = {
        path: '/api/onboard-init',
        httpMethod: 'OPTIONS',
        headers: { origin: 'https://awscostguardian.com' }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(204);
      expect(result.headers['Access-Control-Allow-Origin']).toBe('https://awscostguardian.com');
      expect(result.headers['Access-Control-Allow-Methods']).toBe('GET, POST, PUT, DELETE, OPTIONS');
    });

    test('Unknown origin gets wildcard CORS', async () => {
      const event = {
        path: '/health',
        httpMethod: 'GET',
        headers: { origin: 'https://unknown-site.com' }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
    });
  });

  describe('Authentication', () => {
    test('Protected endpoints return 401 without auth', async () => {
      const event = {
        path: '/api/onboard-init',
        httpMethod: 'GET',
        headers: {}
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body)).toHaveProperty('message', 'Não autenticado');
    });

    test('Invalid JWT returns 401', async () => {
      const event = {
        path: '/api/onboard-init',
        httpMethod: 'GET',
        headers: {
          Authorization: 'Bearer invalid.jwt.token'
        }
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
    });
  });

  describe('Error Handling', () => {
    test('Unknown endpoint returns 404', async () => {
      const event = {
        path: '/unknown-endpoint',
        httpMethod: 'GET'
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body)).toHaveProperty('error', 'Not found');
    });

    test('Unhandled errors return 500', async () => {
      // Force an error by passing malformed event
      const event = null;

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(result.headers['Content-Type']).toBe('application/json');
    });
  });

  describe('Path Handling', () => {
    test('Handles trailing slashes correctly', async () => {
      const event = {
        path: '/health/',
        httpMethod: 'GET'
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
    });

    test('Handles query parameters', async () => {
      const event = {
        path: '/api/onboard-init',
        httpMethod: 'GET',
        queryStringParameters: { mode: 'trial' }
      };

      // This will return 401 due to no auth, but should handle query params
      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      expect(result.headers['Content-Type']).toBe('application/json');
    });
  });

  describe('HTTP Methods', () => {
    test('Supports GET method', async () => {
      const event = {
        path: '/health',
        httpMethod: 'GET'
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
    });

    test('Supports POST method for appropriate endpoints', async () => {
      const event = {
        path: '/admin/promotions',
        httpMethod: 'POST',
        headers: {},
        body: JSON.stringify({
          name: 'Test Promotion',
          discountType: 'percentage',
          discountValue: 10
        })
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(401); // Auth required, but method accepted
    });

    test('Supports PUT method', async () => {
      const event = {
        path: '/settings/automation',
        httpMethod: 'PUT',
        headers: {}
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(401); // Auth required
    });
  });
});
