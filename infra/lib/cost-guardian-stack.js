"use strict";
// infra/lib/cost-guardian-stack.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.CostGuardianStack = void 0;
const cdk = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const aws_lambda_nodejs_1 = require("aws-cdk-lib/aws-lambda-nodejs");
const path = require("path");
const apigw = require("aws-cdk-lib/aws-apigateway");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const cognito = require("aws-cdk-lib/aws-cognito");
const s3 = require("aws-cdk-lib/aws-s3");
const s3deploy = require("aws-cdk-lib/aws-s3-deployment");
const events = require("aws-cdk-lib/aws-events");
const targets = require("aws-cdk-lib/aws-events-targets");
const stepfunctions = require("aws-cdk-lib/aws-stepfunctions");
const sfn_tasks = require("aws-cdk-lib/aws-stepfunctions-tasks");
const secretsmanager = require("aws-cdk-lib/aws-secretsmanager");
const iam = require("aws-cdk-lib/aws-iam");
const sns = require("aws-cdk-lib/aws-sns");
class CostGuardianStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Secrets (Mantido)
        const stripeSecret = new secretsmanager.Secret(this, 'StripeSecret', {
            generateSecretString: { secretStringTemplate: '{"key":""}', generateStringKey: 'key' },
        });
        // Webhook secret (raw string) stored in Secrets Manager for secure delivery
        const stripeWebhookSecret = new secretsmanager.Secret(this, 'StripeWebhookSecret', {
            description: 'Stripe webhook signing secret for platform webhooks',
            generateSecretString: { secretStringTemplate: '{"webhook":""}', generateStringKey: 'webhook' },
        });
        // DynamoDB (Mantido, mas adicionando stream para eficiência futura)
        const table = new dynamodb.Table(this, 'CostGuardianTable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // Habilitar stream
        });
        // GSI para mapear AWS Account ID para nosso Customer ID (CRÍTICO para correlação)
        table.addGlobalSecondaryIndex({
            indexName: 'AwsAccountIndex',
            partitionKey: { name: 'awsAccountId', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.INCLUDE,
            nonKeyAttributes: ['id'], // Projetar o 'id' (nosso Customer ID)
        });
        // GSI para buscar clientes ativos eficientemente (otimização de scan -> query)
        table.addGlobalSecondaryIndex({
            indexName: 'ActiveCustomerIndex',
            partitionKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.INCLUDE,
            nonKeyAttributes: [
                'id',
                'roleArn',
                'automationSettings',
                'subscriptionStatus',
                'supportLevel',
                'exclusionTags'
            ],
        });
        // GSI para o callback do onboarding via ExternalId
        table.addGlobalSecondaryIndex({
            indexName: 'ExternalIdIndex',
            partitionKey: { name: 'externalId', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.INCLUDE,
            nonKeyAttributes: ['id', 'status'],
        });
        // GSI para consultas por status (melhora performance para ingestor e automações)
        table.addGlobalSecondaryIndex({
            indexName: 'StatusIndex',
            partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.INCLUDE,
            nonKeyAttributes: ['sk', 'roleArn', 'automation'],
        });
        // GSI para consultar por cliente (ex: incidentes, claims)
        table.addGlobalSecondaryIndex({
            indexName: 'CustomerDataIndex',
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
        });
        // GSI para consultas de Admin (usar entity/partition sharding para performance)
        table.addGlobalSecondaryIndex({
            indexName: 'AdminViewIndex',
            partitionKey: { name: 'entityType', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.INCLUDE,
            nonKeyAttributes: ['status', 'creditAmount', 'reportUrl', 'incidentId', 'awsAccountId', 'stripeInvoiceId', 'caseId', 'submissionError', 'reportError', 'commissionAmount'],
        });
        // GSI para consultas de recomendações
        table.addGlobalSecondaryIndex({
            indexName: 'RecommendationsIndex',
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        // S3 Bucket para hospedar o template do CloudFormation
        const templateBucket = new s3.Bucket(this, 'CfnTemplateBucket', {
            publicReadAccess: true,
            websiteIndexDocument: 'template.yaml',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            blockPublicAccess: new s3.BlockPublicAccess({
                blockPublicAcls: true,
                ignorePublicAcls: true,
                blockPublicPolicy: false,
                restrictPublicBuckets: false,
            }),
        });
        // Implantação do template do CloudFormation no bucket S3
        // Publica apenas o arquivo `cost-guardian-template.yaml` e o renomeia para `template.yaml`
        new s3deploy.BucketDeployment(this, 'DeployCfnTemplate', {
            sources: [s3deploy.Source.asset(path.join(__dirname, '../../../docs'))],
            // Inclui apenas o template desejado
            include: ['cost-guardian-template.yaml'],
            // Renomeia o arquivo no S3 para a URL pública esperada
            destinationKeyPrefix: '',
            destinationBucket: templateBucket,
        });
        // Cognito (Mantido)
        const userPool = new cognito.UserPool(this, 'CostGuardianPool', {
            selfSignUpEnabled: true,
            signInAliases: { email: true },
            autoVerify: { email: true },
        });
        // Cliente do User Pool para a aplicação web
        const userPoolClient = new cognito.UserPoolClient(this, 'CostGuardianUserPoolClient', {
            userPool,
            generateSecret: false,
        });
        // Grupo de administradores no Cognito
        new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
            userPoolId: userPool.userPoolId,
            groupName: 'Admins',
            description: 'Grupo para administradores da plataforma',
        });
        // 1. Lambda para o API Gateway (Monolito Express)
        // Usamos NodejsFunction para empacotar apenas o necessário com esbuild
        const apiHandlerLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'ApiHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, '../../backend/handler.js'),
            handler: 'app',
            bundling: {
                externalModules: ['aws-sdk'],
            },
            environment: {
                DYNAMODB_TABLE: table.tableName,
                STRIPE_SECRET_ARN: stripeSecret.secretArn,
                STRIPE_WEBHOOK_SECRET_ARN: stripeWebhookSecret.secretArn,
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                PLATFORM_ACCOUNT_ID: this.account || process.env.CDK_DEFAULT_ACCOUNT,
            },
        });
        table.grantReadWriteData(apiHandlerLambda);
        stripeSecret.grantRead(apiHandlerLambda);
        // Grant the API handler permission to read the webhook secret
        stripeWebhookSecret.grantRead(apiHandlerLambda);
        // 2. Lambda para o EventBridge (Correlacionar Eventos Health)
        const healthEventHandlerLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'HealthEventHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, '../../backend/functions/correlate-health.js'),
            handler: 'handler',
            bundling: { externalModules: ['aws-sdk'] },
            environment: {
                DYNAMODB_TABLE: table.tableName,
                SFN_ARN: '', // Será preenchido abaixo
            },
        });
        table.grantReadWriteData(healthEventHandlerLambda);
        // Lambda para execução de recomendações
        const executeRecommendationLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'ExecuteRecommendation', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'handler',
            entry: path.join(__dirname, '../../backend/functions/execute-recommendation.js'),
            timeout: cdk.Duration.minutes(5),
            memorySize: 256,
            environment: {
                DYNAMODB_TABLE: table.tableName,
            },
            bundling: { externalModules: ['aws-sdk'] },
        });
        // Permissões para o Lambda de recomendações
        table.grantReadWriteData(executeRecommendationLambda);
        executeRecommendationLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['sts:AssumeRole'],
            resources: ['*'], // O Lambda precisa poder assumir a role do cliente
        }));
        // Dar ao ApiHandler o ARN do lambda de execução e permitir invocação
        apiHandlerLambda.addEnvironment('EXECUTE_RECOMMENDATION_LAMBDA_ARN', executeRecommendationLambda.functionArn);
        executeRecommendationLambda.grantInvoke(apiHandlerLambda);
        // 3. Lambdas para as Tarefas do Step Functions
        const slaCalculateImpactLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'SlaCalculateImpact', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, '../../backend/functions/sla-workflow.js'),
            handler: 'calculateImpact',
            bundling: { externalModules: ['aws-sdk'] },
            environment: {
                DYNAMODB_TABLE: table.tableName,
            },
            role: new iam.Role(this, 'SlaCalcRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
                ],
                inlinePolicies: {
                    AssumeCustomerRolePolicy: new iam.PolicyDocument({
                        statements: [new iam.PolicyStatement({
                                actions: ['sts:AssumeRole'],
                                resources: ['arn:aws:iam::*:role/CostGuardianDelegatedRole'],
                            })]
                    })
                }
            })
        });
        // Garantir permissões ao DynamoDB para a Lambda de cálculo de impacto
        table.grantReadWriteData(slaCalculateImpactLambda);
        const slaCheckLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'SlaCheck', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, '../../backend/functions/sla-workflow.js'),
            handler: 'checkSLA',
            bundling: { externalModules: ['aws-sdk'] },
            environment: { DYNAMODB_TABLE: table.tableName },
        });
        const slaGenerateReportLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'SlaGenerateReport', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, '../../backend/functions/sla-workflow.js'),
            handler: 'generateReport',
            bundling: { externalModules: ['aws-sdk'] },
            environment: {
                DYNAMODB_TABLE: table.tableName,
                STRIPE_SECRET_ARN: stripeSecret.secretArn,
                REPORTS_BUCKET_NAME: '', // Será preenchido abaixo
            },
        });
        table.grantReadWriteData(slaGenerateReportLambda);
        stripeSecret.grantRead(slaGenerateReportLambda);
        // Grant the report generator Lambda access to the webhook secret if needed
        stripeWebhookSecret.grantRead(slaGenerateReportLambda);
        // Criar bucket S3 para armazenar relatórios PDF gerados pela Lambda
        const reportsBucket = new s3.Bucket(this, 'ReportsBucket', {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        });
        // Fornecer o nome do bucket como variável de ambiente para a Lambda (atualiza)
        slaGenerateReportLambda.addEnvironment('REPORTS_BUCKET_NAME', reportsBucket.bucketName);
        // Permissões necessárias para a Lambda escrever objetos no bucket
        reportsBucket.grantPut(slaGenerateReportLambda);
        const slaSubmitTicketLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'SlaSubmitTicket', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, '../../backend/functions/sla-workflow.js'),
            handler: 'submitSupportTicket',
            bundling: { externalModules: ['aws-sdk'] },
            environment: { DYNAMODB_TABLE: table.tableName },
            role: new iam.Role(this, 'SlaSubmitRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
                ],
                inlinePolicies: {
                    AssumeCustomerRolePolicy: new iam.PolicyDocument({
                        statements: [new iam.PolicyStatement({
                                actions: ['sts:AssumeRole'],
                                resources: ['arn:aws:iam::*:role/CostGuardianDelegatedRole'],
                            })]
                    })
                }
            })
        });
        table.grantReadWriteData(slaSubmitTicketLambda);
        // Obter o event bus padrão da plataforma
        const eventBus = events.EventBus.fromEventBusName(this, 'DefaultBus', 'default');
        // Política para o Event Bus: restringe quem pode chamar PutEvents.
        // Em vez de deixar 'Principal' aberto, exigimos que o principal seja
        // a IAM Role que o cliente cria no template (nome: EventBusRole).
        // Isso mantém a capacidade cross-account (conta variável) mas evita
        // que contas arbitrárias enviem eventos ao barramento.
        new events.CfnEventBusPolicy(this, 'EventBusPolicy', {
            eventBusName: eventBus.eventBusName,
            statementId: 'AllowClientHealthEvents',
            action: 'events:PutEvents',
            principal: '*',
            condition: {
                type: 'StringEquals',
                key: 'aws:PrincipalArn',
                // Ajuste o sufixo da role aqui se alterar o nome usado no template do cliente
                value: 'arn:aws:iam::*:role/EventBusRole',
            },
        });
        // --- INÍCIO DA CORREÇÃO ---
        // REMOVA este bloco. A filtragem de 'events:source' é feita
        // pela 'healthRule' abaixo, não pela política do barramento.
        /*
        eventBusPolicy.addPropertyOverride('Condition', {
          Type: 'StringEquals',
          Key: 'events:source',
          Value: 'aws.health',
        });
        */
        // --- FIM DA CORREÇÃO ---
        // EventBridge Health (Esta é a regra de FILTRAGEM correta)
        new events.Rule(this, 'HealthEventRule', {
            eventPattern: {
                source: ['aws.health'],
                detailType: ['AWS Health Event'],
            },
            eventBus,
            targets: [new targets.LambdaFunction(healthEventHandlerLambda)],
        });
        // --- Bloco 2: Ingestão diária de custos (Fase 1: Visibilidade) ---
        // Topic SNS para alertas de anomalia (Fase 7)
        const anomalyAlertsTopic = new sns.Topic(this, 'AnomalyAlertsTopic');
        // 4.1. Crie um novo Lambda para ingestão diária de custos
        const costIngestorLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'CostIngestor', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, '../../backend/functions/ingest-costs.js'),
            handler: 'handler',
            timeout: cdk.Duration.minutes(5),
            bundling: { externalModules: ['aws-sdk'] },
            environment: {
                DYNAMODB_TABLE: table.tableName,
                SNS_TOPIC_ARN: anomalyAlertsTopic.topicArn,
            },
            role: new iam.Role(this, 'CostIngestorRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
                ],
                inlinePolicies: {
                    DynamoAndAssumePolicy: new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                actions: ['dynamodb:Scan'],
                                resources: [table.tableArn, `${table.tableArn}/index/*`],
                            }),
                            new iam.PolicyStatement({
                                actions: ['sts:AssumeRole'],
                                resources: ['arn:aws:iam::*:role/CostGuardianDelegatedRole'],
                            }),
                        ]
                    })
                }
            })
        });
        table.grantReadData(costIngestorLambda);
        // Permitir que o ingestor publique alertas no tópico SNS
        anomalyAlertsTopic.grantPublish(costIngestorLambda);
        // 4.2. Crie uma regra do EventBridge para acionar o ingestor diariamente
        new events.Rule(this, 'DailyCostIngestionRule', {
            schedule: events.Schedule.cron({ minute: '0', hour: '5' }),
            targets: [new targets.LambdaFunction(costIngestorLambda)],
        });
        // --- Bloco 3: Automação Ativa (Fase 2) ---
        // 7.1. Lambdas para tarefas de automação
        const stopIdleInstancesLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'StopIdleInstances', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, '../../backend/functions/stop-idle-instances.js'),
            handler: 'handler',
            timeout: cdk.Duration.minutes(5),
            bundling: { externalModules: ['aws-sdk'] },
            environment: { DYNAMODB_TABLE: table.tableName },
            role: new iam.Role(this, 'StopIdleRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
                inlinePolicies: {
                    DynamoPolicy: new iam.PolicyDocument({ statements: [
                            new iam.PolicyStatement({ actions: ['dynamodb:Query', 'dynamodb:Scan', 'dynamodb:GetItem'], resources: [table.tableArn, `${table.tableArn}/index/*`] }),
                            new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: ['arn:aws:iam::*:role/CostGuardianDelegatedRole'] }),
                        ] })
                }
            })
        });
        table.grantReadData(stopIdleInstancesLambda);
        const deleteUnusedEbsLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'DeleteUnusedEbs', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, '../../backend/functions/delete-unused-ebs.js'),
            handler: 'handler',
            timeout: cdk.Duration.minutes(5),
            bundling: { externalModules: ['aws-sdk'] },
            environment: { DYNAMODB_TABLE: table.tableName },
            role: new iam.Role(this, 'DeleteEbsRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
                inlinePolicies: {
                    DynamoPolicy: new iam.PolicyDocument({ statements: [
                            new iam.PolicyStatement({ actions: ['dynamodb:Query', 'dynamodb:Scan', 'dynamodb:GetItem'], resources: [table.tableArn, `${table.tableArn}/index/*`] }),
                            new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: ['arn:aws:iam::*:role/CostGuardianDelegatedRole'] }),
                        ] })
                }
            })
        });
        table.grantReadData(deleteUnusedEbsLambda);
        // 7.2 - 7.3 Step Function de automação (executa tasks em paralelo)
        const stopIdleTask = new sfn_tasks.LambdaInvoke(this, 'StopIdleResources', { lambdaFunction: stopIdleInstancesLambda, outputPath: '$.Payload' });
        const deleteEbsTask = new sfn_tasks.LambdaInvoke(this, 'DeleteUnusedVolumes', { lambdaFunction: deleteUnusedEbsLambda, outputPath: '$.Payload' });
        const automationDefinition = new stepfunctions.Parallel(this, 'RunAllAutomations')
            .branch(stopIdleTask)
            .branch(deleteEbsTask);
        const automationSfn = new stepfunctions.StateMachine(this, 'AutomationWorkflow', {
            definitionBody: stepfunctions.DefinitionBody.fromChainable(automationDefinition),
        });
        // 7.4. Regra semanal para disparar a State Machine
        new events.Rule(this, 'WeeklyAutomationRule', {
            schedule: events.Schedule.cron({ weekDay: 'SUN', hour: '3', minute: '0' }),
            targets: [new targets.SfnStateMachine(automationSfn)],
        });
        // Step Functions SLA (Usando os Lambdas corretos)
        const calculateImpactTask = new sfn_tasks.LambdaInvoke(this, 'CalculateImpact', { lambdaFunction: slaCalculateImpactLambda, outputPath: '$.Payload' });
        const checkSlaTask = new sfn_tasks.LambdaInvoke(this, 'CheckSLA', { lambdaFunction: slaCheckLambda, outputPath: '$.Payload' });
        const generateReportTask = new sfn_tasks.LambdaInvoke(this, 'GenerateReport', { lambdaFunction: slaGenerateReportLambda, outputPath: '$.Payload' });
        const submitTicketTask = new sfn_tasks.LambdaInvoke(this, 'SubmitTicket', { lambdaFunction: slaSubmitTicketLambda, outputPath: '$.Payload' });
        const noClaim = new stepfunctions.Succeed(this, 'NoClaimGenerated');
        const claimChoice = new stepfunctions.Choice(this, 'IsClaimGenerated?')
            .when(stepfunctions.Condition.stringEquals('$.status', 'generated'), submitTicketTask)
            .otherwise(noClaim);
        const slaDefinition = calculateImpactTask
            .next(checkSlaTask)
            .next(generateReportTask)
            .next(claimChoice);
        const sfn = new stepfunctions.StateMachine(this, 'SLAWorkflow', {
            definitionBody: stepfunctions.DefinitionBody.fromChainable(slaDefinition),
        });
        // Adicionar o ARN do SFN ao Lambda de correlação
        healthEventHandlerLambda.addEnvironment('SFN_ARN', sfn.stateMachineArn);
        // Permissão para o Lambda iniciar a State Machine
        sfn.grantStartExecution(healthEventHandlerLambda);
        // API Gateway (Usando o 'apiHandlerLambda' correto)
        const api = new apigw.RestApi(this, 'CostGuardianAPI', {
            restApiName: 'Cost Guardian API',
            defaultCorsPreflightOptions: { allowOrigins: apigw.Cors.ALL_ORIGINS },
        });
        const auth = new apigw.CognitoUserPoolsAuthorizer(this, 'CognitoAuth', {
            cognitoUserPools: [userPool],
        });
        const apiIntegration = new apigw.LambdaIntegration(apiHandlerLambda);
        // Expor todas as rotas sob /api para coincidir com as rotas Express do backend (/api/*)
        const apiRoot = api.root.addResource('api');
        // Health público: GET /api/health -> sem authorizer
        const health = apiRoot.addResource('health');
        health.addMethod('GET', apiIntegration); // public health check
        // Resources API (agora sob /api)
        const onboard = apiRoot.addResource('onboard');
        onboard.addMethod('POST', apiIntegration); // Webhook, sem auth
        // Stripe webhook (public endpoint, sem authorizer)
        const stripeApi = apiRoot.addResource('stripe');
        stripeApi.addResource('webhook').addMethod('POST', apiIntegration);
        // Novo endpoint para gerar config de onboarding
        const onboardInit = apiRoot.addResource('onboard-init');
        onboardInit.addMethod('GET', apiIntegration, { authorizer: auth });
        // Dashboard API para o frontend: GET /api/dashboard/costs (protegido)
        const dashboardApi = apiRoot.addResource('dashboard');
        dashboardApi.addResource('costs').addMethod('GET', apiIntegration, { authorizer: auth });
        // Settings API: GET/POST /api/settings/automation
        const settingsApi = apiRoot.addResource('settings');
        const automationApi = settingsApi.addResource('automation');
        automationApi.addMethod('GET', apiIntegration, { authorizer: auth });
        automationApi.addMethod('POST', apiIntegration, { authorizer: auth });
        const incidents = apiRoot.addResource('incidents');
        incidents.addMethod('GET', apiIntegration, { authorizer: auth });
        const slaClaims = apiRoot.addResource('sla-claims');
        slaClaims.addMethod('GET', apiIntegration, { authorizer: auth });
        const invoicesApi = apiRoot.addResource('invoices');
        invoicesApi.addMethod('GET', apiIntegration, { authorizer: auth });
        // Alerts API: GET /api/alerts (protegido)
        const alertsApi = apiRoot.addResource('alerts');
        alertsApi.addMethod('GET', apiIntegration, { authorizer: auth });
        const termsApi = apiRoot.addResource('accept-terms');
        termsApi.addMethod('POST', apiIntegration, { authorizer: auth });
        // Endpoint de Admin
        const adminApi = apiRoot.addResource('admin');
        const adminClaims = adminApi.addResource('claims');
        // GET /api/admin/claims
        adminClaims.addMethod('GET', apiIntegration, { authorizer: auth });
        // Sub-recursos para operações em claims específicas
        const claimsByCustomer = adminClaims.addResource('{customerId}');
        const specificClaim = claimsByCustomer.addResource('{claimId}');
        // PUT /api/admin/claims/{customerId}/{claimId}/status
        specificClaim.addResource('status').addMethod('PUT', apiIntegration, { authorizer: auth });
        // POST /api/admin/claims/{customerId}/{claimId}/create-invoice
        specificClaim.addResource('create-invoice').addMethod('POST', apiIntegration, { authorizer: auth });
        // Outputs (Mantido)
        new cdk.CfnOutput(this, 'APIUrl', { value: api.url });
        new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
        new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
        new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
        new cdk.CfnOutput(this, 'SFNArn', { value: sfn.stateMachineArn });
        new cdk.CfnOutput(this, 'CfnTemplateUrl', {
            value: `${templateBucket.bucketWebsiteUrl}/template.yaml`,
            description: 'URL do template do CloudFormation para o onboarding do cliente. Use esta URL no frontend.',
        });
    }
}
exports.CostGuardianStack = CostGuardianStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29zdC1ndWFyZGlhbi1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNvc3QtZ3VhcmRpYW4tc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLG1DQUFtQzs7O0FBRW5DLG1DQUFtQztBQUVuQyxpREFBaUQ7QUFDakQscUVBQStEO0FBQy9ELDZCQUE2QjtBQUM3QixvREFBb0Q7QUFDcEQscURBQXFEO0FBQ3JELG1EQUFtRDtBQUNuRCx5Q0FBeUM7QUFDekMsMERBQTBEO0FBQzFELGlEQUFpRDtBQUNqRCwwREFBMEQ7QUFDMUQsK0RBQStEO0FBQy9ELGlFQUFpRTtBQUNqRSxpRUFBaUU7QUFDakUsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUUzQyxNQUFhLGlCQUFrQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzlDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsb0JBQW9CO1FBQ3BCLE1BQU0sWUFBWSxHQUFHLElBQUksY0FBYyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ25FLG9CQUFvQixFQUFFLEVBQUUsb0JBQW9CLEVBQUUsWUFBWSxFQUFFLGlCQUFpQixFQUFFLEtBQUssRUFBRTtTQUN2RixDQUFDLENBQUM7UUFFSCw0RUFBNEU7UUFDNUUsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLGNBQWMsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLHFCQUFxQixFQUFFO1lBQ2pGLFdBQVcsRUFBRSxxREFBcUQ7WUFDbEUsb0JBQW9CLEVBQUUsRUFBRSxvQkFBb0IsRUFBRSxnQkFBZ0IsRUFBRSxpQkFBaUIsRUFBRSxTQUFTLEVBQUU7U0FDL0YsQ0FBQyxDQUFDO1FBRUgsb0VBQW9FO1FBQ3BFLE1BQU0sS0FBSyxHQUFHLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsbUJBQW1CLEVB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LEVBQUUsS0FBSyxFQUFFLGNBQWMsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLENBQUM7UUFDeEYsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxXQUFXLEVBQUUsRUFBRSxLQUFLLEVBQUUsS0FBSyxDQUFDLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFDakUsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxRQUFRLEVBQUUsRUFBRSxLQUFLLEVBQUUsR0FBRyxDQUFDLGVBQWUsRUFBRSxDQUFDLENBQUM7UUFDbEUsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUN4QyxLQUFLLEVBQUUsR0FBRyxjQUFjLENBQUMsZ0JBQWdCLGdCQUFnQjtZQUN6RCxXQUFXLEVBQUUsMkZBQTJGO1NBQ3pHLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTNoQkQsOENBMmhCQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIGluZnJhL2xpYi9jb3N0LWd1YXJkaWFuLXN0YWNrLnRzXHJcblxyXG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xyXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcclxuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzJztcclxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcclxuaW1wb3J0ICogYXMgYXBpZ3cgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xyXG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xyXG5pbXBvcnQgKiBhcyBjb2duaXRvIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2duaXRvJztcclxuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcclxuaW1wb3J0ICogYXMgczNkZXBsb3kgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzLWRlcGxveW1lbnQnO1xyXG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cyc7XHJcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcclxuaW1wb3J0ICogYXMgc3RlcGZ1bmN0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucyc7XHJcbmltcG9ydCAqIGFzIHNmbl90YXNrcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucy10YXNrcyc7XHJcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuaW1wb3J0ICogYXMgc25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnO1xyXG5cclxuZXhwb3J0IGNsYXNzIENvc3RHdWFyZGlhblN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcclxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XHJcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcclxuXHJcbiAgICAvLyBTZWNyZXRzIChNYW50aWRvKVxyXG4gICAgY29uc3Qgc3RyaXBlU2VjcmV0ID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldCh0aGlzLCAnU3RyaXBlU2VjcmV0Jywge1xyXG4gICAgICBnZW5lcmF0ZVNlY3JldFN0cmluZzogeyBzZWNyZXRTdHJpbmdUZW1wbGF0ZTogJ3tcImtleVwiOlwiXCJ9JywgZ2VuZXJhdGVTdHJpbmdLZXk6ICdrZXknIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBXZWJob29rIHNlY3JldCAocmF3IHN0cmluZykgc3RvcmVkIGluIFNlY3JldHMgTWFuYWdlciBmb3Igc2VjdXJlIGRlbGl2ZXJ5XHJcbiAgICBjb25zdCBzdHJpcGVXZWJob29rU2VjcmV0ID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldCh0aGlzLCAnU3RyaXBlV2ViaG9va1NlY3JldCcsIHtcclxuICAgICAgZGVzY3JpcHRpb246ICdTdHJpcGUgd2ViaG9vayBzaWduaW5nIHNlY3JldCBmb3IgcGxhdGZvcm0gd2ViaG9va3MnLFxyXG4gICAgICBnZW5lcmF0ZVNlY3JldFN0cmluZzogeyBzZWNyZXRTdHJpbmdUZW1wbGF0ZTogJ3tcIndlYmhvb2tcIjpcIlwifScsIGdlbmVyYXRlU3RyaW5nS2V5OiAnd2ViaG9vaycgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIER5bmFtb0RCIChNYW50aWRvLCBtYXMgYWRpY2lvbmFuZG8gc3RyZWFtIHBhcmEgZWZpY2nDqm5jaWEgZnV0dXJhKVxyXG4gICAgY29uc3QgdGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ0Nvc3RHdWFyZGlhblRhYmxlJywge1xyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgLy8gQ2hhdmUgcHJpbcOhcmlhIHBhcmEgdXN1w6FyaW9zLCBjbGFpbXMsIGV0Yy5cclxuICAgICAgc29ydEtleTogeyBuYW1lOiAnc2snLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LCAvLyBDaGF2ZSBkZSBjbGFzc2lmaWNhw6fDo28gcGFyYSBtb2RlbGFnZW0gZmxleMOtdmVsXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICAgIHN0cmVhbTogZHluYW1vZGIuU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTLCAvLyBIYWJpbGl0YXIgc3RyZWFtXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHU0kgcGFyYSBtYXBlYXIgQVdTIEFjY291bnQgSUQgcGFyYSBub3NzbyBDdXN0b21lciBJRCAoQ1LDjVRJQ08gcGFyYSBjb3JyZWxhw6fDo28pXHJcbiAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0F3c0FjY291bnRJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnYXdzQWNjb3VudElkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLklOQ0xVREUsXHJcbiAgICAgIG5vbktleUF0dHJpYnV0ZXM6IFsnaWQnXSwgLy8gUHJvamV0YXIgbyAnaWQnIChub3NzbyBDdXN0b21lciBJRClcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdTSSBwYXJhIGJ1c2NhciBjbGllbnRlcyBhdGl2b3MgZWZpY2llbnRlbWVudGUgKG90aW1pemHDp8OjbyBkZSBzY2FuIC0+IHF1ZXJ5KVxyXG4gICAgdGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdBY3RpdmVDdXN0b21lckluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdzaycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3N0YXR1cycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5JTkNMVURFLFxyXG4gICAgICBub25LZXlBdHRyaWJ1dGVzOiBbXHJcbiAgICAgICAgJ2lkJyxcclxuICAgICAgICAncm9sZUFybicsXHJcbiAgICAgICAgJ2F1dG9tYXRpb25TZXR0aW5ncycsXHJcbiAgICAgICAgJ3N1YnNjcmlwdGlvblN0YXR1cycsXHJcbiAgICAgICAgJ3N1cHBvcnRMZXZlbCcsXHJcbiAgICAgICAgJ2V4Y2x1c2lvblRhZ3MnXHJcbiAgICAgIF0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHU0kgcGFyYSBvIGNhbGxiYWNrIGRvIG9uYm9hcmRpbmcgdmlhIEV4dGVybmFsSWRcclxuICAgIHRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnRXh0ZXJuYWxJZEluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdleHRlcm5hbElkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLklOQ0xVREUsXHJcbiAgICAgIG5vbktleUF0dHJpYnV0ZXM6IFsnaWQnLCAnc3RhdHVzJ10sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHU0kgcGFyYSBjb25zdWx0YXMgcG9yIHN0YXR1cyAobWVsaG9yYSBwZXJmb3JtYW5jZSBwYXJhIGluZ2VzdG9yIGUgYXV0b21hw6fDtWVzKVxyXG4gICAgdGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdTdGF0dXNJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnc3RhdHVzJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuSU5DTFVERSxcclxuICAgICAgbm9uS2V5QXR0cmlidXRlczogWydzaycsICdyb2xlQXJuJywgJ2F1dG9tYXRpb24nXSxcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBHU0kgcGFyYSBjb25zdWx0YXIgcG9yIGNsaWVudGUgKGV4OiBpbmNpZGVudGVzLCBjbGFpbXMpXHJcbiAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0N1c3RvbWVyRGF0YUluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3NrJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdTSSBwYXJhIGNvbnN1bHRhcyBkZSBBZG1pbiAodXNhciBlbnRpdHkvcGFydGl0aW9uIHNoYXJkaW5nIHBhcmEgcGVyZm9ybWFuY2UpXHJcbiAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0FkbWluVmlld0luZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdlbnRpdHlUeXBlJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAnY3JlYXRlZEF0JywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLklOQ0xVREUsXHJcbiAgICAgIG5vbktleUF0dHJpYnV0ZXM6IFsnc3RhdHVzJywgJ2NyZWRpdEFtb3VudCcsICdyZXBvcnRVcmwnLCAnaW5jaWRlbnRJZCcsICdhd3NBY2NvdW50SWQnLCAnc3RyaXBlSW52b2ljZUlkJywgJ2Nhc2VJZCcsICdzdWJtaXNzaW9uRXJyb3InLCAncmVwb3J0RXJyb3InLCAnY29tbWlzc2lvbkFtb3VudCddLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR1NJIHBhcmEgY29uc3VsdGFzIGRlIHJlY29tZW5kYcOnw7Vlc1xyXG4gICAgdGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdSZWNvbW1lbmRhdGlvbnNJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdzaycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5BTEwsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTMyBCdWNrZXQgcGFyYSBob3NwZWRhciBvIHRlbXBsYXRlIGRvIENsb3VkRm9ybWF0aW9uXHJcbiAgICBjb25zdCB0ZW1wbGF0ZUJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ0NmblRlbXBsYXRlQnVja2V0Jywge1xyXG4gICAgICBwdWJsaWNSZWFkQWNjZXNzOiB0cnVlLFxyXG4gICAgICB3ZWJzaXRlSW5kZXhEb2N1bWVudDogJ3RlbXBsYXRlLnlhbWwnLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcclxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IG5ldyBzMy5CbG9ja1B1YmxpY0FjY2Vzcyh7XHJcbiAgICAgICAgYmxvY2tQdWJsaWNBY2xzOiB0cnVlLFxyXG4gICAgICAgIGlnbm9yZVB1YmxpY0FjbHM6IHRydWUsXHJcbiAgICAgICAgYmxvY2tQdWJsaWNQb2xpY3k6IGZhbHNlLCAvLyBQZXJtaXRlIHBvbMOtdGljYXMgcMO6YmxpY2FzXHJcbiAgICAgICAgcmVzdHJpY3RQdWJsaWNCdWNrZXRzOiBmYWxzZSxcclxuICAgICAgfSksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBJbXBsYW50YcOnw6NvIGRvIHRlbXBsYXRlIGRvIENsb3VkRm9ybWF0aW9uIG5vIGJ1Y2tldCBTM1xyXG4gICAgLy8gUHVibGljYSBhcGVuYXMgbyBhcnF1aXZvIGBjb3N0LWd1YXJkaWFuLXRlbXBsYXRlLnlhbWxgIGUgbyByZW5vbWVpYSBwYXJhIGB0ZW1wbGF0ZS55YW1sYFxyXG4gICAgbmV3IHMzZGVwbG95LkJ1Y2tldERlcGxveW1lbnQodGhpcywgJ0RlcGxveUNmblRlbXBsYXRlJywge1xyXG4gICAgICBzb3VyY2VzOiBbczNkZXBsb3kuU291cmNlLmFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi8uLi9kb2NzJykpXSwgLy8gQXBvbnRhIGVzcGVjaWZpY2FtZW50ZSBwYXJhIG8gZGlyZXTDs3JpbyBkb2NzXHJcbiAgICAgIC8vIEluY2x1aSBhcGVuYXMgbyB0ZW1wbGF0ZSBkZXNlamFkb1xyXG4gICAgICBpbmNsdWRlOiBbJ2Nvc3QtZ3VhcmRpYW4tdGVtcGxhdGUueWFtbCddLFxyXG4gICAgICAvLyBSZW5vbWVpYSBvIGFycXVpdm8gbm8gUzMgcGFyYSBhIFVSTCBww7pibGljYSBlc3BlcmFkYVxyXG4gICAgICBkZXN0aW5hdGlvbktleVByZWZpeDogJycsXHJcbiAgICAgIGRlc3RpbmF0aW9uQnVja2V0OiB0ZW1wbGF0ZUJ1Y2tldCxcclxuICAgIH0pO1xyXG5cclxuXHJcbiAgICAvLyBDb2duaXRvIChNYW50aWRvKVxyXG4gICAgY29uc3QgdXNlclBvb2wgPSBuZXcgY29nbml0by5Vc2VyUG9vbCh0aGlzLCAnQ29zdEd1YXJkaWFuUG9vbCcsIHtcclxuICAgICAgc2VsZlNpZ25VcEVuYWJsZWQ6IHRydWUsXHJcbiAgICAgIHNpZ25JbkFsaWFzZXM6IHsgZW1haWw6IHRydWUgfSxcclxuICAgICAgYXV0b1ZlcmlmeTogeyBlbWFpbDogdHJ1ZSB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ2xpZW50ZSBkbyBVc2VyIFBvb2wgcGFyYSBhIGFwbGljYcOnw6NvIHdlYlxyXG4gICAgY29uc3QgdXNlclBvb2xDbGllbnQgPSBuZXcgY29nbml0by5Vc2VyUG9vbENsaWVudCh0aGlzLCAnQ29zdEd1YXJkaWFuVXNlclBvb2xDbGllbnQnLCB7XHJcbiAgICAgIHVzZXJQb29sLFxyXG4gICAgICBnZW5lcmF0ZVNlY3JldDogZmFsc2UsIFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR3J1cG8gZGUgYWRtaW5pc3RyYWRvcmVzIG5vIENvZ25pdG9cclxuICAgIG5ldyBjb2duaXRvLkNmblVzZXJQb29sR3JvdXAodGhpcywgJ0FkbWluR3JvdXAnLCB7XHJcbiAgICAgIHVzZXJQb29sSWQ6IHVzZXJQb29sLnVzZXJQb29sSWQsXHJcbiAgICAgIGdyb3VwTmFtZTogJ0FkbWlucycsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnR3J1cG8gcGFyYSBhZG1pbmlzdHJhZG9yZXMgZGEgcGxhdGFmb3JtYScsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAxLiBMYW1iZGEgcGFyYSBvIEFQSSBHYXRld2F5IChNb25vbGl0byBFeHByZXNzKVxyXG4gICAgLy8gVXNhbW9zIE5vZGVqc0Z1bmN0aW9uIHBhcmEgZW1wYWNvdGFyIGFwZW5hcyBvIG5lY2Vzc8OhcmlvIGNvbSBlc2J1aWxkXHJcbiAgICBjb25zdCBhcGlIYW5kbGVyTGFtYmRhID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsICdBcGlIYW5kbGVyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9iYWNrZW5kL2hhbmRsZXIuanMnKSxcclxuICAgICAgaGFuZGxlcjogJ2FwcCcsIC8vIGV4cG9ydCBkbyBleHByZXNzICsgc2VydmVybGVzcyDDqSBleHBvc3RvIGNvbW8gJ2FwcCcgbm8gaGFuZGxlci5qc1xyXG4gICAgICBidW5kbGluZzoge1xyXG4gICAgICAgIGV4dGVybmFsTW9kdWxlczogWydhd3Mtc2RrJ10sXHJcbiAgICAgIH0sXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBTVFJJUEVfU0VDUkVUX0FSTjogc3RyaXBlU2VjcmV0LnNlY3JldEFybixcclxuICAgICAgICBTVFJJUEVfV0VCSE9PS19TRUNSRVRfQVJOOiBzdHJpcGVXZWJob29rU2VjcmV0LnNlY3JldEFybixcclxuICAgICAgICBVU0VSX1BPT0xfSUQ6IHVzZXJQb29sLnVzZXJQb29sSWQsXHJcbiAgICAgICAgVVNFUl9QT09MX0NMSUVOVF9JRDogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCxcclxuICAgICAgICBQTEFURk9STV9BQ0NPVU5UX0lEOiB0aGlzLmFjY291bnQgfHwgcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfQUNDT1VOVCxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGFwaUhhbmRsZXJMYW1iZGEpO1xyXG4gICAgc3RyaXBlU2VjcmV0LmdyYW50UmVhZChhcGlIYW5kbGVyTGFtYmRhKTtcclxuICAgIC8vIEdyYW50IHRoZSBBUEkgaGFuZGxlciBwZXJtaXNzaW9uIHRvIHJlYWQgdGhlIHdlYmhvb2sgc2VjcmV0XHJcbiAgICBzdHJpcGVXZWJob29rU2VjcmV0LmdyYW50UmVhZChhcGlIYW5kbGVyTGFtYmRhKTtcclxuXHJcbiAgICAvLyAyLiBMYW1iZGEgcGFyYSBvIEV2ZW50QnJpZGdlIChDb3JyZWxhY2lvbmFyIEV2ZW50b3MgSGVhbHRoKVxyXG4gICAgY29uc3QgaGVhbHRoRXZlbnRIYW5kbGVyTGFtYmRhID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsICdIZWFsdGhFdmVudEhhbmRsZXInLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL2JhY2tlbmQvZnVuY3Rpb25zL2NvcnJlbGF0ZS1oZWFsdGguanMnKSxcclxuICAgICAgaGFuZGxlcjogJ2hhbmRsZXInLFxyXG4gICAgICBidW5kbGluZzogeyBleHRlcm5hbE1vZHVsZXM6IFsnYXdzLXNkayddIH0sXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBTRk5fQVJOOiAnJywgLy8gU2Vyw6EgcHJlZW5jaGlkbyBhYmFpeG9cclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGhlYWx0aEV2ZW50SGFuZGxlckxhbWJkYSk7XHJcblxyXG4gICAgLy8gTGFtYmRhIHBhcmEgZXhlY3XDp8OjbyBkZSByZWNvbWVuZGHDp8O1ZXNcclxuICAgIGNvbnN0IGV4ZWN1dGVSZWNvbW1lbmRhdGlvbkxhbWJkYSA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLCAnRXhlY3V0ZVJlY29tbWVuZGF0aW9uJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2hhbmRsZXInLFxyXG4gICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL2JhY2tlbmQvZnVuY3Rpb25zL2V4ZWN1dGUtcmVjb21tZW5kYXRpb24uanMnKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXHJcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lLFxyXG4gICAgICB9LFxyXG4gICAgICBidW5kbGluZzogeyBleHRlcm5hbE1vZHVsZXM6IFsnYXdzLXNkayddIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBQZXJtaXNzw7VlcyBwYXJhIG8gTGFtYmRhIGRlIHJlY29tZW5kYcOnw7Vlc1xyXG4gICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGV4ZWN1dGVSZWNvbW1lbmRhdGlvbkxhbWJkYSk7XHJcbiAgICBleGVjdXRlUmVjb21tZW5kYXRpb25MYW1iZGEuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgYWN0aW9uczogWydzdHM6QXNzdW1lUm9sZSddLFxyXG4gICAgICByZXNvdXJjZXM6IFsnKiddLCAvLyBPIExhbWJkYSBwcmVjaXNhIHBvZGVyIGFzc3VtaXIgYSByb2xlIGRvIGNsaWVudGVcclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBEYXIgYW8gQXBpSGFuZGxlciBvIEFSTiBkbyBsYW1iZGEgZGUgZXhlY3XDp8OjbyBlIHBlcm1pdGlyIGludm9jYcOnw6NvXHJcbiAgICBhcGlIYW5kbGVyTGFtYmRhLmFkZEVudmlyb25tZW50KCdFWEVDVVRFX1JFQ09NTUVOREFUSU9OX0xBTUJEQV9BUk4nLCBleGVjdXRlUmVjb21tZW5kYXRpb25MYW1iZGEuZnVuY3Rpb25Bcm4pO1xyXG4gICAgZXhlY3V0ZVJlY29tbWVuZGF0aW9uTGFtYmRhLmdyYW50SW52b2tlKGFwaUhhbmRsZXJMYW1iZGEpO1xyXG5cclxuICAgIC8vIDMuIExhbWJkYXMgcGFyYSBhcyBUYXJlZmFzIGRvIFN0ZXAgRnVuY3Rpb25zXHJcbiAgICBjb25zdCBzbGFDYWxjdWxhdGVJbXBhY3RMYW1iZGEgPSBuZXcgTm9kZWpzRnVuY3Rpb24odGhpcywgJ1NsYUNhbGN1bGF0ZUltcGFjdCcsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vYmFja2VuZC9mdW5jdGlvbnMvc2xhLXdvcmtmbG93LmpzJyksXHJcbiAgICAgIGhhbmRsZXI6ICdjYWxjdWxhdGVJbXBhY3QnLFxyXG4gICAgICBidW5kbGluZzogeyBleHRlcm5hbE1vZHVsZXM6IFsnYXdzLXNkayddIH0sXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgfSxcclxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdTbGFDYWxjUm9sZScsIHtcclxuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcclxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcclxuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpXHJcbiAgICAgICAgXSxcclxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xyXG4gICAgICAgICAgQXNzdW1lQ3VzdG9tZXJSb2xlUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcclxuICAgICAgICAgICAgc3RhdGVtZW50czogW25ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgICBhY3Rpb25zOiBbJ3N0czpBc3N1bWVSb2xlJ10sXHJcbiAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbJ2Fybjphd3M6aWFtOjoqOnJvbGUvQ29zdEd1YXJkaWFuRGVsZWdhdGVkUm9sZSddLCBcclxuICAgICAgICAgICAgfSldXHJcbiAgICAgICAgICB9KVxyXG4gICAgICAgIH1cclxuICAgICAgfSlcclxuICAgIH0pO1xyXG4gIC8vIEdhcmFudGlyIHBlcm1pc3PDtWVzIGFvIER5bmFtb0RCIHBhcmEgYSBMYW1iZGEgZGUgY8OhbGN1bG8gZGUgaW1wYWN0b1xyXG4gIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShzbGFDYWxjdWxhdGVJbXBhY3RMYW1iZGEpO1xyXG4gICAgXHJcbiAgICBjb25zdCBzbGFDaGVja0xhbWJkYSA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLCAnU2xhQ2hlY2snLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL2JhY2tlbmQvZnVuY3Rpb25zL3NsYS13b3JrZmxvdy5qcycpLFxyXG4gICAgICBoYW5kbGVyOiAnY2hlY2tTTEEnLFxyXG4gICAgICBidW5kbGluZzogeyBleHRlcm5hbE1vZHVsZXM6IFsnYXdzLXNkayddIH0sXHJcbiAgICAgIGVudmlyb25tZW50OiB7IERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHNsYUdlbmVyYXRlUmVwb3J0TGFtYmRhID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsICdTbGFHZW5lcmF0ZVJlcG9ydCcsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vYmFja2VuZC9mdW5jdGlvbnMvc2xhLXdvcmtmbG93LmpzJyksXHJcbiAgICAgIGhhbmRsZXI6ICdnZW5lcmF0ZVJlcG9ydCcsXHJcbiAgICAgIGJ1bmRsaW5nOiB7IGV4dGVybmFsTW9kdWxlczogWydhd3Mtc2RrJ10gfSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFNUUklQRV9TRUNSRVRfQVJOOiBzdHJpcGVTZWNyZXQuc2VjcmV0QXJuLFxyXG4gICAgICAgIFJFUE9SVFNfQlVDS0VUX05BTUU6ICcnLCAvLyBTZXLDoSBwcmVlbmNoaWRvIGFiYWl4b1xyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgICB0YWJsZS5ncmFudFJlYWRXcml0ZURhdGEoc2xhR2VuZXJhdGVSZXBvcnRMYW1iZGEpO1xyXG4gICAgc3RyaXBlU2VjcmV0LmdyYW50UmVhZChzbGFHZW5lcmF0ZVJlcG9ydExhbWJkYSk7XHJcbiAgLy8gR3JhbnQgdGhlIHJlcG9ydCBnZW5lcmF0b3IgTGFtYmRhIGFjY2VzcyB0byB0aGUgd2ViaG9vayBzZWNyZXQgaWYgbmVlZGVkXHJcbiAgc3RyaXBlV2ViaG9va1NlY3JldC5ncmFudFJlYWQoc2xhR2VuZXJhdGVSZXBvcnRMYW1iZGEpO1xyXG5cclxuICAgIC8vIENyaWFyIGJ1Y2tldCBTMyBwYXJhIGFybWF6ZW5hciByZWxhdMOzcmlvcyBQREYgZ2VyYWRvcyBwZWxhIExhbWJkYVxyXG4gICAgY29uc3QgcmVwb3J0c0J1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ1JlcG9ydHNCdWNrZXQnLCB7XHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiB0cnVlLFxyXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gRm9ybmVjZXIgbyBub21lIGRvIGJ1Y2tldCBjb21vIHZhcmnDoXZlbCBkZSBhbWJpZW50ZSBwYXJhIGEgTGFtYmRhIChhdHVhbGl6YSlcclxuICAgIHNsYUdlbmVyYXRlUmVwb3J0TGFtYmRhLmFkZEVudmlyb25tZW50KCdSRVBPUlRTX0JVQ0tFVF9OQU1FJywgcmVwb3J0c0J1Y2tldC5idWNrZXROYW1lKTtcclxuXHJcbiAgICAvLyBQZXJtaXNzw7VlcyBuZWNlc3PDoXJpYXMgcGFyYSBhIExhbWJkYSBlc2NyZXZlciBvYmpldG9zIG5vIGJ1Y2tldFxyXG4gICAgcmVwb3J0c0J1Y2tldC5ncmFudFB1dChzbGFHZW5lcmF0ZVJlcG9ydExhbWJkYSk7XHJcblxyXG4gICAgY29uc3Qgc2xhU3VibWl0VGlja2V0TGFtYmRhID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsICdTbGFTdWJtaXRUaWNrZXQnLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL2JhY2tlbmQvZnVuY3Rpb25zL3NsYS13b3JrZmxvdy5qcycpLFxyXG4gICAgICBoYW5kbGVyOiAnc3VibWl0U3VwcG9ydFRpY2tldCcsXHJcbiAgICAgIGJ1bmRsaW5nOiB7IGV4dGVybmFsTW9kdWxlczogWydhd3Mtc2RrJ10gfSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHsgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSB9LFxyXG4gICAgICByb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ1NsYVN1Ym1pdFJvbGUnLCB7XHJcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXHJcbiAgICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXHJcbiAgICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKVxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcclxuICAgICAgICAgIEFzc3VtZUN1c3RvbWVyUm9sZVBvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XHJcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgYWN0aW9uczogWydzdHM6QXNzdW1lUm9sZSddLFxyXG4gICAgICAgICAgICAgIHJlc291cmNlczogWydhcm46YXdzOmlhbTo6Kjpyb2xlL0Nvc3RHdWFyZGlhbkRlbGVnYXRlZFJvbGUnXSxcclxuICAgICAgICAgICAgfSldXHJcbiAgICAgICAgICB9KVxyXG4gICAgICAgIH1cclxuICAgICAgfSlcclxuICAgIH0pO1xyXG4gICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHNsYVN1Ym1pdFRpY2tldExhbWJkYSk7XHJcbiAgICBcclxuICAgIC8vIE9idGVyIG8gZXZlbnQgYnVzIHBhZHLDo28gZGEgcGxhdGFmb3JtYVxyXG4gICAgY29uc3QgZXZlbnRCdXMgPSBldmVudHMuRXZlbnRCdXMuZnJvbUV2ZW50QnVzTmFtZSh0aGlzLCAnRGVmYXVsdEJ1cycsICdkZWZhdWx0Jyk7XHJcblxyXG4gICAgLy8gUG9sw610aWNhIHBhcmEgbyBFdmVudCBCdXM6IHJlc3RyaW5nZSBxdWVtIHBvZGUgY2hhbWFyIFB1dEV2ZW50cy5cclxuICAgIC8vIEVtIHZleiBkZSBkZWl4YXIgJ1ByaW5jaXBhbCcgYWJlcnRvLCBleGlnaW1vcyBxdWUgbyBwcmluY2lwYWwgc2VqYVxyXG4gICAgLy8gYSBJQU0gUm9sZSBxdWUgbyBjbGllbnRlIGNyaWEgbm8gdGVtcGxhdGUgKG5vbWU6IEV2ZW50QnVzUm9sZSkuXHJcbiAgICAvLyBJc3NvIG1hbnTDqW0gYSBjYXBhY2lkYWRlIGNyb3NzLWFjY291bnQgKGNvbnRhIHZhcmnDoXZlbCkgbWFzIGV2aXRhXHJcbiAgICAvLyBxdWUgY29udGFzIGFyYml0csOhcmlhcyBlbnZpZW0gZXZlbnRvcyBhbyBiYXJyYW1lbnRvLlxyXG4gICAgbmV3IGV2ZW50cy5DZm5FdmVudEJ1c1BvbGljeSh0aGlzLCAnRXZlbnRCdXNQb2xpY3knLCB7XHJcbiAgICAgIGV2ZW50QnVzTmFtZTogZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxyXG4gICAgICBzdGF0ZW1lbnRJZDogJ0FsbG93Q2xpZW50SGVhbHRoRXZlbnRzJyxcclxuICAgICAgYWN0aW9uOiAnZXZlbnRzOlB1dEV2ZW50cycsXHJcbiAgICAgIHByaW5jaXBhbDogJyonLCAvLyBNYW50w6ltIGNyb3NzLWFjY291bnQsIG1hcyBhIGNvbmRpw6fDo28gYWJhaXhvIHJlc3RyaW5nZSBhIHJvbGVcclxuICAgICAgY29uZGl0aW9uOiB7XHJcbiAgICAgICAgdHlwZTogJ1N0cmluZ0VxdWFscycsXHJcbiAgICAgICAga2V5OiAnYXdzOlByaW5jaXBhbEFybicsXHJcbiAgICAgICAgLy8gQWp1c3RlIG8gc3VmaXhvIGRhIHJvbGUgYXF1aSBzZSBhbHRlcmFyIG8gbm9tZSB1c2FkbyBubyB0ZW1wbGF0ZSBkbyBjbGllbnRlXHJcbiAgICAgICAgdmFsdWU6ICdhcm46YXdzOmlhbTo6Kjpyb2xlL0V2ZW50QnVzUm9sZScsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAtLS0gSU7DjUNJTyBEQSBDT1JSRcOHw4NPIC0tLVxyXG4gICAgLy8gUkVNT1ZBIGVzdGUgYmxvY28uIEEgZmlsdHJhZ2VtIGRlICdldmVudHM6c291cmNlJyDDqSBmZWl0YVxyXG4gICAgLy8gcGVsYSAnaGVhbHRoUnVsZScgYWJhaXhvLCBuw6NvIHBlbGEgcG9sw610aWNhIGRvIGJhcnJhbWVudG8uXHJcbiAgICAvKlxyXG4gICAgZXZlbnRCdXNQb2xpY3kuYWRkUHJvcGVydHlPdmVycmlkZSgnQ29uZGl0aW9uJywge1xyXG4gICAgICBUeXBlOiAnU3RyaW5nRXF1YWxzJyxcclxuICAgICAgS2V5OiAnZXZlbnRzOnNvdXJjZScsXHJcbiAgICAgIFZhbHVlOiAnYXdzLmhlYWx0aCcsXHJcbiAgICB9KTtcclxuICAgICovXHJcbiAgICAvLyAtLS0gRklNIERBIENPUlJFw4fDg08gLS0tXHJcblxyXG4gICAgLy8gRXZlbnRCcmlkZ2UgSGVhbHRoIChFc3RhIMOpIGEgcmVncmEgZGUgRklMVFJBR0VNIGNvcnJldGEpXHJcbiAgICBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ0hlYWx0aEV2ZW50UnVsZScsIHtcclxuICAgICAgZXZlbnRQYXR0ZXJuOiB7XHJcbiAgICAgICAgc291cmNlOiBbJ2F3cy5oZWFsdGgnXSwgLy8gQSBmaWx0cmFnZW0gYWNvbnRlY2UgYXF1aVxyXG4gICAgICAgIGRldGFpbFR5cGU6IFsnQVdTIEhlYWx0aCBFdmVudCddLFxyXG4gICAgICB9LFxyXG4gICAgICBldmVudEJ1cyxcclxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKGhlYWx0aEV2ZW50SGFuZGxlckxhbWJkYSldLFxyXG4gICAgfSk7XHJcblxyXG4gIC8vIC0tLSBCbG9jbyAyOiBJbmdlc3TDo28gZGnDoXJpYSBkZSBjdXN0b3MgKEZhc2UgMTogVmlzaWJpbGlkYWRlKSAtLS1cclxuICAvLyBUb3BpYyBTTlMgcGFyYSBhbGVydGFzIGRlIGFub21hbGlhIChGYXNlIDcpXHJcbiAgY29uc3QgYW5vbWFseUFsZXJ0c1RvcGljID0gbmV3IHNucy5Ub3BpYyh0aGlzLCAnQW5vbWFseUFsZXJ0c1RvcGljJyk7XHJcbiAgICAvLyA0LjEuIENyaWUgdW0gbm92byBMYW1iZGEgcGFyYSBpbmdlc3TDo28gZGnDoXJpYSBkZSBjdXN0b3NcclxuICAgIGNvbnN0IGNvc3RJbmdlc3RvckxhbWJkYSA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLCAnQ29zdEluZ2VzdG9yJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9iYWNrZW5kL2Z1bmN0aW9ucy9pbmdlc3QtY29zdHMuanMnKSxcclxuICAgICAgaGFuZGxlcjogJ2hhbmRsZXInLFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcclxuICAgICAgYnVuZGxpbmc6IHsgZXh0ZXJuYWxNb2R1bGVzOiBbJ2F3cy1zZGsnXSB9LFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgU05TX1RPUElDX0FSTjogYW5vbWFseUFsZXJ0c1RvcGljLnRvcGljQXJuLFxyXG4gICAgICB9LFxyXG4gICAgICByb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ0Nvc3RJbmdlc3RvclJvbGUnLCB7XHJcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXHJcbiAgICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXHJcbiAgICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKVxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcclxuICAgICAgICAgIER5bmFtb0FuZEFzc3VtZVBvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XHJcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcclxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbJ2R5bmFtb2RiOlNjYW4nXSxcclxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW3RhYmxlLnRhYmxlQXJuLCBgJHt0YWJsZS50YWJsZUFybn0vaW5kZXgvKmBdLFxyXG4gICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsnc3RzOkFzc3VtZVJvbGUnXSxcclxuICAgICAgICAgICAgICAgIHJlc291cmNlczogWydhcm46YXdzOmlhbTo6Kjpyb2xlL0Nvc3RHdWFyZGlhbkRlbGVnYXRlZFJvbGUnXSxcclxuICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgXVxyXG4gICAgICAgICAgfSlcclxuICAgICAgICB9XHJcbiAgICAgIH0pXHJcbiAgICB9KTtcclxuICAgIHRhYmxlLmdyYW50UmVhZERhdGEoY29zdEluZ2VzdG9yTGFtYmRhKTtcclxuXHJcbiAgLy8gUGVybWl0aXIgcXVlIG8gaW5nZXN0b3IgcHVibGlxdWUgYWxlcnRhcyBubyB0w7NwaWNvIFNOU1xyXG4gIGFub21hbHlBbGVydHNUb3BpYy5ncmFudFB1Ymxpc2goY29zdEluZ2VzdG9yTGFtYmRhKTtcclxuXHJcbiAgICAvLyA0LjIuIENyaWUgdW1hIHJlZ3JhIGRvIEV2ZW50QnJpZGdlIHBhcmEgYWNpb25hciBvIGluZ2VzdG9yIGRpYXJpYW1lbnRlXHJcbiAgICBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ0RhaWx5Q29zdEluZ2VzdGlvblJ1bGUnLCB7XHJcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUuY3Jvbih7IG1pbnV0ZTogJzAnLCBob3VyOiAnNScgfSksIC8vIFRvZG8gZGlhIMOgcyAwNTowMCBVVENcclxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKGNvc3RJbmdlc3RvckxhbWJkYSldLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gLS0tIEJsb2NvIDM6IEF1dG9tYcOnw6NvIEF0aXZhIChGYXNlIDIpIC0tLVxyXG4gICAgLy8gNy4xLiBMYW1iZGFzIHBhcmEgdGFyZWZhcyBkZSBhdXRvbWHDp8Ojb1xyXG4gICAgY29uc3Qgc3RvcElkbGVJbnN0YW5jZXNMYW1iZGEgPSBuZXcgTm9kZWpzRnVuY3Rpb24odGhpcywgJ1N0b3BJZGxlSW5zdGFuY2VzJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9iYWNrZW5kL2Z1bmN0aW9ucy9zdG9wLWlkbGUtaW5zdGFuY2VzLmpzJyksXHJcbiAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXHJcbiAgICAgIGJ1bmRsaW5nOiB7IGV4dGVybmFsTW9kdWxlczogWydhd3Mtc2RrJ10gfSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHsgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSB9LFxyXG4gICAgICByb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ1N0b3BJZGxlUm9sZScsIHtcclxuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcclxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKV0sXHJcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcclxuICAgICAgICAgIER5bmFtb1BvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7IHN0YXRlbWVudHM6IFtcclxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoeyBhY3Rpb25zOiBbJ2R5bmFtb2RiOlF1ZXJ5JywnZHluYW1vZGI6U2NhbicsJ2R5bmFtb2RiOkdldEl0ZW0nXSwgcmVzb3VyY2VzOiBbdGFibGUudGFibGVBcm4sIGAke3RhYmxlLnRhYmxlQXJufS9pbmRleC8qYF0gfSksXHJcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgYWN0aW9uczogWydzdHM6QXNzdW1lUm9sZSddLCByZXNvdXJjZXM6IFsnYXJuOmF3czppYW06Oio6cm9sZS9Db3N0R3VhcmRpYW5EZWxlZ2F0ZWRSb2xlJ10gfSksXHJcbiAgICAgICAgICBdfSlcclxuICAgICAgICB9XHJcbiAgICAgIH0pXHJcbiAgICB9KTtcclxuICAgIHRhYmxlLmdyYW50UmVhZERhdGEoc3RvcElkbGVJbnN0YW5jZXNMYW1iZGEpO1xyXG5cclxuICAgIGNvbnN0IGRlbGV0ZVVudXNlZEVic0xhbWJkYSA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLCAnRGVsZXRlVW51c2VkRWJzJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9iYWNrZW5kL2Z1bmN0aW9ucy9kZWxldGUtdW51c2VkLWVicy5qcycpLFxyXG4gICAgICBoYW5kbGVyOiAnaGFuZGxlcicsXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxyXG4gICAgICBidW5kbGluZzogeyBleHRlcm5hbE1vZHVsZXM6IFsnYXdzLXNkayddIH0sXHJcbiAgICAgIGVudmlyb25tZW50OiB7IERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUgfSxcclxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdEZWxldGVFYnNSb2xlJywge1xyXG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxyXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW2lhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpXSxcclxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xyXG4gICAgICAgICAgRHluYW1vUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHsgc3RhdGVtZW50czogW1xyXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7IGFjdGlvbnM6IFsnZHluYW1vZGI6UXVlcnknLCdkeW5hbW9kYjpTY2FuJywnZHluYW1vZGI6R2V0SXRlbSddLCByZXNvdXJjZXM6IFt0YWJsZS50YWJsZUFybiwgYCR7dGFibGUudGFibGVBcm59L2luZGV4LypgXSB9KSxcclxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoeyBhY3Rpb25zOiBbJ3N0czpBc3N1bWVSb2xlJ10sIHJlc291cmNlczogWydhcm46YXdzOmlhbTo6Kjpyb2xlL0Nvc3RHdWFyZGlhbkRlbGVnYXRlZFJvbGUnXSB9KSxcclxuICAgICAgICAgIF19KVxyXG4gICAgICAgIH1cclxuICAgICAgfSlcclxuICAgIH0pO1xyXG4gICAgdGFibGUuZ3JhbnRSZWFkRGF0YShkZWxldGVVbnVzZWRFYnNMYW1iZGEpO1xyXG5cclxuICAgIC8vIDcuMiAtIDcuMyBTdGVwIEZ1bmN0aW9uIGRlIGF1dG9tYcOnw6NvIChleGVjdXRhIHRhc2tzIGVtIHBhcmFsZWxvKVxyXG4gICAgY29uc3Qgc3RvcElkbGVUYXNrID0gbmV3IHNmbl90YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ1N0b3BJZGxlUmVzb3VyY2VzJywgeyBsYW1iZGFGdW5jdGlvbjogc3RvcElkbGVJbnN0YW5jZXNMYW1iZGEsIG91dHB1dFBhdGg6ICckLlBheWxvYWQnIH0pO1xyXG4gICAgY29uc3QgZGVsZXRlRWJzVGFzayA9IG5ldyBzZm5fdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdEZWxldGVVbnVzZWRWb2x1bWVzJywgeyBsYW1iZGFGdW5jdGlvbjogZGVsZXRlVW51c2VkRWJzTGFtYmRhLCBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyB9KTtcclxuXHJcbiAgICBjb25zdCBhdXRvbWF0aW9uRGVmaW5pdGlvbiA9IG5ldyBzdGVwZnVuY3Rpb25zLlBhcmFsbGVsKHRoaXMsICdSdW5BbGxBdXRvbWF0aW9ucycpXHJcbiAgICAgIC5icmFuY2goc3RvcElkbGVUYXNrKVxyXG4gICAgICAuYnJhbmNoKGRlbGV0ZUVic1Rhc2spO1xyXG5cclxuICAgIGNvbnN0IGF1dG9tYXRpb25TZm4gPSBuZXcgc3RlcGZ1bmN0aW9ucy5TdGF0ZU1hY2hpbmUodGhpcywgJ0F1dG9tYXRpb25Xb3JrZmxvdycsIHtcclxuICAgICAgZGVmaW5pdGlvbkJvZHk6IHN0ZXBmdW5jdGlvbnMuRGVmaW5pdGlvbkJvZHkuZnJvbUNoYWluYWJsZShhdXRvbWF0aW9uRGVmaW5pdGlvbiksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyA3LjQuIFJlZ3JhIHNlbWFuYWwgcGFyYSBkaXNwYXJhciBhIFN0YXRlIE1hY2hpbmVcclxuICAgIG5ldyBldmVudHMuUnVsZSh0aGlzLCAnV2Vla2x5QXV0b21hdGlvblJ1bGUnLCB7XHJcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUuY3Jvbih7IHdlZWtEYXk6ICdTVU4nLCBob3VyOiAnMycsIG1pbnV0ZTogJzAnIH0pLCAvLyBEb21pbmdvIDAzOjAwIFVUQ1xyXG4gICAgICB0YXJnZXRzOiBbbmV3IHRhcmdldHMuU2ZuU3RhdGVNYWNoaW5lKGF1dG9tYXRpb25TZm4pXSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFN0ZXAgRnVuY3Rpb25zIFNMQSAoVXNhbmRvIG9zIExhbWJkYXMgY29ycmV0b3MpXHJcbiAgICBjb25zdCBjYWxjdWxhdGVJbXBhY3RUYXNrID0gbmV3IHNmbl90YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ0NhbGN1bGF0ZUltcGFjdCcsIHsgbGFtYmRhRnVuY3Rpb246IHNsYUNhbGN1bGF0ZUltcGFjdExhbWJkYSwgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCcgfSk7XHJcbiAgICBjb25zdCBjaGVja1NsYVRhc2sgPSBuZXcgc2ZuX3Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnQ2hlY2tTTEEnLCB7IGxhbWJkYUZ1bmN0aW9uOiBzbGFDaGVja0xhbWJkYSwgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCcgfSk7XHJcbiAgICBjb25zdCBnZW5lcmF0ZVJlcG9ydFRhc2sgPSBuZXcgc2ZuX3Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnR2VuZXJhdGVSZXBvcnQnLCB7IGxhbWJkYUZ1bmN0aW9uOiBzbGFHZW5lcmF0ZVJlcG9ydExhbWJkYSwgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCcgfSk7XHJcbiAgICBjb25zdCBzdWJtaXRUaWNrZXRUYXNrID0gbmV3IHNmbl90YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ1N1Ym1pdFRpY2tldCcsIHsgbGFtYmRhRnVuY3Rpb246IHNsYVN1Ym1pdFRpY2tldExhbWJkYSwgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCcgfSk7XHJcbiAgICBjb25zdCBub0NsYWltID0gbmV3IHN0ZXBmdW5jdGlvbnMuU3VjY2VlZCh0aGlzLCAnTm9DbGFpbUdlbmVyYXRlZCcpO1xyXG5cclxuICAgIGNvbnN0IGNsYWltQ2hvaWNlID0gbmV3IHN0ZXBmdW5jdGlvbnMuQ2hvaWNlKHRoaXMsICdJc0NsYWltR2VuZXJhdGVkPycpXHJcbiAgICAgIC53aGVuKHN0ZXBmdW5jdGlvbnMuQ29uZGl0aW9uLnN0cmluZ0VxdWFscygnJC5zdGF0dXMnLCAnZ2VuZXJhdGVkJyksIHN1Ym1pdFRpY2tldFRhc2spXHJcbiAgICAgIC5vdGhlcndpc2Uobm9DbGFpbSk7XHJcblxyXG4gICAgY29uc3Qgc2xhRGVmaW5pdGlvbiA9IGNhbGN1bGF0ZUltcGFjdFRhc2tcclxuICAgICAgLm5leHQoY2hlY2tTbGFUYXNrKVxyXG4gICAgICAubmV4dChnZW5lcmF0ZVJlcG9ydFRhc2spXHJcbiAgICAgIC5uZXh0KGNsYWltQ2hvaWNlKTtcclxuXHJcbiAgICBjb25zdCBzZm4gPSBuZXcgc3RlcGZ1bmN0aW9ucy5TdGF0ZU1hY2hpbmUodGhpcywgJ1NMQVdvcmtmbG93Jywge1xyXG4gICAgICBkZWZpbml0aW9uQm9keTogc3RlcGZ1bmN0aW9ucy5EZWZpbml0aW9uQm9keS5mcm9tQ2hhaW5hYmxlKHNsYURlZmluaXRpb24pLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQWRpY2lvbmFyIG8gQVJOIGRvIFNGTiBhbyBMYW1iZGEgZGUgY29ycmVsYcOnw6NvXHJcbiAgICBoZWFsdGhFdmVudEhhbmRsZXJMYW1iZGEuYWRkRW52aXJvbm1lbnQoJ1NGTl9BUk4nLCBzZm4uc3RhdGVNYWNoaW5lQXJuKTtcclxuICAgIC8vIFBlcm1pc3PDo28gcGFyYSBvIExhbWJkYSBpbmljaWFyIGEgU3RhdGUgTWFjaGluZVxyXG4gICAgc2ZuLmdyYW50U3RhcnRFeGVjdXRpb24oaGVhbHRoRXZlbnRIYW5kbGVyTGFtYmRhKTtcclxuXHJcbiAgICAvLyBBUEkgR2F0ZXdheSAoVXNhbmRvIG8gJ2FwaUhhbmRsZXJMYW1iZGEnIGNvcnJldG8pXHJcbiAgICBjb25zdCBhcGkgPSBuZXcgYXBpZ3cuUmVzdEFwaSh0aGlzLCAnQ29zdEd1YXJkaWFuQVBJJywge1xyXG4gICAgICByZXN0QXBpTmFtZTogJ0Nvc3QgR3VhcmRpYW4gQVBJJyxcclxuICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB7IGFsbG93T3JpZ2luczogYXBpZ3cuQ29ycy5BTExfT1JJR0lOUyB9LFxyXG4gICAgfSk7XHJcbiAgICBjb25zdCBhdXRoID0gbmV3IGFwaWd3LkNvZ25pdG9Vc2VyUG9vbHNBdXRob3JpemVyKHRoaXMsICdDb2duaXRvQXV0aCcsIHtcclxuICAgICAgY29nbml0b1VzZXJQb29sczogW3VzZXJQb29sXSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGFwaUludGVncmF0aW9uID0gbmV3IGFwaWd3LkxhbWJkYUludGVncmF0aW9uKGFwaUhhbmRsZXJMYW1iZGEpO1xyXG5cclxuICAgIC8vIEV4cG9yIHRvZGFzIGFzIHJvdGFzIHNvYiAvYXBpIHBhcmEgY29pbmNpZGlyIGNvbSBhcyByb3RhcyBFeHByZXNzIGRvIGJhY2tlbmQgKC9hcGkvKilcclxuICAgIGNvbnN0IGFwaVJvb3QgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnYXBpJyk7XHJcblxyXG4gIC8vIEhlYWx0aCBww7pibGljbzogR0VUIC9hcGkvaGVhbHRoIC0+IHNlbSBhdXRob3JpemVyXHJcbiAgY29uc3QgaGVhbHRoID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnaGVhbHRoJyk7XHJcbiAgaGVhbHRoLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24pOyAvLyBwdWJsaWMgaGVhbHRoIGNoZWNrXHJcblxyXG4gICAgLy8gUmVzb3VyY2VzIEFQSSAoYWdvcmEgc29iIC9hcGkpXHJcbiAgICBjb25zdCBvbmJvYXJkID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnb25ib2FyZCcpO1xyXG4gICAgb25ib2FyZC5hZGRNZXRob2QoJ1BPU1QnLCBhcGlJbnRlZ3JhdGlvbik7IC8vIFdlYmhvb2ssIHNlbSBhdXRoXHJcblxyXG4gIC8vIFN0cmlwZSB3ZWJob29rIChwdWJsaWMgZW5kcG9pbnQsIHNlbSBhdXRob3JpemVyKVxyXG4gIGNvbnN0IHN0cmlwZUFwaSA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ3N0cmlwZScpO1xyXG4gIHN0cmlwZUFwaS5hZGRSZXNvdXJjZSgnd2ViaG9vaycpLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uKTtcclxuXHJcbiAgICAvLyBOb3ZvIGVuZHBvaW50IHBhcmEgZ2VyYXIgY29uZmlnIGRlIG9uYm9hcmRpbmdcclxuICAgIGNvbnN0IG9uYm9hcmRJbml0ID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnb25ib2FyZC1pbml0Jyk7XHJcbiAgICBvbmJvYXJkSW5pdC5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gIC8vIERhc2hib2FyZCBBUEkgcGFyYSBvIGZyb250ZW5kOiBHRVQgL2FwaS9kYXNoYm9hcmQvY29zdHMgKHByb3RlZ2lkbylcclxuICBjb25zdCBkYXNoYm9hcmRBcGkgPSBhcGlSb290LmFkZFJlc291cmNlKCdkYXNoYm9hcmQnKTtcclxuICBkYXNoYm9hcmRBcGkuYWRkUmVzb3VyY2UoJ2Nvc3RzJykuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xyXG5cclxuICAvLyBTZXR0aW5ncyBBUEk6IEdFVC9QT1NUIC9hcGkvc2V0dGluZ3MvYXV0b21hdGlvblxyXG4gIGNvbnN0IHNldHRpbmdzQXBpID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnc2V0dGluZ3MnKTtcclxuICBjb25zdCBhdXRvbWF0aW9uQXBpID0gc2V0dGluZ3NBcGkuYWRkUmVzb3VyY2UoJ2F1dG9tYXRpb24nKTtcclxuICBhdXRvbWF0aW9uQXBpLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcclxuICBhdXRvbWF0aW9uQXBpLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gICAgY29uc3QgaW5jaWRlbnRzID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnaW5jaWRlbnRzJyk7XHJcbiAgICBpbmNpZGVudHMuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xyXG4gICAgY29uc3Qgc2xhQ2xhaW1zID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnc2xhLWNsYWltcycpO1xyXG4gICAgc2xhQ2xhaW1zLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcclxuXHJcbiAgICBjb25zdCBpbnZvaWNlc0FwaSA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ2ludm9pY2VzJyk7XHJcbiAgICBpbnZvaWNlc0FwaS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gIC8vIEFsZXJ0cyBBUEk6IEdFVCAvYXBpL2FsZXJ0cyAocHJvdGVnaWRvKVxyXG4gIGNvbnN0IGFsZXJ0c0FwaSA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ2FsZXJ0cycpO1xyXG4gIGFsZXJ0c0FwaS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gICAgY29uc3QgdGVybXNBcGkgPSBhcGlSb290LmFkZFJlc291cmNlKCdhY2NlcHQtdGVybXMnKTtcclxuICAgIHRlcm1zQXBpLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gICAgLy8gRW5kcG9pbnQgZGUgQWRtaW5cclxuICAgIGNvbnN0IGFkbWluQXBpID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnYWRtaW4nKTtcclxuICAgIGNvbnN0IGFkbWluQ2xhaW1zID0gYWRtaW5BcGkuYWRkUmVzb3VyY2UoJ2NsYWltcycpO1xyXG5cclxuICAgIC8vIEdFVCAvYXBpL2FkbWluL2NsYWltc1xyXG4gICAgYWRtaW5DbGFpbXMuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xyXG5cclxuICAgIC8vIFN1Yi1yZWN1cnNvcyBwYXJhIG9wZXJhw6fDtWVzIGVtIGNsYWltcyBlc3BlY8OtZmljYXNcclxuICAgIGNvbnN0IGNsYWltc0J5Q3VzdG9tZXIgPSBhZG1pbkNsYWltcy5hZGRSZXNvdXJjZSgne2N1c3RvbWVySWR9Jyk7XHJcbiAgICBjb25zdCBzcGVjaWZpY0NsYWltID0gY2xhaW1zQnlDdXN0b21lci5hZGRSZXNvdXJjZSgne2NsYWltSWR9Jyk7XHJcblxyXG4gICAgLy8gUFVUIC9hcGkvYWRtaW4vY2xhaW1zL3tjdXN0b21lcklkfS97Y2xhaW1JZH0vc3RhdHVzXHJcbiAgICBzcGVjaWZpY0NsYWltLmFkZFJlc291cmNlKCdzdGF0dXMnKS5hZGRNZXRob2QoJ1BVVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gICAgLy8gUE9TVCAvYXBpL2FkbWluL2NsYWltcy97Y3VzdG9tZXJJZH0ve2NsYWltSWR9L2NyZWF0ZS1pbnZvaWNlXHJcbiAgICBzcGVjaWZpY0NsYWltLmFkZFJlc291cmNlKCdjcmVhdGUtaW52b2ljZScpLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gICAgLy8gT3V0cHV0cyAoTWFudGlkbylcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBUElVcmwnLCB7IHZhbHVlOiBhcGkudXJsIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sSWQnLCB7IHZhbHVlOiB1c2VyUG9vbC51c2VyUG9vbElkIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sQ2xpZW50SWQnLCB7IHZhbHVlOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1RhYmxlTmFtZScsIHsgdmFsdWU6IHRhYmxlLnRhYmxlTmFtZSB9KTtcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTRk5Bcm4nLCB7IHZhbHVlOiBzZm4uc3RhdGVNYWNoaW5lQXJuIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0NmblRlbXBsYXRlVXJsJywge1xyXG4gICAgICB2YWx1ZTogYCR7dGVtcGxhdGVCdWNrZXQuYnVja2V0V2Vic2l0ZVVybH0vdGVtcGxhdGUueWFtbGAsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnVVJMIGRvIHRlbXBsYXRlIGRvIENsb3VkRm9ybWF0aW9uIHBhcmEgbyBvbmJvYXJkaW5nIGRvIGNsaWVudGUuIFVzZSBlc3RhIFVSTCBubyBmcm9udGVuZC4nLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59Il19