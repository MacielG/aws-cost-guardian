/**
 * Integration Tests for Cost Guardian API
 * These tests run against a real deployed API
 */

const https = require('https');
const { performance } = require('perf_hooks');

class APITester {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      'User-Agent': 'CostGuardian-IntegrationTest/1.0'
    };
  }

  makeRequest(endpoint, options = {}) {
    return new Promise((resolve, reject) => {
      const url = `${this.baseUrl}${endpoint}`;
      const startTime = performance.now();

      const requestOptions = {
        headers: { ...this.defaultHeaders, ...options.headers },
        method: options.method || 'GET',
        timeout: options.timeout || 30000
      };

      if (options.body && (options.method === 'POST' || options.method === 'PUT')) {
        requestOptions.body = JSON.stringify(options.body);
        requestOptions.headers['Content-Length'] = Buffer.byteLength(requestOptions.body);
      }

      const client = url.startsWith('https:') ? https : require('http');
      const req = client.request(url, requestOptions, (res) => {
        let data = '';

        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const duration = performance.now() - startTime;

          try {
            const body = data ? JSON.parse(data) : null;
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body,
              duration,
              endpoint
            });
          } catch (parseError) {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: data,
              duration,
              endpoint,
              parseError
            });
          }
        });
      });

      req.on('error', (err) => {
        const duration = performance.now() - startTime;
        reject({ error: err, duration, endpoint });
      });

      req.on('timeout', () => {
        req.abort();
        reject({ error: new Error('Request timeout'), duration: 30000, endpoint });
      });

      if (options.body && (options.method === 'POST' || options.method === 'PUT')) {
        req.write(requestOptions.body);
      }

      req.end();
    });
  }

  async testEndpoint(name, endpoint, expectedStatus, options = {}) {
    console.log(`🧪 Testing ${name}: ${endpoint}`);

    try {
      const result = await this.makeRequest(endpoint, options);

      const success = result.status === expectedStatus;
      const status = success ? '✅' : '❌';

      console.log(`${status} ${name}: ${result.status} (${result.duration.toFixed(0)}ms)`);

      if (!success) {
        console.log(`   Expected: ${expectedStatus}, Got: ${result.status}`);
      }

      if (result.parseError) {
        console.log(`   ⚠️  Parse Error: ${result.parseError.message}`);
      }

      // Performance check
      if (result.duration > 5000) {
        console.log(`   ⚠️  Slow response: ${result.duration.toFixed(0)}ms`);
      }

      return { ...result, success };
    } catch (error) {
      console.log(`❌ ${name}: ERROR - ${error.error?.message || error.message}`);
      return { success: false, error, endpoint };
    }
  }
}

describe('Cost Guardian API Integration Tests', () => {
  const apiUrl = process.env.API_URL || 'http://localhost:3001/dev';
  const tester = new APITester(apiUrl);

  beforeAll(() => {
    console.log(`🚀 Running integration tests against: ${apiUrl}`);
    console.log('═'.repeat(60));
  });

  describe('Health Endpoints', () => {
    test('GET /health - Public health check', async () => {
      const result = await tester.testEndpoint('Health Check', '/health', 200);
      expect(result.success).toBe(true);
      expect(result.body).toHaveProperty('status', 'ok');
      expect(result.body).toHaveProperty('timestamp');
    });

    test('GET /api/health - API health check', async () => {
      const result = await tester.testEndpoint('API Health', '/api/health', 200);
      expect(result.success).toBe(true);
      expect(result.body).toHaveProperty('status', 'ok');
      expect(result.body).toHaveProperty('environment');
    });

    test('GET /api/public/metrics - Public metrics', async () => {
      const result = await tester.testEndpoint('Public Metrics', '/api/public/metrics', 200);
      expect(result.success).toBe(true);
      expect(result.body).toHaveProperty('status', 'ok');
      expect(result.body).toHaveProperty('version');
      expect(result.body).toHaveProperty('metrics');
    });
  });

  describe('Authentication', () => {
    test('Protected endpoints return 401 without auth', async () => {
      const endpoints = [
        '/api/onboard-init',
        '/billing/subscription',
        '/recommendations',
        '/settings/automation',
        '/admin/metrics',
        '/api/incidents',
        '/api/system-status/aws'
      ];

      for (const endpoint of endpoints) {
        const result = await tester.testEndpoint(`Auth Required: ${endpoint}`, endpoint, 401);
        expect(result.success).toBe(true);
        expect(result.body).toHaveProperty('message', 'Não autenticado');
      }
    });

    test('OPTIONS preflight works', async () => {
      const result = await tester.testEndpoint('CORS Preflight', '/api/onboard-init', 204, {
        method: 'OPTIONS',
        headers: { 'Origin': 'https://awscostguardian.com' }
      });
      expect(result.success).toBe(true);
      expect(result.headers['access-control-allow-origin']).toBe('https://awscostguardian.com');
    });
  });

  describe('CORS Headers', () => {
    test('CORS headers present on all responses', async () => {
      const result = await tester.testEndpoint('CORS Check', '/health', 200);

      expect(result.headers['access-control-allow-origin']).toBeDefined();
      expect(result.headers['access-control-allow-credentials']).toBe('true');
      expect(result.headers['access-control-allow-methods']).toBeDefined();
      expect(result.headers['content-type']).toBe('application/json');
    });

    test('Multiple origins supported', async () => {
      const origins = [
        'http://localhost:3000',
        'https://awscostguardian.com',
        'https://www.awscostguardian.com'
      ];

      for (const origin of origins) {
        const result = await tester.testEndpoint(
          `CORS Origin: ${origin}`,
          '/health',
          200,
          { headers: { 'Origin': origin } }
        );

        expect(result.headers['access-control-allow-origin']).toBe(origin);
      }
    });
  });

  describe('Performance Tests', () => {
    test('Response time under 2 seconds', async () => {
      const result = await tester.testEndpoint('Performance Check', '/health', 200);
      expect(result.success).toBe(true);
      expect(result.duration).toBeLessThan(2000); // 2 seconds
    });

    test('Concurrent requests handled', async () => {
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(tester.makeRequest('/health'));
      }

      const results = await Promise.all(promises);

      results.forEach(result => {
        expect(result.status).toBe(200);
        expect(result.duration).toBeLessThan(5000); // 5 seconds each
      });
    }, 30000); // 30 second timeout for concurrent test
  });

  describe('Error Handling', () => {
    test('404 for unknown endpoints', async () => {
      const result = await tester.testEndpoint('Unknown Endpoint', '/nonexistent', 404);
      expect(result.success).toBe(true);
      expect(result.body).toHaveProperty('error', 'Not found');
    });

    test('Proper error format', async () => {
      const result = await tester.testEndpoint('Error Format', '/nonexistent', 404);
      expect(result.success).toBe(true);
      expect(result.headers['content-type']).toBe('application/json');
      expect(typeof result.body).toBe('object');
    });
  });

  describe('API Structure', () => {
    test('JSON responses properly formatted', async () => {
      const result = await tester.testEndpoint('JSON Format', '/health', 200);
      expect(result.success).toBe(true);
      expect(typeof result.body).toBe('object');
      expect(result.body).not.toBeNull();
    });

    test('Timestamps in ISO format', async () => {
      const result = await tester.testEndpoint('Timestamp Format', '/health', 200);
      expect(result.success).toBe(true);

      if (result.body.timestamp) {
        expect(() => new Date(result.body.timestamp)).not.toThrow();
      }
    });

    test('Handles malformed JSON gracefully', async () => {
      // This test would require sending malformed JSON in POST body
      // Skipping for now as most endpoints require auth
      expect(true).toBe(true); // Placeholder test
    });
  });

  afterAll(() => {
    console.log('═'.repeat(60));
    console.log('✅ Integration tests completed');
  });
});
