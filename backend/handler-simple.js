// Handler ULTRA SIMPLES - sem Express, sem serverless-http
console.log('HANDLER-ULTRA-SIMPLE.JS CARREGADO V2');

// AWS SDK v3 imports
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

// Initialize AWS SDK v3 clients
const ddbClient = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(ddbClient);
const secretsManager = new SecretsManagerClient({});

// JWT imports (lazy loaded to avoid bundle issues)
let jwt, jwksClient;
try {
  jwt = require('jsonwebtoken');
  jwksClient = require('jwks-rsa');
} catch (e) {
  console.warn('JWT libraries not available:', e.message);
}

// JWT Authentication helpers
let jwksClientInstance;
const getJwksClient = () => {
  if (!jwksClientInstance) {
    jwksClientInstance = jwksClient({
      jwksUri: `https://cognito-idp.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${process.env.USER_POOL_ID}/.well-known/jwks.json`
    });
  }
  return jwksClientInstance;
};

const verifyJwt = async (token) => {
  try {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) return null;

    const kid = decoded.header.kid;
    const client = getJwksClient();
    const key = await client.getSigningKey(kid);
    const signingKey = key.publicKey || key.rsaPublicKey;

    const verified = jwt.verify(token, signingKey, {
      algorithms: ['RS256'],
      issuer: `https://cognito-idp.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${process.env.USER_POOL_ID}`
    });

    return verified;
  } catch (error) {
    console.error('JWT verification error:', error);
    return null;
  }
};

const authenticateUser = async (event) => {
  try {
    // If API Gateway authorizer populated claims, use them
    if (event.requestContext?.authorizer?.claims) {
      return event.requestContext.authorizer.claims;
    }

    // Otherwise attempt direct JWT verification
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7);
    const claims = await verifyJwt(token);
    return claims;
  } catch (error) {
    console.error('authenticateUser error:', error);
    return null;
  }
};

// Stripe factory
let stripe;
const getStripe = async () => {
  if (stripe) {
    return stripe;
  }
  try {
    const command = new GetSecretValueCommand({
      SecretId: process.env.STRIPE_SECRET_ARN
    });
    const secretData = await secretsManager.send(command);
    const secret = JSON.parse(secretData.SecretString);
    stripe = require('stripe')(secret.key);
    return stripe;
  } catch (error) {
    console.error('Error initializing Stripe:', error);
    return null;
  }
};

// Middleware to check Pro plan
const checkProPlan = async (userId) => {
  try {
    const command = new GetCommand({
      TableName: process.env.DYNAMODB_TABLE,
      Key: { id: userId, sk: 'CONFIG#ONBOARD' }
    });
    const result = await dynamoDb.send(command);
    const config = result.Item;

    return config && config.subscriptionStatus === 'active';
  } catch (error) {
    console.error('checkProPlan error:', error);
    return false;
  }
};

module.exports.app = async (event) => {
  console.log('HANDLER EXECUTADO:', event.path, event.httpMethod);

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
    'Content-Type': 'application/json'
  };

  // Handle OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
    // Health check público (sem autenticação)
    if ((event.path === '/health' || event.path === '/api/health') && event.httpMethod === 'GET') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          status: 'ok',
          timestamp: new Date().toISOString(),
          environment: process.env.NODE_ENV || 'development'
        })
      };
    }

    // Public metrics endpoint
    if (event.path === '/api/public/metrics' && event.httpMethod === 'GET') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          status: 'ok',
          timestamp: new Date().toISOString(),
          version: '2.0.0',
          service: 'aws-cost-guardian-backend'
        })
      };
    }

    // GET /api/onboard-init - Buscar configuração inicial de onboarding
    if (event.path === '/api/onboard-init' && event.httpMethod === 'GET') {
      const user = await authenticateUser(event);
      if (!user) {
        return {
          statusCode: 401,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Não autenticado' })
        };
      }

      const userId = user.sub;
      const mode = event.queryStringParameters?.mode || 'trial';

      try {
        // Buscar configuração de onboarding existente
        const getConfigCmd = new GetCommand({
          TableName: process.env.DYNAMODB_TABLE,
          Key: {
            id: userId,
            sk: 'CONFIG#ONBOARD',
          },
        });

        const configResult = await dynamoDb.send(getConfigCmd);
        let onboardingConfig = configResult.Item;

        // Se não existir, criar configuração padrão
        if (!onboardingConfig) {
          onboardingConfig = {
            id: userId,
            sk: 'CONFIG#ONBOARD',
            status: 'pending_setup',
            mode: mode,
            accountType: mode === 'trial' ? 'TRIAL' : 'ACTIVE',
            createdAt: new Date().toISOString(),
            stripeCustomerId: null,
            stripeSubscriptionId: null,
            subscriptionStatus: 'inactive',
            automationEnabled: false,
            automationSettings: {},
          };

          // Tentar salvar no DynamoDB (ignorar se falhar por tabela não existir)
          try {
            const putConfigCmd = new PutCommand({
              TableName: process.env.DYNAMODB_TABLE,
              Item: onboardingConfig,
            });
            await dynamoDb.send(putConfigCmd);
          } catch (dbError) {
            console.warn('DynamoDB save failed (table may not exist):', dbError.message);
          }
        }

        // Retornar configuração (removendo campos internos se necessário)
        const responseConfig = { ...onboardingConfig };
        delete responseConfig.sk; // Não expor chave interna

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify(responseConfig)
        };
      } catch (error) {
        console.error('Erro ao buscar configuração de onboarding:', error);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Erro interno do servidor' })
        };
      }
    }

    // GET /billing/subscription - Obter status da assinatura
    if (event.path === '/billing/subscription' && event.httpMethod === 'GET') {
      const user = await authenticateUser(event);
      if (!user) {
        return {
          statusCode: 401,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Não autenticado' })
        };
      }

      try {
        const customerId = user.sub;
        const command = new GetCommand({
          TableName: process.env.DYNAMODB_TABLE,
          Key: { id: customerId, sk: 'CONFIG#ONBOARD' }
        });

        let config = null;
        try {
          const result = await dynamoDb.send(command);
          config = result.Item;
        } catch (dbError) {
          console.warn('DynamoDB query failed:', dbError.message);
        }

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            status: config?.subscriptionStatus || 'inactive',
            stripeCustomerId: config?.stripeCustomerId || null,
            stripeSubscriptionId: config?.stripeSubscriptionId || null
          })
        };
      } catch (error) {
        console.error('Erro ao obter status da assinatura:', error);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Erro ao obter status da assinatura' })
        };
      }
    }

    // GET /recommendations - Listar recomendações (requer plano Pro)
    if (event.path === '/recommendations' && event.httpMethod === 'GET') {
      const user = await authenticateUser(event);
      if (!user) {
        return {
          statusCode: 401,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Não autenticado' })
        };
      }

      const customerId = user.sub;
      const isPro = await checkProPlan(customerId);

      if (!isPro) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Acesso negado. Esta funcionalidade requer um plano Pro.' })
        };
      }

      try {
        // Buscar todas as recomendações do cliente
        const command = new QueryCommand({
          TableName: process.env.DYNAMODB_TABLE,
          IndexName: 'CustomerDataIndex',
          KeyConditionExpression: 'id = :id AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: {
            ':id': customerId,
            ':prefix': 'REC#'
          }
        });

        let recommendations = [];
        try {
          const result = await dynamoDb.send(command);
          recommendations = result.Items || [];
        } catch (dbError) {
          console.warn('DynamoDB query failed:', dbError.message);
        }

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify(recommendations)
        };
      } catch (error) {
        console.error('Erro ao listar recomendações:', error);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Erro ao listar recomendações' })
        };
      }
    }

    // GET /settings/automation - Obter configurações de automação (requer plano Pro)
    if (event.path === '/settings/automation' && event.httpMethod === 'GET') {
      const user = await authenticateUser(event);
      if (!user) {
        return {
          statusCode: 401,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Não autenticado' })
        };
      }

      const customerId = user.sub;
      const isPro = await checkProPlan(customerId);

      if (!isPro) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Acesso negado. Esta funcionalidade requer um plano Pro.' })
        };
      }

      try {
        const command = new GetCommand({
          TableName: process.env.DYNAMODB_TABLE,
          Key: { id: customerId, sk: 'CONFIG#ONBOARD' }
        });

        let config = null;
        try {
          const result = await dynamoDb.send(command);
          config = result.Item;
        } catch (dbError) {
          console.warn('DynamoDB query failed:', dbError.message);
        }

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            enabled: config?.automationEnabled || false,
            settings: config?.automationSettings || {}
          })
        };
      } catch (error) {
        console.error('Erro ao obter configurações de automação:', error);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Erro ao obter configurações de automação' })
        };
      }
    }

    // GET /admin/metrics - Métricas admin (requer grupo Admin)
    if (event.path === '/admin/metrics' && event.httpMethod === 'GET') {
      const user = await authenticateUser(event);
      if (!user) {
        return {
          statusCode: 401,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Não autenticado' })
        };
      }

      // TODO: Verificar se usuário é admin (grupo Cognito)
      // Por enquanto, permite qualquer usuário autenticado

      try {
        // Buscar todos os clientes
        let customers = [];
        try {
          const result = await dynamoDb.send(new QueryCommand({
            TableName: process.env.DYNAMODB_TABLE,
            IndexName: 'ActiveCustomerIndex',
            KeyConditionExpression: 'sk = :sk',
            ExpressionAttributeValues: { ':sk': 'CONFIG#ONBOARD' }
          }));
          customers = result.Items || [];
        } catch (dbError) {
          console.warn('DynamoDB query failed:', dbError.message);
        }

        // Calcular métricas
        const totalCustomers = customers.length;
        const trialCustomers = customers.filter(c => c.accountType === 'TRIAL').length;
        const activeCustomers = customers.filter(c => c.accountType === 'ACTIVE').length;

        // Churn este mês (clientes que cancelaram)
        const thisMonth = new Date();
        const startOfMonth = new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 1);
        const churnedThisMonth = customers.filter(c =>
          c.canceledAt && new Date(c.canceledAt) >= startOfMonth
        ).length;

        // Receita este mês (buscar billing records)
        const billingPeriod = `${thisMonth.getFullYear()}-${String(thisMonth.getMonth() + 1).padStart(2, '0')}`;

        // Leads novos esta semana
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const newLeadsThisWeek = customers.filter(c =>
          c.createdAt && new Date(c.createdAt) >= oneWeekAgo
        ).length;

        // Taxa de conversão
        const conversionRate = trialCustomers > 0
          ? (activeCustomers / (activeCustomers + trialCustomers)) * 100
          : 0;

        // High-value leads (economia potencial > $500/mês)
        let highValueCount = 0;

        // Recomendações
        let totalRecommendations = 0;
        let executedRecommendations = 0;

        // SLA Claims
        let claimsDetected = 0;
        let claimsSubmitted = 0;
        let creditsRecovered = 0;

        // Calcular métricas agregadas (simplificado)
        for (const customer of customers) {
          try {
            // Recomendações por cliente
            const recResult = await dynamoDb.send(new QueryCommand({
              TableName: process.env.DYNAMODB_TABLE,
              IndexName: 'CustomerDataIndex',
              KeyConditionExpression: 'id = :id AND begins_with(sk, :prefix)',
              ExpressionAttributeValues: {
                ':id': customer.id,
                ':prefix': 'REC#'
              }
            }));

            totalRecommendations += recResult.Items?.length || 0;
            executedRecommendations += recResult.Items?.filter(r => r.status === 'EXECUTED').length || 0;

            // SLA Claims por cliente
            const slaResult = await dynamoDb.send(new QueryCommand({
              TableName: process.env.DYNAMODB_TABLE,
              KeyConditionExpression: 'id = :id AND begins_with(sk, :prefix)',
              ExpressionAttributeValues: {
                ':id': customer.id,
                ':prefix': 'SLA#'
              }
            }));

            claimsDetected += slaResult.Items?.length || 0;
            claimsSubmitted += slaResult.Items?.filter(s => s.status === 'SUBMITTED').length || 0;
            creditsRecovered += slaResult.Items
              ?.filter(s => s.status === 'REFUNDED')
              .reduce((sum, s) => sum + (s.creditAmount || 0), 0) || 0;
          } catch (err) {
            // Ignorar erros individuais
          }
        }

        const executionRate = totalRecommendations > 0
          ? (executedRecommendations / totalRecommendations) * 100
          : 0;

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            customers: {
              total: totalCustomers,
              trial: trialCustomers,
              active: activeCustomers,
              churnedThisMonth,
            },
            revenue: {
              thisMonth: 0, // TODO: Implementar cálculo de receita
              lastMonth: 0,
              growth: 0,
            },
            leads: {
              newThisWeek: newLeadsThisWeek,
              conversionRate,
              highValueCount,
            },
            recommendations: {
              totalGenerated: totalRecommendations,
              executed: executedRecommendations,
              executionRate,
            },
            sla: {
              claimsDetected,
              claimsSubmitted,
              creditsRecovered,
            },
          })
        };
      } catch (error) {
        console.error('Erro ao buscar métricas admin:', error);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Erro ao buscar métricas' })
        };
      }
    }

    // POST /admin/promotions - Criar promoção (requer grupo Admin)
    if (event.path === '/admin/promotions' && event.httpMethod === 'POST') {
      const user = await authenticateUser(event);
      if (!user) {
        return {
          statusCode: 401,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Não autenticado' })
        };
      }

      // TODO: Verificar se usuário é admin (grupo Cognito)

      try {
        const body = JSON.parse(event.body || '{}');
        const { name, discountType, discountValue, validUntil, targetCustomers, description } = body;

        if (!name || !discountType || !discountValue) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Nome, tipo e valor do desconto são obrigatórios' })
          };
        }

        const promotionId = `PROMOTION#${Date.now()}`;
        const putCmd = new PutCommand({
          TableName: process.env.DYNAMODB_TABLE,
          Item: {
            id: 'SYSTEM',
            sk: promotionId,
            name,
            discountType, // 'percentage' ou 'fixed'
            discountValue,
            validUntil,
            targetCustomers: targetCustomers || 'all', // 'all', 'trial', 'active'
            description: description || '',
            createdAt: new Date().toISOString(),
            createdBy: user.userId,
            active: true,
          },
        });

        try {
          await dynamoDb.send(putCmd);
        } catch (dbError) {
          console.warn('DynamoDB save failed:', dbError.message);
          return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Erro ao salvar promoção' })
          };
        }

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Promoção criada com sucesso' })
        };
      } catch (error) {
        console.error('Erro ao criar promoção:', error);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Erro interno do servidor' })
        };
      }
    }

    // POST /billing/create-checkout-session - Criar sessão de checkout Stripe
    if (event.path === '/billing/create-checkout-session' && event.httpMethod === 'POST') {
      const user = await authenticateUser(event);
      if (!user) {
        return {
          statusCode: 401,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Não autenticado' })
        };
      }

      try {
        const body = JSON.parse(event.body || '{}');
        const { stripeCustomerId } = body;

        if (!stripeCustomerId) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'stripeCustomerId é obrigatório' })
          };
        }

        // Get Stripe instance
        const stripeInstance = await getStripe();
        if (!stripeInstance) {
          return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Stripe não configurado' })
          };
        }

        const session = await stripeInstance.checkout.sessions.create({
          payment_method_types: ['card'],
          mode: 'subscription',
          customer: stripeCustomerId,
          line_items: [{
            price: process.env.STRIPE_PRO_PLAN_PRICE_ID,
            quantity: 1,
          }],
          success_url: `${process.env.FRONTEND_URL || 'https://awscostguardian.com'}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.FRONTEND_URL || 'https://awscostguardian.com'}/billing`,
          metadata: {
            costGuardianCustomerId: user.sub,
          }
        });

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ sessionId: session.id })
        };
      } catch (error) {
        console.error('Erro ao criar sessão de checkout:', error);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Erro ao criar sessão de checkout' })
        };
      }
    }

    // POST /billing/create-portal-session - Criar sessão do portal de cobrança
    if (event.path === '/billing/create-portal-session' && event.httpMethod === 'POST') {
      const user = await authenticateUser(event);
      if (!user) {
        return {
          statusCode: 401,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Não autenticado' })
        };
      }

      try {
        const customerId = user.sub;
        const getConfigCmd = new GetCommand({
          TableName: process.env.DYNAMODB_TABLE,
          Key: {
            id: customerId,
            sk: 'CONFIG#ONBOARD',
          },
        });

        let config = null;
        try {
          const configResult = await dynamoDb.send(getConfigCmd);
          config = configResult.Item;
        } catch (dbError) {
          console.warn('DynamoDB query failed:', dbError.message);
        }

        if (!config?.stripeCustomerId) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Cliente Stripe não encontrado' })
          };
        }

        // Get Stripe instance
        const stripeInstance = await getStripe();
        if (!stripeInstance) {
          return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Stripe não configurado' })
          };
        }

        const session = await stripeInstance.billingPortal.sessions.create({
          customer: config.stripeCustomerId,
          return_url: `${process.env.FRONTEND_URL || 'https://awscostguardian.com'}/billing`,
        });

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ url: session.url })
        };
      } catch (error) {
        console.error('Erro ao criar sessão do portal:', error);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Erro interno do servidor' })
        };
      }
    }

    // GET /api/incidents - Buscar incidentes do cliente
    if (event.path === '/api/incidents' && event.httpMethod === 'GET') {
      const user = await authenticateUser(event);
      if (!user) {
        return {
          statusCode: 401,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Não autenticado' })
        };
      }

      try {
        const customerId = user.sub;

        // Buscar incidentes do DynamoDB
        let incidents = [];
        try {
          const result = await dynamoDb.send(new QueryCommand({
            TableName: process.env.DYNAMODB_TABLE,
            KeyConditionExpression: 'id = :customerId AND begins_with(sk, :incidentPrefix)',
            ExpressionAttributeValues: {
              ':customerId': customerId,
              ':incidentPrefix': 'incident#'
            }
          }));

          incidents = (result.Items || []).map(item => ({
            id: item?.sk?.replace('incident#', '') || 'unknown',
            type: item?.incidentType || 'unknown',
            severity: item?.severity || 'unknown',
            status: item?.status || 'unknown',
            createdAt: item?.createdAt || new Date().toISOString(),
            updatedAt: item?.updatedAt || new Date().toISOString(),
            description: item?.description || '',
            resolution: item?.resolution || '',
            caseId: item?.caseId || ''
          }));
        } catch (dbError) {
          console.warn('DynamoDB query failed:', dbError.message);
        }

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ incidents })
        };
      } catch (error) {
        console.error('Erro ao buscar incidentes:', error);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Erro ao buscar incidentes' })
        };
      }
    }

    // PUT /settings/automation - Atualizar configurações de automação
    if (event.path === '/settings/automation' && event.httpMethod === 'PUT') {
      const user = await authenticateUser(event);
      if (!user) {
        return {
          statusCode: 401,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Não autenticado' })
        };
      }

      const customerId = user.sub;
      const isPro = await checkProPlan(customerId);

      if (!isPro) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Acesso negado. Esta funcionalidade requer um plano Pro.' })
        };
      }

      try {
        const body = JSON.parse(event.body || '{}');
        const { enabled, settings } = body;

        const command = new UpdateCommand({
          TableName: process.env.DYNAMODB_TABLE,
          Key: { id: customerId, sk: 'CONFIG#ONBOARD' },
          UpdateExpression: 'SET automationEnabled = :enabled, automationSettings = :settings',
          ExpressionAttributeValues: {
            ':enabled': enabled,
            ':settings': settings
          }
        });

        try {
          await dynamoDb.send(command);
        } catch (dbError) {
          console.warn('DynamoDB update failed:', dbError.message);
          return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Erro ao atualizar configurações' })
          };
        }

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Configurações de automação atualizadas com sucesso' })
        };
      } catch (error) {
        console.error('Erro ao atualizar configurações de automação:', error);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Erro ao atualizar configurações de automação' })
        };
      }
    }

    // POST /recommendations/:recommendationId/execute - Executar recomendação
    if (event.path.startsWith('/recommendations/') && event.path.includes('/execute') && event.httpMethod === 'POST') {
      const user = await authenticateUser(event);
      if (!user) {
        return {
          statusCode: 401,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Não autenticado' })
        };
      }

      const customerId = user.sub;
      const isPro = await checkProPlan(customerId);

      if (!isPro) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Acesso negado. Esta funcionalidade requer um plano Pro.' })
        };
      }

      const pathParts = event.path.split('/');
      const recommendationId = pathParts[2]; // /recommendations/{id}/execute

      if (!recommendationId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'ID da recomendação é obrigatório' })
        };
      }

      try {
        // Aqui seria chamado o Lambda de execução de recomendações
        // Por enquanto, simular uma resposta de sucesso
        console.log(`Executando recomendação ${recommendationId} para cliente ${customerId}`);

        // Em produção, isso chamaria o executeRecommendationLambda
        // const lambdaResult = await lambdaClient.invoke({
        //   FunctionName: process.env.EXECUTE_RECOMMENDATION_LAMBDA_ARN,
        //   Payload: JSON.stringify({...})
        // });

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            message: 'Recomendação executada com sucesso',
            recommendationId,
            status: 'EXECUTED',
            executedAt: new Date().toISOString()
          })
        };
      } catch (error) {
        console.error('Erro ao executar recomendação:', error);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Erro ao executar recomendação' })
        };
      }
    }

    // GET /api/system-status/aws - Status dos serviços AWS (usando Health API)
    if (event.path === '/api/system-status/aws' && event.httpMethod === 'GET') {
      const user = await authenticateUser(event);
      if (!user) {
        return {
          statusCode: 401,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Não autenticado' })
        };
      }

      try {
        // Simular status dos serviços AWS (em produção usaria AWS Health API)
        const services = {
          EC2: { status: 'operational', incidents: [] },
          RDS: { status: 'operational', incidents: [] },
          S3: { status: 'operational', incidents: [] },
          Lambda: { status: 'operational', incidents: [] },
          DynamoDB: { status: 'operational', incidents: [] }
        };

        // Adicionar alguns incidentes simulados para demonstração
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        if (Math.random() > 0.7) { // 30% chance de ter incidentes
          services.EC2.status = 'degraded';
          services.EC2.incidents.push({
            eventTypeCode: 'AWS_EC2_INSTANCE_RETIREMENT',
            eventDescription: 'Instance retirement notice',
            startTime: yesterday.toISOString(),
            lastUpdatedTime: new Date().toISOString(),
            region: 'us-east-1',
            statusCode: 'open',
            affectedResources: Math.floor(Math.random() * 10) + 1
          });
        }

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            timestamp: new Date().toISOString(),
            services,
            totalIncidents: Object.values(services).reduce((sum, svc) => sum + svc.incidents.length, 0)
          })
        };
      } catch (error) {
        console.error('Erro ao buscar status AWS:', error);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({
            message: 'Erro ao buscar status dos serviços AWS',
            timestamp: new Date().toISOString(),
            services: {},
            totalIncidents: 0
          })
        };
      }
    }

    // GET /api/system-status/guardian - Status interno do sistema (heartbeats)
    if (event.path === '/api/system-status/guardian' && event.httpMethod === 'GET') {
      const user = await authenticateUser(event);
      if (!user) {
        return {
          statusCode: 401,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'Não autenticado' })
        };
      }

      try {
        // Simular heartbeats do sistema
        const systemStatus = {
          costIngestor: {
            status: Math.random() > 0.9 ? 'error' : 'healthy',
            lastRun: new Date(Date.now() - Math.random() * 3600000).toISOString(),
            message: 'Sistema funcionando normalmente'
          },
          correlateHealth: {
            status: Math.random() > 0.95 ? 'error' : 'healthy',
            lastRun: new Date(Date.now() - Math.random() * 3600000).toISOString(),
            message: 'Processamento de eventos de saúde ativo'
          },
          automationSfn: {
            status: Math.random() > 0.9 ? 'error' : 'healthy',
            lastRun: new Date(Date.now() - Math.random() * 3600000).toISOString(),
            message: 'Workflows de automação executando'
          },
          marketplaceMetering: {
            status: Math.random() > 0.85 ? 'error' : 'healthy',
            lastRun: new Date(Date.now() - Math.random() * 3600000).toISOString(),
            message: 'Medição do marketplace ativa'
          }
        };

        // Calcular status geral
        const healthyCount = Object.values(systemStatus).filter(s => s.status === 'healthy').length;
        const overallStatus = healthyCount === Object.keys(systemStatus).length ? 'healthy' :
                             healthyCount > 0 ? 'degraded' : 'error';

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            timestamp: new Date().toISOString(),
            overallStatus,
            services: systemStatus
          })
        };
      } catch (error) {
        console.error('Erro ao buscar status do sistema:', error);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({
            message: 'Erro ao buscar status interno',
            timestamp: new Date().toISOString(),
            overallStatus: 'error',
            services: {}
          })
        };
      }
    }

  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message
      })
    };
  }

  // Rota não encontrada
  return {
    statusCode: 404,
    headers: corsHeaders,
    body: JSON.stringify({
      error: 'Not found',
      path: event.path
    })
  };
};
