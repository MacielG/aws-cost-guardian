"use strict";
// infra/lib/cost-guardian-stack.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.CostGuardianStack = void 0;
const cdk = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const lambda_nodejs = require("aws-cdk-lib/aws-lambda-nodejs");
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
const route53 = require("aws-cdk-lib/aws-route53");
const acm = require("aws-cdk-lib/aws-certificatemanager");
const amplify = require("@aws-cdk/aws-amplify-alpha");
const codebuild = require("aws-cdk-lib/aws-codebuild");
class CostGuardianStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const domainName = props.domainName || 'example.com';
        const hostedZoneId = props.hostedZoneId || 'Z123456789';
        const githubRepo = props.githubRepo || 'user/repo';
        const githubBranch = props.githubBranch || 'main';
        const githubTokenSecretName = props.githubTokenSecretName || 'github-token';
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
        // GSI para Marketplace customer mapping
        table.addGlobalSecondaryIndex({
            indexName: 'MarketplaceCustomerIndex',
            partitionKey: { name: 'marketplaceCustomerId', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.INCLUDE,
            nonKeyAttributes: ['id'],
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
        // Implantação do template TRIAL no bucket S3
        new s3deploy.BucketDeployment(this, 'DeployTrialCfnTemplate', {
            sources: [s3deploy.Source.asset(path.join(__dirname, '../../../docs'))],
            include: ['cost-guardian-TRIAL-template.yaml'],
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
        const apiHandlerLambda = new lambda_nodejs.NodejsFunction(this, 'ApiHandler', {
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
                TRIAL_TEMPLATE_URL: templateBucket.bucketWebsiteUrl + '/cost-guardian-TRIAL-template.yaml',
                FULL_TEMPLATE_URL: templateBucket.bucketWebsiteUrl + '/cost-guardian-template.yaml',
            },
        });
        table.grantReadWriteData(apiHandlerLambda);
        stripeSecret.grantRead(apiHandlerLambda);
        // Grant the API handler permission to read the webhook secret
        stripeWebhookSecret.grantRead(apiHandlerLambda);
        // 2. Lambda para o EventBridge (Correlacionar Eventos Health)
        const healthEventHandlerLambda = new lambda_nodejs.NodejsFunction(this, 'HealthEventHandler', {
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
        const executeRecommendationLambda = new lambda_nodejs.NodejsFunction(this, 'ExecuteRecommendation', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'handler',
            entry: path.join(__dirname, '../../backend/functions/execute-recommendation.js'),
            timeout: cdk.Duration.minutes(5),
            memorySize: 256,
            environment: {
                DYNAMODB_TABLE: table.tableName,
            },
            bundling: {
                format: lambda_nodejs.OutputFormat.ESM,
                minify: true,
            },
        });
        // Permissões para o Lambda de recomendações
        table.grantReadWriteData(executeRecommendationLambda);
        executeRecommendationLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['sts:AssumeRole'],
            resources: ['*'], // O Lambda precisa poder assumir a role do cliente
        }));
        // Dar ao ApiHandler o ARN e o NAME do lambda de execução e permitir invocação
        apiHandlerLambda.addEnvironment('EXECUTE_RECOMMENDATION_LAMBDA_ARN', executeRecommendationLambda.functionArn);
        apiHandlerLambda.addEnvironment('EXECUTE_RECOMMENDATION_LAMBDA_NAME', executeRecommendationLambda.functionName);
        executeRecommendationLambda.grantInvoke(apiHandlerLambda);
        // 3. Lambdas para as Tarefas do Step Functions
        const slaCalculateImpactLambda = new lambda_nodejs.NodejsFunction(this, 'SlaCalculateImpact', {
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
        const slaCheckLambda = new lambda_nodejs.NodejsFunction(this, 'SlaCheck', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, '../../backend/functions/sla-workflow.js'),
            handler: 'checkSLA',
            bundling: { externalModules: ['aws-sdk'] },
            environment: { DYNAMODB_TABLE: table.tableName },
        });
        const slaGenerateReportLambda = new lambda_nodejs.NodejsFunction(this, 'SlaGenerateReport', {
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
        const slaSubmitTicketLambda = new lambda_nodejs.NodejsFunction(this, 'SlaSubmitTicket', {
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
        const costIngestorLambda = new lambda_nodejs.NodejsFunction(this, 'CostIngestor', {
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
        const stopIdleInstancesLambda = new lambda_nodejs.NodejsFunction(this, 'StopIdleInstances', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, '../../backend/functions/recommend-idle-instances.js'),
            handler: 'handler',
            timeout: cdk.Duration.minutes(5),
            bundling: {
                format: lambda_nodejs.OutputFormat.ESM,
                minify: true,
            },
            environment: { DYNAMODB_TABLE: table.tableName },
            role: new iam.Role(this, 'StopIdleRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
                inlinePolicies: {
                    DynamoPolicy: new iam.PolicyDocument({ statements: [
                            new iam.PolicyStatement({ actions: ['dynamodb:Query', 'dynamodb:Scan', 'dynamodb:GetItem', 'dynamodb:PutItem'], resources: [table.tableArn, `${table.tableArn}/index/*`] }),
                            new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: ['arn:aws:iam::*:role/CostGuardianDelegatedRole'] }),
                        ] })
                }
            })
        });
        table.grantReadWriteData(stopIdleInstancesLambda);
        const recommendRdsIdleLambda = new lambda_nodejs.NodejsFunction(this, 'RecommendRdsIdle', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, '../../backend/functions/recommend-rds-idle.js'),
            handler: 'handler',
            timeout: cdk.Duration.minutes(5),
            bundling: { externalModules: ['aws-sdk'] },
            environment: { DYNAMODB_TABLE: table.tableName },
            role: new iam.Role(this, 'RecommendRdsRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
                inlinePolicies: {
                    DynamoPolicy: new iam.PolicyDocument({ statements: [
                            new iam.PolicyStatement({ actions: ['dynamodb:Query', 'dynamodb:Scan', 'dynamodb:GetItem', 'dynamodb:PutItem'], resources: [table.tableArn, `${table.tableArn}/index/*`] }),
                            new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: ['arn:aws:iam::*:role/CostGuardianDelegatedRole'] }),
                            new iam.PolicyStatement({ actions: ['rds:DescribeDBInstances'], resources: ['*'] }),
                            new iam.PolicyStatement({ actions: ['cloudwatch:GetMetricStatistics'], resources: ['*'] }),
                        ] })
                }
            })
        });
        table.grantReadWriteData(recommendRdsIdleLambda);
        const deleteUnusedEbsLambda = new lambda_nodejs.NodejsFunction(this, 'DeleteUnusedEbs', {
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
        const recommendRdsTask = new sfn_tasks.LambdaInvoke(this, 'RecommendIdleRds', { lambdaFunction: recommendRdsIdleLambda, outputPath: '$.Payload' });
        const automationDefinition = new stepfunctions.Parallel(this, 'RunAllAutomations')
            .branch(stopIdleTask)
            .branch(deleteEbsTask)
            .branch(recommendRdsTask);
        const automationSfn = new stepfunctions.StateMachine(this, 'AutomationWorkflow', {
            definitionBody: stepfunctions.DefinitionBody.fromChainable(automationDefinition),
        });
        // 7.4. Regra semanal para disparar a State Machine
        new events.Rule(this, 'WeeklyAutomationRule', {
            schedule: events.Schedule.cron({ weekDay: 'SUN', hour: '3', minute: '0' }),
            targets: [new targets.SfnStateMachine(automationSfn)],
        });
        // Lambda de metering do Marketplace
        const marketplaceMeteringLambda = new lambda_nodejs.NodejsFunction(this, 'MarketplaceMetering', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, '../../backend/functions/marketplace-metering.js'),
            handler: 'handler',
            bundling: { externalModules: ['aws-sdk'] },
            environment: {
                DYNAMODB_TABLE: table.tableName,
                PRODUCT_CODE: 'your-product-code', // Substituir pelo código real do produto
            },
        });
        table.grantReadWriteData(marketplaceMeteringLambda);
        // Regra para executar a cada hora
        new events.Rule(this, 'HourlyMeteringRule', {
            schedule: events.Schedule.rate(cdk.Duration.hours(1)),
            targets: [new targets.LambdaFunction(marketplaceMeteringLambda)],
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
        // Connections API: GET/DELETE /api/connections (protegido)
        const connectionsApi = apiRoot.addResource('connections');
        connectionsApi.addMethod('GET', apiIntegration, { authorizer: auth });
        const connectionItem = connectionsApi.addResource('{awsAccountId}');
        connectionItem.addMethod('DELETE', apiIntegration, { authorizer: auth });
        // Recommendations API: GET/POST /api/recommendations (protegido)
        const recommendationsApi = apiRoot.addResource('recommendations');
        recommendationsApi.addMethod('GET', apiIntegration, { authorizer: auth });
        const executeRec = recommendationsApi.addResource('execute');
        executeRec.addMethod('POST', apiIntegration, { authorizer: auth });
        // SLA Reports API: GET /api/sla-reports/{claimId} (protegido)
        const slaReports = apiRoot.addResource('sla-reports');
        const slaReportItem = slaReports.addResource('{claimId}');
        slaReportItem.addMethod('GET', apiIntegration, { authorizer: auth });
        // Upgrade API: POST /api/upgrade (protegido)
        const upgradeApi = apiRoot.addResource('upgrade');
        upgradeApi.addMethod('POST', apiIntegration, { authorizer: auth });
        // Billing API: GET /api/billing/summary (protegido)
        const billingApi = apiRoot.addResource('billing');
        billingApi.addResource('summary').addMethod('GET', apiIntegration, { authorizer: auth });
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
        // Outputs com referências para Amplify
        const apiUrl = new cdk.CfnOutput(this, 'APIUrl', { value: api.url });
        const userPoolIdOutput = new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
        const userPoolClientIdOutput = new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
        new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
        new cdk.CfnOutput(this, 'SFNArn', { value: sfn.stateMachineArn });
        const cfnTemplateUrlOutput = new cdk.CfnOutput(this, 'CfnTemplateUrl', {
            value: `${templateBucket.bucketWebsiteUrl}/template.yaml`,
            description: 'URL do template do CloudFormation para o onboarding do cliente. Use esta URL no frontend.',
        });
        // Identity Pool para Amplify
        const identityPool = new cognito.CfnIdentityPool(this, 'CostGuardianIdentityPool', {
            allowUnauthenticatedIdentities: false,
            cognitoIdentityProviders: [{
                    clientId: userPoolClient.userPoolClientId,
                    providerName: userPool.userPoolProviderName,
                }],
        });
        const identityPoolIdOutput = new cdk.CfnOutput(this, 'IdentityPoolId', {
            value: identityPool.ref,
            description: 'Cognito Identity Pool ID',
        });
        // --- SEÇÃO DO FRONTEND (AMPLIFY APP AUTOMATIZADO) ---
        const buildSpec = codebuild.BuildSpec.fromObjectToYaml({
            version: '1.0',
            frontend: {
                phases: {
                    preBuild: {
                        commands: [
                            'cd frontend',
                            'npm ci',
                        ],
                    },
                    build: {
                        commands: [
                            `echo "NEXT_PUBLIC_AWS_REGION=${this.region}" >> .env.production`,
                            `echo "NEXT_PUBLIC_API_URL=${api.url}" >> .env.production`,
                            `echo "NEXT_PUBLIC_COGNITO_USER_POOL_ID=${userPool.userPoolId}" >> .env.production`,
                            `echo "NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=${userPoolClient.userPoolClientId}" >> .env.production`,
                            `echo "NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID=${identityPool.ref}" >> .env.production`,
                            `echo "NEXT_PUBLIC_CFN_TEMPLATE_URL=${templateBucket.bucketWebsiteUrl}/template.yaml" >> .env.production`,
                            'npm run build',
                        ],
                    },
                },
                artifacts: {
                    baseDirectory: 'frontend/.next',
                    files: ['**/*'],
                },
                cache: {
                    paths: ['frontend/node_modules/**/*'],
                },
            },
        });
        const amplifyApp = new amplify.App(this, 'CostGuardianFrontend', {
            appName: 'CostGuardianApp',
            sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
                owner: props.githubRepo.split('/')[0],
                repository: props.githubRepo.split('/')[1],
                oauthToken: cdk.SecretValue.secretsManager(props.githubTokenSecretName, {
                    jsonField: 'github-token',
                }),
            }),
            buildSpec: buildSpec,
            environmentVariables: {
                '_LIVE_UPDATES': '[{"pkg":"@aws-amplify/cli","type":"npm","version":"latest"}]',
                'AMPLIFY_NODE_VERSION': '18'
            },
        });
        const mainBranch = amplifyApp.addBranch(props.githubBranch, {
            stage: 'PRODUCTION',
            branchName: props.githubBranch,
        });
        // Domínio customizado
        const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
            hostedZoneId: props.hostedZoneId,
            zoneName: props.domainName,
        });
        const certificate = new acm.Certificate(this, 'SslCertificate', {
            domainName: props.domainName,
            subjectAlternativeNames: [`www.${props.domainName}`],
            validation: acm.CertificateValidation.fromDns(hostedZone),
        });
        const domain = amplifyApp.addDomain(props.domainName, {
            enableAutoSubdomain: true,
            subDomains: [
                {
                    branch: mainBranch,
                    prefix: 'www',
                },
            ],
        });
        domain.mapRoot(mainBranch);
    }
}
exports.CostGuardianStack = CostGuardianStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29zdC1ndWFyZGlhbi1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNvc3QtZ3VhcmRpYW4tc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLG1DQUFtQzs7O0FBRW5DLG1DQUFtQztBQUVuQyxpREFBaUQ7QUFDakQsK0RBQStEO0FBQy9ELDZCQUE2QjtBQUM3QixvREFBb0Q7QUFDcEQscURBQXFEO0FBQ3JELG1EQUFtRDtBQUNuRCx5Q0FBeUM7QUFDekMsMERBQTBEO0FBQzFELGlEQUFpRDtBQUNqRCwwREFBMEQ7QUFDMUQsK0RBQStEO0FBQy9ELGlFQUFpRTtBQUNqRSxpRUFBaUU7QUFDakUsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyxtREFBbUQ7QUFDbkQsMERBQTBEO0FBQzFELHNEQUFzRDtBQUN0RCx1REFBdUQ7QUFVdkQsTUFBYSxpQkFBa0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUM5QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQTZCO1FBQ3JFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQyxVQUFVLElBQUksYUFBYSxDQUFDO1FBQ3JELE1BQU0sWUFBWSxHQUFHLEtBQUssQ0FBQyxZQUFZLElBQUksWUFBWSxDQUFDO1FBQ3hELE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQyxVQUFVLElBQUksV0FBVyxDQUFDO1FBQ25ELE1BQU0sWUFBWSxHQUFHLEtBQUssQ0FBQyxZQUFZLElBQUksTUFBTSxDQUFDO1FBQ2xELE1BQU0scUJBQXFCLEdBQUcsS0FBSyxDQUFDLHFCQUFxQixJQUFJLGNBQWMsQ0FBQztRQUU1RSxvQkFBb0I7UUFDcEIsTUFBTSxZQUFZLEdBQUcsSUFBSSxjQUFjLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDbkUsb0JBQW9CLEVBQUUsRUFBRSxvQkFBb0IsRUFBRSxZQUFZ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QXNCO1FBQ3RCLE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxVQUFVLENBQUMsd0JBQXdCLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUNqRixZQUFZLEVBQUUsS0FBSyxDQUFDLFlBQVk7WUFDaEMsUUFBUSxFQUFFLEtBQUssQ0FBQyxVQUFVO1NBQzNCLENBQUMsQ0FBQztRQUVILE1BQU0sV0FBVyxHQUFHLElBQUksR0FBRyxDQUFDLFdBQVcsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7WUFDOUQsVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVO1lBQzVCLHVCQUF1QixFQUFFLENBQUMsT0FBTyxLQUFLLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDcEQsVUFBVSxFQUFFLEdBQUcsQ0FBQyxxQkFBcUIsQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDO1NBQzFELENBQUMsQ0FBQztRQUVILE1BQU0sTUFBTSxHQUFHLFVBQVUsQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLFVBQVUsRUFBRTtZQUNwRCxtQkFBbUIsRUFBRSxJQUFJO1lBQ3pCLFVBQVUsRUFBRTtnQkFDVjtvQkFDRSxNQUFNLEVBQUUsVUFBVTtvQkFDbEIsTUFBTSxFQUFFLEtBQUs7aUJBQ2Q7YUFDRjtTQUNGLENBQUMsQ0FBQztRQUNILE1BQU0sQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUM7SUFDN0IsQ0FBQztDQUNGO0FBeHRCRCw4Q0F3dEJDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gaW5mcmEvbGliL2Nvc3QtZ3VhcmRpYW4tc3RhY2sudHNcblxuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgbGFtYmRhX25vZGVqcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgYXBpZ3cgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcbmltcG9ydCAqIGFzIGNvZ25pdG8gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZ25pdG8nO1xuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcbmltcG9ydCAqIGFzIHMzZGVwbG95IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMy1kZXBsb3ltZW50JztcbmltcG9ydCAqIGFzIGV2ZW50cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzJztcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcbmltcG9ydCAqIGFzIHN0ZXBmdW5jdGlvbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXN0ZXBmdW5jdGlvbnMnO1xuaW1wb3J0ICogYXMgc2ZuX3Rhc2tzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zdGVwZnVuY3Rpb25zLXRhc2tzJztcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBzbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucyc7XG5pbXBvcnQgKiBhcyByb3V0ZTUzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1yb3V0ZTUzJztcbmltcG9ydCAqIGFzIGFjbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2VydGlmaWNhdGVtYW5hZ2VyJztcbmltcG9ydCAqIGFzIGFtcGxpZnkgZnJvbSAnQGF3cy1jZGsvYXdzLWFtcGxpZnktYWxwaGEnO1xuaW1wb3J0ICogYXMgY29kZWJ1aWxkIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2RlYnVpbGQnO1xuXG5leHBvcnQgaW50ZXJmYWNlIENvc3RHdWFyZGlhblN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIGRvbWFpbk5hbWU/OiBzdHJpbmc7XG4gIGhvc3RlZFpvbmVJZD86IHN0cmluZztcbiAgZ2l0aHViUmVwbz86IHN0cmluZztcbiAgZ2l0aHViQnJhbmNoPzogc3RyaW5nO1xuICBnaXRodWJUb2tlblNlY3JldE5hbWU/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBDb3N0R3VhcmRpYW5TdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBDb3N0R3VhcmRpYW5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCBkb21haW5OYW1lID0gcHJvcHMuZG9tYWluTmFtZSB8fCAnZXhhbXBsZS5jb20nO1xuICAgIGNvbnN0IGhvc3RlZFpvbmVJZCA9IHByb3BzLmhvc3RlZFpvbmVJZCB8fCAnWjEyMzQ1Njc4OSc7XG4gICAgY29uc3QgZ2l0aHViUmVwbyA9IHByb3BzLmdpdGh1YlJlcG8gfHwgJ3VzZXIvcmVwbyc7XG4gICAgY29uc3QgZ2l0aHViQnJhbmNoID0gcHJvcHMuZ2l0aHViQnJhbmNoIHx8ICdtYWluJztcbiAgICBjb25zdCBnaXRodWJUb2tlblNlY3JldE5hbWUgPSBwcm9wcy5naXRodWJUb2tlblNlY3JldE5hbWUgfHwgJ2dpdGh1Yi10b2tlbic7XG5cbiAgICAvLyBTZWNyZXRzIChNYW50aWRvKVxuICAgIGNvbnN0IHN0cmlwZVNlY3JldCA9IG5ldyBzZWNyZXRzbWFuYWdlci5TZWNyZXQodGhpcywgJ1N0cmlwZVNlY3JldCcsIHtcbiAgICAgIGdlbmVyYXRlU2VjcmV0U3RyaW5nOiB7IHNlY3JldFN0cmluZ1RlbXBsYXRlOiAne1wia2V5XCI6XCJcIn0nLCBnZW5lcmF0ZVN0cmluZ0tleTogJ2tleScgfSxcbiAgICB9KTtcblxuICAgIC8vIFdlYmhvb2sgc2VjcmV0IChyYXcgc3RyaW5nKSBzdG9yZWQgaW4gU2VjcmV0cyBNYW5hZ2VyIGZvciBzZWN1cmUgZGVsaXZlcnlcbiAgICBjb25zdCBzdHJpcGVXZWJob29rU2VjcmV0ID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldCh0aGlzLCAnU3RyaXBlV2ViaG9va1NlY3JldCcsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnU3RyaXBlIHdlYmhvb2sgc2lnbmluZyBzZWNyZXQgZm9yIHBsYXRmb3JtIHdlYmhvb2tzJyxcbiAgICAgIGdlbmVyYXRlU2VjcmV0U3RyaW5nOiB7IHNlY3JldFN0cmluZ1RlbXBsYXRlOiAne1wid2ViaG9va1wiOlwiXCJ9JywgZ2VuZXJhdGVTdHJpbmdLZXk6ICd3ZWJob29rJyB9LFxuICAgIH0pO1xuXG4gICAgLy8gRHluYW1vREIgKE1hbnRpZG8sIG1hcyBhZGljaW9uYW5kbyBzdHJlYW0gcGFyYSBlZmljacOqbmNpYSBmdXR1cmEpXG4gICAgY29uc3QgdGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ0Nvc3RHdWFyZGlhblRhYmxlJywge1xuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sIC8vIENoYXZlIHByaW3DoXJpYSBwYXJhIHVzdcOhcmlvcywgY2xhaW1zLCBldGMuXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdzaycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sIC8vIENoYXZlIGRlIGNsYXNzaWZpY2HDp8OjbyBwYXJhIG1vZGVsYWdlbSBmbGV4w612ZWxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgc3RyZWFtOiBkeW5hbW9kYi5TdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVMsIC8vIEhhYmlsaXRhciBzdHJlYW1cbiAgICB9KTtcblxuICAgIC8vIEdTSSBwYXJhIG1hcGVhciBBV1MgQWNjb3VudCBJRCBwYXJhIG5vc3NvIEN1c3RvbWVyIElEIChDUsONVElDTyBwYXJhIGNvcnJlbGHDp8OjbylcbiAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdBd3NBY2NvdW50SW5kZXgnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdhd3NBY2NvdW50SWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLklOQ0xVREUsXG4gICAgICBub25LZXlBdHRyaWJ1dGVzOiBbJ2lkJ10sIC8vIFByb2pldGFyIG8gJ2lkJyAobm9zc28gQ3VzdG9tZXIgSUQpXG4gICAgfSk7XG5cbiAgICAvLyBHU0kgcGFyYSBidXNjYXIgY2xpZW50ZXMgYXRpdm9zIGVmaWNpZW50ZW1lbnRlIChvdGltaXphw6fDo28gZGUgc2NhbiAtPiBxdWVyeSlcbiAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdBY3RpdmVDdXN0b21lckluZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnc2snLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgc29ydEtleTogeyBuYW1lOiAnc3RhdHVzJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5JTkNMVURFLFxuICAgICAgbm9uS2V5QXR0cmlidXRlczogW1xuICAgICAgICAnaWQnLFxuICAgICAgICAncm9sZUFybicsXG4gICAgICAgICdhdXRvbWF0aW9uU2V0dGluZ3MnLFxuICAgICAgICAnc3Vic2NyaXB0aW9uU3RhdHVzJyxcbiAgICAgICAgJ3N1cHBvcnRMZXZlbCcsXG4gICAgICAgICdleGNsdXNpb25UYWdzJ1xuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIEdTSSBwYXJhIG8gY2FsbGJhY2sgZG8gb25ib2FyZGluZyB2aWEgRXh0ZXJuYWxJZFxuICAgIHRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogJ0V4dGVybmFsSWRJbmRleCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2V4dGVybmFsSWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLklOQ0xVREUsXG4gICAgICBub25LZXlBdHRyaWJ1dGVzOiBbJ2lkJywgJ3N0YXR1cyddLFxuICAgIH0pO1xuXG4gICAgLy8gR1NJIHBhcmEgY29uc3VsdGFzIHBvciBzdGF0dXMgKG1lbGhvcmEgcGVyZm9ybWFuY2UgcGFyYSBpbmdlc3RvciBlIGF1dG9tYcOnw7VlcylcbiAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdTdGF0dXNJbmRleCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3N0YXR1cycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuSU5DTFVERSxcbiAgICAgIG5vbktleUF0dHJpYnV0ZXM6IFsnc2snLCAncm9sZUFybicsICdhdXRvbWF0aW9uJ10sXG4gICAgfSk7XG4gICAgXG4gICAgLy8gR1NJIHBhcmEgY29uc3VsdGFyIHBvciBjbGllbnRlIChleDogaW5jaWRlbnRlcywgY2xhaW1zKVxuICAgIHRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogJ0N1c3RvbWVyRGF0YUluZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgc29ydEtleTogeyBuYW1lOiAnc2snLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgIH0pO1xuXG4gICAgLy8gR1NJIHBhcmEgY29uc3VsdGFzIGRlIEFkbWluICh1c2FyIGVudGl0eS9wYXJ0aXRpb24gc2hhcmRpbmcgcGFyYSBwZXJmb3JtYW5jZSlcbiAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdBZG1pblZpZXdJbmRleCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2VudGl0eVR5cGUnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgc29ydEtleTogeyBuYW1lOiAnY3JlYXRlZEF0JywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5JTkNMVURFLFxuICAgICAgbm9uS2V5QXR0cmlidXRlczogWydzdGF0dXMnLCAnY3JlZGl0QW1vdW50JywgJ3JlcG9ydFVybCcsICdpbmNpZGVudElkJywgJ2F3c0FjY291bnRJZCcsICdzdHJpcGVJbnZvaWNlSWQnLCAnY2FzZUlkJywgJ3N1Ym1pc3Npb25FcnJvcicsICdyZXBvcnRFcnJvcicsICdjb21taXNzaW9uQW1vdW50J10sXG4gICAgfSk7XG5cbiAgICAvLyBHU0kgcGFyYSBNYXJrZXRwbGFjZSBjdXN0b21lciBtYXBwaW5nXG4gICAgdGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnTWFya2V0cGxhY2VDdXN0b21lckluZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnbWFya2V0cGxhY2VDdXN0b21lcklkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5JTkNMVURFLFxuICAgICAgbm9uS2V5QXR0cmlidXRlczogWydpZCddLFxuICAgIH0pO1xuXG4gICAgLy8gR1NJIHBhcmEgY29uc3VsdGFzIGRlIHJlY29tZW5kYcOnw7Vlc1xuICAgIHRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogJ1JlY29tbWVuZGF0aW9uc0luZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgc29ydEtleTogeyBuYW1lOiAnc2snLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcbiAgICB9KTtcblxuICAgIC8vIFMzIEJ1Y2tldCBwYXJhIGhvc3BlZGFyIG8gdGVtcGxhdGUgZG8gQ2xvdWRGb3JtYXRpb25cbiAgICBjb25zdCB0ZW1wbGF0ZUJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ0NmblRlbXBsYXRlQnVja2V0Jywge1xuICAgICAgcHVibGljUmVhZEFjY2VzczogdHJ1ZSxcbiAgICAgIHdlYnNpdGVJbmRleERvY3VtZW50OiAndGVtcGxhdGUueWFtbCcsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgYXV0b0RlbGV0ZU9iamVjdHM6IHRydWUsXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogbmV3IHMzLkJsb2NrUHVibGljQWNjZXNzKHtcbiAgICAgICAgYmxvY2tQdWJsaWNBY2xzOiB0cnVlLFxuICAgICAgICBpZ25vcmVQdWJsaWNBY2xzOiB0cnVlLFxuICAgICAgICBibG9ja1B1YmxpY1BvbGljeTogZmFsc2UsIC8vIFBlcm1pdGUgcG9sw610aWNhcyBww7pibGljYXNcbiAgICAgICAgcmVzdHJpY3RQdWJsaWNCdWNrZXRzOiBmYWxzZSxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgLy8gSW1wbGFudGHDp8OjbyBkbyB0ZW1wbGF0ZSBkbyBDbG91ZEZvcm1hdGlvbiBubyBidWNrZXQgUzNcbiAgICAvLyBQdWJsaWNhIGFwZW5hcyBvIGFycXVpdm8gYGNvc3QtZ3VhcmRpYW4tdGVtcGxhdGUueWFtbGAgZSBvIHJlbm9tZWlhIHBhcmEgYHRlbXBsYXRlLnlhbWxgXG4gICAgbmV3IHMzZGVwbG95LkJ1Y2tldERlcGxveW1lbnQodGhpcywgJ0RlcGxveUNmblRlbXBsYXRlJywge1xuICAgICAgc291cmNlczogW3MzZGVwbG95LlNvdXJjZS5hc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vLi4vZG9jcycpKV0sIC8vIEFwb250YSBlc3BlY2lmaWNhbWVudGUgcGFyYSBvIGRpcmV0w7NyaW8gZG9jc1xuICAgICAgLy8gSW5jbHVpIGFwZW5hcyBvIHRlbXBsYXRlIGRlc2VqYWRvXG4gICAgICBpbmNsdWRlOiBbJ2Nvc3QtZ3VhcmRpYW4tdGVtcGxhdGUueWFtbCddLFxuICAgICAgLy8gUmVub21laWEgbyBhcnF1aXZvIG5vIFMzIHBhcmEgYSBVUkwgcMO6YmxpY2EgZXNwZXJhZGFcbiAgICAgIGRlc3RpbmF0aW9uS2V5UHJlZml4OiAnJyxcbiAgICAgIGRlc3RpbmF0aW9uQnVja2V0OiB0ZW1wbGF0ZUJ1Y2tldCxcbiAgICB9KTtcblxuICAgIC8vIEltcGxhbnRhw6fDo28gZG8gdGVtcGxhdGUgVFJJQUwgbm8gYnVja2V0IFMzXG4gICAgbmV3IHMzZGVwbG95LkJ1Y2tldERlcGxveW1lbnQodGhpcywgJ0RlcGxveVRyaWFsQ2ZuVGVtcGxhdGUnLCB7XG4gICAgICBzb3VyY2VzOiBbczNkZXBsb3kuU291cmNlLmFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi8uLi9kb2NzJykpXSxcbiAgICAgIGluY2x1ZGU6IFsnY29zdC1ndWFyZGlhbi1UUklBTC10ZW1wbGF0ZS55YW1sJ10sXG4gICAgICBkZXN0aW5hdGlvbktleVByZWZpeDogJycsXG4gICAgICBkZXN0aW5hdGlvbkJ1Y2tldDogdGVtcGxhdGVCdWNrZXQsXG4gICAgfSk7XG5cblxuICAgIC8vIENvZ25pdG8gKE1hbnRpZG8pXG4gICAgY29uc3QgdXNlclBvb2wgPSBuZXcgY29nbml0by5Vc2VyUG9vbCh0aGlzLCAnQ29zdEd1YXJkaWFuUG9vbCcsIHtcbiAgICAgIHNlbGZTaWduVXBFbmFibGVkOiB0cnVlLFxuICAgICAgc2lnbkluQWxpYXNlczogeyBlbWFpbDogdHJ1ZSB9LFxuICAgICAgYXV0b1ZlcmlmeTogeyBlbWFpbDogdHJ1ZSB9LFxuICAgIH0pO1xuXG4gICAgLy8gQ2xpZW50ZSBkbyBVc2VyIFBvb2wgcGFyYSBhIGFwbGljYcOnw6NvIHdlYlxuICAgIGNvbnN0IHVzZXJQb29sQ2xpZW50ID0gbmV3IGNvZ25pdG8uVXNlclBvb2xDbGllbnQodGhpcywgJ0Nvc3RHdWFyZGlhblVzZXJQb29sQ2xpZW50Jywge1xuICAgICAgdXNlclBvb2wsXG4gICAgICBnZW5lcmF0ZVNlY3JldDogZmFsc2UsIFxuICAgIH0pO1xuXG4gICAgLy8gR3J1cG8gZGUgYWRtaW5pc3RyYWRvcmVzIG5vIENvZ25pdG9cbiAgICBuZXcgY29nbml0by5DZm5Vc2VyUG9vbEdyb3VwKHRoaXMsICdBZG1pbkdyb3VwJywge1xuICAgICAgdXNlclBvb2xJZDogdXNlclBvb2wudXNlclBvb2xJZCxcbiAgICAgIGdyb3VwTmFtZTogJ0FkbWlucycsXG4gICAgICBkZXNjcmlwdGlvbjogJ0dydXBvIHBhcmEgYWRtaW5pc3RyYWRvcmVzIGRhIHBsYXRhZm9ybWEnLFxuICAgIH0pO1xuXG4gICAgLy8gMS4gTGFtYmRhIHBhcmEgbyBBUEkgR2F0ZXdheSAoTW9ub2xpdG8gRXhwcmVzcylcbiAgICAvLyBVc2Ftb3MgTm9kZWpzRnVuY3Rpb24gcGFyYSBlbXBhY290YXIgYXBlbmFzIG8gbmVjZXNzw6FyaW8gY29tIGVzYnVpbGRcbiAgICBjb25zdCBhcGlIYW5kbGVyTGFtYmRhID0gbmV3IGxhbWJkYV9ub2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgJ0FwaUhhbmRsZXInLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vYmFja2VuZC9oYW5kbGVyLmpzJyksXG4gICAgICBoYW5kbGVyOiAnYXBwJywgLy8gZXhwb3J0IGRvIGV4cHJlc3MgKyBzZXJ2ZXJsZXNzIMOpIGV4cG9zdG8gY29tbyAnYXBwJyBubyBoYW5kbGVyLmpzXG4gICAgICBidW5kbGluZzoge1xuICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFsnYXdzLXNkayddLFxuICAgICAgfSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUsXG4gICAgICAgIFNUUklQRV9TRUNSRVRfQVJOOiBzdHJpcGVTZWNyZXQuc2VjcmV0QXJuLFxuICAgICAgICBTVFJJUEVfV0VCSE9PS19TRUNSRVRfQVJOOiBzdHJpcGVXZWJob29rU2VjcmV0LnNlY3JldEFybixcbiAgICAgICAgVVNFUl9QT09MX0lEOiB1c2VyUG9vbC51c2VyUG9vbElkLFxuICAgICAgICBVU0VSX1BPT0xfQ0xJRU5UX0lEOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkLFxuICAgICAgICBQTEFURk9STV9BQ0NPVU5UX0lEOiB0aGlzLmFjY291bnQgfHwgcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfQUNDT1VOVCxcbiAgICAgICAgVFJJQUxfVEVNUExBVEVfVVJMOiB0ZW1wbGF0ZUJ1Y2tldC5idWNrZXRXZWJzaXRlVXJsICsgJy9jb3N0LWd1YXJkaWFuLVRSSUFMLXRlbXBsYXRlLnlhbWwnLFxuICAgICAgICBGVUxMX1RFTVBMQVRFX1VSTDogdGVtcGxhdGVCdWNrZXQuYnVja2V0V2Vic2l0ZVVybCArICcvY29zdC1ndWFyZGlhbi10ZW1wbGF0ZS55YW1sJyxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGFwaUhhbmRsZXJMYW1iZGEpO1xuICAgIHN0cmlwZVNlY3JldC5ncmFudFJlYWQoYXBpSGFuZGxlckxhbWJkYSk7XG4gICAgLy8gR3JhbnQgdGhlIEFQSSBoYW5kbGVyIHBlcm1pc3Npb24gdG8gcmVhZCB0aGUgd2ViaG9vayBzZWNyZXRcbiAgICBzdHJpcGVXZWJob29rU2VjcmV0LmdyYW50UmVhZChhcGlIYW5kbGVyTGFtYmRhKTtcblxuICAgIC8vIDIuIExhbWJkYSBwYXJhIG8gRXZlbnRCcmlkZ2UgKENvcnJlbGFjaW9uYXIgRXZlbnRvcyBIZWFsdGgpXG4gICAgY29uc3QgaGVhbHRoRXZlbnRIYW5kbGVyTGFtYmRhID0gbmV3IGxhbWJkYV9ub2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgJ0hlYWx0aEV2ZW50SGFuZGxlcicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9iYWNrZW5kL2Z1bmN0aW9ucy9jb3JyZWxhdGUtaGVhbHRoLmpzJyksXG4gICAgICBoYW5kbGVyOiAnaGFuZGxlcicsXG4gICAgICBidW5kbGluZzogeyBleHRlcm5hbE1vZHVsZXM6IFsnYXdzLXNkayddIH0sXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lLFxuICAgICAgICBTRk5fQVJOOiAnJywgLy8gU2Vyw6EgcHJlZW5jaGlkbyBhYmFpeG9cbiAgICAgIH0sXG4gICAgfSk7XG4gICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGhlYWx0aEV2ZW50SGFuZGxlckxhbWJkYSk7XG5cbiAgICAvLyBMYW1iZGEgcGFyYSBleGVjdcOnw6NvIGRlIHJlY29tZW5kYcOnw7Vlc1xuICAgIGNvbnN0IGV4ZWN1dGVSZWNvbW1lbmRhdGlvbkxhbWJkYSA9IG5ldyBsYW1iZGFfbm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsICdFeGVjdXRlUmVjb21tZW5kYXRpb24nLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vYmFja2VuZC9mdW5jdGlvbnMvZXhlY3V0ZS1yZWNvbW1lbmRhdGlvbi5qcycpLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lLFxuICAgICAgfSxcbiAgICAgIGJ1bmRsaW5nOiB7XG4gICAgICAgIGZvcm1hdDogbGFtYmRhX25vZGVqcy5PdXRwdXRGb3JtYXQuRVNNLFxuICAgICAgICBtaW5pZnk6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gUGVybWlzc8O1ZXMgcGFyYSBvIExhbWJkYSBkZSByZWNvbWVuZGHDp8O1ZXNcbiAgICB0YWJsZS5ncmFudFJlYWRXcml0ZURhdGEoZXhlY3V0ZVJlY29tbWVuZGF0aW9uTGFtYmRhKTtcbiAgICBleGVjdXRlUmVjb21tZW5kYXRpb25MYW1iZGEuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnc3RzOkFzc3VtZVJvbGUnXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sIC8vIE8gTGFtYmRhIHByZWNpc2EgcG9kZXIgYXNzdW1pciBhIHJvbGUgZG8gY2xpZW50ZVxuICAgIH0pKTtcblxuICAgIC8vIERhciBhbyBBcGlIYW5kbGVyIG8gQVJOIGUgbyBOQU1FIGRvIGxhbWJkYSBkZSBleGVjdcOnw6NvIGUgcGVybWl0aXIgaW52b2Nhw6fDo29cbiAgICBhcGlIYW5kbGVyTGFtYmRhLmFkZEVudmlyb25tZW50KCdFWEVDVVRFX1JFQ09NTUVOREFUSU9OX0xBTUJEQV9BUk4nLCBleGVjdXRlUmVjb21tZW5kYXRpb25MYW1iZGEuZnVuY3Rpb25Bcm4pO1xuICAgIGFwaUhhbmRsZXJMYW1iZGEuYWRkRW52aXJvbm1lbnQoJ0VYRUNVVEVfUkVDT01NRU5EQVRJT05fTEFNQkRBX05BTUUnLCBleGVjdXRlUmVjb21tZW5kYXRpb25MYW1iZGEuZnVuY3Rpb25OYW1lKTtcbiAgICBleGVjdXRlUmVjb21tZW5kYXRpb25MYW1iZGEuZ3JhbnRJbnZva2UoYXBpSGFuZGxlckxhbWJkYSk7XG5cbiAgICAvLyAzLiBMYW1iZGFzIHBhcmEgYXMgVGFyZWZhcyBkbyBTdGVwIEZ1bmN0aW9uc1xuICAgIGNvbnN0IHNsYUNhbGN1bGF0ZUltcGFjdExhbWJkYSA9IG5ldyBsYW1iZGFfbm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsICdTbGFDYWxjdWxhdGVJbXBhY3QnLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vYmFja2VuZC9mdW5jdGlvbnMvc2xhLXdvcmtmbG93LmpzJyksXG4gICAgICBoYW5kbGVyOiAnY2FsY3VsYXRlSW1wYWN0JyxcbiAgICAgIGJ1bmRsaW5nOiB7IGV4dGVybmFsTW9kdWxlczogWydhd3Mtc2RrJ10gfSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUsXG4gICAgICB9LFxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdTbGFDYWxjUm9sZScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpXG4gICAgICAgIF0sXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgICAgQXNzdW1lQ3VzdG9tZXJSb2xlUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgIGFjdGlvbnM6IFsnc3RzOkFzc3VtZVJvbGUnXSxcbiAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbJ2Fybjphd3M6aWFtOjoqOnJvbGUvQ29zdEd1YXJkaWFuRGVsZWdhdGVkUm9sZSddLCBcbiAgICAgICAgICAgIH0pXVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSk7XG4gIC8vIEdhcmFudGlyIHBlcm1pc3PDtWVzIGFvIER5bmFtb0RCIHBhcmEgYSBMYW1iZGEgZGUgY8OhbGN1bG8gZGUgaW1wYWN0b1xuICB0YWJsZS5ncmFudFJlYWRXcml0ZURhdGEoc2xhQ2FsY3VsYXRlSW1wYWN0TGFtYmRhKTtcbiAgICBcbiAgICBjb25zdCBzbGFDaGVja0xhbWJkYSA9IG5ldyBsYW1iZGFfbm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsICdTbGFDaGVjaycsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9iYWNrZW5kL2Z1bmN0aW9ucy9zbGEtd29ya2Zsb3cuanMnKSxcbiAgICAgIGhhbmRsZXI6ICdjaGVja1NMQScsXG4gICAgICBidW5kbGluZzogeyBleHRlcm5hbE1vZHVsZXM6IFsnYXdzLXNkayddIH0sXG4gICAgICBlbnZpcm9ubWVudDogeyBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lIH0sXG4gICAgfSk7XG5cbiAgICBjb25zdCBzbGFHZW5lcmF0ZVJlcG9ydExhbWJkYSA9IG5ldyBsYW1iZGFfbm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsICdTbGFHZW5lcmF0ZVJlcG9ydCcsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9iYWNrZW5kL2Z1bmN0aW9ucy9zbGEtd29ya2Zsb3cuanMnKSxcbiAgICAgIGhhbmRsZXI6ICdnZW5lcmF0ZVJlcG9ydCcsXG4gICAgICBidW5kbGluZzogeyBleHRlcm5hbE1vZHVsZXM6IFsnYXdzLXNkayddIH0sXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lLFxuICAgICAgICBTVFJJUEVfU0VDUkVUX0FSTjogc3RyaXBlU2VjcmV0LnNlY3JldEFybixcbiAgICAgICAgUkVQT1JUU19CVUNLRVRfTkFNRTogJycsIC8vIFNlcsOhIHByZWVuY2hpZG8gYWJhaXhvXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShzbGFHZW5lcmF0ZVJlcG9ydExhbWJkYSk7XG4gICAgc3RyaXBlU2VjcmV0LmdyYW50UmVhZChzbGFHZW5lcmF0ZVJlcG9ydExhbWJkYSk7XG4gIC8vIEdyYW50IHRoZSByZXBvcnQgZ2VuZXJhdG9yIExhbWJkYSBhY2Nlc3MgdG8gdGhlIHdlYmhvb2sgc2VjcmV0IGlmIG5lZWRlZFxuICBzdHJpcGVXZWJob29rU2VjcmV0LmdyYW50UmVhZChzbGFHZW5lcmF0ZVJlcG9ydExhbWJkYSk7XG5cbiAgICAvLyBDcmlhciBidWNrZXQgUzMgcGFyYSBhcm1hemVuYXIgcmVsYXTDs3Jpb3MgUERGIGdlcmFkb3MgcGVsYSBMYW1iZGFcbiAgICBjb25zdCByZXBvcnRzQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnUmVwb3J0c0J1Y2tldCcsIHtcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgfSk7XG5cbiAgICAvLyBGb3JuZWNlciBvIG5vbWUgZG8gYnVja2V0IGNvbW8gdmFyacOhdmVsIGRlIGFtYmllbnRlIHBhcmEgYSBMYW1iZGEgKGF0dWFsaXphKVxuICAgIHNsYUdlbmVyYXRlUmVwb3J0TGFtYmRhLmFkZEVudmlyb25tZW50KCdSRVBPUlRTX0JVQ0tFVF9OQU1FJywgcmVwb3J0c0J1Y2tldC5idWNrZXROYW1lKTtcblxuICAgIC8vIFBlcm1pc3PDtWVzIG5lY2Vzc8OhcmlhcyBwYXJhIGEgTGFtYmRhIGVzY3JldmVyIG9iamV0b3Mgbm8gYnVja2V0XG4gICAgcmVwb3J0c0J1Y2tldC5ncmFudFB1dChzbGFHZW5lcmF0ZVJlcG9ydExhbWJkYSk7XG5cbiAgICBjb25zdCBzbGFTdWJtaXRUaWNrZXRMYW1iZGEgPSBuZXcgbGFtYmRhX25vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCAnU2xhU3VibWl0VGlja2V0Jywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL2JhY2tlbmQvZnVuY3Rpb25zL3NsYS13b3JrZmxvdy5qcycpLFxuICAgICAgaGFuZGxlcjogJ3N1Ym1pdFN1cHBvcnRUaWNrZXQnLFxuICAgICAgYnVuZGxpbmc6IHsgZXh0ZXJuYWxNb2R1bGVzOiBbJ2F3cy1zZGsnXSB9LFxuICAgICAgZW52aXJvbm1lbnQ6IHsgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSB9LFxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdTbGFTdWJtaXRSb2xlJywge1xuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJylcbiAgICAgICAgXSxcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcbiAgICAgICAgICBBc3N1bWVDdXN0b21lclJvbGVQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgICAgc3RhdGVtZW50czogW25ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgYWN0aW9uczogWydzdHM6QXNzdW1lUm9sZSddLFxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnYXJuOmF3czppYW06Oio6cm9sZS9Db3N0R3VhcmRpYW5EZWxlZ2F0ZWRSb2xlJ10sXG4gICAgICAgICAgICB9KV1cbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pO1xuICAgIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShzbGFTdWJtaXRUaWNrZXRMYW1iZGEpO1xuICAgIFxuICAgIC8vIE9idGVyIG8gZXZlbnQgYnVzIHBhZHLDo28gZGEgcGxhdGFmb3JtYVxuICAgIGNvbnN0IGV2ZW50QnVzID0gZXZlbnRzLkV2ZW50QnVzLmZyb21FdmVudEJ1c05hbWUodGhpcywgJ0RlZmF1bHRCdXMnLCAnZGVmYXVsdCcpO1xuXG4gICAgLy8gUG9sw610aWNhIHBhcmEgbyBFdmVudCBCdXM6IHJlc3RyaW5nZSBxdWVtIHBvZGUgY2hhbWFyIFB1dEV2ZW50cy5cbiAgICAvLyBFbSB2ZXogZGUgZGVpeGFyICdQcmluY2lwYWwnIGFiZXJ0bywgZXhpZ2ltb3MgcXVlIG8gcHJpbmNpcGFsIHNlamFcbiAgICAvLyBhIElBTSBSb2xlIHF1ZSBvIGNsaWVudGUgY3JpYSBubyB0ZW1wbGF0ZSAobm9tZTogRXZlbnRCdXNSb2xlKS5cbiAgICAvLyBJc3NvIG1hbnTDqW0gYSBjYXBhY2lkYWRlIGNyb3NzLWFjY291bnQgKGNvbnRhIHZhcmnDoXZlbCkgbWFzIGV2aXRhXG4gICAgLy8gcXVlIGNvbnRhcyBhcmJpdHLDoXJpYXMgZW52aWVtIGV2ZW50b3MgYW8gYmFycmFtZW50by5cbiAgICBuZXcgZXZlbnRzLkNmbkV2ZW50QnVzUG9saWN5KHRoaXMsICdFdmVudEJ1c1BvbGljeScsIHtcbiAgICAgIGV2ZW50QnVzTmFtZTogZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxuICAgICAgc3RhdGVtZW50SWQ6ICdBbGxvd0NsaWVudEhlYWx0aEV2ZW50cycsXG4gICAgICBhY3Rpb246ICdldmVudHM6UHV0RXZlbnRzJyxcbiAgICAgIHByaW5jaXBhbDogJyonLCAvLyBNYW50w6ltIGNyb3NzLWFjY291bnQsIG1hcyBhIGNvbmRpw6fDo28gYWJhaXhvIHJlc3RyaW5nZSBhIHJvbGVcbiAgICAgIGNvbmRpdGlvbjoge1xuICAgICAgICB0eXBlOiAnU3RyaW5nRXF1YWxzJyxcbiAgICAgICAga2V5OiAnYXdzOlByaW5jaXBhbEFybicsXG4gICAgICAgIC8vIEFqdXN0ZSBvIHN1Zml4byBkYSByb2xlIGFxdWkgc2UgYWx0ZXJhciBvIG5vbWUgdXNhZG8gbm8gdGVtcGxhdGUgZG8gY2xpZW50ZVxuICAgICAgICB2YWx1ZTogJ2Fybjphd3M6aWFtOjoqOnJvbGUvRXZlbnRCdXNSb2xlJyxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyAtLS0gSU7DjUNJTyBEQSBDT1JSRcOHw4NPIC0tLVxuICAgIC8vIFJFTU9WQSBlc3RlIGJsb2NvLiBBIGZpbHRyYWdlbSBkZSAnZXZlbnRzOnNvdXJjZScgw6kgZmVpdGFcbiAgICAvLyBwZWxhICdoZWFsdGhSdWxlJyBhYmFpeG8sIG7Do28gcGVsYSBwb2zDrXRpY2EgZG8gYmFycmFtZW50by5cbiAgICAvKlxuICAgIGV2ZW50QnVzUG9saWN5LmFkZFByb3BlcnR5T3ZlcnJpZGUoJ0NvbmRpdGlvbicsIHtcbiAgICAgIFR5cGU6ICdTdHJpbmdFcXVhbHMnLFxuICAgICAgS2V5OiAnZXZlbnRzOnNvdXJjZScsXG4gICAgICBWYWx1ZTogJ2F3cy5oZWFsdGgnLFxuICAgIH0pO1xuICAgICovXG4gICAgLy8gLS0tIEZJTSBEQSBDT1JSRcOHw4NPIC0tLVxuXG4gICAgLy8gRXZlbnRCcmlkZ2UgSGVhbHRoIChFc3RhIMOpIGEgcmVncmEgZGUgRklMVFJBR0VNIGNvcnJldGEpXG4gICAgbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdIZWFsdGhFdmVudFJ1bGUnLCB7XG4gICAgICBldmVudFBhdHRlcm46IHtcbiAgICAgICAgc291cmNlOiBbJ2F3cy5oZWFsdGgnXSwgLy8gQSBmaWx0cmFnZW0gYWNvbnRlY2UgYXF1aVxuICAgICAgICBkZXRhaWxUeXBlOiBbJ0FXUyBIZWFsdGggRXZlbnQnXSxcbiAgICAgIH0sXG4gICAgICBldmVudEJ1cyxcbiAgICAgIHRhcmdldHM6IFtuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihoZWFsdGhFdmVudEhhbmRsZXJMYW1iZGEpXSxcbiAgICB9KTtcblxuICAvLyAtLS0gQmxvY28gMjogSW5nZXN0w6NvIGRpw6FyaWEgZGUgY3VzdG9zIChGYXNlIDE6IFZpc2liaWxpZGFkZSkgLS0tXG4gIC8vIFRvcGljIFNOUyBwYXJhIGFsZXJ0YXMgZGUgYW5vbWFsaWEgKEZhc2UgNylcbiAgY29uc3QgYW5vbWFseUFsZXJ0c1RvcGljID0gbmV3IHNucy5Ub3BpYyh0aGlzLCAnQW5vbWFseUFsZXJ0c1RvcGljJyk7XG4gICAgLy8gNC4xLiBDcmllIHVtIG5vdm8gTGFtYmRhIHBhcmEgaW5nZXN0w6NvIGRpw6FyaWEgZGUgY3VzdG9zXG4gICAgY29uc3QgY29zdEluZ2VzdG9yTGFtYmRhID0gbmV3IGxhbWJkYV9ub2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgJ0Nvc3RJbmdlc3RvcicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9iYWNrZW5kL2Z1bmN0aW9ucy9pbmdlc3QtY29zdHMuanMnKSxcbiAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgYnVuZGxpbmc6IHsgZXh0ZXJuYWxNb2R1bGVzOiBbJ2F3cy1zZGsnXSB9LFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgU05TX1RPUElDX0FSTjogYW5vbWFseUFsZXJ0c1RvcGljLnRvcGljQXJuLFxuICAgICAgfSxcbiAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnQ29zdEluZ2VzdG9yUm9sZScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpXG4gICAgICAgIF0sXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgICAgRHluYW1vQW5kQXNzdW1lUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsnZHluYW1vZGI6U2NhbiddLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW3RhYmxlLnRhYmxlQXJuLCBgJHt0YWJsZS50YWJsZUFybn0vaW5kZXgvKmBdLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsnc3RzOkFzc3VtZVJvbGUnXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnYXJuOmF3czppYW06Oio6cm9sZS9Db3N0R3VhcmRpYW5EZWxlZ2F0ZWRSb2xlJ10sXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgXVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSk7XG4gICAgdGFibGUuZ3JhbnRSZWFkRGF0YShjb3N0SW5nZXN0b3JMYW1iZGEpO1xuXG4gIC8vIFBlcm1pdGlyIHF1ZSBvIGluZ2VzdG9yIHB1YmxpcXVlIGFsZXJ0YXMgbm8gdMOzcGljbyBTTlNcbiAgYW5vbWFseUFsZXJ0c1RvcGljLmdyYW50UHVibGlzaChjb3N0SW5nZXN0b3JMYW1iZGEpO1xuXG4gICAgLy8gNC4yLiBDcmllIHVtYSByZWdyYSBkbyBFdmVudEJyaWRnZSBwYXJhIGFjaW9uYXIgbyBpbmdlc3RvciBkaWFyaWFtZW50ZVxuICAgIG5ldyBldmVudHMuUnVsZSh0aGlzLCAnRGFpbHlDb3N0SW5nZXN0aW9uUnVsZScsIHtcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUuY3Jvbih7IG1pbnV0ZTogJzAnLCBob3VyOiAnNScgfSksIC8vIFRvZG8gZGlhIMOgcyAwNTowMCBVVENcbiAgICAgIHRhcmdldHM6IFtuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihjb3N0SW5nZXN0b3JMYW1iZGEpXSxcbiAgICB9KTtcblxuICAgIC8vIC0tLSBCbG9jbyAzOiBBdXRvbWHDp8OjbyBBdGl2YSAoRmFzZSAyKSAtLS1cbiAgICAvLyA3LjEuIExhbWJkYXMgcGFyYSB0YXJlZmFzIGRlIGF1dG9tYcOnw6NvXG4gICAgY29uc3Qgc3RvcElkbGVJbnN0YW5jZXNMYW1iZGEgPSBuZXcgbGFtYmRhX25vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCAnU3RvcElkbGVJbnN0YW5jZXMnLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vYmFja2VuZC9mdW5jdGlvbnMvcmVjb21tZW5kLWlkbGUtaW5zdGFuY2VzLmpzJyksXG4gICAgICBoYW5kbGVyOiAnaGFuZGxlcicsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIGJ1bmRsaW5nOiB7XG4gICAgICAgIGZvcm1hdDogbGFtYmRhX25vZGVqcy5PdXRwdXRGb3JtYXQuRVNNLFxuICAgICAgICBtaW5pZnk6IHRydWUsXG4gICAgICB9LFxuICAgICAgZW52aXJvbm1lbnQ6IHsgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSB9LFxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdTdG9wSWRsZVJvbGUnLCB7XG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKV0sXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgICAgRHluYW1vUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHsgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoeyBhY3Rpb25zOiBbJ2R5bmFtb2RiOlF1ZXJ5JywnZHluYW1vZGI6U2NhbicsJ2R5bmFtb2RiOkdldEl0ZW0nLCdkeW5hbW9kYjpQdXRJdGVtJ10sIHJlc291cmNlczogW3RhYmxlLnRhYmxlQXJuLCBgJHt0YWJsZS50YWJsZUFybn0vaW5kZXgvKmBdIH0pLFxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoeyBhY3Rpb25zOiBbJ3N0czpBc3N1bWVSb2xlJ10sIHJlc291cmNlczogWydhcm46YXdzOmlhbTo6Kjpyb2xlL0Nvc3RHdWFyZGlhbkRlbGVnYXRlZFJvbGUnXSB9KSxcbiAgICAgICAgICBdfSlcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9KTtcbiAgICB0YWJsZS5ncmFudFJlYWRXcml0ZURhdGEoc3RvcElkbGVJbnN0YW5jZXNMYW1iZGEpO1xuXG4gICAgY29uc3QgcmVjb21tZW5kUmRzSWRsZUxhbWJkYSA9IG5ldyBsYW1iZGFfbm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsICdSZWNvbW1lbmRSZHNJZGxlJywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL2JhY2tlbmQvZnVuY3Rpb25zL3JlY29tbWVuZC1yZHMtaWRsZS5qcycpLFxuICAgICAgaGFuZGxlcjogJ2hhbmRsZXInLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICBidW5kbGluZzogeyBleHRlcm5hbE1vZHVsZXM6IFsnYXdzLXNkayddIH0sXG4gICAgICBlbnZpcm9ubWVudDogeyBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lIH0sXG4gICAgICByb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ1JlY29tbWVuZFJkc1JvbGUnLCB7XG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKV0sXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgICAgRHluYW1vUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHsgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoeyBhY3Rpb25zOiBbJ2R5bmFtb2RiOlF1ZXJ5JywnZHluYW1vZGI6U2NhbicsJ2R5bmFtb2RiOkdldEl0ZW0nLCdkeW5hbW9kYjpQdXRJdGVtJ10sIHJlc291cmNlczogW3RhYmxlLnRhYmxlQXJuLCBgJHt0YWJsZS50YWJsZUFybn0vaW5kZXgvKmBdIH0pLFxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoeyBhY3Rpb25zOiBbJ3N0czpBc3N1bWVSb2xlJ10sIHJlc291cmNlczogWydhcm46YXdzOmlhbTo6Kjpyb2xlL0Nvc3RHdWFyZGlhbkRlbGVnYXRlZFJvbGUnXSB9KSxcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgYWN0aW9uczogWydyZHM6RGVzY3JpYmVEQkluc3RhbmNlcyddLCByZXNvdXJjZXM6IFsnKiddIH0pLFxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoeyBhY3Rpb25zOiBbJ2Nsb3Vkd2F0Y2g6R2V0TWV0cmljU3RhdGlzdGljcyddLCByZXNvdXJjZXM6IFsnKiddIH0pLFxuICAgICAgICAgIF19KVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pO1xuICAgIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShyZWNvbW1lbmRSZHNJZGxlTGFtYmRhKTtcblxuICAgIGNvbnN0IGRlbGV0ZVVudXNlZEVic0xhbWJkYSA9IG5ldyBsYW1iZGFfbm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsICdEZWxldGVVbnVzZWRFYnMnLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vYmFja2VuZC9mdW5jdGlvbnMvZGVsZXRlLXVudXNlZC1lYnMuanMnKSxcbiAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgYnVuZGxpbmc6IHsgZXh0ZXJuYWxNb2R1bGVzOiBbJ2F3cy1zZGsnXSB9LFxuICAgICAgZW52aXJvbm1lbnQ6IHsgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSB9LFxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdEZWxldGVFYnNSb2xlJywge1xuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgICAgbWFuYWdlZFBvbGljaWVzOiBbaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyldLFxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICAgIER5bmFtb1BvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7IHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgYWN0aW9uczogWydkeW5hbW9kYjpRdWVyeScsJ2R5bmFtb2RiOlNjYW4nLCdkeW5hbW9kYjpHZXRJdGVtJ10sIHJlc291cmNlczogW3RhYmxlLnRhYmxlQXJuLCBgJHt0YWJsZS50YWJsZUFybn0vaW5kZXgvKmBdIH0pLFxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoeyBhY3Rpb25zOiBbJ3N0czpBc3N1bWVSb2xlJ10sIHJlc291cmNlczogWydhcm46YXdzOmlhbTo6Kjpyb2xlL0Nvc3RHdWFyZGlhbkRlbGVnYXRlZFJvbGUnXSB9KSxcbiAgICAgICAgICBdfSlcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9KTtcbiAgICB0YWJsZS5ncmFudFJlYWREYXRhKGRlbGV0ZVVudXNlZEVic0xhbWJkYSk7XG5cbiAgICAvLyA3LjIgLSA3LjMgU3RlcCBGdW5jdGlvbiBkZSBhdXRvbWHDp8OjbyAoZXhlY3V0YSB0YXNrcyBlbSBwYXJhbGVsbylcbiAgICBjb25zdCBzdG9wSWRsZVRhc2sgPSBuZXcgc2ZuX3Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnU3RvcElkbGVSZXNvdXJjZXMnLCB7IGxhbWJkYUZ1bmN0aW9uOiBzdG9wSWRsZUluc3RhbmNlc0xhbWJkYSwgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCcgfSk7XG4gICAgY29uc3QgZGVsZXRlRWJzVGFzayA9IG5ldyBzZm5fdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdEZWxldGVVbnVzZWRWb2x1bWVzJywgeyBsYW1iZGFGdW5jdGlvbjogZGVsZXRlVW51c2VkRWJzTGFtYmRhLCBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyB9KTtcbiAgICBjb25zdCByZWNvbW1lbmRSZHNUYXNrID0gbmV3IHNmbl90YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ1JlY29tbWVuZElkbGVSZHMnLCB7IGxhbWJkYUZ1bmN0aW9uOiByZWNvbW1lbmRSZHNJZGxlTGFtYmRhLCBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyB9KTtcblxuICAgIGNvbnN0IGF1dG9tYXRpb25EZWZpbml0aW9uID0gbmV3IHN0ZXBmdW5jdGlvbnMuUGFyYWxsZWwodGhpcywgJ1J1bkFsbEF1dG9tYXRpb25zJylcbiAgICAgIC5icmFuY2goc3RvcElkbGVUYXNrKVxuICAgICAgLmJyYW5jaChkZWxldGVFYnNUYXNrKVxuICAgICAgLmJyYW5jaChyZWNvbW1lbmRSZHNUYXNrKTtcblxuICAgIGNvbnN0IGF1dG9tYXRpb25TZm4gPSBuZXcgc3RlcGZ1bmN0aW9ucy5TdGF0ZU1hY2hpbmUodGhpcywgJ0F1dG9tYXRpb25Xb3JrZmxvdycsIHtcbiAgICAgIGRlZmluaXRpb25Cb2R5OiBzdGVwZnVuY3Rpb25zLkRlZmluaXRpb25Cb2R5LmZyb21DaGFpbmFibGUoYXV0b21hdGlvbkRlZmluaXRpb24pLFxuICAgIH0pO1xuXG4gICAgLy8gNy40LiBSZWdyYSBzZW1hbmFsIHBhcmEgZGlzcGFyYXIgYSBTdGF0ZSBNYWNoaW5lXG4gICAgbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdXZWVrbHlBdXRvbWF0aW9uUnVsZScsIHtcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUuY3Jvbih7IHdlZWtEYXk6ICdTVU4nLCBob3VyOiAnMycsIG1pbnV0ZTogJzAnIH0pLCAvLyBEb21pbmdvIDAzOjAwIFVUQ1xuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLlNmblN0YXRlTWFjaGluZShhdXRvbWF0aW9uU2ZuKV0sXG4gICAgfSk7XG5cbiAgICAvLyBMYW1iZGEgZGUgbWV0ZXJpbmcgZG8gTWFya2V0cGxhY2VcbiAgICBjb25zdCBtYXJrZXRwbGFjZU1ldGVyaW5nTGFtYmRhID0gbmV3IGxhbWJkYV9ub2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgJ01hcmtldHBsYWNlTWV0ZXJpbmcnLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vYmFja2VuZC9mdW5jdGlvbnMvbWFya2V0cGxhY2UtbWV0ZXJpbmcuanMnKSxcbiAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcbiAgICAgIGJ1bmRsaW5nOiB7IGV4dGVybmFsTW9kdWxlczogWydhd3Mtc2RrJ10gfSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUsXG4gICAgICAgIFBST0RVQ1RfQ09ERTogJ3lvdXItcHJvZHVjdC1jb2RlJywgLy8gU3Vic3RpdHVpciBwZWxvIGPDs2RpZ28gcmVhbCBkbyBwcm9kdXRvXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShtYXJrZXRwbGFjZU1ldGVyaW5nTGFtYmRhKTtcblxuICAgIC8vIFJlZ3JhIHBhcmEgZXhlY3V0YXIgYSBjYWRhIGhvcmFcbiAgICBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ0hvdXJseU1ldGVyaW5nUnVsZScsIHtcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUucmF0ZShjZGsuRHVyYXRpb24uaG91cnMoMSkpLFxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKG1hcmtldHBsYWNlTWV0ZXJpbmdMYW1iZGEpXSxcbiAgICB9KTtcblxuICAgIC8vIFN0ZXAgRnVuY3Rpb25zIFNMQSAoVXNhbmRvIG9zIExhbWJkYXMgY29ycmV0b3MpXG4gICAgY29uc3QgY2FsY3VsYXRlSW1wYWN0VGFzayA9IG5ldyBzZm5fdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdDYWxjdWxhdGVJbXBhY3QnLCB7IGxhbWJkYUZ1bmN0aW9uOiBzbGFDYWxjdWxhdGVJbXBhY3RMYW1iZGEsIG91dHB1dFBhdGg6ICckLlBheWxvYWQnIH0pO1xuICAgIGNvbnN0IGNoZWNrU2xhVGFzayA9IG5ldyBzZm5fdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdDaGVja1NMQScsIHsgbGFtYmRhRnVuY3Rpb246IHNsYUNoZWNrTGFtYmRhLCBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyB9KTtcbiAgICBjb25zdCBnZW5lcmF0ZVJlcG9ydFRhc2sgPSBuZXcgc2ZuX3Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnR2VuZXJhdGVSZXBvcnQnLCB7IGxhbWJkYUZ1bmN0aW9uOiBzbGFHZW5lcmF0ZVJlcG9ydExhbWJkYSwgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCcgfSk7XG4gICAgY29uc3Qgc3VibWl0VGlja2V0VGFzayA9IG5ldyBzZm5fdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdTdWJtaXRUaWNrZXQnLCB7IGxhbWJkYUZ1bmN0aW9uOiBzbGFTdWJtaXRUaWNrZXRMYW1iZGEsIG91dHB1dFBhdGg6ICckLlBheWxvYWQnIH0pO1xuICAgIGNvbnN0IG5vQ2xhaW0gPSBuZXcgc3RlcGZ1bmN0aW9ucy5TdWNjZWVkKHRoaXMsICdOb0NsYWltR2VuZXJhdGVkJyk7XG5cbiAgICBjb25zdCBjbGFpbUNob2ljZSA9IG5ldyBzdGVwZnVuY3Rpb25zLkNob2ljZSh0aGlzLCAnSXNDbGFpbUdlbmVyYXRlZD8nKVxuICAgICAgLndoZW4oc3RlcGZ1bmN0aW9ucy5Db25kaXRpb24uc3RyaW5nRXF1YWxzKCckLnN0YXR1cycsICdnZW5lcmF0ZWQnKSwgc3VibWl0VGlja2V0VGFzaylcbiAgICAgIC5vdGhlcndpc2Uobm9DbGFpbSk7XG5cbiAgICBjb25zdCBzbGFEZWZpbml0aW9uID0gY2FsY3VsYXRlSW1wYWN0VGFza1xuICAgICAgLm5leHQoY2hlY2tTbGFUYXNrKVxuICAgICAgLm5leHQoZ2VuZXJhdGVSZXBvcnRUYXNrKVxuICAgICAgLm5leHQoY2xhaW1DaG9pY2UpO1xuXG4gICAgY29uc3Qgc2ZuID0gbmV3IHN0ZXBmdW5jdGlvbnMuU3RhdGVNYWNoaW5lKHRoaXMsICdTTEFXb3JrZmxvdycsIHtcbiAgICAgIGRlZmluaXRpb25Cb2R5OiBzdGVwZnVuY3Rpb25zLkRlZmluaXRpb25Cb2R5LmZyb21DaGFpbmFibGUoc2xhRGVmaW5pdGlvbiksXG4gICAgfSk7XG5cbiAgICAvLyBBZGljaW9uYXIgbyBBUk4gZG8gU0ZOIGFvIExhbWJkYSBkZSBjb3JyZWxhw6fDo29cbiAgICBoZWFsdGhFdmVudEhhbmRsZXJMYW1iZGEuYWRkRW52aXJvbm1lbnQoJ1NGTl9BUk4nLCBzZm4uc3RhdGVNYWNoaW5lQXJuKTtcbiAgICAvLyBQZXJtaXNzw6NvIHBhcmEgbyBMYW1iZGEgaW5pY2lhciBhIFN0YXRlIE1hY2hpbmVcbiAgICBzZm4uZ3JhbnRTdGFydEV4ZWN1dGlvbihoZWFsdGhFdmVudEhhbmRsZXJMYW1iZGEpO1xuXG4gICAgLy8gQVBJIEdhdGV3YXkgKFVzYW5kbyBvICdhcGlIYW5kbGVyTGFtYmRhJyBjb3JyZXRvKVxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcGlndy5SZXN0QXBpKHRoaXMsICdDb3N0R3VhcmRpYW5BUEknLCB7XG4gICAgICByZXN0QXBpTmFtZTogJ0Nvc3QgR3VhcmRpYW4gQVBJJyxcbiAgICAgIGRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9uczogeyBhbGxvd09yaWdpbnM6IGFwaWd3LkNvcnMuQUxMX09SSUdJTlMgfSxcbiAgICB9KTtcbiAgICBjb25zdCBhdXRoID0gbmV3IGFwaWd3LkNvZ25pdG9Vc2VyUG9vbHNBdXRob3JpemVyKHRoaXMsICdDb2duaXRvQXV0aCcsIHtcbiAgICAgIGNvZ25pdG9Vc2VyUG9vbHM6IFt1c2VyUG9vbF0sXG4gICAgfSk7XG5cbiAgICBjb25zdCBhcGlJbnRlZ3JhdGlvbiA9IG5ldyBhcGlndy5MYW1iZGFJbnRlZ3JhdGlvbihhcGlIYW5kbGVyTGFtYmRhKTtcblxuICAgIC8vIEV4cG9yIHRvZGFzIGFzIHJvdGFzIHNvYiAvYXBpIHBhcmEgY29pbmNpZGlyIGNvbSBhcyByb3RhcyBFeHByZXNzIGRvIGJhY2tlbmQgKC9hcGkvKilcbiAgICBjb25zdCBhcGlSb290ID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2FwaScpO1xuXG4gIC8vIEhlYWx0aCBww7pibGljbzogR0VUIC9hcGkvaGVhbHRoIC0+IHNlbSBhdXRob3JpemVyXG4gIGNvbnN0IGhlYWx0aCA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ2hlYWx0aCcpO1xuICBoZWFsdGguYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbik7IC8vIHB1YmxpYyBoZWFsdGggY2hlY2tcblxuICAgIC8vIFJlc291cmNlcyBBUEkgKGFnb3JhIHNvYiAvYXBpKVxuICAgIGNvbnN0IG9uYm9hcmQgPSBhcGlSb290LmFkZFJlc291cmNlKCdvbmJvYXJkJyk7XG4gICAgb25ib2FyZC5hZGRNZXRob2QoJ1BPU1QnLCBhcGlJbnRlZ3JhdGlvbik7IC8vIFdlYmhvb2ssIHNlbSBhdXRoXG5cbiAgLy8gU3RyaXBlIHdlYmhvb2sgKHB1YmxpYyBlbmRwb2ludCwgc2VtIGF1dGhvcml6ZXIpXG4gIGNvbnN0IHN0cmlwZUFwaSA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ3N0cmlwZScpO1xuICBzdHJpcGVBcGkuYWRkUmVzb3VyY2UoJ3dlYmhvb2snKS5hZGRNZXRob2QoJ1BPU1QnLCBhcGlJbnRlZ3JhdGlvbik7XG5cbiAgICAvLyBOb3ZvIGVuZHBvaW50IHBhcmEgZ2VyYXIgY29uZmlnIGRlIG9uYm9hcmRpbmdcbiAgICBjb25zdCBvbmJvYXJkSW5pdCA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ29uYm9hcmQtaW5pdCcpO1xuICAgIG9uYm9hcmRJbml0LmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcblxuICAvLyBEYXNoYm9hcmQgQVBJIHBhcmEgbyBmcm9udGVuZDogR0VUIC9hcGkvZGFzaGJvYXJkL2Nvc3RzIChwcm90ZWdpZG8pXG4gIGNvbnN0IGRhc2hib2FyZEFwaSA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ2Rhc2hib2FyZCcpO1xuICBkYXNoYm9hcmRBcGkuYWRkUmVzb3VyY2UoJ2Nvc3RzJykuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xuXG4gIC8vIFNldHRpbmdzIEFQSTogR0VUL1BPU1QgL2FwaS9zZXR0aW5ncy9hdXRvbWF0aW9uXG4gIGNvbnN0IHNldHRpbmdzQXBpID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnc2V0dGluZ3MnKTtcbiAgY29uc3QgYXV0b21hdGlvbkFwaSA9IHNldHRpbmdzQXBpLmFkZFJlc291cmNlKCdhdXRvbWF0aW9uJyk7XG4gIGF1dG9tYXRpb25BcGkuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xuICBhdXRvbWF0aW9uQXBpLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG5cbiAgICBjb25zdCBpbmNpZGVudHMgPSBhcGlSb290LmFkZFJlc291cmNlKCdpbmNpZGVudHMnKTtcbiAgICBpbmNpZGVudHMuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xuICAgIGNvbnN0IHNsYUNsYWltcyA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ3NsYS1jbGFpbXMnKTtcbiAgICBzbGFDbGFpbXMuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xuXG4gICAgY29uc3QgaW52b2ljZXNBcGkgPSBhcGlSb290LmFkZFJlc291cmNlKCdpbnZvaWNlcycpO1xuICAgIGludm9pY2VzQXBpLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcblxuICAvLyBBbGVydHMgQVBJOiBHRVQgL2FwaS9hbGVydHMgKHByb3RlZ2lkbylcbiAgY29uc3QgYWxlcnRzQXBpID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnYWxlcnRzJyk7XG4gIGFsZXJ0c0FwaS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG5cbiAgLy8gQ29ubmVjdGlvbnMgQVBJOiBHRVQvREVMRVRFIC9hcGkvY29ubmVjdGlvbnMgKHByb3RlZ2lkbylcbiAgY29uc3QgY29ubmVjdGlvbnNBcGkgPSBhcGlSb290LmFkZFJlc291cmNlKCdjb25uZWN0aW9ucycpO1xuICBjb25uZWN0aW9uc0FwaS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG4gIGNvbnN0IGNvbm5lY3Rpb25JdGVtID0gY29ubmVjdGlvbnNBcGkuYWRkUmVzb3VyY2UoJ3thd3NBY2NvdW50SWR9Jyk7XG4gIGNvbm5lY3Rpb25JdGVtLmFkZE1ldGhvZCgnREVMRVRFJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcblxuICAvLyBSZWNvbW1lbmRhdGlvbnMgQVBJOiBHRVQvUE9TVCAvYXBpL3JlY29tbWVuZGF0aW9ucyAocHJvdGVnaWRvKVxuICBjb25zdCByZWNvbW1lbmRhdGlvbnNBcGkgPSBhcGlSb290LmFkZFJlc291cmNlKCdyZWNvbW1lbmRhdGlvbnMnKTtcbiAgcmVjb21tZW5kYXRpb25zQXBpLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcbiAgY29uc3QgZXhlY3V0ZVJlYyA9IHJlY29tbWVuZGF0aW9uc0FwaS5hZGRSZXNvdXJjZSgnZXhlY3V0ZScpO1xuICBleGVjdXRlUmVjLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG5cbiAgLy8gU0xBIFJlcG9ydHMgQVBJOiBHRVQgL2FwaS9zbGEtcmVwb3J0cy97Y2xhaW1JZH0gKHByb3RlZ2lkbylcbiAgY29uc3Qgc2xhUmVwb3J0cyA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ3NsYS1yZXBvcnRzJyk7XG4gIGNvbnN0IHNsYVJlcG9ydEl0ZW0gPSBzbGFSZXBvcnRzLmFkZFJlc291cmNlKCd7Y2xhaW1JZH0nKTtcbiAgc2xhUmVwb3J0SXRlbS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG5cbiAgLy8gVXBncmFkZSBBUEk6IFBPU1QgL2FwaS91cGdyYWRlIChwcm90ZWdpZG8pXG4gIGNvbnN0IHVwZ3JhZGVBcGkgPSBhcGlSb290LmFkZFJlc291cmNlKCd1cGdyYWRlJyk7XG4gIHVwZ3JhZGVBcGkuYWRkTWV0aG9kKCdQT1NUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcblxuICAvLyBCaWxsaW5nIEFQSTogR0VUIC9hcGkvYmlsbGluZy9zdW1tYXJ5IChwcm90ZWdpZG8pXG4gIGNvbnN0IGJpbGxpbmdBcGkgPSBhcGlSb290LmFkZFJlc291cmNlKCdiaWxsaW5nJyk7XG4gIGJpbGxpbmdBcGkuYWRkUmVzb3VyY2UoJ3N1bW1hcnknKS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG5cbiAgICBjb25zdCB0ZXJtc0FwaSA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ2FjY2VwdC10ZXJtcycpO1xuICAgIHRlcm1zQXBpLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG5cbiAgICAvLyBFbmRwb2ludCBkZSBBZG1pblxuICAgIGNvbnN0IGFkbWluQXBpID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnYWRtaW4nKTtcbiAgICBjb25zdCBhZG1pbkNsYWltcyA9IGFkbWluQXBpLmFkZFJlc291cmNlKCdjbGFpbXMnKTtcblxuICAgIC8vIEdFVCAvYXBpL2FkbWluL2NsYWltc1xuICAgIGFkbWluQ2xhaW1zLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcblxuICAgIC8vIFN1Yi1yZWN1cnNvcyBwYXJhIG9wZXJhw6fDtWVzIGVtIGNsYWltcyBlc3BlY8OtZmljYXNcbiAgICBjb25zdCBjbGFpbXNCeUN1c3RvbWVyID0gYWRtaW5DbGFpbXMuYWRkUmVzb3VyY2UoJ3tjdXN0b21lcklkfScpO1xuICAgIGNvbnN0IHNwZWNpZmljQ2xhaW0gPSBjbGFpbXNCeUN1c3RvbWVyLmFkZFJlc291cmNlKCd7Y2xhaW1JZH0nKTtcblxuICAgIC8vIFBVVCAvYXBpL2FkbWluL2NsYWltcy97Y3VzdG9tZXJJZH0ve2NsYWltSWR9L3N0YXR1c1xuICAgIHNwZWNpZmljQ2xhaW0uYWRkUmVzb3VyY2UoJ3N0YXR1cycpLmFkZE1ldGhvZCgnUFVUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcblxuICAgIC8vIFBPU1QgL2FwaS9hZG1pbi9jbGFpbXMve2N1c3RvbWVySWR9L3tjbGFpbUlkfS9jcmVhdGUtaW52b2ljZVxuICAgIHNwZWNpZmljQ2xhaW0uYWRkUmVzb3VyY2UoJ2NyZWF0ZS1pbnZvaWNlJykuYWRkTWV0aG9kKCdQT1NUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcblxuICAgIC8vIE91dHB1dHMgY29tIHJlZmVyw6puY2lhcyBwYXJhIEFtcGxpZnlcbiAgICBjb25zdCBhcGlVcmwgPSBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQVBJVXJsJywgeyB2YWx1ZTogYXBpLnVybCB9KTtcbiAgICBjb25zdCB1c2VyUG9vbElkT3V0cHV0ID0gbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sSWQnLCB7IHZhbHVlOiB1c2VyUG9vbC51c2VyUG9vbElkIH0pO1xuICAgIGNvbnN0IHVzZXJQb29sQ2xpZW50SWRPdXRwdXQgPSBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xDbGllbnRJZCcsIHsgdmFsdWU6IHVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQgfSk7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1RhYmxlTmFtZScsIHsgdmFsdWU6IHRhYmxlLnRhYmxlTmFtZSB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU0ZOQXJuJywgeyB2YWx1ZTogc2ZuLnN0YXRlTWFjaGluZUFybiB9KTtcbiAgICBjb25zdCBjZm5UZW1wbGF0ZVVybE91dHB1dCA9IG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDZm5UZW1wbGF0ZVVybCcsIHtcbiAgICAgIHZhbHVlOiBgJHt0ZW1wbGF0ZUJ1Y2tldC5idWNrZXRXZWJzaXRlVXJsfS90ZW1wbGF0ZS55YW1sYCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnVVJMIGRvIHRlbXBsYXRlIGRvIENsb3VkRm9ybWF0aW9uIHBhcmEgbyBvbmJvYXJkaW5nIGRvIGNsaWVudGUuIFVzZSBlc3RhIFVSTCBubyBmcm9udGVuZC4nLFxuICAgIH0pO1xuXG4gICAgLy8gSWRlbnRpdHkgUG9vbCBwYXJhIEFtcGxpZnlcbiAgICBjb25zdCBpZGVudGl0eVBvb2wgPSBuZXcgY29nbml0by5DZm5JZGVudGl0eVBvb2wodGhpcywgJ0Nvc3RHdWFyZGlhbklkZW50aXR5UG9vbCcsIHtcbiAgICAgIGFsbG93VW5hdXRoZW50aWNhdGVkSWRlbnRpdGllczogZmFsc2UsXG4gICAgICBjb2duaXRvSWRlbnRpdHlQcm92aWRlcnM6IFt7XG4gICAgICAgIGNsaWVudElkOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkLFxuICAgICAgICBwcm92aWRlck5hbWU6IHVzZXJQb29sLnVzZXJQb29sUHJvdmlkZXJOYW1lLFxuICAgICAgfV0sXG4gICAgfSk7XG4gICAgY29uc3QgaWRlbnRpdHlQb29sSWRPdXRwdXQgPSBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnSWRlbnRpdHlQb29sSWQnLCB7XG4gICAgICB2YWx1ZTogaWRlbnRpdHlQb29sLnJlZixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBJZGVudGl0eSBQb29sIElEJyxcbiAgICB9KTtcblxuICAgIC8vIC0tLSBTRcOHw4NPIERPIEZST05URU5EIChBTVBMSUZZIEFQUCBBVVRPTUFUSVpBRE8pIC0tLVxuICAgIGNvbnN0IGJ1aWxkU3BlYyA9IGNvZGVidWlsZC5CdWlsZFNwZWMuZnJvbU9iamVjdFRvWWFtbCh7XG4gICAgICB2ZXJzaW9uOiAnMS4wJyxcbiAgICAgIGZyb250ZW5kOiB7XG4gICAgICAgIHBoYXNlczoge1xuICAgICAgICAgIHByZUJ1aWxkOiB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAnY2QgZnJvbnRlbmQnLFxuICAgICAgICAgICAgICAnbnBtIGNpJyxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBidWlsZDoge1xuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgYGVjaG8gXCJORVhUX1BVQkxJQ19BV1NfUkVHSU9OPSR7dGhpcy5yZWdpb259XCIgPj4gLmVudi5wcm9kdWN0aW9uYCxcbiAgICAgICAgICAgICAgYGVjaG8gXCJORVhUX1BVQkxJQ19BUElfVVJMPSR7YXBpLnVybH1cIiA+PiAuZW52LnByb2R1Y3Rpb25gLFxuICAgICAgICAgICAgICBgZWNobyBcIk5FWFRfUFVCTElDX0NPR05JVE9fVVNFUl9QT09MX0lEPSR7dXNlclBvb2wudXNlclBvb2xJZH1cIiA+PiAuZW52LnByb2R1Y3Rpb25gLFxuICAgICAgICAgICAgICBgZWNobyBcIk5FWFRfUFVCTElDX0NPR05JVE9fVVNFUl9QT09MX0NMSUVOVF9JRD0ke3VzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWR9XCIgPj4gLmVudi5wcm9kdWN0aW9uYCxcbiAgICAgICAgICAgICAgYGVjaG8gXCJORVhUX1BVQkxJQ19DT0dOSVRPX0lERU5USVRZX1BPT0xfSUQ9JHtpZGVudGl0eVBvb2wucmVmfVwiID4+IC5lbnYucHJvZHVjdGlvbmAsXG4gICAgICAgICAgICAgIGBlY2hvIFwiTkVYVF9QVUJMSUNfQ0ZOX1RFTVBMQVRFX1VSTD0ke3RlbXBsYXRlQnVja2V0LmJ1Y2tldFdlYnNpdGVVcmx9L3RlbXBsYXRlLnlhbWxcIiA+PiAuZW52LnByb2R1Y3Rpb25gLFxuICAgICAgICAgICAgICAnbnBtIHJ1biBidWlsZCcsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGFydGlmYWN0czoge1xuICAgICAgICAgIGJhc2VEaXJlY3Rvcnk6ICdmcm9udGVuZC8ubmV4dCcsXG4gICAgICAgICAgZmlsZXM6IFsnKiovKiddLFxuICAgICAgICB9LFxuICAgICAgICBjYWNoZToge1xuICAgICAgICAgIHBhdGhzOiBbJ2Zyb250ZW5kL25vZGVfbW9kdWxlcy8qKi8qJ10sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgY29uc3QgYW1wbGlmeUFwcCA9IG5ldyBhbXBsaWZ5LkFwcCh0aGlzLCAnQ29zdEd1YXJkaWFuRnJvbnRlbmQnLCB7XG4gICAgICBhcHBOYW1lOiAnQ29zdEd1YXJkaWFuQXBwJyxcbiAgICAgIHNvdXJjZUNvZGVQcm92aWRlcjogbmV3IGFtcGxpZnkuR2l0SHViU291cmNlQ29kZVByb3ZpZGVyKHtcbiAgICAgICAgb3duZXI6IHByb3BzLmdpdGh1YlJlcG8uc3BsaXQoJy8nKVswXSxcbiAgICAgICAgcmVwb3NpdG9yeTogcHJvcHMuZ2l0aHViUmVwby5zcGxpdCgnLycpWzFdLFxuICAgICAgICBvYXV0aFRva2VuOiBjZGsuU2VjcmV0VmFsdWUuc2VjcmV0c01hbmFnZXIocHJvcHMuZ2l0aHViVG9rZW5TZWNyZXROYW1lLCB7XG4gICAgICAgICAganNvbkZpZWxkOiAnZ2l0aHViLXRva2VuJyxcbiAgICAgICAgfSksXG4gICAgICB9KSxcbiAgICAgIGJ1aWxkU3BlYzogYnVpbGRTcGVjLFxuICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAgICAgICAgJ19MSVZFX1VQREFURVMnOiAnW3tcInBrZ1wiOlwiQGF3cy1hbXBsaWZ5L2NsaVwiLFwidHlwZVwiOlwibnBtXCIsXCJ2ZXJzaW9uXCI6XCJsYXRlc3RcIn1dJyxcbiAgICAgICAgJ0FNUExJRllfTk9ERV9WRVJTSU9OJzogJzE4J1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IG1haW5CcmFuY2ggPSBhbXBsaWZ5QXBwLmFkZEJyYW5jaChwcm9wcy5naXRodWJCcmFuY2gsIHtcbiAgICAgIHN0YWdlOiAnUFJPRFVDVElPTicsXG4gICAgICBicmFuY2hOYW1lOiBwcm9wcy5naXRodWJCcmFuY2gsXG4gICAgfSk7XG5cbiAgICAvLyBEb23DrW5pbyBjdXN0b21pemFkb1xuICAgIGNvbnN0IGhvc3RlZFpvbmUgPSByb3V0ZTUzLkhvc3RlZFpvbmUuZnJvbUhvc3RlZFpvbmVBdHRyaWJ1dGVzKHRoaXMsICdIb3N0ZWRab25lJywge1xuICAgICAgaG9zdGVkWm9uZUlkOiBwcm9wcy5ob3N0ZWRab25lSWQsXG4gICAgICB6b25lTmFtZTogcHJvcHMuZG9tYWluTmFtZSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGNlcnRpZmljYXRlID0gbmV3IGFjbS5DZXJ0aWZpY2F0ZSh0aGlzLCAnU3NsQ2VydGlmaWNhdGUnLCB7XG4gICAgICBkb21haW5OYW1lOiBwcm9wcy5kb21haW5OYW1lLFxuICAgICAgc3ViamVjdEFsdGVybmF0aXZlTmFtZXM6IFtgd3d3LiR7cHJvcHMuZG9tYWluTmFtZX1gXSxcbiAgICAgIHZhbGlkYXRpb246IGFjbS5DZXJ0aWZpY2F0ZVZhbGlkYXRpb24uZnJvbURucyhob3N0ZWRab25lKSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGRvbWFpbiA9IGFtcGxpZnlBcHAuYWRkRG9tYWluKHByb3BzLmRvbWFpbk5hbWUsIHtcbiAgICAgIGVuYWJsZUF1dG9TdWJkb21haW46IHRydWUsXG4gICAgICBzdWJEb21haW5zOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBicmFuY2g6IG1haW5CcmFuY2gsXG4gICAgICAgICAgcHJlZml4OiAnd3d3JyxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG4gICAgZG9tYWluLm1hcFJvb3QobWFpbkJyYW5jaCk7XG4gIH1cbn0iXX0=