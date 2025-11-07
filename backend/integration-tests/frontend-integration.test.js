// Integration test for Frontend-Backend integration
// Tests API endpoints that the frontend calls

const axios = require('axios');

// Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod';

describe('Frontend-Backend Integration', () => {
  describe('Public Endpoints', () => {
    test('GET /health - should return health status', async () => {
      const response = await axios.get(`${API_BASE_URL}/health`);
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('status', 'ok');
      expect(response.data).toHaveProperty('timestamp');
      expect(response.data).toHaveProperty('environment');
    });

    test('GET /api/health - should return detailed health status', async () => {
      const response = await axios.get(`${API_BASE_URL}/api/health`);
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('status', 'ok');
      expect(response.data).toHaveProperty('timestamp');
      expect(response.data).toHaveProperty('cors');
      expect(response.data).toHaveProperty('environment');
    });
  });

  describe('Protected Endpoints (without auth)', () => {
    test('GET /admin/metrics - should require authentication', async () => {
      try {
        await axios.get(`${API_BASE_URL}/admin/metrics`);
        fail('Should have thrown 401 error');
      } catch (error) {
        expect(error.response.status).toBe(401);
        expect(error.response.data).toHaveProperty('message', 'Não autenticado');
      }
    });

    test('GET /admin/settings - should require authentication', async () => {
      try {
        await axios.get(`${API_BASE_URL}/admin/settings`);
        fail('Should have thrown 401 error');
      } catch (error) {
        expect(error.response.status).toBe(401);
      }
    });

    test('GET /onboard-init - should require authentication', async () => {
      try {
        await axios.get(`${API_BASE_URL}/onboard-init`);
        fail('Should have thrown 401 error');
      } catch (error) {
        expect(error.response.status).toBe(401);
      }
    });

    test('GET /recommendations - should require authentication', async () => {
      try {
        await axios.get(`${API_BASE_URL}/recommendations`);
        fail('Should have thrown 401 error');
      } catch (error) {
        expect(error.response.status).toBe(401);
      }
    });
  });

  describe('CORS Configuration', () => {
    test('OPTIONS /admin/metrics - should allow CORS', async () => {
      const response = await axios.options(`${API_BASE_URL}/admin/metrics`, {
        headers: {
          'Origin': 'https://awscostguardian.com',
          'Access-Control-Request-Method': 'GET',
        }
      });
      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('https://awscostguardian.com');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });
  });
});

// Helper function for tests
function fail(message) {
  throw new Error(message);
}
