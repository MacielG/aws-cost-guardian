const serverless = require('serverless-http');
const express = require('express');
const AWS = require('aws-sdk');

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const secretsManager = new AWS.SecretsManager();
const { randomBytes } = require('crypto');

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

// Para adicionar um usuário ao grupo 'Admins', use o Console da AWS ou a AWS CLI:
// aws cognito-idp admin-add-user-to-group --user-pool-id <user-pool-id> --username <user-sub> --group-name Admins


// GET /api/onboard-init
// NOTE: handler foi movido mais abaixo para incluir verificação de termos aceitos

// POST /api/onboard
app.post('/api/onboard', async (req, res) => {
  try {
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
app.get('/api/invoices', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.sub; // Este é o nosso Stripe Customer ID

    const invoices = await stripe.invoices.list({
      customer: userId,
      limit: 100, // Pega até 100 faturas
    });

    // Formata a resposta para o frontend
    const formattedInvoices = invoices.data.map(inv => ({
      id: inv.id,
      date: inv.created,
      amount: (inv.amount_due / 100).toFixed(2),
      status: inv.status, // ex: 'paid', 'open', 'draft'
      pdfUrl: inv.invoice_pdf,
      hostedUrl: inv.hosted_invoice_url,
    }));

    res.json(formattedInvoices);
  } catch (err) {
    console.error('Erro ao buscar faturas do Stripe:', err);
    res.status(500).json({ message: 'Erro ao buscar faturas' });
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
    const claimId = `CLAIM#${invoice.metadata.claimId}`; // Metadata setada ao criar a fatura
    const customerId = invoice.metadata.customerId;

    console.log(`Comissão de $${commissionAmount} recebida para a Reivindicação: ${claimId} do cliente ${customerId}`);

    // Atualizar o status da reivindicação no DynamoDB para 'PAID'
    try {
      await dynamoDb.update({
        TableName: process.env.DYNAMODB_TABLE,
        Key: {
          id: customerId, // Usar o ID do nosso sistema, vindo dos metadados
          sk: claimId
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
    const credit = claimData.Item.creditAmount;
    const creditFixed = credit.toFixed(2); // Para a descrição da fatura

    // 2. Mover a Lógica do Stripe para cá (de sla-workflow.js)
    const commissionAmount = Math.round(credit * 0.30 * 100); // 30% de comissão em centavos
    if (commissionAmount <= 50) { // Stripe tem um valor mínimo de cobrança (ex: $0.50)
      return res.status(400).json({ message: 'Comissão abaixo do mínimo faturável ($0.50)' });
    }

    // Obter ou criar o Stripe Customer ID
    const userConfigKey = { id: customerId, sk: 'CONFIG#ONBOARD' };
    const userConfig = await dynamoDb.get({ TableName: process.env.DYNAMODB_TABLE, Key: userConfigKey }).promise();

    let stripeCustomerId = userConfig.Item?.stripeCustomerId;

    if (!stripeCustomerId) {
      console.log(`Cliente Stripe não encontrado para ${customerId}. Criando um novo.`);
      const customer = await stripe.customers.create({
        description: `AWS Cost Guardian Customer ${customerId}`,
        metadata: { costGuardianUserId: customerId }
      });
      stripeCustomerId = customer.id;

      // Salvar o novo ID no DynamoDB para uso futuro
      await dynamoDb.update({
        TableName: process.env.DYNAMODB_TABLE,
        Key: userConfigKey,
        UpdateExpression: 'SET stripeCustomerId = :sid',
        ExpressionAttributeValues: { ':sid': stripeCustomerId }
      }).promise();
      console.log(`Novo cliente Stripe ${stripeCustomerId} criado e associado ao usuário ${customerId}.`);
    } else {
      console.log(`Cliente Stripe ${stripeCustomerId} encontrado para o usuário ${customerId}.`);
    }

    // Etapa 1: Criar um item de fatura pendente
    await stripe.invoiceItems.create({
      customer: stripeCustomerId,
      amount: commissionAmount,
      currency: 'usd',
      description: `Comissão de 30% sobre crédito SLA de $${creditFixed} (Incidente: ${claimId})`,
    });

    // Etapa 2: Criar a fatura a partir do item e finalizá-la
    const invoice = await stripe.invoices.create({
      customer: stripeCustomerId,
      collection_method: 'charge_automatically',
      auto_advance: true,
      metadata: { claimId: claimId, customerId: customerId },
    });
    const invoiceId = invoice.id;
    console.log(`Fatura ${invoiceId} criada no Stripe para o cliente ${customerId} no valor de ${commissionAmount / 100} USD.`);

    // 3. Atualizar a claim com o ID da fatura e status REFUNDED
    await dynamoDb.update({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { id: customerId, sk: fullClaimSk },
      UpdateExpression: 'SET #status = :status, stripeInvoiceId = :invId',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'REFUNDED', ':invId': invoiceId },
    }).promise();

    res.json({ success: true, invoiceId: invoiceId });

  } catch (err) {
    console.error('Erro ao criar fatura:', err);
    res.status(500).json({ message: 'Erro ao criar fatura Stripe' });
  }
});

module.exports.app = serverless(app);