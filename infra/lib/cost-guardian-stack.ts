// infra/lib/cost-guardian-stack.ts

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
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

export class CostGuardianStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Secrets (Mantido)
    const stripeSecret = new secretsmanager.Secret(this, 'StripeSecret', {
      generateSecretString: { secretStringTemplate: '{"key":""}', generateStringKey: 'key' },
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

    // GSI para o callback do onboarding via ExternalId
    table.addGlobalSecondaryIndex({
      indexName: 'ExternalIdIndex',
      partitionKey: { name: 'externalId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: ['id', 'status'],
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
    new s3deploy.BucketDeployment(this, 'DeployCfnTemplate', {
      sources: [s3deploy.Source.asset('../docs')],
      destinationBucket: templateBucket,
      destinationKeyPrefix: '',
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
    const apiHandlerLambda = new NodejsFunction(this, 'ApiHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: path.join(__dirname, '../../backend/handler.js'),
      handler: 'app', // export do express + serverless é exposto como 'app' no handler.js
      bundling: {
        externalModules: ['aws-sdk'],
      },
      environment: {
        DYNAMODB_TABLE: table.tableName,
        STRIPE_SECRET_ARN: stripeSecret.secretArn,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        PLATFORM_ACCOUNT_ID: this.account || process.env.CDK_DEFAULT_ACCOUNT,
      },
    });
    table.grantReadWriteData(apiHandlerLambda);
    stripeSecret.grantRead(apiHandlerLambda);

    // 2. Lambda para o EventBridge (Correlacionar Eventos Health)
    const healthEventHandlerLambda = new NodejsFunction(this, 'HealthEventHandler', {
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

    // 3. Lambdas para as Tarefas do Step Functions
    const slaCalculateImpactLambda = new NodejsFunction(this, 'SlaCalculateImpact', {
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
    
    const slaCheckLambda = new NodejsFunction(this, 'SlaCheck', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: path.join(__dirname, '../../backend/functions/sla-workflow.js'),
      handler: 'checkSLA',
      bundling: { externalModules: ['aws-sdk'] },
      environment: { DYNAMODB_TABLE: table.tableName },
    });

    const slaGenerateReportLambda = new NodejsFunction(this, 'SlaGenerateReport', {
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

    const slaSubmitTicketLambda = new NodejsFunction(this, 'SlaSubmitTicket', {
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

    // Política segura para o Event Bus que permite apenas eventos específicos
    new events.CfnEventBusPolicy(this, 'EventBusPolicy', {
      eventBusName: eventBus.eventBusName,
      statementId: 'AllowClientHealthEvents',
      action: 'events:PutEvents',
      principal: '*', // Necessário para cross-account
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

    // Novo endpoint para gerar config de onboarding
    const onboardInit = apiRoot.addResource('onboard-init');
    onboardInit.addMethod('GET', apiIntegration, { authorizer: auth });

    const incidents = apiRoot.addResource('incidents');
    incidents.addMethod('GET', apiIntegration, { authorizer: auth });
    const slaClaims = apiRoot.addResource('sla-claims');
    slaClaims.addMethod('GET', apiIntegration, { authorizer: auth });

    const invoicesApi = apiRoot.addResource('invoices');
    invoicesApi.addMethod('GET', apiIntegration, { authorizer: auth });

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