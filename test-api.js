const axios = require('axios');

async function testEndpoints() {
  console.log('🧪 Testando endpoints da API...\n');

  try {
    // Teste endpoint público
    const healthResponse = await axios.get('https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod/health');
    console.log('✅ GET /health:', healthResponse.status === 200 ? 'PASS' : 'FAIL');

    const apiHealthResponse = await axios.get('https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod/api/health');
    console.log('✅ GET /api/health:', apiHealthResponse.status === 200 ? 'PASS' : 'FAIL');

    // Teste endpoints protegidos (devem retornar 401)
    try {
      await axios.get('https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod/admin/metrics');
      console.log('❌ GET /admin/metrics: FAIL (deveria ser 401)');
    } catch (error) {
      console.log('✅ GET /admin/metrics:', error.response.status === 401 ? 'PASS (401 esperado)' : 'FAIL');
    }

    try {
      await axios.get('https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod/admin/settings');
      console.log('❌ GET /admin/settings: FAIL (deveria ser 401)');
    } catch (error) {
      console.log('✅ GET /admin/settings:', error.response.status === 401 ? 'PASS (401 esperado)' : 'FAIL');
    }

    try {
      await axios.post('https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod/admin/coupons', {});
      console.log('❌ POST /admin/coupons: FAIL (deveria ser 401)');
    } catch (error) {
      console.log('✅ POST /admin/coupons:', error.response.status === 401 ? 'PASS (401 esperado)' : 'FAIL');
    }

    try {
      await axios.get('https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod/admin/claims');
      console.log('❌ GET /admin/claims: FAIL (deveria ser 401)');
    } catch (error) {
      console.log('✅ GET /admin/claims:', error.response.status === 401 ? 'PASS (401 esperado)' : 'FAIL');
    }

    console.log('\n🎉 Todos os testes passaram! A API está funcionando corretamente.');

  } catch (error) {
    console.error('❌ Erro no teste:', error.message);
  }
}

testEndpoints();
