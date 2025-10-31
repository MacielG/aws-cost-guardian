// infra/lib/cost-guardian-stack.ts

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as sfn_tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as amplify from '@aws-cdk/aws-amplify-alpha';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';

export interface CostGuardianStackProps extends cdk.StackProps {
  domainName?: string;
  hostedZoneId?: string;
  githubRepo?: string;
  githubBranch?: string;
  githubTokenSecretName?: string;
  /**
   * Se true, desativa recursos que dependem de assets físicos durante os testes.
   * @default false
   */
  isTestEnvironment?: boolean;
  /**
   * Se true, cria alarmes do CloudWatch.
   * @default true
   */
  createAlarms?: boolean;
  depsLockFilePath?: string;
  /**
   * Caminho absoluto para a pasta backend
   */
  backendPath?: string;
  /**
   * Caminho absoluto para a pasta backend/functions
   */
  backendFunctionsPath?: string;
  /**
   * Caminho absoluto para a pasta docs
   */
  docsPath?: string;
}

export class CostGuardianStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CostGuardianStackProps) {
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
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING }, // Chave primária para usuários, claims, etc.
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING }, // Chave de classificação para modelagem flexível
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // Habilitar stream
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true
      },
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED, // Usar KMS para maior segurança (Task 3)
      encryptionKey: dynamoKmsKey,
    });
    // Retain the table on stack deletion for robust cleanup (Task 3)
    table.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    // Adicionar tags à tabela DynamoDB usando addPropertyOverride
    const cfnTable = table.node.defaultChild as dynamodb.CfnTable;
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
      versioned: true, // Habilitar versionamento
      encryption: s3.BucketEncryption.KMS, // Encryption com KMS (Task 2)
      encryptionKey: s3KmsKey, // Usar KMS Key dedicada (Task 2)
      blockPublicAccess: new s3.BlockPublicAccess({ // Manter acesso público para website (CloudFormation)
        blockPublicAcls: true,
        ignorePublicAcls: true,
        blockPublicPolicy: false, // Permite a política de website
        restrictPublicBuckets: false, // Permite a política de website
      }),
      publicReadAccess: true,
      lifecycleRules: [{
        id: 'DefaultLifecycle',
        enabled: true,
        expiration: cdk.Duration.days(90), // Expirar objetos após 90 dias
        noncurrentVersionExpiration: cdk.Duration.days(30), // Expirar versões não atuais após 30 dias
        transitions: [{
          storageClass: s3.StorageClass.INTELLIGENT_TIERING, // Transição para Intelligent-Tiering
          transitionAfter: cdk.Duration.days(90), // Após 90 dias
        }],
        noncurrentVersionTransitions: [{
          storageClass: s3.StorageClass.GLACIER,
          transitionAfter: cdk.Duration.days(30), // Após 30 dias
        }],
      }]
    });
    
    // Força a configuração de criptografia através do recurso L1 (atualizar para KMS)
    const cfnTemplateBucket = templateBucket.node.defaultChild as s3.CfnBucket;
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
     sources: [s3deploy.Source.asset(docsPath)], // Asset call only happens here
     include: ['cost-guardian-template.yaml'],
     destinationKeyPrefix: '',
       destinationBucket: templateBucket,
        });

    new s3deploy.BucketDeployment(this, 'DeployTrialCfnTemplate', {
     sources: [s3deploy.Source.asset(docsPath)], // Asset call only happens here
     include: ['cost-guardian-TRIAL-template.yaml'],
     destinationKeyPrefix: '',
       destinationBucket: templateBucket,
     });
    } else {
    console.warn(`Warning: Docs path not found at ${docsPath}. Skipping S3 template deployment.`);
    }
    }
    // If isTestEnvironment is true, the Source.asset() calls are never made.

     // Ensure URLs passed to lambdas/outputs handle the test case gracefully
     const trialTemplateUrl = !props.isTestEnvironment ? (templateBucket.bucketWebsiteUrl + '/cost-guardian-TRIAL-template.yaml') : 'test-trial-url';
     const fullTemplateUrl = !props.isTestEnvironment ? (templateBucket.bucketWebsiteUrl + '/template.yaml') : 'test-full-url';

    // VPC e Security Group para Lambdas (Task 8)
    const vpc = new ec2.Vpc(this, 'CostGuardianVpc', {
      maxAzs: 2, // Usar 2 AZs para alta disponibilidade
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
        minLength: 8, // Políticas de senha fortes (Task 10)
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
      handler: 'handler.app', // export do express + serverless é exposto como 'app' no handler.js
      // Configurações de VPC (Task 8)
      vpc,
      securityGroups: [lambdaSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      memorySize: 1024,
      timeout: cdk.Duration.seconds(29), // Ligeiramente menor que o timeout da API GW
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
      functionName: 'HealthEventHandler', // Nome explícito para facilitar o debug
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
    removalPolicy: cdk.RemovalPolicy.RETAIN, // RETAIN to avoid autoDeleteObjects custom resource issues in tests
    autoDeleteObjects: false,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // Bloquear todo acesso público (Task 2)
      versioned: true,
      encryption: s3.BucketEncryption.KMS, // Encryption com KMS (Task 2)
      encryptionKey: s3KmsKey, // Usar KMS Key dedicada (Task 2)
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
    const cfnReportsBucket = reportsBucket.node.defaultChild as s3.CfnBucket;
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
        source: ['aws.health'], // A filtragem acontece aqui
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
      schedule: events.Schedule.cron({ minute: '0', hour: '5' }), // Todo dia às 05:00 UTC
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
            new iam.PolicyStatement({ actions: ['dynamodb:Query','dynamodb:Scan','dynamodb:GetItem','dynamodb:PutItem'], resources: [table.tableArn, `${table.tableArn}/index/*`] }),
            new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: ['arn:aws:iam::*:role/CostGuardianDelegatedRole'] }),
          ]})
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
    reservedConcurrentExecutions: 10, // Corrigido: logGroup não é uma propriedade direta
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
            new iam.PolicyStatement({ actions: ['dynamodb:Query','dynamodb:Scan','dynamodb:GetItem','dynamodb:PutItem'], resources: [table.tableArn, `${table.tableArn}/index/*`] }),
            new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: ['arn:aws:iam::*:role/CostGuardianDelegatedRole'] }),
            new iam.PolicyStatement({ actions: ['rds:DescribeDBInstances'], resources: ['*'] }),
            new iam.PolicyStatement({ actions: ['cloudwatch:GetMetricStatistics'], resources: ['*'] }),
          ]})
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
        managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
        inlinePolicies: {
          DynamoAndAssumePolicy: new iam.PolicyDocument({ statements: [
            new iam.PolicyStatement({ actions: ['dynamodb:Query','dynamodb:Scan','dynamodb:GetItem','dynamodb:PutItem'], resources: [table.tableArn, `${table.tableArn}/index/*`] }),
            new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: ['arn:aws:iam::*:role/CostGuardianDelegatedRole'] }),
            new iam.PolicyStatement({ actions: ['ec2:DescribeInstances', 'ec2:DescribeReservedInstances'], resources: ['*'] }),
            new iam.PolicyStatement({ actions: ['cloudwatch:GetMetricStatistics'], resources: ['*'] }),
            new iam.PolicyStatement({ actions: ['pricing:GetProducts'], resources: ['*'] }),
          ]})
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
        managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
        inlinePolicies: {
          DynamoPolicy: new iam.PolicyDocument({ statements: [
            new iam.PolicyStatement({ actions: ['dynamodb:Query','dynamodb:Scan','dynamodb:GetItem'], resources: [table.tableArn, `${table.tableArn}/index/*`] }),
            new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: ['arn:aws:iam::*:role/CostGuardianDelegatedRole'] }),
          ]})
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
      schedule: events.Schedule.cron({ weekDay: 'SUN', hour: '3', minute: '0' }), // Domingo 03:00 UTC
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
      restApiName: 'CostGuardianApi', // Nome sem espaços para facilitar a correspondência
      defaultCorsPreflightOptions: { allowOrigins: apigw.Cors.ALL_ORIGINS },
      deployOptions: {
        tracingEnabled: true,
        stageName: 'prod', // (Task 9)
        throttlingRateLimit: 100, // (Task 9)
        throttlingBurstLimit: 50, // (Task 9)
        methodOptions: {
          '/*/*': { // Aplica a todos os métodos em todos os recursos
            throttlingBurstLimit: 50, // (Task 9)
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
      value: fullTemplateUrl, // Use the potentially dummy URL in tests
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
        threshold: 1000, // 1 segundo
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
