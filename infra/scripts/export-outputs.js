#!/usr/bin/env node

/**
 * Script para exportar os outputs do CloudFormation para .env.local do frontend
 * Uso: npm run export-outputs [--force|--merge|--skip-if-exists]
 */

const { CloudFormationClient, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
const { CloudWatchLogsClient, PutLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const fs = require('fs');
const path = require('path');

// Parse CLI arguments
const args = process.argv.slice(2);
const force = args.includes('--force');
const merge = args.includes('--merge');
const skipIfExists = args.includes('--skip-if-exists');

// Default to force if no option specified
const defaultBehavior = !merge && !skipIfExists ? 'force' : (merge ? 'merge' : (skipIfExists ? 'skip' : 'force'));

const STACK_NAME = 'CostGuardianStack';
const REGION = 'us-east-1';
const ENV_FILE_PATH = path.join(__dirname, '../../frontend/.env.local');
const BACKUP_FILE_PATH = path.join(__dirname, '../../frontend/.env.local.backup');

// AWS Clients
const cfClient = new CloudFormationClient({ region: REGION });
const logsClient = new CloudWatchLogsClient({ region: REGION });
const snsClient = new SNSClient({ region: REGION });

// Log Group and Topic (configure as needed)
const LOG_GROUP_NAME = 'CostGuardian/EnvExport';
const SNS_TOPIC_ARN = process.env.SNS_ALERT_TOPIC_ARN || process.env.ENV_ALERT_TOPIC_ARN; // Set via env or CDK output

// Helper functions
async function logToCloudWatch(message, level = 'INFO') {
  try {
    const logStreamName = `env-export-${new Date().toISOString().split('T')[0]}`;
    const logEvent = {
      message: JSON.stringify({ timestamp: new Date().toISOString(), level, message }),
      timestamp: Date.now(),
    };
    // Assume log group/stream exists; in production, create if needed
    await logsClient.send(new PutLogEventsCommand({
      logGroupName: LOG_GROUP_NAME,
      logStreamName,
      logEvents: [logEvent],
    }));
  } catch (error) {
    console.warn('Failed to log to CloudWatch:', error.message);
  }
}

async function sendAlert(message) {
  if (!SNS_TOPIC_ARN) return;
  try {
    await snsClient.send(new PublishCommand({
      TopicArn: SNS_TOPIC_ARN,
      Subject: 'Env Export Alert',
      Message: message,
    }));
  } catch (error) {
    console.warn('Failed to send SNS alert:', error.message);
  }
}

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
  console.log('🔍 Buscando outputs do stack CloudFormation...\n');



  try {
    const command = new DescribeStacksCommand({ StackName: STACK_NAME });
    const response = await cfClient.send(command);

    if (!response.Stacks || response.Stacks.length === 0) {
      const msg = `Stack '${STACK_NAME}' não encontrado na região ${REGION}`;
      console.error(`❌ ${msg}`);
      await logToCloudWatch(msg, 'ERROR');
      await sendAlert(msg);
      process.exit(1);
    }

    const stack = response.Stacks[0];
    const outputs = stack.Outputs || [];

    if (outputs.length === 0) {
      const msg = `Stack '${STACK_NAME}' não possui outputs`;
      console.error(`❌ ${msg}`);
      await logToCloudWatch(msg, 'ERROR');
      await sendAlert(msg);
      process.exit(1);
    }

    console.log(`✅ Stack encontrado: ${stack.StackName}`);
    console.log(`📊 Status: ${stack.StackStatus}\n`);

    // Mapear outputs para variáveis de ambiente
    const outputMap = {
      'APIUrl': 'NEXT_PUBLIC_API_URL',
      'UserPoolId': 'NEXT_PUBLIC_COGNITO_USER_POOL_ID',
      'UserPoolClientId': 'NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID',
      'IdentityPoolId': 'NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID',
      'CfnTemplateUrl': 'NEXT_PUBLIC_CFN_TEMPLATE_URL',
    };

    const envVars = {};

    outputs.forEach(output => {
      const envKey = outputMap[output.OutputKey];
      if (envKey) {
        envVars[envKey] = output.OutputValue;
        console.log(`✓ ${output.OutputKey} → ${envKey}`);
      }
    });

    // Adicionar região
    envVars['NEXT_PUBLIC_AWS_REGION'] = REGION;
    envVars['NEXT_PUBLIC_AMPLIFY_REGION'] = REGION;
    console.log(`✓ Region → NEXT_PUBLIC_AWS_REGION`);

    // Normalizações e validações robustas para evitar problemas de URL
    function normalizeApiUrl(raw) {
      if (!raw || typeof raw !== 'string') return raw;
      let u = raw.trim();
      // Remove espaços e quebras
      // Separar protocolo para não remover as duas barras após 'https:'
      const parts = u.split('://');
      if (parts.length < 2) {
        // Sem protocolo — não mexer muito, apenas remover barras duplicadas
        const cleaned = u.replace(/\/{2,}/g, '/').replace(/\/$/, '');
        return cleaned + '/'; // SEMPRE adicionar barra final
      }
      const protocol = parts.shift();
      const rest = parts.join('://');
      // separar host do path
      const slashIndex = rest.indexOf('/');
      let host = rest;
      let pathPart = '';
      if (slashIndex !== -1) {
        host = rest.slice(0, slashIndex);
        pathPart = rest.slice(slashIndex);
      }
      // colapsar // no path (mas preservar o '//' depois do protocolo)
      pathPart = pathPart.replace(/\/{2,}/g, '/');
      // remover barras finais duplicadas, mas manter uma
      pathPart = pathPart.replace(/\/+$/, '');
      
      // GARANTIR barra final SEMPRE
      return `${protocol}://${host}${pathPart}/`;
    }

    // Aplicar normalização ao endpoint da API se presente
    if (envVars['NEXT_PUBLIC_API_URL']) {
      const normalized = normalizeApiUrl(envVars['NEXT_PUBLIC_API_URL']);
      
      // Validação extra: garantir que sempre termina com /
      const finalUrl = normalized.endsWith('/') ? normalized : normalized + '/';
      
      if (finalUrl !== envVars['NEXT_PUBLIC_API_URL']) {
        console.log(`ℹ️  Normalizando NEXT_PUBLIC_API_URL: '${envVars['NEXT_PUBLIC_API_URL']}' → '${finalUrl}'`);
        envVars['NEXT_PUBLIC_API_URL'] = finalUrl;
      }
    }

    // Validar que chaves críticas existem antes de escrever o arquivo
    const required = ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_COGNITO_USER_POOL_ID', 'NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID'];
    const missing = required.filter(k => !envVars[k]);
    if (missing.length > 0) {
      const msg = `Required outputs missing from stack: ${missing.join(', ')}.`;
      console.error(`\n❌ ${msg}`);
      await logToCloudWatch(msg, 'ERROR');
      await sendAlert(msg);
      // Não prosseguir escrevendo um .env inconsistente
      process.exit(1);
    }

    // Verificar duplicidades e comportamento
    const existingEnv = loadExistingEnv();
    if (areEnvsEqual(existingEnv, envVars)) {
      console.log('\\nℹ️  Nenhuma mudança detectada nos valores. Pulando exportação.');
      await logToCloudWatch('No changes detected in env vars', 'INFO');
      return;
    }

    if (skipIfExists && Object.keys(existingEnv).length > 0) {
      console.log('\\nℹ️  Arquivo já existe e --skip-if-exists definido. Pulando exportação.');
      await logToCloudWatch('Skipped due to existing file and --skip-if-exists', 'INFO');
      return;
    }

    if (merge) {
      Object.assign(envVars, existingEnv); // Merge: novos sobrescrevem existentes
      console.log('\\n🔄 Modo merge: Mantendo variáveis existentes e adicionando novas.');
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

    console.log('\n✅ Pronto! Agora você pode executar o frontend localmente:');
    console.log('   cd frontend');
    console.log('   npm run dev\n');

    await logToCloudWatch('Env export successful', 'INFO');

  } catch (error) {
    const msg = `Erro ao buscar outputs: ${error.message}`;
    console.error(`\n❌ ${msg}`);
    console.error('\nDetalhes:', error);
    await logToCloudWatch(msg, 'ERROR');
    await sendAlert(msg);
    process.exit(1);
  }
}

exportOutputs();
