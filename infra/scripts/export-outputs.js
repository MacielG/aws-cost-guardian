#!/usr/bin/env node

/**
 * Script para configurar variáveis de ambiente para Serverless Framework
 * Uso: npm run export-outputs [--force|--merge|--skip-if-exists]
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const force = args.includes('--force');
const merge = args.includes('--merge');
const skipIfExists = args.includes('--skip-if-exists');
const production = args.includes('--production');

const defaultBehavior = !merge && !skipIfExists ? 'force' : (merge ? 'merge' : (skipIfExists ? 'skip' : 'force'));

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
  console.log('🔍 Configurando variáveis de ambiente para Serverless Framework...\n');

  const envVars = {};
  const isProduction = process.env.NODE_ENV === 'production';

  console.log('📦 Usando configuração Serverless Framework\n');

  // Read from environment variables or local config file
  // Priority: env vars > config.local.js > defaults
  let localConfig = {};
  try {
    const configPath = path.join(__dirname, '../../config.local.js');
    if (fs.existsSync(configPath)) {
      localConfig = require(configPath);
      console.log('✓ Carregando configuração de config.local.js');
    } else {
      console.warn('⚠️  config.local.js não encontrado. Usando variáveis de ambiente ou valores padrão.');
    }
  } catch (error) {
    console.warn('⚠️  Erro ao carregar config.local.js:', error.message);
  }

  envVars['NEXT_PUBLIC_API_URL'] = process.env.NEXT_PUBLIC_API_URL ||
    localConfig.SERVERLESS_API_URL ||
    'https://your-api-id.execute-api.us-east-1.amazonaws.com/prod/';

  envVars['NEXT_PUBLIC_COGNITO_USER_POOL_ID'] = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ||
    localConfig.COGNITO_USER_POOL_ID ||
    'us-east-1_XXXXXXXXX';

  envVars['NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID'] = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID ||
    localConfig.COGNITO_USER_POOL_CLIENT_ID ||
    'XXXXXXXXXXXXXXXXXXXXXXXXXX';

  envVars['NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID'] = process.env.NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID ||
    localConfig.COGNITO_IDENTITY_POOL_ID ||
    'us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';

  envVars['NEXT_PUBLIC_CFN_TEMPLATE_URL'] = process.env.NEXT_PUBLIC_CFN_TEMPLATE_URL ||
    localConfig.CFN_TEMPLATE_URL ||
    'https://your-bucket.s3.amazonaws.com/template.yaml';

  envVars['NEXT_PUBLIC_AWS_REGION'] = REGION;
  envVars['NEXT_PUBLIC_AMPLIFY_REGION'] = REGION;

  // Validate that NEXT_PUBLIC_API_URL exists before requesting
  if (!envVars['NEXT_PUBLIC_API_URL']) {
    const msg = 'NEXT_PUBLIC_API_URL is missing. Set it via environment variable or SERVERLESS_API_URL.';
    console.error(`\n❌ ${msg}`);
    console.error('Example: export NEXT_PUBLIC_API_URL=https://your-api-id.execute-api.us-east-1.amazonaws.com/prod/');
    process.exit(1);
  }

  // Enhanced health check with better error logging
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
    // Log full error details
    console.error(`❌ Health check failed: ${error.message}`);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }

    if (isProduction) {
      console.error('❌ Failing in production due to API health check failure');
      process.exit(1);
    } else {
      console.warn('⚠️  Continuing despite API health check failure (development mode)');
    }
  }

  function normalizeApiUrl(raw) {
    if (!raw || typeof raw !== 'string') return raw;
    let u = raw.trim();
    if (!u.endsWith('/')) {
      u += '/';
    }
    return u;
  }

  if (envVars['NEXT_PUBLIC_API_URL']) {
    const normalized = normalizeApiUrl(envVars['NEXT_PUBLIC_API_URL']);
    const finalUrl = normalized.endsWith('/') ? normalized : normalized + '/';

    if (finalUrl !== envVars['NEXT_PUBLIC_API_URL']) {
      console.log(`ℹ️  Normalizando NEXT_PUBLIC_API_URL: '${envVars['NEXT_PUBLIC_API_URL']}' → '${finalUrl}'`);
      envVars['NEXT_PUBLIC_API_URL'] = finalUrl;
    }
  }

  const required = ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_COGNITO_USER_POOL_ID', 'NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID'];
  const missing = required.filter(k => !envVars[k]);
  if (missing.length > 0) {
    const msg = `Required environment variables missing: ${missing.join(', ')}.`;
    console.error(`\n❌ ${msg}`);
    console.error('Set these via environment variables before running this script.');
    process.exit(1);
  }

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
    Object.assign(envVars, existingEnv);
    console.log('\n🔄 Modo merge: Mantendo variáveis existentes e adicionando novas.');
  }

  if (fs.existsSync(ENV_FILE_PATH)) {
    fs.copyFileSync(ENV_FILE_PATH, BACKUP_FILE_PATH);
    console.log(`💾 Backup criado: ${BACKUP_FILE_PATH}`);
  }

  const envContent = Object.entries(envVars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const timestamp = new Date().toISOString();
  const fullContent = `# Auto-generated by export-outputs.js at ${timestamp}
# Do not edit manually - run 'npm run export-outputs' to update
# Set environment variables before running: NEXT_PUBLIC_API_URL, NEXT_PUBLIC_COGNITO_USER_POOL_ID, etc.

${envContent}

# Stripe (configure manualmente se necessário)
# NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
`;

  fs.writeFileSync(ENV_FILE_PATH, fullContent);

  console.log(`\n✅ Arquivo criado: ${ENV_FILE_PATH}`);
  console.log('\n📝 Variáveis exportadas:');
  Object.entries(envVars).forEach(([key, value]) => {
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
  console.error('Detalhes:', error.message);
  if (error.stack) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
});
