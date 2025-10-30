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
const acm = require("aws-cdk-lib/aws-certificatemanager");
const amplify = require("@aws-cdk/aws-amplify-alpha");
const ec2 = require("aws-cdk-lib/aws-ec2");
const cloudwatch = require("aws-cdk-lib/aws-cloudwatch");
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
            encryptionKey: new kms.Key(this, 'StripeSecretKmsKey', { enableKeyRotation: true, removalPolicy: cdk.RemovalPolicy.DESTROY }),
            generateSecretString: { secretStringTemplate: '{"key":""}', generateStringKey: 'key' },
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // Webhook secret (raw string) stored in Secrets Manager for secure delivery - CORRIGIDO
        const stripeWebhookSecret = new secretsmanager.Secret(this, 'StripeWebhookSecret', {
            description: 'Stripe webhook signing secret for platform webhooks',
            encryptionKey: new kms.Key(this, 'StripeWebhookSecretKmsKey', { enableKeyRotation: true, removalPolicy: cdk.RemovalPolicy.DESTROY }),
            generateSecretString: { secretStringTemplate: '{"webhook":""}', generateStringKey: 'webhook' },
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // KMS Key para todos os CloudWatch Log Groups
        const logKmsKey = new kms.Key(this, 'LogGroupKmsKey', {
            enableKeyRotation: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
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
        // Retain the table on stack deletion for robust cleanup (Task 3)
        table.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
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
                    noncurrentVersionExpiration: cdk.Duration.days(30),
                    transitions: [{
                            storageClass: s3.StorageClass.INTELLIGENT_TIERING,
                            transitionAfter: cdk.Duration.days(90), // Após 90 dias
                        }],
                    noncurrentVersionTransitions: [{
                            storageClass: s3.StorageClass.GLACIER,
                            transitionAfter: cdk.Duration.days(30), // Após 30 dias
                        }],
                }]
        });
        // Força a configuração de criptografia através do recurso L1 (atualizar para KMS)
        const cfnTemplateBucket = templateBucket.node.defaultChild;
        cfnTemplateBucket.addPropertyOverride('BucketEncryption', {
            ServerSideEncryptionConfiguration: [{
                    ServerSideEncryptionByDefault: {
                        SSEAlgorithm: 'AES256',
                    },
                    KMSMasterKeyID: s3KmsKey.keyArn, // Especificar KMS Key
                }],
        });
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
                encryptionKey: logKmsKey,
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
                encryptionKey: logKmsKey,
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
        const cfnReportsBucket = reportsBucket.node.defaultChild;
        cfnReportsBucket.addPropertyOverride('BucketEncryption', {
            ServerSideEncryptionConfiguration: [{
                    ServerSideEncryptionByDefault: {
                        SSEAlgorithm: 'AES256',
                    },
                    KMSMasterKeyID: s3KmsKey.keyArn, // Especificar KMS Key
                }],
        });
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
            statement: JSON.stringify({
                Effect: 'Allow',
                Principal: '*',
                Action: 'events:PutEvents',
                Resource: eventBus.eventBusArn,
                Condition: {
                    StringEquals: {
                        'aws:PrincipalArn': 'arn:aws:iam::*:role/EventBusRole',
                    },
                },
            }),
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
                        throttlingBurstLimit: 50,
                        throttlingRateLimit: 100, // (Task 9)
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29zdC1ndWFyZGlhbi1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNvc3QtZ3VhcmRpYW4tc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLG1DQUFtQzs7O0FBRW5DLG1DQUFtQztBQUVuQyxpREFBaUQ7QUFDakQsNkJBQTZCO0FBQzdCLG9EQUFvRDtBQUNwRCxxREFBcUQ7QUFDckQsbURBQW1EO0FBQ25ELHlDQUF5QztBQUN6QywwREFBMEQ7QUFDMUQsaURBQWlEO0FBQ2pELDBEQUEwRDtBQUMxRCwrREFBK0Q7QUFDL0QsaUVBQWlFO0FBQ2pFLGlFQUFpRTtBQUNqRSwyQ0FBMkM7QUFDM0MsMkNBQTJDO0FBQzNDLG1EQUFtRDtBQUNuRCwwREFBMEQ7QUFDMUQsc0RBQXNEO0FBQ3RELDJDQUEyQztBQUMzQyx5REFBeUQ7QUFDekQsMkNBQTJDO0FBQzNDLHVEQUF1RDtBQWlDdkQsTUFBYSxpQkFBa0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUM5QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQTZCO1FBQ3JFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLG1DQUFtQztRQUNuQyxNQUFNLFdBQVcsR0FBRyxLQUFLLENBQUMsV0FBVyxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLGVBQWUsQ0FBQyxDQUFDO1FBQy9FLE1BQU0sb0JBQW9CLEdBQUcsS0FBSyxDQUFDLG9CQUFvQixJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLHlCQUF5QixDQUFDLENBQUM7UUFDM0csTUFBTSxRQUFRLEdBQUcsS0FBSyxDQUFDLFFBQVEsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxZQUFZLENBQUMsQ0FBQztRQUl0RSxzRUFBc0U7UUFDdEUseUZBQXlGO1FBQ3pGLG9EQUFvRDtRQUNwRCxnREFBZ0Q7UUFDaEQsZ0RBQWdEO1FBR2hELHlF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QztRQUVILHNCQUFzQjtRQUN0QixNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsVUFBVSxDQUFDLHdCQUF3QixDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDakYsWUFBWSxFQUFFLFlBQVk7WUFDMUIsUUFBUSxFQUFFLFVBQVU7U0FDckIsQ0FBQyxDQUFDO1FBRUgsTUFBTSxXQUFXLEdBQUcsSUFBSSxHQUFHLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUM5RCxVQUFVLEVBQUUsVUFBVTtZQUN0Qix1QkFBdUIsRUFBRSxDQUFDLE9BQU8sVUFBVSxFQUFFLENBQUM7WUFDOUMsVUFBVSxFQUFFLEdBQUcsQ0FBQyxxQkFBcUIsQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDO1NBQzFELENBQUMsQ0FBQztRQUVILE1BQU0sTUFBTSxHQUFHLFVBQVUsQ0FBQyxTQUFTLENBQUMsVUFBVSxFQUFFO1lBQzlDLG1CQUFtQixFQUFFLElBQUk7WUFDekIsVUFBVSxFQUFFO2dCQUNWO29CQUNFLE1BQU0sRUFBRSxVQUFVO29CQUNsQixNQUFNLEVBQUUsS0FBSztpQkFDZDthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBQ0gsTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQztJQUM3QixDQUFDO0NBQ0Y7QUFoc0NELDhDQWdzQ0MiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBpbmZyYS9saWIvY29zdC1ndWFyZGlhbi1zdGFjay50c1xuXG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgYXBpZ3cgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcbmltcG9ydCAqIGFzIGNvZ25pdG8gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZ25pdG8nO1xuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcbmltcG9ydCAqIGFzIHMzZGVwbG95IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMy1kZXBsb3ltZW50JztcbmltcG9ydCAqIGFzIGV2ZW50cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzJztcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcbmltcG9ydCAqIGFzIHN0ZXBmdW5jdGlvbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXN0ZXBmdW5jdGlvbnMnO1xuaW1wb3J0ICogYXMgc2ZuX3Rhc2tzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zdGVwZnVuY3Rpb25zLXRhc2tzJztcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBzbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucyc7XG5pbXBvcnQgKiBhcyByb3V0ZTUzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1yb3V0ZTUzJztcbmltcG9ydCAqIGFzIGFjbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2VydGlmaWNhdGVtYW5hZ2VyJztcbmltcG9ydCAqIGFzIGFtcGxpZnkgZnJvbSAnQGF3cy1jZGsvYXdzLWFtcGxpZnktYWxwaGEnO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0ICogYXMgY2xvdWR3YXRjaCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaCc7XG5pbXBvcnQgKiBhcyBrbXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWttcyc7XG5pbXBvcnQgKiBhcyBjb2RlYnVpbGQgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVidWlsZCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29zdEd1YXJkaWFuU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgZG9tYWluTmFtZT86IHN0cmluZztcbiAgaG9zdGVkWm9uZUlkPzogc3RyaW5nO1xuICBnaXRodWJSZXBvPzogc3RyaW5nO1xuICBnaXRodWJCcmFuY2g/OiBzdHJpbmc7XG4gIGdpdGh1YlRva2VuU2VjcmV0TmFtZT86IHN0cmluZztcbiAgLyoqXG4gICAqIFNlIHRydWUsIGRlc2F0aXZhIHJlY3Vyc29zIHF1ZSBkZXBlbmRlbSBkZSBhc3NldHMgZsOtc2ljb3MgZHVyYW50ZSBvcyB0ZXN0ZXMuXG4gICAqIEBkZWZhdWx0IGZhbHNlXG4gICAqL1xuICBpc1Rlc3RFbnZpcm9ubWVudD86IGJvb2xlYW47XG4gIC8qKlxuICAgKiBTZSB0cnVlLCBjcmlhIGFsYXJtZXMgZG8gQ2xvdWRXYXRjaC5cbiAgICogQGRlZmF1bHQgdHJ1ZVxuICAgKi9cbiAgY3JlYXRlQWxhcm1zPzogYm9vbGVhbjtcbiAgZGVwc0xvY2tGaWxlUGF0aD86IHN0cmluZztcbiAgLyoqXG4gICAqIENhbWluaG8gYWJzb2x1dG8gcGFyYSBhIHBhc3RhIGJhY2tlbmRcbiAgICovXG4gIGJhY2tlbmRQYXRoPzogc3RyaW5nO1xuICAvKipcbiAgICogQ2FtaW5obyBhYnNvbHV0byBwYXJhIGEgcGFzdGEgYmFja2VuZC9mdW5jdGlvbnNcbiAgICovXG4gIGJhY2tlbmRGdW5jdGlvbnNQYXRoPzogc3RyaW5nO1xuICAvKipcbiAgICogQ2FtaW5obyBhYnNvbHV0byBwYXJhIGEgcGFzdGEgZG9jc1xuICAgKi9cbiAgZG9jc1BhdGg/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBDb3N0R3VhcmRpYW5TdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBDb3N0R3VhcmRpYW5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyBEZWZpbmUgYXNzZXQgcGF0aHMgd2l0aCBkZWZhdWx0c1xuICAgIGNvbnN0IGJhY2tlbmRQYXRoID0gcHJvcHMuYmFja2VuZFBhdGggfHwgcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL2JhY2tlbmQnKTtcbiAgICBjb25zdCBiYWNrZW5kRnVuY3Rpb25zUGF0aCA9IHByb3BzLmJhY2tlbmRGdW5jdGlvbnNQYXRoIHx8IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9iYWNrZW5kL2Z1bmN0aW9ucycpO1xuICAgIGNvbnN0IGRvY3NQYXRoID0gcHJvcHMuZG9jc1BhdGggfHwgcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL2RvY3MnKTtcblxuXG5cbiAgICAvLyBBZGljaW9uYXIgdGFncyBhIHRvZG9zIG9zIHJlY3Vyc29zIGRvIHN0YWNrIChjb21lbnRhZG8gcGFyYSB0ZXN0ZXMpXG4gICAgLy8gY2RrLlRhZ3Mub2YodGhpcykuYWRkKCdFbnZpcm9ubWVudCcsIHByb3BzLmlzVGVzdEVudmlyb25tZW50ID8gJ1Rlc3QnIDogJ1Byb2R1Y3Rpb24nKTtcbiAgICAvLyBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ1Byb2plY3QnLCAnQ29zdEd1YXJkaWFuJyk7XG4gICAgLy8gY2RrLlRhZ3Mub2YodGhpcykuYWRkKCdPd25lcicsICdGaW5PcHNUZWFtJyk7XG4gICAgLy8gY2RrLlRhZ3Mub2YodGhpcykuYWRkKCdDb3N0Q2VudGVyJywgJzEyMzQ1Jyk7XG5cblxuICAgIC8vIFZhbGlkYcOnw6NvIHJvYnVzdGEgZGUgcHJvcHJpZWRhZGVzIG5vIGluw61jaW8gZG8gY29uc3RydXRvciBwYXJhIEFtcGxpZnlcbiAgICBpZiAoIXByb3BzLmlzVGVzdEVudmlyb25tZW50KSB7XG4gICAgICBpZiAoIXByb3BzLmdpdGh1YlJlcG8gfHwgIXByb3BzLmdpdGh1YlRva2VuU2VjcmV0TmFtZSB8fCAhcHJvcHMuZ2l0aHViQnJhbmNoIHx8ICFwcm9wcy5kb21haW5OYW1lIHx8ICFwcm9wcy5ob3N0ZWRab25lSWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdBcyBwcm9wcmllZGFkZXMgZ2l0aHViUmVwbywgZ2l0aHViVG9rZW5TZWNyZXROYW1lLCBnaXRodWJCcmFuY2gsIGRvbWFpbk5hbWUgZSBob3N0ZWRab25lSWQgc8OjbyBvYnJpZ2F0w7NyaWFzIHBhcmEgYW1iaWVudGVzIG7Do28tdGVzdGUuJyk7XG4gICAgICB9XG4gICAgfVxuICAgIC8vIFZhbGlkYcOnw6NvIHBhcmEgdGVzdGVzIHF1ZSBwcmVjaXNhbSBkZSB1bSBtb2NrIGRlIGdpdGh1YlJlcG9cbiAgICBpZiAocHJvcHMuaXNUZXN0RW52aXJvbm1lbnQgJiYgKCFwcm9wcy5naXRodWJSZXBvIHx8ICFwcm9wcy5naXRodWJUb2tlblNlY3JldE5hbWUgfHwgIXByb3BzLmdpdGh1YkJyYW5jaCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdBcyBwcm9wcmllZGFkZXMgZ2l0aHViUmVwbywgZ2l0aHViVG9rZW5TZWNyZXROYW1lIGUgZ2l0aHViQnJhbmNoIHPDo28gb2JyaWdhdMOzcmlhcywgbWVzbW8gZW0gYW1iaWVudGVzIGRlIHRlc3RlLCBwYXJhIGEgY29uc3RydcOnw6NvIGRvIHN0YWNrLicpO1xuICAgIH1cblxuICAgIGNvbnN0IGRvbWFpbk5hbWUgPSBwcm9wcy5kb21haW5OYW1lIHx8ICdleGFtcGxlLmNvbSc7XG4gICAgY29uc3QgaG9zdGVkWm9uZUlkID0gcHJvcHMuaG9zdGVkWm9uZUlkIHx8ICdaMTIzNDU2Nzg5JztcbiAgICBjb25zdCBnaXRodWJSZXBvID0gcHJvcHMuZ2l0aHViUmVwbyB8fCAndXNlci9yZXBvJztcbiAgICBjb25zdCBnaXRodWJCcmFuY2ggPSBwcm9wcy5naXRodWJCcmFuY2ggfHwgJ21haW4nO1xuICAgIGNvbnN0IGdpdGh1YlRva2VuU2VjcmV0TmFtZSA9IHByb3BzLmdpdGh1YlRva2VuU2VjcmV0TmFtZSB8fCAnZ2l0aHViLXRva2VuJztcblxuICAgIC8vIFNlY3JldHMgKE1hbnRpZG8pXG4gICAgY29uc3Qgc3RyaXBlU2VjcmV0ID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldCh0aGlzLCAnU3RyaXBlU2VjcmV0Jywge1xuICAgICAgZW5jcnlwdGlvbktleTogbmV3IGttcy5LZXkodGhpcywgJ1N0cmlwZVNlY3JldEttc0tleScsIHsgZW5hYmxlS2V5Um90YXRpb246IHRydWUsIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1kgfSksXG4gICAgICBnZW5lcmF0ZVNlY3JldFN0cmluZzogeyBzZWNyZXRTdHJpbmdUZW1wbGF0ZTogJ3tcImtleVwiOlwiXCJ9JywgZ2VuZXJhdGVTdHJpbmdLZXk6ICdrZXknIH0sXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgLy8gV2ViaG9vayBzZWNyZXQgKHJhdyBzdHJpbmcpIHN0b3JlZCBpbiBTZWNyZXRzIE1hbmFnZXIgZm9yIHNlY3VyZSBkZWxpdmVyeSAtIENPUlJJR0lET1xuICAgIGNvbnN0IHN0cmlwZVdlYmhvb2tTZWNyZXQgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdTdHJpcGVXZWJob29rU2VjcmV0Jywge1xuICAgICAgZGVzY3JpcHRpb246ICdTdHJpcGUgd2ViaG9vayBzaWduaW5nIHNlY3JldCBmb3IgcGxhdGZvcm0gd2ViaG9va3MnLFxuICAgICAgZW5jcnlwdGlvbktleTogbmV3IGttcy5LZXkodGhpcywgJ1N0cmlwZVdlYmhvb2tTZWNyZXRLbXNLZXknLCB7IGVuYWJsZUtleVJvdGF0aW9uOiB0cnVlLCByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZIH0pLFxuICAgICAgZ2VuZXJhdGVTZWNyZXRTdHJpbmc6IHsgc2VjcmV0U3RyaW5nVGVtcGxhdGU6ICd7XCJ3ZWJob29rXCI6XCJcIn0nLCBnZW5lcmF0ZVN0cmluZ0tleTogJ3dlYmhvb2snIH0sXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgLy8gS01TIEtleSBwYXJhIHRvZG9zIG9zIENsb3VkV2F0Y2ggTG9nIEdyb3Vwc1xuICAgIGNvbnN0IGxvZ0ttc0tleSA9IG5ldyBrbXMuS2V5KHRoaXMsICdMb2dHcm91cEttc0tleScsIHtcbiAgICAgIGVuYWJsZUtleVJvdGF0aW9uOiB0cnVlLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcbiAgICBcbiAgICAvLyBLTVMgS2V5IHBhcmEgRHluYW1vREJcbiAgICBjb25zdCBkeW5hbW9LbXNLZXkgPSBuZXcga21zLktleSh0aGlzLCAnRHluYW1vS21zS2V5Jywge1xuICAgICAgZW5hYmxlS2V5Um90YXRpb246IHRydWUsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgZGVzY3JpcHRpb246ICdLTVMga2V5IGZvciBEeW5hbW9EQiB0YWJsZSBlbmNyeXB0aW9uJyxcbiAgICB9KTtcblxuICAgIC8vIEtNUyBLZXkgcGFyYSBTMyBCdWNrZXRzXG4gICAgY29uc3QgczNLbXNLZXkgPSBuZXcga21zLktleSh0aGlzLCAnUzNLZXknLCB7XG4gICAgICBlbmFibGVLZXlSb3RhdGlvbjogdHJ1ZSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBkZXNjcmlwdGlvbjogJ0tNUyBrZXkgZm9yIFMzIGJ1Y2tldCBlbmNyeXB0aW9uJyxcbiAgICB9KTtcblxuICAgIC8vIER5bmFtb0RCIChNYW50aWRvLCBtYXMgYWRpY2lvbmFuZG8gc3RyZWFtIHBhcmEgZWZpY2nDqm5jaWEgZnV0dXJhKVxuICAgIGNvbnN0IHRhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdDb3N0R3VhcmRpYW5UYWJsZScsIHtcbiAgICAgIHRhYmxlTmFtZTogJ0Nvc3RHdWFyZGlhblRhYmxlJyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LCAvLyBDaGF2ZSBwcmltw6FyaWEgcGFyYSB1c3XDoXJpb3MsIGNsYWltcywgZXRjLlxuICAgICAgc29ydEtleTogeyBuYW1lOiAnc2snLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LCAvLyBDaGF2ZSBkZSBjbGFzc2lmaWNhw6fDo28gcGFyYSBtb2RlbGFnZW0gZmxleMOtdmVsXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIHN0cmVhbTogZHluYW1vZGIuU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTLCAvLyBIYWJpbGl0YXIgc3RyZWFtXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5U3BlY2lmaWNhdGlvbjoge1xuICAgICAgICBwb2ludEluVGltZVJlY292ZXJ5RW5hYmxlZDogdHJ1ZVxuICAgICAgfSxcbiAgICAgIGVuY3J5cHRpb246IGR5bmFtb2RiLlRhYmxlRW5jcnlwdGlvbi5DVVNUT01FUl9NQU5BR0VELCAvLyBVc2FyIEtNUyBwYXJhIG1haW9yIHNlZ3VyYW7Dp2EgKFRhc2sgMylcbiAgICAgIGVuY3J5cHRpb25LZXk6IGR5bmFtb0ttc0tleSxcbiAgICB9KTtcbiAgICAvLyBSZXRhaW4gdGhlIHRhYmxlIG9uIHN0YWNrIGRlbGV0aW9uIGZvciByb2J1c3QgY2xlYW51cCAoVGFzayAzKVxuICAgIHRhYmxlLmFwcGx5UmVtb3ZhbFBvbGljeShjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4pO1xuXG4gICAgLy8gQWRpY2lvbmFyIHRhZ3Mgw6AgdGFiZWxhIER5bmFtb0RCIHVzYW5kbyBhZGRQcm9wZXJ0eU92ZXJyaWRlXG4gICAgY29uc3QgY2ZuVGFibGUgPSB0YWJsZS5ub2RlLmRlZmF1bHRDaGlsZCBhcyBkeW5hbW9kYi5DZm5UYWJsZTtcbiAgICBjZm5UYWJsZS5hZGRQcm9wZXJ0eU92ZXJyaWRlKCdUYWdzJywgW1xuICAgICAgeyBLZXk6ICdFbnZpcm9ubWVudCcsIFZhbHVlOiBwcm9wcy5pc1Rlc3RFbnZpcm9ubWVudCA/ICdUZXN0JyA6ICdQcm9kdWN0aW9uJyB9LFxuICAgICAgeyBLZXk6ICdQcm9qZWN0JywgVmFsdWU6ICdDb3N0R3VhcmRpYW4nIH0sXG4gICAgICB7IEtleTogJ093bmVyJywgVmFsdWU6ICdGaW5PcHNUZWFtJyB9LFxuICAgICAgeyBLZXk6ICdDb3N0Q2VudGVyJywgVmFsdWU6ICcxMjM0NScgfSxcbiAgICBdKTtcblxuICAgIC8vIEhhYmlsaXRhciBBdXRvIFNjYWxpbmcgcGFyYSBvIG1vZG8gcHJvdmlzaW9uYWRvIChzZSBhcGxpY8OhdmVsIG5vIGZ1dHVybylcbiAgICAvLyBQYXJhIFBBWV9QRVJfUkVRVUVTVCwgaXNzbyBuw6NvIMOpIG5lY2Vzc8OhcmlvLCBtYXMgbyB0ZXN0ZSBwb2RlIHNlciBhZGFwdGFkby5cblxuXG4gICAgLy8gR1NJIHBhcmEgbWFwZWFyIEFXUyBBY2NvdW50IElEIHBhcmEgbm9zc28gQ3VzdG9tZXIgSUQgKENSw41USUNPIHBhcmEgY29ycmVsYcOnw6NvKVxuICAgIHRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogJ0F3c0FjY291bnRJbmRleCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2F3c0FjY291bnRJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuSU5DTFVERSxcbiAgICAgIG5vbktleUF0dHJpYnV0ZXM6IFsnaWQnXSxcbiAgICB9KTtcblxuICAgIC8vIEdTSSBwYXJhIGJ1c2NhciBjbGllbnRlcyBhdGl2b3MgZWZpY2llbnRlbWVudGUgKG90aW1pemHDp8OjbyBkZSBzY2FuIC0+IHF1ZXJ5KVxuICAgIHRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogJ0FjdGl2ZUN1c3RvbWVySW5kZXgnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdzaycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdzdGF0dXMnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLklOQ0xVREUsXG4gICAgICBub25LZXlBdHRyaWJ1dGVzOiBbXG4gICAgICAgICdpZCcsXG4gICAgICAgICdyb2xlQXJuJyxcbiAgICAgICAgJ2F1dG9tYXRpb25TZXR0aW5ncycsXG4gICAgICAgICdzdWJzY3JpcHRpb25TdGF0dXMnLFxuICAgICAgICAnc3VwcG9ydExldmVsJyxcbiAgICAgICAgJ2V4Y2x1c2lvblRhZ3MnXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gR1NJIHBhcmEgbyBjYWxsYmFjayBkbyBvbmJvYXJkaW5nIHZpYSBFeHRlcm5hbElkXG4gICAgdGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnRXh0ZXJuYWxJZEluZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnZXh0ZXJuYWxJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuSU5DTFVERSxcbiAgICAgIG5vbktleUF0dHJpYnV0ZXM6IFsnaWQnLCAnc3RhdHVzJ10sXG4gICAgfSk7XG5cbiAgICAvLyBHU0kgcGFyYSBjb25zdWx0YXMgcG9yIHN0YXR1cyAobWVsaG9yYSBwZXJmb3JtYW5jZSBwYXJhIGluZ2VzdG9yIGUgYXV0b21hw6fDtWVzKVxuICAgIHRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogJ1N0YXR1c0luZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnc3RhdHVzJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5JTkNMVURFLFxuICAgICAgbm9uS2V5QXR0cmlidXRlczogWydzaycsICdyb2xlQXJuJywgJ2F1dG9tYXRpb24nXSxcbiAgICB9KTtcbiAgICBcbiAgICAvLyBHU0kgcGFyYSBjb25zdWx0YXIgcG9yIGNsaWVudGUgKGV4OiBpbmNpZGVudGVzLCBjbGFpbXMpXG4gICAgdGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnQ3VzdG9tZXJEYXRhSW5kZXgnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdzaycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgfSk7XG5cbiAgICAvLyBHU0kgcGFyYSBjb25zdWx0YXMgZGUgQWRtaW4gKHVzYXIgZW50aXR5L3BhcnRpdGlvbiBzaGFyZGluZyBwYXJhIHBlcmZvcm1hbmNlKVxuICAgIHRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogJ0FkbWluVmlld0luZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnZW50aXR5VHlwZScsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdjcmVhdGVkQXQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLklOQ0xVREUsXG4gICAgICBub25LZXlBdHRyaWJ1dGVzOiBbJ3N0YXR1cycsICdjcmVkaXRBbW91bnQnLCAncmVwb3J0VXJsJywgJ2luY2lkZW50SWQnLCAnYXdzQWNjb3VudElkJywgJ3N0cmlwZUludm9pY2VJZCcsICdjYXNlSWQnLCAnc3VibWlzc2lvbkVycm9yJywgJ3JlcG9ydEVycm9yJywgJ2NvbW1pc3Npb25BbW91bnQnXSxcbiAgICB9KTtcblxuICAgIC8vIEdTSSBwYXJhIE1hcmtldHBsYWNlIGN1c3RvbWVyIG1hcHBpbmdcbiAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdNYXJrZXRwbGFjZUN1c3RvbWVySW5kZXgnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdtYXJrZXRwbGFjZUN1c3RvbWVySWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLklOQ0xVREUsXG4gICAgICBub25LZXlBdHRyaWJ1dGVzOiBbJ2lkJ10sXG4gICAgfSk7XG5cbiAgICAvLyBHU0kgcGFyYSBjb25zdWx0YXMgZGUgcmVjb21lbmRhw6fDtWVzXG4gICAgdGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnUmVjb21tZW5kYXRpb25zSW5kZXgnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdzaycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxuICAgIH0pO1xuXG4gICAgLy8gUzMgQnVja2V0IHBhcmEgaG9zcGVkYXIgbyB0ZW1wbGF0ZSBkbyBDbG91ZEZvcm1hdGlvblxuICAgIGNvbnN0IHRlbXBsYXRlQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnQ2ZuVGVtcGxhdGVCdWNrZXQnLCB7XG4gICAgICB3ZWJzaXRlSW5kZXhEb2N1bWVudDogJ3RlbXBsYXRlLnlhbWwnLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiBmYWxzZSxcbiAgICAgIHZlcnNpb25lZDogdHJ1ZSwgLy8gSGFiaWxpdGFyIHZlcnNpb25hbWVudG9cbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uS01TLCAvLyBFbmNyeXB0aW9uIGNvbSBLTVMgKFRhc2sgMilcbiAgICAgIGVuY3J5cHRpb25LZXk6IHMzS21zS2V5LCAvLyBVc2FyIEtNUyBLZXkgZGVkaWNhZGEgKFRhc2sgMilcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBuZXcgczMuQmxvY2tQdWJsaWNBY2Nlc3MoeyAvLyBNYW50ZXIgYWNlc3NvIHDDumJsaWNvIHBhcmEgd2Vic2l0ZSAoQ2xvdWRGb3JtYXRpb24pXG4gICAgICAgIGJsb2NrUHVibGljQWNsczogdHJ1ZSxcbiAgICAgICAgaWdub3JlUHVibGljQWNsczogdHJ1ZSxcbiAgICAgICAgYmxvY2tQdWJsaWNQb2xpY3k6IGZhbHNlLCAvLyBQZXJtaXRlIGEgcG9sw610aWNhIGRlIHdlYnNpdGVcbiAgICAgICAgcmVzdHJpY3RQdWJsaWNCdWNrZXRzOiBmYWxzZSwgLy8gUGVybWl0ZSBhIHBvbMOtdGljYSBkZSB3ZWJzaXRlXG4gICAgICB9KSxcbiAgICAgIHB1YmxpY1JlYWRBY2Nlc3M6IHRydWUsXG4gICAgICBsaWZlY3ljbGVSdWxlczogW3tcbiAgICAgICAgaWQ6ICdEZWZhdWx0TGlmZWN5Y2xlJyxcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgZXhwaXJhdGlvbjogY2RrLkR1cmF0aW9uLmRheXMoOTApLCAvLyBFeHBpcmFyIG9iamV0b3MgYXDDs3MgOTAgZGlhc1xuICAgICAgICBub25jdXJyZW50VmVyc2lvbkV4cGlyYXRpb246IGNkay5EdXJhdGlvbi5kYXlzKDMwKSwgLy8gRXhwaXJhciB2ZXJzw7VlcyBuw6NvIGF0dWFpcyBhcMOzcyAzMCBkaWFzXG4gICAgICAgIHRyYW5zaXRpb25zOiBbe1xuICAgICAgICAgIHN0b3JhZ2VDbGFzczogczMuU3RvcmFnZUNsYXNzLklOVEVMTElHRU5UX1RJRVJJTkcsIC8vIFRyYW5zacOnw6NvIHBhcmEgSW50ZWxsaWdlbnQtVGllcmluZ1xuICAgICAgICAgIHRyYW5zaXRpb25BZnRlcjogY2RrLkR1cmF0aW9uLmRheXMoOTApLCAvLyBBcMOzcyA5MCBkaWFzXG4gICAgICAgIH1dLFxuICAgICAgICBub25jdXJyZW50VmVyc2lvblRyYW5zaXRpb25zOiBbe1xuICAgICAgICAgIHN0b3JhZ2VDbGFzczogczMuU3RvcmFnZUNsYXNzLkdMQUNJRVIsXG4gICAgICAgICAgdHJhbnNpdGlvbkFmdGVyOiBjZGsuRHVyYXRpb24uZGF5cygzMCksIC8vIEFww7NzIDMwIGRpYXNcbiAgICAgICAgfV0sXG4gICAgICB9XVxuICAgIH0pO1xuICAgIFxuICAgIC8vIEZvcsOnYSBhIGNvbmZpZ3VyYcOnw6NvIGRlIGNyaXB0b2dyYWZpYSBhdHJhdsOpcyBkbyByZWN1cnNvIEwxIChhdHVhbGl6YXIgcGFyYSBLTVMpXG4gICAgY29uc3QgY2ZuVGVtcGxhdGVCdWNrZXQgPSB0ZW1wbGF0ZUJ1Y2tldC5ub2RlLmRlZmF1bHRDaGlsZCBhcyBzMy5DZm5CdWNrZXQ7XG4gICAgY2ZuVGVtcGxhdGVCdWNrZXQuYWRkUHJvcGVydHlPdmVycmlkZSgnQnVja2V0RW5jcnlwdGlvbicsIHtcbiAgICAgIFNlcnZlclNpZGVFbmNyeXB0aW9uQ29uZmlndXJhdGlvbjogW3tcbiAgICAgICAgU2VydmVyU2lkZUVuY3J5cHRpb25CeURlZmF1bHQ6IHtcbiAgICAgICAgICBTU0VBbGdvcml0aG06ICdBRVMyNTYnLFxuICAgICAgICB9LFxuICAgICAgICBLTVNNYXN0ZXJLZXlJRDogczNLbXNLZXkua2V5QXJuLCAvLyBFc3BlY2lmaWNhciBLTVMgS2V5XG4gICAgICB9XSxcbiAgICB9KTtcbiAgICBcbiAgICAvLyBBZGljaW9uYXIgdGFncyBhbyBidWNrZXQgcmVtb3ZpZG8gcGFyYSBjb21wYXRpYmlsaWRhZGUgY29tIHRlc3Rlc1xuXG4gICAgLy8gQWRpY2lvbmFyIHBvbMOtdGljYSBwYXJhIHBlcm1pdGlyIHF1ZSBvIHNlcnZpw6dvIFMzIHVzZSBhIGNoYXZlIEtNU1xuICAgIHMzS21zS2V5LmFkZFRvUmVzb3VyY2VQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydrbXM6RW5jcnlwdCcsICdrbXM6RGVjcnlwdCcsICdrbXM6UmVFbmNyeXB0KicsICdrbXM6R2VuZXJhdGVEYXRhS2V5KicsICdrbXM6RGVzY3JpYmVLZXknXSxcbiAgICAgIHByaW5jaXBhbHM6IFtuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ3MzLmFtYXpvbmF3cy5jb20nKV0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIC8vIENvbmRpdGlvbmFsbHkgcGVyZm9ybSBkZXBsb3ltZW50IE9OTFkgaWYgbm90IGluIHRlc3QgZW52aXJvbm1lbnRcbiAgICBpZiAoIXByb3BzLmlzVGVzdEVudmlyb25tZW50KSB7XG4gICAgY29uc3QgZnMgPSByZXF1aXJlKCdmcycpO1xuXG4gICAgaWYgKGZzLmV4aXN0c1N5bmMoZG9jc1BhdGgpKSB7XG4gICAgLy8gRGVwbG95bWVudHMgYXJlIE9OTFkgY3JlYXRlZCBpbnNpZGUgdGhpcyBibG9ja1xuICAgIG5ldyBzM2RlcGxveS5CdWNrZXREZXBsb3ltZW50KHRoaXMsICdEZXBsb3lDZm5UZW1wbGF0ZScsIHtcbiAgICAgc291cmNlczogW3MzZGVwbG95LlNvdXJjZS5hc3NldChkb2NzUGF0aCldLCAvLyBBc3NldCBjYWxsIG9ubHkgaGFwcGVucyBoZXJlXG4gICAgIGluY2x1ZGU6IFsnY29zdC1ndWFyZGlhbi10ZW1wbGF0ZS55YW1sJ10sXG4gICAgIGRlc3RpbmF0aW9uS2V5UHJlZml4OiAnJyxcbiAgICAgICBkZXN0aW5hdGlvbkJ1Y2tldDogdGVtcGxhdGVCdWNrZXQsXG4gICAgICAgIH0pO1xuXG4gICAgbmV3IHMzZGVwbG95LkJ1Y2tldERlcGxveW1lbnQodGhpcywgJ0RlcGxveVRyaWFsQ2ZuVGVtcGxhdGUnLCB7XG4gICAgIHNvdXJjZXM6IFtzM2RlcGxveS5Tb3VyY2UuYXNzZXQoZG9jc1BhdGgpXSwgLy8gQXNzZXQgY2FsbCBvbmx5IGhhcHBlbnMgaGVyZVxuICAgICBpbmNsdWRlOiBbJ2Nvc3QtZ3VhcmRpYW4tVFJJQUwtdGVtcGxhdGUueWFtbCddLFxuICAgICBkZXN0aW5hdGlvbktleVByZWZpeDogJycsXG4gICAgICAgZGVzdGluYXRpb25CdWNrZXQ6IHRlbXBsYXRlQnVja2V0LFxuICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgIGNvbnNvbGUud2FybihgV2FybmluZzogRG9jcyBwYXRoIG5vdCBmb3VuZCBhdCAke2RvY3NQYXRofS4gU2tpcHBpbmcgUzMgdGVtcGxhdGUgZGVwbG95bWVudC5gKTtcbiAgICB9XG4gICAgfVxuICAgIC8vIElmIGlzVGVzdEVudmlyb25tZW50IGlzIHRydWUsIHRoZSBTb3VyY2UuYXNzZXQoKSBjYWxscyBhcmUgbmV2ZXIgbWFkZS5cblxuICAgICAvLyBFbnN1cmUgVVJMcyBwYXNzZWQgdG8gbGFtYmRhcy9vdXRwdXRzIGhhbmRsZSB0aGUgdGVzdCBjYXNlIGdyYWNlZnVsbHlcbiAgICAgY29uc3QgdHJpYWxUZW1wbGF0ZVVybCA9ICFwcm9wcy5pc1Rlc3RFbnZpcm9ubWVudCA/ICh0ZW1wbGF0ZUJ1Y2tldC5idWNrZXRXZWJzaXRlVXJsICsgJy9jb3N0LWd1YXJkaWFuLVRSSUFMLXRlbXBsYXRlLnlhbWwnKSA6ICd0ZXN0LXRyaWFsLXVybCc7XG4gICAgIGNvbnN0IGZ1bGxUZW1wbGF0ZVVybCA9ICFwcm9wcy5pc1Rlc3RFbnZpcm9ubWVudCA/ICh0ZW1wbGF0ZUJ1Y2tldC5idWNrZXRXZWJzaXRlVXJsICsgJy90ZW1wbGF0ZS55YW1sJykgOiAndGVzdC1mdWxsLXVybCc7XG5cbiAgICAvLyBWUEMgZSBTZWN1cml0eSBHcm91cCBwYXJhIExhbWJkYXMgKFRhc2sgOClcbiAgICBjb25zdCB2cGMgPSBuZXcgZWMyLlZwYyh0aGlzLCAnQ29zdEd1YXJkaWFuVnBjJywge1xuICAgICAgbWF4QXpzOiAyLCAvLyBVc2FyIDIgQVpzIHBhcmEgYWx0YSBkaXNwb25pYmlsaWRhZGVcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFtcbiAgICAgICAgeyBjaWRyTWFzazogMjQsIG5hbWU6ICdQdWJsaWMnLCBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QVUJMSUMgfSxcbiAgICAgICAgeyBjaWRyTWFzazogMjQsIG5hbWU6ICdQcml2YXRlJywgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGxhbWJkYVNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ0xhbWJkYVNlY3VyaXR5R3JvdXAnLCB7XG4gICAgICB2cGMsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FsbG93IG91dGJvdW5kIHRyYWZmaWMgZm9yIExhbWJkYXMnLFxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZSwgLy8gTGFtYmRhcyBwcmVjaXNhbSBhY2Vzc2FyIHNlcnZpw6dvcyBleHRlcm5vc1xuICAgIH0pO1xuXG4gICAgLy8gQ29nbml0byAoTWFudGlkbylcbiAgICBjb25zdCB1c2VyUG9vbCA9IG5ldyBjb2duaXRvLlVzZXJQb29sKHRoaXMsICdDb3N0R3VhcmRpYW5Qb29sJywge1xuICAgICAgc2VsZlNpZ25VcEVuYWJsZWQ6IHRydWUsXG4gICAgICBzaWduSW5BbGlhc2VzOiB7IGVtYWlsOiB0cnVlIH0sXG4gICAgICBhdXRvVmVyaWZ5OiB7IGVtYWlsOiB0cnVlIH0sXG4gICAgICBwYXNzd29yZFBvbGljeToge1xuICAgICAgICBtaW5MZW5ndGg6IDgsIC8vIFBvbMOtdGljYXMgZGUgc2VuaGEgZm9ydGVzIChUYXNrIDEwKVxuICAgICAgICByZXF1aXJlTG93ZXJjYXNlOiB0cnVlLFxuICAgICAgICByZXF1aXJlVXBwZXJjYXNlOiB0cnVlLFxuICAgICAgICByZXF1aXJlRGlnaXRzOiB0cnVlLFxuICAgICAgICByZXF1aXJlU3ltYm9sczogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgdXNlclZlcmlmaWNhdGlvbjoge1xuICAgICAgICBlbWFpbFN0eWxlOiBjb2duaXRvLlZlcmlmaWNhdGlvbkVtYWlsU3R5bGUuQ09ERSxcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIENsaWVudGUgZG8gVXNlciBQb29sIHBhcmEgYSBhcGxpY2HDp8OjbyB3ZWJcbiAgICBjb25zdCB1c2VyUG9vbENsaWVudCA9IG5ldyBjb2duaXRvLlVzZXJQb29sQ2xpZW50KHRoaXMsICdDb3N0R3VhcmRpYW5Vc2VyUG9vbENsaWVudCcsIHtcbiAgICAgIHVzZXJQb29sLFxuICAgICAgZ2VuZXJhdGVTZWNyZXQ6IGZhbHNlLCBcbiAgICB9KTtcblxuICAgIC8vIEdydXBvIGRlIGFkbWluaXN0cmFkb3JlcyBubyBDb2duaXRvXG4gICAgbmV3IGNvZ25pdG8uQ2ZuVXNlclBvb2xHcm91cCh0aGlzLCAnQWRtaW5Hcm91cCcsIHtcbiAgICAgIHVzZXJQb29sSWQ6IHVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICBncm91cE5hbWU6ICdBZG1pbnMnLFxuICAgICAgZGVzY3JpcHRpb246ICdHcnVwbyBwYXJhIGFkbWluaXN0cmFkb3JlcyBkYSBwbGF0YWZvcm1hJyxcbiAgICB9KTtcblxuICAgIC8vIDEuIExhbWJkYSBwYXJhIG8gQVBJIEdhdGV3YXkgKE1vbm9saXRvIEV4cHJlc3MpXG4gICAgY29uc3QgYXBpSGFuZGxlckxhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0FwaUhhbmRsZXInLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChiYWNrZW5kUGF0aCksXG4gICAgICBoYW5kbGVyOiAnaGFuZGxlci5hcHAnLCAvLyBleHBvcnQgZG8gZXhwcmVzcyArIHNlcnZlcmxlc3Mgw6kgZXhwb3N0byBjb21vICdhcHAnIG5vIGhhbmRsZXIuanNcbiAgICAgIC8vIENvbmZpZ3VyYcOnw7VlcyBkZSBWUEMgKFRhc2sgOClcbiAgICAgIHZwYyxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbbGFtYmRhU2VjdXJpdHlHcm91cF0sXG4gICAgICB2cGNTdWJuZXRzOiB7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfSxcbiAgICAgIG1lbW9yeVNpemU6IDEwMjQsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygyOSksIC8vIExpZ2VpcmFtZW50ZSBtZW5vciBxdWUgbyB0aW1lb3V0IGRhIEFQSSBHV1xuICAgICAgbG9nR3JvdXA6IG5ldyBjZGsuYXdzX2xvZ3MuTG9nR3JvdXAodGhpcywgJ0FwaUhhbmRsZXJMb2dHcm91cCcsIHtcbiAgICAgIHJldGVudGlvbjogY2RrLmF3c19sb2dzLlJldGVudGlvbkRheXMuT05FX1lFQVIsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgZW5jcnlwdGlvbktleTogbG9nS21zS2V5LFxuICAgICAgfSksXG4gICAgICByZXNlcnZlZENvbmN1cnJlbnRFeGVjdXRpb25zOiAxMDAsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBMT0dfTEVWRUw6IHByb3BzLmlzVGVzdEVudmlyb25tZW50ID8gJ0RFQlVHJyA6ICdJTkZPJyxcbiAgICAgICAgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgU1RSSVBFX1NFQ1JFVF9BUk46IHN0cmlwZVNlY3JldC5zZWNyZXRBcm4sXG4gICAgICAgIFNUUklQRV9XRUJIT09LX1NFQ1JFVF9BUk46IHN0cmlwZVdlYmhvb2tTZWNyZXQuc2VjcmV0QXJuLFxuICAgICAgICBVU0VSX1BPT0xfSUQ6IHVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICAgIFVTRVJfUE9PTF9DTElFTlRfSUQ6IHVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXG4gICAgICAgIFBMQVRGT1JNX0FDQ09VTlRfSUQ6IHRoaXMuYWNjb3VudCB8fCBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9BQ0NPVU5ULFxuICAgICAgICBUUklBTF9URU1QTEFURV9VUkw6IHRyaWFsVGVtcGxhdGVVcmwsXG4gICAgICAgIEZVTExfVEVNUExBVEVfVVJMOiBmdWxsVGVtcGxhdGVVcmwsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gUmVmaW5hciBwZXJtaXNzw7VlcyBkbyBBcGlIYW5kbGVyIHBhcmEgRHluYW1vREIgKFRhc2sgNClcbiAgICAvLyBTdWJzdGl0dWkgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGFwaUhhbmRsZXJMYW1iZGEpO1xuICAgIGFwaUhhbmRsZXJMYW1iZGEuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnZHluYW1vZGI6UHV0SXRlbScsICdkeW5hbW9kYjpVcGRhdGVJdGVtJywgJ2R5bmFtb2RiOlF1ZXJ5JywgJ2R5bmFtb2RiOkdldEl0ZW0nLCAnZHluYW1vZGI6U2NhbiddLFxuICAgICAgcmVzb3VyY2VzOiBbdGFibGUudGFibGVBcm4sIGAke3RhYmxlLnRhYmxlQXJufS9pbmRleC8qYF0sXG4gICAgfSkpO1xuICAgIFxuICAgIHN0cmlwZVNlY3JldC5ncmFudFJlYWQoYXBpSGFuZGxlckxhbWJkYSk7XG4gICAgLy8gR3JhbnQgdGhlIEFQSSBoYW5kbGVyIHBlcm1pc3Npb24gdG8gcmVhZCB0aGUgd2ViaG9vayBzZWNyZXRcbiAgICBzdHJpcGVXZWJob29rU2VjcmV0LmdyYW50UmVhZChhcGlIYW5kbGVyTGFtYmRhKTtcblxuICAgIC8vIDIuIExhbWJkYSBwYXJhIG8gRXZlbnRCcmlkZ2UgKENvcnJlbGFjaW9uYXIgRXZlbnRvcyBIZWFsdGgpXG4gICAgY29uc3QgaGVhbHRoRXZlbnRIYW5kbGVyTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnSGVhbHRoRXZlbnRIYW5kbGVyJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiAnSGVhbHRoRXZlbnRIYW5kbGVyJywgLy8gTm9tZSBleHBsw61jaXRvIHBhcmEgZmFjaWxpdGFyIG8gZGVidWdcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KGJhY2tlbmRGdW5jdGlvbnNQYXRoKSxcbiAgICAgIGhhbmRsZXI6ICdjb3JyZWxhdGUtaGVhbHRoLmhhbmRsZXInLFxuICAgICAgLy8gQ29uZmlndXJhw6fDtWVzIGRlIFZQQyAoVGFzayA4KVxuICAgICAgdnBjLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IFtsYW1iZGFTZWN1cml0eUdyb3VwXSxcbiAgICAgIHZwY1N1Ym5ldHM6IHsgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyB9LFxuICAgICAgbG9nR3JvdXA6IG5ldyBjZGsuYXdzX2xvZ3MuTG9nR3JvdXAodGhpcywgJ0hlYWx0aEV2ZW50SGFuZGxlckxvZ0dyb3VwJywge1xuICAgICAgICByZXRlbnRpb246IGNkay5hd3NfbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgZW5jcnlwdGlvbktleTogbG9nS21zS2V5LFxuICAgICAgfSksXG4gICAgICByZXNlcnZlZENvbmN1cnJlbnRFeGVjdXRpb25zOiAyMCxcbiAgICAgIC8vIEEgcmVtb8Onw6NvIGRlICdleHRlcm5hbE1vZHVsZXMnIHBlcm1pdGUgcXVlIG8gZXNidWlsZCBlbXBhY290ZSBhcyBkZXBlbmTDqm5jaWFzIGRvIFNESyB2My5cbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUsXG4gICAgICAgIFNGTl9BUk46ICcnLCAvLyBTZXLDoSBwcmVlbmNoaWRvIGFiYWl4b1xuICAgICAgfSxcbiAgICB9KTtcbiAgICB0YWJsZS5ncmFudFJlYWRXcml0ZURhdGEoaGVhbHRoRXZlbnRIYW5kbGVyTGFtYmRhKTtcblxuICAgIC8vIExhbWJkYSBwYXJhIGV4ZWN1w6fDo28gZGUgcmVjb21lbmRhw6fDtWVzXG4gICAgY29uc3QgZXhlY3V0ZVJlY29tbWVuZGF0aW9uTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnRXhlY3V0ZVJlY29tbWVuZGF0aW9uJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiAnRXhlY3V0ZVJlY29tbWVuZGF0aW9uJyxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgaGFuZGxlcjogJ2V4ZWN1dGUtcmVjb21tZW5kYXRpb24uaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoYmFja2VuZEZ1bmN0aW9uc1BhdGgpLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAvLyBDb25maWd1cmHDp8O1ZXMgZGUgVlBDIChUYXNrIDgpXG4gICAgICB2cGMsICAgICAgXG4gICAgICBzZWN1cml0eUdyb3VwczogW2xhbWJkYVNlY3VyaXR5R3JvdXBdLFxuICAgICAgdnBjU3VibmV0czogeyBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTIH0sXG4gICAgICBsb2dHcm91cDogbmV3IGNkay5hd3NfbG9ncy5Mb2dHcm91cCh0aGlzLCAnRXhlY3V0ZVJlY29tbWVuZGF0aW9uTG9nR3JvdXAnLCB7XG4gICAgICAgIHJldGVudGlvbjogY2RrLmF3c19sb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgICBlbmNyeXB0aW9uS2V5OiBsb2dLbXNLZXksXG4gICAgICB9KSxcbiAgICAgIHJlc2VydmVkQ29uY3VycmVudEV4ZWN1dGlvbnM6IDEwLFxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBQZXJtaXNzw7VlcyBwYXJhIG8gTGFtYmRhIGRlIHJlY29tZW5kYcOnw7Vlc1xuICAgIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShleGVjdXRlUmVjb21tZW5kYXRpb25MYW1iZGEpO1xuICAgIGV4ZWN1dGVSZWNvbW1lbmRhdGlvbkxhbWJkYS5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydzdHM6QXNzdW1lUm9sZSddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSwgLy8gTyBMYW1iZGEgcHJlY2lzYSBwb2RlciBhc3N1bWlyIGEgcm9sZSBkbyBjbGllbnRlXG4gICAgfSkpO1xuXG4gICAgLy8gRGFyIGFvIEFwaUhhbmRsZXIgbyBBUk4gZSBvIE5BTUUgZG8gbGFtYmRhIGRlIGV4ZWN1w6fDo28gZSBwZXJtaXRpciBpbnZvY2HDp8Ojb1xuICAgIGFwaUhhbmRsZXJMYW1iZGEuYWRkRW52aXJvbm1lbnQoJ0VYRUNVVEVfUkVDT01NRU5EQVRJT05fTEFNQkRBX0FSTicsIGV4ZWN1dGVSZWNvbW1lbmRhdGlvbkxhbWJkYS5mdW5jdGlvbkFybik7XG4gICAgYXBpSGFuZGxlckxhbWJkYS5hZGRFbnZpcm9ubWVudCgnRVhFQ1VURV9SRUNPTU1FTkRBVElPTl9MQU1CREFfTkFNRScsIGV4ZWN1dGVSZWNvbW1lbmRhdGlvbkxhbWJkYS5mdW5jdGlvbk5hbWUpO1xuICAgIGV4ZWN1dGVSZWNvbW1lbmRhdGlvbkxhbWJkYS5ncmFudEludm9rZShhcGlIYW5kbGVyTGFtYmRhKTtcblxuICAgIC8vIDMuIExhbWJkYXMgcGFyYSBhcyBUYXJlZmFzIGRvIFN0ZXAgRnVuY3Rpb25zXG4gICAgY29uc3Qgc2xhQ2FsY3VsYXRlSW1wYWN0TGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnU2xhQ2FsY3VsYXRlSW1wYWN0Jywge1xuICAgICAgZnVuY3Rpb25OYW1lOiAnU2xhQ2FsY3VsYXRlSW1wYWN0JyxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KGJhY2tlbmRGdW5jdGlvbnNQYXRoKSxcbiAgICAgIGhhbmRsZXI6ICdzbGEtd29ya2Zsb3cuY2FsY3VsYXRlSW1wYWN0JyxcbiAgICAgIC8vIENvbmZpZ3VyYcOnw7VlcyBkZSBWUEMgKFRhc2sgOClcbiAgICAgIHZwYyxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbbGFtYmRhU2VjdXJpdHlHcm91cF0sXG4gICAgICB2cGNTdWJuZXRzOiB7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfSxcbiAgICAgIGxvZ0dyb3VwOiBuZXcgY2RrLmF3c19sb2dzLkxvZ0dyb3VwKHRoaXMsICdTbGFDYWxjdWxhdGVJbXBhY3RMb2dHcm91cCcsIHtcbiAgICAgICAgcmV0ZW50aW9uOiBjZGsuYXdzX2xvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgIGVuY3J5cHRpb25LZXk6IGxvZ0ttc0tleSxcbiAgICAgIH0pLFxuICAgICAgcmVzZXJ2ZWRDb25jdXJyZW50RXhlY3V0aW9uczogMTAsXG4gICAgICAvLyBBIHJlbW/Dp8OjbyBkZSAnZXh0ZXJuYWxNb2R1bGVzJyBwZXJtaXRlIHF1ZSBvIGVzYnVpbGQgZW1wYWNvdGUgYXMgZGVwZW5kw6puY2lhcyBkbyBTREsgdjMuXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lLFxuICAgICAgfSxcbiAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnU2xhQ2FsY1JvbGUnLCB7XG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKVxuICAgICAgICBdLFxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICAgIEFzc3VtZUFuZFN1cHBvcnRQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgICAgc3RhdGVtZW50czogW25ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgYWN0aW9uczogWydzdHM6QXNzdW1lUm9sZSddLFxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnYXJuOmF3czppYW06Oio6cm9sZS9Db3N0R3VhcmRpYW5EZWxlZ2F0ZWRSb2xlJ10sIFxuICAgICAgICAgICAgfSldXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9KTtcbiAgLy8gR2FyYW50aXIgcGVybWlzc8O1ZXMgYW8gRHluYW1vREIgcGFyYSBhIExhbWJkYSBkZSBjw6FsY3VsbyBkZSBpbXBhY3RvXG4gIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShzbGFDYWxjdWxhdGVJbXBhY3RMYW1iZGEpO1xuICAgIFxuICAgIGNvbnN0IHNsYUNoZWNrTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnU2xhQ2hlY2snLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6ICdTbGFDaGVjaycsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChiYWNrZW5kRnVuY3Rpb25zUGF0aCksXG4gICAgICBoYW5kbGVyOiAnc2xhLXdvcmtmbG93LmNoZWNrU0xBJyxcbiAgICAgIC8vIENvbmZpZ3VyYcOnw7VlcyBkZSBWUEMgKFRhc2sgOClcbiAgICAgIHZwYyxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbbGFtYmRhU2VjdXJpdHlHcm91cF0sXG4gICAgICB2cGNTdWJuZXRzOiB7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfSxcbiAgICAgIGxvZ0dyb3VwOiBuZXcgY2RrLmF3c19sb2dzLkxvZ0dyb3VwKHRoaXMsICdTbGFDaGVja0xvZ0dyb3VwJywge1xuICAgICAgICByZXRlbnRpb246IGNkay5hd3NfbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgZW5jcnlwdGlvbktleTogbG9nS21zS2V5LFxuICAgICAgfSksXG4gICAgICByZXNlcnZlZENvbmN1cnJlbnRFeGVjdXRpb25zOiAxMCxcbiAgICAgIC8vIEEgcmVtb8Onw6NvIGRlICdleHRlcm5hbE1vZHVsZXMnIHBlcm1pdGUgcXVlIG8gZXNidWlsZCBlbXBhY290ZSBhcyBkZXBlbmTDqm5jaWFzIGRvIFNESyB2My5cbiAgICAgIGVudmlyb25tZW50OiB7IERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHNsYUdlbmVyYXRlUmVwb3J0TGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnU2xhR2VuZXJhdGVSZXBvcnQnLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6ICdTbGFHZW5lcmF0ZVJlcG9ydCcsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChiYWNrZW5kRnVuY3Rpb25zUGF0aCksXG4gICAgICBoYW5kbGVyOiAnc2xhLXdvcmtmbG93LmdlbmVyYXRlUmVwb3J0JyxcbiAgICAgIC8vIENvbmZpZ3VyYcOnw7VlcyBkZSBWUEMgKFRhc2sgOClcbiAgICAgIHZwYyxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbbGFtYmRhU2VjdXJpdHlHcm91cF0sXG4gICAgICB2cGNTdWJuZXRzOiB7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfSxcbiAgICAgIGxvZ0dyb3VwOiBuZXcgY2RrLmF3c19sb2dzLkxvZ0dyb3VwKHRoaXMsICdTbGFHZW5lcmF0ZVJlcG9ydExvZ0dyb3VwJywge1xuICAgICAgICByZXRlbnRpb246IGNkay5hd3NfbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgZW5jcnlwdGlvbktleTogbG9nS21zS2V5LFxuICAgICAgfSksXG4gICAgICByZXNlcnZlZENvbmN1cnJlbnRFeGVjdXRpb25zOiAxMCxcbiAgICAgIC8vIEEgcmVtb8Onw6NvIGRlICdleHRlcm5hbE1vZHVsZXMnIHBlcm1pdGUgcXVlIG8gZXNidWlsZCBlbXBhY290ZSBhcyBkZXBlbmTDqm5jaWFzIGRvIFNESyB2My5cbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUsXG4gICAgICAgIFNUUklQRV9TRUNSRVRfQVJOOiBzdHJpcGVTZWNyZXQuc2VjcmV0QXJuLFxuICAgICAgICBSRVBPUlRTX0JVQ0tFVF9OQU1FOiAnJywgLy8gU2Vyw6EgcHJlZW5jaGlkbyBhYmFpeG9cbiAgICAgIH0sXG4gICAgfSk7XG4gICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHNsYUdlbmVyYXRlUmVwb3J0TGFtYmRhKTtcbiAgICBzdHJpcGVTZWNyZXQuZ3JhbnRSZWFkKHNsYUdlbmVyYXRlUmVwb3J0TGFtYmRhKTtcbiAgLy8gR3JhbnQgdGhlIHJlcG9ydCBnZW5lcmF0b3IgTGFtYmRhIGFjY2VzcyB0byB0aGUgd2ViaG9vayBzZWNyZXQgaWYgbmVlZGVkXG4gIHN0cmlwZVdlYmhvb2tTZWNyZXQuZ3JhbnRSZWFkKHNsYUdlbmVyYXRlUmVwb3J0TGFtYmRhKTtcblxuICAgIC8vIENyaWFyIGJ1Y2tldCBTMyBwYXJhIGFybWF6ZW5hciByZWxhdMOzcmlvcyBQREYgZ2VyYWRvcyBwZWxhIExhbWJkYVxuICAgIGNvbnN0IHJlcG9ydHNCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdSZXBvcnRzQnVja2V0Jywge1xuICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTiwgLy8gUkVUQUlOIHRvIGF2b2lkIGF1dG9EZWxldGVPYmplY3RzIGN1c3RvbSByZXNvdXJjZSBpc3N1ZXMgaW4gdGVzdHNcbiAgICBhdXRvRGVsZXRlT2JqZWN0czogZmFsc2UsXG4gICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCwgLy8gQmxvcXVlYXIgdG9kbyBhY2Vzc28gcMO6YmxpY28gKFRhc2sgMilcbiAgICAgIHZlcnNpb25lZDogdHJ1ZSxcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uS01TLCAvLyBFbmNyeXB0aW9uIGNvbSBLTVMgKFRhc2sgMilcbiAgICAgIGVuY3J5cHRpb25LZXk6IHMzS21zS2V5LCAvLyBVc2FyIEtNUyBLZXkgZGVkaWNhZGEgKFRhc2sgMilcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbe1xuICAgICAgICBpZDogJ0RlZmF1bHRMaWZlY3ljbGUnLFxuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBleHBpcmF0aW9uOiBjZGsuRHVyYXRpb24uZGF5cygzNjUpLFxuICAgICAgICBub25jdXJyZW50VmVyc2lvbkV4cGlyYXRpb246IGNkay5EdXJhdGlvbi5kYXlzKDkwKSxcbiAgICAgICAgdHJhbnNpdGlvbnM6IFt7XG4gICAgICAgICAgc3RvcmFnZUNsYXNzOiBzMy5TdG9yYWdlQ2xhc3MuSU5GUkVRVUVOVF9BQ0NFU1MsXG4gICAgICAgICAgdHJhbnNpdGlvbkFmdGVyOiBjZGsuRHVyYXRpb24uZGF5cyg5MCksIC8vIEFww7NzIDkwIGRpYXNcbiAgICAgICAgfV0sXG4gICAgICAgIG5vbmN1cnJlbnRWZXJzaW9uVHJhbnNpdGlvbnM6IFt7XG4gICAgICAgICAgc3RvcmFnZUNsYXNzOiBzMy5TdG9yYWdlQ2xhc3MuR0xBQ0lFUixcbiAgICAgICAgICB0cmFuc2l0aW9uQWZ0ZXI6IGNkay5EdXJhdGlvbi5kYXlzKDMwKSxcbiAgICAgICAgfV0sXG4gICAgICB9XVxuICAgIH0pO1xuICAgIFxuICAgIC8vIEZvcsOnYSBhIGNvbmZpZ3VyYcOnw6NvIGRlIGNyaXB0b2dyYWZpYSBhdHJhdsOpcyBkbyByZWN1cnNvIEwxXG4gICAgY29uc3QgY2ZuUmVwb3J0c0J1Y2tldCA9IHJlcG9ydHNCdWNrZXQubm9kZS5kZWZhdWx0Q2hpbGQgYXMgczMuQ2ZuQnVja2V0O1xuICAgIGNmblJlcG9ydHNCdWNrZXQuYWRkUHJvcGVydHlPdmVycmlkZSgnQnVja2V0RW5jcnlwdGlvbicsIHtcbiAgICAgIFNlcnZlclNpZGVFbmNyeXB0aW9uQ29uZmlndXJhdGlvbjogW3tcbiAgICAgICAgU2VydmVyU2lkZUVuY3J5cHRpb25CeURlZmF1bHQ6IHtcbiAgICAgICAgICBTU0VBbGdvcml0aG06ICdBRVMyNTYnLFxuICAgICAgICB9LFxuICAgICAgICBLTVNNYXN0ZXJLZXlJRDogczNLbXNLZXkua2V5QXJuLCAvLyBFc3BlY2lmaWNhciBLTVMgS2V5XG4gICAgICB9XSxcbiAgICB9KTtcbiAgICBcbiAgICAvLyBBZGljaW9uYXIgdGFncyBhbyBidWNrZXRcbiAgICBjZGsuVGFncy5vZihyZXBvcnRzQnVja2V0KS5hZGQoJ0Vudmlyb25tZW50JywgcHJvcHMuaXNUZXN0RW52aXJvbm1lbnQgPyAnVGVzdCcgOiAnUHJvZHVjdGlvbicpO1xuICAgIGNkay5UYWdzLm9mKHJlcG9ydHNCdWNrZXQpLmFkZCgnUHJvamVjdCcsICdDb3N0R3VhcmRpYW4nKTtcblxuICAgIC8vIEZvcm5lY2VyIG8gbm9tZSBkbyBidWNrZXQgY29tbyB2YXJpw6F2ZWwgZGUgYW1iaWVudGUgcGFyYSBhIExhbWJkYSAoYXR1YWxpemEpXG4gICAgc2xhR2VuZXJhdGVSZXBvcnRMYW1iZGEuYWRkRW52aXJvbm1lbnQoJ1JFUE9SVFNfQlVDS0VUX05BTUUnLCByZXBvcnRzQnVja2V0LmJ1Y2tldE5hbWUpO1xuXG4gICAgLy8gUGVybWlzc8O1ZXMgbmVjZXNzw6FyaWFzIHBhcmEgYSBMYW1iZGEgZXNjcmV2ZXIgb2JqZXRvcyBubyBidWNrZXRcbiAgICByZXBvcnRzQnVja2V0LmdyYW50UHV0KHNsYUdlbmVyYXRlUmVwb3J0TGFtYmRhKTtcblxuICAgIGNvbnN0IHNsYVN1Ym1pdFRpY2tldExhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1NsYVN1Ym1pdFRpY2tldCcsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ1NsYVN1Ym1pdFRpY2tldCcsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChiYWNrZW5kRnVuY3Rpb25zUGF0aCksXG4gICAgICBoYW5kbGVyOiAnc2xhLXdvcmtmbG93LnN1Ym1pdFN1cHBvcnRUaWNrZXQnLFxuICAgICAgLy8gQ29uZmlndXJhw6fDtWVzIGRlIFZQQyAoVGFzayA4KVxuICAgICAgdnBjLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IFtsYW1iZGFTZWN1cml0eUdyb3VwXSxcbiAgICAgIHZwY1N1Ym5ldHM6IHsgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyB9LFxuICAgICAgbG9nR3JvdXA6IG5ldyBjZGsuYXdzX2xvZ3MuTG9nR3JvdXAodGhpcywgJ1NsYVN1Ym1pdFRpY2tldExvZ0dyb3VwJywge1xuICAgICAgICByZXRlbnRpb246IGNkay5hd3NfbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgZW5jcnlwdGlvbktleTogbG9nS21zS2V5LFxuICAgICAgfSksXG4gICAgICByZXNlcnZlZENvbmN1cnJlbnRFeGVjdXRpb25zOiAxMCxcbiAgICAgIC8vIEEgcmVtb8Onw6NvIGRlICdleHRlcm5hbE1vZHVsZXMnIHBlcm1pdGUgcXVlIG8gZXNidWlsZCBlbXBhY290ZSBhcyBkZXBlbmTDqm5jaWFzIGRvIFNESyB2My5cbiAgICAgIGVudmlyb25tZW50OiB7IERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUgfSxcbiAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnU2xhU3VibWl0Um9sZScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpXG4gICAgICAgIF0sXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgICAgQXNzdW1lQW5kU3VwcG9ydFBvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICBhY3Rpb25zOiBbJ3N0czpBc3N1bWVSb2xlJ10sXG4gICAgICAgICAgICAgIHJlc291cmNlczogWydhcm46YXdzOmlhbTo6Kjpyb2xlL0Nvc3RHdWFyZGlhbkRlbGVnYXRlZFJvbGUnXSxcbiAgICAgICAgICAgIH0pXVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSk7XG4gICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHNsYVN1Ym1pdFRpY2tldExhbWJkYSk7XG4gICAgXG4gICAgLy8gT2J0ZXIgbyBldmVudCBidXMgcGFkcsOjbyBkYSBwbGF0YWZvcm1hXG4gICAgY29uc3QgZXZlbnRCdXMgPSBldmVudHMuRXZlbnRCdXMuZnJvbUV2ZW50QnVzTmFtZSh0aGlzLCAnRGVmYXVsdEJ1cycsICdkZWZhdWx0Jyk7XG5cbiAgICAvLyBQb2zDrXRpY2EgcGFyYSBvIEV2ZW50IEJ1czogcmVzdHJpbmdlIHF1ZW0gcG9kZSBjaGFtYXIgUHV0RXZlbnRzIHVzYW5kbyBhIHNpbnRheGUgbW9kZXJuYVxuICAgIG5ldyBldmVudHMuQ2ZuRXZlbnRCdXNQb2xpY3kodGhpcywgJ0V2ZW50QnVzUG9saWN5Jywge1xuICAgICAgZXZlbnRCdXNOYW1lOiBldmVudEJ1cy5ldmVudEJ1c05hbWUsXG4gICAgICBzdGF0ZW1lbnRJZDogJ0FsbG93Q2xpZW50SGVhbHRoRXZlbnRzJyxcbiAgICAgIHN0YXRlbWVudDogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBFZmZlY3Q6ICdBbGxvdycsXG4gICAgICAgIFByaW5jaXBhbDogJyonLFxuICAgICAgICBBY3Rpb246ICdldmVudHM6UHV0RXZlbnRzJyxcbiAgICAgICAgUmVzb3VyY2U6IGV2ZW50QnVzLmV2ZW50QnVzQXJuLFxuICAgICAgICBDb25kaXRpb246IHtcbiAgICAgICAgICBTdHJpbmdFcXVhbHM6IHtcbiAgICAgICAgICAgICdhd3M6UHJpbmNpcGFsQXJuJzogJ2Fybjphd3M6aWFtOjoqOnJvbGUvRXZlbnRCdXNSb2xlJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICAvLyAtLS0gSU7DjUNJTyBEQSBDT1JSRcOHw4NPIC0tLVxuICAgIC8vIFJFTU9WQSBlc3RlIGJsb2NvLiBBIGZpbHRyYWdlbSBkZSAnZXZlbnRzOnNvdXJjZScgw6kgZmVpdGFcbiAgICAvLyBwZWxhICdoZWFsdGhSdWxlJyBhYmFpeG8sIG7Do28gcGVsYSBwb2zDrXRpY2EgZG8gYmFycmFtZW50by5cbiAgICAvKlxuICAgIGV2ZW50QnVzUG9saWN5LmFkZFByb3BlcnR5T3ZlcnJpZGUoJ0NvbmRpdGlvbicsIHtcbiAgICAgIFR5cGU6ICdTdHJpbmdFcXVhbHMnLFxuICAgICAgS2V5OiAnZXZlbnRzOnNvdXJjZScsXG4gICAgICBWYWx1ZTogJ2F3cy5oZWFsdGgnLFxuICAgIH0pO1xuICAgICovXG4gICAgLy8gLS0tIEZJTSBEQSBDT1JSRcOHw4NPIC0tLVxuXG4gICAgLy8gRXZlbnRCcmlkZ2UgSGVhbHRoIChFc3RhIMOpIGEgcmVncmEgZGUgRklMVFJBR0VNIGNvcnJldGEpXG4gICAgbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdIZWFsdGhFdmVudFJ1bGUnLCB7XG4gICAgICBldmVudFBhdHRlcm46IHtcbiAgICAgICAgc291cmNlOiBbJ2F3cy5oZWFsdGgnXSwgLy8gQSBmaWx0cmFnZW0gYWNvbnRlY2UgYXF1aVxuICAgICAgICBkZXRhaWxUeXBlOiBbJ0FXUyBIZWFsdGggRXZlbnQnXSxcbiAgICAgIH0sXG4gICAgICBldmVudEJ1cyxcbiAgICAgIHRhcmdldHM6IFtuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihoZWFsdGhFdmVudEhhbmRsZXJMYW1iZGEpXSxcbiAgICB9KTtcblxuICAvLyAtLS0gQmxvY28gMjogSW5nZXN0w6NvIGRpw6FyaWEgZGUgY3VzdG9zIChGYXNlIDE6IFZpc2liaWxpZGFkZSkgLS0tXG4gIC8vIFRvcGljIFNOUyBwYXJhIGFsZXJ0YXMgZGUgYW5vbWFsaWEgKEZhc2UgNylcbiAgY29uc3QgYW5vbWFseUFsZXJ0c1RvcGljID0gbmV3IHNucy5Ub3BpYyh0aGlzLCAnQW5vbWFseUFsZXJ0c1RvcGljJyk7XG4gICAgLy8gNC4xLiBDcmllIHVtIG5vdm8gTGFtYmRhIHBhcmEgaW5nZXN0w6NvIGRpw6FyaWEgZGUgY3VzdG9zXG4gICAgY29uc3QgY29zdEluZ2VzdG9yTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnQ29zdEluZ2VzdG9yJywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoYmFja2VuZEZ1bmN0aW9uc1BhdGgpLFxuICAgICAgaGFuZGxlcjogJ2luZ2VzdC1jb3N0cy5oYW5kbGVyJyxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgLy8gQ29uZmlndXJhw6fDtWVzIGRlIFZQQyAoVGFzayA4KVxuICAgICAgdnBjLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IFtsYW1iZGFTZWN1cml0eUdyb3VwXSxcbiAgICAgIHZwY1N1Ym5ldHM6IHsgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyB9LFxuICAgICAgbG9nR3JvdXA6IG5ldyBjZGsuYXdzX2xvZ3MuTG9nR3JvdXAodGhpcywgJ0Nvc3RJbmdlc3RvckxvZ0dyb3VwJywge1xuICAgICAgICByZXRlbnRpb246IGNkay5hd3NfbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgZW5jcnlwdGlvbktleTogbG9nS21zS2V5LFxuICAgICAgfSksXG4gICAgICByZXNlcnZlZENvbmN1cnJlbnRFeGVjdXRpb25zOiA1LFxuICAgICAgLy8gQSByZW1vw6fDo28gZGUgJ2V4dGVybmFsTW9kdWxlcycgcGVybWl0ZSBxdWUgbyBlc2J1aWxkIGVtcGFjb3RlIGFzIGRlcGVuZMOqbmNpYXMgZG8gU0RLIHYzLlxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgU05TX1RPUElDX0FSTjogYW5vbWFseUFsZXJ0c1RvcGljLnRvcGljQXJuLFxuICAgICAgfSxcbiAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnQ29zdEluZ2VzdG9yUm9sZScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpXG4gICAgICAgIF0sXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgICAgRHluYW1vQW5kQXNzdW1lUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsnZHluYW1vZGI6U2NhbiddLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW3RhYmxlLnRhYmxlQXJuLCBgJHt0YWJsZS50YWJsZUFybn0vaW5kZXgvKmBdLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsnc3RzOkFzc3VtZVJvbGUnXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnYXJuOmF3czppYW06Oio6cm9sZS9Db3N0R3VhcmRpYW5EZWxlZ2F0ZWRSb2xlJ10sXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgXVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSk7XG4gICAgdGFibGUuZ3JhbnRSZWFkRGF0YShjb3N0SW5nZXN0b3JMYW1iZGEpO1xuXG4gIC8vIFBlcm1pdGlyIHF1ZSBvIGluZ2VzdG9yIHB1YmxpcXVlIGFsZXJ0YXMgbm8gdMOzcGljbyBTTlNcbiAgYW5vbWFseUFsZXJ0c1RvcGljLmdyYW50UHVibGlzaChjb3N0SW5nZXN0b3JMYW1iZGEpO1xuXG4gICAgLy8gNC4yLiBDcmllIHVtYSByZWdyYSBkbyBFdmVudEJyaWRnZSBwYXJhIGFjaW9uYXIgbyBpbmdlc3RvciBkaWFyaWFtZW50ZVxuICAgIG5ldyBldmVudHMuUnVsZSh0aGlzLCAnRGFpbHlDb3N0SW5nZXN0aW9uUnVsZScsIHtcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUuY3Jvbih7IG1pbnV0ZTogJzAnLCBob3VyOiAnNScgfSksIC8vIFRvZG8gZGlhIMOgcyAwNTowMCBVVENcbiAgICAgIHRhcmdldHM6IFtuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihjb3N0SW5nZXN0b3JMYW1iZGEpXSxcbiAgICB9KTtcblxuICAgIC8vIC0tLSBCbG9jbyAzOiBBdXRvbWHDp8OjbyBBdGl2YSAoRmFzZSAyKSAtLS1cbiAgICAvLyA3LjEuIExhbWJkYXMgcGFyYSB0YXJlZmFzIGRlIGF1dG9tYcOnw6NvXG4gICAgY29uc3Qgc3RvcElkbGVJbnN0YW5jZXNMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdTdG9wSWRsZUluc3RhbmNlcycsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KGJhY2tlbmRGdW5jdGlvbnNQYXRoKSxcbiAgICAgIGhhbmRsZXI6ICdleGVjdXRlLXJlY29tbWVuZGF0aW9uLmhhbmRsZXInLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAvLyBDb25maWd1cmHDp8O1ZXMgZGUgVlBDIChUYXNrIDgpXG4gICAgICB2cGMsXG4gICAgICBzZWN1cml0eUdyb3VwczogW2xhbWJkYVNlY3VyaXR5R3JvdXBdLFxuICAgICAgdnBjU3VibmV0czogeyBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTIH0sXG4gICAgICBsb2dHcm91cDogbmV3IGNkay5hd3NfbG9ncy5Mb2dHcm91cCh0aGlzLCAnU3RvcElkbGVJbnN0YW5jZXNMb2dHcm91cCcsIHtcbiAgICAgICAgcmV0ZW50aW9uOiBjZGsuYXdzX2xvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgIGVuY3J5cHRpb25LZXk6IGxvZ0ttc0tleSxcbiAgICAgIH0pLFxuICAgICAgcmVzZXJ2ZWRDb25jdXJyZW50RXhlY3V0aW9uczogMTAsXG4gICAgICBlbnZpcm9ubWVudDogeyBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lIH0sXG4gICAgICByb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ1N0b3BJZGxlUm9sZScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW2lhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpXSxcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcbiAgICAgICAgICBEeW5hbW9Qb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoeyBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7IGFjdGlvbnM6IFsnZHluYW1vZGI6UXVlcnknLCdkeW5hbW9kYjpTY2FuJywnZHluYW1vZGI6R2V0SXRlbScsJ2R5bmFtb2RiOlB1dEl0ZW0nXSwgcmVzb3VyY2VzOiBbdGFibGUudGFibGVBcm4sIGAke3RhYmxlLnRhYmxlQXJufS9pbmRleC8qYF0gfSksXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7IGFjdGlvbnM6IFsnc3RzOkFzc3VtZVJvbGUnXSwgcmVzb3VyY2VzOiBbJ2Fybjphd3M6aWFtOjoqOnJvbGUvQ29zdEd1YXJkaWFuRGVsZWdhdGVkUm9sZSddIH0pLFxuICAgICAgICAgIF19KVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pO1xuICAgIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShzdG9wSWRsZUluc3RhbmNlc0xhbWJkYSk7XG5cbiAgICBjb25zdCByZWNvbW1lbmRSZHNJZGxlTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnUmVjb21tZW5kUmRzSWRsZScsIHtcbiAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoYmFja2VuZEZ1bmN0aW9uc1BhdGgpLFxuICAgIGhhbmRsZXI6ICdyZWNvbW1lbmQtcmRzLWlkbGUuaGFuZGxlcicsXG4gICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgLy8gQ29uZmlndXJhw6fDtWVzIGRlIFZQQyAoVGFzayA4KVxuICAgIHZwYyxcbiAgICBzZWN1cml0eUdyb3VwczogW2xhbWJkYVNlY3VyaXR5R3JvdXBdLFxuICAgIHZwY1N1Ym5ldHM6IHsgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyB9LFxuICAgIHJlc2VydmVkQ29uY3VycmVudEV4ZWN1dGlvbnM6IDEwLCAvLyBDb3JyaWdpZG86IGxvZ0dyb3VwIG7Do28gw6kgdW1hIHByb3ByaWVkYWRlIGRpcmV0YVxuICAgIGxvZ0dyb3VwOiBuZXcgY2RrLmF3c19sb2dzLkxvZ0dyb3VwKHRoaXMsICdSZWNvbW1lbmRSZHNJZGxlTG9nR3JvdXAnLCB7XG4gICAgICByZXRlbnRpb246IGNkay5hd3NfbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBlbmNyeXB0aW9uS2V5OiBsb2dLbXNLZXksXG4gICAgfSksXG4gICAgICBlbnZpcm9ubWVudDogeyBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lIH0sXG4gICAgICByb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ1JlY29tbWVuZFJkc1JvbGUnLCB7XG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKV0sXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgICAgRHluYW1vUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHsgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoeyBhY3Rpb25zOiBbJ2R5bmFtb2RiOlF1ZXJ5JywnZHluYW1vZGI6U2NhbicsJ2R5bmFtb2RiOkdldEl0ZW0nLCdkeW5hbW9kYjpQdXRJdGVtJ10sIHJlc291cmNlczogW3RhYmxlLnRhYmxlQXJuLCBgJHt0YWJsZS50YWJsZUFybn0vaW5kZXgvKmBdIH0pLFxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoeyBhY3Rpb25zOiBbJ3N0czpBc3N1bWVSb2xlJ10sIHJlc291cmNlczogWydhcm46YXdzOmlhbTo6Kjpyb2xlL0Nvc3RHdWFyZGlhbkRlbGVnYXRlZFJvbGUnXSB9KSxcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHsgYWN0aW9uczogWydyZHM6RGVzY3JpYmVEQkluc3RhbmNlcyddLCByZXNvdXJjZXM6IFsnKiddIH0pLFxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoeyBhY3Rpb25zOiBbJ2Nsb3Vkd2F0Y2g6R2V0TWV0cmljU3RhdGlzdGljcyddLCByZXNvdXJjZXM6IFsnKiddIH0pLFxuICAgICAgICAgIF19KVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pO1xuICAgIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShyZWNvbW1lbmRSZHNJZGxlTGFtYmRhKTtcblxuICAgIGNvbnN0IGRlbGV0ZVVudXNlZEVic0xhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0RlbGV0ZVVudXNlZEVicycsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ0RlbGV0ZVVudXNlZEVicycsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChiYWNrZW5kRnVuY3Rpb25zUGF0aCksXG4gICAgICBoYW5kbGVyOiAnZGVsZXRlLXVudXNlZC1lYnMuaGFuZGxlcicsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIC8vIENvbmZpZ3VyYcOnw7VlcyBkZSBWUEMgKFRhc2sgOClcbiAgICAgIHZwYyxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbbGFtYmRhU2VjdXJpdHlHcm91cF0sXG4gICAgICB2cGNTdWJuZXRzOiB7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfSxcbiAgICAgIHJlc2VydmVkQ29uY3VycmVudEV4ZWN1dGlvbnM6IDEwLFxuICAgICAgbG9nR3JvdXA6IG5ldyBjZGsuYXdzX2xvZ3MuTG9nR3JvdXAodGhpcywgJ0RlbGV0ZVVudXNlZEVic0xvZ0dyb3VwJywge1xuICAgICAgICByZXRlbnRpb246IGNkay5hd3NfbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgZW5jcnlwdGlvbktleTogbG9nS21zS2V5LFxuICAgICAgfSksXG4gICAgICAvLyBBIHJlbW/Dp8OjbyBkZSAnZXh0ZXJuYWxNb2R1bGVzJyBwZXJtaXRlIHF1ZSBvIGVzYnVpbGQgZW1wYWNvdGUgYXMgZGVwZW5kw6puY2lhcyBkbyBTREsgdjMuXG4gICAgICBlbnZpcm9ubWVudDogeyBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lIH0sXG4gICAgICByb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ0RlbGV0ZUVic1JvbGUnLCB7XG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKV0sXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgICAgRHluYW1vUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHsgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoeyBhY3Rpb25zOiBbJ2R5bmFtb2RiOlF1ZXJ5JywnZHluYW1vZGI6U2NhbicsJ2R5bmFtb2RiOkdldEl0ZW0nXSwgcmVzb3VyY2VzOiBbdGFibGUudGFibGVBcm4sIGAke3RhYmxlLnRhYmxlQXJufS9pbmRleC8qYF0gfSksXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7IGFjdGlvbnM6IFsnc3RzOkFzc3VtZVJvbGUnXSwgcmVzb3VyY2VzOiBbJ2Fybjphd3M6aWFtOjoqOnJvbGUvQ29zdEd1YXJkaWFuRGVsZWdhdGVkUm9sZSddIH0pLFxuICAgICAgICAgIF19KVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pO1xuICAgIHRhYmxlLmdyYW50UmVhZERhdGEoZGVsZXRlVW51c2VkRWJzTGFtYmRhKTtcblxuICAgIC8vIDcuMiAtIDcuMyBTdGVwIEZ1bmN0aW9uIGRlIGF1dG9tYcOnw6NvIChleGVjdXRhIHRhc2tzIGVtIHBhcmFsZWxvKVxuICAgIGNvbnN0IGF1dG9tYXRpb25FcnJvckhhbmRsZXIgPSBuZXcgc3RlcGZ1bmN0aW9ucy5GYWlsKHRoaXMsICdBdXRvbWF0aW9uRmFpbGVkJywge1xuICAgICAgY2F1c2U6ICdBdXRvbWF0aW9uIHdvcmtmbG93IGV4ZWN1dGlvbiBmYWlsZWQnLFxuICAgICAgZXJyb3I6ICdBdXRvbWF0aW9uRXJyb3InLFxuICAgIH0pO1xuICAgIFxuICAgIGNvbnN0IHN0b3BJZGxlVGFzayA9IG5ldyBzZm5fdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdTdG9wSWRsZVJlc291cmNlcycsIHsgXG4gICAgICBsYW1iZGFGdW5jdGlvbjogc3RvcElkbGVJbnN0YW5jZXNMYW1iZGEsIFxuICAgICAgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCcsXG4gICAgICByZXRyeU9uU2VydmljZUV4Y2VwdGlvbnM6IHRydWUsXG4gICAgfSkuYWRkUmV0cnkoe1xuICAgICAgZXJyb3JzOiBbJ1N0YXRlcy5UYXNrRmFpbGVkJ10sXG4gICAgICBpbnRlcnZhbDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMiksXG4gICAgICBtYXhBdHRlbXB0czogMyxcbiAgICAgIGJhY2tvZmZSYXRlOiAyLFxuICAgIH0pLmFkZENhdGNoKG5ldyBzdGVwZnVuY3Rpb25zLkZhaWwodGhpcywgJ1N0b3BJZGxlRmFpbGVkJywge1xuICAgICAgY2F1c2U6ICdTdG9wIGlkbGUgcmVzb3VyY2VzIGZhaWxlZCcsXG4gICAgICBlcnJvcjogJ1N0b3BJZGxlRXJyb3InLFxuICAgIH0pLCB7XG4gICAgICByZXN1bHRQYXRoOiAnJC5lcnJvcicsXG4gICAgfSk7XG4gICAgXG4gICAgY29uc3QgZGVsZXRlRWJzVGFzayA9IG5ldyBzZm5fdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdEZWxldGVVbnVzZWRWb2x1bWVzJywgeyBcbiAgICAgIGxhbWJkYUZ1bmN0aW9uOiBkZWxldGVVbnVzZWRFYnNMYW1iZGEsIFxuICAgICAgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCcsXG4gICAgICByZXRyeU9uU2VydmljZUV4Y2VwdGlvbnM6IHRydWUsXG4gICAgfSkuYWRkUmV0cnkoe1xuICAgICAgZXJyb3JzOiBbJ1N0YXRlcy5UYXNrRmFpbGVkJ10sXG4gICAgICBpbnRlcnZhbDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMiksXG4gICAgICBtYXhBdHRlbXB0czogMyxcbiAgICAgIGJhY2tvZmZSYXRlOiAyLFxuICAgIH0pLmFkZENhdGNoKG5ldyBzdGVwZnVuY3Rpb25zLkZhaWwodGhpcywgJ0RlbGV0ZUVic0ZhaWxlZCcsIHtcbiAgICAgIGNhdXNlOiAnRGVsZXRlIHVudXNlZCB2b2x1bWVzIGZhaWxlZCcsXG4gICAgICBlcnJvcjogJ0RlbGV0ZUVic0Vycm9yJyxcbiAgICB9KSwge1xuICAgICAgcmVzdWx0UGF0aDogJyQuZXJyb3InLFxuICAgIH0pO1xuICAgIFxuICAgIGNvbnN0IHJlY29tbWVuZFJkc1Rhc2sgPSBuZXcgc2ZuX3Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnUmVjb21tZW5kSWRsZVJkcycsIHsgXG4gICAgICBsYW1iZGFGdW5jdGlvbjogcmVjb21tZW5kUmRzSWRsZUxhbWJkYSwgXG4gICAgICBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyxcbiAgICAgIHJldHJ5T25TZXJ2aWNlRXhjZXB0aW9uczogdHJ1ZSxcbiAgICB9KS5hZGRSZXRyeSh7XG4gICAgICBlcnJvcnM6IFsnU3RhdGVzLlRhc2tGYWlsZWQnXSxcbiAgICAgIGludGVydmFsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygyKSxcbiAgICAgIG1heEF0dGVtcHRzOiAzLFxuICAgICAgYmFja29mZlJhdGU6IDIsXG4gICAgfSkuYWRkQ2F0Y2gobmV3IHN0ZXBmdW5jdGlvbnMuRmFpbCh0aGlzLCAnUmVjb21tZW5kUmRzRmFpbGVkJywge1xuICAgICAgY2F1c2U6ICdSZWNvbW1lbmQgaWRsZSBSRFMgZmFpbGVkJyxcbiAgICAgIGVycm9yOiAnUmVjb21tZW5kUmRzRXJyb3InLFxuICAgIH0pLCB7XG4gICAgICByZXN1bHRQYXRoOiAnJC5lcnJvcicsXG4gICAgfSk7XG5cbiAgICBjb25zdCBhdXRvbWF0aW9uRGVmaW5pdGlvbiA9IG5ldyBzdGVwZnVuY3Rpb25zLlBhcmFsbGVsKHRoaXMsICdSdW5BbGxBdXRvbWF0aW9ucycpXG4gICAgICAuYnJhbmNoKHN0b3BJZGxlVGFzaylcbiAgICAgIC5icmFuY2goZGVsZXRlRWJzVGFzaylcbiAgICAgIC5icmFuY2gocmVjb21tZW5kUmRzVGFzayk7XG5cbiAgICBjb25zdCBhdXRvbWF0aW9uU2ZuID0gbmV3IHN0ZXBmdW5jdGlvbnMuU3RhdGVNYWNoaW5lKHRoaXMsICdBdXRvbWF0aW9uV29ya2Zsb3cnLCB7XG4gICAgICBzdGF0ZU1hY2hpbmVOYW1lOiAnQXV0b21hdGlvbldvcmtmbG93JyxcbiAgICAgIGRlZmluaXRpb25Cb2R5OiBzdGVwZnVuY3Rpb25zLkRlZmluaXRpb25Cb2R5LmZyb21DaGFpbmFibGUoYXV0b21hdGlvbkRlZmluaXRpb24pLFxuICAgICAgbG9nczoge1xuICAgICAgICBkZXN0aW5hdGlvbjogbmV3IGNkay5hd3NfbG9ncy5Mb2dHcm91cCh0aGlzLCAnQXV0b21hdGlvblNmbkxvZ0dyb3VwJywge1xuICAgICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgICAgZW5jcnlwdGlvbktleTogbG9nS21zS2V5LFxuICAgICAgICB9KSxcbiAgICAgICAgbGV2ZWw6IHN0ZXBmdW5jdGlvbnMuTG9nTGV2ZWwuQUxMLFxuICAgICAgfSxcbiAgICAgIHRyYWNpbmdFbmFibGVkOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgLy8gNy40LiBSZWdyYSBzZW1hbmFsIHBhcmEgZGlzcGFyYXIgYSBTdGF0ZSBNYWNoaW5lXG4gICAgbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdXZWVrbHlBdXRvbWF0aW9uUnVsZScsIHtcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUuY3Jvbih7IHdlZWtEYXk6ICdTVU4nLCBob3VyOiAnMycsIG1pbnV0ZTogJzAnIH0pLCAvLyBEb21pbmdvIDAzOjAwIFVUQ1xuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLlNmblN0YXRlTWFjaGluZShhdXRvbWF0aW9uU2ZuKV0sXG4gICAgfSk7XG5cbiAgICAvLyBMYW1iZGEgZGUgbWV0ZXJpbmcgZG8gTWFya2V0cGxhY2VcbiAgICBjb25zdCBtYXJrZXRwbGFjZU1ldGVyaW5nTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnTWFya2V0cGxhY2VNZXRlcmluZycsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KGJhY2tlbmRGdW5jdGlvbnNQYXRoKSxcbiAgICAgIGhhbmRsZXI6ICdtYXJrZXRwbGFjZS1tZXRlcmluZy5oYW5kbGVyJyxcbiAgICAgIC8vIENvbmZpZ3VyYcOnw7VlcyBkZSBWUEMgKFRhc2sgOClcbiAgICAgIHZwYyxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbbGFtYmRhU2VjdXJpdHlHcm91cF0sXG4gICAgICB2cGNTdWJuZXRzOiB7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfSxcbiAgICAgIHJlc2VydmVkQ29uY3VycmVudEV4ZWN1dGlvbnM6IDIsICAgICAgXG4gICAgICBsb2dHcm91cDogbmV3IGNkay5hd3NfbG9ncy5Mb2dHcm91cCh0aGlzLCAnTWFya2V0cGxhY2VNZXRlcmluZ0xvZ0dyb3VwJywge1xuICAgICAgICByZXRlbnRpb246IGNkay5hd3NfbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgZW5jcnlwdGlvbktleTogbG9nS21zS2V5LFxuICAgICAgfSksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lLFxuICAgICAgICBQUk9EVUNUX0NPREU6ICd5b3VyLXByb2R1Y3QtY29kZScsIC8vIFN1YnN0aXR1aXIgcGVsbyBjw7NkaWdvIHJlYWwgZG8gcHJvZHV0b1xuICAgICAgfSxcbiAgICB9KTtcbiAgICB0YWJsZS5ncmFudFJlYWRXcml0ZURhdGEobWFya2V0cGxhY2VNZXRlcmluZ0xhbWJkYSk7XG5cbiAgICAvLyBSZWdyYSBwYXJhIGV4ZWN1dGFyIGEgY2FkYSBob3JhXG4gICAgbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdIb3VybHlNZXRlcmluZ1J1bGUnLCB7XG4gICAgICBzY2hlZHVsZTogZXZlbnRzLlNjaGVkdWxlLnJhdGUoY2RrLkR1cmF0aW9uLmhvdXJzKDEpKSxcbiAgICAgIHRhcmdldHM6IFtuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihtYXJrZXRwbGFjZU1ldGVyaW5nTGFtYmRhKV0sXG4gICAgfSk7XG5cbiAgICAvLyBTdGVwIEZ1bmN0aW9ucyBTTEEgKFVzYW5kbyBvcyBMYW1iZGFzIGNvcnJldG9zKVxuICAgIFxuICAgIC8vIEhhbmRsZXIgZGUgZXJybyBwYXJhIFNMQSB3b3JrZmxvd1xuICAgIGNvbnN0IHNsYUVycm9ySGFuZGxlciA9IG5ldyBzdGVwZnVuY3Rpb25zLkZhaWwodGhpcywgJ1NsYVdvcmtmbG93RmFpbGVkJywge1xuICAgICAgY2F1c2U6ICdTTEEgd29ya2Zsb3cgZXhlY3V0aW9uIGZhaWxlZCcsXG4gICAgICBlcnJvcjogJ1NsYVdvcmtmbG93RXJyb3InLFxuICAgIH0pO1xuICAgIFxuICAgIGNvbnN0IGNhbGN1bGF0ZUltcGFjdFRhc2sgPSBuZXcgc2ZuX3Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnQ2FsY3VsYXRlSW1wYWN0JywgeyBcbiAgICAgIGxhbWJkYUZ1bmN0aW9uOiBzbGFDYWxjdWxhdGVJbXBhY3RMYW1iZGEsIFxuICAgICAgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCcsXG4gICAgICByZXRyeU9uU2VydmljZUV4Y2VwdGlvbnM6IHRydWUsXG4gICAgfSkuYWRkUmV0cnkoe1xuICAgICAgZXJyb3JzOiBbJ1N0YXRlcy5UYXNrRmFpbGVkJywgJ1N0YXRlcy5UaW1lb3V0J10sXG4gICAgICBpbnRlcnZhbDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMiksXG4gICAgICBtYXhBdHRlbXB0czogMyxcbiAgICAgIGJhY2tvZmZSYXRlOiAyLFxuICAgIH0pLmFkZENhdGNoKHNsYUVycm9ySGFuZGxlciwge1xuICAgICAgcmVzdWx0UGF0aDogJyQuZXJyb3InLFxuICAgIH0pO1xuICAgIFxuICAgIGNvbnN0IGNoZWNrU2xhVGFzayA9IG5ldyBzZm5fdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdDaGVja1NMQScsIHsgXG4gICAgICBsYW1iZGFGdW5jdGlvbjogc2xhQ2hlY2tMYW1iZGEsIFxuICAgICAgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCcsXG4gICAgICByZXRyeU9uU2VydmljZUV4Y2VwdGlvbnM6IHRydWUsXG4gICAgfSkuYWRkUmV0cnkoe1xuICAgICAgZXJyb3JzOiBbJ1N0YXRlcy5UYXNrRmFpbGVkJ10sXG4gICAgICBpbnRlcnZhbDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMiksXG4gICAgICBtYXhBdHRlbXB0czogMyxcbiAgICAgIGJhY2tvZmZSYXRlOiAyLFxuICAgIH0pLmFkZENhdGNoKHNsYUVycm9ySGFuZGxlciwge1xuICAgICAgcmVzdWx0UGF0aDogJyQuZXJyb3InLFxuICAgIH0pO1xuICAgIFxuICAgIGNvbnN0IGdlbmVyYXRlUmVwb3J0VGFzayA9IG5ldyBzZm5fdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdHZW5lcmF0ZVJlcG9ydCcsIHsgXG4gICAgICBsYW1iZGFGdW5jdGlvbjogc2xhR2VuZXJhdGVSZXBvcnRMYW1iZGEsIFxuICAgICAgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCcsXG4gICAgICByZXRyeU9uU2VydmljZUV4Y2VwdGlvbnM6IHRydWUsXG4gICAgfSkuYWRkUmV0cnkoe1xuICAgICAgZXJyb3JzOiBbJ1N0YXRlcy5UYXNrRmFpbGVkJ10sXG4gICAgICBpbnRlcnZhbDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMiksXG4gICAgICBtYXhBdHRlbXB0czogMyxcbiAgICAgIGJhY2tvZmZSYXRlOiAyLFxuICAgIH0pLmFkZENhdGNoKHNsYUVycm9ySGFuZGxlciwge1xuICAgICAgcmVzdWx0UGF0aDogJyQuZXJyb3InLFxuICAgIH0pO1xuICAgIFxuICAgIGNvbnN0IHN1Ym1pdFRpY2tldFRhc2sgPSBuZXcgc2ZuX3Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnU3VibWl0VGlja2V0JywgeyBcbiAgICAgIGxhbWJkYUZ1bmN0aW9uOiBzbGFTdWJtaXRUaWNrZXRMYW1iZGEsIFxuICAgICAgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCcsXG4gICAgICByZXRyeU9uU2VydmljZUV4Y2VwdGlvbnM6IHRydWUsXG4gICAgfSkuYWRkUmV0cnkoe1xuICAgICAgZXJyb3JzOiBbJ1N0YXRlcy5UYXNrRmFpbGVkJ10sXG4gICAgICBpbnRlcnZhbDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMiksXG4gICAgICBtYXhBdHRlbXB0czogMyxcbiAgICAgIGJhY2tvZmZSYXRlOiAyLFxuICAgIH0pLmFkZENhdGNoKHNsYUVycm9ySGFuZGxlciwge1xuICAgICAgcmVzdWx0UGF0aDogJyQuZXJyb3InLFxuICAgIH0pO1xuICAgIFxuICAgIGNvbnN0IG5vQ2xhaW0gPSBuZXcgc3RlcGZ1bmN0aW9ucy5TdWNjZWVkKHRoaXMsICdOb0NsYWltR2VuZXJhdGVkJyk7XG5cbiAgICBjb25zdCBjbGFpbUNob2ljZSA9IG5ldyBzdGVwZnVuY3Rpb25zLkNob2ljZSh0aGlzLCAnSXNDbGFpbUdlbmVyYXRlZD8nKVxuICAgICAgLndoZW4oc3RlcGZ1bmN0aW9ucy5Db25kaXRpb24uYm9vbGVhbkVxdWFscygnJC5jbGFpbUdlbmVyYXRlZCcsIHRydWUpLCBzdWJtaXRUaWNrZXRUYXNrKVxuICAgICAgLm90aGVyd2lzZShub0NsYWltKTtcblxuICAgIGNvbnN0IHNsYURlZmluaXRpb24gPSBjYWxjdWxhdGVJbXBhY3RUYXNrXG4gICAgICAubmV4dChjaGVja1NsYVRhc2spXG4gICAgICAubmV4dChnZW5lcmF0ZVJlcG9ydFRhc2spXG4gICAgICAubmV4dChjbGFpbUNob2ljZSk7XG5cbiAgICBjb25zdCBzZm4gPSBuZXcgc3RlcGZ1bmN0aW9ucy5TdGF0ZU1hY2hpbmUodGhpcywgJ1NMQVdvcmtmbG93Jywge1xuICAgICAgc3RhdGVNYWNoaW5lTmFtZTogJ1NMQVdvcmtmbG93JyxcbiAgICAgIHN0YXRlTWFjaGluZVR5cGU6IHN0ZXBmdW5jdGlvbnMuU3RhdGVNYWNoaW5lVHlwZS5TVEFOREFSRCxcbiAgICAgIGRlZmluaXRpb25Cb2R5OiBzdGVwZnVuY3Rpb25zLkRlZmluaXRpb25Cb2R5LmZyb21DaGFpbmFibGUoc2xhRGVmaW5pdGlvbiksXG4gICAgICBsb2dzOiB7XG4gICAgICAgIGRlc3RpbmF0aW9uOiBuZXcgY2RrLmF3c19sb2dzLkxvZ0dyb3VwKHRoaXMsICdTZm5Mb2dHcm91cCcsIHtcbiAgICAgICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgICAgIGVuY3J5cHRpb25LZXk6IGxvZ0ttc0tleSxcbiAgICAgICAgfSksXG4gICAgICAgIGxldmVsOiBzdGVwZnVuY3Rpb25zLkxvZ0xldmVsLkFMTCxcbiAgICAgIH0sXG4gICAgICB0cmFjaW5nRW5hYmxlZDogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIEFkaWNpb25hciBvIEFSTiBkbyBTRk4gYW8gTGFtYmRhIGRlIGNvcnJlbGHDp8Ojb1xuICAgIGhlYWx0aEV2ZW50SGFuZGxlckxhbWJkYS5hZGRFbnZpcm9ubWVudCgnU0ZOX0FSTicsIHNmbi5zdGF0ZU1hY2hpbmVBcm4pO1xuICAgIC8vIFBlcm1pc3PDo28gcGFyYSBvIExhbWJkYSBpbmljaWFyIGEgU3RhdGUgTWFjaGluZVxuICAgIHNmbi5ncmFudFN0YXJ0RXhlY3V0aW9uKGhlYWx0aEV2ZW50SGFuZGxlckxhbWJkYSk7XG5cbiAgICAvLyBBUEkgR2F0ZXdheSAoVXNhbmRvIG8gJ2FwaUhhbmRsZXJMYW1iZGEnIGNvcnJldG8pXG4gICAgY29uc3QgY2xvdWR3YXRjaF9hY3Rpb25zID0gY2RrLmF3c19jbG91ZHdhdGNoX2FjdGlvbnM7XG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWd3LlJlc3RBcGkodGhpcywgJ0Nvc3RHdWFyZGlhbkFQSScsIHtcbiAgICAgIHJlc3RBcGlOYW1lOiAnQ29zdEd1YXJkaWFuQXBpJywgLy8gTm9tZSBzZW0gZXNwYcOnb3MgcGFyYSBmYWNpbGl0YXIgYSBjb3JyZXNwb25kw6puY2lhXG4gICAgICBkZWZhdWx0Q29yc1ByZWZsaWdodE9wdGlvbnM6IHsgYWxsb3dPcmlnaW5zOiBhcGlndy5Db3JzLkFMTF9PUklHSU5TIH0sXG4gICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgIHRyYWNpbmdFbmFibGVkOiB0cnVlLFxuICAgICAgICBzdGFnZU5hbWU6ICdwcm9kJywgLy8gKFRhc2sgOSlcbiAgICAgICAgdGhyb3R0bGluZ1JhdGVMaW1pdDogMTAwLCAvLyAoVGFzayA5KVxuICAgICAgICB0aHJvdHRsaW5nQnVyc3RMaW1pdDogNTAsIC8vIChUYXNrIDkpXG4gICAgICAgIG1ldGhvZE9wdGlvbnM6IHtcbiAgICAgICAgICAnLyovKic6IHsgLy8gQXBsaWNhIGEgdG9kb3Mgb3MgbcOpdG9kb3MgZW0gdG9kb3Mgb3MgcmVjdXJzb3NcbiAgICAgICAgICAgIHRocm90dGxpbmdCdXJzdExpbWl0OiA1MCwgLy8gKFRhc2sgOSlcbiAgICAgICAgICAgIHRocm90dGxpbmdSYXRlTGltaXQ6IDEwMCwgLy8gKFRhc2sgOSlcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KTsgLy8gKFRhc2sgOSlcbiAgICBjb25zdCBhdXRoID0gbmV3IGFwaWd3LkNvZ25pdG9Vc2VyUG9vbHNBdXRob3JpemVyKHRoaXMsICdDb2duaXRvQXV0aCcsIHtcbiAgICAgIGNvZ25pdG9Vc2VyUG9vbHM6IFt1c2VyUG9vbF0sXG4gICAgfSk7XG5cbiAgICBjb25zdCB3YWYgPSBuZXcgY2RrLmF3c193YWZ2Mi5DZm5XZWJBQ0wodGhpcywgJ0FwaVdhZicsIHtcbiAgICAgICAgc2NvcGU6ICdSRUdJT05BTCcsXG4gICAgICAgIGRlZmF1bHRBY3Rpb246IHsgYWxsb3c6IHt9IH0sXG4gICAgICAgIHZpc2liaWxpdHlDb25maWc6IHsgc2FtcGxlZFJlcXVlc3RzRW5hYmxlZDogdHJ1ZSwgY2xvdWRXYXRjaE1ldHJpY3NFbmFibGVkOiB0cnVlLCBtZXRyaWNOYW1lOiAnQXBpV2FmJyB9LFxuICAgICAgICBydWxlczogW3sgbmFtZTogJ0FXUy1BV1NNYW5hZ2VkUnVsZXNDb21tb25SdWxlU2V0JywgcHJpb3JpdHk6IDEsIHN0YXRlbWVudDogeyBtYW5hZ2VkUnVsZUdyb3VwU3RhdGVtZW50OiB7IHZlbmRvck5hbWU6ICdBV1MnLCBuYW1lOiAnQVdTTWFuYWdlZFJ1bGVzQ29tbW9uUnVsZVNldCcgfSB9LCBvdmVycmlkZUFjdGlvbjogeyBub25lOiB7fSB9LCB2aXNpYmlsaXR5Q29uZmlnOiB7IHNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IHRydWUsIGNsb3VkV2F0Y2hNZXRyaWNzRW5hYmxlZDogdHJ1ZSwgbWV0cmljTmFtZTogJ2F3c0NvbW1vblJ1bGVzJyB9IH1dIC8vIChUYXNrIDkpXG5cbiAgICB9KTtcbiAgICBuZXcgY2RrLmF3c193YWZ2Mi5DZm5XZWJBQ0xBc3NvY2lhdGlvbih0aGlzLCAnQXBpV2FmQXNzb2NpYXRpb24nLCB7IHJlc291cmNlQXJuOiBhcGkuZGVwbG95bWVudFN0YWdlLnN0YWdlQXJuLCB3ZWJBY2xBcm46IHdhZi5hdHRyQXJuIH0pO1xuXG4gICAgY29uc3QgYXBpSW50ZWdyYXRpb24gPSBuZXcgYXBpZ3cuTGFtYmRhSW50ZWdyYXRpb24oYXBpSGFuZGxlckxhbWJkYSk7XG5cbiAgICAvLyBFeHBvciB0b2RhcyBhcyByb3RhcyBzb2IgL2FwaSBwYXJhIGNvaW5jaWRpciBjb20gYXMgcm90YXMgRXhwcmVzcyBkbyBiYWNrZW5kICgvYXBpLyopXG4gICAgY29uc3QgYXBpUm9vdCA9IGFwaS5yb290LmFkZFJlc291cmNlKCdhcGknKTtcblxuICAvLyBIZWFsdGggcMO6YmxpY286IEdFVCAvYXBpL2hlYWx0aCAtPiBzZW0gYXV0aG9yaXplclxuICBjb25zdCBoZWFsdGggPSBhcGlSb290LmFkZFJlc291cmNlKCdoZWFsdGgnKTtcbiAgaGVhbHRoLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24pOyAvLyBwdWJsaWMgaGVhbHRoIGNoZWNrXG5cbiAgICAvLyBSZXNvdXJjZXMgQVBJIChhZ29yYSBzb2IgL2FwaSlcbiAgICBjb25zdCBvbmJvYXJkID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnb25ib2FyZCcpO1xuICAgIG9uYm9hcmQuYWRkTWV0aG9kKCdQT1NUJywgYXBpSW50ZWdyYXRpb24pOyAvLyBXZWJob29rLCBzZW0gYXV0aFxuXG4gIC8vIFN0cmlwZSB3ZWJob29rIChwdWJsaWMgZW5kcG9pbnQsIHNlbSBhdXRob3JpemVyKVxuICBjb25zdCBzdHJpcGVBcGkgPSBhcGlSb290LmFkZFJlc291cmNlKCdzdHJpcGUnKTtcbiAgc3RyaXBlQXBpLmFkZFJlc291cmNlKCd3ZWJob29rJykuYWRkTWV0aG9kKCdQT1NUJywgYXBpSW50ZWdyYXRpb24pO1xuXG4gICAgLy8gTm92byBlbmRwb2ludCBwYXJhIGdlcmFyIGNvbmZpZyBkZSBvbmJvYXJkaW5nXG4gICAgY29uc3Qgb25ib2FyZEluaXQgPSBhcGlSb290LmFkZFJlc291cmNlKCdvbmJvYXJkLWluaXQnKTtcbiAgICBvbmJvYXJkSW5pdC5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG5cbiAgLy8gRGFzaGJvYXJkIEFQSSBwYXJhIG8gZnJvbnRlbmQ6IEdFVCAvYXBpL2Rhc2hib2FyZC9jb3N0cyAocHJvdGVnaWRvKVxuICBjb25zdCBkYXNoYm9hcmRBcGkgPSBhcGlSb290LmFkZFJlc291cmNlKCdkYXNoYm9hcmQnKTtcbiAgZGFzaGJvYXJkQXBpLmFkZFJlc291cmNlKCdjb3N0cycpLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcblxuICAvLyBTZXR0aW5ncyBBUEk6IEdFVC9QT1NUIC9hcGkvc2V0dGluZ3MvYXV0b21hdGlvblxuICBjb25zdCBzZXR0aW5nc0FwaSA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ3NldHRpbmdzJyk7XG4gIGNvbnN0IGF1dG9tYXRpb25BcGkgPSBzZXR0aW5nc0FwaS5hZGRSZXNvdXJjZSgnYXV0b21hdGlvbicpO1xuICBhdXRvbWF0aW9uQXBpLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcbiAgYXV0b21hdGlvbkFwaS5hZGRNZXRob2QoJ1BPU1QnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xuXG4gICAgY29uc3QgaW5jaWRlbnRzID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnaW5jaWRlbnRzJyk7XG4gICAgaW5jaWRlbnRzLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcbiAgICBjb25zdCBzbGFDbGFpbXMgPSBhcGlSb290LmFkZFJlc291cmNlKCdzbGEtY2xhaW1zJyk7XG4gICAgc2xhQ2xhaW1zLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcblxuICAgIGNvbnN0IGludm9pY2VzQXBpID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnaW52b2ljZXMnKTtcbiAgICBpbnZvaWNlc0FwaS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG5cbiAgLy8gQWxlcnRzIEFQSTogR0VUIC9hcGkvYWxlcnRzIChwcm90ZWdpZG8pXG4gIGNvbnN0IGFsZXJ0c0FwaSA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ2FsZXJ0cycpO1xuICBhbGVydHNBcGkuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xuXG4gIC8vIENvbm5lY3Rpb25zIEFQSTogR0VUL0RFTEVURSAvYXBpL2Nvbm5lY3Rpb25zIChwcm90ZWdpZG8pXG4gIGNvbnN0IGNvbm5lY3Rpb25zQXBpID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnY29ubmVjdGlvbnMnKTtcbiAgY29ubmVjdGlvbnNBcGkuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xuICBjb25zdCBjb25uZWN0aW9uSXRlbSA9IGNvbm5lY3Rpb25zQXBpLmFkZFJlc291cmNlKCd7YXdzQWNjb3VudElkfScpO1xuICBjb25uZWN0aW9uSXRlbS5hZGRNZXRob2QoJ0RFTEVURScsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG5cbiAgLy8gUmVjb21tZW5kYXRpb25zIEFQSTogR0VUL1BPU1QgL2FwaS9yZWNvbW1lbmRhdGlvbnMgKHByb3RlZ2lkbylcbiAgY29uc3QgcmVjb21tZW5kYXRpb25zQXBpID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgncmVjb21tZW5kYXRpb25zJyk7XG4gIHJlY29tbWVuZGF0aW9uc0FwaS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG4gIGNvbnN0IGV4ZWN1dGVSZWMgPSByZWNvbW1lbmRhdGlvbnNBcGkuYWRkUmVzb3VyY2UoJ2V4ZWN1dGUnKTtcbiAgZXhlY3V0ZVJlYy5hZGRNZXRob2QoJ1BPU1QnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xuXG4gIC8vIFNMQSBSZXBvcnRzIEFQSTogR0VUIC9hcGkvc2xhLXJlcG9ydHMve2NsYWltSWR9IChwcm90ZWdpZG8pXG4gIGNvbnN0IHNsYVJlcG9ydHMgPSBhcGlSb290LmFkZFJlc291cmNlKCdzbGEtcmVwb3J0cycpO1xuICBjb25zdCBzbGFSZXBvcnRJdGVtID0gc2xhUmVwb3J0cy5hZGRSZXNvdXJjZSgne2NsYWltSWR9Jyk7XG4gIHNsYVJlcG9ydEl0ZW0uYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xuXG4gIC8vIFVwZ3JhZGUgQVBJOiBQT1NUIC9hcGkvdXBncmFkZSAocHJvdGVnaWRvKVxuICBjb25zdCB1cGdyYWRlQXBpID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgndXBncmFkZScpO1xuICB1cGdyYWRlQXBpLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG5cbiAgLy8gQmlsbGluZyBBUEk6IEdFVCAvYXBpL2JpbGxpbmcvc3VtbWFyeSAocHJvdGVnaWRvKVxuICBjb25zdCBiaWxsaW5nQXBpID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnYmlsbGluZycpO1xuICBiaWxsaW5nQXBpLmFkZFJlc291cmNlKCdzdW1tYXJ5JykuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xuXG4gICAgY29uc3QgdGVybXNBcGkgPSBhcGlSb290LmFkZFJlc291cmNlKCdhY2NlcHQtdGVybXMnKTtcbiAgICB0ZXJtc0FwaS5hZGRNZXRob2QoJ1BPU1QnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xuXG4gICAgLy8gRW5kcG9pbnQgZGUgQWRtaW5cbiAgICBjb25zdCBhZG1pbkFwaSA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ2FkbWluJyk7XG4gICAgY29uc3QgYWRtaW5DbGFpbXMgPSBhZG1pbkFwaS5hZGRSZXNvdXJjZSgnY2xhaW1zJyk7XG5cbiAgICAvLyBHRVQgL2FwaS9hZG1pbi9jbGFpbXNcbiAgICBhZG1pbkNsYWltcy5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG5cbiAgICAvLyBTdWItcmVjdXJzb3MgcGFyYSBvcGVyYcOnw7VlcyBlbSBjbGFpbXMgZXNwZWPDrWZpY2FzXG4gICAgY29uc3QgY2xhaW1zQnlDdXN0b21lciA9IGFkbWluQ2xhaW1zLmFkZFJlc291cmNlKCd7Y3VzdG9tZXJJZH0nKTtcbiAgICBjb25zdCBzcGVjaWZpY0NsYWltID0gY2xhaW1zQnlDdXN0b21lci5hZGRSZXNvdXJjZSgne2NsYWltSWR9Jyk7XG5cbiAgICAvLyBQVVQgL2FwaS9hZG1pbi9jbGFpbXMve2N1c3RvbWVySWR9L3tjbGFpbUlkfS9zdGF0dXNcbiAgICBzcGVjaWZpY0NsYWltLmFkZFJlc291cmNlKCdzdGF0dXMnKS5hZGRNZXRob2QoJ1BVVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG5cbiAgICAvLyBQT1NUIC9hcGkvYWRtaW4vY2xhaW1zL3tjdXN0b21lcklkfS97Y2xhaW1JZH0vY3JlYXRlLWludm9pY2VcbiAgICBzcGVjaWZpY0NsYWltLmFkZFJlc291cmNlKCdjcmVhdGUtaW52b2ljZScpLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XG5cbiAgICAvLyBPdXRwdXRzIGNvbSByZWZlcsOqbmNpYXMgcGFyYSBBbXBsaWZ5XG4gICAgY29uc3QgYXBpVXJsID0gbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FQSVVybCcsIHsgdmFsdWU6IGFwaS51cmwgfSk7XG4gICAgY29uc3QgdXNlclBvb2xJZE91dHB1dCA9IG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyUG9vbElkJywgeyB2YWx1ZTogdXNlclBvb2wudXNlclBvb2xJZCB9KTtcbiAgICBjb25zdCB1c2VyUG9vbENsaWVudElkT3V0cHV0ID0gbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sQ2xpZW50SWQnLCB7IHZhbHVlOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkIH0pO1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdUYWJsZU5hbWUnLCB7IHZhbHVlOiB0YWJsZS50YWJsZU5hbWUgfSk7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1NGTkFybicsIHsgdmFsdWU6IHNmbi5zdGF0ZU1hY2hpbmVBcm4gfSk7XG4gICAgY29uc3QgY2ZuVGVtcGxhdGVVcmxPdXRwdXQgPSBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ2ZuVGVtcGxhdGVVcmwnLCB7XG4gICAgICB2YWx1ZTogZnVsbFRlbXBsYXRlVXJsLCAvLyBVc2UgdGhlIHBvdGVudGlhbGx5IGR1bW15IFVSTCBpbiB0ZXN0c1xuICAgICAgZGVzY3JpcHRpb246ICdVUkwgZG8gdGVtcGxhdGUgZG8gQ2xvdWRGb3JtYXRpb24gcGFyYSBvIG9uYm9hcmRpbmcgZG8gY2xpZW50ZS4gVXNlIGVzdGEgVVJMIG5vIGZyb250ZW5kLicsXG4gICAgfSk7XG5cbiAgICAvLyBJZGVudGl0eSBQb29sIHBhcmEgQW1wbGlmeVxuICAgIGNvbnN0IGlkZW50aXR5UG9vbCA9IG5ldyBjb2duaXRvLkNmbklkZW50aXR5UG9vbCh0aGlzLCAnQ29zdEd1YXJkaWFuSWRlbnRpdHlQb29sJywge1xuICAgICAgYWxsb3dVbmF1dGhlbnRpY2F0ZWRJZGVudGl0aWVzOiBmYWxzZSxcbiAgICAgIGNvZ25pdG9JZGVudGl0eVByb3ZpZGVyczogW3tcbiAgICAgICAgY2xpZW50SWQ6IHVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXG4gICAgICAgIHByb3ZpZGVyTmFtZTogdXNlclBvb2wudXNlclBvb2xQcm92aWRlck5hbWUsXG4gICAgICB9XSxcbiAgICB9KTtcbiAgICBjb25zdCBpZGVudGl0eVBvb2xJZE91dHB1dCA9IG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdJZGVudGl0eVBvb2xJZCcsIHtcbiAgICAgIHZhbHVlOiBpZGVudGl0eVBvb2wucmVmLFxuICAgICAgZGVzY3JpcHRpb246ICdDb2duaXRvIElkZW50aXR5IFBvb2wgSUQnLFxuICAgIH0pO1xuICAgIFxuICAgIC8vIEFkaWNpb25hciBWUEMgRW5kcG9pbnRzIHBhcmEgc2VydmnDp29zIGVzc2VuY2lhaXNcbiAgICB2cGMuYWRkR2F0ZXdheUVuZHBvaW50KCdEeW5hbW9EQkVuZHBvaW50Jywge1xuICAgICAgc2VydmljZTogY2RrLmF3c19lYzIuR2F0ZXdheVZwY0VuZHBvaW50QXdzU2VydmljZS5EWU5BTU9EQixcbiAgICB9KTtcbiAgICB2cGMuYWRkR2F0ZXdheUVuZHBvaW50KCdTM0VuZHBvaW50Jywge1xuICAgICAgc2VydmljZTogY2RrLmF3c19lYzIuR2F0ZXdheVZwY0VuZHBvaW50QXdzU2VydmljZS5TMyxcbiAgICB9KTtcblxuICAgIGlmICghcHJvcHMuaXNUZXN0RW52aXJvbm1lbnQpIHtcbiAgICAgIC8vIENsb3VkV2F0Y2ggQWxhcm1zIHBhcmEgcHJvZHXDp8OjbyAoVGFzayAxMClcbiAgICAgIGNvbnN0IGFsYXJtVG9waWMgPSBuZXcgc25zLlRvcGljKHRoaXMsICdBbGFybVRvcGljJywge1xuICAgICAgICBkaXNwbGF5TmFtZTogJ0Nvc3RHdWFyZGlhbiBBbGFybXMnLFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGFwaTV4eEFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0FwaTV4eEFsYXJtJywge1xuICAgICAgICBtZXRyaWM6IGFwaS5tZXRyaWNTZXJ2ZXJFcnJvcigpLFxuICAgICAgICB0aHJlc2hvbGQ6IDEsXG4gICAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgICBhbGFybURlc2NyaXB0aW9uOiAnQWxhcm0gd2hlbiBBUEkgR2F0ZXdheSA1WFggZXJyb3JzIG9jY3VyJyxcbiAgICAgICAgYWN0aW9uc0VuYWJsZWQ6IHRydWUsXG4gICAgICB9KTtcbiAgICAgIGFwaTV4eEFsYXJtLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoX2FjdGlvbnMuU25zQWN0aW9uKGFsYXJtVG9waWMpKTtcblxuICAgICAgY29uc3QgYXBpTGF0ZW5jeUFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0FwaUxhdGVuY3lBbGFybScsIHtcbiAgICAgICAgbWV0cmljOiBhcGkubWV0cmljTGF0ZW5jeSgpLFxuICAgICAgICB0aHJlc2hvbGQ6IDEwMDAsIC8vIDEgc2VndW5kb1xuICAgICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FsYXJtIHdoZW4gQVBJIEdhdGV3YXkgbGF0ZW5jeSBpcyBoaWdoICg+MXMpJyxcbiAgICAgICAgYWN0aW9uc0VuYWJsZWQ6IHRydWUsXG4gICAgICB9KTtcbiAgICAgIGFwaUxhdGVuY3lBbGFybS5hZGRBbGFybUFjdGlvbihuZXcgY2xvdWR3YXRjaF9hY3Rpb25zLlNuc0FjdGlvbihhbGFybVRvcGljKSk7XG4gICAgfVxuXG4gICAgLy8gLS0tIFNFw4fDg08gRE8gRlJPTlRFTkQgKEFNUExJRlkgQVBQIEFVVE9NQVRJWkFETykgLS0tXG4gICAgY29uc3QgYnVpbGRTcGVjID0gY29kZWJ1aWxkLkJ1aWxkU3BlYy5mcm9tT2JqZWN0VG9ZYW1sKHtcbiAgICAgIHZlcnNpb246ICcxLjAnLFxuICAgICAgZnJvbnRlbmQ6IHtcbiAgICAgICAgcGhhc2VzOiB7XG4gICAgICAgICAgcHJlQnVpbGQ6IHtcbiAgICAgICAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICAgICAgICdjZCBmcm9udGVuZCcsXG4gICAgICAgICAgICAgICducG0gY2knLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGJ1aWxkOiB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICBgZWNobyBcIk5FWFRfUFVCTElDX0FXU19SRUdJT049JHt0aGlzLnJlZ2lvbn1cIiA+PiAuZW52LnByb2R1Y3Rpb25gLFxuICAgICAgICAgICAgICBgZWNobyBcIk5FWFRfUFVCTElDX0FQSV9VUkw9JHthcGkudXJsfVwiID4+IC5lbnYucHJvZHVjdGlvbmAsXG4gICAgICAgICAgICAgIGBlY2hvIFwiTkVYVF9QVUJMSUNfQ09HTklUT19VU0VSX1BPT0xfSUQ9JHt1c2VyUG9vbC51c2VyUG9vbElkfVwiID4+IC5lbnYucHJvZHVjdGlvbmAsXG4gICAgICAgICAgICAgIGBlY2hvIFwiTkVYVF9QVUJMSUNfQ09HTklUT19VU0VSX1BPT0xfQ0xJRU5UX0lEPSR7dXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZH1cIiA+PiAuZW52LnByb2R1Y3Rpb25gLFxuICAgICAgICAgICAgICBgZWNobyBcIk5FWFRfUFVCTElDX0NPR05JVE9fSURFTlRJVFlfUE9PTF9JRD0ke2lkZW50aXR5UG9vbC5yZWZ9XCIgPj4gLmVudi5wcm9kdWN0aW9uYCxcbiAgICAgICAgICAgICAgYGVjaG8gXCJORVhUX1BVQkxJQ19DRk5fVEVNUExBVEVfVVJMPSR7ZnVsbFRlbXBsYXRlVXJsfVwiID4+IC5lbnYucHJvZHVjdGlvbmAsXG4gICAgICAgICAgICAgICducG0gcnVuIGJ1aWxkJyxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgYXJ0aWZhY3RzOiB7XG4gICAgICAgICAgYmFzZURpcmVjdG9yeTogJ2Zyb250ZW5kLy5uZXh0JyxcbiAgICAgICAgICBmaWxlczogWycqKi8qJ10sXG4gICAgICAgIH0sXG4gICAgICAgIGNhY2hlOiB7XG4gICAgICAgICAgcGF0aHM6IFsnZnJvbnRlbmQvbm9kZV9tb2R1bGVzLyoqLyonXSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICBpZiAocHJvcHMuaXNUZXN0RW52aXJvbm1lbnQpIHtcbiAgICAgIHJldHVybjsgLy8gTsOjbyBjcmlhciByZWN1cnNvcyBkZSBBbXBsaWZ5LCBSb3V0ZTUzLCBBQ00gZW0gdGVzdGVzXG4gICAgfVxuXG4gICAgLy8gVmFsaWRhw6fDo28gcGFyYSBnYXJhbnRpciBxdWUgYXMgcHJvcHMgZXhpc3RlbSBhcMOzcyBhIHZlcmlmaWNhw6fDo28gZG8gYW1iaWVudGUgZGUgdGVzdGVcbiAgICBpZiAoIXByb3BzLmdpdGh1YlJlcG8gfHwgIXByb3BzLmdpdGh1YlRva2VuU2VjcmV0TmFtZSB8fCAhcHJvcHMuZ2l0aHViQnJhbmNoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0FzIHByb3ByaWVkYWRlcyBkbyBHaXRIdWIgc8OjbyBuZWNlc3PDoXJpYXMgcGFyYSBvIGRlcGxveSBkbyBBbXBsaWZ5LicpO1xuICAgIH1cblxuICAgIGNvbnN0IFtvd25lciwgcmVwb3NpdG9yeV0gPSBwcm9wcy5naXRodWJSZXBvLnNwbGl0KCcvJyk7XG4gICAgaWYgKCFvd25lciB8fCAhcmVwb3NpdG9yeSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdPIGdpdGh1YlJlcG8gZGV2ZSBlc3RhciBubyBmb3JtYXRvIFwib3duZXIvcmVwb3NpdG9yeVwiJyk7XG4gICAgfVxuXG4gICAgY29uc3QgYW1wbGlmeUFwcCA9IG5ldyBhbXBsaWZ5LkFwcCh0aGlzLCAnQ29zdEd1YXJkaWFuRnJvbnRlbmQnLCB7XG4gICAgICBhcHBOYW1lOiAnQ29zdEd1YXJkaWFuQXBwJyxcbiAgICAgIHNvdXJjZUNvZGVQcm92aWRlcjogbmV3IGFtcGxpZnkuR2l0SHViU291cmNlQ29kZVByb3ZpZGVyKHtcbiAgICAgICAgb3duZXIsXG4gICAgICAgIHJlcG9zaXRvcnksXG4gICAgICAgIG9hdXRoVG9rZW46IGNkay5TZWNyZXRWYWx1ZS5zZWNyZXRzTWFuYWdlcihwcm9wcy5naXRodWJUb2tlblNlY3JldE5hbWUsIHtcbiAgICAgICAgICBqc29uRmllbGQ6ICdnaXRodWItdG9rZW4nLFxuICAgICAgICB9KSxcbiAgICAgIH0pLFxuICAgICAgYnVpbGRTcGVjOiBidWlsZFNwZWMsXG4gICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczoge1xuICAgICAgICAnX0xJVkVfVVBEQVRFUyc6ICdbe1wicGtnXCI6XCJAYXdzLWFtcGxpZnkvY2xpXCIsXCJ0eXBlXCI6XCJucG1cIixcInZlcnNpb25cIjpcImxhdGVzdFwifV0nLFxuICAgICAgICAnQU1QTElGWV9OT0RFX1ZFUlNJT04nOiAnMTgnXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgY29uc3QgbWFpbkJyYW5jaCA9IGFtcGxpZnlBcHAuYWRkQnJhbmNoKHByb3BzLmdpdGh1YkJyYW5jaCwge1xuICAgICAgc3RhZ2U6ICdQUk9EVUNUSU9OJyxcbiAgICAgIGJyYW5jaE5hbWU6IHByb3BzLmdpdGh1YkJyYW5jaCxcbiAgICB9KTtcblxuICAgIC8vIERvbcOtbmlvIGN1c3RvbWl6YWRvXG4gICAgY29uc3QgaG9zdGVkWm9uZSA9IHJvdXRlNTMuSG9zdGVkWm9uZS5mcm9tSG9zdGVkWm9uZUF0dHJpYnV0ZXModGhpcywgJ0hvc3RlZFpvbmUnLCB7XG4gICAgICBob3N0ZWRab25lSWQ6IGhvc3RlZFpvbmVJZCxcbiAgICAgIHpvbmVOYW1lOiBkb21haW5OYW1lLFxuICAgIH0pO1xuXG4gICAgY29uc3QgY2VydGlmaWNhdGUgPSBuZXcgYWNtLkNlcnRpZmljYXRlKHRoaXMsICdTc2xDZXJ0aWZpY2F0ZScsIHtcbiAgICAgIGRvbWFpbk5hbWU6IGRvbWFpbk5hbWUsXG4gICAgICBzdWJqZWN0QWx0ZXJuYXRpdmVOYW1lczogW2B3d3cuJHtkb21haW5OYW1lfWBdLFxuICAgICAgdmFsaWRhdGlvbjogYWNtLkNlcnRpZmljYXRlVmFsaWRhdGlvbi5mcm9tRG5zKGhvc3RlZFpvbmUpLFxuICAgIH0pO1xuXG4gICAgY29uc3QgZG9tYWluID0gYW1wbGlmeUFwcC5hZGREb21haW4oZG9tYWluTmFtZSwge1xuICAgICAgZW5hYmxlQXV0b1N1YmRvbWFpbjogdHJ1ZSxcbiAgICAgIHN1YkRvbWFpbnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGJyYW5jaDogbWFpbkJyYW5jaCxcbiAgICAgICAgICBwcmVmaXg6ICd3d3cnLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcbiAgICBkb21haW4ubWFwUm9vdChtYWluQnJhbmNoKTtcbiAgfVxufVxuIl19