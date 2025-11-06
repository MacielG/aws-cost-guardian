#!/usr/bin/env node

/**
 * Script para configurar variáveis de ambiente para Serverless Framework
 * Uso: npm run export-outputs [--force|--merge|--skip-if-exists]
 */

const fs = require('fs');
const path = require('path');

// Parse CLI arguments
const args = process.argv.slice(2);
const force = args.includes('--force');
const merge = args.includes('--merge');
const skipIfExists = args.includes('--skip-if-exists');
const production = args.includes('--production');

// Default to force if no option specified
const defaultBehavior = !merge && !skipIfExists ? 'force' : (merge ? 'merge' : (skipIfExists ? 'skip' : 'force'));

// Determine env file path
const ENV_FILE_NAME = production ? '.env.production' : '.env.local';
const REGION = 'us-east-1';
const ENV_FILE_PATH = path.join(__dirname, '../../frontend', ENV_FILE_NAME);
const BACKUP_FILE_PATH = path.join(__dirname, '../../frontend', `${ENV_FILE_NAME}.backup`);

function loadExistingEnv() {
  if (fs.existsSync(ENV_FILE_PATH)) {
    const content = fs.readFileSync(ENV_FILE_PATH, 'utf8');
    const lines = content.split('\n').filter(line => line.includes('=') && !line.startsWith('#'));
    const env = {};
    lines.forEach(line => {
      const [key, ...valueParts] = line.split('=');
      env[key.trim()] = valueParts.join('=').trim();
    });
    return env;
  }
  return {};
}

function areEnvsEqual(existing, newEnv) {
  const keys = new Set([...Object.keys(existing), ...Object.keys(newEnv)]);
  for (const key of keys) {
    if (existing[key] !== newEnv[key]) return false;
  }
  return true;
}

async function exportOutputs() {
  console.log('🔍 Configurando variáveis de ambiente para Serverless Framework (produção)...\n');

  // Para Serverless Framework, usamos valores hardcoded baseados no deployment atual
  const envVars = {};

  console.log('📦 Usando configuração Serverless Framework (produção)\n');

  // Valores baseados no deployment atual do Serverless Framework
  envVars['NEXT_PUBLIC_API_URL'] = 'https://zyynk8o2a1.execute-api.us-east-1.amazonaws.com/prod/';
  envVars['NEXT_PUBLIC_COGNITO_USER_POOL_ID'] = 'us-east-1_1c1vqVeqC';
  envVars['NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID'] = '5gt250n7bsc96j3ac5qfq5s890';
  envVars['NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID'] = 'us-east-1:3e6edff0-0192-4cae-886f-29ad864a06a0';
  envVars['NEXT_PUBLIC_CFN_TEMPLATE_URL'] = 'http://costguardianstack-cfntemplatebucket4840c65e-gqmdl89vh3hn.s3-website-us-east-1.amazonaws.com/template.yaml';
  envVars['NEXT_PUBLIC_AWS_REGION'] = REGION;
  envVars['NEXT_PUBLIC_AMPLIFY_REGION'] = REGION;

  console.log('✓ API URL configurada');
  console.log('✓ Cognito User Pool configurado');
  console.log('✓ Cognito Client configurado');
  console.log('✓ Identity Pool configurado');
  console.log('✓ CloudFormation Template URL configurada');
  console.log('✓ Região configurada\n');

  // Validação básica: testar se a API está respondendo
  try {
    const https = require('https');
    const url = new URL(envVars['NEXT_PUBLIC_API_URL']);

    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        path: '/api/health',
        method: 'GET',
        timeout: 5000
      }, (res) => {
        if (res.statusCode === 200) {
          console.log('✅ API está respondendo corretamente');
          resolve();
        } else {
          reject(new Error(`API retornou status ${res.statusCode}`));
        }
      });

      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Timeout na validação da API')));
      req.end();
    });
  } catch (error) {
    console.warn(`⚠️  Não foi possível validar a API: ${error.message}`);
    console.log('Continuando mesmo assim...\n');
  }

  // Normalização da URL da API
  function normalizeApiUrl(raw) {
  if (!raw || typeof raw !== 'string') return raw;
  let u = raw.trim();
  // Garantir que termina com /
  if (!u.endsWith('/')) {
  u += '/';
  }
  return u;
  }

  // Aplicar normalização ao endpoint da API se presente
  if (envVars['NEXT_PUBLIC_API_URL']) {
    const normalized = normalizeApiUrl(envVars['NEXT_PUBLIC_API_URL']);
    const finalUrl = normalized.endsWith('/') ? normalized : normalized + '/';

    if (finalUrl !== envVars['NEXT_PUBLIC_API_URL']) {
      console.log(`ℹ️  Normalizando NEXT_PUBLIC_API_URL: '${envVars['NEXT_PUBLIC_API_URL']}' → '${finalUrl}'`);
      envVars['NEXT_PUBLIC_API_URL'] = finalUrl;
    }
  }

  // Validar que chaves críticas existem
  const required = ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_COGNITO_USER_POOL_ID', 'NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID'];
  const missing = required.filter(k => !envVars[k]);
  if (missing.length > 0) {
    const msg = `Required environment variables missing: ${missing.join(', ')}.`;
    console.error(`\n❌ ${msg}`);
    process.exit(1);
  }

  // Verificar duplicidades e comportamento
  const existingEnv = loadExistingEnv();
  if (areEnvsEqual(existingEnv, envVars)) {
    console.log('\nℹ️  Nenhuma mudança detectada nos valores. Pulando exportação.');
    return;
  }

  if (skipIfExists && Object.keys(existingEnv).length > 0) {
    console.log('\nℹ️  Arquivo já existe e --skip-if-exists definido. Pulando exportação.');
    return;
  }

  if (merge) {
    Object.assign(envVars, existingEnv); // Merge: novos sobrescrevem existentes
    console.log('\n🔄 Modo merge: Mantendo variáveis existentes e adicionando novas.');
  }

  // Criar backup se arquivo existir
  if (fs.existsSync(ENV_FILE_PATH)) {
    fs.copyFileSync(ENV_FILE_PATH, BACKUP_FILE_PATH);
    console.log(`💾 Backup criado: ${BACKUP_FILE_PATH}`);
  }

  // Criar conteúdo do .env.local
  const envContent = Object.entries(envVars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const timestamp = new Date().toISOString();
  const fullContent = `# Auto-generated by export-outputs.js at ${timestamp}
# Do not edit manually - run 'npm run export-outputs' to update

${envContent}

# Stripe (configure manualmente se necessário)
# NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
`;

  // Escrever arquivo
  fs.writeFileSync(ENV_FILE_PATH, fullContent);

  console.log(`\n✅ Arquivo criado: ${ENV_FILE_PATH}`);
  console.log('\n📝 Variáveis exportadas:');
  Object.entries(envVars).forEach(([key, value]) => {
    // Truncar valores longos para exibição
    const displayValue = value.length > 50 ? value.substring(0, 50) + '...' : value;
    console.log(`   ${key}=${displayValue}`);
  });

  console.log(`\n✅ Pronto! Arquivo ${ENV_FILE_NAME} criado.`);
  if (!production) {
    console.log('Agora você pode executar o frontend localmente:');
    console.log('   cd frontend');
    console.log('   npm run dev\n');
  }
}

exportOutputs().catch(error => {
  console.error('\n❌ Erro inesperado:', error);
  process.exit(1);
});
