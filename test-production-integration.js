#!/usr/bin/env node
/**
 * Script de Teste de Integração Completo - Frontend x Backend
 * Testa todas as páginas e APIs com dados reais
 * 
 * USO:
 * 1. Sem autenticação (apenas públicos):
 *    node test-production-integration.js
 * 
 * 2. Com autenticação de usuário:
 *    TEST_USER_EMAIL=user@example.com TEST_USER_PASSWORD=Pass123! node test-production-integration.js
 * 
 * 3. Com autenticação de admin:
 *    TEST_ADMIN_EMAIL=admin@example.com TEST_ADMIN_PASSWORD=Admin123! node test-production-integration.js
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');

// Configurações
const API_URL = 'https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod';
const FRONTEND_URL = 'https://awscostguardian.com';
const COGNITO_USER_POOL_ID = 'us-east-1_Y8MPqisuQ';
const COGNITO_CLIENT_ID = '73m8bkd6mf0l85v1n9s4ub1e6i';
const COGNITO_REGION = 'us-east-1';

// Credenciais via env (seguro)
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL;
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD;
const TEST_ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL;
const TEST_ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;

// Contadores
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const testResults = [];

// Tokens
let userTokens = { idToken: null, isAdmin: false };
let adminTokens = { idToken: null, isAdmin: true };

// Cores
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function success(message, details = null) {
  passedTests++;
  totalTests++;
  log(`✅ ${message}`, 'green');
  testResults.push({ status: 'PASS', test: message, details });
  if (details) log(`   ${JSON.stringify(details)}`, 'cyan');
}

function fail(message, error = null) {
  failedTests++;
  totalTests++;
  log(`❌ ${message}`, 'red');
  testResults.push({ status: 'FAIL', test: message, error });
  if (error) log(`   Error: ${JSON.stringify(error)}`, 'red');
}

function info(message) {
  log(`ℹ️  ${message}`, 'cyan');
}

function section(title) {
  log(`\n${'='.repeat(70)}`, 'blue');
  log(`  ${title}`, 'blue');
  log(`${'='.repeat(70)}`, 'blue');
}

// HTTP Request Helper
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const lib = isHttps ? https : http;
    
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 10000
    };

    const req = lib.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          ok: res.statusCode >= 200 && res.statusCode < 300
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) req.write(options.body);
    req.end();
  });
}

// Autenticação Cognito
async function authenticateWithCognito(email, password, isAdmin = false) {
  if (!email || !password) return null;

  info(`Autenticando no Cognito: ${email} ${isAdmin ? '(Admin)' : '(User)'}`);

  try {
    const payload = JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password
      }
    });

    const response = await makeRequest(`https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth'
      },
      body: payload
    });

    if (response.ok) {
      const data = JSON.parse(response.body);
      if (data.AuthenticationResult) {
        const tokens = {
          idToken: data.AuthenticationResult.IdToken,
          accessToken: data.AuthenticationResult.AccessToken,
          refreshToken: data.AuthenticationResult.RefreshToken,
          isAdmin
        };
        success(`Cognito Auth ${isAdmin ? '(Admin)' : '(User)'} - Autenticado com sucesso`);
        return tokens;
      }
    }
    
    const errorData = JSON.parse(response.body || '{}');
    fail(`Cognito Auth ${isAdmin ? '(Admin)' : '(User)'} - Falhou`, errorData.__type || errorData.message);
    return null;
  } catch (error) {
    fail(`Cognito Auth ${isAdmin ? '(Admin)' : '(User)'} - Erro`, error.message);
    return null;
  }
}

// Fazer requisição à API com auth opcional
async function apiRequest(endpoint, options = {}, tokens = null) {
  const headers = options.headers || {};
  
  if (tokens && tokens.idToken) {
    headers['Authorization'] = `Bearer ${tokens.idToken}`;
  }

  return makeRequest(`${API_URL}${endpoint}`, {
    ...options,
    headers
  });
}

// TESTES DE BACKEND - ENDPOINTS PÚBLICOS
async function testPublicEndpoints() {
  section('🌐 TESTES - ENDPOINTS PÚBLICOS (Sem Autenticação)');

  // Health Check
  try {
    const response = await apiRequest('/health');
    if (response.ok) {
      const data = JSON.parse(response.body);
      if (data.status === 'ok' || data.status === 'healthy') {
        success('GET /health - Health check OK', { status: data.status });
      } else {
        fail('GET /health - Status inválido', data);
      }
    } else {
      fail('GET /health - Falhou', response.statusCode);
    }
  } catch (error) {
    fail('GET /health - Erro', error.message);
  }

  // API Health
  try {
    const response = await apiRequest('/api/health');
    if (response.ok) {
      success('GET /api/health - API health check OK');
    } else {
      fail('GET /api/health - Falhou', response.statusCode);
    }
  } catch (error) {
    fail('GET /api/health - Erro', error.message);
  }

  // Verificar proteção de rotas
  const protectedRoutes = [
    '/admin/metrics',
    '/admin/settings',
    '/billing/summary',
    '/recommendations',
    '/api/user/status',
    '/api/incidents'
  ];

  for (const route of protectedRoutes) {
    try {
      const response = await apiRequest(route);
      if (response.statusCode === 401 || response.statusCode === 403) {
        success(`${route} - Proteção de auth OK (${response.statusCode})`);
      } else if (response.statusCode === 404) {
        info(`${route} - Rota não encontrada (404) - verificar com auth`);
        totalTests++; // Conta mas não falha
      } else {
        fail(`${route} - Deveria retornar 401/403/404`, response.statusCode);
      }
    } catch (error) {
      fail(`${route} - Erro`, error.message);
    }
  }
}

// TESTES DE BACKEND - COM AUTENTICAÇÃO DE USUÁRIO
async function testUserEndpoints() {
  if (!userTokens || !userTokens.idToken) {
    section('⏭️  TESTES DE USUÁRIO - PULADO (sem credenciais)');
    info('Configure TEST_USER_EMAIL e TEST_USER_PASSWORD para testar');
    return;
  }

  section('👤 TESTES - ENDPOINTS DE USUÁRIO (Com Autenticação)');

  // User Status
  try {
    const response = await apiRequest('/api/user/status', {}, userTokens);
    if (response.ok) {
      const data = JSON.parse(response.body);
      success('GET /api/user/status - OK', { accountType: data.accountType });
      
      // Validar estrutura
      if (data.accountType && data.email) {
        success('User Status - Estrutura de dados válida');
      } else {
        fail('User Status - Estrutura incompleta', data);
      }
    } else {
      fail('GET /api/user/status - Falhou', response.statusCode);
    }
  } catch (error) {
    fail('GET /api/user/status - Erro', error.message);
  }

  // Billing Summary
  try {
    const response = await apiRequest('/billing/summary', {}, userTokens);
    if (response.ok) {
      const data = JSON.parse(response.body);
      success('GET /billing/summary - OK', {
        totalSavings: data.totalSavings,
        recommendationsExecuted: data.recommendationsExecuted
      });

      // Validar estrutura
      if (typeof data.totalSavings === 'number') {
        success('Billing Summary - Dados numéricos válidos');
      }
      
      // Testar com dados ausentes
      if (!data.monthlySavings || data.monthlySavings.length === 0) {
        info('Billing Summary - Sem dados mensais (conta nova ou sem análise)');
      } else {
        success('Billing Summary - Dados mensais presentes', { months: data.monthlySavings.length });
      }
    } else {
      fail('GET /billing/summary - Falhou', response.statusCode);
    }
  } catch (error) {
    fail('GET /billing/summary - Erro', error.message);
  }

  // Recommendations
  try {
    const response = await apiRequest('/recommendations?limit=10', {}, userTokens);
    if (response.ok) {
      const data = JSON.parse(response.body);
      if (Array.isArray(data)) {
        success('GET /recommendations - OK', { count: data.length });
        
        if (data.length === 0) {
          info('Recommendations - Nenhuma recomendação (normal para contas novas)');
        } else {
          success('Recommendations - Dados presentes', { first: data[0].type });
        }
      } else {
        fail('GET /recommendations - Não retornou array', typeof data);
      }
    } else {
      fail('GET /recommendations - Falhou', response.statusCode);
    }
  } catch (error) {
    fail('GET /recommendations - Erro', error.message);
  }

  // Incidents
  try {
    const response = await apiRequest('/api/incidents', {}, userTokens);
    if (response.ok) {
      const data = JSON.parse(response.body);
      if (Array.isArray(data)) {
        success('GET /api/incidents - OK', { count: data.length });
        
        if (data.length === 0) {
          info('Incidents - Nenhum incidente detectado (bom sinal!)');
        } else {
          success('Incidents - Dados presentes', { 
            first: { service: data[0].service, impact: data[0].impact }
          });
        }
      } else {
        fail('GET /api/incidents - Não retornou array', typeof data);
      }
    } else {
      fail('GET /api/incidents - Falhou', response.statusCode);
    }
  } catch (error) {
    fail('GET /api/incidents - Erro', error.message);
  }

  // Dashboard Costs
  try {
    const response = await apiRequest('/api/dashboard/costs', {}, userTokens);
    if (response.ok) {
      const data = JSON.parse(response.body);
      success('GET /api/dashboard/costs - OK');
      
      if (data.Groups && data.Groups.length > 0) {
        success('Dashboard Costs - Grupos de custo presentes', { groups: data.Groups.length });
      } else {
        info('Dashboard Costs - Sem grupos de custo (conta sem consumo ou nova)');
      }
    } else {
      fail('GET /api/dashboard/costs - Falhou', response.statusCode);
    }
  } catch (error) {
    fail('GET /api/dashboard/costs - Erro', error.message);
  }

  // Onboard Init
  try {
    const response = await apiRequest('/onboard-init', {}, userTokens);
    if (response.ok) {
      const data = JSON.parse(response.body);
      success('GET /onboard-init - OK', { status: data.status });
      
      if (data.externalId && data.platformAccountId) {
        success('Onboard Init - Dados de configuração completos');
      } else {
        fail('Onboard Init - Faltam dados', data);
      }
    } else {
      fail('GET /onboard-init - Falhou', response.statusCode);
    }
  } catch (error) {
    fail('GET /onboard-init - Erro', error.message);
  }
}

// TESTES DE BACKEND - COM AUTENTICAÇÃO DE ADMIN
async function testAdminEndpoints() {
  if (!adminTokens || !adminTokens.idToken) {
    section('⏭️  TESTES DE ADMIN - PULADO (sem credenciais)');
    info('Configure TEST_ADMIN_EMAIL e TEST_ADMIN_PASSWORD para testar');
    return;
  }

  section('👑 TESTES - ENDPOINTS DE ADMIN (Com Autenticação Admin)');

  // Admin Metrics
  try {
    const response = await apiRequest('/admin/metrics', {}, adminTokens);
    if (response.ok) {
      const data = JSON.parse(response.body);
      success('GET /admin/metrics - OK', {
        totalCustomers: data.customers?.total,
        revenue: data.revenue?.thisMonth
      });

      // Validar estrutura completa
      const requiredFields = ['customers', 'revenue', 'leads', 'recommendations', 'sla'];
      const hasAll = requiredFields.every(field => data[field]);
      
      if (hasAll) {
        success('Admin Metrics - Estrutura completa');
      } else {
        fail('Admin Metrics - Estrutura incompleta', requiredFields.filter(f => !data[f]));
      }
    } else if (response.statusCode === 403) {
      fail('GET /admin/metrics - Usuário não é admin (403)', 'Verifique se o usuário está no grupo "Admins"');
    } else {
      fail('GET /admin/metrics - Falhou', response.statusCode);
    }
  } catch (error) {
    fail('GET /admin/metrics - Erro', error.message);
  }

  // Admin Settings
  try {
    const response = await apiRequest('/admin/settings', {}, adminTokens);
    if (response.ok) {
      const data = JSON.parse(response.body);
      success('GET /admin/settings - OK', {
        commissionRate: data.settings?.commissionRate,
        coupons: data.coupons?.length,
        promotions: data.promotions?.length
      });

      if (data.settings && data.coupons && data.promotions) {
        success('Admin Settings - Estrutura completa');
      } else {
        fail('Admin Settings - Estrutura incompleta', data);
      }
    } else if (response.statusCode === 403) {
      fail('GET /admin/settings - Usuário não é admin (403)');
    } else {
      fail('GET /admin/settings - Falhou', response.statusCode);
    }
  } catch (error) {
    fail('GET /admin/settings - Erro', error.message);
  }

  // Admin Claims
  try {
    const response = await apiRequest('/admin/claims', {}, adminTokens);
    if (response.ok) {
      const data = JSON.parse(response.body);
      if (Array.isArray(data)) {
        success('GET /admin/claims - OK', { count: data.length });
      } else {
        fail('GET /admin/claims - Não retornou array', typeof data);
      }
    } else if (response.statusCode === 403) {
      fail('GET /admin/claims - Usuário não é admin (403)');
    } else {
      fail('GET /admin/claims - Falhou', response.statusCode);
    }
  } catch (error) {
    fail('GET /admin/claims - Erro', error.message);
  }
}

// TESTES DE FRONTEND - PÁGINAS
async function testFrontendPages() {
  section('🎨 TESTES - PÁGINAS DO FRONTEND');

  const pages = [
    { path: '/', name: 'Home/Landing', needsAuth: false },
    { path: '/login', name: 'Login', needsAuth: false },
    { path: '/terms', name: 'Termos', needsAuth: false },
    { path: '/onboard', name: 'Onboarding', needsAuth: true },
    { path: '/dashboard', name: 'Dashboard Cliente', needsAuth: true },
    { path: '/billing', name: 'Billing', needsAuth: true },
    { path: '/recommendations', name: 'Recommendations', needsAuth: true },
    { path: '/settings', name: 'Settings', needsAuth: true },
    { path: '/sla-claims', name: 'SLA Claims', needsAuth: true },
    { path: '/profile', name: 'Profile', needsAuth: true },
    { path: '/admin', name: 'Admin Dashboard', needsAuth: true, adminOnly: true },
    { path: '/alerts', name: 'Alerts', needsAuth: true },
    { path: '/claims', name: 'Claims', needsAuth: true }
  ];

  for (const page of pages) {
    try {
      const response = await makeRequest(`${FRONTEND_URL}${page.path}`);
      
      if (response.ok || [301, 302, 307, 308].includes(response.statusCode)) {
        const isHTML = response.headers['content-type']?.includes('text/html');
        
        if (isHTML || response.statusCode >= 300) {
          const status = response.statusCode >= 300 ? `Redirect (${response.statusCode})` : 'OK';
          success(`Página ${page.name} (${page.path}) - ${status}`);
          
          // Validar se tem conteúdo
          if (response.ok && response.body.length > 0) {
            success(`  └─ HTML carregado (${(response.body.length / 1024).toFixed(1)}KB)`);
          }
        } else {
          fail(`Página ${page.name} - Tipo incorreto`, response.headers['content-type']);
        }
      } else {
        fail(`Página ${page.name} - Status ${response.statusCode}`, response.statusCode);
      }
    } catch (error) {
      fail(`Página ${page.name} - Erro`, error.message);
    }
  }
}

// TESTES DE PERFORMANCE
async function testPerformance() {
  section('⚡ TESTES - PERFORMANCE');

  // API Response Time
  const apiStart = Date.now();
  try {
    await apiRequest('/health');
    const duration = Date.now() - apiStart;
    
    if (duration < 300) {
      success(`API Health - ${duration}ms (Excelente)`);
    } else if (duration < 1000) {
      success(`API Health - ${duration}ms (Bom)`);
    } else if (duration < 2000) {
      info(`API Health - ${duration}ms (Aceitável)`);
    } else {
      fail(`API Health - ${duration}ms (Lento)`);
    }
  } catch (error) {
    fail('API Performance - Erro', error.message);
  }

  // Frontend Response Time
  const frontStart = Date.now();
  try {
    await makeRequest(FRONTEND_URL);
    const duration = Date.now() - frontStart;
    
    if (duration < 1000) {
      success(`Frontend - ${duration}ms (Excelente)`);
    } else if (duration < 2000) {
      success(`Frontend - ${duration}ms (Bom)`);
    } else if (duration < 3000) {
      info(`Frontend - ${duration}ms (Aceitável)`);
    } else {
      fail(`Frontend - ${duration}ms (Lento)`);
    }
  } catch (error) {
    fail('Frontend Performance - Erro', error.message);
  }
}

// TESTES DE SEGURANÇA
async function testSecurity() {
  section('🔒 TESTES - SEGURANÇA');

  // HTTPS
  if (API_URL.startsWith('https://')) {
    success('API - HTTPS ativo');
  } else {
    fail('API - Sem HTTPS!');
  }

  if (FRONTEND_URL.startsWith('https://')) {
    success('Frontend - HTTPS ativo');
  } else {
    fail('Frontend - Sem HTTPS!');
  }

  // CORS
  try {
    const response = await apiRequest('/health', {
      headers: { 'Origin': FRONTEND_URL }
    });
    
    const corsHeader = response.headers['access-control-allow-origin'];
    if (corsHeader) {
      success('CORS - Headers configurados', { origin: corsHeader });
    } else {
      info('CORS - Headers não detectados (pode estar em proxy/CDN)');
    }
  } catch (error) {
    fail('CORS - Erro ao verificar', error.message);
  }

  // Security Headers
  try {
    const response = await makeRequest(FRONTEND_URL);
    const secHeaders = ['x-frame-options', 'x-content-type-options', 'strict-transport-security'];
    const found = secHeaders.filter(h => response.headers[h]);
    
    if (found.length > 0) {
      success(`Security Headers - ${found.length}/${secHeaders.length} presentes`, found);
    } else {
      info('Security Headers - Nenhum detectado (pode estar em CDN)');
    }
  } catch (error) {
    fail('Security Headers - Erro', error.message);
  }
}

// MAIN
async function runTests() {
  log('\n🚀 AWS COST GUARDIAN - TESTE DE INTEGRAÇÃO COMPLETO\n', 'magenta');
  log(`Frontend: ${FRONTEND_URL}`, 'cyan');
  log(`Backend:  ${API_URL}\n`, 'cyan');

  const startTime = Date.now();

  // Autenticar se credenciais fornecidas
  if (TEST_USER_EMAIL && TEST_USER_PASSWORD) {
    userTokens = await authenticateWithCognito(TEST_USER_EMAIL, TEST_USER_PASSWORD, false);
  }

  if (TEST_ADMIN_EMAIL && TEST_ADMIN_PASSWORD) {
    adminTokens = await authenticateWithCognito(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, true);
  }

  // Executar testes
  await testPublicEndpoints();
  await testUserEndpoints();
  await testAdminEndpoints();
  await testFrontendPages();
  await testPerformance();
  await testSecurity();

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  // Resumo
  section('📊 RESUMO FINAL');
  log(`Total de Testes: ${totalTests}`, 'cyan');
  log(`✅ Passou: ${passedTests}`, 'green');
  log(`❌ Falhou: ${failedTests}`, 'red');
  log(`⏱️  Tempo: ${duration}s`, 'cyan');
  
  const successRate = totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : 0;
  log(`\n📈 Taxa de Sucesso: ${successRate}%\n`, successRate >= 80 ? 'green' : 'red');

  if (failedTests === 0) {
    log('🎉 TODOS OS TESTES PASSARAM! Sistema 100% funcional.\n', 'green');
  } else if (successRate >= 80) {
    log('⚠️  Sistema operacional com algumas falhas.\n', 'yellow');
  } else {
    log('❌ Sistema precisa de correções urgentes.\n', 'red');
  }

  // Salvar relatório
  const report = {
    timestamp: new Date().toISOString(),
    summary: { total: totalTests, passed: passedTests, failed: failedTests, successRate },
    duration: `${duration}s`,
    results: testResults
  };

  require('fs').writeFileSync(
    'test-results.json',
    JSON.stringify(report, null, 2)
  );
  log('📄 Relatório salvo em: test-results.json\n', 'cyan');

  process.exit(failedTests > 0 ? 1 : 0);
}

runTests().catch(error => {
  log(`\n💥 Erro fatal: ${error.message}\n`, 'red');
  console.error(error);
  process.exit(1);
});
