// infra/lib/cost-guardian-stack.ts

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambda_nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
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
}

export class CostGuardianStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CostGuardianStackProps) {
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
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING }, // Chave primária para usuários, claims, etc.
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING }, // Chave de classificação para modelagem flexível
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
        blockPublicPolicy: false, // Permite políticas públicas
        restrictPublicBuckets: false,
      }),
    });

    // Implantação do template do CloudFormation no bucket S3
    // Publica apenas o arquivo `cost-guardian-template.yaml` e o renomeia para `template.yaml`
    // Skip durante testes para evitar erros de asset não encontrado
    const docsPath = path.join(__dirname, '../../docs');
    const fs = require('fs');
    if (props.isTestEnvironment !== true && fs.existsSync(docsPath)) {
      new s3deploy.BucketDeployment(this, 'DeployCfnTemplate', {
        sources: [s3deploy.Source.asset(docsPath)], // Aponta especificamente para o diretório docs
        // Inclui apenas o template desejado
        include: ['cost-guardian-template.yaml'],
        // Renomeia o arquivo no S3 para a URL pública esperada
        destinationKeyPrefix: '',
        destinationBucket: templateBucket,
      });

      // Implantação do template TRIAL no bucket S3
      new s3deploy.BucketDeployment(this, 'DeployTrialCfnTemplate', {
        sources: [s3deploy.Source.asset(docsPath)],
        include: ['cost-guardian-TRIAL-template.yaml'],
        destinationKeyPrefix: '',
        destinationBucket: templateBucket,
      });
    } else if (!fs.existsSync(docsPath) && props.isTestEnvironment !== true) {
       console.warn(`Warning: Docs path not found at ${docsPath}. Skipping S3 template deployment.`);
    }


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
      handler: 'app', // export do express + serverless é exposto como 'app' no handler.js
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
      principal: '*', // Mantém cross-account, mas a condição abaixo restringe a role
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
      schedule: events.Schedule.cron({ minute: '0', hour: '5' }), // Todo dia às 05:00 UTC
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
            new iam.PolicyStatement({ actions: ['dynamodb:Query','dynamodb:Scan','dynamodb:GetItem','dynamodb:PutItem'], resources: [table.tableArn, `${table.tableArn}/index/*`] }),
            new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: ['arn:aws:iam::*:role/CostGuardianDelegatedRole'] }),
          ]})
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
            new iam.PolicyStatement({ actions: ['dynamodb:Query','dynamodb:Scan','dynamodb:GetItem','dynamodb:PutItem'], resources: [table.tableArn, `${table.tableArn}/index/*`] }),
            new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: ['arn:aws:iam::*:role/CostGuardianDelegatedRole'] }),
            new iam.PolicyStatement({ actions: ['rds:DescribeDBInstances'], resources: ['*'] }),
            new iam.PolicyStatement({ actions: ['cloudwatch:GetMetricStatistics'], resources: ['*'] }),
          ]})
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
            new iam.PolicyStatement({ actions: ['dynamodb:Query','dynamodb:Scan','dynamodb:GetItem'], resources: [table.tableArn, `${table.tableArn}/index/*`] }),
            new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: ['arn:aws:iam::*:role/CostGuardianDelegatedRole'] }),
          ]})
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
      schedule: events.Schedule.cron({ weekDay: 'SUN', hour: '3', minute: '0' }), // Domingo 03:00 UTC
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

    if (!props.githubRepo || !props.githubTokenSecretName || !props.githubBranch) {
      throw new Error('Os parâmetros githubRepo, githubTokenSecretName e githubBranch são obrigatórios para configurar o Amplify com GitHub');
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
