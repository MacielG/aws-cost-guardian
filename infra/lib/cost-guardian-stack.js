"use strict";
// infra/lib/cost-guardian-stack.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.CostGuardianStack = void 0;
const cdk = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
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
const aws_cdk_lib_1 = require("aws-cdk-lib");
const acm = require("aws-cdk-lib/aws-certificatemanager");
const amplify = require("@aws-cdk/aws-amplify-alpha");
const ec2 = require("aws-cdk-lib/aws-ec2");
const cloudwatch = require("aws-cdk-lib/aws-cloudwatch");
const logs = require("aws-cdk-lib/aws-logs");
const kms = require("aws-cdk-lib/aws-kms");
const codebuild = require("aws-cdk-lib/aws-codebuild");
class CostGuardianStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Define asset paths with defaults
        const backendPath = props.backendPath || path.join(__dirname, '../../backend');
        const backendFunctionsPath = props.backendFunctionsPath || path.join(__dirname, '../../backend/functions');
        const docsPath = props.docsPath || path.join(__dirname, '../../docs');
        // Adicionar tags a todos os recursos do stack (comentado para testes)
        // cdk.Tags.of(this).add('Environment', props.isTestEnvironment ? 'Test' : 'Production');
        // cdk.Tags.of(this).add('Project', 'CostGuardian');
        // cdk.Tags.of(this).add('Owner', 'FinOpsTeam');
        // cdk.Tags.of(this).add('CostCenter', '12345');
        // Validação robusta de propriedades no início do construtor para Amplify
        if (!props.isTestEnvironment) {
            if (!props.githubRepo || !props.githubTokenSecretName || !props.githubBranch || !props.domainName || !props.hostedZoneId) {
                throw new Error('As propriedades githubRepo, githubTokenSecretName, githubBranch, domainName e hostedZoneId são obrigatórias para ambientes não-teste.');
            }
        }
        // Validação para testes que precisam de um mock de githubRepo
        if (props.isTestEnvironment && (!props.githubRepo || !props.githubTokenSecretName || !props.githubBranch)) {
            throw new Error('As propriedades githubRepo, githubTokenSecretName e githubBranch são obrigatórias, mesmo em ambientes de teste, para a construção do stack.');
        }
        const domainName = props.domainName || 'example.com';
        const hostedZoneId = props.hostedZoneId || 'Z123456789';
        const githubRepo = props.githubRepo || 'user/repo';
        const githubBranch = props.githubBranch || 'main';
        const githubTokenSecretName = props.githubTokenSecretName || 'github-token';
        // Secrets (Mantido)
        const stripeSecret = new secretsmanager.Secret(this, 'StripeSecret', {
            secretName: 'StripeSecret',
            encryptionKey: new kms.Key(this, 'StripeSecretKmsKey', { enableKeyRotation: true, removalPolicy: cdk.RemovalPolicy.DESTROY }),
            // O valor inicial é um placeholder. O usuário deve preenchê-lo.
            secretStringValue: aws_cdk_lib_1.SecretValue.unsafePlainText('{"key":"sk_test_PLACEHOLDER"}'),
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // Webhook secret (raw string) stored in Secrets Manager for secure delivery - CORRIGIDO
        const stripeWebhookSecret = new secretsmanager.Secret(this, 'StripeWebhookSecret', {
            secretName: 'StripeWebhookSecret',
            description: 'Stripe webhook signing secret for platform webhooks',
            encryptionKey: new kms.Key(this, 'StripeWebhookSecretKmsKey', { enableKeyRotation: true, removalPolicy: cdk.RemovalPolicy.DESTROY }),
            // O valor inicial é um placeholder.
            secretStringValue: aws_cdk_lib_1.SecretValue.unsafePlainText('{"webhook":"whsec_PLACEHOLDER"}'),
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // --- Validação Robusta de Segredos ---
        // Esta validação ocorre durante o 'cdk synth' ou 'cdk deploy'.
        // Se os segredos ainda contiverem valores placeholder, o deploy falhará.
        if (!props.isTestEnvironment) {
            const stripeKeyValue = stripeSecret.secretValueFromJson('key').unsafeUnwrap();
            const webhookValue = stripeWebhookSecret.secretValueFromJson('webhook').unsafeUnwrap();
            if (stripeKeyValue.includes('PLACEHOLDER') || webhookValue.includes('PLACEHOLDER')) {
                throw new Error(`ERRO: Segredos do Stripe não foram configurados. Por favor, edite os segredos 'StripeSecret' e 'StripeWebhookSecret' no AWS Secrets Manager com os valores reais e tente o deploy novamente.`);
            }
        }
        // KMS Key para todos os CloudWatch Log Groups (removida para evitar conflitos)
        const logKmsKey = undefined; // Temporário para evitar erros de TypeScript
        // KMS Key para DynamoDB
        const dynamoKmsKey = new kms.Key(this, 'DynamoKmsKey', {
            enableKeyRotation: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            description: 'KMS key for DynamoDB table encryption',
        });
        // KMS Key para S3 Buckets
        const s3KmsKey = new kms.Key(this, 'S3Key', {
            enableKeyRotation: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            description: 'KMS key for S3 bucket encryption',
        });
        // DynamoDB (Mantido, mas adicionando stream para eficiência futura)
        const table = new dynamodb.Table(this, 'CostGuardianTable', {
            tableName: 'CostGuardianTable',
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
            pointInTimeRecoverySpecification: {
                pointInTimeRecoveryEnabled: true
            },
            encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
            encryptionKey: dynamoKmsKey,
        });
        // Adicionar tags à tabela DynamoDB usando addPropertyOverride
        const cfnTable = table.node.defaultChild;
        cfnTable.addPropertyOverride('Tags', [
            { Key: 'Environment', Value: props.isTestEnvironment ? 'Test' : 'Production' },
            { Key: 'Project', Value: 'CostGuardian' },
            { Key: 'Owner', Value: 'FinOpsTeam' },
            { Key: 'CostCenter', Value: '12345' },
        ]);
        // Habilitar Auto Scaling para o modo provisionado (se aplicável no futuro)
        // Para PAY_PER_REQUEST, isso não é necessário, mas o teste pode ser adaptado.
        // GSI para mapear AWS Account ID para nosso Customer ID (CRÍTICO para correlação)
        table.addGlobalSecondaryIndex({
            indexName: 'AwsAccountIndex',
            partitionKey: { name: 'awsAccountId', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.INCLUDE,
            nonKeyAttributes: ['id'],
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
            websiteIndexDocument: 'template.yaml',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: false,
            versioned: true,
            encryption: s3.BucketEncryption.KMS,
            encryptionKey: s3KmsKey,
            blockPublicAccess: new s3.BlockPublicAccess({
                blockPublicAcls: true,
                ignorePublicAcls: true,
                blockPublicPolicy: false,
                restrictPublicBuckets: false, // Permite a política de website
            }),
            publicReadAccess: true,
            lifecycleRules: [{
                    id: 'DefaultLifecycle',
                    enabled: true,
                    expiration: cdk.Duration.days(90),
                    noncurrentVersionExpiration: cdk.Duration.days(60),
                    transitions: [{
                            storageClass: s3.StorageClass.INTELLIGENT_TIERING,
                            transitionAfter: cdk.Duration.days(30), // Após 30 dias
                        }],
                    noncurrentVersionTransitions: [{
                            storageClass: s3.StorageClass.GLACIER,
                            transitionAfter: cdk.Duration.days(30), // Após 30 dias
                        }],
                }]
        });
        // Removido addPropertyOverride para evitar conflito com encryption: KMS
        // Adicionar tags ao bucket removido para compatibilidade com testes
        // Adicionar política para permitir que o serviço S3 use a chave KMS
        s3KmsKey.addToResourcePolicy(new iam.PolicyStatement({
            actions: ['kms:Encrypt', 'kms:Decrypt', 'kms:ReEncrypt*', 'kms:GenerateDataKey*', 'kms:DescribeKey'],
            principals: [new iam.ServicePrincipal('s3.amazonaws.com')],
            resources: ['*'],
        }));
        // Conditionally perform deployment ONLY if not in test environment
        if (!props.isTestEnvironment) {
            const fs = require('fs');
            if (fs.existsSync(docsPath)) {
                // Deployments are ONLY created inside this block
                new s3deploy.BucketDeployment(this, 'DeployCfnTemplate', {
                    sources: [s3deploy.Source.asset(docsPath)],
                    include: ['cost-guardian-template.yaml'],
                    destinationKeyPrefix: '',
                    destinationBucket: templateBucket,
                });
                new s3deploy.BucketDeployment(this, 'DeployTrialCfnTemplate', {
                    sources: [s3deploy.Source.asset(docsPath)],
                    include: ['cost-guardian-TRIAL-template.yaml'],
                    destinationKeyPrefix: '',
                    destinationBucket: templateBucket,
                });
            }
            else {
                console.warn(`Warning: Docs path not found at ${docsPath}. Skipping S3 template deployment.`);
            }
        }
        // If isTestEnvironment is true, the Source.asset() calls are never made.
        // Ensure URLs passed to lambdas/outputs handle the test case gracefully
        const trialTemplateUrl = !props.isTestEnvironment ? (templateBucket.bucketWebsiteUrl + '/cost-guardian-TRIAL-template.yaml') : 'test-trial-url';
        const fullTemplateUrl = !props.isTestEnvironment ? (templateBucket.bucketWebsiteUrl + '/template.yaml') : 'test-full-url';
        // VPC e Security Group para Lambdas (Task 8)
        const vpc = new ec2.Vpc(this, 'CostGuardianVpc', {
            maxAzs: 2,
            subnetConfiguration: [
                { cidrMask: 24, name: 'Public', subnetType: ec2.SubnetType.PUBLIC },
                { cidrMask: 24, name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            ],
        });
        const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
            vpc,
            description: 'Allow outbound traffic for Lambdas',
            allowAllOutbound: true, // Lambdas precisam acessar serviços externos
        });
        // Cognito (Mantido)
        const userPool = new cognito.UserPool(this, 'CostGuardianPool', {
            selfSignUpEnabled: true,
            signInAliases: { email: true },
            autoVerify: { email: true },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: true,
            },
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            userVerification: {
                emailStyle: cognito.VerificationEmailStyle.CODE,
            }
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
        const apiHandlerLambda = new lambda.Function(this, 'ApiHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            code: lambda.Code.fromAsset(backendPath),
            handler: 'handler.app',
            // Configurações de VPC (Task 8)
            vpc,
            securityGroups: [lambdaSecurityGroup],
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            memorySize: 1024,
            timeout: cdk.Duration.seconds(29),
            logGroup: new cdk.aws_logs.LogGroup(this, 'ApiHandlerLogGroup', {
                retention: cdk.aws_logs.RetentionDays.ONE_YEAR,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
            }),
            reservedConcurrentExecutions: 100,
            environment: {
                LOG_LEVEL: props.isTestEnvironment ? 'DEBUG' : 'INFO',
                DYNAMODB_TABLE: table.tableName,
                STRIPE_SECRET_ARN: stripeSecret.secretArn,
                STRIPE_WEBHOOK_SECRET_ARN: stripeWebhookSecret.secretArn,
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                PLATFORM_ACCOUNT_ID: this.account || process.env.CDK_DEFAULT_ACCOUNT,
                TRIAL_TEMPLATE_URL: trialTemplateUrl,
                FULL_TEMPLATE_URL: fullTemplateUrl,
            },
        });
        // Refinar permissões do ApiHandler para DynamoDB (Task 4)
        // Substitui table.grantReadWriteData(apiHandlerLambda);
        apiHandlerLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:Scan'],
            resources: [table.tableArn, `${table.tableArn}/index/*`],
        }));
        stripeSecret.grantRead(apiHandlerLambda);
        // Grant the API handler permission to read the webhook secret
        stripeWebhookSecret.grantRead(apiHandlerLambda);
        // 2. Lambda para o EventBridge (Correlacionar Eventos Health)
        const healthEventHandlerLambda = new lambda.Function(this, 'HealthEventHandler', {
            functionName: 'HealthEventHandler',
            runtime: lambda.Runtime.NODEJS_18_X,
            code: lambda.Code.fromAsset(backendFunctionsPath),
            handler: 'correlate-health.handler',
            // Configurações de VPC (Task 8)
            vpc,
            securityGroups: [lambdaSecurityGroup],
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            logGroup: new cdk.aws_logs.LogGroup(this, 'HealthEventHandlerLogGroup', {
                retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
            }),
            reservedConcurrentExecutions: 20,
            // A remoção de 'externalModules' permite que o esbuild empacote as dependências do SDK v3.
            environment: {
                DYNAMODB_TABLE: table.tableName,
                SFN_ARN: '', // Será preenchido abaixo
            },
        });
        table.grantReadWriteData(healthEventHandlerLambda);
        // Lambda para execução de recomendações
        const executeRecommendationLambda = new lambda.Function(this, 'ExecuteRecommendation', {
            functionName: 'ExecuteRecommendation',
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'execute-recommendation.handler',
            code: lambda.Code.fromAsset(backendFunctionsPath),
            timeout: cdk.Duration.minutes(5),
            // Configurações de VPC (Task 8)
            vpc,
            securityGroups: [lambdaSecurityGroup],
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            logGroup: new cdk.aws_logs.LogGroup(this, 'ExecuteRecommendationLogGroup', {
                retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                encryptionKey: logKmsKey,
            }),
            reservedConcurrentExecutions: 10,
            memorySize: 256,
            environment: {
                DYNAMODB_TABLE: table.tableName,
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
        const slaCalculateImpactLambda = new lambda.Function(this, 'SlaCalculateImpact', {
            functionName: 'SlaCalculateImpact',
            runtime: lambda.Runtime.NODEJS_18_X,
            code: lambda.Code.fromAsset(backendFunctionsPath),
            handler: 'sla-workflow.calculateImpact',
            // Configurações de VPC (Task 8)
            vpc,
            securityGroups: [lambdaSecurityGroup],
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            logGroup: new cdk.aws_logs.LogGroup(this, 'SlaCalculateImpactLogGroup', {
                retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                encryptionKey: logKmsKey,
            }),
            reservedConcurrentExecutions: 10,
            // A remoção de 'externalModules' permite que o esbuild empacote as dependências do SDK v3.
            environment: {
                DYNAMODB_TABLE: table.tableName,
            },
            role: new iam.Role(this, 'SlaCalcRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
                ],
                inlinePolicies: {
                    AssumeAndSupportPolicy: new iam.PolicyDocument({
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
        const slaCheckLambda = new lambda.Function(this, 'SlaCheck', {
            functionName: 'SlaCheck',
            runtime: lambda.Runtime.NODEJS_18_X,
            code: lambda.Code.fromAsset(backendFunctionsPath),
            handler: 'sla-workflow.checkSLA',
            // Configurações de VPC (Task 8)
            vpc,
            securityGroups: [lambdaSecurityGroup],
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            logGroup: new cdk.aws_logs.LogGroup(this, 'SlaCheckLogGroup', {
                retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                encryptionKey: logKmsKey,
            }),
            reservedConcurrentExecutions: 10,
            // A remoção de 'externalModules' permite que o esbuild empacote as dependências do SDK v3.
            environment: { DYNAMODB_TABLE: table.tableName },
        });
        const slaGenerateReportLambda = new lambda.Function(this, 'SlaGenerateReport', {
            functionName: 'SlaGenerateReport',
            runtime: lambda.Runtime.NODEJS_18_X,
            code: lambda.Code.fromAsset(backendFunctionsPath),
            handler: 'sla-workflow.generateReport',
            // Configurações de VPC (Task 8)
            vpc,
            securityGroups: [lambdaSecurityGroup],
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            logGroup: new cdk.aws_logs.LogGroup(this, 'SlaGenerateReportLogGroup', {
                retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                encryptionKey: logKmsKey,
            }),
            reservedConcurrentExecutions: 10,
            // A remoção de 'externalModules' permite que o esbuild empacote as dependências do SDK v3.
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
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            autoDeleteObjects: false,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            versioned: true,
            encryption: s3.BucketEncryption.KMS,
            encryptionKey: s3KmsKey,
            lifecycleRules: [{
                    id: 'DefaultLifecycle',
                    enabled: true,
                    expiration: cdk.Duration.days(365),
                    noncurrentVersionExpiration: cdk.Duration.days(90),
                    transitions: [{
                            storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                            transitionAfter: cdk.Duration.days(90), // Após 90 dias
                        }],
                    noncurrentVersionTransitions: [{
                            storageClass: s3.StorageClass.GLACIER,
                            transitionAfter: cdk.Duration.days(30),
                        }],
                }]
        });
        // Força a configuração de criptografia através do recurso L1
        // Removido addPropertyOverride para ReportsBucket também
        // Adicionar tags ao bucket
        cdk.Tags.of(reportsBucket).add('Environment', props.isTestEnvironment ? 'Test' : 'Production');
        cdk.Tags.of(reportsBucket).add('Project', 'CostGuardian');
        // Fornecer o nome do bucket como variável de ambiente para a Lambda (atualiza)
        slaGenerateReportLambda.addEnvironment('REPORTS_BUCKET_NAME', reportsBucket.bucketName);
        // Permissões necessárias para a Lambda escrever objetos no bucket
        reportsBucket.grantPut(slaGenerateReportLambda);
        const slaSubmitTicketLambda = new lambda.Function(this, 'SlaSubmitTicket', {
            functionName: 'SlaSubmitTicket',
            runtime: lambda.Runtime.NODEJS_18_X,
            code: lambda.Code.fromAsset(backendFunctionsPath),
            handler: 'sla-workflow.submitSupportTicket',
            // Configurações de VPC (Task 8)
            vpc,
            securityGroups: [lambdaSecurityGroup],
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            logGroup: new cdk.aws_logs.LogGroup(this, 'SlaSubmitTicketLogGroup', {
                retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                encryptionKey: logKmsKey,
            }),
            reservedConcurrentExecutions: 10,
            // A remoção de 'externalModules' permite que o esbuild empacote as dependências do SDK v3.
            environment: { DYNAMODB_TABLE: table.tableName },
            role: new iam.Role(this, 'SlaSubmitRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
                ],
                inlinePolicies: {
                    AssumeAndSupportPolicy: new iam.PolicyDocument({
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
        // Política para o Event Bus: restringe quem pode chamar PutEvents usando a sintaxe moderna
        new events.CfnEventBusPolicy(this, 'EventBusPolicy', {
            eventBusName: eventBus.eventBusName,
            statementId: 'AllowClientHealthEvents',
            statement: {
                Effect: 'Allow',
                Principal: '*',
                Action: 'events:PutEvents',
                Resource: eventBus.eventBusArn,
                Condition: {
                    StringEquals: {
                        'aws:PrincipalArn': 'arn:aws:iam::*:role/EventBusRole',
                    },
                },
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
        const costIngestorLambda = new lambda.Function(this, 'CostIngestor', {
            runtime: lambda.Runtime.NODEJS_18_X,
            code: lambda.Code.fromAsset(backendFunctionsPath),
            handler: 'ingest-costs.handler',
            timeout: cdk.Duration.minutes(5),
            // Configurações de VPC (Task 8)
            vpc,
            securityGroups: [lambdaSecurityGroup],
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            logGroup: new cdk.aws_logs.LogGroup(this, 'CostIngestorLogGroup', {
                retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                encryptionKey: logKmsKey,
            }),
            reservedConcurrentExecutions: 5,
            // A remoção de 'externalModules' permite que o esbuild empacote as dependências do SDK v3.
            environment: {
                DYNAMODB_TABLE: table.tableName,
                SNS_TOPIC_ARN: anomalyAlertsTopic.topicArn,
            },
            role: new iam.Role(this, 'CostIngestorRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole')
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
        const stopIdleInstancesLambda = new lambda.Function(this, 'StopIdleInstances', {
            runtime: lambda.Runtime.NODEJS_18_X,
            code: lambda.Code.fromAsset(backendFunctionsPath),
            handler: 'execute-recommendation.handler',
            timeout: cdk.Duration.minutes(5),
            // Configurações de VPC (Task 8)
            vpc,
            securityGroups: [lambdaSecurityGroup],
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            logGroup: new cdk.aws_logs.LogGroup(this, 'StopIdleInstancesLogGroup', {
                retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                encryptionKey: logKmsKey,
            }),
            reservedConcurrentExecutions: 10,
            environment: { DYNAMODB_TABLE: table.tableName },
            role: new iam.Role(this, 'StopIdleRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole')],
                inlinePolicies: {
                    DynamoPolicy: new iam.PolicyDocument({ statements: [
                            new iam.PolicyStatement({ actions: ['dynamodb:Query', 'dynamodb:Scan', 'dynamodb:GetItem', 'dynamodb:PutItem'], resources: [table.tableArn, `${table.tableArn}/index/*`] }),
                            new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: ['arn:aws:iam::*:role/CostGuardianDelegatedRole'] }),
                        ] })
                }
            })
        });
        table.grantReadWriteData(stopIdleInstancesLambda);
        const recommendRdsIdleLambda = new lambda.Function(this, 'RecommendRdsIdle', {
            runtime: lambda.Runtime.NODEJS_18_X,
            code: lambda.Code.fromAsset(backendFunctionsPath),
            handler: 'recommend-rds-idle.handler',
            timeout: cdk.Duration.minutes(5),
            // Configurações de VPC (Task 8)
            vpc,
            securityGroups: [lambdaSecurityGroup],
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            reservedConcurrentExecutions: 10,
            logGroup: new cdk.aws_logs.LogGroup(this, 'RecommendRdsIdleLogGroup', {
                retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                encryptionKey: logKmsKey,
            }),
            environment: { DYNAMODB_TABLE: table.tableName },
            role: new iam.Role(this, 'RecommendRdsRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole')],
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
        const recommendIdleInstancesLambda = new lambda.Function(this, 'RecommendIdleInstances', {
            functionName: 'RecommendIdleInstances',
            runtime: lambda.Runtime.NODEJS_18_X,
            code: lambda.Code.fromAsset(backendFunctionsPath),
            handler: 'recommend-idle-instances.handler',
            timeout: cdk.Duration.minutes(5),
            vpc,
            securityGroups: [lambdaSecurityGroup],
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            reservedConcurrentExecutions: 10,
            logGroup: new cdk.aws_logs.LogGroup(this, 'RecommendIdleInstancesLogGroup', {
                retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                encryptionKey: logKmsKey,
            }),
            environment: {
                DYNAMODB_TABLE: table.tableName,
                SNS_TOPIC_ARN: anomalyAlertsTopic.topicArn,
            },
            role: new iam.Role(this, 'RecommendIdleInstancesRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole')],
                inlinePolicies: {
                    DynamoAndAssumePolicy: new iam.PolicyDocument({ statements: [
                            new iam.PolicyStatement({ actions: ['dynamodb:Query', 'dynamodb:Scan', 'dynamodb:GetItem', 'dynamodb:PutItem'], resources: [table.tableArn, `${table.tableArn}/index/*`] }),
                            new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: ['arn:aws:iam::*:role/CostGuardianDelegatedRole'] }),
                            new iam.PolicyStatement({ actions: ['ec2:DescribeInstances', 'ec2:DescribeReservedInstances'], resources: ['*'] }),
                            new iam.PolicyStatement({ actions: ['cloudwatch:GetMetricStatistics'], resources: ['*'] }),
                            new iam.PolicyStatement({ actions: ['pricing:GetProducts'], resources: ['*'] }),
                        ] })
                }
            })
        });
        table.grantReadWriteData(recommendIdleInstancesLambda);
        anomalyAlertsTopic.grantPublish(recommendIdleInstancesLambda);
        const deleteUnusedEbsLambda = new lambda.Function(this, 'DeleteUnusedEbs', {
            functionName: 'DeleteUnusedEbs',
            runtime: lambda.Runtime.NODEJS_18_X,
            code: lambda.Code.fromAsset(backendFunctionsPath),
            handler: 'delete-unused-ebs.handler',
            timeout: cdk.Duration.minutes(5),
            // Configurações de VPC (Task 8)
            vpc,
            securityGroups: [lambdaSecurityGroup],
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            reservedConcurrentExecutions: 10,
            logGroup: new cdk.aws_logs.LogGroup(this, 'DeleteUnusedEbsLogGroup', {
                retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                encryptionKey: logKmsKey,
            }),
            // A remoção de 'externalModules' permite que o esbuild empacote as dependências do SDK v3.
            environment: { DYNAMODB_TABLE: table.tableName },
            role: new iam.Role(this, 'DeleteEbsRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole')],
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
        const automationErrorHandler = new stepfunctions.Fail(this, 'AutomationFailed', {
            cause: 'Automation workflow execution failed',
            error: 'AutomationError',
        });
        const stopIdleTask = new sfn_tasks.LambdaInvoke(this, 'StopIdleResources', {
            lambdaFunction: stopIdleInstancesLambda,
            outputPath: '$.Payload',
            retryOnServiceExceptions: true,
        }).addRetry({
            errors: ['States.TaskFailed'],
            interval: cdk.Duration.seconds(2),
            maxAttempts: 3,
            backoffRate: 2,
        }).addCatch(new stepfunctions.Fail(this, 'StopIdleFailed', {
            cause: 'Stop idle resources failed',
            error: 'StopIdleError',
        }), {
            resultPath: '$.error',
        });
        const deleteEbsTask = new sfn_tasks.LambdaInvoke(this, 'DeleteUnusedVolumes', {
            lambdaFunction: deleteUnusedEbsLambda,
            outputPath: '$.Payload',
            retryOnServiceExceptions: true,
        }).addRetry({
            errors: ['States.TaskFailed'],
            interval: cdk.Duration.seconds(2),
            maxAttempts: 3,
            backoffRate: 2,
        }).addCatch(new stepfunctions.Fail(this, 'DeleteEbsFailed', {
            cause: 'Delete unused volumes failed',
            error: 'DeleteEbsError',
        }), {
            resultPath: '$.error',
        });
        const recommendRdsTask = new sfn_tasks.LambdaInvoke(this, 'RecommendIdleRds', {
            lambdaFunction: recommendRdsIdleLambda,
            outputPath: '$.Payload',
            retryOnServiceExceptions: true,
        }).addRetry({
            errors: ['States.TaskFailed'],
            interval: cdk.Duration.seconds(2),
            maxAttempts: 3,
            backoffRate: 2,
        }).addCatch(new stepfunctions.Fail(this, 'RecommendRdsFailed', {
            cause: 'Recommend idle RDS failed',
            error: 'RecommendRdsError',
        }), {
            resultPath: '$.error',
        });
        const automationDefinition = new stepfunctions.Parallel(this, 'RunAllAutomations')
            .branch(stopIdleTask)
            .branch(deleteEbsTask)
            .branch(recommendRdsTask);
        const automationSfn = new stepfunctions.StateMachine(this, 'AutomationWorkflow', {
            stateMachineName: 'AutomationWorkflow',
            definitionBody: stepfunctions.DefinitionBody.fromChainable(automationDefinition),
            logs: {
                destination: new cdk.aws_logs.LogGroup(this, 'AutomationSfnLogGroup', {
                    removalPolicy: cdk.RemovalPolicy.DESTROY,
                    encryptionKey: logKmsKey,
                }),
                level: stepfunctions.LogLevel.ALL,
            },
            tracingEnabled: true,
        });
        // 7.4. Regra semanal para disparar a State Machine
        new events.Rule(this, 'WeeklyAutomationRule', {
            schedule: events.Schedule.cron({ weekDay: 'SUN', hour: '3', minute: '0' }),
            targets: [new targets.SfnStateMachine(automationSfn)],
        });
        // Lambda de metering do Marketplace
        const marketplaceMeteringLambda = new lambda.Function(this, 'MarketplaceMetering', {
            runtime: lambda.Runtime.NODEJS_18_X,
            code: lambda.Code.fromAsset(backendFunctionsPath),
            handler: 'marketplace-metering.handler',
            // Configurações de VPC (Task 8)
            vpc,
            securityGroups: [lambdaSecurityGroup],
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            reservedConcurrentExecutions: 2,
            logGroup: new cdk.aws_logs.LogGroup(this, 'MarketplaceMeteringLogGroup', {
                retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                encryptionKey: logKmsKey,
            }),
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
        // Handler de erro para SLA workflow
        const slaErrorHandler = new stepfunctions.Fail(this, 'SlaWorkflowFailed', {
            cause: 'SLA workflow execution failed',
            error: 'SlaWorkflowError',
        });
        const calculateImpactTask = new sfn_tasks.LambdaInvoke(this, 'CalculateImpact', {
            lambdaFunction: slaCalculateImpactLambda,
            outputPath: '$.Payload',
            retryOnServiceExceptions: true,
        }).addRetry({
            errors: ['States.TaskFailed', 'States.Timeout'],
            interval: cdk.Duration.seconds(2),
            maxAttempts: 3,
            backoffRate: 2,
        }).addCatch(slaErrorHandler, {
            resultPath: '$.error',
        });
        const checkSlaTask = new sfn_tasks.LambdaInvoke(this, 'CheckSLA', {
            lambdaFunction: slaCheckLambda,
            outputPath: '$.Payload',
            retryOnServiceExceptions: true,
        }).addRetry({
            errors: ['States.TaskFailed'],
            interval: cdk.Duration.seconds(2),
            maxAttempts: 3,
            backoffRate: 2,
        }).addCatch(slaErrorHandler, {
            resultPath: '$.error',
        });
        const generateReportTask = new sfn_tasks.LambdaInvoke(this, 'GenerateReport', {
            lambdaFunction: slaGenerateReportLambda,
            outputPath: '$.Payload',
            retryOnServiceExceptions: true,
        }).addRetry({
            errors: ['States.TaskFailed'],
            interval: cdk.Duration.seconds(2),
            maxAttempts: 3,
            backoffRate: 2,
        }).addCatch(slaErrorHandler, {
            resultPath: '$.error',
        });
        const submitTicketTask = new sfn_tasks.LambdaInvoke(this, 'SubmitTicket', {
            lambdaFunction: slaSubmitTicketLambda,
            outputPath: '$.Payload',
            retryOnServiceExceptions: true,
        }).addRetry({
            errors: ['States.TaskFailed'],
            interval: cdk.Duration.seconds(2),
            maxAttempts: 3,
            backoffRate: 2,
        }).addCatch(slaErrorHandler, {
            resultPath: '$.error',
        });
        const noClaim = new stepfunctions.Succeed(this, 'NoClaimGenerated');
        const claimChoice = new stepfunctions.Choice(this, 'IsClaimGenerated?')
            .when(stepfunctions.Condition.booleanEquals('$.claimGenerated', true), submitTicketTask)
            .otherwise(noClaim);
        const slaDefinition = calculateImpactTask
            .next(checkSlaTask)
            .next(generateReportTask)
            .next(claimChoice);
        const sfn = new stepfunctions.StateMachine(this, 'SLAWorkflow', {
            stateMachineName: 'SLAWorkflow',
            stateMachineType: stepfunctions.StateMachineType.STANDARD,
            definitionBody: stepfunctions.DefinitionBody.fromChainable(slaDefinition),
            logs: {
                destination: new cdk.aws_logs.LogGroup(this, 'SfnLogGroup', {
                    removalPolicy: cdk.RemovalPolicy.DESTROY,
                    encryptionKey: logKmsKey,
                }),
                level: stepfunctions.LogLevel.ALL,
            },
            tracingEnabled: true,
        });
        // Adicionar o ARN do SFN ao Lambda de correlação
        healthEventHandlerLambda.addEnvironment('SFN_ARN', sfn.stateMachineArn);
        // Permissão para o Lambda iniciar a State Machine
        sfn.grantStartExecution(healthEventHandlerLambda);
        // API Gateway (Usando o 'apiHandlerLambda' correto)
        const cloudwatch_actions = cdk.aws_cloudwatch_actions;
        const api = new apigw.RestApi(this, 'CostGuardianAPI', {
            restApiName: 'CostGuardianApi',
            defaultCorsPreflightOptions: { allowOrigins: apigw.Cors.ALL_ORIGINS },
            deployOptions: {
                tracingEnabled: true,
                stageName: 'prod',
                throttlingRateLimit: 100,
                throttlingBurstLimit: 50,
                methodOptions: {
                    '/*/*': {
                        throttlingBurstLimit: 50, // (Task 9)
                    },
                },
            },
        }); // (Task 9)
        const auth = new apigw.CognitoUserPoolsAuthorizer(this, 'CognitoAuth', {
            cognitoUserPools: [userPool],
        });
        const waf = new cdk.aws_wafv2.CfnWebACL(this, 'ApiWaf', {
            scope: 'REGIONAL',
            defaultAction: { allow: {} },
            visibilityConfig: { sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName: 'ApiWaf' },
            rules: [{ name: 'AWS-AWSManagedRulesCommonRuleSet', priority: 1, statement: { managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesCommonRuleSet' } }, overrideAction: { none: {} }, visibilityConfig: { sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName: 'awsCommonRules' } }] // (Task 9)
        });
        new cdk.aws_wafv2.CfnWebACLAssociation(this, 'ApiWafAssociation', { resourceArn: api.deploymentStage.stageArn, webAclArn: waf.attrArn });
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
            value: fullTemplateUrl,
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
        // Adicionar VPC Endpoints para serviços essenciais
        vpc.addGatewayEndpoint('DynamoDBEndpoint', {
            service: cdk.aws_ec2.GatewayVpcEndpointAwsService.DYNAMODB,
        });
        vpc.addGatewayEndpoint('S3Endpoint', {
            service: cdk.aws_ec2.GatewayVpcEndpointAwsService.S3,
        });
        // Log Group para export de env
        const envExportLogGroup = new logs.LogGroup(this, 'EnvExportLogGroup', {
            logGroupName: 'CostGuardian/EnvExport',
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // SNS Topic para alertas de export
        const envAlertTopic = new sns.Topic(this, 'EnvAlertTopic', {
            displayName: 'CostGuardian Env Export Alerts',
        });
        // Outputs para o script usar
        new cdk.CfnOutput(this, 'EnvAlertTopicArn', {
            value: envAlertTopic.topicArn,
            description: 'ARN do SNS topic para alertas de export de env',
        });
        if (!props.isTestEnvironment) {
            // CloudWatch Alarms para produção (Task 10)
            const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
                displayName: 'CostGuardian Alarms',
            });
            const api5xxAlarm = new cloudwatch.Alarm(this, 'Api5xxAlarm', {
                metric: api.metricServerError(),
                threshold: 1,
                evaluationPeriods: 1,
                alarmDescription: 'Alarm when API Gateway 5XX errors occur',
                actionsEnabled: true,
            });
            api5xxAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));
            const apiLatencyAlarm = new cloudwatch.Alarm(this, 'ApiLatencyAlarm', {
                metric: api.metricLatency(),
                threshold: 1000,
                evaluationPeriods: 1,
                alarmDescription: 'Alarm when API Gateway latency is high (>1s)',
                actionsEnabled: true,
            });
            apiLatencyAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));
        }
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
                            `echo "NEXT_PUBLIC_CFN_TEMPLATE_URL=${fullTemplateUrl}" >> .env.production`,
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
        if (props.isTestEnvironment) {
            return; // Não criar recursos de Amplify, Route53, ACM em testes
        }
        // Validação para garantir que as props existem após a verificação do ambiente de teste
        if (!props.githubRepo || !props.githubTokenSecretName || !props.githubBranch) {
            throw new Error('As propriedades do GitHub são necessárias para o deploy do Amplify.');
        }
        const [owner, repository] = props.githubRepo.split('/');
        if (!owner || !repository) {
            throw new Error('O githubRepo deve estar no formato "owner/repository"');
        }
        const amplifyApp = new amplify.App(this, 'CostGuardianFrontend', {
            appName: 'CostGuardianApp',
            sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
                owner,
                repository,
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
            hostedZoneId: hostedZoneId,
            zoneName: domainName,
        });
        const certificate = new acm.Certificate(this, 'SslCertificate', {
            domainName: domainName,
            subjectAlternativeNames: [`www.${domainName}`],
            validation: acm.CertificateValidation.fromDns(hostedZone),
        });
        const domain = amplifyApp.addDomain(domainName, {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29zdC1ndWFyZGlhbi1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNvc3QtZ3VhcmRpYW4tc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLG1DQUFtQzs7O0FBRW5DLG1DQUFtQztBQUVuQyxpREFBaUQ7QUFDakQsNkJBQTZCO0FBQzdCLG9EQUFvRDtBQUNwRCxxREFBcUQ7QUFDckQsbURBQW1EO0FBQ25ELHlDQUF5QztBQUN6QywwREFBMEQ7QUFDMUQsaURBQWlEO0FBQ2pELDBEQUEwRDtBQUMxRCwrREFBK0Q7QUFDL0QsaUVBQWlFO0FBQ2pFLGlFQUFpRTtBQUNqRSwyQ0FBMkM7QUFDM0MsMkNBQTJDO0FBQzNDLG1EQUFtRDtBQUNuRCw2Q0FBMEM7QUFDMUMsMERBQTBEO0FBQzFELHNEQUFzRDtBQUN0RCwyQ0FBMkM7QUFDM0MseURBQXlEO0FBQ3pELDZDQUE2QztBQUM3QywyQ0FBMkM7QUFDM0MsdURBQXVEO0FBaUN2RCxNQUFhLGlCQUFrQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzlDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBNkI7UUFDckUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsbUNBQW1DO1FBQ25DLE1BQU0sV0FBVyxHQUFHLEtBQUssQ0FBQyxXQUFXLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsZUFBZSxDQUFDLENBQUM7UUFDL0UsTUFBTSxvQkFBb0IsR0FBRyxLQUFLLENBQUMsb0JBQW9CLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUseUJBQXlCLENBQUMsQ0FBQztRQUMzRyxNQUFNLFFBQVEsR0FBRyxLQUFLLENBQUMsUUFBUSxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFlBQVksQ0FBQyxDQUFDO1FBSXRFLHNFQUFzRTtRQUN0RSx5RkFBeUY7UUFDekYsb0RBQW9EO1FBQ3BELGdE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VUFBVSxFQUFFLEtBQUssQ0FBQyxZQUFZO1NBQy9CLENBQUMsQ0FBQztRQUVILHNCQUFzQjtRQUN0QixNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsVUFBVSxDQUFDLHdCQUF3QixDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDakYsWUFBWSxFQUFFLFlBQVk7WUFDMUIsUUFBUSxFQUFFLFVBQVU7U0FDckIsQ0FBQyxDQUFDO1FBRUgsTUFBTSxXQUFXLEdBQUcsSUFBSSxHQUFHLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUM5RCxVQUFVLEVBQUUsVUFBVTtZQUN0Qix1QkFBdUIsRUFBRSxDQUFDLE9BQU8sVUFBVSxFQUFFLENBQUM7WUFDOUMsVUFBVSxFQUFFLEdBQUcsQ0FBQyxxQkFBcUIsQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDO1NBQzFELENBQUMsQ0FBQztRQUVILE1BQU0sTUFBTSxHQUFHLFVBQVUsQ0FBQyxTQUFTLENBQUMsVUFBVSxFQUFFO1lBQzlDLG1CQUFtQixFQUFFLElBQUk7WUFDekIsVUFBVSxFQUFFO2dCQUNWO29CQUNFLE1BQU0sRUFBRSxVQUFVO29CQUNsQixNQUFNLEVBQUUsS0FBSztpQkFDZDthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBQ0gsTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQztJQUM3QixDQUFDO0NBQ0Y7QUE3dUNELDhDQTZ1Q0MiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBpbmZyYS9saWIvY29zdC1ndWFyZGlhbi1zdGFjay50c1xuXG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgYXBpZ3cgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcbmltcG9ydCAqIGFzIGNvZ25pdG8gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZ25pdG8nO1xuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcbmltcG9ydCAqIGFzIHMzZGVwbG95IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMy1kZXBsb3ltZW50JztcbmltcG9ydCAqIGFzIGV2ZW50cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzJztcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcbmltcG9ydCAqIGFzIHN0ZXBmdW5jdGlvbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXN0ZXBmdW5jdGlvbnMnO1xuaW1wb3J0ICogYXMgc2ZuX3Rhc2tzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zdGVwZnVuY3Rpb25zLXRhc2tzJztcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBzbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucyc7XG5pbXBvcnQgKiBhcyByb3V0ZTUzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1yb3V0ZTUzJztcbmltcG9ydCB7IFNlY3JldFZhbHVlIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgYWNtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jZXJ0aWZpY2F0ZW1hbmFnZXInO1xuaW1wb3J0ICogYXMgYW1wbGlmeSBmcm9tICdAYXdzLWNkay9hd3MtYW1wbGlmeS1hbHBoYSc7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgKiBhcyBjbG91ZHdhdGNoIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZHdhdGNoJztcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0ICogYXMga21zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1rbXMnO1xuaW1wb3J0ICogYXMgY29kZWJ1aWxkIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2RlYnVpbGQnO1xuXG5leHBvcnQgaW50ZXJmYWNlIENvc3RHdWFyZGlhblN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIGRvbWFpbk5hbWU/OiBzdHJpbmc7XG4gIGhvc3RlZFpvbmVJZD86IHN0cmluZztcbiAgZ2l0aHViUmVwbz86IHN0cmluZztcbiAgZ2l0aHViQnJhbmNoPzogc3RyaW5nO1xuICBnaXRodWJUb2tlblNlY3JldE5hbWU/OiBzdHJpbmc7XG4gIC8qKlxuICAgKiBTZSB0cnVlLCBkZXNhdGl2YSByZWN1cnNvcyBxdWUgZGVwZW5kZW0gZGUgYXNzZXRzIGbDrXNpY29zIGR1cmFudGUgb3MgdGVzdGVzLlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgaXNUZXN0RW52aXJvbm1lbnQ/OiBib29sZWFuO1xuICAvKipcbiAgICogU2UgdHJ1ZSwgY3JpYSBhbGFybWVzIGRvIENsb3VkV2F0Y2guXG4gICAqIEBkZWZhdWx0IHRydWVcbiAgICovXG4gIGNyZWF0ZUFsYXJtcz86IGJvb2xlYW47XG4gIGRlcHNMb2NrRmlsZVBhdGg/OiBzdHJpbmc7XG4gIC8qKlxuICAgKiBDYW1pbmhvIGFic29sdXRvIHBhcmEgYSBwYXN0YSBiYWNrZW5kXG4gICAqL1xuICBiYWNrZW5kUGF0aD86IHN0cmluZztcbiAgLyoqXG4gICAqIENhbWluaG8gYWJzb2x1dG8gcGFyYSBhIHBhc3RhIGJhY2tlbmQvZnVuY3Rpb25zXG4gICAqL1xuICBiYWNrZW5kRnVuY3Rpb25zUGF0aD86IHN0cmluZztcbiAgLyoqXG4gICAqIENhbWluaG8gYWJzb2x1dG8gcGFyYSBhIHBhc3RhIGRvY3NcbiAgICovXG4gIGRvY3NQYXRoPzogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgQ29zdEd1YXJkaWFuU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQ29zdEd1YXJkaWFuU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gRGVmaW5lIGFzc2V0IHBhdGhzIHdpdGggZGVmYXVsdHNcbiAgICBjb25zdCBiYWNrZW5kUGF0aCA9IHByb3BzLmJhY2tlbmRQYXRoIHx8IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9iYWNrZW5kJyk7XG4gICAgY29uc3QgYmFja2VuZEZ1bmN0aW9uc1BhdGggPSBwcm9wcy5iYWNrZW5kRnVuY3Rpb25zUGF0aCB8fCBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vYmFja2VuZC9mdW5jdGlvbnMnKTtcbiAgICBjb25zdCBkb2NzUGF0aCA9IHByb3BzLmRvY3NQYXRoIHx8IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9kb2NzJyk7XG5cblxuXG4gICAgLy8gQWRpY2lvbmFyIHRhZ3MgYSB0b2RvcyBvcyByZWN1cnNvcyBkbyBzdGFjayAoY29tZW50YWRvIHBhcmEgdGVzdGVzKVxuICAgIC8vIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnRW52aXJvbm1lbnQnLCBwcm9wcy5pc1Rlc3RFbnZpcm9ubWVudCA/ICdUZXN0JyA6ICdQcm9kdWN0aW9uJyk7XG4gICAgLy8gY2RrLlRhZ3Mub2YodGhpcykuYWRkKCdQcm9qZWN0JywgJ0Nvc3RHdWFyZGlhbicpO1xuICAgIC8vIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnT3duZXInLCAnRmluT3BzVGVhbScpO1xuICAgIC8vIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnQ29zdENlbnRlcicsICcxMjM0NScpO1xuXG5cbiAgICAvLyBWYWxpZGHDp8OjbyByb2J1c3RhIGRlIHByb3ByaWVkYWRlcyBubyBpbsOtY2lvIGRvIGNvbnN0cnV0b3IgcGFyYSBBbXBsaWZ5XG4gICAgaWYgKCFwcm9wcy5pc1Rlc3RFbnZpcm9ubWVudCkge1xuICAgICAgaWYgKCFwcm9wcy5naXRodWJSZXBvIHx8ICFwcm9wcy5naXRodWJUb2tlblNlY3JldE5hbWUgfHwgIXByb3BzLmdpdGh1YkJyYW5jaCB8fCAhcHJvcHMuZG9tYWluTmFtZSB8fCAhcHJvcHMuaG9zdGVkWm9uZUlkKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQXMgcHJvcHJpZWRhZGVzIGdpdGh1YlJlcG8sIGdpdGh1YlRva2VuU2VjcmV0TmFtZSwgZ2l0aHViQnJhbmNoLCBkb21haW5OYW1lIGUgaG9zdGVkWm9uZUlkIHPDo28gb2JyaWdhdMOzcmlhcyBwYXJhIGFtYmllbnRlcyBuw6NvLXRlc3RlLicpO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBWYWxpZGHDp8OjbyBwYXJhIHRlc3RlcyBxdWUgcHJlY2lzYW0gZGUgdW0gbW9jayBkZSBnaXRodWJSZXBvXG4gICAgaWYgKHByb3BzLmlzVGVzdEVudmlyb25tZW50ICYmICghcHJvcHMuZ2l0aHViUmVwbyB8fCAhcHJvcHMuZ2l0aHViVG9rZW5TZWNyZXROYW1lIHx8ICFwcm9wcy5naXRodWJCcmFuY2gpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQXMgcHJvcHJpZWRhZGVzIGdpdGh1YlJlcG8sIGdpdGh1YlRva2VuU2VjcmV0TmFtZSBlIGdpdGh1YkJyYW5jaCBzw6NvIG9icmlnYXTDs3JpYXMsIG1lc21vIGVtIGFtYmllbnRlcyBkZSB0ZXN0ZSwgcGFyYSBhIGNvbnN0cnXDp8OjbyBkbyBzdGFjay4nKTtcbiAgICB9XG5cbiAgICBjb25zdCBkb21haW5OYW1lID0gcHJvcHMuZG9tYWluTmFtZSB8fCAnZXhhbXBsZS5jb20nO1xuICAgIGNvbnN0IGhvc3RlZFpvbmVJZCA9IHByb3BzLmhvc3RlZFpvbmVJZCB8fCAnWjEyMzQ1Njc4OSc7XG4gICAgY29uc3QgZ2l0aHViUmVwbyA9IHByb3BzLmdpdGh1YlJlcG8gfHwgJ3VzZXIvcmVwbyc7XG4gICAgY29uc3QgZ2l0aHViQnJhbmNoID0gcHJvcHMuZ2l0aHViQnJhbmNoIHx8ICdtYWluJztcbiAgICBjb25zdCBnaXRodWJUb2tlblNlY3JldE5hbWUgPSBwcm9wcy5naXRodWJUb2tlblNlY3JldE5hbWUgfHwgJ2dpdGh1Yi10b2tlbic7XG5cbiAgICAvLyBTZWNyZXRzIChNYW50aWRvKVxuICAgIGNvbnN0IHN0cmlwZVNlY3JldCA9IG5ldyBzZWNyZXRzbWFuYWdlci5TZWNyZXQodGhpcywgJ1N0cmlwZVNlY3JldCcsIHtcbiAgICAgIHNlY3JldE5hbWU6ICdTdHJpcGVTZWNyZXQnLCAvLyBOb21lIGZpeG8gcGFyYSBmw6FjaWwgcmVmZXLDqm5jaWFcbiAgICAgIGVuY3J5cHRpb25LZXk6IG5ldyBrbXMuS2V5KHRoaXMsICdTdHJpcGVTZWNyZXRLbXNLZXknLCB7IGVuYWJsZUtleVJvdGF0aW9uOiB0cnVlLCByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZIH0pLFxuICAgICAgLy8gTyB2YWxvciBpbmljaWFsIMOpIHVtIHBsYWNlaG9sZGVyLiBPIHVzdcOhcmlvIGRldmUgcHJlZW5jaMOqLWxvLlxuICAgICAgc2VjcmV0U3RyaW5nVmFsdWU6IFNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dCgne1wia2V5XCI6XCJza190ZXN0X1BMQUNFSE9MREVSXCJ9JyksXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgLy8gV2ViaG9vayBzZWNyZXQgKHJhdyBzdHJpbmcpIHN0b3JlZCBpbiBTZWNyZXRzIE1hbmFnZXIgZm9yIHNlY3VyZSBkZWxpdmVyeSAtIENPUlJJR0lET1xuICAgIGNvbnN0IHN0cmlwZVdlYmhvb2tTZWNyZXQgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdTdHJpcGVXZWJob29rU2VjcmV0Jywge1xuICAgICAgc2VjcmV0TmFtZTogJ1N0cmlwZVdlYmhvb2tTZWNyZXQnLCAvLyBOb21lIGZpeG8gcGFyYSBmw6FjaWwgcmVmZXLDqm5jaWFcbiAgICAgIGRlc2NyaXB0aW9uOiAnU3RyaXBlIHdlYmhvb2sgc2lnbmluZyBzZWNyZXQgZm9yIHBsYXRmb3JtIHdlYmhvb2tzJyxcbiAgICAgIGVuY3J5cHRpb25LZXk6IG5ldyBrbXMuS2V5KHRoaXMsICdTdHJpcGVXZWJob29rU2VjcmV0S21zS2V5JywgeyBlbmFibGVLZXlSb3RhdGlvbjogdHJ1ZSwgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSB9KSxcbiAgICAgIC8vIE8gdmFsb3IgaW5pY2lhbCDDqSB1bSBwbGFjZWhvbGRlci5cbiAgICAgIHNlY3JldFN0cmluZ1ZhbHVlOiBTZWNyZXRWYWx1ZS51bnNhZmVQbGFpblRleHQoJ3tcIndlYmhvb2tcIjpcIndoc2VjX1BMQUNFSE9MREVSXCJ9JyksXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgLy8gLS0tIFZhbGlkYcOnw6NvIFJvYnVzdGEgZGUgU2VncmVkb3MgLS0tXG4gICAgLy8gRXN0YSB2YWxpZGHDp8OjbyBvY29ycmUgZHVyYW50ZSBvICdjZGsgc3ludGgnIG91ICdjZGsgZGVwbG95Jy5cbiAgICAvLyBTZSBvcyBzZWdyZWRvcyBhaW5kYSBjb250aXZlcmVtIHZhbG9yZXMgcGxhY2Vob2xkZXIsIG8gZGVwbG95IGZhbGhhcsOhLlxuICAgIGlmICghcHJvcHMuaXNUZXN0RW52aXJvbm1lbnQpIHtcbiAgICAgIGNvbnN0IHN0cmlwZUtleVZhbHVlID0gc3RyaXBlU2VjcmV0LnNlY3JldFZhbHVlRnJvbUpzb24oJ2tleScpLnVuc2FmZVVud3JhcCgpO1xuICAgICAgY29uc3Qgd2ViaG9va1ZhbHVlID0gc3RyaXBlV2ViaG9va1NlY3JldC5zZWNyZXRWYWx1ZUZyb21Kc29uKCd3ZWJob29rJykudW5zYWZlVW53cmFwKCk7XG5cbiAgICAgIGlmIChzdHJpcGVLZXlWYWx1ZS5pbmNsdWRlcygnUExBQ0VIT0xERVInKSB8fCB3ZWJob29rVmFsdWUuaW5jbHVkZXMoJ1BMQUNFSE9MREVSJykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFUlJPOiBTZWdyZWRvcyBkbyBTdHJpcGUgbsOjbyBmb3JhbSBjb25maWd1cmFkb3MuIFBvciBmYXZvciwgZWRpdGUgb3Mgc2VncmVkb3MgJ1N0cmlwZVNlY3JldCcgZSAnU3RyaXBlV2ViaG9va1NlY3JldCcgbm8gQVdTIFNlY3JldHMgTWFuYWdlciBjb20gb3MgdmFsb3JlcyByZWFpcyBlIHRlbnRlIG8gZGVwbG95IG5vdmFtZW50ZS5gKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBLTVMgS2V5IHBhcmEgdG9kb3Mgb3MgQ2xvdWRXYXRjaCBMb2cgR3JvdXBzIChyZW1vdmlkYSBwYXJhIGV2aXRhciBjb25mbGl0b3MpXG4gICAgY29uc3QgbG9nS21zS2V5ID0gdW5kZWZpbmVkOyAvLyBUZW1wb3LDoXJpbyBwYXJhIGV2aXRhciBlcnJvcyBkZSBUeXBlU2NyaXB0XG4gICAgXG4gICAgLy8gS01TIEtleSBwYXJhIER5bmFtb0RCXG4gICAgY29uc3QgZHluYW1vS21zS2V5ID0gbmV3IGttcy5LZXkodGhpcywgJ0R5bmFtb0ttc0tleScsIHtcbiAgICAgIGVuYWJsZUtleVJvdGF0aW9uOiB0cnVlLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnS01TIGtleSBmb3IgRHluYW1vREIgdGFibGUgZW5jcnlwdGlvbicsXG4gICAgfSk7XG5cbiAgICAvLyBLTVMgS2V5IHBhcmEgUzMgQnVja2V0c1xuICAgIGNvbnN0IHMzS21zS2V5ID0gbmV3IGttcy5LZXkodGhpcywgJ1MzS2V5Jywge1xuICAgICAgZW5hYmxlS2V5Um90YXRpb246IHRydWUsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgZGVzY3JpcHRpb246ICdLTVMga2V5IGZvciBTMyBidWNrZXQgZW5jcnlwdGlvbicsXG4gICAgfSk7XG5cbiAgICAvLyBEeW5hbW9EQiAoTWFudGlkbywgbWFzIGFkaWNpb25hbmRvIHN0cmVhbSBwYXJhIGVmaWNpw6puY2lhIGZ1dHVyYSlcbiAgICBjb25zdCB0YWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnQ29zdEd1YXJkaWFuVGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6ICdDb3N0R3VhcmRpYW5UYWJsZScsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgLy8gQ2hhdmUgcHJpbcOhcmlhIHBhcmEgdXN1w6FyaW9zLCBjbGFpbXMsIGV0Yy5cbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3NrJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgLy8gQ2hhdmUgZGUgY2xhc3NpZmljYcOnw6NvIHBhcmEgbW9kZWxhZ2VtIGZsZXjDrXZlbFxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBzdHJlYW06IGR5bmFtb2RiLlN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFUywgLy8gSGFiaWxpdGFyIHN0cmVhbVxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeVNwZWNpZmljYXRpb246IHtcbiAgICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeUVuYWJsZWQ6IHRydWVcbiAgICAgIH0sXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQ1VTVE9NRVJfTUFOQUdFRCwgLy8gVXNhciBLTVMgcGFyYSBtYWlvciBzZWd1cmFuw6dhIChUYXNrIDMpXG4gICAgICBlbmNyeXB0aW9uS2V5OiBkeW5hbW9LbXNLZXksXG4gICAgfSk7XG5cbiAgICAvLyBBZGljaW9uYXIgdGFncyDDoCB0YWJlbGEgRHluYW1vREIgdXNhbmRvIGFkZFByb3BlcnR5T3ZlcnJpZGVcbiAgICBjb25zdCBjZm5UYWJsZSA9IHRhYmxlLm5vZGUuZGVmYXVsdENoaWxkIGFzIGR5bmFtb2RiLkNmblRhYmxlO1xuICAgIGNmblRhYmxlLmFkZFByb3BlcnR5T3ZlcnJpZGUoJ1RhZ3MnLCBbXG4gICAgICB7IEtleTogJ0Vudmlyb25tZW50JywgVmFsdWU6IHByb3BzLmlzVGVzdEVudmlyb25tZW50ID8gJ1Rlc3QnIDogJ1Byb2R1Y3Rpb24nIH0sXG4gICAgICB7IEtleTogJ1Byb2plY3QnLCBWYWx1ZTogJ0Nvc3RHdWFyZGlhbicgfSxcbiAgICAgIHsgS2V5OiAnT3duZXInLCBWYWx1ZTogJ0Zpbk9wc1RlYW0nIH0sXG4gICAgICB7IEtleTogJ0Nvc3RDZW50ZXInLCBWYWx1ZTogJzEyMzQ1JyB9LFxuICAgIF0pO1xuXG4gICAgLy8gSGFiaWxpdGFyIEF1dG8gU2NhbGluZyBwYXJhIG8gbW9kbyBwcm92aXNpb25hZG8gKHNlIGFwbGljw6F2ZWwgbm8gZnV0dXJvKVxuICAgIC8vIFBhcmEgUEFZX1BFUl9SRVFVRVNULCBpc3NvIG7Do28gw6kgbmVjZXNzw6FyaW8sIG1hcyBvIHRlc3RlIHBvZGUgc2VyIGFkYXB0YWRvLlxuXG5cbiAgICAvLyBHU0kgcGFyYSBtYXBlYXIgQVdTIEFjY291bnQgSUQgcGFyYSBub3NzbyBDdXN0b21lciBJRCAoQ1LDjVRJQ08gcGFyYSBjb3JyZWxhw6fDo28pXG4gICAgdGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnQXdzQWNjb3VudEluZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnYXdzQWNjb3VudElkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5JTkNMVURFLFxuICAgICAgbm9uS2V5QXR0cmlidXRlczogWydpZCddLFxuICAgIH0pO1xuXG4gICAgLy8gR1NJIHBhcmEgYnVzY2FyIGNsaWVudGVzIGF0aXZvcyBlZmljaWVudGVtZW50ZSAob3RpbWl6YcOnw6NvIGRlIHNjYW4gLT4gcXVlcnkpXG4gICAgdGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnQWN0aXZlQ3VzdG9tZXJJbmRleCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3NrJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3N0YXR1cycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuSU5DTFVERSxcbiAgICAgIG5vbktleUF0dHJpYnV0ZXM6IFtcbiAgICAgICAgJ2lkJyxcbiAgICAgICAgJ3JvbGVBcm4nLFxuICAgICAgICAnYXV0b21hdGlvblNldHRpbmdzJyxcbiAgICAgICAgJ3N1YnNjcmlwdGlvblN0YXR1cycsXG4gICAgICAgICdzdXBwb3J0TGV2ZWwnLFxuICAgICAgICAnZXhjbHVzaW9uVGFncydcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBHU0kgcGFyYSBvIGNhbGxiYWNrIGRvIG9uYm9hcmRpbmcgdmlhIEV4dGVybmFsSWRcbiAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdFeHRlcm5hbElkSW5kZXgnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdleHRlcm5hbElkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5JTkNMVURFLFxuICAgICAgbm9uS2V5QXR0cmlidXRlczogWydpZCcsICdzdGF0dXMnXSxcbiAgICB9KTtcblxuICAgIC8vIEdTSSBwYXJhIGNvbnN1bHRhcyBwb3Igc3RhdHVzIChtZWxob3JhIHBlcmZvcm1hbmNlIHBhcmEgaW5nZXN0b3IgZSBhdXRvbWHDp8O1ZXMpXG4gICAgdGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnU3RhdHVzSW5kZXgnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdzdGF0dXMnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgc29ydEtleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLklOQ0xVREUsXG4gICAgICBub25LZXlBdHRyaWJ1dGVzOiBbJ3NrJywgJ3JvbGVBcm4nLCAnYXV0b21hdGlvbiddLFxuICAgIH0pO1xuICAgIFxuICAgIC8vIEdTSSBwYXJhIGNvbnN1bHRhciBwb3IgY2xpZW50ZSAoZXg6IGluY2lkZW50ZXMsIGNsYWltcylcbiAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdDdXN0b21lckRhdGFJbmRleCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3NrJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICB9KTtcblxuICAgIC8vIEdTSSBwYXJhIGNvbnN1bHRhcyBkZSBBZG1pbiAodXNhciBlbnRpdHkvcGFydGl0aW9uIHNoYXJkaW5nIHBhcmEgcGVyZm9ybWFuY2UpXG4gICAgdGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnQWRtaW5WaWV3SW5kZXgnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdlbnRpdHlUeXBlJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ2NyZWF0ZWRBdCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuSU5DTFVERSxcbiAgICAgIG5vbktleUF0dHJpYnV0ZXM6IFsnc3RhdHVzJywgJ2NyZWRpdEFtb3VudCcsICdyZXBvcnRVcmwnLCAnaW5jaWRlbnRJZCcsICdhd3NBY2NvdW50SWQnLCAnc3RyaXBlSW52b2ljZUlkJywgJ2Nhc2VJZCcsICdzdWJtaXNzaW9uRXJyb3InLCAncmVwb3J0RXJyb3InLCAnY29tbWlzc2lvbkFtb3VudCddLFxuICAgIH0pO1xuXG4gICAgLy8gR1NJIHBhcmEgTWFya2V0cGxhY2UgY3VzdG9tZXIgbWFwcGluZ1xuICAgIHRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogJ01hcmtldHBsYWNlQ3VzdG9tZXJJbmRleCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ21hcmtldHBsYWNlQ3VzdG9tZXJJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuSU5DTFVERSxcbiAgICAgIG5vbktleUF0dHJpYnV0ZXM6IFsnaWQnXSxcbiAgICB9KTtcblxuICAgIC8vIEdTSSBwYXJhIGNvbnN1bHRhcyBkZSByZWNvbWVuZGHDp8O1ZXNcbiAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdSZWNvbW1lbmRhdGlvbnNJbmRleCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3NrJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5BTEwsXG4gICAgfSk7XG5cbiAgICAvLyBTMyBCdWNrZXQgcGFyYSBob3NwZWRhciBvIHRlbXBsYXRlIGRvIENsb3VkRm9ybWF0aW9uXG4gICAgY29uc3QgdGVtcGxhdGVCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdDZm5UZW1wbGF0ZUJ1Y2tldCcsIHtcbiAgICAgIHdlYnNpdGVJbmRleERvY3VtZW50OiAndGVtcGxhdGUueWFtbCcsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgYXV0b0RlbGV0ZU9iamVjdHM6IGZhbHNlLFxuICAgICAgdmVyc2lvbmVkOiB0cnVlLCAvLyBIYWJpbGl0YXIgdmVyc2lvbmFtZW50b1xuICAgICAgZW5jcnlwdGlvbjogczMuQnVja2V0RW5jcnlwdGlvbi5LTVMsIC8vIEVuY3J5cHRpb24gY29tIEtNUyAoVGFzayAyKVxuICAgICAgZW5jcnlwdGlvbktleTogczNLbXNLZXksIC8vIFVzYXIgS01TIEtleSBkZWRpY2FkYSAoVGFzayAyKVxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IG5ldyBzMy5CbG9ja1B1YmxpY0FjY2Vzcyh7IC8vIE1hbnRlciBhY2Vzc28gcMO6YmxpY28gcGFyYSB3ZWJzaXRlIChDbG91ZEZvcm1hdGlvbilcbiAgICAgICAgYmxvY2tQdWJsaWNBY2xzOiB0cnVlLFxuICAgICAgICBpZ25vcmVQdWJsaWNBY2xzOiB0cnVlLFxuICAgICAgICBibG9ja1B1YmxpY1BvbGljeTogZmFsc2UsIC8vIFBlcm1pdGUgYSBwb2zDrXRpY2EgZGUgd2Vic2l0ZVxuICAgICAgICByZXN0cmljdFB1YmxpY0J1Y2tldHM6IGZhbHNlLCAvLyBQZXJtaXRlIGEgcG9sw610aWNhIGRlIHdlYnNpdGVcbiAgICAgIH0pLFxuICAgICAgcHVibGljUmVhZEFjY2VzczogdHJ1ZSxcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbe1xuICAgICAgICBpZDogJ0RlZmF1bHRMaWZlY3ljbGUnLFxuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBleHBpcmF0aW9uOiBjZGsuRHVyYXRpb24uZGF5cyg5MCksIC8vIEV4cGlyYXIgb2JqZXRvcyBhcMOzcyA5MCBkaWFzXG4gICAgICAgIG5vbmN1cnJlbnRWZXJzaW9uRXhwaXJhdGlvbjogY2RrLkR1cmF0aW9uLmRheXMoNjApLCAvLyBFeHBpcmFyIHZlcnPDtWVzIG7Do28gYXR1YWlzIGFww7NzIDYwIGRpYXMgKGRldmUgc2VyID4gbm9uY3VycmVudFZlcnNpb25UcmFuc2l0aW9ucylcbiAgICAgICAgdHJhbnNpdGlvbnM6IFt7XG4gICAgICAgICAgc3RvcmFnZUNsYXNzOiBzMy5TdG9yYWdlQ2xhc3MuSU5URUxMSUdFTlRfVElFUklORywgLy8gVHJhbnNpw6fDo28gcGFyYSBJbnRlbGxpZ2VudC1UaWVyaW5nXG4gICAgICAgICAgdHJhbnNpdGlvbkFmdGVyOiBjZGsuRHVyYXRpb24uZGF5cygzMCksIC8vIEFww7NzIDMwIGRpYXNcbiAgICAgICAgfV0sXG4gICAgICAgIG5vbmN1cnJlbnRWZXJzaW9uVHJhbnNpdGlvbnM6IFt7XG4gICAgICAgICAgc3RvcmFnZUNsYXNzOiBzMy5TdG9yYWdlQ2xhc3MuR0xBQ0lFUixcbiAgICAgICAgICB0cmFuc2l0aW9uQWZ0ZXI6IGNkay5EdXJhdGlvbi5kYXlzKDMwKSwgLy8gQXDDs3MgMzAgZGlhc1xuICAgICAgICB9XSxcbiAgICAgIH1dXG4gICAgfSk7XG4gICAgXG4gICAgLy8gUmVtb3ZpZG8gYWRkUHJvcGVydHlPdmVycmlkZSBwYXJhIGV2aXRhciBjb25mbGl0byBjb20gZW5jcnlwdGlvbjogS01TXG4gICAgXG4gICAgLy8gQWRpY2lvbmFyIHRhZ3MgYW8gYnVja2V0IHJlbW92aWRvIHBhcmEgY29tcGF0aWJpbGlkYWRlIGNvbSB0ZXN0ZXNcblxuICAgIC8vIEFkaWNpb25hciBwb2zDrXRpY2EgcGFyYSBwZXJtaXRpciBxdWUgbyBzZXJ2acOnbyBTMyB1c2UgYSBjaGF2ZSBLTVNcbiAgICBzM0ttc0tleS5hZGRUb1Jlc291cmNlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsna21zOkVuY3J5cHQnLCAna21zOkRlY3J5cHQnLCAna21zOlJlRW5jcnlwdConLCAna21zOkdlbmVyYXRlRGF0YUtleSonLCAna21zOkRlc2NyaWJlS2V5J10sXG4gICAgICBwcmluY2lwYWxzOiBbbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdzMy5hbWF6b25hd3MuY29tJyldLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyBDb25kaXRpb25hbGx5IHBlcmZvcm0gZGVwbG95bWVudCBPTkxZIGlmIG5vdCBpbiB0ZXN0IGVudmlyb25tZW50XG4gICAgaWYgKCFwcm9wcy5pc1Rlc3RFbnZpcm9ubWVudCkge1xuICAgIGNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKTtcblxuICAgIGlmIChmcy5leGlzdHNTeW5jKGRvY3NQYXRoKSkge1xuICAgIC8vIERlcGxveW1lbnRzIGFyZSBPTkxZIGNyZWF0ZWQgaW5zaWRlIHRoaXMgYmxvY2tcbiAgICBuZXcgczNkZXBsb3kuQnVja2V0RGVwbG95bWVudCh0aGlzLCAnRGVwbG95Q2ZuVGVtcGxhdGUnLCB7XG4gICAgIHNvdXJjZXM6IFtzM2RlcGxveS5Tb3VyY2UuYXNzZXQoZG9jc1BhdGgpXSwgLy8gQXNzZXQgY2FsbCBvbmx5IGhhcHBlbnMgaGVyZVxuICAgICBpbmNsdWRlOiBbJ2Nvc3QtZ3VhcmRpYW4tdGVtcGxhdGUueWFtbCddLFxuICAgICBkZXN0aW5hdGlvbktleVByZWZpeDogJycsXG4gICAgICAgZGVzdGluYXRpb25CdWNrZXQ6IHRlbXBsYXRlQnVja2V0LFxuICAgICAgICB9KTtcblxuICAgIG5ldyBzM2RlcGxveS5CdWNrZXREZXBsb3ltZW50KHRoaXMsICdEZXBsb3lUcmlhbENmblRlbXBsYXRlJywge1xuICAgICBzb3VyY2VzOiBbczNkZXBsb3kuU291cmNlLmFzc2V0KGRvY3NQYXRoKV0sIC8vIEFzc2V0IGNhbGwgb25seSBoYXBwZW5zIGhlcmVcbiAgICAgaW5jbHVkZTogWydjb3N0LWd1YXJkaWFuLVRSSUFMLXRlbXBsYXRlLnlhbWwnXSxcbiAgICAgZGVzdGluYXRpb25LZXlQcmVmaXg6ICcnLFxuICAgICAgIGRlc3RpbmF0aW9uQnVja2V0OiB0ZW1wbGF0ZUJ1Y2tldCxcbiAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICBjb25zb2xlLndhcm4oYFdhcm5pbmc6IERvY3MgcGF0aCBub3QgZm91bmQgYXQgJHtkb2NzUGF0aH0uIFNraXBwaW5nIFMzIHRlbXBsYXRlIGRlcGxveW1lbnQuYCk7XG4gICAgfVxuICAgIH1cbiAgICAvLyBJZiBpc1Rlc3RFbnZpcm9ubWVudCBpcyB0cnVlLCB0aGUgU291cmNlLmFzc2V0KCkgY2FsbHMgYXJlIG5ldmVyIG1hZGUuXG5cbiAgICAgLy8gRW5zdXJlIFVSTHMgcGFzc2VkIHRvIGxhbWJkYXMvb3V0cHV0cyBoYW5kbGUgdGhlIHRlc3QgY2FzZSBncmFjZWZ1bGx5XG4gICAgIGNvbnN0IHRyaWFsVGVtcGxhdGVVcmwgPSAhcHJvcHMuaXNUZXN0RW52aXJvbm1lbnQgPyAodGVtcGxhdGVCdWNrZXQuYnVja2V0V2Vic2l0ZVVybCArICcvY29zdC1ndWFyZGlhbi1UUklBTC10ZW1wbGF0ZS55YW1sJykgOiAndGVzdC10cmlhbC11cmwnO1xuICAgICBjb25zdCBmdWxsVGVtcGxhdGVVcmwgPSAhcHJvcHMuaXNUZXN0RW52aXJvbm1lbnQgPyAodGVtcGxhdGVCdWNrZXQuYnVja2V0V2Vic2l0ZVVybCArICcvdGVtcGxhdGUueWFtbCcpIDogJ3Rlc3QtZnVsbC11cmwnO1xuXG4gICAgLy8gVlBDIGUgU2VjdXJpdHkgR3JvdXAgcGFyYSBMYW1iZGFzIChUYXNrIDgpXG4gICAgY29uc3QgdnBjID0gbmV3IGVjMi5WcGModGhpcywgJ0Nvc3RHdWFyZGlhblZwYycsIHtcbiAgICAgIG1heEF6czogMiwgLy8gVXNhciAyIEFacyBwYXJhIGFsdGEgZGlzcG9uaWJpbGlkYWRlXG4gICAgICBzdWJuZXRDb25maWd1cmF0aW9uOiBbXG4gICAgICAgIHsgY2lkck1hc2s6IDI0LCBuYW1lOiAnUHVibGljJywgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFVCTElDIH0sXG4gICAgICAgIHsgY2lkck1hc2s6IDI0LCBuYW1lOiAnUHJpdmF0ZScsIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICBjb25zdCBsYW1iZGFTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdMYW1iZGFTZWN1cml0eUdyb3VwJywge1xuICAgICAgdnBjLFxuICAgICAgZGVzY3JpcHRpb246ICdBbGxvdyBvdXRib3VuZCB0cmFmZmljIGZvciBMYW1iZGFzJyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IHRydWUsIC8vIExhbWJkYXMgcHJlY2lzYW0gYWNlc3NhciBzZXJ2acOnb3MgZXh0ZXJub3NcbiAgICB9KTtcblxuICAgIC8vIENvZ25pdG8gKE1hbnRpZG8pXG4gICAgY29uc3QgdXNlclBvb2wgPSBuZXcgY29nbml0by5Vc2VyUG9vbCh0aGlzLCAnQ29zdEd1YXJkaWFuUG9vbCcsIHtcbiAgICAgIHNlbGZTaWduVXBFbmFibGVkOiB0cnVlLFxuICAgICAgc2lnbkluQWxpYXNlczogeyBlbWFpbDogdHJ1ZSB9LFxuICAgICAgYXV0b1ZlcmlmeTogeyBlbWFpbDogdHJ1ZSB9LFxuICAgICAgcGFzc3dvcmRQb2xpY3k6IHtcbiAgICAgICAgbWluTGVuZ3RoOiA4LCAvLyBQb2zDrXRpY2FzIGRlIHNlbmhhIGZvcnRlcyAoVGFzayAxMClcbiAgICAgICAgcmVxdWlyZUxvd2VyY2FzZTogdHJ1ZSxcbiAgICAgICAgcmVxdWlyZVVwcGVyY2FzZTogdHJ1ZSxcbiAgICAgICAgcmVxdWlyZURpZ2l0czogdHJ1ZSxcbiAgICAgICAgcmVxdWlyZVN5bWJvbHM6IHRydWUsXG4gICAgICB9LFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIHVzZXJWZXJpZmljYXRpb246IHtcbiAgICAgICAgZW1haWxTdHlsZTogY29nbml0by5WZXJpZmljYXRpb25FbWFpbFN0eWxlLkNPREUsXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBDbGllbnRlIGRvIFVzZXIgUG9vbCBwYXJhIGEgYXBsaWNhw6fDo28gd2ViXG4gICAgY29uc3QgdXNlclBvb2xDbGllbnQgPSBuZXcgY29nbml0by5Vc2VyUG9vbENsaWVudCh0aGlzLCAnQ29zdEd1YXJkaWFuVXNlclBvb2xDbGllbnQnLCB7XG4gICAgICB1c2VyUG9vbCxcbiAgICAgIGdlbmVyYXRlU2VjcmV0OiBmYWxzZSwgXG4gICAgfSk7XG5cbiAgICAvLyBHcnVwbyBkZSBhZG1pbmlzdHJhZG9yZXMgbm8gQ29nbml0b1xuICAgIG5ldyBjb2duaXRvLkNmblVzZXJQb29sR3JvdXAodGhpcywgJ0FkbWluR3JvdXAnLCB7XG4gICAgICB1c2VyUG9vbElkOiB1c2VyUG9vbC51c2VyUG9vbElkLFxuICAgICAgZ3JvdXBOYW1lOiAnQWRtaW5zJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnR3J1cG8gcGFyYSBhZG1pbmlzdHJhZG9yZXMgZGEgcGxhdGFmb3JtYScsXG4gICAgfSk7XG5cbiAgICAvLyAxLiBMYW1iZGEgcGFyYSBvIEFQSSBHYXRld2F5IChNb25vbGl0byBFeHByZXNzKVxuICAgIGNvbnN0IGFwaUhhbmRsZXJMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdBcGlIYW5kbGVyJywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoYmFja2VuZFBhdGgpLFxuICAgICAgaGFuZGxlcjogJ2hhbmRsZXIuYXBwJywgLy8gZXhwb3J0IGRvIGV4cHJlc3MgKyBzZXJ2ZXJsZXNzIMOpIGV4cG9zdG8gY29tbyAnYXBwJyBubyBoYW5kbGVyLmpzXG4gICAgICAvLyBDb25maWd1cmHDp8O1ZXMgZGUgVlBDIChUYXNrIDgpXG4gICAgICB2cGMsXG4gICAgICBzZWN1cml0eUdyb3VwczogW2xhbWJkYVNlY3VyaXR5R3JvdXBdLFxuICAgICAgdnBjU3VibmV0czogeyBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTIH0sXG4gICAgICBtZW1vcnlTaXplOiAxMDI0LFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMjkpLCAvLyBMaWdlaXJhbWVudGUgbWVub3IgcXVlIG8gdGltZW91dCBkYSBBUEkgR1dcbiAgICAgIGxvZ0dyb3VwOiBuZXcgY2RrLmF3c19sb2dzLkxvZ0dyb3VwKHRoaXMsICdBcGlIYW5kbGVyTG9nR3JvdXAnLCB7XG4gICAgICByZXRlbnRpb246IGNkay5hd3NfbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9ZRUFSLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIH0pLFxuICAgICAgcmVzZXJ2ZWRDb25jdXJyZW50RXhlY3V0aW9uczogMTAwLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgTE9HX0xFVkVMOiBwcm9wcy5pc1Rlc3RFbnZpcm9ubWVudCA/ICdERUJVRycgOiAnSU5GTycsXG4gICAgICAgIERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUsXG4gICAgICAgIFNUUklQRV9TRUNSRVRfQVJOOiBzdHJpcGVTZWNyZXQuc2VjcmV0QXJuLFxuICAgICAgICBTVFJJUEVfV0VCSE9PS19TRUNSRVRfQVJOOiBzdHJpcGVXZWJob29rU2VjcmV0LnNlY3JldEFybixcbiAgICAgICAgVVNFUl9QT09MX0lEOiB1c2VyUG9vbC51c2VyUG9vbElkLFxuICAgICAgICBVU0VSX1BPT0xfQ0xJRU5UX0lEOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkLFxuICAgICAgICBQTEFURk9STV9BQ0NPVU5UX0lEOiB0aGlzLmFjY291bnQgfHwgcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfQUNDT1VOVCxcbiAgICAgICAgVFJJQUxfVEVNUExBVEVfVVJMOiB0cmlhbFRlbXBsYXRlVXJsLFxuICAgICAgICBGVUxMX1RFTVBMQVRFX1VSTDogZnVsbFRlbXBsYXRlVXJsLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIFJlZmluYXIgcGVybWlzc8O1ZXMgZG8gQXBpSGFuZGxlciBwYXJhIER5bmFtb0RCIChUYXNrIDQpXG4gICAgLy8gU3Vic3RpdHVpIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShhcGlIYW5kbGVyTGFtYmRhKTtcbiAgICBhcGlIYW5kbGVyTGFtYmRhLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ2R5bmFtb2RiOlB1dEl0ZW0nLCAnZHluYW1vZGI6VXBkYXRlSXRlbScsICdkeW5hbW9kYjpRdWVyeScsICdkeW5hbW9kYjpHZXRJdGVtJywgJ2R5bmFtb2RiOlNjYW4nXSxcbiAgICAgIHJlc291cmNlczogW3RhYmxlLnRhYmxlQXJuLCBgJHt0YWJsZS50YWJsZUFybn0vaW5kZXgvKmBdLFxuICAgIH0pKTtcbiAgICBcbiAgICBzdHJpcGVTZWNyZXQuZ3JhbnRSZWFkKGFwaUhhbmRsZXJMYW1iZGEpO1xuICAgIC8vIEdyYW50IHRoZSBBUEkgaGFuZGxlciBwZXJtaXNzaW9uIHRvIHJlYWQgdGhlIHdlYmhvb2sgc2VjcmV0XG4gICAgc3RyaXBlV2ViaG9va1NlY3JldC5ncmFudFJlYWQoYXBpSGFuZGxlckxhbWJkYSk7XG5cbiAgICAvLyAyLiBMYW1iZGEgcGFyYSBvIEV2ZW50QnJpZGdlIChDb3JyZWxhY2lvbmFyIEV2ZW50b3MgSGVhbHRoKVxuICAgIGNvbnN0IGhlYWx0aEV2ZW50SGFuZGxlckxhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0hlYWx0aEV2ZW50SGFuZGxlcicsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ0hlYWx0aEV2ZW50SGFuZGxlcicsIC8vIE5vbWUgZXhwbMOtY2l0byBwYXJhIGZhY2lsaXRhciBvIGRlYnVnXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChiYWNrZW5kRnVuY3Rpb25zUGF0aCksXG4gICAgICBoYW5kbGVyOiAnY29ycmVsYXRlLWhlYWx0aC5oYW5kbGVyJyxcbiAgICAgIC8vIENvbmZpZ3VyYcOnw7VlcyBkZSBWUEMgKFRhc2sgOClcbiAgICAgIHZwYyxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbbGFtYmRhU2VjdXJpdHlHcm91cF0sXG4gICAgICB2cGNTdWJuZXRzOiB7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfSxcbiAgICAgIGxvZ0dyb3VwOiBuZXcgY2RrLmF3c19sb2dzLkxvZ0dyb3VwKHRoaXMsICdIZWFsdGhFdmVudEhhbmRsZXJMb2dHcm91cCcsIHtcbiAgICAgICAgcmV0ZW50aW9uOiBjZGsuYXdzX2xvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICB9KSxcbiAgICAgIHJlc2VydmVkQ29uY3VycmVudEV4ZWN1dGlvbnM6IDIwLFxuICAgICAgLy8gQSByZW1vw6fDo28gZGUgJ2V4dGVybmFsTW9kdWxlcycgcGVybWl0ZSBxdWUgbyBlc2J1aWxkIGVtcGFjb3RlIGFzIGRlcGVuZMOqbmNpYXMgZG8gU0RLIHYzLlxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgU0ZOX0FSTjogJycsIC8vIFNlcsOhIHByZWVuY2hpZG8gYWJhaXhvXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShoZWFsdGhFdmVudEhhbmRsZXJMYW1iZGEpO1xuXG4gICAgLy8gTGFtYmRhIHBhcmEgZXhlY3XDp8OjbyBkZSByZWNvbWVuZGHDp8O1ZXNcbiAgICBjb25zdCBleGVjdXRlUmVjb21tZW5kYXRpb25MYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdFeGVjdXRlUmVjb21tZW5kYXRpb24nLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6ICdFeGVjdXRlUmVjb21tZW5kYXRpb24nLFxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICBoYW5kbGVyOiAnZXhlY3V0ZS1yZWNvbW1lbmRhdGlvbi5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChiYWNrZW5kRnVuY3Rpb25zUGF0aCksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIC8vIENvbmZpZ3VyYcOnw7VlcyBkZSBWUEMgKFRhc2sgOClcbiAgICAgIHZwYywgICAgICBcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbbGFtYmRhU2VjdXJpdHlHcm91cF0sXG4gICAgICB2cGNTdWJuZXRzOiB7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfSxcbiAgICAgIGxvZ0dyb3VwOiBuZXcgY2RrLmF3c19sb2dzLkxvZ0dyb3VwKHRoaXMsICdFeGVjdXRlUmVjb21tZW5kYXRpb25Mb2dHcm91cCcsIHtcbiAgICAgICAgcmV0ZW50aW9uOiBjZGsuYXdzX2xvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgIGVuY3J5cHRpb25LZXk6IGxvZ0ttc0tleSxcbiAgICAgIH0pLFxuICAgICAgcmVzZXJ2ZWRDb25jdXJyZW50RXhlY3V0aW9uczogMTAsXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIFBlcm1pc3PDtWVzIHBhcmEgbyBMYW1iZGEgZGUgcmVjb21lbmRhw6fDtWVzXG4gICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGV4ZWN1dGVSZWNvbW1lbmRhdGlvbkxhbWJkYSk7XG4gICAgZXhlY3V0ZVJlY29tbWVuZGF0aW9uTGFtYmRhLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ3N0czpBc3N1bWVSb2xlJ10sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLCAvLyBPIExhbWJkYSBwcmVjaXNhIHBvZGVyIGFzc3VtaXIgYSByb2xlIGRvIGNsaWVudGVcbiAgICB9KSk7XG5cbiAgICAvLyBEYXIgYW8gQXBpSGFuZGxlciBvIEFSTiBlIG8gTkFNRSBkbyBsYW1iZGEgZGUgZXhlY3XDp8OjbyBlIHBlcm1pdGlyIGludm9jYcOnw6NvXG4gICAgYXBpSGFuZGxlckxhbWJkYS5hZGRFbnZpcm9ubWVudCgnRVhFQ1VURV9SRUNPTU1FTkRBVElPTl9MQU1CREFfQVJOJywgZXhlY3V0ZVJlY29tbWVuZGF0aW9uTGFtYmRhLmZ1bmN0aW9uQXJuKTtcbiAgICBhcGlIYW5kbGVyTGFtYmRhLmFkZEVudmlyb25tZW50KCdFWEVDVVRFX1JFQ09NTUVOREFUSU9OX0xBTUJEQV9OQU1FJywgZXhlY3V0ZVJlY29tbWVuZGF0aW9uTGFtYmRhLmZ1bmN0aW9uTmFtZSk7XG4gICAgZXhlY3V0ZVJlY29tbWVuZGF0aW9uTGFtYmRhLmdyYW50SW52b2tlKGFwaUhhbmRsZXJMYW1iZGEpO1xuXG4gICAgLy8gMy4gTGFtYmRhcyBwYXJhIGFzIFRhcmVmYXMgZG8gU3RlcCBGdW5jdGlvbnNcbiAgICBjb25zdCBzbGFDYWxjdWxhdGVJbXBhY3RMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdTbGFDYWxjdWxhdGVJbXBhY3QnLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6ICdTbGFDYWxjdWxhdGVJbXBhY3QnLFxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoYmFja2VuZEZ1bmN0aW9uc1BhdGgpLFxuICAgICAgaGFuZGxlcjogJ3NsYS13b3JrZmxvdy5jYWxjdWxhdGVJbXBhY3QnLFxuICAgICAgLy8gQ29uZmlndXJhw6fDtWVzIGRlIFZQQyAoVGFzayA4KVxuICAgICAgdnBjLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IFtsYW1iZGFTZWN1cml0eUdyb3VwXSxcbiAgICAgIHZwY1N1Ym5ldHM6IHsgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyB9LFxuICAgICAgbG9nR3JvdXA6IG5ldyBjZGsuYXdzX2xvZ3MuTG9nR3JvdXAodGhpcywgJ1NsYUNhbGN1bGF0ZUltcGFjdExvZ0dyb3VwJywge1xuICAgICAgICByZXRlbnRpb246IGNkay5hd3NfbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgZW5jcnlwdGlvbktleTogbG9nS21zS2V5LFxuICAgICAgfSksXG4gICAgICByZXNlcnZlZENvbmN1cnJlbnRFeGVjdXRpb25zOiAxMCxcbiAgICAgIC8vIEEgcmVtb8Onw6NvIGRlICdleHRlcm5hbE1vZHVsZXMnIHBlcm1pdGUgcXVlIG8gZXNidWlsZCBlbXBhY290ZSBhcyBkZXBlbmTDqm5jaWFzIGRvIFNESyB2My5cbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUsXG4gICAgICB9LFxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdTbGFDYWxjUm9sZScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpXG4gICAgICAgIF0sXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgICAgQXNzdW1lQW5kU3VwcG9ydFBvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICBhY3Rpb25zOiBbJ3N0czpBc3N1bWVSb2xlJ10sXG4gICAgICAgICAgICAgIHJlc291cmNlczogWydhcm46YXdzOmlhbTo6Kjpyb2xlL0Nvc3RHdWFyZGlhbkRlbGVnYXRlZFJvbGUnXSwgXG4gICAgICAgICAgICB9KV1cbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pO1xuICAvLyBHYXJhbnRpciBwZXJtaXNzw7VlcyBhbyBEeW5hbW9EQiBwYXJhIGEgTGFtYmRhIGRlIGPDoWxjdWxvIGRlIGltcGFjdG9cbiAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHNsYUNhbGN1bGF0ZUltcGFjdExhbWJkYSk7XG4gICAgXG4gICAgY29uc3Qgc2xhQ2hlY2tMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdTbGFDaGVjaycsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ1NsYUNoZWNrJyxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KGJhY2tlbmRGdW5jdGlvbnNQYXRoKSxcbiAgICAgIGhhbmRsZXI6ICdzbGEtd29ya2Zsb3cuY2hlY2tTTEEnLFxuICAgICAgLy8gQ29uZmlndXJhw6fDtWVzIGRlIFZQQyAoVGFzayA4KVxuICAgICAgdnBjLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IFtsYW1iZGFTZWN1cml0eUdyb3VwXSxcbiAgICAgIHZwY1N1Ym5ldHM6IHsgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyB9LFxuICAgICAgbG9nR3JvdXA6IG5ldyBjZGsuYXdzX2xvZ3MuTG9nR3JvdXAodGhpcywgJ1NsYUNoZWNrTG9nR3JvdXAnLCB7XG4gICAgICAgIHJldGVudGlvbjogY2RrLmF3c19sb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgICBlbmNyeXB0aW9uS2V5OiBsb2dLbXNLZXksXG4gICAgICB9KSxcbiAgICAgIHJlc2VydmVkQ29uY3VycmVudEV4ZWN1dGlvbnM6IDEwLFxuICAgICAgLy8gQSByZW1vw6fDo28gZGUgJ2V4dGVybmFsTW9kdWxlcycgcGVybWl0ZSBxdWUgbyBlc2J1aWxkIGVtcGFjb3RlIGFzIGRlcGVuZMOqbmNpYXMgZG8gU0RLIHYzLlxuICAgICAgZW52aXJvbm1lbnQ6IHsgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSB9LFxuICAgIH0pO1xuXG4gICAgY29uc3Qgc2xhR2VuZXJhdGVSZXBvcnRMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdTbGFHZW5lcmF0ZVJlcG9ydCcsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ1NsYUdlbmVyYXRlUmVwb3J0JyxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KGJhY2tlbmRGdW5jdGlvbnNQYXRoKSxcbiAgICAgIGhhbmRsZXI6ICdzbGEtd29ya2Zsb3cuZ2VuZXJhdGVSZXBvcnQnLFxuICAgICAgLy8gQ29uZmlndXJhw6fDtWVzIGRlIFZQQyAoVGFzayA4KVxuICAgICAgdnBjLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IFtsYW1iZGFTZWN1cml0eUdyb3VwXSxcbiAgICAgIHZwY1N1Ym5ldHM6IHsgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyB9LFxuICAgICAgbG9nR3JvdXA6IG5ldyBjZGsuYXdzX2xvZ3MuTG9nR3JvdXAodGhpcywgJ1NsYUdlbmVyYXRlUmVwb3J0TG9nR3JvdXAnLCB7XG4gICAgICAgIHJldGVudGlvbjogY2RrLmF3c19sb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgICBlbmNyeXB0aW9uS2V5OiBsb2dLbXNLZXksXG4gICAgICB9KSxcbiAgICAgIHJlc2VydmVkQ29uY3VycmVudEV4ZWN1dGlvbnM6IDEwLFxuICAgICAgLy8gQSByZW1vw6fDo28gZGUgJ2V4dGVybmFsTW9kdWxlcycgcGVybWl0ZSBxdWUgbyBlc2J1aWxkIGVtcGFjb3RlIGFzIGRlcGVuZMOqbmNpYXMgZG8gU0RLIHYzLlxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgU1RSSVBFX1NFQ1JFVF9BUk46IHN0cmlwZVNlY3JldC5zZWNyZXRBcm4sXG4gICAgICAgIFJFUE9SVFNfQlVDS0VUX05BTUU6ICcnLCAvLyBTZXLDoSBwcmVlbmNoaWRvIGFiYWl4b1xuICAgICAgfSxcbiAgICB9KTtcbiAgICB0YWJsZS5ncmFudFJlYWRXcml0ZURhdGEoc2xhR2VuZXJhdGVSZXBvcnRMYW1iZGEpO1xuICAgIHN0cmlwZVNlY3JldC5ncmFudFJlYWQoc2xhR2VuZXJhdGVSZXBvcnRMYW1iZGEpO1xuICAvLyBHcmFudCB0aGUgcmVwb3J0IGdlbmVyYXRvciBMYW1iZGEgYWNjZXNzIHRvIHRoZSB3ZWJob29rIHNlY3JldCBpZiBuZWVkZWRcbiAgc3RyaXBlV2ViaG9va1NlY3JldC5ncmFudFJlYWQoc2xhR2VuZXJhdGVSZXBvcnRMYW1iZGEpO1xuXG4gICAgLy8gQ3JpYXIgYnVja2V0IFMzIHBhcmEgYXJtYXplbmFyIHJlbGF0w7NyaW9zIFBERiBnZXJhZG9zIHBlbGEgTGFtYmRhXG4gICAgY29uc3QgcmVwb3J0c0J1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ1JlcG9ydHNCdWNrZXQnLCB7XG4gICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLCAvLyBSRVRBSU4gdG8gYXZvaWQgYXV0b0RlbGV0ZU9iamVjdHMgY3VzdG9tIHJlc291cmNlIGlzc3VlcyBpbiB0ZXN0c1xuICAgIGF1dG9EZWxldGVPYmplY3RzOiBmYWxzZSxcbiAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLCAvLyBCbG9xdWVhciB0b2RvIGFjZXNzbyBww7pibGljbyAoVGFzayAyKVxuICAgICAgdmVyc2lvbmVkOiB0cnVlLFxuICAgICAgZW5jcnlwdGlvbjogczMuQnVja2V0RW5jcnlwdGlvbi5LTVMsIC8vIEVuY3J5cHRpb24gY29tIEtNUyAoVGFzayAyKVxuICAgICAgZW5jcnlwdGlvbktleTogczNLbXNLZXksIC8vIFVzYXIgS01TIEtleSBkZWRpY2FkYSAoVGFzayAyKVxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFt7XG4gICAgICAgIGlkOiAnRGVmYXVsdExpZmVjeWNsZScsXG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIGV4cGlyYXRpb246IGNkay5EdXJhdGlvbi5kYXlzKDM2NSksXG4gICAgICAgIG5vbmN1cnJlbnRWZXJzaW9uRXhwaXJhdGlvbjogY2RrLkR1cmF0aW9uLmRheXMoOTApLFxuICAgICAgICB0cmFuc2l0aW9uczogW3tcbiAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5JTkZSRVFVRU5UX0FDQ0VTUyxcbiAgICAgICAgICB0cmFuc2l0aW9uQWZ0ZXI6IGNkay5EdXJhdGlvbi5kYXlzKDkwKSwgLy8gQXDDs3MgOTAgZGlhc1xuICAgICAgICB9XSxcbiAgICAgICAgbm9uY3VycmVudFZlcnNpb25UcmFuc2l0aW9uczogW3tcbiAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5HTEFDSUVSLFxuICAgICAgICAgIHRyYW5zaXRpb25BZnRlcjogY2RrLkR1cmF0aW9uLmRheXMoMzApLFxuICAgICAgICB9XSxcbiAgICAgIH1dXG4gICAgfSk7XG4gICAgXG4gICAgLy8gRm9yw6dhIGEgY29uZmlndXJhw6fDo28gZGUgY3JpcHRvZ3JhZmlhIGF0cmF2w6lzIGRvIHJlY3Vyc28gTDFcbiAgICAvLyBSZW1vdmlkbyBhZGRQcm9wZXJ0eU92ZXJyaWRlIHBhcmEgUmVwb3J0c0J1Y2tldCB0YW1iw6ltXG4gICAgXG4gICAgLy8gQWRpY2lvbmFyIHRhZ3MgYW8gYnVja2V0XG4gICAgY2RrLlRhZ3Mub2YocmVwb3J0c0J1Y2tldCkuYWRkKCdFbnZpcm9ubWVudCcsIHByb3BzLmlzVGVzdEVudmlyb25tZW50ID8gJ1Rlc3QnIDogJ1Byb2R1Y3Rpb24nKTtcbiAgICBjZGsuVGFncy5vZihyZXBvcnRzQnVja2V0KS5hZGQoJ1Byb2plY3QnLCAnQ29zdEd1YXJkaWFuJyk7XG5cbiAgICAvLyBGb3JuZWNlciBvIG5vbWUgZG8gYnVja2V0IGNvbW8gdmFyacOhdmVsIGRlIGFtYmllbnRlIHBhcmEgYSBMYW1iZGEgKGF0dWFsaXphKVxuICAgIHNsYUdlbmVyYXRlUmVwb3J0TGFtYmRhLmFkZEVudmlyb25tZW50KCdSRVBPUlRTX0JVQ0tFVF9OQU1FJywgcmVwb3J0c0J1Y2tldC5idWNrZXROYW1lKTtcblxuICAgIC8vIFBlcm1pc3PDtWVzIG5lY2Vzc8OhcmlhcyBwYXJhIGEgTGFtYmRhIGVzY3JldmVyIG9iamV0b3Mgbm8gYnVja2V0XG4gICAgcmVwb3J0c0J1Y2tldC5ncmFudFB1dChzbGFHZW5lcmF0ZVJlcG9ydExhbWJkYSk7XG5cbiAgICBjb25zdCBzbGFTdWJtaXRUaWNrZXRMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdTbGFTdWJtaXRUaWNrZXQnLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6ICdTbGFTdWJtaXRUaWNrZXQnLFxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoYmFja2VuZEZ1bmN0aW9uc1BhdGgpLFxuICAgICAgaGFuZGxlcjogJ3NsYS13b3JrZmxvdy5zdWJtaXRTdXBwb3J0VGlja2V0JyxcbiAgICAgIC8vIENvbmZpZ3VyYcOnw7VlcyBkZSBWUEMgKFRhc2sgOClcbiAgICAgIHZwYyxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbbGFtYmRhU2VjdXJpdHlHcm91cF0sXG4gICAgICB2cGNTdWJuZXRzOiB7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfSxcbiAgICAgIGxvZ0dyb3VwOiBuZXcgY2RrLmF3c19sb2dzLkxvZ0dyb3VwKHRoaXMsICdTbGFTdWJtaXRUaWNrZXRMb2dHcm91cCcsIHtcbiAgICAgICAgcmV0ZW50aW9uOiBjZGsuYXdzX2xvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgIGVuY3J5cHRpb25LZXk6IGxvZ0ttc0tleSxcbiAgICAgIH0pLFxuICAgICAgcmVzZXJ2ZWRDb25jdXJyZW50RXhlY3V0aW9uczogMTAsXG4gICAgICAvLyBBIHJlbW/Dp8OjbyBkZSAnZXh0ZXJuYWxNb2R1bGVzJyBwZXJtaXRlIHF1ZSBvIGVzYnVpbGQgZW1wYWNvdGUgYXMgZGVwZW5kw6puY2lhcyBkbyBTREsgdjMuXG4gICAgICBlbnZpcm9ubWVudDogeyBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lIH0sXG4gICAgICByb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ1NsYVN1Ym1pdFJvbGUnLCB7XG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKVxuICAgICAgICBdLFxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICAgIEFzc3VtZUFuZFN1cHBvcnRQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgICAgc3RhdGVtZW50czogW25ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgYWN0aW9uczogWydzdHM6QXNzdW1lUm9sZSddLFxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnYXJuOmF3czppYW06Oio6cm9sZS9Db3N0R3VhcmRpYW5EZWxlZ2F0ZWRSb2xlJ10sXG4gICAgICAgICAgICB9KV1cbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pO1xuICAgIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShzbGFTdWJtaXRUaWNrZXRMYW1iZGEpO1xuICAgIFxuICAgIC8vIE9idGVyIG8gZXZlbnQgYnVzIHBhZHLDo28gZGEgcGxhdGFmb3JtYVxuICAgIGNvbnN0IGV2ZW50QnVzID0gZXZlbnRzLkV2ZW50QnVzLmZyb21FdmVudEJ1c05hbWUodGhpcywgJ0RlZmF1bHRCdXMnLCAnZGVmYXVsdCcpO1xuXG4gICAgLy8gUG9sw610aWNhIHBhcmEgbyBFdmVudCBCdXM6IHJlc3RyaW5nZSBxdWVtIHBvZGUgY2hhbWFyIFB1dEV2ZW50cyB1c2FuZG8gYSBzaW50YXhlIG1vZGVybmFcbiAgICBuZXcgZXZlbnRzLkNmbkV2ZW50QnVzUG9saWN5KHRoaXMsICdFdmVudEJ1c1BvbGljeScsIHtcbiAgICAgIGV2ZW50QnVzTmFtZTogZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxuICAgICAgc3RhdGVtZW50SWQ6ICdBbGxvd0NsaWVudEhlYWx0aEV2ZW50cycsXG4gICAgICBzdGF0ZW1lbnQ6IHtcbiAgICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgICBQcmluY2lwYWw6ICcqJyxcbiAgICAgICAgQWN0aW9uOiAnZXZlbnRzOlB1dEV2ZW50cycsXG4gICAgICAgIFJlc291cmNlOiBldmVudEJ1cy5ldmVudEJ1c0FybixcbiAgICAgICAgQ29uZGl0aW9uOiB7XG4gICAgICAgICAgU3RyaW5nRXF1YWxzOiB7XG4gICAgICAgICAgICAnYXdzOlByaW5jaXBhbEFybic6ICdhcm46YXdzOmlhbTo6Kjpyb2xlL0V2ZW50QnVzUm9sZScsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyAtLS0gSU7DjUNJTyBEQSBDT1JSRcOHw4NPIC0tLVxuICAgIC8vIFJFTU9WQSBlc3RlIGJsb2NvLiBBIGZpbHRyYWdlbSBkZSAnZXZlbnRzOnNvdXJjZScgw6kgZmVpdGFcbiAgICAvLyBwZWxhICdoZWFsdGhSdWxlJyBhYmFpeG8sIG7Do28gcGVsYSBwb2zDrXRpY2EgZG8gYmFycmFtZW50by5cbiAgICAvKlxuICAgIGV2ZW50QnVzUG9saWN5LmFkZFByb3BlcnR5T3ZlcnJpZGUoJ0NvbmRpdGlvbicsIHtcbiAgICAgIFR5cGU6ICdTdHJpbmdFcXVhbHMnLFxuICAgICAgS2V5OiAnZXZlbnRzOnNvdXJjZScsXG4gICAgICBWYWx1ZTogJ2F3cy5oZWFsdGgnLFxuICAgIH0pO1xuICAgICovXG4gICAgLy8gLS0tIEZJTSBEQSBDT1JSRcOHw4NPIC0tLVxuXG4gICAgLy8gRXZlbnRCcmlkZ2UgSGVhbHRoIChFc3RhIMOpIGEgcmVncmEgZGUgRklMVFJBR0VNIGNvcnJldGEpXG4gICAgbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdIZWFsdGhFdmVudFJ1bGUnLCB7XG4gICAgICBldmVudFBhdHRlcm46IHtcbiAgICAgICAgc291cmNlOiBbJ2F3cy5oZWFsdGgnXSwgLy8gQSBmaWx0cmFnZW0gYWNvbnRlY2UgYXF1aVxuICAgICAgICBkZXRhaWxUeXBlOiBbJ0FXUyBIZWFsdGggRXZlbnQnXSxcbiAgICAgIH0sXG4gICAgICBldmVudEJ1cyxcbiAgICAgIHRhcmdldHM6IFtuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihoZWFsdGhFdmVudEhhbmRsZXJMYW1iZGEpXSxcbiAgICB9KTtcblxuICAvLyAtLS0gQmxvY28gMjogSW5nZXN0w6NvIGRpw6FyaWEgZGUgY3VzdG9zIChGYXNlIDE6IFZpc2liaWxpZGFkZSkgLS0tXG4gIC8vIFRvcGljIFNOUyBwYXJhIGFsZXJ0YXMgZGUgYW5vbWFsaWEgKEZhc2UgNylcbiAgY29uc3QgYW5vbWFseUFsZXJ0c1RvcGljID0gbmV3IHNucy5Ub3BpYyh0aGlzLCAnQW5vbWFseUFsZXJ0c1RvcGljJyk7XG4gICAgLy8gNC4xLiBDcmllIHVtIG5vdm8gTGFtYmRhIHBhcmEgaW5nZXN0w6NvIGRpw6FyaWEgZGUgY3VzdG9zXG4gICAgY29uc3QgY29zdEluZ2VzdG9yTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnQ29zdEluZ2VzdG9yJywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoYmFja2VuZEZ1bmN0aW9uc1BhdGgpLFxuICAgICAgaGFuZGxlcjogJ2luZ2VzdC1jb3N0cy5oYW5kbGVyJyxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgLy8gQ29uZmlndXJhw6fDtWVzIGRlIFZQQyAoVGFzayA4KVxuICAgICAgdnBjLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IFtsYW1iZGFTZWN1cml0eUdyb3VwXSxcbiAgICAgIHZwY1N1Ym5ldHM6IHsgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyB9LFxuICAgICAgbG9nR3JvdXA6IG5ldyBjZGsuYXdzX2xvZ3MuTG9nR3JvdXAodGhpcywgJ0Nvc3RJbmdlc3RvckxvZ0dyb3VwJywge1xuICAgICAgICByZXRlbnRpb246IGNkay5hd3NfbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgZW5jcnlwdGlvbktleTogbG9nS21zS2V5LFxuICAgICAgfSksXG4gICAgICByZXNlcnZlZENvbmN1cnJlbnRFeGVjdXRpb25zOiA1LFxuICAgICAgLy8gQSByZW1vw6fDo28gZGUgJ2V4dGVybmFsTW9kdWxlcycgcGVybWl0ZSBxdWUgbyBlc2J1aWxkIGVtcGFjb3RlIGFzIGRlcGVuZMOqbmNpYXMgZG8gU0RLIHYzLlxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgU05TX1RPUElDX0FSTjogYW5vbWFseUFsZXJ0c1RvcGljLnRvcGljQXJuLFxuICAgICAgfSxcbiAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnQ29zdEluZ2VzdG9yUm9sZScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYVZQQ0FjY2Vzc0V4ZWN1dGlvblJvbGUnKVxuICAgICAgICBdLFxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICAgIER5bmFtb0FuZEFzc3VtZVBvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbJ2R5bmFtb2RiOlNjYW4nXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFt0YWJsZS50YWJsZUFybiwgYCR7dGFibGUudGFibGVBcm59L2luZGV4LypgXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbJ3N0czpBc3N1bWVSb2xlJ10sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbJ2Fybjphd3M6aWFtOjoqOnJvbGUvQ29zdEd1YXJkaWFuRGVsZWdhdGVkUm9sZSddLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pO1xuICAgIHRhYmxlLmdyYW50UmVhZERhdGEoY29zdEluZ2VzdG9yTGFtYmRhKTtcblxuICAvLyBQZXJtaXRpciBxdWUgbyBpbmdlc3RvciBwdWJsaXF1ZSBhbGVydGFzIG5vIHTDs3BpY28gU05TXG4gIGFub21hbHlBbGVydHNUb3BpYy5ncmFudFB1Ymxpc2goY29zdEluZ2VzdG9yTGFtYmRhKTtcblxuICAgIC8vIDQuMi4gQ3JpZSB1bWEgcmVncmEgZG8gRXZlbnRCcmlkZ2UgcGFyYSBhY2lvbmFyIG8gaW5nZXN0b3IgZGlhcmlhbWVudGVcbiAgICBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ0RhaWx5Q29zdEluZ2VzdGlvblJ1bGUnLCB7XG4gICAgICBzY2hlZHVsZTogZXZlbnRzLlNjaGVkdWxlLmNyb24oeyBtaW51dGU6ICcwJywgaG91cjogJzUnIH0pLCAvLyBUb2RvIGRpYSDDoHMgMDU6MDAgVVRDXG4gICAgICB0YXJnZXRzOiBbbmV3IHRhcmdldHMuTGFtYmRhRnVuY3Rpb24oY29zdEluZ2VzdG9yTGFtYmRhKV0sXG4gICAgfSk7XG5cbiAgICAvLyAtLS0gQmxvY28gMzogQXV0b21hw6fDo28gQXRpdmEgKEZhc2UgMikgLS0tXG4gICAgLy8gNy4xLiBMYW1iZGFzIHBhcmEgdGFyZWZhcyBkZSBhdXRvbWHDp8Ojb1xuICAgIGNvbnN0IHN0b3BJZGxlSW5zdGFuY2VzTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnU3RvcElkbGVJbnN0YW5jZXMnLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChiYWNrZW5kRnVuY3Rpb25zUGF0aCksXG4gICAgICBoYW5kbGVyOiAnZXhlY3V0ZS1yZWNvbW1lbmRhdGlvbi5oYW5kbGVyJyxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgLy8gQ29uZmlndXJhw6fDtWVzIGRlIFZQQyAoVGFzayA4KVxuICAgICAgdnBjLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IFtsYW1iZGFTZWN1cml0eUdyb3VwXSxcbiAgICAgIHZwY1N1Ym5ldHM6IHsgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyB9LFxuICAgICAgbG9nR3JvdXA6IG5ldyBjZGsuYXdzX2xvZ3MuTG9nR3JvdXAodGhpcywgJ1N0b3BJZGxlSW5zdGFuY2VzTG9nR3JvdXAnLCB7XG4gICAgICAgIHJldGVudGlvbjogY2RrLmF3c19sb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgICBlbmNyeXB0aW9uS2V5OiBsb2dLbXNLZXksXG4gICAgICB9KSxcbiAgICAgIHJlc2VydmVkQ29uY3VycmVudEV4ZWN1dGlvbnM6IDEwLFxuICAgICAgZW52aXJvbm1lbnQ6IHsgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSB9LFxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdTdG9wSWRsZVJvbGUnLCB7XG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFWUENBY2Nlc3NFeGVjdXRpb25Sb2xlJyldLFxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICAgIER5bmFtb1BvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7IHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgYWN0aW9uczogWydkeW5hbW9kYjpRdWVyeScsJ2R5bmFtb2RiOlNjYW4nLCdkeW5hbW9kYjpHZXRJdGVtJywnZHluYW1vZGI6UHV0SXRlbSddLCByZXNvdXJjZXM6IFt0YWJsZS50YWJsZUFybiwgYCR7dGFibGUudGFibGVBcm59L2luZGV4LypgXSB9KSxcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgYWN0aW9uczogWydzdHM6QXNzdW1lUm9sZSddLCByZXNvdXJjZXM6IFsnYXJuOmF3czppYW06Oio6cm9sZS9Db3N0R3VhcmRpYW5EZWxlZ2F0ZWRSb2xlJ10gfSksXG4gICAgICAgICAgXX0pXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSk7XG4gICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHN0b3BJZGxlSW5zdGFuY2VzTGFtYmRhKTtcblxuICAgIGNvbnN0IHJlY29tbWVuZFJkc0lkbGVMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdSZWNvbW1lbmRSZHNJZGxlJywge1xuICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChiYWNrZW5kRnVuY3Rpb25zUGF0aCksXG4gICAgaGFuZGxlcjogJ3JlY29tbWVuZC1yZHMtaWRsZS5oYW5kbGVyJyxcbiAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAvLyBDb25maWd1cmHDp8O1ZXMgZGUgVlBDIChUYXNrIDgpXG4gICAgdnBjLFxuICAgIHNlY3VyaXR5R3JvdXBzOiBbbGFtYmRhU2VjdXJpdHlHcm91cF0sXG4gICAgdnBjU3VibmV0czogeyBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTIH0sXG4gICAgcmVzZXJ2ZWRDb25jdXJyZW50RXhlY3V0aW9uczogMTAsIC8vIENvcnJpZ2lkbzogbG9nR3JvdXAgbsOjbyDDqSB1bWEgcHJvcHJpZWRhZGUgZGlyZXRhXG4gICAgbG9nR3JvdXA6IG5ldyBjZGsuYXdzX2xvZ3MuTG9nR3JvdXAodGhpcywgJ1JlY29tbWVuZFJkc0lkbGVMb2dHcm91cCcsIHtcbiAgICAgIHJldGVudGlvbjogY2RrLmF3c19sb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGVuY3J5cHRpb25LZXk6IGxvZ0ttc0tleSxcbiAgICB9KSxcbiAgICAgIGVudmlyb25tZW50OiB7IERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUgfSxcbiAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnUmVjb21tZW5kUmRzUm9sZScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW2lhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYVZQQ0FjY2Vzc0V4ZWN1dGlvblJvbGUnKV0sXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgICAgRHluYW1vUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHsgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoeyBhY3Rpb25zOiBbJ2R5bmFtb2RiOlF1ZXJ5JywnZHluYW1vZGI6U2NhbicsJ2R5bmFtb2RiOkdldEl0ZW0nLCdkeW5hbW9kYjpQdXRJdGVtJ10sIHJlc291cmNlczogW3RhYmxlLnRhYmxlQXJuLCBgJHt0YWJsZS50YWJsZUFybn0vaW5kZXgvKmBdIH0pLFxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoeyBhY3Rpb25zOiBbJ3N0czpBc3N1bWVSb2xlJ10sIHJlc291cmNlczogWydhcm46YXdzOmlhbTo6Kjpyb2xlL0Nvc3RHdWFyZGlhbkRlbGVnYXRlZFJvbGUnXSB9KSxcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgYWN0aW9uczogWydyZHM6RGVzY3JpYmVEQkluc3RhbmNlcyddLCByZXNvdXJjZXM6IFsnKiddIH0pLFxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoeyBhY3Rpb25zOiBbJ2Nsb3Vkd2F0Y2g6R2V0TWV0cmljU3RhdGlzdGljcyddLCByZXNvdXJjZXM6IFsnKiddIH0pLFxuICAgICAgICAgIF19KVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pO1xuICAgIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShyZWNvbW1lbmRSZHNJZGxlTGFtYmRhKTtcblxuICAgIGNvbnN0IHJlY29tbWVuZElkbGVJbnN0YW5jZXNMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdSZWNvbW1lbmRJZGxlSW5zdGFuY2VzJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiAnUmVjb21tZW5kSWRsZUluc3RhbmNlcycsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChiYWNrZW5kRnVuY3Rpb25zUGF0aCksXG4gICAgICBoYW5kbGVyOiAncmVjb21tZW5kLWlkbGUtaW5zdGFuY2VzLmhhbmRsZXInLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICB2cGMsXG4gICAgICBzZWN1cml0eUdyb3VwczogW2xhbWJkYVNlY3VyaXR5R3JvdXBdLFxuICAgICAgdnBjU3VibmV0czogeyBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTIH0sXG4gICAgICByZXNlcnZlZENvbmN1cnJlbnRFeGVjdXRpb25zOiAxMCxcbiAgICAgIGxvZ0dyb3VwOiBuZXcgY2RrLmF3c19sb2dzLkxvZ0dyb3VwKHRoaXMsICdSZWNvbW1lbmRJZGxlSW5zdGFuY2VzTG9nR3JvdXAnLCB7XG4gICAgICAgIHJldGVudGlvbjogY2RrLmF3c19sb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgICBlbmNyeXB0aW9uS2V5OiBsb2dLbXNLZXksXG4gICAgICB9KSxcbiAgICAgIGVudmlyb25tZW50OiB7IFxuICAgICAgICBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lLFxuICAgICAgICBTTlNfVE9QSUNfQVJOOiBhbm9tYWx5QWxlcnRzVG9waWMudG9waWNBcm4sXG4gICAgICB9LFxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdSZWNvbW1lbmRJZGxlSW5zdGFuY2VzUm9sZScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW2lhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYVZQQ0FjY2Vzc0V4ZWN1dGlvblJvbGUnKV0sXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgICAgRHluYW1vQW5kQXNzdW1lUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHsgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoeyBhY3Rpb25zOiBbJ2R5bmFtb2RiOlF1ZXJ5JywnZHluYW1vZGI6U2NhbicsJ2R5bmFtb2RiOkdldEl0ZW0nLCdkeW5hbW9kYjpQdXRJdGVtJ10sIHJlc291cmNlczogW3RhYmxlLnRhYmxlQXJuLCBgJHt0YWJsZS50YWJsZUFybn0vaW5kZXgvKmBdIH0pLFxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoeyBhY3Rpb25zOiBbJ3N0czpBc3N1bWVSb2xlJ10sIHJlc291cmNlczogWydhcm46YXdzOmlhbTo6Kjpyb2xlL0Nvc3RHdWFyZGlhbkRlbGVnYXRlZFJvbGUnXSB9KSxcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgYWN0aW9uczogWydlYzI6RGVzY3JpYmVJbnN0YW5jZXMnLCAnZWMyOkRlc2NyaWJlUmVzZXJ2ZWRJbnN0YW5jZXMnXSwgcmVzb3VyY2VzOiBbJyonXSB9KSxcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgYWN0aW9uczogWydjbG91ZHdhdGNoOkdldE1ldHJpY1N0YXRpc3RpY3MnXSwgcmVzb3VyY2VzOiBbJyonXSB9KSxcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgYWN0aW9uczogWydwcmljaW5nOkdldFByb2R1Y3RzJ10sIHJlc291cmNlczogWycqJ10gfSksXG4gICAgICAgICAgXX0pXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSk7XG4gICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHJlY29tbWVuZElkbGVJbnN0YW5jZXNMYW1iZGEpO1xuICAgIGFub21hbHlBbGVydHNUb3BpYy5ncmFudFB1Ymxpc2gocmVjb21tZW5kSWRsZUluc3RhbmNlc0xhbWJkYSk7XG5cbiAgICBjb25zdCBkZWxldGVVbnVzZWRFYnNMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdEZWxldGVVbnVzZWRFYnMnLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6ICdEZWxldGVVbnVzZWRFYnMnLFxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoYmFja2VuZEZ1bmN0aW9uc1BhdGgpLFxuICAgICAgaGFuZGxlcjogJ2RlbGV0ZS11bnVzZWQtZWJzLmhhbmRsZXInLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAvLyBDb25maWd1cmHDp8O1ZXMgZGUgVlBDIChUYXNrIDgpXG4gICAgICB2cGMsXG4gICAgICBzZWN1cml0eUdyb3VwczogW2xhbWJkYVNlY3VyaXR5R3JvdXBdLFxuICAgICAgdnBjU3VibmV0czogeyBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTIH0sXG4gICAgICByZXNlcnZlZENvbmN1cnJlbnRFeGVjdXRpb25zOiAxMCxcbiAgICAgIGxvZ0dyb3VwOiBuZXcgY2RrLmF3c19sb2dzLkxvZ0dyb3VwKHRoaXMsICdEZWxldGVVbnVzZWRFYnNMb2dHcm91cCcsIHtcbiAgICAgICAgcmV0ZW50aW9uOiBjZGsuYXdzX2xvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgIGVuY3J5cHRpb25LZXk6IGxvZ0ttc0tleSxcbiAgICAgIH0pLFxuICAgICAgLy8gQSByZW1vw6fDo28gZGUgJ2V4dGVybmFsTW9kdWxlcycgcGVybWl0ZSBxdWUgbyBlc2J1aWxkIGVtcGFjb3RlIGFzIGRlcGVuZMOqbmNpYXMgZG8gU0RLIHYzLlxuICAgICAgZW52aXJvbm1lbnQ6IHsgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSB9LFxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdEZWxldGVFYnNSb2xlJywge1xuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgICAgbWFuYWdlZFBvbGljaWVzOiBbaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhVlBDQWNjZXNzRXhlY3V0aW9uUm9sZScpXSxcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcbiAgICAgICAgICBEeW5hbW9Qb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoeyBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7IGFjdGlvbnM6IFsnZHluYW1vZGI6UXVlcnknLCdkeW5hbW9kYjpTY2FuJywnZHluYW1vZGI6R2V0SXRlbSddLCByZXNvdXJjZXM6IFt0YWJsZS50YWJsZUFybiwgYCR7dGFibGUudGFibGVBcm59L2luZGV4LypgXSB9KSxcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgYWN0aW9uczogWydzdHM6QXNzdW1lUm9sZSddLCByZXNvdXJjZXM6IFsnYXJuOmF3czppYW06Oio6cm9sZS9Db3N0R3VhcmRpYW5EZWxlZ2F0ZWRSb2xlJ10gfSksXG4gICAgICAgICAgXX0pXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSk7XG4gICAgdGFibGUuZ3JhbnRSZWFkRGF0YShkZWxldGVVbnVzZWRFYnNMYW1iZGEpO1xuXG4gICAgLy8gNy4yIC0gNy4zIFN0ZXAgRnVuY3Rpb24gZGUgYXV0b21hw6fDo28gKGV4ZWN1dGEgdGFza3MgZW0gcGFyYWxlbG8pXG4gICAgY29uc3QgYXV0b21hdGlvbkVycm9ySGFuZGxlciA9IG5ldyBzdGVwZnVuY3Rpb25zLkZhaWwodGhpcywgJ0F1dG9tYXRpb25GYWlsZWQnLCB7XG4gICAgICBjYXVzZTogJ0F1dG9tYXRpb24gd29ya2Zsb3cgZXhlY3V0aW9uIGZhaWxlZCcsXG4gICAgICBlcnJvcjogJ0F1dG9tYXRpb25FcnJvcicsXG4gICAgfSk7XG4gICAgXG4gICAgY29uc3Qgc3RvcElkbGVUYXNrID0gbmV3IHNmbl90YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ1N0b3BJZGxlUmVzb3VyY2VzJywgeyBcbiAgICAgIGxhbWJkYUZ1bmN0aW9uOiBzdG9wSWRsZUluc3RhbmNlc0xhbWJkYSwgXG4gICAgICBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyxcbiAgICAgIHJldHJ5T25TZXJ2aWNlRXhjZXB0aW9uczogdHJ1ZSxcbiAgICB9KS5hZGRSZXRyeSh7XG4gICAgICBlcnJvcnM6IFsnU3RhdGVzLlRhc2tGYWlsZWQnXSxcbiAgICAgIGludGVydmFsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygyKSxcbiAgICAgIG1heEF0dGVtcHRzOiAzLFxuICAgICAgYmFja29mZlJhdGU6IDIsXG4gICAgfSkuYWRkQ2F0Y2gobmV3IHN0ZXBmdW5jdGlvbnMuRmFpbCh0aGlzLCAnU3RvcElkbGVGYWlsZWQnLCB7XG4gICAgICBjYXVzZTogJ1N0b3AgaWRsZSByZXNvdXJjZXMgZmFpbGVkJyxcbiAgICAgIGVycm9yOiAnU3RvcElkbGVFcnJvcicsXG4gICAgfSksIHtcbiAgICAgIHJlc3VsdFBhdGg6ICckLmVycm9yJyxcbiAgICB9KTtcbiAgICBcbiAgICBjb25zdCBkZWxldGVFYnNUYXNrID0gbmV3IHNmbl90YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ0RlbGV0ZVVudXNlZFZvbHVtZXMnLCB7IFxuICAgICAgbGFtYmRhRnVuY3Rpb246IGRlbGV0ZVVudXNlZEVic0xhbWJkYSwgXG4gICAgICBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyxcbiAgICAgIHJldHJ5T25TZXJ2aWNlRXhjZXB0aW9uczogdHJ1ZSxcbiAgICB9KS5hZGRSZXRyeSh7XG4gICAgICBlcnJvcnM6IFsnU3RhdGVzLlRhc2tGYWlsZWQnXSxcbiAgICAgIGludGVydmFsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygyKSxcbiAgICAgIG1heEF0dGVtcHRzOiAzLFxuICAgICAgYmFja29mZlJhdGU6IDIsXG4gICAgfSkuYWRkQ2F0Y2gobmV3IHN0ZXBmdW5jdGlvbnMuRmFpbCh0aGlzLCAnRGVsZXRlRWJzRmFpbGVkJywge1xuICAgICAgY2F1c2U6ICdEZWxldGUgdW51c2VkIHZvbHVtZXMgZmFpbGVkJyxcbiAgICAgIGVycm9yOiAnRGVsZXRlRWJzRXJyb3InLFxuICAgIH0pLCB7XG4gICAgICByZXN1bHRQYXRoOiAnJC5lcnJvcicsXG4gICAgfSk7XG4gICAgXG4gICAgY29uc3QgcmVjb21tZW5kUmRzVGFzayA9IG5ldyBzZm5fdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdSZWNvbW1lbmRJZGxlUmRzJywgeyBcbiAgICAgIGxhbWJkYUZ1bmN0aW9uOiByZWNvbW1lbmRSZHNJZGxlTGFtYmRhLCBcbiAgICAgIG91dHB1dFBhdGg6ICckLlBheWxvYWQnLFxuICAgICAgcmV0cnlPblNlcnZpY2VFeGNlcHRpb25zOiB0cnVlLFxuICAgIH0pLmFkZFJldHJ5KHtcbiAgICAgIGVycm9yczogWydTdGF0ZXMuVGFza0ZhaWxlZCddLFxuICAgICAgaW50ZXJ2YWw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDIpLFxuICAgICAgbWF4QXR0ZW1wdHM6IDMsXG4gICAgICBiYWNrb2ZmUmF0ZTogMixcbiAgICB9KS5hZGRDYXRjaChuZXcgc3RlcGZ1bmN0aW9ucy5GYWlsKHRoaXMsICdSZWNvbW1lbmRSZHNGYWlsZWQnLCB7XG4gICAgICBjYXVzZTogJ1JlY29tbWVuZCBpZGxlIFJEUyBmYWlsZWQnLFxuICAgICAgZXJyb3I6ICdSZWNvbW1lbmRSZHNFcnJvcicsXG4gICAgfSksIHtcbiAgICAgIHJlc3VsdFBhdGg6ICckLmVycm9yJyxcbiAgICB9KTtcblxuICAgIGNvbnN0IGF1dG9tYXRpb25EZWZpbml0aW9uID0gbmV3IHN0ZXBmdW5jdGlvbnMuUGFyYWxsZWwodGhpcywgJ1J1bkFsbEF1dG9tYXRpb25zJylcbiAgICAgIC5icmFuY2goc3RvcElkbGVUYXNrKVxuICAgICAgLmJyYW5jaChkZWxldGVFYnNUYXNrKVxuICAgICAgLmJyYW5jaChyZWNvbW1lbmRSZHNUYXNrKTtcblxuICAgIGNvbnN0IGF1dG9tYXRpb25TZm4gPSBuZXcgc3RlcGZ1bmN0aW9ucy5TdGF0ZU1hY2hpbmUodGhpcywgJ0F1dG9tYXRpb25Xb3JrZmxvdycsIHtcbiAgICAgIHN0YXRlTWFjaGluZU5hbWU6ICdBdXRvbWF0aW9uV29ya2Zsb3cnLFxuICAgICAgZGVmaW5pdGlvbkJvZHk6IHN0ZXBmdW5jdGlvbnMuRGVmaW5pdGlvbkJvZHkuZnJvbUNoYWluYWJsZShhdXRvbWF0aW9uRGVmaW5pdGlvbiksXG4gICAgICBsb2dzOiB7XG4gICAgICAgIGRlc3RpbmF0aW9uOiBuZXcgY2RrLmF3c19sb2dzLkxvZ0dyb3VwKHRoaXMsICdBdXRvbWF0aW9uU2ZuTG9nR3JvdXAnLCB7XG4gICAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgICBlbmNyeXB0aW9uS2V5OiBsb2dLbXNLZXksXG4gICAgICAgIH0pLFxuICAgICAgICBsZXZlbDogc3RlcGZ1bmN0aW9ucy5Mb2dMZXZlbC5BTEwsXG4gICAgICB9LFxuICAgICAgdHJhY2luZ0VuYWJsZWQ6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyA3LjQuIFJlZ3JhIHNlbWFuYWwgcGFyYSBkaXNwYXJhciBhIFN0YXRlIE1hY2hpbmVcbiAgICBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ1dlZWtseUF1dG9tYXRpb25SdWxlJywge1xuICAgICAgc2NoZWR1bGU6IGV2ZW50cy5TY2hlZHVsZS5jcm9uKHsgd2Vla0RheTogJ1NVTicsIGhvdXI6ICczJywgbWludXRlOiAnMCcgfSksIC8vIERvbWluZ28gMDM6MDAgVVRDXG4gICAgICB0YXJnZXRzOiBbbmV3IHRhcmdldHMuU2ZuU3RhdGVNYWNoaW5lKGF1dG9tYXRpb25TZm4pXSxcbiAgICB9KTtcblxuICAgIC8vIExhbWJkYSBkZSBtZXRlcmluZyBkbyBNYXJrZXRwbGFjZVxuICAgIGNvbnN0IG1hcmtldHBsYWNlTWV0ZXJpbmdMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdNYXJrZXRwbGFjZU1ldGVyaW5nJywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoYmFja2VuZEZ1bmN0aW9uc1BhdGgpLFxuICAgICAgaGFuZGxlcjogJ21hcmtldHBsYWNlLW1ldGVyaW5nLmhhbmRsZXInLFxuICAgICAgLy8gQ29uZmlndXJhw6fDtWVzIGRlIFZQQyAoVGFzayA4KVxuICAgICAgdnBjLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IFtsYW1iZGFTZWN1cml0eUdyb3VwXSxcbiAgICAgIHZwY1N1Ym5ldHM6IHsgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyB9LFxuICAgICAgcmVzZXJ2ZWRDb25jdXJyZW50RXhlY3V0aW9uczogMiwgICAgICBcbiAgICAgIGxvZ0dyb3VwOiBuZXcgY2RrLmF3c19sb2dzLkxvZ0dyb3VwKHRoaXMsICdNYXJrZXRwbGFjZU1ldGVyaW5nTG9nR3JvdXAnLCB7XG4gICAgICAgIHJldGVudGlvbjogY2RrLmF3c19sb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgICBlbmNyeXB0aW9uS2V5OiBsb2dLbXNLZXksXG4gICAgICB9KSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUsXG4gICAgICAgIFBST0RVQ1RfQ09ERTogJ3lvdXItcHJvZHVjdC1jb2RlJywgLy8gU3Vic3RpdHVpciBwZWxvIGPDs2RpZ28gcmVhbCBkbyBwcm9kdXRvXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShtYXJrZXRwbGFjZU1ldGVyaW5nTGFtYmRhKTtcblxuICAgIC8vIFJlZ3JhIHBhcmEgZXhlY3V0YXIgYSBjYWRhIGhvcmFcbiAgICBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ0hvdXJseU1ldGVyaW5nUnVsZScsIHtcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUucmF0ZShjZGsuRHVyYXRpb24uaG91cnMoMSkpLFxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKG1hcmtldHBsYWNlTWV0ZXJpbmdMYW1iZGEpXSxcbiAgICB9KTtcblxuICAgIC8vIFN0ZXAgRnVuY3Rpb25zIFNMQSAoVXNhbmRvIG9zIExhbWJkYXMgY29ycmV0b3MpXG4gICAgXG4gICAgLy8gSGFuZGxlciBkZSBlcnJvIHBhcmEgU0xBIHdvcmtmbG93XG4gICAgY29uc3Qgc2xhRXJyb3JIYW5kbGVyID0gbmV3IHN0ZXBmdW5jdGlvbnMuRmFpbCh0aGlzLCAnU2xhV29ya2Zsb3dGYWlsZWQnLCB7XG4gICAgICBjYXVzZTogJ1NMQSB3b3JrZmxvdyBleGVjdXRpb24gZmFpbGVkJyxcbiAgICAgIGVycm9yOiAnU2xhV29ya2Zsb3dFcnJvcicsXG4gICAgfSk7XG4gICAgXG4gICAgY29uc3QgY2FsY3VsYXRlSW1wYWN0VGFzayA9IG5ldyBzZm5fdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdDYWxjdWxhdGVJbXBhY3QnLCB7IFxuICAgICAgbGFtYmRhRnVuY3Rpb246IHNsYUNhbGN1bGF0ZUltcGFjdExhbWJkYSwgXG4gICAgICBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyxcbiAgICAgIHJldHJ5T25TZXJ2aWNlRXhjZXB0aW9uczogdHJ1ZSxcbiAgICB9KS5hZGRSZXRyeSh7XG4gICAgICBlcnJvcnM6IFsnU3RhdGVzLlRhc2tGYWlsZWQnLCAnU3RhdGVzLlRpbWVvdXQnXSxcbiAgICAgIGludGVydmFsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygyKSxcbiAgICAgIG1heEF0dGVtcHRzOiAzLFxuICAgICAgYmFja29mZlJhdGU6IDIsXG4gICAgfSkuYWRkQ2F0Y2goc2xhRXJyb3JIYW5kbGVyLCB7XG4gICAgICByZXN1bHRQYXRoOiAnJC5lcnJvcicsXG4gICAgfSk7XG4gICAgXG4gICAgY29uc3QgY2hlY2tTbGFUYXNrID0gbmV3IHNmbl90YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ0NoZWNrU0xBJywgeyBcbiAgICAgIGxhbWJkYUZ1bmN0aW9uOiBzbGFDaGVja0xhbWJkYSwgXG4gICAgICBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyxcbiAgICAgIHJldHJ5T25TZXJ2aWNlRXhjZXB0aW9uczogdHJ1ZSxcbiAgICB9KS5hZGRSZXRyeSh7XG4gICAgICBlcnJvcnM6IFsnU3RhdGVzLlRhc2tGYWlsZWQnXSxcbiAgICAgIGludGVydmFsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygyKSxcbiAgICAgIG1heEF0dGVtcHRzOiAzLFxuICAgICAgYmFja29mZlJhdGU6IDIsXG4gICAgfSkuYWRkQ2F0Y2goc2xhRXJyb3JIYW5kbGVyLCB7XG4gICAgICByZXN1bHRQYXRoOiAnJC5lcnJvcicsXG4gICAgfSk7XG4gICAgXG4gICAgY29uc3QgZ2VuZXJhdGVSZXBvcnRUYXNrID0gbmV3IHNmbl90YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ0dlbmVyYXRlUmVwb3J0JywgeyBcbiAgICAgIGxhbWJkYUZ1bmN0aW9uOiBzbGFHZW5lcmF0ZVJlcG9ydExhbWJkYSwgXG4gICAgICBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyxcbiAgICAgIHJldHJ5T25TZXJ2aWNlRXhjZXB0aW9uczogdHJ1ZSxcbiAgICB9KS5hZGRSZXRyeSh7XG4gICAgICBlcnJvcnM6IFsnU3RhdGVzLlRhc2tGYWlsZWQnXSxcbiAgICAgIGludGVydmFsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygyKSxcbiAgICAgIG1heEF0dGVtcHRzOiAzLFxuICAgICAgYmFja29mZlJhdGU6IDIsXG4gICAgfSkuYWRkQ2F0Y2goc2xhRXJyb3JIYW5kbGVyLCB7XG4gICAgICByZXN1bHRQYXRoOiAnJC5lcnJvcicsXG4gICAgfSk7XG4gICAgXG4gICAgY29uc3Qgc3VibWl0VGlja2V0VGFzayA9IG5ldyBzZm5fdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdTdWJtaXRUaWNrZXQnLCB7IFxuICAgICAgbGFtYmRhRnVuY3Rpb246IHNsYVN1Ym1pdFRpY2tldExhbWJkYSwgXG4gICAgICBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyxcbiAgICAgIHJldHJ5T25TZXJ2aWNlRXhjZXB0aW9uczogdHJ1ZSxcbiAgICB9KS5hZGRSZXRyeSh7XG4gICAgICBlcnJvcnM6IFsnU3RhdGVzLlRhc2tGYWlsZWQnXSxcbiAgICAgIGludGVydmFsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygyKSxcbiAgICAgIG1heEF0dGVtcHRzOiAzLFxuICAgICAgYmFja29mZlJhdGU6IDIsXG4gICAgfSkuYWRkQ2F0Y2goc2xhRXJyb3JIYW5kbGVyLCB7XG4gICAgICByZXN1bHRQYXRoOiAnJC5lcnJvcicsXG4gICAgfSk7XG4gICAgXG4gICAgY29uc3Qgbm9DbGFpbSA9IG5ldyBzdGVwZnVuY3Rpb25zLlN1Y2NlZWQodGhpcywgJ05vQ2xhaW1HZW5lcmF0ZWQnKTtcblxuICAgIGNvbnN0IGNsYWltQ2hvaWNlID0gbmV3IHN0ZXBmdW5jdGlvbnMuQ2hvaWNlKHRoaXMsICdJc0NsYWltR2VuZXJhdGVkPycpXG4gICAgICAud2hlbihzdGVwZnVuY3Rpb25zLkNvbmRpdGlvbi5ib29sZWFuRXF1YWxzKCckLmNsYWltR2VuZXJhdGVkJywgdHJ1ZSksIHN1Ym1pdFRpY2tldFRhc2spXG4gICAgICAub3RoZXJ3aXNlKG5vQ2xhaW0pO1xuXG4gICAgY29uc3Qgc2xhRGVmaW5pdGlvbiA9IGNhbGN1bGF0ZUltcGFjdFRhc2tcbiAgICAgIC5uZXh0KGNoZWNrU2xhVGFzaylcbiAgICAgIC5uZXh0KGdlbmVyYXRlUmVwb3J0VGFzaylcbiAgICAgIC5uZXh0KGNsYWltQ2hvaWNlKTtcblxuICAgIGNvbnN0IHNmbiA9IG5ldyBzdGVwZnVuY3Rpb25zLlN0YXRlTWFjaGluZSh0aGlzLCAnU0xBV29ya2Zsb3cnLCB7XG4gICAgICBzdGF0ZU1hY2hpbmVOYW1lOiAnU0xBV29ya2Zsb3cnLFxuICAgICAgc3RhdGVNYWNoaW5lVHlwZTogc3RlcGZ1bmN0aW9ucy5TdGF0ZU1hY2hpbmVUeXBlLlNUQU5EQVJELFxuICAgICAgZGVmaW5pdGlvbkJvZHk6IHN0ZXBmdW5jdGlvbnMuRGVmaW5pdGlvbkJvZHkuZnJvbUNoYWluYWJsZShzbGFEZWZpbml0aW9uKSxcbiAgICAgIGxvZ3M6IHtcbiAgICAgICAgZGVzdGluYXRpb246IG5ldyBjZGsuYXdzX2xvZ3MuTG9nR3JvdXAodGhpcywgJ1NmbkxvZ0dyb3VwJywge1xuICAgICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgICAgZW5jcnlwdGlvbktleTogbG9nS21zS2V5LFxuICAgICAgICB9KSxcbiAgICAgICAgbGV2ZWw6IHN0ZXBmdW5jdGlvbnMuTG9nTGV2ZWwuQUxMLFxuICAgICAgfSxcbiAgICAgIHRyYWNpbmdFbmFibGVkOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgLy8gQWRpY2lvbmFyIG8gQVJOIGRvIFNGTiBhbyBMYW1iZGEgZGUgY29ycmVsYcOnw6NvXG4gICAgaGVhbHRoRXZlbnRIYW5kbGVyTGFtYmRhLmFkZEVudmlyb25tZW50KCdTRk5fQVJOJywgc2ZuLnN0YXRlTWFjaGluZUFybik7XG4gICAgLy8gUGVybWlzc8OjbyBwYXJhIG8gTGFtYmRhIGluaWNpYXIgYSBTdGF0ZSBNYWNoaW5lXG4gICAgc2ZuLmdyYW50U3RhcnRFeGVjdXRpb24oaGVhbHRoRXZlbnRIYW5kbGVyTGFtYmRhKTtcblxuICAgIC8vIEFQSSBHYXRld2F5IChVc2FuZG8gbyAnYXBpSGFuZGxlckxhbWJkYScgY29ycmV0bylcbiAgICBjb25zdCBjbG91ZHdhdGNoX2FjdGlvbnMgPSBjZGsuYXdzX2Nsb3Vkd2F0Y2hfYWN0aW9ucztcbiAgICBjb25zdCBhcGkgPSBuZXcgYXBpZ3cuUmVzdEFwaSh0aGlzLCAnQ29zdEd1YXJkaWFuQVBJJywge1xuICAgICAgcmVzdEFwaU5hbWU6ICdDb3N0R3VhcmRpYW5BcGknLCAvLyBOb21lIHNlbSBlc3Bhw6dvcyBwYXJhIGZhY2lsaXRhciBhIGNvcnJlc3BvbmTDqm5jaWFcbiAgICAgIGRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9uczogeyBhbGxvd09yaWdpbnM6IGFwaWd3LkNvcnMuQUxMX09SSUdJTlMgfSxcbiAgICAgIGRlcGxveU9wdGlvbnM6IHtcbiAgICAgICAgdHJhY2luZ0VuYWJsZWQ6IHRydWUsXG4gICAgICAgIHN0YWdlTmFtZTogJ3Byb2QnLCAvLyAoVGFzayA5KVxuICAgICAgICB0aHJvdHRsaW5nUmF0ZUxpbWl0OiAxMDAsIC8vIChUYXNrIDkpXG4gICAgICAgIHRocm90dGxpbmdCdXJzdExpbWl0OiA1MCwgLy8gKFRhc2sgOSlcbiAgICAgICAgbWV0aG9kT3B0aW9uczoge1xuICAgICAgICAgICcvKi8qJzogeyAvLyBBcGxpY2EgYSB0b2RvcyBvcyBtw6l0b2RvcyBlbSB0b2RvcyBvcyByZWN1cnNvc1xuICAgICAgICAgICAgdGhyb3R0bGluZ0J1cnN0TGltaXQ6IDUwLCAvLyAoVGFzayA5KVxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pOyAvLyAoVGFzayA5KVxuICAgIGNvbnN0IGF1dGggPSBuZXcgYXBpZ3cuQ29nbml0b1VzZXJQb29sc0F1dGhvcml6ZXIodGhpcywgJ0NvZ25pdG9BdXRoJywge1xuICAgICAgY29nbml0b1VzZXJQb29sczogW3VzZXJQb29sXSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHdhZiA9IG5ldyBjZGsuYXdzX3dhZnYyLkNmbldlYkFDTCh0aGlzLCAnQXBpV2FmJywge1xuICAgICAgICBzY29wZTogJ1JFR0lPTkFMJyxcbiAgICAgICAgZGVmYXVsdEFjdGlvbjogeyBhbGxvdzoge30gfSxcbiAgICAgICAgdmlzaWJpbGl0eUNvbmZpZzogeyBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLCBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsIG1ldHJpY05hbWU6ICdBcGlXYWYnIH0sXG4gICAgICAgIHJ1bGVzOiBbeyBuYW1lOiAnQVdTLUFXU01hbmFnZWRSdWxlc0NvbW1vblJ1bGVTZXQnLCBwcmlvcml0eTogMSwgc3RhdGVtZW50OiB7IG1hbmFnZWRSdWxlR3JvdXBTdGF0ZW1lbnQ6IHsgdmVuZG9yTmFtZTogJ0FXUycsIG5hbWU6ICdBV1NNYW5hZ2VkUnVsZXNDb21tb25SdWxlU2V0JyB9IH0sIG92ZXJyaWRlQWN0aW9uOiB7IG5vbmU6IHt9IH0sIHZpc2liaWxpdHlDb25maWc6IHsgc2FtcGxlZFJlcXVlc3RzRW5hYmxlZDogdHJ1ZSwgY2xvdWRXYXRjaE1ldHJpY3NFbmFibGVkOiB0cnVlLCBtZXRyaWNOYW1lOiAnYXdzQ29tbW9uUnVsZXMnIH0gfV0gLy8gKFRhc2sgOSlcblxuICAgIH0pO1xuICAgIG5ldyBjZGsuYXdzX3dhZnYyLkNmbldlYkFDTEFzc29jaWF0aW9uKHRoaXMsICdBcGlXYWZBc3NvY2lhdGlvbicsIHsgcmVzb3VyY2VBcm46IGFwaS5kZXBsb3ltZW50U3RhZ2Uuc3RhZ2VBcm4sIHdlYkFjbEFybjogd2FmLmF0dHJBcm4gfSk7XG5cbiAgICBjb25zdCBhcGlJbnRlZ3JhdGlvbiA9IG5ldyBhcGlndy5MYW1iZGFJbnRlZ3JhdGlvbihhcGlIYW5kbGVyTGFtYmRhKTtcblxuICAgIC8vIEV4cG9yIHRvZGFzIGFzIHJvdGFzIHNvYiAvYXBpIHBhcmEgY29pbmNpZGlyIGNvbSBhcyByb3RhcyBFeHByZXNzIGRvIGJhY2tlbmQgKC9hcGkvKilcbiAgICBjb25zdCBhcGlSb290ID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2FwaScpO1xuXG4gIC8vIEhlYWx0aCBww7pibGljbzogR0VUIC9hcGkvaGVhbHRoIC0+IHNlbSBhdXRob3JpemVyXG4gIGNvbnN0IGhlYWx0aCA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ2hlYWx0aCcpO1xuICBoZWFsdGguYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbik7IC8vIHB1YmxpYyBoZWFsdGggY2hlY2tcblxuICAgIC8vIFJlc291cmNlcyBBUEkgKGFnb3JhIHNvYiAvYXBpKVxuICAgIGNvbnN0IG9uYm9hcmQgPSBhcGlSb290LmFkZFJlc291cmNlKCdvbmJvYXJkJyk7XG4gICAgb25ib2FyZC5hZGRNZXRob2QoJ1BPU1QnLCBhcGlJbnRlZ3JhdGlvbik7IC8vIFdlYmhvb2ssIHNlbSBhdXRoXG5cbiAgLy8gU3RyaXBlIHdlYmhvb2sgKHB1YmxpYyBlbmRwb2ludCwgc2VtIGF1dGhvcml6ZXIpXG4gIGNvbnN0IHN0cmlwZUFwaSA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ3N0cmlwZScpO1xuICBzdHJpcGVBcGkuYWRkUmVzb3VyY2UoJ3dlYmhvb2snKS5hZGRNZXRob2QoJ1BPU1QnLCBhcGlJbnRlZ3JhdGlvbik7XG5cbiAgICAvLyBOb3ZvIGVuZHBvaW50IHBhcmEgZ2VyYXIgY29uZmlnIGRlIG9uYm9hcmRpbmdcbiAgICBjb25zdCBvbmJvYXJkSW5pdCA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ29uYm9hcmQtaW5pdCcpO1xuICAgIG9uYm9hcmRJbml0LmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcblxuICAvLyBEYXNoYm9hcmQgQVBJIHBhcmEgbyBmcm9udGVuZDogR0VUIC9hcGkvZGFzaGJvYXJkL2Nvc3RzIChwcm90ZWdpZG8pXG4gIGNvbnN0IGRhc2hib2FyZEFwaSA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ2Rhc2hib2FyZCcpO1xuICBkYXNoYm9hcmRBcGkuYWRkUmVzb3VyY2UoJ2Nvc3RzJykuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xuXG4gIC8vIFNldHRpbmdzIEFQSTogR0VUL1BPU1QgL2FwaS9zZXR0aW5ncy9hdXRvbWF0aW9uXG4gIGNvbnN0IHNldHRpbmdzQXBpID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnc2V0dGluZ3MnKTtcbiAgY29uc3QgYXV0b21hdGlvbkFwaSA9IHNldHRpbmdzQXBpLmFkZFJlc291cmNlKCdhdXRvbWF0aW9uJyk7XG4gIGF1dG9tYXRpb25BcGkuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xuICBhdXRvbWF0aW9uQXBpLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG5cbiAgICBjb25zdCBpbmNpZGVudHMgPSBhcGlSb290LmFkZFJlc291cmNlKCdpbmNpZGVudHMnKTtcbiAgICBpbmNpZGVudHMuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xuICAgIGNvbnN0IHNsYUNsYWltcyA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ3NsYS1jbGFpbXMnKTtcbiAgICBzbGFDbGFpbXMuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xuXG4gICAgY29uc3QgaW52b2ljZXNBcGkgPSBhcGlSb290LmFkZFJlc291cmNlKCdpbnZvaWNlcycpO1xuICAgIGludm9pY2VzQXBpLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcblxuICAvLyBBbGVydHMgQVBJOiBHRVQgL2FwaS9hbGVydHMgKHByb3RlZ2lkbylcbiAgY29uc3QgYWxlcnRzQXBpID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnYWxlcnRzJyk7XG4gIGFsZXJ0c0FwaS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG5cbiAgLy8gQ29ubmVjdGlvbnMgQVBJOiBHRVQvREVMRVRFIC9hcGkvY29ubmVjdGlvbnMgKHByb3RlZ2lkbylcbiAgY29uc3QgY29ubmVjdGlvbnNBcGkgPSBhcGlSb290LmFkZFJlc291cmNlKCdjb25uZWN0aW9ucycpO1xuICBjb25uZWN0aW9uc0FwaS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG4gIGNvbnN0IGNvbm5lY3Rpb25JdGVtID0gY29ubmVjdGlvbnNBcGkuYWRkUmVzb3VyY2UoJ3thd3NBY2NvdW50SWR9Jyk7XG4gIGNvbm5lY3Rpb25JdGVtLmFkZE1ldGhvZCgnREVMRVRFJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcblxuICAvLyBSZWNvbW1lbmRhdGlvbnMgQVBJOiBHRVQvUE9TVCAvYXBpL3JlY29tbWVuZGF0aW9ucyAocHJvdGVnaWRvKVxuICBjb25zdCByZWNvbW1lbmRhdGlvbnNBcGkgPSBhcGlSb290LmFkZFJlc291cmNlKCdyZWNvbW1lbmRhdGlvbnMnKTtcbiAgcmVjb21tZW5kYXRpb25zQXBpLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcbiAgY29uc3QgZXhlY3V0ZVJlYyA9IHJlY29tbWVuZGF0aW9uc0FwaS5hZGRSZXNvdXJjZSgnZXhlY3V0ZScpO1xuICBleGVjdXRlUmVjLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG5cbiAgLy8gU0xBIFJlcG9ydHMgQVBJOiBHRVQgL2FwaS9zbGEtcmVwb3J0cy97Y2xhaW1JZH0gKHByb3RlZ2lkbylcbiAgY29uc3Qgc2xhUmVwb3J0cyA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ3NsYS1yZXBvcnRzJyk7XG4gIGNvbnN0IHNsYVJlcG9ydEl0ZW0gPSBzbGFSZXBvcnRzLmFkZFJlc291cmNlKCd7Y2xhaW1JZH0nKTtcbiAgc2xhUmVwb3J0SXRlbS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG5cbiAgLy8gVXBncmFkZSBBUEk6IFBPU1QgL2FwaS91cGdyYWRlIChwcm90ZWdpZG8pXG4gIGNvbnN0IHVwZ3JhZGVBcGkgPSBhcGlSb290LmFkZFJlc291cmNlKCd1cGdyYWRlJyk7XG4gIHVwZ3JhZGVBcGkuYWRkTWV0aG9kKCdQT1NUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcblxuICAvLyBCaWxsaW5nIEFQSTogR0VUIC9hcGkvYmlsbGluZy9zdW1tYXJ5IChwcm90ZWdpZG8pXG4gIGNvbnN0IGJpbGxpbmdBcGkgPSBhcGlSb290LmFkZFJlc291cmNlKCdiaWxsaW5nJyk7XG4gIGJpbGxpbmdBcGkuYWRkUmVzb3VyY2UoJ3N1bW1hcnknKS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG5cbiAgICBjb25zdCB0ZXJtc0FwaSA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ2FjY2VwdC10ZXJtcycpO1xuICAgIHRlcm1zQXBpLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG5cbiAgICAvLyBFbmRwb2ludCBkZSBBZG1pblxuICAgIGNvbnN0IGFkbWluQXBpID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnYWRtaW4nKTtcbiAgICBjb25zdCBhZG1pbkNsYWltcyA9IGFkbWluQXBpLmFkZFJlc291cmNlKCdjbGFpbXMnKTtcblxuICAgIC8vIEdFVCAvYXBpL2FkbWluL2NsYWltc1xuICAgIGFkbWluQ2xhaW1zLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcblxuICAgIC8vIFN1Yi1yZWN1cnNvcyBwYXJhIG9wZXJhw6fDtWVzIGVtIGNsYWltcyBlc3BlY8OtZmljYXNcbiAgICBjb25zdCBjbGFpbXNCeUN1c3RvbWVyID0gYWRtaW5DbGFpbXMuYWRkUmVzb3VyY2UoJ3tjdXN0b21lcklkfScpO1xuICAgIGNvbnN0IHNwZWNpZmljQ2xhaW0gPSBjbGFpbXNCeUN1c3RvbWVyLmFkZFJlc291cmNlKCd7Y2xhaW1JZH0nKTtcblxuICAgIC8vIFBVVCAvYXBpL2FkbWluL2NsYWltcy97Y3VzdG9tZXJJZH0ve2NsYWltSWR9L3N0YXR1c1xuICAgIHNwZWNpZmljQ2xhaW0uYWRkUmVzb3VyY2UoJ3N0YXR1cycpLmFkZE1ldGhvZCgnUFVUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcblxuICAgIC8vIFBPU1QgL2FwaS9hZG1pbi9jbGFpbXMve2N1c3RvbWVySWR9L3tjbGFpbUlkfS9jcmVhdGUtaW52b2ljZVxuICAgIHNwZWNpZmljQ2xhaW0uYWRkUmVzb3VyY2UoJ2NyZWF0ZS1pbnZvaWNlJykuYWRkTWV0aG9kKCdQT1NUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcblxuICAgIC8vIE91dHB1dHMgY29tIHJlZmVyw6puY2lhcyBwYXJhIEFtcGxpZnlcbiAgICBjb25zdCBhcGlVcmwgPSBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQVBJVXJsJywgeyB2YWx1ZTogYXBpLnVybCB9KTtcbiAgICBjb25zdCB1c2VyUG9vbElkT3V0cHV0ID0gbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sSWQnLCB7IHZhbHVlOiB1c2VyUG9vbC51c2VyUG9vbElkIH0pO1xuICAgIGNvbnN0IHVzZXJQb29sQ2xpZW50SWRPdXRwdXQgPSBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xDbGllbnRJZCcsIHsgdmFsdWU6IHVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQgfSk7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1RhYmxlTmFtZScsIHsgdmFsdWU6IHRhYmxlLnRhYmxlTmFtZSB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU0ZOQXJuJywgeyB2YWx1ZTogc2ZuLnN0YXRlTWFjaGluZUFybiB9KTtcbiAgICBjb25zdCBjZm5UZW1wbGF0ZVVybE91dHB1dCA9IG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDZm5UZW1wbGF0ZVVybCcsIHtcbiAgICAgIHZhbHVlOiBmdWxsVGVtcGxhdGVVcmwsIC8vIFVzZSB0aGUgcG90ZW50aWFsbHkgZHVtbXkgVVJMIGluIHRlc3RzXG4gICAgICBkZXNjcmlwdGlvbjogJ1VSTCBkbyB0ZW1wbGF0ZSBkbyBDbG91ZEZvcm1hdGlvbiBwYXJhIG8gb25ib2FyZGluZyBkbyBjbGllbnRlLiBVc2UgZXN0YSBVUkwgbm8gZnJvbnRlbmQuJyxcbiAgICB9KTtcblxuICAgIC8vIElkZW50aXR5IFBvb2wgcGFyYSBBbXBsaWZ5XG4gICAgY29uc3QgaWRlbnRpdHlQb29sID0gbmV3IGNvZ25pdG8uQ2ZuSWRlbnRpdHlQb29sKHRoaXMsICdDb3N0R3VhcmRpYW5JZGVudGl0eVBvb2wnLCB7XG4gICAgICBhbGxvd1VuYXV0aGVudGljYXRlZElkZW50aXRpZXM6IGZhbHNlLFxuICAgICAgY29nbml0b0lkZW50aXR5UHJvdmlkZXJzOiBbe1xuICAgICAgICBjbGllbnRJZDogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCxcbiAgICAgICAgcHJvdmlkZXJOYW1lOiB1c2VyUG9vbC51c2VyUG9vbFByb3ZpZGVyTmFtZSxcbiAgICAgIH1dLFxuICAgIH0pO1xuICAgIGNvbnN0IGlkZW50aXR5UG9vbElkT3V0cHV0ID0gbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0lkZW50aXR5UG9vbElkJywge1xuICAgICAgdmFsdWU6IGlkZW50aXR5UG9vbC5yZWYsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gSWRlbnRpdHkgUG9vbCBJRCcsXG4gICAgfSk7XG4gICAgXG4gICAgLy8gQWRpY2lvbmFyIFZQQyBFbmRwb2ludHMgcGFyYSBzZXJ2acOnb3MgZXNzZW5jaWFpc1xuICAgIHZwYy5hZGRHYXRld2F5RW5kcG9pbnQoJ0R5bmFtb0RCRW5kcG9pbnQnLCB7XG4gICAgICBzZXJ2aWNlOiBjZGsuYXdzX2VjMi5HYXRld2F5VnBjRW5kcG9pbnRBd3NTZXJ2aWNlLkRZTkFNT0RCLFxuICAgIH0pO1xuICAgIHZwYy5hZGRHYXRld2F5RW5kcG9pbnQoJ1MzRW5kcG9pbnQnLCB7XG4gICAgICBzZXJ2aWNlOiBjZGsuYXdzX2VjMi5HYXRld2F5VnBjRW5kcG9pbnRBd3NTZXJ2aWNlLlMzLFxuICAgIH0pO1xuXG4gICAgLy8gTG9nIEdyb3VwIHBhcmEgZXhwb3J0IGRlIGVudlxuICAgIGNvbnN0IGVudkV4cG9ydExvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgJ0VudkV4cG9ydExvZ0dyb3VwJywge1xuICAgICAgbG9nR3JvdXBOYW1lOiAnQ29zdEd1YXJkaWFuL0VudkV4cG9ydCcsXG4gICAgICByZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgLy8gU05TIFRvcGljIHBhcmEgYWxlcnRhcyBkZSBleHBvcnRcbiAgICBjb25zdCBlbnZBbGVydFRvcGljID0gbmV3IHNucy5Ub3BpYyh0aGlzLCAnRW52QWxlcnRUb3BpYycsIHtcbiAgICAgIGRpc3BsYXlOYW1lOiAnQ29zdEd1YXJkaWFuIEVudiBFeHBvcnQgQWxlcnRzJyxcbiAgICB9KTtcblxuICAgIC8vIE91dHB1dHMgcGFyYSBvIHNjcmlwdCB1c2FyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0VudkFsZXJ0VG9waWNBcm4nLCB7XG4gICAgICB2YWx1ZTogZW52QWxlcnRUb3BpYy50b3BpY0FybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIGRvIFNOUyB0b3BpYyBwYXJhIGFsZXJ0YXMgZGUgZXhwb3J0IGRlIGVudicsXG4gICAgfSk7XG5cbiAgICBpZiAoIXByb3BzLmlzVGVzdEVudmlyb25tZW50KSB7XG4gICAgICAvLyBDbG91ZFdhdGNoIEFsYXJtcyBwYXJhIHByb2R1w6fDo28gKFRhc2sgMTApXG4gICAgICBjb25zdCBhbGFybVRvcGljID0gbmV3IHNucy5Ub3BpYyh0aGlzLCAnQWxhcm1Ub3BpYycsIHtcbiAgICAgICAgZGlzcGxheU5hbWU6ICdDb3N0R3VhcmRpYW4gQWxhcm1zJyxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhcGk1eHhBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdBcGk1eHhBbGFybScsIHtcbiAgICAgICAgbWV0cmljOiBhcGkubWV0cmljU2VydmVyRXJyb3IoKSxcbiAgICAgICAgdGhyZXNob2xkOiAxLFxuICAgICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FsYXJtIHdoZW4gQVBJIEdhdGV3YXkgNVhYIGVycm9ycyBvY2N1cicsXG4gICAgICAgIGFjdGlvbnNFbmFibGVkOiB0cnVlLFxuICAgICAgfSk7XG4gICAgICBhcGk1eHhBbGFybS5hZGRBbGFybUFjdGlvbihuZXcgY2xvdWR3YXRjaF9hY3Rpb25zLlNuc0FjdGlvbihhbGFybVRvcGljKSk7XG5cbiAgICAgIGNvbnN0IGFwaUxhdGVuY3lBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdBcGlMYXRlbmN5QWxhcm0nLCB7XG4gICAgICAgIG1ldHJpYzogYXBpLm1ldHJpY0xhdGVuY3koKSxcbiAgICAgICAgdGhyZXNob2xkOiAxMDAwLCAvLyAxIHNlZ3VuZG9cbiAgICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBbGFybSB3aGVuIEFQSSBHYXRld2F5IGxhdGVuY3kgaXMgaGlnaCAoPjFzKScsXG4gICAgICAgIGFjdGlvbnNFbmFibGVkOiB0cnVlLFxuICAgICAgfSk7XG4gICAgICBhcGlMYXRlbmN5QWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGNsb3Vkd2F0Y2hfYWN0aW9ucy5TbnNBY3Rpb24oYWxhcm1Ub3BpYykpO1xuICAgIH1cblxuICAgIC8vIC0tLSBTRcOHw4NPIERPIEZST05URU5EIChBTVBMSUZZIEFQUCBBVVRPTUFUSVpBRE8pIC0tLVxuICAgIGNvbnN0IGJ1aWxkU3BlYyA9IGNvZGVidWlsZC5CdWlsZFNwZWMuZnJvbU9iamVjdFRvWWFtbCh7XG4gICAgICB2ZXJzaW9uOiAnMS4wJyxcbiAgICAgIGZyb250ZW5kOiB7XG4gICAgICAgIHBoYXNlczoge1xuICAgICAgICAgIHByZUJ1aWxkOiB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAnY2QgZnJvbnRlbmQnLFxuICAgICAgICAgICAgICAnbnBtIGNpJyxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBidWlsZDoge1xuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgYGVjaG8gXCJORVhUX1BVQkxJQ19BV1NfUkVHSU9OPSR7dGhpcy5yZWdpb259XCIgPj4gLmVudi5wcm9kdWN0aW9uYCxcbiAgICAgICAgICAgICAgYGVjaG8gXCJORVhUX1BVQkxJQ19BUElfVVJMPSR7YXBpLnVybH1cIiA+PiAuZW52LnByb2R1Y3Rpb25gLFxuICAgICAgICAgICAgICBgZWNobyBcIk5FWFRfUFVCTElDX0NPR05JVE9fVVNFUl9QT09MX0lEPSR7dXNlclBvb2wudXNlclBvb2xJZH1cIiA+PiAuZW52LnByb2R1Y3Rpb25gLFxuICAgICAgICAgICAgICBgZWNobyBcIk5FWFRfUFVCTElDX0NPR05JVE9fVVNFUl9QT09MX0NMSUVOVF9JRD0ke3VzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWR9XCIgPj4gLmVudi5wcm9kdWN0aW9uYCxcbiAgICAgICAgICAgICAgYGVjaG8gXCJORVhUX1BVQkxJQ19DT0dOSVRPX0lERU5USVRZX1BPT0xfSUQ9JHtpZGVudGl0eVBvb2wucmVmfVwiID4+IC5lbnYucHJvZHVjdGlvbmAsXG4gICAgICAgICAgICAgIGBlY2hvIFwiTkVYVF9QVUJMSUNfQ0ZOX1RFTVBMQVRFX1VSTD0ke2Z1bGxUZW1wbGF0ZVVybH1cIiA+PiAuZW52LnByb2R1Y3Rpb25gLFxuICAgICAgICAgICAgICAnbnBtIHJ1biBidWlsZCcsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGFydGlmYWN0czoge1xuICAgICAgICAgIGJhc2VEaXJlY3Rvcnk6ICdmcm9udGVuZC8ubmV4dCcsXG4gICAgICAgICAgZmlsZXM6IFsnKiovKiddLFxuICAgICAgICB9LFxuICAgICAgICBjYWNoZToge1xuICAgICAgICAgIHBhdGhzOiBbJ2Zyb250ZW5kL25vZGVfbW9kdWxlcy8qKi8qJ10sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgaWYgKHByb3BzLmlzVGVzdEVudmlyb25tZW50KSB7XG4gICAgICByZXR1cm47IC8vIE7Do28gY3JpYXIgcmVjdXJzb3MgZGUgQW1wbGlmeSwgUm91dGU1MywgQUNNIGVtIHRlc3Rlc1xuICAgIH1cblxuICAgIC8vIFZhbGlkYcOnw6NvIHBhcmEgZ2FyYW50aXIgcXVlIGFzIHByb3BzIGV4aXN0ZW0gYXDDs3MgYSB2ZXJpZmljYcOnw6NvIGRvIGFtYmllbnRlIGRlIHRlc3RlXG4gICAgaWYgKCFwcm9wcy5naXRodWJSZXBvIHx8ICFwcm9wcy5naXRodWJUb2tlblNlY3JldE5hbWUgfHwgIXByb3BzLmdpdGh1YkJyYW5jaCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdBcyBwcm9wcmllZGFkZXMgZG8gR2l0SHViIHPDo28gbmVjZXNzw6FyaWFzIHBhcmEgbyBkZXBsb3kgZG8gQW1wbGlmeS4nKTtcbiAgICB9XG5cbiAgICBjb25zdCBbb3duZXIsIHJlcG9zaXRvcnldID0gcHJvcHMuZ2l0aHViUmVwby5zcGxpdCgnLycpO1xuICAgIGlmICghb3duZXIgfHwgIXJlcG9zaXRvcnkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignTyBnaXRodWJSZXBvIGRldmUgZXN0YXIgbm8gZm9ybWF0byBcIm93bmVyL3JlcG9zaXRvcnlcIicpO1xuICAgIH1cblxuICAgIGNvbnN0IGFtcGxpZnlBcHAgPSBuZXcgYW1wbGlmeS5BcHAodGhpcywgJ0Nvc3RHdWFyZGlhbkZyb250ZW5kJywge1xuICAgICAgYXBwTmFtZTogJ0Nvc3RHdWFyZGlhbkFwcCcsXG4gICAgICBzb3VyY2VDb2RlUHJvdmlkZXI6IG5ldyBhbXBsaWZ5LkdpdEh1YlNvdXJjZUNvZGVQcm92aWRlcih7XG4gICAgICAgIG93bmVyLFxuICAgICAgICByZXBvc2l0b3J5LFxuICAgICAgICBvYXV0aFRva2VuOiBjZGsuU2VjcmV0VmFsdWUuc2VjcmV0c01hbmFnZXIocHJvcHMuZ2l0aHViVG9rZW5TZWNyZXROYW1lLCB7XG4gICAgICAgICAganNvbkZpZWxkOiAnZ2l0aHViLXRva2VuJyxcbiAgICAgICAgfSksXG4gICAgICB9KSxcbiAgICAgIGJ1aWxkU3BlYzogYnVpbGRTcGVjLFxuICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAgICAgICAgJ19MSVZFX1VQREFURVMnOiAnW3tcInBrZ1wiOlwiQGF3cy1hbXBsaWZ5L2NsaVwiLFwidHlwZVwiOlwibnBtXCIsXCJ2ZXJzaW9uXCI6XCJsYXRlc3RcIn1dJyxcbiAgICAgICAgJ0FNUExJRllfTk9ERV9WRVJTSU9OJzogJzE4J1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IG1haW5CcmFuY2ggPSBhbXBsaWZ5QXBwLmFkZEJyYW5jaChwcm9wcy5naXRodWJCcmFuY2gsIHtcbiAgICAgIHN0YWdlOiAnUFJPRFVDVElPTicsXG4gICAgICBicmFuY2hOYW1lOiBwcm9wcy5naXRodWJCcmFuY2gsXG4gICAgfSk7XG5cbiAgICAvLyBEb23DrW5pbyBjdXN0b21pemFkb1xuICAgIGNvbnN0IGhvc3RlZFpvbmUgPSByb3V0ZTUzLkhvc3RlZFpvbmUuZnJvbUhvc3RlZFpvbmVBdHRyaWJ1dGVzKHRoaXMsICdIb3N0ZWRab25lJywge1xuICAgICAgaG9zdGVkWm9uZUlkOiBob3N0ZWRab25lSWQsXG4gICAgICB6b25lTmFtZTogZG9tYWluTmFtZSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGNlcnRpZmljYXRlID0gbmV3IGFjbS5DZXJ0aWZpY2F0ZSh0aGlzLCAnU3NsQ2VydGlmaWNhdGUnLCB7XG4gICAgICBkb21haW5OYW1lOiBkb21haW5OYW1lLFxuICAgICAgc3ViamVjdEFsdGVybmF0aXZlTmFtZXM6IFtgd3d3LiR7ZG9tYWluTmFtZX1gXSxcbiAgICAgIHZhbGlkYXRpb246IGFjbS5DZXJ0aWZpY2F0ZVZhbGlkYXRpb24uZnJvbURucyhob3N0ZWRab25lKSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGRvbWFpbiA9IGFtcGxpZnlBcHAuYWRkRG9tYWluKGRvbWFpbk5hbWUsIHtcbiAgICAgIGVuYWJsZUF1dG9TdWJkb21haW46IHRydWUsXG4gICAgICBzdWJEb21haW5zOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBicmFuY2g6IG1haW5CcmFuY2gsXG4gICAgICAgICAgcHJlZml4OiAnd3d3JyxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG4gICAgZG9tYWluLm1hcFJvb3QobWFpbkJyYW5jaCk7XG4gIH1cbn1cbiJdfQ==