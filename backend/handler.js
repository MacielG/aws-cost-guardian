const serverless = require('serverless-http');
const express = require('express');
const AWS = require('aws-sdk');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const dynamoDb = new AWS.DynamoDB.DocumentClient();

const app = express();
app.use(express.json());

// Middleware i18n simplificado
app.use((req, res, next) => {
  req.locale = req.headers['accept-language'] || 'en';
  next();
});

// POST /api/onboard
app.post('/api/onboard', async (req, res) => {
  const { roleArn, email } = req.body;
  const params = {
    TableName: process.env.DYNAMODB_TABLE,
    Item: {
      id: email,
      roleArn,
      locale: req.locale,
      plan: 'free',
      createdAt: new Date().toISOString(),
    },
  };
  await dynamoDb.put(params).promise();
  res.json({ success: true, message: 'Onboarding completo!' });
});

// GET /api/incidents
app.get('/api/incidents', async (req, res) => {
  const params = {
    TableName: process.env.DYNAMODB_TABLE,
    FilterExpression: 'begins_with(id, :prefix)',
    ExpressionAttributeValues: { ':prefix': 'incident-' },
  };
  const data = await dynamoDb.scan(params).promise();
  res.json(data.Items || []);
});

// GET /api/sla-claims
app.get('/api/sla-claims', async (req, res) => {
  // Similar, filter por 'sla-'
  const params = {
    TableName: process.env.DYNAMODB_TABLE,
    FilterExpression: 'begins_with(id, :prefix)',
    ExpressionAttributeValues: { ':prefix': 'sla-' },
  };
  const data = await dynamoDb.scan(params).promise();
  res.json(data.Items || []);
});

// POST /api/stripe/webhook
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'charge.succeeded') {
    const refundAmount = event.data.object.amount / 100;
    const commission = refundAmount * 0.3;
    // Crie invoice
    await stripe.charges.create({
      amount: commission * 100,
      currency: 'usd',
      source: event.data.object.customer,
      description: `Commission on refund $${refundAmount}`,
    });
    // Salve em DB
  }

  res.json({ received: true });
});

module.exports.app = serverless(app);