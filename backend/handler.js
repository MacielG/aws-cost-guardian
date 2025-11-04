const serverless = require('serverless-http');
const express = require('express');
const cors = require('cors');

// AWS SDK v3 imports
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');
const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');
const { EC2Client } = require('@aws-sdk/client-ec2');
const { RDSClient } = require('@aws-sdk/client-rds');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { MarketplaceMeteringClient, ResolveCustomerCommand } = require('@aws-sdk/client-marketplace-metering');
const { SupportClient, DescribeSeverityLevelsCommand } = require('@aws-sdk/client-support');
const { HealthClient, DescribeEventsCommand } = require('@aws-sdk/client-health');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const { randomBytes } = require('crypto');

// Initialize AWS SDK v3 clients
const ddbClient = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(ddbClient);
const secretsManager = new SecretsManagerClient({});
const sfn = new SFNClient({});
const health = new HealthClient({});
const s3Presigner = new S3Client({});

// Helper para assumir a role do cliente
async function getAssumedClients(roleArn, externalId, region = 'us-east-1') { // A assinatura já estava correta
    if (!externalId) {
        throw new Error('ExternalId is required for AssumeRole');
    }
    const sts = new STSClient({});
    try {
        const command = new AssumeRoleCommand({
            RoleArn: roleArn,
            RoleSessionName: 'GuardianAdvisorExecution',
            DurationSeconds: 900,
            ExternalId: externalId, // A propriedade já estava aqui, garantindo que a lógica está correta.
        });

        const assumedRole = await sts.send(command);

        const credentials = {
            accessKeyId: assumedRole.Credentials.AccessKeyId,
            secretAccessKey: assumedRole.Credentials.SecretAccessKey,
            sessionToken: assumedRole.Credentials.SessionToken,
        };

        return {
            ec2: new EC2Client({ credentials, region }),
            rds: new RDSClient({ credentials, region }),
            support: new SupportClient({ credentials, region }),
            // Adicione outros serviços conforme necessário
        };
    } catch (err) {
        console.error(`Falha ao assumir role ${roleArn}:`, err);
        throw new Error(`STS AssumeRole failed: ${err.message}`);
    }
}

const https = require('https');
const url = require('url');

const app = express();

// Configuração do CORS
// LER origins permitidos de variável de ambiente
const allowedOriginsEnv = process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000';
const allowedOriginsFromEnv = allowedOriginsEnv.split(',').map(o => o.trim()).filter(Boolean);

const corsOptions = {
    origin: function (origin, callback) {
        const allowedOrigins = [
            ...allowedOriginsFromEnv,
            'http://127.0.0.1:5500', // Live Server
            /^https:\/\/.+\.execute-api\.us-east-1\.amazonaws\.com$/,
        ];

        // Permitir requests sem origin (ex: Postman, curl)
        if (!origin) return callback(null, true);

        // Verifica se o origin está na lista de permitidos
        if (allowedOrigins.some(allowedOrigin => {
            if (allowedOrigin instanceof RegExp) {
                return allowedOrigin.test(origin);
            }
            return allowedOrigin === origin;
        })) {
            callback(null, true);
        } else {
            callback(new Error('Não permitido pelo CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token', 'X-Amz-User-Agent']
};

app.use(cors(corsOptions));

// CRITICAL: Handle OPTIONS preflight BEFORE any authentication
app.options('*', cors(corsOptions));

// Garantir que OPTIONS não passa por autenticação
app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

// Robust CORS echo middleware (option 2):
// When credentials are allowed we MUST NOT respond with '*' for Access-Control-Allow-Origin.
// This middleware validates the incoming Origin against the same whitelist used by the cors
// package and, when allowed, explicitly sets the Access-Control-Allow-* headers echoing the
// concrete origin. For non-browser clients (no Origin) we allow '*'.
app.use((req, res, next) => {
    try {
        const origin = req.get('origin');

        const allowedOrigins = [
            ...allowedOriginsFromEnv,
            'http://127.0.0.1:5500', // Live Server
            /^https:\/\/.+\.execute-api\.us-east-1\.amazonaws\.com$/,
        ];

        function originIsAllowed(o) {
            if (!o) return false;
            return allowedOrigins.some(allowedOrigin => {
                if (allowedOrigin instanceof RegExp) return allowedOrigin.test(o);
                return allowedOrigin === o;
            });
        }

        // If the request has an Origin header and it's allowed, echo it back explicitly.
        if (origin) {
            if (originIsAllowed(origin)) {
                res.setHeader('Access-Control-Allow-Origin', origin);
                // only set credentials header when origin is explicit
                res.setHeader('Access-Control-Allow-Credentials', String(!!corsOptions.credentials));
            } else {
                // Not allowed: do not set Access-Control-Allow-Origin (browser will block)
                // Also log for diagnostics in non-production
                if (process.env.NODE_ENV !== 'production') {
                    console.warn(`CORS: rejecting origin ${origin}`);
                }
            }
        } else {
            // No Origin (curl/postman) - allow generic access
            res.setHeader('Access-Control-Allow-Origin', '*');
        }

        // Common preflight/actual request headers
        res.setHeader('Access-Control-Allow-Methods', (corsOptions.methods || ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']).join(', '));
        res.setHeader('Access-Control-Allow-Headers', (corsOptions.allowedHeaders || ['Content-Type', 'Authorization']).join(', '));
        // Make sure credentials header is present when appropriate on OPTIONS too
        if (req.method === 'OPTIONS') {
            return res.sendStatus(204);
        }

        return next();
    } catch (err) {
        console.error('CORS echo middleware error:', err);
        return next();
    }
});


let stripe;

// Async factory to initialize Stripe
const getStripe = async () => {
    if (stripe) {
        return stripe;
    }
    const command = new GetSecretValueCommand({
        SecretId: process.env.STRIPE_SECRET_ARN // Usando a variável de ambiente correta
    });
    const secretData = await secretsManager.send(command);
    const secret = JSON.parse(secretData.SecretString);
    stripe = require('stripe')(secret.key);
    return stripe;
};

// Middleware de autenticação e checkProPlan definidos antecipadamente para evitar erros de hoisting

const authenticateUser = async (req, res, next) => {
    try {
        // If API Gateway authorizer populated claims, use them
        if (req.apiGateway?.event?.requestContext?.authorizer?.claims) {
            req.user = req.apiGateway.event.requestContext.authorizer.claims;
            return next();
        }

        // Otherwise attempt direct JWT verification
        const claims = await verifyJwt(req);
        if (claims) {
            req.user = claims;
            return next();
        }

        res.status(401).json({ message: 'Não autenticado' });
    } catch (error) {
        const requestId = req.apiGateway?.context?.awsRequestId || req.headers['x-amzn-RequestId'] || 'unknown';
        console.error(`[${requestId}] authenticateUser error:`, error);
        res.status(401).json({ message: 'Token inválido' });
    }
};

// Middleware para verificar plano Pro (definido antecipadamente para evitar erros de hoisting)
const checkProPlan = async (req, res, next) => {
    try {
        const customerId = req.user.sub;
        const command = new GetCommand({
            TableName: process.env.DYNAMODB_TABLE,
            Key: { id: customerId, sk: 'CONFIG#ONBOARD' }
        });
        const result = await dynamoDb.send(command);
        const config = result.Item;

        if (config && config.subscriptionStatus === 'active') {
            req.customerConfig = config; // Passa a config para a próxima rota
            return next(); // Permite o acesso
        }

        res.status(403).send({
            error: 'Acesso negado. Esta funcionalidade requer um plano Pro.'
        });
    } catch (error) {
        console.error('Erro no checkProPlan:', error);
        res.status(500).send({
            error: 'Erro interno do servidor ao verificar plano.'
        });
    }
};

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

// Middleware de logging para debug (somente em dev)
app.use((req, res, next) => {
    if (process.env.NODE_ENV !== 'production') {
        console.log(`[${req.method}] ${req.path}`, {
            origin: req.get('origin'),
            contentType: req.get('content-type')
        });
    }
    next();
});

// Health check público (sem autenticação) para testes e monitoramento
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// API Health check com informações CORS
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        cors: {
            allowedOrigins: process.env.ALLOWED_ORIGINS || 'configured via environment',
            credentials: true
        },
        environment: process.env.NODE_ENV || 'development'
    });
});


// Rota para criar sessão de checkout do Stripe
app.post('/billing/create-checkout-session', authenticateUser, async (req, res) => {
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
app.get('/billing/subscription', authenticateUser, async (req, res) => {
    try {
        const customerId = req.user.sub;
        const command = new GetCommand({
            TableName: process.env.DYNAMODB_TABLE,
            Key: { id: customerId, sk: 'CONFIG#ONBOARD' }
        });
        const result = await dynamoDb.send(command);
        const config = result.Item;

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
app.get('/recommendations', authenticateUser, checkProPlan, async (req, res) => {
    try {
        const customerId = req.user.sub;

        // Buscar todas as recomendações do cliente
        // Usa CustomerDataIndex para eficiência (partition key: id, sort key: sk)
        // begins_with(sk, :prefix) filtra REC# items sem scan
        const command = new QueryCommand({
            TableName: process.env.DYNAMODB_TABLE,
            IndexName: 'CustomerDataIndex',
            KeyConditionExpression: 'id = :id AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: {
                ':id': customerId,
                ':prefix': 'REC#'
            }
        });
        const recommendations = await dynamoDb.send(command);

        res.status(200).json(recommendations.Items);
    } catch (error) {
        console.error('Erro ao listar recomendações:', error);
        res.status(500).json({ error: 'Erro ao listar recomendações' });
    }
});

// Rota para executar uma recomendação
app.post('/recommendations/:recommendationId/execute', authenticateUser, checkProPlan, async (req, res) => {
    const lambdaClient = new LambdaClient({});
    const customerId = req.user.sub;
    const { recommendationId } = req.params;

    try {
        // Chamar o Lambda de execução
        const command = new InvokeCommand({
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
        });
        const result = await lambdaClient.send(command);

        const responsePayload = JSON.parse(Buffer.from(result.Payload).toString());
        res.status(responsePayload.statusCode).json(JSON.parse(responsePayload.body));
    } catch (error) {
        console.error('Erro ao executar recomendação:', error);
        res.status(500).json({ error: 'Erro ao executar recomendação' });
    }
});

// Rota para buscar incidentes
app.get('/api/incidents', authenticateUser, async (req, res) => {
    try {
        const customerId = req.user.sub;

        // Buscar incidentes do DynamoDB
        const params = {
            TableName: process.env.DYNAMODB_TABLE,
            KeyConditionExpression: 'id = :customerId AND begins_with(sk, :incidentPrefix)',
            ExpressionAttributeValues: {
                ':customerId': customerId,
                ':incidentPrefix': 'incident#'
            }
        };

        const result = await dynamoDb.send(new QueryCommand(params));

        const incidents = (result.Items || []).map(item => ({
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

        res.status(200).json({ incidents });
    } catch (error) {
        console.error('Erro ao buscar incidentes:', error);
        res.status(500).json({ error: 'Erro ao buscar incidentes' });
    }
});

// Rotas protegidas pelo plano Pro
app.get('/settings/automation', authenticateUser, checkProPlan, async (req, res) => {
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

app.put('/settings/automation', authenticateUser, checkProPlan, async (req, res) => {
    try {
        const customerId = req.user.sub;
        const { enabled, settings } = req.body;

        const command = new UpdateCommand({
            TableName: process.env.DYNAMODB_TABLE,
            Key: { id: customerId, sk: 'CONFIG#ONBOARD' },
            UpdateExpression: 'SET automationEnabled = :enabled, automationSettings = :settings',
            ExpressionAttributeValues: {
                ':enabled': enabled,
                ':settings': settings
            }
        });
        await dynamoDb.send(command);

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
const verifyJwt = async (req) => {
    const auth = req.headers?.authorization || req.headers?.Authorization;
    if (!auth) return null;
    const parts = auth.split(' ');
    if (parts.length !== 2) return null;
    const token = parts[1];

    const region = process.env.AWS_REGION || 'us-east-1';
    const userPoolId = process.env.USER_POOL_ID;
    if (!userPoolId) return null;

    const client = jwksClient({
        jwksUri: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`,
        cache: true,
        cacheMaxAge: 600000
    });

    try {
        const getKey = (header) => {
            return new Promise((resolve, reject) => {
                client.getSigningKey(header.kid, function (err, key) {
                    if (err) return reject(err);
                    const signingKey = key.getPublicKey();
                    resolve(signingKey);
                });
            });
        };

        const decoded = await jwt.verify(token, getKey, {
            algorithms: ['RS256'],
            audience: process.env.USER_POOL_CLIENT_ID || undefined,
            issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
        });
        return decoded;
    } catch (err) {
        const requestId = req.apiGateway?.context?.awsRequestId || req.headers['x-amzn-RequestId'] || 'unknown';
        console.warn(`[${requestId}] JWT verification failed:`, err.message);
        return null;
    }
};

// Helper function para atualizar status da assinatura
async function updateSubscriptionStatus(customerId, status, subscriptionId) {
    const command = new UpdateCommand({
        TableName: process.env.DYNAMODB_TABLE,
        Key: { id: customerId, sk: 'CONFIG#ONBOARD' },
        UpdateExpression: 'SET subscriptionStatus = :status, stripeSubscriptionId = :subId',
        ExpressionAttributeValues: {
            ':status': status,
            ':subId': subscriptionId,
        }
    });
    await dynamoDb.send(command);
}

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

// Para adicionar um usuário ao grupo 'Admins', use o Console da AWS ou a AWS CLI:
// aws cognito-idp admin-add-user-to-group --user-pool-id <user-pool-id> --username <user-sub> --group-name Admins

// POST /api/admin/claims/{customerId}/{claimId}/retry
app.post('/admin/claims/:customerId/:claimId/retry', authenticateUser, authorizeAdmin, async (req, res) => {
    const { customerId, claimId } = req.params;
    const claimSk = `CLAIM#${claimId.replace('CLAIM#', '')}`;

    try {
        // 1. Obter a claim para encontrar o incidente original
        const getClaimCmd = new GetCommand({ TableName: process.env.DYNAMODB_TABLE, Key: { id: customerId, sk: claimSk } });
        const claimResult = await dynamoDb.send(getClaimCmd);
        const claim = claimResult.Item;
        if (!claim || !claim.incidentId) {
            return res.status(404).send({ error: 'Incidente original não encontrado.' });
        }

        // 2. Obter o incidente original para o payload do evento
        const getIncidentCmd = new GetCommand({ TableName: process.env.DYNAMODB_TABLE, Key: { id: customerId, sk: claim.incidentId } });
        const incidentResult = await dynamoDb.send(getIncidentCmd);
        const incident = incidentResult.Item;
        if (!incident || !incident.details) {
            return res.status(404).send({ error: 'Payload do evento original não encontrado.' });
        }

        // 3. Re-iniciar a SFN
        const startExecCmd = new StartExecutionCommand({
            stateMachineArn: process.env.SFN_ARN,
            input: JSON.stringify({
                customerId: customerId,
                awsAccountId: incident.awsAccountId,
                healthEvent: incident.details, // Payload original
                incidentId: claim.incidentId,
            }),
        });
        await sfn.send(startExecCmd);

        // 4. Resetar o status da claim
        const updateCmd = new UpdateCommand({
            TableName: process.env.DYNAMODB_TABLE,
            Key: { id: customerId, sk: claimSk },
            UpdateExpression: 'SET #status = :status',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':status': 'RETRYING' }
        });
        await dynamoDb.send(updateCmd);

        res.status(200).send({ message: 'Fluxo de SLA reiniciado.' });
    } catch (err) {
        console.error('Erro ao reiniciar fluxo de SLA:', err);
        res.status(500).send({ error: err.message });
    }
});

// GET /api/onboard-init
// NOTE: handler foi movido mais abaixo para incluir verificação de termos aceitos



// POST /api/marketplace/webhook - Webhook do Marketplace SNS
app.post('/marketplace/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const message = JSON.parse(req.body);

        // Verificar se é mensagem do SNS
        if (message.Type === 'SubscriptionConfirmation') {
            // Confirmar subscrição do SNS (se necessário)
            // Para simplificar, assumimos que está confirmado
            console.log('SNS Subscription confirmed');
            return res.status(200).send('OK');
        }

        if (message.Type === 'Notification') {
            const notification = JSON.parse(message.Message);

            const action = notification.action;
            const customerIdentifier = notification.customerIdentifier;

            // Mapear customerIdentifier para userId (assumindo que foi armazenado no resolve)
            // Na prática, você precisa mapear o marketplaceCustomerId para o userId
            // Aqui, assumimos que há um campo marketplaceCustomerId no item do usuário

            // Buscar usuário pelo marketplaceCustomerId
            const queryCmd = new QueryCommand({
                TableName: process.env.DYNAMODB_TABLE,
                IndexName: 'MarketplaceCustomerIndex', // Assumindo que existe um GSI
                KeyConditionExpression: 'marketplaceCustomerId = :cid',
                ExpressionAttributeValues: { ':cid': customerIdentifier }
            });
            const userResult = await dynamoDb.send(queryCmd);
            if (!userResult.Items || userResult.Items.length === 0) {
                console.error('Usuário não encontrado para marketplaceCustomerId:', customerIdentifier);
                return res.status(404).send('User not found');
            }
            const userId = userResult.Items[0].id;

            if (action === 'subscribe-success') {
                // Atualizar status para ACTIVE
                const updateCmd = new UpdateCommand({
                    TableName: process.env.DYNAMODB_TABLE,
                    Key: { id: userId, sk: 'CONFIG#ONBOARD' },
                    UpdateExpression: 'SET subscriptionStatus = :status',
                    ExpressionAttributeValues: { ':status': 'active' }
                });
                await dynamoDb.send(updateCmd);
                console.log(`Usuário ${userId} ativado via Marketplace`);
            } else if (action === 'unsubscribe-pending' || action === 'unsubscribe-success') {
                // Atualizar status para cancelled
                const updateCmd = new UpdateCommand({
                    TableName: process.env.DYNAMODB_TABLE,
                    Key: { id: userId, sk: 'CONFIG#ONBOARD' },
                    UpdateExpression: 'SET subscriptionStatus = :status',
                    ExpressionAttributeValues: { ':status': 'cancelled' }
                });
                await dynamoDb.send(updateCmd);
                console.log(`Usuário ${userId} cancelado via Marketplace`);
            }

            return res.status(200).send('OK');
        }

        res.status(400).send('Invalid message type');
    } catch (err) {
        console.error('Erro no webhook do Marketplace:', err);
        res.status(500).send('Internal error');
    }
});

// POST /api/marketplace/resolve - Resolver customer do Marketplace
app.post('/marketplace/resolve', authenticateUser, async (req, res) => {
    try {
        const { registrationToken } = req.body;
        const userId = req.user.sub;

        if (!registrationToken) {
            return res.status(400).json({ message: 'registrationToken é obrigatório' });
        }

        const marketplace = new MarketplaceMeteringClient({});
        const resolveCmd = new ResolveCustomerCommand({
            RegistrationToken: registrationToken,
        });
        const resolveResult = await marketplace.send(resolveCmd);

        const {
            CustomerIdentifier: marketplaceCustomerId,
            ProductCode: productCode,
            CustomerAWSAccountId: awsAccountId,
        } = resolveResult;

        // Armazenar marketplaceCustomerId no item do usuário
        const updateCmd = new UpdateCommand({
            TableName: process.env.DYNAMODB_TABLE,
            Key: { id: userId, sk: 'CONFIG#ONBOARD' },
            UpdateExpression: 'SET marketplaceCustomerId = :mcid',
            ExpressionAttributeValues: { ':mcid': marketplaceCustomerId }
        });
        await dynamoDb.send(updateCmd);

        res.json({
            success: true,
            marketplaceCustomerId,
            productCode,
            awsAccountId,
            message: 'Customer resolvido e vinculado à conta',
        });

    } catch (err) {
        console.error('Erro ao resolver Marketplace customer:', err);
        res.status(500).json({ message: 'Erro ao processar Marketplace registration' });
    }
});

// POST /api/onboard
app.post('/onboard', async (req, res) => {
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
                    const { support } = await getAssumedClients(roleArnVal, externalIdVal, 'us-east-1');
                    const describeSevCmd = new DescribeSeverityLevelsCommand({});
                    await support.send(describeSevCmd);
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

                const putCmd = new PutCommand(params);
                await dynamoDb.send(putCmd);
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
        const queryCmd = new QueryCommand({
            TableName: process.env.DYNAMODB_TABLE,
            IndexName: 'ExternalIdIndex', // GSI necessário: externalId -> userId
            KeyConditionExpression: 'externalId = :externalId',
            ExpressionAttributeValues: { ':externalId': externalId },
        });
        const configQuery = await dynamoDb.send(queryCmd);

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

        const putCmd2 = new PutCommand(params);
        await dynamoDb.send(putCmd2);

        // 3. Atualizar status do onboarding para COMPLETED
        // Também salvamos o roleArn no item CONFIG#ONBOARD para permitir que
        // processos automáticos (ingestor, automações) assumam a role do cliente.
        const updateCmd = new UpdateCommand({
            TableName: process.env.DYNAMODB_TABLE,
            Key: { id: userId, sk: 'CONFIG#ONBOARD' },
            UpdateExpression: 'SET #status = :status, roleArn = :roleArn',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':status': 'COMPLETED', ':roleArn': roleArn }
        });
        await dynamoDb.send(updateCmd);

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
app.post('/accept-terms', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.sub;

        // Atualiza um item de configuração ou o próprio perfil do usuário
        const updateCmd = new UpdateCommand({
            TableName: process.env.DYNAMODB_TABLE,
            Key: { id: userId, sk: 'CONFIG#ONBOARD' }, // Ou um item de perfil
            UpdateExpression: 'SET termsAccepted = :accepted, termsAcceptedAt = :timestamp',
            ExpressionAttributeValues: {
                ':accepted': true,
                ':timestamp': new Date().toISOString(),
            }
        });
        await dynamoDb.send(updateCmd);

        res.json({ success: true, message: 'Termos aceitos com sucesso.' });
    } catch (err) {
        console.error('Erro ao aceitar termos:', err);
        res.status(500).json({ success: false, message: 'Erro ao registrar aceitação dos termos.' });
    }
});

// GET /api/onboard-init - Retorna configuração para onboarding
// NOTA: Esta rota é pública (sem authenticateUser) para permitir acesso no trial mode
app.get('/api/onboard-init', async (req, res) => { // A lógica foi refatorada para usar async/await de forma mais limpa
  try {
    const mode = req.query.mode || 'trial';
    const claims = await verifyJwt(req); // Tenta verificar o token, mas não falha se não existir
    const userId = claims?.sub;

    // Se não autenticado, retorna info pública para o modo trial/login
    if (!userId) {
      const accountType = mode === 'active' ? 'ACTIVE' : 'TRIAL';
      const templateUrl = accountType === 'TRIAL' ?
        process.env.TRIAL_TEMPLATE_URL :
        process.env.FULL_TEMPLATE_URL;

      return res.json({
        mode,
        accountType,
        templateUrl,
        platformAccountId: process.env.PLATFORM_ACCOUNT_ID,
        requiresAuth: true,
        message: 'Faça login para configurar o onboarding'
      });
    }

    // Usuário está autenticado, buscar ou criar configuração
    const configKey = { id: userId, sk: 'CONFIG#ONBOARD' };
    const existingResult = await dynamoDb.send(new GetCommand({ TableName: process.env.DYNAMODB_TABLE, Key: configKey }));

    // Se a configuração já existe, retorna os dados
    if (existingResult.Item) {
      const item = existingResult.Item;
      const templateUrl = item.accountType === 'TRIAL' ?
        process.env.TRIAL_TEMPLATE_URL :
        process.env.FULL_TEMPLATE_URL;

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
    const templateUrl = accountType === 'TRIAL' ?
      process.env.TRIAL_TEMPLATE_URL :
      process.env.FULL_TEMPLATE_URL;

    const newItem = {
      id: userId,
      sk: 'CONFIG#ONBOARD',
      externalId,
      status: 'PENDING_CFN',
      accountType,
      createdAt: new Date().toISOString(),
    };

    // Tenta criar Customer no Stripe antecipadamente
    const userEmail = claims?.email;
    if (userEmail) {
      try {
        const stripeClient = await getStripe();
        const customer = await stripeClient.customers.create({
          email: userEmail,
          metadata: { costGuardianCustomerId: userId }
        });
        newItem.stripeCustomerId = customer.id;
        console.log(`Stripe customer antecipado criado para ${userId}: ${customer.id}`);
      } catch (stripeErr) {
        console.error('Falha ao criar stripeCustomerId antecipado:', stripeErr);
      }
    }

    await dynamoDb.send(new PutCommand({ TableName: process.env.DYNAMODB_TABLE, Item: newItem }));

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

        const queryCmd = new QueryCommand(params);
        const data = await dynamoDb.send(queryCmd);

        if (!data.Items || data.Items.length === 0) {
        // Retornar dados vazios em vez de erro 404 para evitar quebrar o dashboard
            return res.status(200).json({
                Groups: [],
                Start: new Date().toISOString().split('T')[0],
                End: new Date().toISOString().split('T')[0]
            });
        }

        const item = data.Items[0];
        return res.status(200).json(item?.data || {
            Groups: [],
            Start: new Date().toISOString().split('T')[0],
            End: new Date().toISOString().split('T')[0]
        });
    } catch (err) {
        console.error('Erro ao buscar dados do dashboard:', err);
        return res.status(500).send({ error: 'Falha ao buscar dados.' });
    }
});



// POST /api/settings/automation
// Body: { automation: { stopIdle: true, deleteUnusedEbs: false, exclusionTags?: string } }
app.post('/settings/automation', authenticateUser, async (req, res) => {
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

        const updateCmd = new UpdateCommand({
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
        });
        await dynamoDb.send(updateCmd);

        return res.json({ success: true });
    } catch (err) {
        console.error('Erro ao salvar settings de automação:', err);
        return res.status(500).json({ error: 'Falha ao salvar configurações.' });
    }
});
// GET /api/sla-claims
app.get('/sla-claims', authenticateUser, async (req, res) => {
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
        const queryCmd = new QueryCommand(params);
        const data = await dynamoDb.send(queryCmd);

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
app.get('/alerts', authenticateUser, async (req, res) => {
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
        const queryCmd = new QueryCommand(params);
        const data = await dynamoDb.send(queryCmd);
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
app.get('/invoices', authenticateUser, async (req, res) => {
    try {
        const customerId = req.user.sub;

        // Recupera stripeCustomerId do item CONFIG#ONBOARD
        const getCmd = new GetCommand({ TableName: process.env.DYNAMODB_TABLE, Key: { id: customerId, sk: 'CONFIG#ONBOARD' } });
        const cfgResult = await dynamoDb.send(getCmd);
        const cfg = cfgResult.Item;
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
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];

    try {
        // Ensure stripe client is initialized
        const stripeClient = await getStripe();

        // Obtain webhook secret from Secrets Manager if ARN provided, otherwise fallback to env var
        let endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (process.env.STRIPE_WEBHOOK_SECRET_ARN) {
            try {
                const getSecretCmd = new GetSecretValueCommand({ SecretId: process.env.STRIPE_WEBHOOK_SECRET_ARN });
                const secretVal = await secretsManager.send(getSecretCmd);
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
                const updateCmd = new UpdateCommand({
                    TableName: process.env.DYNAMODB_TABLE,
                    Key: { id: customerId, sk: claimSk },
                    UpdateExpression: 'SET #status = :status, commissionAmount = :amount',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: { ':status': 'COMMISSION_PAID', ':amount': commissionAmount }
                });
                await dynamoDb.send(updateCmd);
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
app.get('/admin/claims', authenticateUser, authorizeAdmin, async (req, res) => {
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

        const queryCmd = new QueryCommand(params);
        const data = await dynamoDb.send(queryCmd);

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
app.put('/admin/claims/:customerId/:claimId/status', authenticateUser, authorizeAdmin, async (req, res) => {
    const { customerId, claimId } = req.params;
    const { status } = req.body;

    if (!status || !VALID_ADMIN_STATUSES.includes(status)) {
        return res.status(400).json({ message: 'Status inválido fornecido.' });
    }

    const fullClaimSk = `CLAIM#${claimId}`;

    try {
        const updateCmd = new UpdateCommand({
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
        });
        await dynamoDb.send(updateCmd);
        res.json({ success: true, message: `Status da reivindicação ${claimId} atualizado para ${status}.` });
    } catch (err) {
        console.error(`Erro ao atualizar status da reivindicação ${claimId} para ${status}:`, err);
        res.status(500).json({ message: 'Erro ao atualizar status da reivindicação.' });
    }
});

// POST /api/admin/users/{userId}/status
app.post('/admin/users/:userId/status', authenticateUser, authorizeAdmin, async (req, res) => {
    const { userId } = req.params;
    const { status } = req.body; // e.g., 'ACTIVE'

    if (!status || !['TRIAL', 'ACTIVE'].includes(status)) {
        return res.status(400).json({ message: 'Status inválido. Use TRIAL ou ACTIVE.' });
    }

    try {
        const updateCmd = new UpdateCommand({
            TableName: process.env.DYNAMODB_TABLE,
            Key: { id: userId, sk: 'CONFIG#ONBOARD' },
            UpdateExpression: 'SET accountType = :status',
            ExpressionAttributeValues: { ':status': status },
        });
        await dynamoDb.send(updateCmd);
        res.json({ success: true, message: `Status do usuário ${userId} atualizado para ${status}.` });
    } catch (err) {
        console.error(`Erro ao atualizar status do usuário ${userId}:`, err);
        res.status(500).json({ message: 'Erro ao atualizar status.' });
    }
});

// PUT /api/admin/claims/{customerId}/{claimId}/recover
app.put('/admin/claims/:customerId/:claimId/recover', authenticateUser, authorizeAdmin, async (req, res) => {
    const { customerId, claimId } = req.params;
    const { recoveredAmount } = req.body;

    if (!recoveredAmount || typeof recoveredAmount !== 'number') {
        return res.status(400).json({ message: 'recoveredAmount é obrigatório e deve ser um número' });
    }

    const fullClaimSk = `CLAIM#${claimId}`;

    try {
        const updateCmd = new UpdateCommand({
            TableName: process.env.DYNAMODB_TABLE,
            Key: { id: customerId, sk: fullClaimSk },
            UpdateExpression: 'SET #status = :status, recoveredAmount = :amount, recoveredAt = :now',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':status': 'RECOVERED',
                ':amount': recoveredAmount,
                ':now': new Date().toISOString(),
            },
        });
        await dynamoDb.send(updateCmd);
        res.json({ success: true, message: `Claim ${claimId} marcada como recuperada com valor ${recoveredAmount}` });
    } catch (err) {
        console.error(`Erro ao marcar claim ${claimId} como recuperada:`, err);
        res.status(500).json({ message: 'Erro ao atualizar claim' });
    }
});

// POST /api/admin/claims/{customerId}/{claimId}/create-invoice
app.post('/admin/claims/:customerId/:claimId/create-invoice', authenticateUser, authorizeAdmin, async (req, res) => {
    const { customerId, claimId } = req.params;
    const stripe = await getStripe(); // Initialize Stripe
    const fullClaimSk = `CLAIM#${claimId}`;

    try {
        // 1. Buscar a claim para obter o valor do crédito
        const getCmd = new GetCommand({
            TableName: process.env.DYNAMODB_TABLE,
            Key: { id: customerId, sk: fullClaimSk },
        });
        const claimData = await dynamoDb.send(getCmd);

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
        const getUserCmd = new GetCommand({ TableName: process.env.DYNAMODB_TABLE, Key: userConfigKey });
        const userConfig = await dynamoDb.send(getUserCmd);

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
        const updateInvoiceCmd = new UpdateCommand({ TableName: process.env.DYNAMODB_TABLE, Key: { id: customerId, sk: fullClaimSk }, UpdateExpression: 'SET stripeInvoiceId = :invId, commissionAmount = :comm, #status = :s', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':invId': invoice.id, ':comm': commissionAmount / 100, ':s': 'INVOICED' } });
        await dynamoDb.send(updateInvoiceCmd);

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

// GET /connections - Listar contas AWS conectadas pelo usuário
app.get('/connections', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.sub;

        const params = {
            TableName: process.env.DYNAMODB_TABLE,
            KeyConditionExpression: 'id = :userId AND begins_with(sk, :skPrefix)',
            ExpressionAttributeValues: {
                ':userId': userId,
                ':skPrefix': 'AWS_ACCOUNT#',
            },
        };

        const queryCmd = new QueryCommand(params);
        const result = await dynamoDb.send(queryCmd);
        const connections = (result.Items || []).map(item => ({
            awsAccountId: item.awsAccountId,
            roleArn: item.roleArn,
            status: item.status,
            connectedAt: item.connectedAt,
            externalId: item.externalId,
        }));

        res.json({ connections });
    } catch (err) {
        console.error('Erro ao buscar conexões:', err);
        res.status(500).json({ message: 'Erro ao buscar conexões AWS' });
    }
});

// DELETE /connections/:awsAccountId - Remover conexão AWS
app.delete('/connections/:awsAccountId', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.sub;
        const { awsAccountId } = req.params;

        // Verificar se a conexão pertence ao usuário
        const getParams = {
            TableName: process.env.DYNAMODB_TABLE,
            Key: {
                id: userId,
                sk: `AWS_ACCOUNT#${awsAccountId}`,
            },
        };

        const getCmd = new GetCommand(getParams);
        const existing = await dynamoDb.send(getCmd);
        if (!existing.Item) {
            return res.status(404).json({ message: 'Conexão não encontrada' });
        }

        // Deletar a conexão
        const deleteParams = {
            TableName: process.env.DYNAMODB_TABLE,
            Key: {
                id: userId,
                sk: `AWS_ACCOUNT#${awsAccountId}`,
            },
        };

        const deleteCmd = new DeleteCommand(deleteParams);
        await dynamoDb.send(deleteCmd);

        res.json({ message: 'Conexão removida com sucesso' });
    } catch (err) {
        console.error('Erro ao remover conexão:', err);
        res.status(500).json({ message: 'Erro ao remover conexão AWS' });
    }
});



// GET /api/sla-claims - Listar claims SLA (duplicate removed)

// GET /sla-reports/:claimId - Download de relatório SLA
app.get('/sla-claims/:claimId/report', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.sub;
        const { claimId } = req.params;

        // Buscar claim
        const getParams = {
            TableName: process.env.DYNAMODB_TABLE,
            Key: {
                id: userId,
                sk: claimId,
            },
        };

        const getCmd = new GetCommand(getParams);
        const result = await dynamoDb.send(getCmd);
        const claim = result.Item;

        if (!claim) {
            return res.status(404).json({ message: 'Claim não encontrado' });
        }

        if (!claim.reportUrl) {
            return res.status(404).json({ message: 'Relatório não disponível' });
        }

        // Extrair bucket e key da URL S3
        const s3Url = claim.reportUrl; // s3://bucket/key
        const matches = s3Url.match(/s3:\/\/([^\/]+)\/(.+)/);

        if (!matches) {
            return res.status(500).json({ message: 'URL do relatório inválida' });
        }

        const bucket = matches[1];
        const key = matches[2];

        // Gerar URL pré-assinada (válida por 1 hora) usando AWS SDK v3
        const presignedUrl = await getSignedUrl(
            s3Presigner,
            new GetObjectCommand({ Bucket: bucket, Key: key }),
            { expiresIn: 3600 }
        );

        res.json({ downloadUrl: presignedUrl });

    } catch (err) {
        console.error('Erro ao gerar URL de download:', err);
        res.status(500).json({ message: 'Erro ao gerar URL de download' });
    }
});

// POST /sla-claims/:claimId/confirm - Confirmar recuperação de crédito SLA
app.post('/sla-claims/:claimId/confirm', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.sub;
        const { claimId } = req.params;
        const { recoveredAmount } = req.body;

        if (!recoveredAmount || recoveredAmount <= 0) {
            return res.status(400).json({ message: 'recoveredAmount deve ser um valor positivo' });
        }

        // Atualizar claim
        const updateParams = {
            TableName: process.env.DYNAMODB_TABLE,
            Key: {
                id: userId,
                sk: claimId,
            },
            UpdateExpression: 'SET #status = :status, recoveredAmount = :recoveredAmount, confirmedAt = :confirmedAt',
            ExpressionAttributeNames: {
                '#status': 'status',
            },
            ExpressionAttributeValues: {
                ':status': 'RECOVERED',
                ':recoveredAmount': recoveredAmount,
                ':confirmedAt': new Date().toISOString(),
            },
        };

        const updateCmd = new UpdateCommand(updateParams);
        await dynamoDb.send(updateCmd);

        res.json({ message: 'Claim confirmado com sucesso' });
    } catch (err) {
        console.error('Erro ao confirmar claim SLA:', err);
        res.status(500).json({ message: 'Erro ao confirmar claim' });
    }
});

// GET /billing - Histórico de cobrança
app.get('/billing', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.sub;

        // Buscar SAVING# metrificados
        const savingsParams = {
            TableName: process.env.DYNAMODB_TABLE,
            KeyConditionExpression: 'id = :id AND begins_with(sk, :prefix)',
            FilterExpression: 'attribute_exists(meteredAt)',
            ExpressionAttributeValues: {
                ':id': userId,
                ':prefix': 'SAVING#',
            },
        };

        const savingsCmd = new QueryCommand(savingsParams);
        const savingsResult = await dynamoDb.send(savingsCmd);
        const savings = (savingsResult.Items || []).map(item => ({
            id: item.sk,
            type: 'SAVING',
            amount: item.amountPerHour, // For display, but actually it's the realized
            meteredAt: item.meteredAt,
        }));

        // Buscar CLAIM#RECOVERED metrificados
        const claimsParams = {
            TableName: process.env.DYNAMODB_TABLE,
            KeyConditionExpression: 'id = :id AND begins_with(sk, :prefix)',
            FilterExpression: '#status = :status AND attribute_exists(meteredAt)',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':id': userId,
                ':prefix': 'CLAIM#',
                ':status': 'RECOVERED',
            },
        };

        const claimsCmd = new QueryCommand(claimsParams);
        const claimsResult = await dynamoDb.send(claimsCmd);
        const claims = (claimsResult.Items || []).map(item => ({
            id: item.sk,
            type: 'CLAIM',
            amount: item.recoveredAmount,
            meteredAt: item.meteredAt,
        }));

        const billingHistory = [...savings, ...claims].sort((a, b) => new Date(b.meteredAt) - new Date(a.meteredAt));

        res.json({ billingHistory });
    } catch (err) {
        console.error('Erro ao buscar histórico de cobrança:', err);
        res.status(500).json({ message: 'Erro ao buscar histórico de cobrança' });
    }
});

// POST /upgrade - Upgrade de Trial para Active
app.post('/upgrade', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.sub;

        // Buscar config atual
        const getParams = {
            TableName: process.env.DYNAMODB_TABLE,
            Key: { id: userId, sk: 'CONFIG#ONBOARD' },
        };

        const getCmd = new GetCommand(getParams);
        const result = await dynamoDb.send(getCmd);
        const config = result.Item;

        if (!config) {
            return res.status(404).json({ message: 'Configuração não encontrada' });
        }

        if (config.accountType === 'ACTIVE') {
            return res.status(400).json({ message: 'Conta já está ativa' });
        }

        // Atualizar para ACTIVE
        const updateParams = {
            TableName: process.env.DYNAMODB_TABLE,
            Key: { id: userId, sk: 'CONFIG#ONBOARD' },
            UpdateExpression: 'SET accountType = :type, upgradedAt = :now, #status = :status',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':type': 'ACTIVE',
                ':now': new Date().toISOString(),
                ':status': 'PENDING_UPGRADE', // Precisará reinstalar com template completo
            },
        };

        const updateCmd = new UpdateCommand(updateParams);
        await dynamoDb.send(updateCmd);

        // Retornar nova config com URL do template completo
        res.json({
            message: 'Upgrade iniciado com sucesso',
            accountType: 'ACTIVE',
            status: 'PENDING_UPGRADE',
            templateUrl: process.env.FULL_TEMPLATE_URL,
            nextSteps: 'Reinstale o CloudFormation com o template completo para habilitar execução de recomendações',
        });

    } catch (err) {
        console.error('Erro ao fazer upgrade:', err);
        res.status(500).json({ message: 'Erro ao processar upgrade' });
    }
});

// GET /user/status - Status do usuário (TRIAL/ACTIVE)
app.get('/user/status', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.sub;

        const params = {
            TableName: process.env.DYNAMODB_TABLE,
            Key: { id: userId, sk: 'CONFIG#ONBOARD' },
        };

        const getCmd = new GetCommand(params);
        const result = await dynamoDb.send(getCmd);
        const config = result.Item;

        res.json({ accountType: config?.accountType || 'TRIAL' });
    } catch (err) {
        console.error('Erro ao buscar status do usuário:', err);
        res.status(500).json({ message: 'Erro ao buscar status' });
    }
});

// GET /billing/history - Histórico de economias e créditos
app.get('/billing/history', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.sub;

        // Buscar SAVING# items
        const savingsParams = {
            TableName: process.env.DYNAMODB_TABLE,
            KeyConditionExpression: 'id = :userId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: {
                ':userId': userId,
                ':prefix': 'SAVING#',
            },
        };

        const savingsCmd = new QueryCommand(savingsParams);
        const savingsResult = await dynamoDb.send(savingsCmd);
        const savings = savingsResult.Items || [];

        // Buscar CLAIM#RECOVERED items
        const claimsParams = {
            TableName: process.env.DYNAMODB_TABLE,
            KeyConditionExpression: 'id = :userId AND begins_with(sk, :prefix)',
            FilterExpression: '#status = :status',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':userId': userId,
                ':prefix': 'CLAIM#',
                ':status': 'RECOVERED',
            },
        };

        const claimsCmd = new QueryCommand(claimsParams);
        const claimsResult = await dynamoDb.send(claimsCmd);
        const claims = claimsResult.Items || [];

        // Combinar e formatar
        const history = [
            ...savings.map(s => ({
                type: 'saving',
                amount: s.amountPerHour,
                timestamp: s.timestamp,
                description: `Economia de ${s.recommendationType}`,
            })),
            ...claims.map(c => ({
                type: 'credit',
                amount: c.recoveredAmount,
                timestamp: c.recoveredAt,
                description: `Crédito SLA recuperado`,
            })),
        ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.json({ history });
    } catch (err) {
        console.error('Erro ao buscar histórico de billing:', err);
        res.status(500).json({ message: 'Erro ao buscar histórico' });
    }
});

// GET /billing/summary - Resumo de billing e economias
app.get('/billing/summary', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.sub;

        // Buscar recomendações executadas
        // CustomerDataIndex garante escalabilidade: query por id + begins_with(sk)
        const recParams = {
            TableName: process.env.DYNAMODB_TABLE,
            IndexName: 'CustomerDataIndex',
            KeyConditionExpression: 'id = :userId AND begins_with(sk, :prefix)',
            FilterExpression: '#status = :executed',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':userId': userId,
                ':prefix': 'REC#',
                ':executed': 'EXECUTED',
            },
        };

        const recCmd = new QueryCommand(recParams);
        const recResult = await dynamoDb.send(recCmd);
        const executedRecs = recResult.Items || [];

        // Calcular economia realizada
        const totalSavings = executedRecs.reduce((sum, rec) => {
            const savings = rec?.potentialSavings || rec?.amountPerHour || 0;
            return sum + (typeof savings === 'number' ? savings : 0);
        }, 0);
        const commission = totalSavings * 0.30; // 30% de comissão

        // Buscar claims de SLA
        const claimParams = {
        TableName: process.env.DYNAMODB_TABLE,
        KeyConditionExpression: 'id = :userId AND begins_with(sk, :prefix)',
        FilterExpression: '#status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
            ':userId': userId,
                ':prefix': 'SLA#',
                ':status': 'REFUNDED',
            },
        };

        const claimCmd = new QueryCommand(claimParams);
        const claimResult = await dynamoDb.send(claimCmd);
        const refundedClaims = claimResult.Items || [];

        const totalCredits = refundedClaims.reduce((sum, claim) => {
            const credit = claim?.creditAmount || claim?.recoveredAmount || 0;
            return sum + (typeof credit === 'number' ? credit : 0);
        }, 0);
        const creditCommission = totalCredits * 0.30;

        res.json({
            summary: {
                totalSavingsRealized: totalSavings,
                totalCreditsRecovered: totalCredits,
                totalValue: totalSavings + totalCredits,
                ourCommission: commission + creditCommission,
                yourSavings: (totalSavings + totalCredits) - (commission + creditCommission),
            },
            recommendations: {
                executed: executedRecs.length,
                totalSavings,
            },
            sla: {
                refunded: refundedClaims.length,
                totalCredits,
            },
        });

    } catch (err) {
        console.error('Erro ao buscar billing:', err);
        res.status(500).json({ message: 'Erro ao buscar dados de billing' });
    }
});

// POST /recommendations/execute - Executar uma recomendação
app.post('/recommendations/execute', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.sub;
        const { recommendationId } = req.body;

        if (!recommendationId) {
            return res.status(400).json({ message: 'recommendationId é obrigatório' });
        }

        // Buscar a recomendação
        const getParams = {
            TableName: process.env.DYNAMODB_TABLE,
            Key: {
                id: userId,
                sk: recommendationId,
            },
        };

        const getCmd = new GetCommand(getParams);
        const result = await dynamoDb.send(getCmd);
        const recommendation = result.Item;

        if (!recommendation) {
            return res.status(404).json({ message: 'Recomendação não encontrada' });
        }

        if (recommendation.status !== 'RECOMMENDED') {
            return res.status(400).json({ message: 'Recomendação já foi processada' });
        }

        // Buscar configuração do cliente para obter roleArn
        const configParams = {
            TableName: process.env.DYNAMODB_TABLE,
            Key: {
                id: userId,
                sk: 'CONFIG#ONBOARD',
            },
        };

        const getConfigCmd = new GetCommand(configParams);
        const configResult = await dynamoDb.send(getConfigCmd);
        const config = configResult.Item;

        if (!config || !config.roleArn) {
            return res.status(400).json({ message: 'Configuração AWS não encontrada' });
        }

        // Invocar a Lambda de execução (será criada a seguir)
        const lambda = new LambdaClient({});
        const invokeCmd = new InvokeCommand({
            FunctionName: process.env.EXECUTE_RECOMMENDATION_LAMBDA_NAME,
            InvocationType: 'Event', // Assíncrona
            Payload: JSON.stringify({
                userId,
                recommendationId,
                recommendation,
                roleArn: config.roleArn,
                externalId: config.externalId,
            }),
        });

        await lambda.send(invokeCmd);

        // Atualizar status para 'EXECUTING'
        const updateParams = {
            TableName: process.env.DYNAMODB_TABLE,
            Key: {
                id: userId,
                sk: recommendationId,
            },
            UpdateExpression: 'SET #status = :status, executedAt = :executedAt',
            ExpressionAttributeNames: {
                '#status': 'status',
            },
            ExpressionAttributeValues: {
                ':status': 'EXECUTING',
                ':executedAt': new Date().toISOString(),
            },
        };

        const updateCmd = new UpdateCommand(updateParams);
        await dynamoDb.send(updateCmd);

        res.json({
            message: 'Execução iniciada com sucesso',
            status: 'EXECUTING'
        });

    } catch (err) {
        console.error('Erro ao executar recomendação:', err);
        res.status(500).json({ message: 'Erro ao executar recomendação' });
    }
});

// GET /admin/metrics - Métricas admin
app.get('/admin/metrics', authenticateUser, authorizeAdmin, async (req, res) => {
    try {
        // TODO: Verificar se o usuário é admin (grupo Cognito)

        // Buscar todos os clientes
        const allCustomersParams = {
            TableName: process.env.DYNAMODB_TABLE,
            IndexName: 'ActiveCustomerIndex',
            KeyConditionExpression: 'sk = :sk',
            ExpressionAttributeValues: {
                ':sk': 'CONFIG#ONBOARD',
            },
        };

        const allCustomersCmd = new QueryCommand(allCustomersParams);
        const allCustomers = await dynamoDb.send(allCustomersCmd);
        const customers = allCustomers.Items || [];

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
        let thisMonthRevenue = 0;

        for (const customer of customers.filter(c => c.accountType === 'ACTIVE')) {
            try {
                const getBillingCmd = new GetCommand({
                    TableName: process.env.DYNAMODB_TABLE,
                    Key: {
                        id: customer.id,
                        sk: `BILLING#${billingPeriod}`,
                    },
                });
                const billingResult = await dynamoDb.send(getBillingCmd);

                if (billingResult.Item) {
                    thisMonthRevenue += billingResult.Item.commission || 0;
                }
            } catch (err) {
                // Ignorar erros individuais
            }
        }

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
        // TODO: Implementar busca de economia potencial

        // Recomendações
        let totalRecommendations = 0;
        let executedRecommendations = 0;

        for (const customer of customers) {
            try {
                // Query escalável: usa GSI CustomerDataIndex com partition key id
                const recCmd = new QueryCommand({
                    TableName: process.env.DYNAMODB_TABLE,
                    IndexName: 'CustomerDataIndex',
                    KeyConditionExpression: 'id = :id AND begins_with(sk, :prefix)',
                    ExpressionAttributeValues: {
                        ':id': customer.id,
                        ':prefix': 'REC#',
                    },
                });
                const recResult = await dynamoDb.send(recCmd);

                totalRecommendations += recResult.Items?.length || 0;
                executedRecommendations += recResult.Items?.filter(r => r.status === 'EXECUTED').length || 0;
            } catch (err) {
                // Ignorar
            }
        }

        const executionRate = totalRecommendations > 0
            ? (executedRecommendations / totalRecommendations) * 100
            : 0;

        // SLA Claims
        let claimsDetected = 0;
        let claimsSubmitted = 0;
        let creditsRecovered = 0;

        for (const customer of customers) {
            try {
                const slaCmd = new QueryCommand({
                    TableName: process.env.DYNAMODB_TABLE,
                    KeyConditionExpression: 'id = :id AND begins_with(sk, :prefix)',
                    ExpressionAttributeValues: {
                        ':id': customer.id,
                        ':prefix': 'SLA#',
                    },
                });
                const slaResult = await dynamoDb.send(slaCmd);

                claimsDetected += slaResult.Items?.length || 0;
                claimsSubmitted += slaResult.Items?.filter(s => s.status === 'SUBMITTED').length || 0;
                creditsRecovered += slaResult.Items
                    ?.filter(s => s.status === 'REFUNDED')
                    .reduce((sum, s) => sum + (s.creditAmount || 0), 0) || 0;
            } catch (err) {
                // Ignorar
            }
        }

        res.json({
            customers: {
                total: totalCustomers,
                trial: trialCustomers,
                active: activeCustomers,
                churnedThisMonth,
            },
            revenue: {
                thisMonth: thisMonthRevenue,
                lastMonth: 0, // TODO: Calcular mês anterior
                growth: 0, // TODO: Calcular crescimento
            },
            leads: {
                newThisWeek,
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
        });

    } catch (err) {
        console.error('Erro ao buscar métricas admin:', err);
        res.status(500).json({ message: 'Erro ao buscar métricas' });
    }
});

// GET /api/system-status/aws - Status dos serviços AWS (usando Health API)
app.get('/api/system-status/aws', authenticateUser, async (req, res) => {
    try {
        // Buscar eventos de saúde recentes (últimas 24 horas)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        const command = new DescribeEventsCommand({
            filter: {
                startTimes: [{
                    from: yesterday
                }],
                eventStatusCodes: ['open', 'upcoming'],
                services: ['EC2', 'RDS', 'S3', 'LAMBDA', 'DYNAMODB']
            },
            maxResults: 50
        });

        const response = await health.send(command);

        const events = response.events || [];

        // Agrupar por serviço e severidade
        const serviceStatus = {};
        events.forEach(event => {
            const service = event.service || 'UNKNOWN';
            if (!serviceStatus[service]) {
                serviceStatus[service] = {
                    status: 'operational',
                    incidents: []
                };
            }

            // Se há evento aberto, considerar como issue
            if (event.eventStatusCode === 'open') {
                serviceStatus[service].status = 'degraded';
            }

            serviceStatus[service].incidents.push({
                eventTypeCode: event.eventTypeCode,
                eventDescription: event.eventDescription?.[0]?.latestDescription,
                startTime: event.startTime,
                lastUpdatedTime: event.lastUpdatedTime,
                region: event.region,
                availabilityZone: event.availabilityZone,
                statusCode: event.eventStatusCode,
                affectedResources: event.affectedEntities?.length || 0
            });
        });

        res.json({
            timestamp: new Date().toISOString(),
            services: serviceStatus,
            totalIncidents: events.length
        });

    } catch (err) {
        console.error('Erro ao buscar status AWS:', err);
        res.status(500).json({
            message: 'Erro ao buscar status dos serviços AWS',
            timestamp: new Date().toISOString(),
            services: {},
            totalIncidents: 0
        });
    }
});

// GET /api/system-status/guardian - Status interno do sistema (heartbeats)
app.get('/api/system-status/guardian', authenticateUser, async (req, res) => {
    try {
        // Buscar heartbeats do sistema
        const params = {
            TableName: process.env.DYNAMODB_TABLE,
            KeyConditionExpression: 'id = :systemId AND begins_with(sk, :heartbeatPrefix)',
            ExpressionAttributeValues: {
                ':systemId': 'SYSTEM#STATUS',
                ':heartbeatPrefix': 'HEARTBEAT#'
            }
        };

        const result = await dynamoDb.send(new QueryCommand(params));
        const heartbeats = result.Items || [];

        // Processar heartbeats
        const systemStatus = {
            costIngestor: { status: 'unknown', lastRun: null, message: 'Nunca executado' },
            correlateHealth: { status: 'unknown', lastRun: null, message: 'Nunca executado' },
            automationSfn: { status: 'unknown', lastRun: null, message: 'Nunca executado' },
            marketplaceMetering: { status: 'unknown', lastRun: null, message: 'Nunca executado' }
        };

        heartbeats.forEach(item => {
            const serviceKey = item.sk.replace('HEARTBEAT#', '');
            // Map DynamoDB keys to camelCase systemStatus keys
            const serviceMap = {
                'COST_INGESTOR': 'costIngestor',
                'CORRELATE_HEALTH': 'correlateHealth',
                'AUTOMATION_SFN': 'automationSfn',
                'MARKETPLACE_METERING': 'marketplaceMetering'
            };
            const service = serviceMap[serviceKey];
            if (service && systemStatus[service]) {
                const lastRun = new Date(item.lastRun);
                const now = new Date();
                const minutesAgo = Math.floor((now.getTime() - lastRun.getTime()) / (1000 * 60));

                systemStatus[service] = {
                    status: item.status === 'SUCCESS' ? 'healthy' : 'error',
                    lastRun: item.lastRun,
                    message: item.status === 'SUCCESS'
                        ? `Última execução: ${minutesAgo} minutos atrás`
                        : `Erro: ${item.message || 'Falha desconhecida'}`
                };
            }
        });

        // Calcular status geral
        const healthyCount = Object.values(systemStatus).filter(s => s.status === 'healthy').length;
        const overallStatus = healthyCount === Object.keys(systemStatus).length ? 'healthy' :
                            healthyCount > 0 ? 'degraded' : 'error';

        res.json({
            timestamp: new Date().toISOString(),
            overallStatus,
            services: systemStatus
        });

    } catch (err) {
        console.error('Erro ao buscar status do sistema:', err);
        res.status(500).json({
            message: 'Erro ao buscar status interno',
            timestamp: new Date().toISOString(),
            overallStatus: 'error',
            services: {}
        });
    }
});

// Export the raw Express app for unit testing (supertest)
// Além disso, registramos rotas com o prefixo '/api' em cima das rotas existentes
// para compatibilidade com clientes/tests que chamam '/api/...' enquanto o app
// define rotas sem este prefixo em vários lugares.
try {
    const stack = app._router && app._router.stack ? app._router.stack.slice() : [];
    for (const layer of stack) {
        if (!layer || !layer.route || !layer.route.path) continue;
        const path = layer.route.path;
        if (typeof path !== 'string') continue;
        if (path.startsWith('/api')) continue; // já exposto

        for (const routeLayer of layer.route.stack) {
            const handle = routeLayer.handle;
            const methods = layer.route.methods || {};
            Object.keys(methods).forEach(m => {
                try {
                    app[m](`/api${path}`, handle);
                } catch (e) {
                    // ignore
                }
            });
        }
    }
} catch (err) {
    // não bloquear inicialização por causa dessa compatibilidade
}

// Express error handler: captura erros não tratados nas rotas e garante resposta JSON
// Em não-production retornamos também a stack para facilitar debugging remoto.
app.use((err, req, res, next) => {
    try {
        const requestId = req.apiGateway?.context?.awsRequestId || req.headers['x-amzn-RequestId'] || 'unknown';
        console.error(`[${requestId}] Unhandled error in express route:`, err && (err.stack || err.message || err));
        if (res.headersSent) return next(err);
        const payload = { message: err && (err.message || 'Internal server error') };
        if (process.env.NODE_ENV !== 'production' && err && err.stack) payload.stack = err.stack;
        res.status(500).json(payload);
    } catch (handlerErr) {
        // Se o handler de erro falhar, ainda assim tente responder de forma simples
        try {
            if (!res.headersSent) res.status(500).json({ message: 'Internal server error' });
        } catch (_) {}
        const requestId = req.apiGateway?.context?.awsRequestId || req.headers['x-amzn-RequestId'] || 'unknown';
        console.error(`[${requestId}] Error while handling error:`, handlerErr);
    }
});

module.exports.rawApp = app;

// Export the serverless-wrapped handler for deployment
module.exports.app = serverless(app);