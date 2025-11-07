// handler.js - Main AWS Lambda handler for Cost Guardian
const serverless = require('serverless-http');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');
const { CostExplorerClient, GetCostAndUsageCommand } = require('@aws-sdk/client-cost-explorer');
const { DescribeSeverityLevelsCommand } = require('@aws-sdk/client-support');
const { randomBytes } = require('crypto');

const app = express();
const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGINS || '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token',
  'Access-Control-Allow-Credentials': 'true'
};

// AWS SDK v3 setup
const dynamoDb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'https://awscostguardian.com'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Authentication middleware
const authenticateUser = async (event) => {
  try {
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7);
    const decoded = jwt.decode(token, { complete: true });

    if (!decoded || !decoded.payload) {
      return null;
    }

    return {
      sub: decoded.payload.sub || decoded.payload['cognito:username'],
      email: decoded.payload.email || decoded.payload['cognito:email'] || decoded.payload.email_address
    };
  } catch (error) {
    console.error('Authentication error:', error);
    return null;
  }
};

// Helper function to assume role
const getAssumedClients = async (roleArn, externalId, region = 'us-east-1') => {
  const sts = new STSClient({ region });
  const assumeRoleCommand = new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: 'CostGuardianSession',
    ExternalId: externalId
  });

  const response = await sts.send(assumeRoleCommand);
  const credentials = response.Credentials;

  return {
    costExplorer: new CostExplorerClient({
      region,
      credentials: {
        accessKeyId: credentials.AccessKeyId,
        secretAccessKey: credentials.SecretAccessKey,
        sessionToken: credentials.SessionToken
      }
    }),
    support: new STSClient({
      region,
      credentials: {
        accessKeyId: credentials.AccessKeyId,
        secretAccessKey: credentials.SecretAccessKey,
        sessionToken: credentials.SessionToken
      }
    })
  };
};

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// GET /api/onboard-init - Retorna configuração para onboarding
app.get('/api/onboard-init', async (req, res) => {
  try {
    const mode = req.query.mode || 'trial';
    const authHeader = req.headers.authorization;

    // Tenta verificar autenticação
    let user = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      user = await authenticateUser({ headers: { Authorization: authHeader } });
    }

    // Se não autenticado, retorna info básica
    if (!user) {
      const accountType = mode === 'active' ? 'ACTIVE' : 'TRIAL';
      const templateUrl = accountType === 'TRIAL'
        ? process.env.TRIAL_TEMPLATE_URL
        : process.env.FULL_TEMPLATE_URL;

      return res.json({
        mode,
        accountType,
        templateUrl,
        platformAccountId: process.env.PLATFORM_ACCOUNT_ID,
        requiresAuth: true,
        message: 'Faça login para configurar o onboarding'
      });
    }

    const userId = user.sub;

    // Tenta recuperar a configuração existente
    const getParams = {
      TableName: process.env.DYNAMODB_TABLE,
      Key: { id: userId, sk: 'CONFIG#ONBOARD' },
    };

    const existing = await dynamoDb.send(new GetCommand(getParams));
    if (existing.Item) {
      const item = existing.Item;
      const templateUrl = item.accountType === 'TRIAL'
        ? process.env.TRIAL_TEMPLATE_URL
        : process.env.FULL_TEMPLATE_URL;

      return res.json({
        externalId: item.externalId,
        platformAccountId: process.env.PLATFORM_ACCOUNT_ID,
        status: item.status || 'PENDING_CFN',
        termsAccepted: !!item.termsAccepted,
        accountType: item.accountType || 'TRIAL',
        templateUrl,
      });
    }

    // Se não existir, cria um novo registro de configuração
    const externalId = randomBytes(16).toString('hex');
    const accountType = mode === 'active' ? 'ACTIVE' : 'TRIAL';
    const templateUrl = accountType === 'TRIAL'
      ? process.env.TRIAL_TEMPLATE_URL
      : process.env.FULL_TEMPLATE_URL;

    const putParams = {
      TableName: process.env.DYNAMODB_TABLE,
      Item: {
        id: userId,
        sk: 'CONFIG#ONBOARD',
        externalId,
        status: 'PENDING_CFN',
        accountType,
        createdAt: new Date().toISOString(),
      },
    };

    await dynamoDb.send(new PutCommand(putParams));

    res.json({
      externalId,
      platformAccountId: process.env.PLATFORM_ACCOUNT_ID,
      status: 'PENDING_CFN',
      termsAccepted: false,
      accountType,
      templateUrl,
    });

  } catch (error) {
    console.error('Error in /api/onboard-init:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// POST /api/onboard - Callback endpoint for CloudFormation
app.post('/onboard', async (req, res) => {
  try {
    const event = req.body;

    // Se for callback do CloudFormation Custom Resource
    if (event && event.ResourceProperties) {
      const props = event.ResourceProperties;

      const roleArn = props.RoleArn || props.roleArn;
      const awsAccountId = props.AwsAccountId || props.awsAccountId || props.AWSAccountId;
      const externalId = props.ExternalId || props.externalId;
      const customerId = props.CustomerId || props.customerId;
      const trialMode = props.TrialMode || props.trialMode || false;

      // Se temos CustomerId (integração direta), usamos esse fluxo
      if (customerId && roleArn && awsAccountId && externalId) {
        // Verificar nível de suporte AWS
        let supportLevel = 'basic';
        try {
          const { support } = await getAssumedClients(roleArn, externalId, 'us-east-1');
          // Note: Support client needs different setup, simplified for now
          supportLevel = 'business';
        } catch (err) {
          console.log(`Cliente ${customerId} está no plano Basic/Developer.`);
          supportLevel = 'basic';
        }

        const params = {
          TableName: process.env.DYNAMODB_TABLE,
          Item: {
            id: customerId,
            sk: 'CONFIG#ONBOARD',
            awsAccountId: awsAccountId,
            roleArn: roleArn,
            externalId: externalId,
            status: 'COMPLETED',
            supportLevel: supportLevel,
            accountType: trialMode ? 'TRIAL' : 'PREMIUM',
            createdAt: new Date().toISOString(),
            onboardingComplete: true
          },
        };

        await dynamoDb.send(new PutCommand(params));
        console.log(`Onboarding concluído para Cliente: ${customerId}, Conta AWS: ${awsAccountId}`);

        // Responde ao CloudFormation se houver ResponseURL
        if (event.ResponseURL) {
          try {
            await sendCfnResponse(event, 'SUCCESS', { Message: 'Onboarding bem-sucedido.' });
          } catch (err) {
            console.error('Erro ao enviar resposta SUCCESS ao CFN:', err);
          }
        }

        return res.status(200).json({ success: true, message: 'Onboarding completed' });
      }
    }

    // Fallback: comportamento legado quando chamado diretamente
    const { roleArn, awsAccountId, externalId } = req.body;

    if (!roleArn || !awsAccountId || !externalId) {
      return res.status(400).json({ success: false, message: 'Missing required parameters' });
    }

    // Encontrar o usuário pelo externalId
    const queryCmd = new QueryCommand({
      TableName: process.env.DYNAMODB_TABLE,
      IndexName: 'ExternalIdIndex',
      KeyConditionExpression: 'externalId = :externalId',
      ExpressionAttributeValues: { ':externalId': externalId },
    });

    const configQuery = await dynamoDb.send(queryCmd);

    if (!configQuery.Items || configQuery.Items.length === 0) {
      return res.status(404).json({ success: false, message: 'Onboarding configuration not found' });
    }

    const userConfig = configQuery.Items[0];
    const userId = userConfig.id;

    // Atualizar configuração com dados da conta AWS
    const updateCmd = new UpdateCommand({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { id: userId, sk: 'CONFIG#ONBOARD' },
      UpdateExpression: 'SET #status = :status, roleArn = :roleArn, awsAccountId = :awsAccountId, onboardingComplete = :complete',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'COMPLETED',
        ':roleArn': roleArn,
        ':awsAccountId': awsAccountId,
        ':complete': true
      }
    });

    await dynamoDb.send(updateCmd);

    // Criar entrada da conta AWS
    const accountParams = {
      TableName: process.env.DYNAMODB_TABLE,
      Item: {
        id: userId,
        sk: `ACCOUNT#${awsAccountId}`,
        roleArn,
        awsAccountId,
        plan: userConfig.accountType === 'TRIAL' ? 'trial' : 'premium',
        createdAt: new Date().toISOString(),
      },
    };

    await dynamoDb.send(new PutCommand(accountParams));

    res.json({
      success: true,
      message: 'Onboarding completed successfully!',
      accountId: awsAccountId
    });

  } catch (err) {
    console.error('Onboarding error:', err);

    // Se foi chamada do CFN, tenta notificar sobre falha
    if (req.body && req.body.ResourceProperties && req.body.ResponseURL) {
      try {
        await sendCfnResponse(req.body, 'FAILED', { Message: err.message || 'Internal error.' });
      } catch (sendErr) {
        console.error('Error sending CFN failure response:', sendErr);
      }
    }

    res.status(500).json({ success: false, message: 'Onboarding failed', error: err.message });
  }
});

// GET /api/user/status - Retorna status do usuário
app.get('/api/user/status', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.sub;

    const params = {
      TableName: process.env.DYNAMODB_TABLE,
      Key: {
        id: userId,
        sk: 'CONFIG#ONBOARD'
      }
    };

    const result = await dynamoDb.send(new GetCommand(params));

    if (!result.Item) {
      return res.status(200).json({
        hasAwsAccount: false,
        accountType: 'FREE',
        onboardingComplete: false
      });
    }

    const config = result.Item;
    const hasAwsAccount = !!(config.roleArn && config.externalId);

    return res.status(200).json({
      hasAwsAccount,
      accountType: config.subscriptionStatus === 'active' ? 'PREMIUM' : (config.accountType || 'FREE'),
      onboardingComplete: hasAwsAccount,
      roleArn: config.roleArn,
      subscriptionStatus: config.subscriptionStatus
    });
  } catch (err) {
    console.error('Error fetching user status:', err);
    return res.status(500).send({ error: 'Failed to fetch user status' });
  }
});

// GET /billing/summary - Resumo de billing e economias
app.get('/billing/summary', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.sub;

    // Buscar recomendações executadas
    let executedRecs = [];
    try {
      const recResult = await dynamoDb.send(new QueryCommand({
        TableName: process.env.DYNAMODB_TABLE,
        IndexName: 'CustomerDataIndex',
        KeyConditionExpression: 'id = :userId AND begins_with(sk, :prefix)',
        FilterExpression: '#status = :executed',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':userId': userId,
          ':prefix': 'REC#',
          ':executed': 'EXECUTED',
        }
      }));
      executedRecs = recResult.Items || [];
    } catch (dbError) {
      console.warn('DynamoDB query failed:', dbError.message);
    }

    // Calcular economia realizada
    const totalSavings = executedRecs.reduce((sum, rec) => {
      const savings = rec?.potentialSavings || rec?.amountPerHour || 0;
      return sum + (typeof savings === 'number' ? savings : 0);
    }, 0);
    const commission = totalSavings * 0.30;

    // Buscar claims de SLA
    let refundedClaims = [];
    try {
      const claimResult = await dynamoDb.send(new QueryCommand({
        TableName: process.env.DYNAMODB_TABLE,
        KeyConditionExpression: 'id = :userId AND begins_with(sk, :prefix)',
        FilterExpression: '#status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':userId': userId,
          ':prefix': 'SLA#',
          ':status': 'REFUNDED',
        }
      }));
      refundedClaims = claimResult.Items || [];
    } catch (dbError) {
      console.warn('DynamoDB query failed:', dbError.message);
    }

    const totalCredits = refundedClaims.reduce((sum, claim) => {
      const credit = claim?.creditAmount || claim?.recoveredAmount || 0;
      return sum + (typeof credit === 'number' ? credit : 0);
    }, 0);
    const creditCommission = totalCredits * 0.30;

    // Dados mensais mockados
    const monthlySavings = [
      { month: 'Jan', savings: totalSavings * 0.15 },
      { month: 'Feb', savings: totalSavings * 0.18 },
      { month: 'Mar', savings: totalSavings * 0.22 },
      { month: 'Apr', savings: totalSavings * 0.25 },
      { month: 'May', savings: totalSavings * 0.20 },
      { month: 'Jun', savings: totalSavings * 0.20 }
    ];

    return res.status(200).json({
      totalSavings: totalSavings + totalCredits,
      realizedSavings: (totalSavings + totalCredits) * 0.70,
      recommendationsExecuted: executedRecs.length,
      slaCreditsRecovered: totalCredits,
      monthlySavings
    });
  } catch (error) {
    console.error('Error fetching billing summary:', error);
    return res.status(500).json({ message: 'Error fetching billing data' });
  }
});

// GET /api/dashboard/costs - Dados de custos do dashboard
app.get('/api/dashboard/costs', authenticateUser, async (req, res) => {
  try {
    const customerId = req.user.sub;

    let costsData = null;
    try {
      const result = await dynamoDb.send(new QueryCommand({
        TableName: process.env.DYNAMODB_TABLE,
        KeyConditionExpression: 'id = :id AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':id': customerId,
          ':sk': 'COST#DASHBOARD#',
        },
        Limit: 1,
        ScanIndexForward: false,
      }));

      if (result.Items && result.Items.length > 0) {
        costsData = result.Items[0];
      }
    } catch (dbError) {
      console.warn('DynamoDB query failed:', dbError.message);
    }

    // Retornar dados vazios em vez de erro
    return res.status(200).json(costsData?.data || {
      Groups: [],
      Start: new Date().toISOString().split('T')[0],
      End: new Date().toISOString().split('T')[0]
    });
  } catch (error) {
    console.error('Error fetching dashboard costs:', error);
    return res.status(500).json({ error: 'Failed to fetch costs data.' });
  }
});

// GET /api/incidents - Buscar incidentes do cliente
app.get('/api/incidents', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.sub;

    // Buscar incidentes na tabela
    const queryCmd = new QueryCommand({
      TableName: process.env.DYNAMODB_TABLE,
      KeyConditionExpression: 'id = :id AND begins_with(sk, :sk)',
      ExpressionAttributeValues: {
        ':id': userId,
        ':sk': 'INCIDENT#',
      },
      ScanIndexForward: false,
      Limit: 50
    });

    const result = await dynamoDb.send(queryCmd);
    const incidents = result.Items || [];

    res.json(incidents);
  } catch (error) {
    console.error('Error fetching incidents:', error);
    res.status(500).json({ error: 'Failed to fetch incidents' });
  }
});

// GET /recommendations?limit=5 - Buscar recomendações
app.get('/recommendations', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.sub;
    const limit = parseInt(req.query.limit) || 5;

    const queryCmd = new QueryCommand({
      TableName: process.env.DYNAMODB_TABLE,
      KeyConditionExpression: 'id = :id AND begins_with(sk, :sk)',
      ExpressionAttributeValues: {
        ':id': userId,
        ':sk': 'REC#',
      },
      ScanIndexForward: false,
      Limit: limit
    });

    const result = await dynamoDb.send(queryCmd);
    const recommendations = result.Items || [];

    res.json(recommendations);
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    res.status(500).json({ error: 'Failed to fetch recommendations' });
  }
});

// GET /api/sla-credits - Verificar créditos SLA disponíveis
app.get('/api/sla-credits', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.sub;

    // Buscar configuração do usuário
    const configParams = {
      TableName: process.env.DYNAMODB_TABLE,
      Key: { id: userId, sk: 'CONFIG#ONBOARD' }
    };

    const configResult = await dynamoDb.send(new GetCommand(configParams));
    const config = configResult.Item;

    if (!config || !config.roleArn || !config.externalId) {
      return res.status(200).json({
        hasSupportPlan: false,
        supportLevel: 'none',
        availableCredits: 0,
        message: 'Nenhum plano de suporte AWS detectado'
      });
    }

    // Verificar nível de suporte via AWS Support API
    let supportLevel = 'basic';
    let availableCredits = 0;
    let message = '';

    try {
      const { support } = await getAssumedClients(config.roleArn, config.externalId, 'us-east-1');

      // Tentar uma operação que só funciona em planos pagos
      const testCommand = new DescribeSeverityLevelsCommand({});
      await support.send(testCommand);
      supportLevel = 'business'; // Se não lançou erro, é business ou enterprise
      availableCredits = 10000; // Crédito mensal típico para Business Support
      message = 'Plano Business Support detectado - Créditos SLA disponíveis';

    } catch (err) {
      if (err.name === 'SubscriptionRequiredException') {
        supportLevel = 'basic';
        availableCredits = 0;
        message = 'Plano Basic/Developer - Créditos SLA não disponíveis';
      } else {
        console.warn('Erro ao verificar suporte AWS:', err.message);
        supportLevel = config.supportLevel || 'unknown';
        availableCredits = 0;
        message = 'Não foi possível verificar o plano de suporte';
      }
    }

    // Buscar créditos já utilizados no mês atual
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const creditsQuery = new QueryCommand({
      TableName: process.env.DYNAMODB_TABLE,
      KeyConditionExpression: 'id = :id AND begins_with(sk, :sk)',
      FilterExpression: 'contains(createdAt, :month) AND #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':id': userId,
        ':sk': 'SLA#',
        ':month': currentMonth,
        ':status': 'REFUNDED',
      }
    });

    let usedCredits = 0;
    try {
      const creditsResult = await dynamoDb.send(creditsQuery);
      usedCredits = creditsResult.Items?.reduce((sum, item) => {
        return sum + (item.creditAmount || item.recoveredAmount || 0);
      }, 0) || 0;
    } catch (dbError) {
      console.warn('Erro ao buscar créditos utilizados:', dbError.message);
    }

    res.json({
      hasSupportPlan: supportLevel !== 'basic',
      supportLevel,
      availableCredits,
      usedCredits,
      remainingCredits: Math.max(0, availableCredits - usedCredits),
      message,
      lastChecked: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error checking SLA credits:', error);
    res.status(500).json({
      error: 'Failed to check SLA credits',
      message: 'Erro interno ao verificar créditos SLA'
    });
  }
});

// POST /api/sync-control - Controlar sincronização (ativar/desativar)
app.post('/api/sync-control', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { enabled, frequency = 'daily' } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Parameter "enabled" must be boolean' });
    }

    // Atualizar configurações de sincronização
    const updateParams = {
      TableName: process.env.DYNAMODB_TABLE,
      Key: { id: userId, sk: 'CONFIG#ONBOARD' },
      UpdateExpression: 'SET syncEnabled = :enabled, syncFrequency = :frequency, syncLastUpdated = :timestamp',
      ExpressionAttributeValues: {
        ':enabled': enabled,
        ':frequency': frequency,
        ':timestamp': new Date().toISOString()
      }
    };

    await dynamoDb.send(new UpdateCommand(updateParams));

    // Se desabilitando, cancelar próximas execuções
    if (!enabled) {
      // Aqui poderíamos integrar com EventBridge para cancelar regras
      console.log(`Sincronização desabilitada para usuário ${userId}`);
    }

    res.json({
      success: true,
      syncEnabled: enabled,
      syncFrequency: frequency,
      message: enabled ? 'Sincronização ativada' : 'Sincronização desativada'
    });

  } catch (error) {
    console.error('Error updating sync control:', error);
    res.status(500).json({
      error: 'Failed to update sync control',
      message: 'Erro ao atualizar controle de sincronização'
    });
  }
});

// GET /api/sync-status - Status da sincronização
app.get('/api/sync-status', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.sub;

    const configParams = {
      TableName: process.env.DYNAMODB_TABLE,
      Key: { id: userId, sk: 'CONFIG#ONBOARD' }
    };

    const configResult = await dynamoDb.send(new GetCommand(configParams));
    const config = configResult.Item;

    // Verificar última sincronização
    let lastSync = null;
    try {
      const syncQuery = new QueryCommand({
        TableName: process.env.DYNAMODB_TABLE,
        KeyConditionExpression: 'id = :id AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':id': userId,
          ':sk': 'SYNC#',
        },
        ScanIndexForward: false,
        Limit: 1
      });

      const syncResult = await dynamoDb.send(syncQuery);
      if (syncResult.Items && syncResult.Items.length > 0) {
        lastSync = syncResult.Items[0];
      }
    } catch (dbError) {
      console.warn('Erro ao buscar status de sync:', dbError.message);
    }

    res.json({
      syncEnabled: config?.syncEnabled ?? true,
      syncFrequency: config?.syncFrequency ?? 'daily',
      lastSync: lastSync?.timestamp || null,
      lastSyncStatus: lastSync?.status || 'never',
      nextSync: config?.syncEnabled ? calculateNextSync(config?.syncFrequency || 'daily', lastSync?.timestamp) : null
    });

  } catch (error) {
    console.error('Error fetching sync status:', error);
    res.status(500).json({
      error: 'Failed to fetch sync status',
      message: 'Erro ao buscar status de sincronização'
    });
  }
});

// Helper function to calculate next sync time
function calculateNextSync(frequency, lastSyncTime) {
  const now = new Date();
  const lastSync = lastSyncTime ? new Date(lastSyncTime) : now;

  switch (frequency) {
    case 'hourly':
      return new Date(lastSync.getTime() + 60 * 60 * 1000).toISOString();
    case 'daily':
      return new Date(lastSync.getTime() + 24 * 60 * 60 * 1000).toISOString();
    case 'weekly':
      return new Date(lastSync.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    default:
      return new Date(lastSync.getTime() + 24 * 60 * 60 * 1000).toISOString();
  }
}

// Helper function for CloudFormation response
async function sendCfnResponse(event, status, data) {
  const responseBody = JSON.stringify({
    Status: status,
    Reason: data.Message || 'See CloudWatch logs',
    PhysicalResourceId: event.RequestId || 'unknown',
    StackId: event.StackId || 'unknown',
    RequestId: event.RequestId || 'unknown',
    LogicalResourceId: event.LogicalResourceId || 'unknown',
    Data: data
  });

  const options = {
    hostname: require('url').parse(event.ResponseURL).hostname,
    port: 443,
    path: require('url').parse(event.ResponseURL).path,
    method: 'PUT',
    headers: {
      'Content-Type': '',
      'Content-Length': responseBody.length
    }
  };

  return new Promise((resolve, reject) => {
    const request = require('https').request(options, () => resolve());
    request.on('error', reject);
    request.write(responseBody);
    request.end();
  });
}

// Lambda handler
const handler = serverless(app);

module.exports = { app, handler };
