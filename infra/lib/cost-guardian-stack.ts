// infra/lib/cost-guardian-stack.ts

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets'; // Corrigido o import
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as sfn_tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam'; // Importar IAM

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
      // ATENÇÃO: publicReadAccess é deprecated. Em produção, considere usar
      // blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS e uma BucketPolicy
      // mais granular para s3:GetObject. Para este caso de uso específico
      // de template público, publicReadAccess: true é funcional.
      publicReadAccess: true,
      websiteIndexDocument: 'template.yaml', // Define o arquivo padrão para acesso via website endpoint
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Para fácil limpeza em ambientes de desenvolvimento
      autoDeleteObjects: true, // Para fácil limpeza em ambientes de desenvolvimento
    });

    // Implantação do template do CloudFormation no bucket S3
    new s3deploy.BucketDeployment(this, 'DeployCfnTemplate', {
      sources: [s3deploy.Source.asset('../docs/cost-guardian-template.yaml')],
      destinationBucket: templateBucket,
      destinationKey: 'template.yaml', // O nome do arquivo no bucket
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
      generateSecret: false, // Aplicações web de cliente não devem ter segredos
    });

    // Grupo de administradores no Cognito
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'Admins',
      description: 'Grupo para administradores da plataforma',
    });

    // *** INÍCIO DAS CORREÇÕES DE LAMBDA ***

    // 1. Lambda para o API Gateway (Monolito Express)
    const apiHandlerLambda = new lambda.Function(this, 'ApiHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.app', // Aponta para o Express app
      code: lambda.Code.fromAsset('../backend'),
      environment: {
        DYNAMODB_TABLE: table.tableName,
        STRIPE_SECRET_ARN: stripeSecret.secretArn, // Renomeado para clareza
      },
    });
    table.grantReadWriteData(apiHandlerLambda);
    stripeSecret.grantRead(apiHandlerLambda);

    // 2. Lambda para o EventBridge (Correlacionar Eventos Health)
    const healthEventHandlerLambda = new lambda.Function(this, 'HealthEventHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'functions/correlate-health.handler', // Handler específico
      code: lambda.Code.fromAsset('../backend'), // Mesmo pacote de código
      environment: {
        DYNAMODB_TABLE: table.tableName,
        SFN_ARN: '', // Será preenchido abaixo
      },
    });
    table.grantReadWriteData(healthEventHandlerLambda); // Precisa ler o GSI e escrever incidentes

    // 3. Lambdas para as Tarefas do Step Functions
    const slaCalculateImpactLambda = new lambda.Function(this, 'SlaCalculateImpact', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'functions/sla-workflow.calculateImpact', // Handler específico
      code: lambda.Code.fromAsset('../backend'),
      environment: {
        DYNAMODB_TABLE: table.tableName,
      },
      // Permissão para chamar Cost Explorer (Assumindo a Role do Cliente)
      role: new iam.Role(this, 'SlaCalcRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
        ],
        inlinePolicies: {
          AssumeCustomerRolePolicy: new iam.PolicyDocument({
            statements: [new iam.PolicyStatement({
              actions: ['sts:AssumeRole'],
              resources: ['arn:aws:iam::*:role/CostGuardianDelegatedRole'], // Permite assumir a role em *qualquer* conta cliente
            })]
          })
        }
      })
    });
    
    const slaCheckLambda = new lambda.Function(this, 'SlaCheck', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'functions/sla-workflow.checkSLA',
      code: lambda.Code.fromAsset('../backend'),
      environment: { DYNAMODB_TABLE: table.tableName },
    });

    const slaGenerateReportLambda = new lambda.Function(this, 'SlaGenerateReport', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'functions/sla-workflow.generateReport',
      code: lambda.Code.fromAsset('../backend'),
      environment: {
        DYNAMODB_TABLE: table.tableName,
        STRIPE_SECRET_ARN: stripeSecret.secretArn, // Passa a referência ao secret
        REPORTS_BUCKET_NAME: '', // Será preenchido após criar o bucket abaixo
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

    const slaSubmitTicketLambda = new lambda.Function(this, 'SlaSubmitTicket', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'functions/sla-workflow.submitSupportTicket',
      code: lambda.Code.fromAsset('../backend'),
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
    
    // *** FIM DAS CORREÇÕES DE LAMBDA ***

    // Obter o event bus padrão da plataforma
    const eventBus = events.EventBus.fromEventBusName(this, 'DefaultBus', 'default');

    // Política segura para o Event Bus que permite apenas regras EventBridge específicas
    new events.CfnEventBusPolicy(this, 'EventBusPolicy', {
      eventBusName: eventBus.eventBusName,
      statementId: 'AllowClientHealthEvents',
      action: 'events:PutEvents',
      principal: '*', // Necessário, mas restrito por condição
      condition: {
        type: 'ArnLike',
        key: 'aws:SourceArn',
        value: 'arn:aws:events:*:*:rule/cost-guardian-client-*/ClientHealthEventRule',
      },
    });

    // EventBridge Health (Corrigido com permissionamento seguro)
    const healthRule = new events.Rule(this, 'HealthEventRule', {
      eventPattern: {
        source: ['aws.health'],
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

    // Resources API (Corrigido)
    const onboard = api.root.addResource('onboard');
    onboard.addMethod('POST', apiIntegration); // Webhook, sem auth
    
    // Novo endpoint para gerar config de onboarding
    const onboardInit = api.root.addResource('onboard-init');
    onboardInit.addMethod('GET', apiIntegration, { authorizer: auth });

    const incidents = api.root.addResource('incidents');
    incidents.addMethod('GET', apiIntegration, { authorizer: auth });
    const slaClaims = api.root.addResource('sla-claims');
    slaClaims.addMethod('GET', apiIntegration, { authorizer: auth });

    const invoicesApi = api.root.addResource('invoices');
    invoicesApi.addMethod('GET', apiIntegration, { authorizer: auth });

    const termsApi = api.root.addResource('accept-terms');
    termsApi.addMethod('POST', apiIntegration, { authorizer: auth });

    // Endpoint de Admin
    const adminApi = api.root.addResource('admin');
    adminApi.addResource('claims').addMethod('GET', apiIntegration, { authorizer: auth });
    // New endpoint for admin to update claim status
    adminApi.addResource('claims')
      .addResource('{customerId}')
      .addResource('{claimId}')
      .addResource('status')
      .addMethod('PUT', apiIntegration, { authorizer: auth });
    // New endpoint for admin to create Stripe invoice and mark claim as refunded
    adminApi.addResource('claims')
      .addResource('{customerId}')
      .addResource('{claimId}')
      .addResource('create-invoice')
      .addMethod('POST', apiIntegration, { authorizer: auth });

    // Outputs (Mantido)
    new cdk.CfnOutput(this, 'APIUrl', { value: api.url });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
    new cdk.CfnOutput(this, 'SFNArn', { value: sfn.stateMachineArn });
    new cdk.CfnOutput(this, 'CfnTemplateUrl', {
      value: templateBucket.urlForObject('template.yaml'),
      description: 'URL do template do CloudFormation para o onboarding do cliente. Use esta URL no frontend.',
    });
  }
}