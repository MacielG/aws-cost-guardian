const serverless = require('serverless-http');
const express = require('express');
const AWS = require('aws-sdk');

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const secretsManager = new AWS.SecretsManager();
const { randomBytes } = require('crypto');

const https = require('https');
const url = require('url');

let stripe;

// Async factory to initialize Stripe
const getStripe = async () => {
  if (stripe) {
    return stripe;
  }
  const secretData = await secretsManager.getSecretValue({
    SecretId: process.env.STRIPE_SECRET_ARN // Usando a variável de ambiente correta
  }).promise();
  const secret = JSON.parse(secretData.SecretString);
  stripe = require('stripe')(secret.key);
  return stripe;
};

const app = express();

// Middleware para parsing JSON (exceto para webhook Stripe)
app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe/webhook') {
    next();
  } else {
    express.json()(req, res, next);
  }
});

// Middleware i18n simplificado
app.use((req, res, next) => {
  req.locale = req.headers['accept-language']?.split(',')[0] || 'en';
  next();
});

// Health check público (sem autenticação) para testes e monitoramento
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Rota para criar sessão de checkout do Stripe
app.post('/api/billing/create-checkout-session', authenticateUser, async (req, res) => {
  try {
    const customerId = req.user.sub;
    const { stripeCustomerId } = req.body;

    if (!stripeCustomerId) {
      return res.status(400).json({ error: 'stripeCustomerId é obrigatório' });
    }

    const stripe = await getStripe();
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [{
        price: process.env.STRIPE_PRO_PLAN_PRICE_ID,
        quantity: 1,
      }],
      success_url: `${process.env.FRONTEND_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/billing`,
      metadata: {
        costGuardianCustomerId: customerId,
      }
    });

    res.status(200).json({ sessionId: session.id });
  } catch (error) {
    console.error('Erro ao criar sessão de checkout:', error);
    res.status(500).json({ error: 'Erro ao criar sessão de checkout' });
  }
});

// Rota para obter status da assinatura
app.get('/api/billing/subscription', authenticateUser, async (req, res) => {
  try {
    const customerId = req.user.sub;
    const config = (await dynamoDb.get({ 
      TableName: DYNAMODB_TABLE, 
      Key: { id: customerId, sk: 'CONFIG#ONBOARD' } 
    }).promise()).Item;

    res.status(200).json({
      status: config?.subscriptionStatus || 'inactive',
      stripeCustomerId: config?.stripeCustomerId,
      stripeSubscriptionId: config?.stripeSubscriptionId
    });
  } catch (error) {
    console.error('Erro ao obter status da assinatura:', error);
    res.status(500).json({ error: 'Erro ao obter status da assinatura' });
  }
});

// Rota para listar recomendações
app.get('/api/recommendations', authenticateUser, checkProPlan, async (req, res) => {
  try {
    const customerId = req.user.sub;
    
    // Buscar todas as recomendações do cliente
    const recommendations = await dynamoDb.query({
      TableName: DYNAMODB_TABLE,
      KeyConditionExpression: 'id = :id AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':id': customerId,
        ':prefix': 'REC#'
      }
    }).promise();

    res.status(200).json(recommendations.Items);
  } catch (error) {
    console.error('Erro ao listar recomendações:', error);
    res.status(500).json({ error: 'Erro ao listar recomendações' });
  }
});

// Rota para executar uma recomendação
app.post('/api/recommendations/:recommendationId/execute', authenticateUser, checkProPlan, async (req, res) => {
  const lambdaClient = new AWS.Lambda();
  const customerId = req.user.sub;
  const { recommendationId } = req.params;

  try {
    // Chamar o Lambda de execução
    const result = await lambdaClient.invoke({
      FunctionName: process.env.EXECUTE_RECOMMENDATION_LAMBDA_ARN,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify({
        requestContext: {
          authorizer: {
            claims: { sub: customerId }
          }
        },
        pathParameters: {
          recommendationId
        }
      })
    }).promise();

    const responsePayload = JSON.parse(result.Payload);
    res.status(responsePayload.statusCode).json(JSON.parse(responsePayload.body));
  } catch (error) {
    console.error('Erro ao executar recomendação:', error);
    res.status(500).json({ error: 'Erro ao executar recomendação' });
  }
});

// Rotas protegidas pelo plano Pro
app.get('/api/settings/automation', authenticateUser, checkProPlan, async (req, res) => {
  try {
    const customerId = req.user.sub;
    const config = req.customerConfig; // Config já verificada pelo checkProPlan

    res.status(200).json({
      enabled: config.automationEnabled || false,
      settings: config.automationSettings || {}
    });
  } catch (error) {
    console.error('Erro ao obter configurações de automação:', error);
    res.status(500).json({ error: 'Erro ao obter configurações de automação' });
  }
});

app.put('/api/settings/automation', authenticateUser, checkProPlan, async (req, res) => {
  try {
    const customerId = req.user.sub;
    const { enabled, settings } = req.body;

    await dynamoDb.update({
      TableName: DYNAMODB_TABLE,
      Key: { id: customerId, sk: 'CONFIG#ONBOARD' },
      UpdateExpression: 'SET automationEnabled = :enabled, automationSettings = :settings',
      ExpressionAttributeValues: {
        ':enabled': enabled,
        ':settings': settings
      }
    }).promise();

    res.status(200).json({ message: 'Configurações de automação atualizadas com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar configurações de automação:', error);
    res.status(500).json({ error: 'Erro ao atualizar configurações de automação' });
  }
});

// Middleware de autenticação
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

// Middleware para verificar JWT diretamente (fallback quando API Gateway não usa authorizer)
const verifyJwt = (req) => {
  const auth = req.headers?.authorization || req.headers?.Authorization;
  if (!auth) return null;
  const parts = auth.split(' ');
  if (parts.length !== 2) return null;
  const token = parts[1];

  const region = process.env.AWS_REGION || 'us-east-1';
  const userPoolId = process.env.USER_POOL_ID; // fornecido via CDK
  if (!userPoolId) return null;

  const client = jwksClient({
    jwksUri: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`,
  });

  function getKey(header, callback) {
    client.getSigningKey(header.kid, function (err, key) {
      if (err) return callback(err);
      const signingKey = key.getPublicKey();
      callback(null, signingKey);
    });
  }

  try {
    const decoded = jwt.verify(token, getKey, {
      algorithms: ['RS256'],
      audience: process.env.USER_POOL_CLIENT_ID || undefined,
      issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
    });
    return decoded;
  } catch (err) {
    console.warn('JWT verification failed:', err.message);
    return null;
  }
};

// Helper function para atualizar status da assinatura
async function updateSubscriptionStatus(customerId, status, subscriptionId) {
  await dynamoDb.update({
    TableName: DYNAMODB_TABLE,
    Key: { id: customerId, sk: 'CONFIG#ONBOARD' },
    UpdateExpression: 'SET subscriptionStatus = :status, stripeSubscriptionId = :subId',
    ExpressionAttributeValues: {
      ':status': status,
      ':subId': subscriptionId,
    }
  }).promise();
}

const authenticateUser = (req, res, next) => {
  try {
    // If API Gateway authorizer populated claims, use them
    if (req.apiGateway?.event?.requestContext?.authorizer?.claims) {
      req.user = req.apiGateway.event.requestContext.authorizer.claims;
      return next();
    }

    // Otherwise attempt direct JWT verification
    const claims = verifyJwt(req);
    if (claims) {
      req.user = claims;
      return next();
    }

    res.status(401).json({ message: 'Não autenticado' });
  } catch (error) {
    console.error('authenticateUser error:', error);
    res.status(401).json({ message: 'Token inválido' });
  }
};

// Valid statuses for admin updates
const VALID_ADMIN_STATUSES = ['READY_TO_SUBMIT', 'SUBMITTED', 'SUBMISSION_FAILED', 'PAID', 'REFUNDED', 'NO_VIOLATION', 'NO_RESOURCES_LISTED', 'REPORT_FAILED'];


// Middleware de autorização para Admins
const authorizeAdmin = (req, res, next) => {
  const userGroups = req.user?.['cognito:groups'];
  if (userGroups && userGroups.includes('Admins')) {
    return next();
  }
  res.status(403).json({ message: 'Acesso negado. Requer privilégios de administrador.' });
};

// Helper functions and middleware

// Middleware para verificar plano Pro
const checkProPlan = async (req, res, next) => {
  const customerId = req.user.sub;
  const config = (await dynamoDb.get({ TableName: DYNAMODB_TABLE, Key: { id: customerId, sk: 'CONFIG#ONBOARD' } }).promise()).Item;

  if (config && config.subscriptionStatus === 'active') {
    req.customerConfig = config; // Passa a config para a próxima rota
    return next(); // Permite o acesso
  }

  res.status(403).send({ 
    error: 'Acesso negado. Esta funcionalidade requer um plano Pro.' 
  });
};

// Para adicionar um usuário ao grupo 'Admins', use o Console da AWS ou a AWS CLI:
// aws cognito-idp admin-add-user-to-group --user-pool-id <user-pool-id> --username <user-sub> --group-name Admins

// POST /api/admin/claims/{customerId}/{claimId}/retry
app.post('/api/admin/claims/:customerId/:claimId/retry', authenticateUser, authorizeAdmin, async (req, res) => {
  const { customerId, claimId } = req.params;
  const claimSk = `CLAIM#${claimId.replace('CLAIM#', '')}`;

  try {
    // 1. Obter a claim para encontrar o incidente original
    const claim = (await dynamoDb.get({ TableName: DYNAMODB_TABLE, Key: { id: customerId, sk: claimSk } }).promise()).Item;
    if (!claim || !claim.incidentId) {
      return res.status(404).send({ error: 'Incidente original não encontrado.' });
    }

    // 2. Obter o incidente original para o payload do evento
    const incident = (await dynamoDb.get({ TableName: DYNAMODB_TABLE, Key: { id: customerId, sk: claim.incidentId } }).promise()).Item;
    if (!incident || !incident.details) {
      return res.status(404).send({ error: 'Payload do evento original não encontrado.' });
    }

    // 3. Re-iniciar a SFN
    await sfn.startExecution({
      stateMachineArn: process.env.SFN_ARN,
      input: JSON.stringify({
        customerId: customerId,
        awsAccountId: incident.awsAccountId,
        healthEvent: incident.details, // Payload original
        incidentId: claim.incidentId,
      }),
    }).promise();

    // 4. Resetar o status da claim
    await dynamoDb.update({
      TableName: DYNAMODB_TABLE,
      Key: { id: customerId, sk: claimSk },
      UpdateExpression: 'SET #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'RETRYING' }
    }).promise();

    res.status(200).send({ message: 'Fluxo de SLA reiniciado.' });
  } catch (err) {
    console.error('Erro ao reiniciar fluxo de SLA:', err);
    res.status(500).send({ error: err.message });
  }
});

// GET /api/onboard-init
// NOTE: handler foi movido mais abaixo para incluir verificação de termos aceitos

// POST /api/billing/create-checkout-session
app.post('/api/billing/create-checkout-session', authenticateUser, async (req, res) => {
  try {
    const customerId = req.user.sub;
    const { stripeCustomerId } = req.body;

    if (!stripeCustomerId) {
      return res.status(400).json({ error: 'stripeCustomerId é obrigatório' });
    }

    const stripe = await getStripe();
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [{
        price: process.env.STRIPE_PRO_PLAN_PRICE_ID,
        quantity: 1,
      }],
      success_url: `${process.env.FRONTEND_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/billing`,
      metadata: {
        costGuardianCustomerId: customerId,
      }
    });

    res.status(200).json({ sessionId: session.id });
  } catch (error) {
    console.error('Erro ao criar sessão de checkout:', error);
    res.status(500).json({ error: 'Erro ao criar sessão de checkout' });
  }
});

// POST /api/onboard
app.post('/api/onboard', async (req, res) => {
  try {
    const event = req.body;

    // Se for callback do CloudFormation Custom Resource, o payload vem com ResourceProperties
    if (event && event.ResourceProperties) {
      const props = event.ResourceProperties;

      // Aceita tanto PascalCase (CFN) quanto camelCase (possível envio direto)
      const roleArnVal = props.RoleArn || props.roleArn;
      const awsAccountIdVal = props.AwsAccountId || props.awsAccountId;
      const externalIdVal = props.ExternalId || props.externalId;
      const customerId = props.CustomerId || props.customerId;

      // Se o cliente passou CustomerId (integração direta com nosso fluxo), usamos o fluxo CFN
      if (customerId && roleArnVal && awsAccountIdVal && externalIdVal) {
        const pk = customerId;
        const sk = 'CONFIG#ONBOARD';

        // Verificar o nível de suporte AWS
      let supportLevel = 'basic';
      try {
        const { support } = await getAssumedClients(roleArnVal, 'us-east-1');
        await support.describeSeverityLevels().promise();
        supportLevel = 'business'; // Se não lançar erro, é business ou enterprise
      } catch (err) {
        if (err.name === 'SubscriptionRequiredException') {
          console.log(`Cliente ${customerId} está no plano Basic/Developer.`);
          supportLevel = 'basic';
        } else {
          console.error('Erro ao verificar nível de suporte:', err);
          // Continue como 'basic' em caso de erro
        }
      }

      const params = {
        TableName: process.env.DYNAMODB_TABLE,
        Item: {
          id: pk,
          sk: sk,
          awsAccountId: awsAccountIdVal,
          roleArn: roleArnVal,
          externalId: externalIdVal,
          status: 'ACTIVE',
          supportLevel: supportLevel,
          createdAt: new Date().toISOString(),
        },
      };

      await dynamoDb.put(params).promise();
        console.log(`Onboarding concluído para Cliente: ${customerId}, Conta AWS: ${awsAccountIdVal}`);

        // Responde ao CloudFormation que a criação foi bem-sucedida (se houver ResponseURL)
        if (event.ResponseURL) {
          try {
            await sendCfnResponse(event, 'SUCCESS', { Message: 'Onboarding bem-sucedido.' });
          } catch (err) {
            console.error('Erro ao enviar resposta SUCCESS ao CFN:', err);
          }
        }

        return res.status(200).send();
      }

      // Caso não venha CustomerId (ex: CallbackFunction do cliente que envia roleArn/awsAccountId/externalId em camelCase),
      // caímos no comportamento legado e deixamos o fluxo abaixo tratar o mapeamento via externalId.
    }

    // --- comportamento legado / fallback (quando chamado pelo frontend) ---
    const { roleArn, awsAccountId, externalId } = req.body;

    // 1. Encontrar o usuário pelo externalId para validar o callback
    const configQuery = await dynamoDb.query({
      TableName: process.env.DYNAMODB_TABLE,
      IndexName: 'ExternalIdIndex', // GSI necessário: externalId -> userId
      KeyConditionExpression: 'externalId = :externalId',
      ExpressionAttributeValues: { ':externalId': externalId },
    }).promise();

    if (!configQuery.Items || configQuery.Items.length === 0) {
      return res.status(404).json({ success: false, message: 'Configuração de onboarding não encontrada para o ExternalId.' });
    }
      const userConfig = configQuery.Items[0];
      const userId = userConfig.id;
    // 2. Salvar mapeamento da conta do cliente
    const params = {
      TableName: process.env.DYNAMODB_TABLE,
      Item: {
        id: userId,
        sk: `ACCOUNT#${awsAccountId}`,
        roleArn,
        awsAccountId,
        plan: 'free',
        createdAt: new Date().toISOString(),
        locale: req.locale,
      },
    };

    await dynamoDb.put(params).promise();

    // 3. Atualizar status do onboarding para COMPLETED
    // Também salvamos o roleArn no item CONFIG#ONBOARD para permitir que
    // processos automáticos (ingestor, automações) assumam a role do cliente.
    await dynamoDb.update({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { id: userId, sk: 'CONFIG#ONBOARD' },
      UpdateExpression: 'SET #status = :status, roleArn = :roleArn',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'COMPLETED', ':roleArn': roleArn }
    }).promise();

    res.json({ 
      success: true,
      message: 'Onboarding completo!',
      accountId: awsAccountId
    });

  } catch (err) {
    console.error('Erro onboarding:', err);

    // Se foi uma chamada do CFN, tente notificar o CloudFormation sobre a falha
    if (req.body && req.body.ResourceProperties) {
      try {
        await sendCfnResponse(req.body, 'FAILED', { Message: err.message || 'Erro interno.' });
      } catch (sendErr) {
        console.error('Erro ao enviar resposta FAILURE para o CloudFormation:', sendErr);
      }
    }

    res.status(500).json({ success: false, message: 'Erro no processo de onboarding' });
  }
});

// POST /api/accept-terms
app.post('/api/accept-terms', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.sub;

    // Atualiza um item de configuração ou o próprio perfil do usuário
    await dynamoDb.update({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { id: userId, sk: 'CONFIG#ONBOARD' }, // Ou um item de perfil
      UpdateExpression: 'SET termsAccepted = :accepted, termsAcceptedAt = :timestamp',
      ExpressionAttributeValues: {
        ':accepted': true,
        ':timestamp': new Date().toISOString(),
      }
    }).promise();

    res.json({ success: true, message: 'Termos aceitos com sucesso.' });
  } catch (err) {
    console.error('Erro ao aceitar termos:', err);
    res.status(500).json({ success: false, message: 'Erro ao registrar aceitação dos termos.' });
  }
});

// GET /api/incidents (CORRIGIDO com Query)
app.get('/api/onboard-init', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.sub;

    // Tenta recuperar a configuração existente
    const getParams = {
      TableName: process.env.DYNAMODB_TABLE,
      Key: { id: userId, sk: 'CONFIG#ONBOARD' },
    };

    const existing = await dynamoDb.get(getParams).promise();
    if (existing && existing.Item) {
      const item = existing.Item;
      return res.json({
        externalId: item.externalId,
        platformAccountId: process.env.PLATFORM_ACCOUNT_ID,
        status: item.status || 'PENDING_CFN',
        termsAccepted: !!item.termsAccepted,
      });
    }

    // Se não existir, cria um novo registro de configuração
    const externalId = randomBytes(16).toString('hex');
    const putParams = {
      TableName: process.env.DYNAMODB_TABLE,
      Item: {
        id: userId,
        sk: 'CONFIG#ONBOARD',
        externalId,
        status: 'PENDING_CFN',
        createdAt: new Date().toISOString(),
      },
    };

    await dynamoDb.put(putParams).promise();

      // Tentar criar Customer no Stripe antecipadamente (se tivermos e-mail disponível no token)
      try {
        const userEmail = req.user?.email || req.user?.email_address || req.user?.["cognito:email"];
        if (userEmail) {
          const stripeClient = await getStripe();
          const customer = await stripeClient.customers.create({
            email: userEmail,
            metadata: { costGuardianCustomerId: userId }
          });
          if (customer && customer.id) {
            await dynamoDb.update({ TableName: process.env.DYNAMODB_TABLE, Key: { id: userId, sk: 'CONFIG#ONBOARD' }, UpdateExpression: 'SET stripeCustomerId = :sid', ExpressionAttributeValues: { ':sid': customer.id } }).promise();
            console.log(`Stripe customer antecipado criado para ${userId}: ${customer.id}`);
          }
        }
      } catch (stripeErr) {
        // Não falhar o onboarding por causa de problemas com Stripe; apenas logar
        console.error('Falha ao criar stripeCustomerId antecipado:', stripeErr);
      }

    res.json({
      externalId,
      platformAccountId: process.env.PLATFORM_ACCOUNT_ID,
      status: 'PENDING_CFN',
      termsAccepted: false,
    });

  } catch (err) {
    console.error('Erro onboard-init:', err);
    res.status(500).json({ message: 'Erro na configura\u00e7\u00e3o de onboarding' });
  }
});
// GET /api/dashboard/costs
// Protegido por autenticação Cognito
app.get('/api/dashboard/costs', authenticateUser, async (req, res) => {
  try {
    const customerId = req.user.sub;

    const params = {
      TableName: process.env.DYNAMODB_TABLE,
      KeyConditionExpression: 'id = :id AND begins_with(sk, :sk)',
      ExpressionAttributeValues: {
        ':id': customerId,
        ':sk': 'COST#DASHBOARD#',
      },
      Limit: 1,
      ScanIndexForward: false,
    };

    const data = await dynamoDb.query(params).promise();

    if (!data.Items || data.Items.length === 0) {
      return res.status(404).send({ message: 'Nenhum dado de custo encontrado.' });
    }

    return res.status(200).json(data.Items[0].data);
  } catch (err) {
    console.error('Erro ao buscar dados do dashboard:', err);
    return res.status(500).send({ error: 'Falha ao buscar dados.' });
  }
});

// GET /api/settings/automation
// Retorna as preferências de automação do usuário (CONFIG#ONBOARD)
app.get('/api/settings/automation', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.sub;
    const params = { TableName: process.env.DYNAMODB_TABLE, Key: { id: userId, sk: 'CONFIG#ONBOARD' } };
    const data = await dynamoDb.get(params).promise();
    const item = data.Item || {};
    const settings = item.automationSettings || {};

    return res.json({ 
      automation: {
        stopIdle: !!settings.stopIdleInstances,
        deleteUnusedEbs: !!settings.deleteUnusedEbs,
        exclusionTags: settings.exclusionTags || '',
      }
    });
  } catch (err) {
    console.error('Erro ao buscar settings de automação:', err);
    return res.status(500).json({ error: 'Falha ao buscar configurações.' });
  }
});

// POST /api/settings/automation
// Body: { automation: { stopIdle: true, deleteUnusedEbs: false, exclusionTags?: string } }
app.post('/api/settings/automation', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { automation } = req.body;
    if (!automation || typeof automation !== 'object') {
      return res.status(400).json({ message: 'automation inválido' });
    }

    // Validar as tags de exclusão
    if (automation.exclusionTags && typeof automation.exclusionTags !== 'string') {
      return res.status(400).json({ message: 'exclusionTags deve ser uma string' });
    }

    await dynamoDb.update({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { id: userId, sk: 'CONFIG#ONBOARD' },
      UpdateExpression: 'SET automationSettings = :a',
      ExpressionAttributeValues: {
        ':a': {
          stopIdleInstances: !!automation.stopIdle,
          deleteUnusedEbs: !!automation.deleteUnusedEbs,
          exclusionTags: automation.exclusionTags || null,
        },
      },
    }).promise();

    return res.json({ success: true });
  } catch (err) {
    console.error('Erro ao salvar settings de automação:', err);
    return res.status(500).json({ error: 'Falha ao salvar configurações.' });
  }
});
// GET /api/sla-claims
app.get('/api/sla-claims', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.sub;

    const params = {
      TableName: process.env.DYNAMODB_TABLE,
      IndexName: 'CustomerDataIndex',
      KeyConditionExpression: 'id = :userId AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':prefix': 'CLAIM#',
      },
    };
    const data = await dynamoDb.query(params).promise();

    const items = data.Items || [];
    const formatted = items.map(it => ({
      id: it.id,
      sk: it.sk,
      status: it.status,
      creditAmount: it.creditAmount,
      reportUrl: it.reportUrl,
      incidentId: it.incidentId,
      awsAccountId: it.awsAccountId,
      stripeInvoiceId: it.stripeInvoiceId,
      caseId: it.caseId,
      submissionError: it.submissionError || it.reportError || null,
      commissionAmount: it.commissionAmount || null,
    }));

    res.json(formatted);
  } catch (err) {
    console.error('Erro ao buscar reivindicações:', err);
    res.status(500).json({ message: 'Erro ao buscar reivindicações' });
  }
});

// GET /api/invoices
// GET /api/alerts
app.get('/api/alerts', authenticateUser, async (req, res) => {
  try {
    const customerId = req.user.sub;
    const params = {
      TableName: process.env.DYNAMODB_TABLE,
      KeyConditionExpression: 'id = :id AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':id': customerId,
        ':prefix': 'ALERT#ANOMALY#',
      },
      ScanIndexForward: false, // Mais recentes primeiro
      Limit: 50, // Paginação simples — retorna até 50 alertas
    };
    const data = await dynamoDb.query(params).promise();
    const items = (data.Items || []).map(alert => ({
      id: alert.id,
      sk: alert.sk,
      date: alert.date || alert.createdAt,
      detail: alert.detail,
      status: alert.status || 'active',
    }));
    res.json(items);
  } catch (err) {
    console.error('Erro ao buscar alertas:', err);
    res.status(500).json({ message: 'Erro ao buscar alertas' });
  }
});
app.get('/api/invoices', authenticateUser, async (req, res) => {
  try {
    const customerId = req.user.sub;

    // Recupera stripeCustomerId do item CONFIG#ONBOARD
    const cfg = (await dynamoDb.get({ TableName: process.env.DYNAMODB_TABLE, Key: { id: customerId, sk: 'CONFIG#ONBOARD' } }).promise()).Item;
    const stripeCustomerId = cfg?.stripeCustomerId;

    if (!stripeCustomerId) {
      // Cliente ainda não vinculou conta Stripe
      return res.status(200).json([]);
    }

    const stripeClient = await getStripe();
    const invoices = await stripeClient.invoices.list({
      customer: stripeCustomerId,
      limit: 20, // Página simples
    });

    // Formata a resposta para o frontend
    const formattedInvoices = (invoices.data || []).map(inv => ({
      id: inv.id,
      date: inv.created,
      amount: inv.amount_due != null ? (inv.amount_due / 100).toFixed(2) : null,
      status: inv.status,
      pdfUrl: inv.invoice_pdf,
      hostedUrl: inv.hosted_invoice_url,
    }));

    res.json(formattedInvoices);
  } catch (err) {
    console.error('Erro ao buscar faturas do Stripe:', err);
    res.status(500).json({ message: 'Erro ao buscar faturas' });
  }
});

// POST /api/stripe/webhook (LÓGICA CORRIGIDA E SECRETO VIA SECRETS MANAGER)
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  try {
    // Ensure stripe client is initialized
    const stripeClient = await getStripe();

    // Obtain webhook secret from Secrets Manager if ARN provided, otherwise fallback to env var
    let endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (process.env.STRIPE_WEBHOOK_SECRET_ARN) {
      try {
        const secretVal = await secretsManager.getSecretValue({ SecretId: process.env.STRIPE_WEBHOOK_SECRET_ARN }).promise();
        // Try parse JSON then fallback to raw string
        if (secretVal && secretVal.SecretString) {
          try {
            const parsed = JSON.parse(secretVal.SecretString);
            endpointSecret = parsed.webhook || parsed.WEBHOOK || secretVal.SecretString;
          } catch (_) {
            endpointSecret = secretVal.SecretString;
          }
        }
      } catch (err) {
        console.error('Erro ao recuperar STRIPE_WEBHOOK_SECRET do SecretsManager:', err);
        return res.status(500).send('Webhook secret not available');
      }
    }

    let event;
    try {
      event = stripeClient.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.warn(`Webhook Error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Processar eventos de assinatura
    if (event.type === 'checkout.session.completed') {
      const data = event.data.object;
      const customerId = data.metadata.costGuardianCustomerId;
      const subscriptionId = data.subscription;
      // Atualiza o usuário para ATIVO — envolver em try/catch para não quebrar processamento do webhook
      try {
        await updateSubscriptionStatus(customerId, 'active', subscriptionId);
      } catch (uErr) {
        console.error('Falha ao atualizar status de assinatura (checkout.session.completed):', { customerId, subscriptionId, error: uErr });
        // Não retornar 500 para Stripe a menos que seja necessário; este erro é logado para investigação
      }
    }

    // Lida com renovações falhadas ou cancelamentos
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const data = event.data.object;
      try {
        const stripeCustomer = await (await getStripe()).customers.retrieve(data.customer);
        const customerId = stripeCustomer.metadata.costGuardianCustomerId;
        // Atualiza o usuário para CANCELED ou PAST_DUE
        try {
          await updateSubscriptionStatus(customerId, data.status, data.id);
        } catch (uErr) {
          console.error('Falha ao atualizar status de assinatura (subscription.updated/deleted):', { customerId, subscriptionId: data.id, status: data.status, error: uErr });
        }
      } catch (retrErr) {
        console.error('Falha ao recuperar Stripe Customer dentro do webhook:', { stripeCustomerId: data.customer, error: retrErr });
      }
    }

    // Processar eventos de fatura
    if (event.type === 'invoice.paid') {
      const invoice = event.data.object;
      const commissionAmount = invoice.amount_paid / 100; // Valor em dólares
      const claimSk = invoice.metadata?.costGuardianClaimId || `CLAIM#${invoice.metadata?.claimId}`;
      const customerId = invoice.metadata?.costGuardianCustomerId || invoice.metadata?.customerId;

      console.log(`Comissão de $${commissionAmount} recebida para a Reivindicação: ${claimSk} do cliente ${customerId}`);

      // Atualizar o status da reivindicação no DynamoDB para 'COMMISSION_PAID'
      try {
        await dynamoDb.update({
          TableName: process.env.DYNAMODB_TABLE,
          Key: { id: customerId, sk: claimSk },
          UpdateExpression: 'SET #status = :status, commissionAmount = :amount',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':status': 'COMMISSION_PAID', ':amount': commissionAmount }
        }).promise();
      } catch (dbError) {
        console.error('Erro ao atualizar status da reivindicação (commission paid):', dbError);
      }

    } else if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      console.warn(`Pagamento da fatura ${invoice.id} falhou.`);
      // Lógica para notificar o cliente pode ser adicionada aqui
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('Erro no webhook do Stripe:', err);
    return res.status(500).send('Internal error');
  }
});

// --- ENDPOINTS DE ADMIN ---

// GET /api/admin/claims
app.get('/api/admin/claims', authenticateUser, authorizeAdmin, async (req, res) => {
  try {
    const { nextToken, limit = 50, status } = req.query;
    
    // Usa o novo GSI para consultas de admin mais eficientes
    const params = {
      TableName: process.env.DYNAMODB_TABLE,
      IndexName: 'AdminViewIndex',
      KeyConditionExpression: 'entityType = :type',
      ExpressionAttributeValues: {
        ':type': 'CLAIM',
      },
      // Ordenar por mais recentes primeiro
      ScanIndexForward: false,
      // Limite padrão de 50 itens por página
      Limit: Math.min(parseInt(limit) || 50, 100),
    };

    // Adiciona filtro de status se fornecido
    if (status) {
      params.FilterExpression = '#status = :status';
      params.ExpressionAttributeNames = { '#status': 'status' };
      params.ExpressionAttributeValues[':status'] = status;
    }

    // Suporte a paginação
    if (nextToken) {
      params.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
    }

    const data = await dynamoDb.query(params).promise();

    res.json({
      items: data.Items,
      nextToken: data.LastEvaluatedKey 
        ? Buffer.from(JSON.stringify(data.LastEvaluatedKey)).toString('base64')
        : null,
    });
  } catch (err) {
    console.error('Erro ao buscar todas as reivindicações (admin):', err);
    res.status(500).json({ message: 'Erro ao buscar reivindicações para admin' });
  }
});

// PUT /api/admin/claims/{customerId}/{claimId}/status
app.put('/api/admin/claims/:customerId/:claimId/status', authenticateUser, authorizeAdmin, async (req, res) => {
  const { customerId, claimId } = req.params;
  const { status } = req.body;

  if (!status || !VALID_ADMIN_STATUSES.includes(status)) {
    return res.status(400).json({ message: 'Status inválido fornecido.' });
  }

  const fullClaimSk = `CLAIM#${claimId}`;

  try {
    await dynamoDb.update({
      TableName: process.env.DYNAMODB_TABLE,
      Key: {
        id: customerId,
        sk: fullClaimSk,
      },
      UpdateExpression: 'SET #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': status,
      },
    }).promise();
    res.json({ success: true, message: `Status da reivindicação ${claimId} atualizado para ${status}.` });
  } catch (err) {
    console.error(`Erro ao atualizar status da reivindicação ${claimId} para ${status}:`, err);
    res.status(500).json({ message: 'Erro ao atualizar status da reivindicação.' });
  }
});

// POST /api/admin/claims/{customerId}/{claimId}/create-invoice
app.post('/api/admin/claims/:customerId/:claimId/create-invoice', authenticateUser, authorizeAdmin, async (req, res) => {
  const { customerId, claimId } = req.params;
  const stripe = await getStripe(); // Initialize Stripe
  const fullClaimSk = `CLAIM#${claimId}`;

  try {
    // 1. Buscar a claim para obter o valor do crédito
    const claimData = await dynamoDb.get({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { id: customerId, sk: fullClaimSk },
    }).promise();

    if (!claimData.Item) {
      return res.status(404).json({ message: 'Claim não encontrada' });
    }

    // A claim deve estar com status 'PAID' (recebeu crédito da AWS) antes de gerar a fatura
    if (claimData.Item.status !== 'PAID') {
      return res.status(400).json({ message: 'A claim deve estar com status PAID para gerar fatura.' });
    }

    const credit = claimData.Item.creditAmount;
    const creditFixed = credit.toFixed(2); // Para a descrição da fatura

    // 2. Calcular comissão (30%)
    const commissionAmount = Math.round(credit * 0.30 * 100); // 30% de comissão em centavos
    if (commissionAmount <= 50) { // Stripe tem um valor mínimo de cobrança (ex: $0.50)
      return res.status(200).json({ message: 'Comissão muito baixa, fatura não gerada.' });
    }

    // Obter ou criar o Stripe Customer ID
    const userConfigKey = { id: customerId, sk: 'CONFIG#ONBOARD' };
    const userConfig = await dynamoDb.get({ TableName: process.env.DYNAMODB_TABLE, Key: userConfigKey }).promise();

    let stripeCustomerId = userConfig.Item?.stripeCustomerId;
    if (!stripeCustomerId) {
      // Não criamos stripeCustomerId reativamente aqui. Exija que ele exista previamente (criado no onboarding).
      return res.status(400).json({ message: 'stripeCustomerId não encontrado. Crie o cliente Stripe durante o onboarding ou via endpoint apropriado antes de gerar faturas.' });
    }

    // Criar item de fatura
    await stripe.invoiceItems.create({ customer: stripeCustomerId, amount: commissionAmount, currency: 'usd', description: `Comissão de 30% sobre crédito SLA de $${creditFixed} (Claim: ${claimId})` });

    // Criar a fatura com metadados para rastrear a claim
    const invoice = await stripe.invoices.create({ customer: stripeCustomerId, collection_method: 'charge_automatically', auto_advance: true, metadata: { claimId: claimId, customerId: customerId } });

    // Atualizar a claim com o ID da fatura e marcar como 'INVOICED'
    await dynamoDb.update({ TableName: process.env.DYNAMODB_TABLE, Key: { id: customerId, sk: fullClaimSk }, UpdateExpression: 'SET stripeInvoiceId = :invId, commissionAmount = :comm, #status = :s', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':invId': invoice.id, ':comm': commissionAmount / 100, ':s': 'INVOICED' } }).promise();

    res.status(201).json({ invoiceId: invoice.id, status: invoice.status });

  } catch (err) {
    console.error('Erro ao criar fatura:', err);
    res.status(500).json({ message: 'Erro ao criar fatura Stripe' });
  }
});

/**
 * Função helper obrigatória para enviar a resposta de volta ao S3 (via presigned URL)
 * para o CloudFormation Custom Resource.
 */
async function sendCfnResponse(event, responseStatus, responseData) {
  if (!event || !event.ResponseURL) {
    console.warn('sendCfnResponse: evento sem ResponseURL - pulando envio para o CloudFormation.');
    return;
  }
  const responseBody = JSON.stringify({
    Status: responseStatus,
    Reason: 'Veja detalhes nos logs do CloudWatch: ' + (responseData.Message || 'Sem mensagem'),
    PhysicalResourceId: event.PhysicalResourceId || `cost-guardian-onboard-${event.LogicalResourceId}`,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: responseData,
  });

  const parsedUrl = url.parse(event.ResponseURL);
  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: 'PUT',
    headers: {
      'Content-Type': '',
      'Content-Length': Buffer.byteLength(responseBody),
    },
  };

  return new Promise((resolve, reject) => {
    const request = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk.toString()));
      res.on('end', () => {
        console.log(`CFN Response Status: ${res.statusCode}`, body);
        if (res.statusCode >= 400) {
          return reject(new Error(`Resposta CFN com status ${res.statusCode}`));
        }
        resolve();
      });
    });

    request.on('error', (error) => {
      console.error('Falha ao enviar resposta ao CFN:', error);
      reject(error);
    });

    // Timeout para evitar hanging
    request.setTimeout(10000, () => {
      request.abort();
      reject(new Error('Timeout ao enviar resposta ao CloudFormation'));
    });

    request.write(responseBody);
    request.end();
  });
}

// Export the raw Express app for unit testing (supertest)
module.exports.rawApp = app;

// Export the serverless-wrapped handler for deployment
module.exports.app = serverless(app);