const serverless = require('serverless-http');
const express = require('express');
const AWS = require('aws-sdk');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { randomBytes } = require('crypto');

const dynamoDb = new AWS.DynamoDB.DocumentClient();
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

// Middleware de autenticação
const authenticateUser = (req, res, next) => {
  try {
    if (req.apiGateway?.event?.requestContext?.authorizer?.claims) {
      req.user = req.apiGateway.event.requestContext.authorizer.claims;
      return next();
    }
    res.status(401).json({ message: 'Não autenticado' });
  } catch (error) {
    res.status(401).json({ message: 'Token inválido' });
  }
};

// GET /api/onboard-init
app.get('/api/onboard-init', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.sub;
    const externalId = randomBytes(16).toString('hex');

    const params = {
      TableName: process.env.DYNAMODB_TABLE,
      Item: {
        id: userId,
        sk: 'CONFIG#ONBOARD',
        externalId,
        status: 'PENDING_CFN',
        updatedAt: new Date().toISOString(),
      },
    };

    await dynamoDb.put(params).promise();

    res.json({
      externalId,
      platformAccountId: process.env.PLATFORM_ACCOUNT_ID
    });

  } catch (err) {
    console.error('Erro onboard-init:', err);
    res.status(500).json({ message: 'Erro na configuração de onboarding' });
  }
});

// POST /api/onboard
app.post('/api/onboard', authenticateUser, async (req, res) => {
  try {
    const { roleArn, awsAccountId } = req.body;
    const userId = req.user.sub;
    const email = req.user.email;

    // 1. Validar se a roleArn é válida (implementação futura)
    // 2. Salvar mapeamento
    const params = {
      TableName: process.env.DYNAMODB_TABLE,
      Item: {
        id: userId,
        sk: `ACCOUNT#${awsAccountId}`,
        roleArn,
        awsAccountId,
        email,
        plan: 'free',
        createdAt: new Date().toISOString(),
        locale: req.locale,
      },
    };

    await dynamoDb.put(params).promise();

    // 3. Atualizar status do onboarding
    await dynamoDb.update({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { id: userId, sk: 'CONFIG#ONBOARD' },
      UpdateExpression: 'SET #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'COMPLETED' }
    }).promise();

    res.json({ 
      success: true, 
      message: 'Onboarding completo!',
      accountId: awsAccountId
    });

  } catch (err) {
    console.error('Erro onboarding:', err);
    res.status(500).json({ success: false, message: 'Erro no processo de onboarding' });
  }
});

// GET /api/incidents (CORRIGIDO com Query)
app.get('/api/incidents', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.sub;
    
    const params = {
      TableName: process.env.DYNAMODB_TABLE,
      IndexName: 'CustomerDataIndex',
      KeyConditionExpression: 'id = :userId AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':prefix': 'INCIDENT#',
      },
    };
    const data = await dynamoDb.query(params).promise();
    res.json(data.Items || []);
  } catch (err) {
    console.error('Erro ao buscar incidentes:', err);
    res.status(500).json({ message: 'Erro ao buscar incidentes' });
  }
});

// GET /api/sla-claims (CORRIGIDO com Query)
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
    res.json(data.Items || []);
  } catch (err) {
    console.error('Erro ao buscar reivindicações:', err);
    res.status(500).json({ message: 'Erro ao buscar reivindicações' });
  }
});

// POST /api/stripe/webhook (LÓGICA CORRIGIDA)
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.warn(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Processar eventos de fatura
  if (event.type === 'invoice.paid') {
    const invoice = event.data.object;
    const commissionAmount = invoice.amount_paid / 100; // Valor em dólares
    const claimId = invoice.metadata.claimId; // Metadata setada ao criar a fatura

    console.log(`Comissão de $${commissionAmount} recebida para a Reivindicação: ${claimId}`);

    // Atualizar o status da reivindicação no DynamoDB para 'PAID'
    try {
      await dynamoDb.update({
        TableName: process.env.DYNAMODB_TABLE,
        Key: {
          id: invoice.customer, // Ou outro identificador apropriado
          sk: `CLAIM#${claimId}`
        },
        UpdateExpression: 'SET #status = :status, commissionAmount = :amount',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': 'PAID',
          ':amount': commissionAmount
        }
      }).promise();
    } catch (dbError) {
      console.error('Erro ao atualizar status da reivindicação:', dbError);
    }

  } else if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    console.warn(`Pagamento da fatura ${invoice.id} falhou.`);
    // Lógica para notificar o cliente pode ser adicionada aqui
  }

  res.json({ received: true });
});

module.exports.app = serverless(app);