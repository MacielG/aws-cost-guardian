"use strict";
// infra/lib/cost-guardian-stack.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.CostGuardianStack = void 0;
const cdk = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
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
class CostGuardianStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Secrets (Mantido)
        const stripeSecret = new secretsmanager.Secret(this, 'StripeSecret', {
            generateSecretString: { secretStringTemplate: '{"key":""}', generateStringKey: 'key' },
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
        const apiHandlerLambda = new lambda.Function(this, 'ApiHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'handler.app',
            code: lambda.Code.fromAsset('../backend'),
            environment: {
                DYNAMODB_TABLE: table.tableName,
                STRIPE_SECRET_ARN: stripeSecret.secretArn,
            },
        });
        table.grantReadWriteData(apiHandlerLambda);
        stripeSecret.grantRead(apiHandlerLambda);
        // 2. Lambda para o EventBridge (Correlacionar Eventos Health)
        const healthEventHandlerLambda = new lambda.Function(this, 'HealthEventHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'functions/correlate-health.handler',
            code: lambda.Code.fromAsset('../backend'),
            environment: {
                DYNAMODB_TABLE: table.tableName,
                SFN_ARN: '', // Será preenchido abaixo
            },
        });
        table.grantReadWriteData(healthEventHandlerLambda);
        // 3. Lambdas para as Tarefas do Step Functions
        const slaCalculateImpactLambda = new lambda.Function(this, 'SlaCalculateImpact', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'functions/sla-workflow.calculateImpact',
            code: lambda.Code.fromAsset('../backend'),
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
        // Obter o event bus padrão da plataforma
        const eventBus = events.EventBus.fromEventBusName(this, 'DefaultBus', 'default');
        // Política segura para o Event Bus que permite apenas eventos específicos
        const eventBusPolicy = new events.CfnEventBusPolicy(this, 'EventBusPolicy', {
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
            value: templateBucket.urlForObject('template.yaml'),
            description: 'URL do template do CloudFormation para o onboarding do cliente. Use esta URL no frontend.',
        });
    }
}
exports.CostGuardianStack = CostGuardianStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29zdC1ndWFyZGlhbi1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNvc3QtZ3VhcmRpYW4tc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLG1DQUFtQzs7O0FBRW5DLG1DQUFtQztBQUVuQyxpREFBaUQ7QUFDakQsb0RBQW9EO0FBQ3BELHFEQUFxRDtBQUNyRCxtREFBbUQ7QUFDbkQseUNBQXlDO0FBQ3pDLDBEQUEwRDtBQUMxRCxpREFBaUQ7QUFDakQsMERBQTBEO0FBQzFELCtEQUErRDtBQUMvRCxpRUFBaUU7QUFDakUsaUVBQWlFO0FBQ2pFLDJDQUEyQztBQUUzQyxNQUFhLGlCQUFrQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzlDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsb0JBQW9CO1FBQ3BCLE1BQU0sWUFBWSxHQUFHLElBQUksY0FBYyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ25FLG9CQUFvQixFQUFFLEVBQUUsb0JBQW9CLEVBQUUsWUFBWSxFQUFFLGlCQUFpQixFQUFFLEtBQUssRUFBRTtTQUN2RixDQUFDLENBQUM7UUFFSCxvRUFBb0U7UUFDcEUsTUFBTSxLQUFLLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRTtZQUMxRCxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtZQUNqRSxPQUFPLEVBQUUsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtZQUM1RCxXQUFXLEVBQUUsUUFBUSxDQUFDLFdBQVcsQ0FBQyxlQUFlO1lBQ2pELGFBQWEsRUFBRSxHQUFHLENB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RyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO1FBQ3RFLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUUsRUFBRSxLQUFLLEVBQUUsY0FBYyxDQUFDLGdCQUFnQixFQUFFLENBQUMsQ0FBQztRQUN4RixJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFdBQVcsRUFBRSxFQUFFLEtBQUssRUFBRSxLQUFLLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQztRQUNqRSxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRSxFQUFFLEtBQUssRUFBRSxHQUFHLENBQUMsZUFBZSxFQUFFLENBQUMsQ0FBQztRQUNsRSxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQ3hDLEtBQUssRUFBRSxjQUFjLENBQUMsWUFBWSxDQUFDLGVBQWUsQ0FBQztZQUNuRCxXQUFXLEVBQUUsMkZBQTJGO1NBQ3pHLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQWxURCw4Q0FrVEMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBpbmZyYS9saWIvY29zdC1ndWFyZGlhbi1zdGFjay50c1xyXG5cclxuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcclxuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XHJcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcclxuaW1wb3J0ICogYXMgYXBpZ3cgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xyXG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xyXG5pbXBvcnQgKiBhcyBjb2duaXRvIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2duaXRvJztcclxuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcclxuaW1wb3J0ICogYXMgczNkZXBsb3kgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzLWRlcGxveW1lbnQnO1xyXG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cyc7XHJcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcclxuaW1wb3J0ICogYXMgc3RlcGZ1bmN0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucyc7XHJcbmltcG9ydCAqIGFzIHNmbl90YXNrcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucy10YXNrcyc7XHJcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuXHJcbmV4cG9ydCBjbGFzcyBDb3N0R3VhcmRpYW5TdGFjayBleHRlbmRzIGNkay5TdGFjayB7XHJcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xyXG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XHJcblxyXG4gICAgLy8gU2VjcmV0cyAoTWFudGlkbylcclxuICAgIGNvbnN0IHN0cmlwZVNlY3JldCA9IG5ldyBzZWNyZXRzbWFuYWdlci5TZWNyZXQodGhpcywgJ1N0cmlwZVNlY3JldCcsIHtcclxuICAgICAgZ2VuZXJhdGVTZWNyZXRTdHJpbmc6IHsgc2VjcmV0U3RyaW5nVGVtcGxhdGU6ICd7XCJrZXlcIjpcIlwifScsIGdlbmVyYXRlU3RyaW5nS2V5OiAna2V5JyB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gRHluYW1vREIgKE1hbnRpZG8sIG1hcyBhZGljaW9uYW5kbyBzdHJlYW0gcGFyYSBlZmljacOqbmNpYSBmdXR1cmEpXHJcbiAgICBjb25zdCB0YWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnQ29zdEd1YXJkaWFuVGFibGUnLCB7XHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LCAvLyBDaGF2ZSBwcmltw6FyaWEgcGFyYSB1c3XDoXJpb3MsIGNsYWltcywgZXRjLlxyXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdzaycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sIC8vIENoYXZlIGRlIGNsYXNzaWZpY2HDp8OjbyBwYXJhIG1vZGVsYWdlbSBmbGV4w612ZWxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgICAgc3RyZWFtOiBkeW5hbW9kYi5TdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVMsIC8vIEhhYmlsaXRhciBzdHJlYW1cclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdTSSBwYXJhIG1hcGVhciBBV1MgQWNjb3VudCBJRCBwYXJhIG5vc3NvIEN1c3RvbWVyIElEIChDUsONVElDTyBwYXJhIGNvcnJlbGHDp8OjbylcclxuICAgIHRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnQXdzQWNjb3VudEluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdhd3NBY2NvdW50SWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuSU5DTFVERSxcclxuICAgICAgbm9uS2V5QXR0cmlidXRlczogWydpZCddLCAvLyBQcm9qZXRhciBvICdpZCcgKG5vc3NvIEN1c3RvbWVyIElEKVxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR1NJIHBhcmEgbyBjYWxsYmFjayBkbyBvbmJvYXJkaW5nIHZpYSBFeHRlcm5hbElkXHJcbiAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0V4dGVybmFsSWRJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnZXh0ZXJuYWxJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5JTkNMVURFLFxyXG4gICAgICBub25LZXlBdHRyaWJ1dGVzOiBbJ2lkJywgJ3N0YXR1cyddLFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIEdTSSBwYXJhIGNvbnN1bHRhciBwb3IgY2xpZW50ZSAoZXg6IGluY2lkZW50ZXMsIGNsYWltcylcclxuICAgIHRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnQ3VzdG9tZXJEYXRhSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAnc2snLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR1NJIHBhcmEgY29uc3VsdGFzIGRlIEFkbWluICh1c2FyIGVudGl0eS9wYXJ0aXRpb24gc2hhcmRpbmcgcGFyYSBwZXJmb3JtYW5jZSlcclxuICAgIHRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnQWRtaW5WaWV3SW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2VudGl0eVR5cGUnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdjcmVhdGVkQXQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuSU5DTFVERSxcclxuICAgICAgbm9uS2V5QXR0cmlidXRlczogWydzdGF0dXMnLCAnY3JlZGl0QW1vdW50JywgJ3JlcG9ydFVybCcsICdpbmNpZGVudElkJywgJ2F3c0FjY291bnRJZCcsICdzdHJpcGVJbnZvaWNlSWQnLCAnY2FzZUlkJywgJ3N1Ym1pc3Npb25FcnJvcicsICdyZXBvcnRFcnJvcicsICdjb21taXNzaW9uQW1vdW50J10sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTMyBCdWNrZXQgcGFyYSBob3NwZWRhciBvIHRlbXBsYXRlIGRvIENsb3VkRm9ybWF0aW9uXHJcbiAgICBjb25zdCB0ZW1wbGF0ZUJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ0NmblRlbXBsYXRlQnVja2V0Jywge1xyXG4gICAgICBwdWJsaWNSZWFkQWNjZXNzOiB0cnVlLFxyXG4gICAgICB3ZWJzaXRlSW5kZXhEb2N1bWVudDogJ3RlbXBsYXRlLnlhbWwnLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEltcGxhbnRhw6fDo28gZG8gdGVtcGxhdGUgZG8gQ2xvdWRGb3JtYXRpb24gbm8gYnVja2V0IFMzXHJcbiAgICBuZXcgczNkZXBsb3kuQnVja2V0RGVwbG95bWVudCh0aGlzLCAnRGVwbG95Q2ZuVGVtcGxhdGUnLCB7XHJcbiAgICAgIHNvdXJjZXM6IFtzM2RlcGxveS5Tb3VyY2UuYXNzZXQoJy4uL2RvY3MnKV0sXHJcbiAgICAgIGRlc3RpbmF0aW9uQnVja2V0OiB0ZW1wbGF0ZUJ1Y2tldCxcclxuICAgICAgZGVzdGluYXRpb25LZXlQcmVmaXg6ICcnLFxyXG4gICAgfSk7XHJcblxyXG5cclxuICAgIC8vIENvZ25pdG8gKE1hbnRpZG8pXHJcbiAgICBjb25zdCB1c2VyUG9vbCA9IG5ldyBjb2duaXRvLlVzZXJQb29sKHRoaXMsICdDb3N0R3VhcmRpYW5Qb29sJywge1xyXG4gICAgICBzZWxmU2lnblVwRW5hYmxlZDogdHJ1ZSxcclxuICAgICAgc2lnbkluQWxpYXNlczogeyBlbWFpbDogdHJ1ZSB9LFxyXG4gICAgICBhdXRvVmVyaWZ5OiB7IGVtYWlsOiB0cnVlIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDbGllbnRlIGRvIFVzZXIgUG9vbCBwYXJhIGEgYXBsaWNhw6fDo28gd2ViXHJcbiAgICBjb25zdCB1c2VyUG9vbENsaWVudCA9IG5ldyBjb2duaXRvLlVzZXJQb29sQ2xpZW50KHRoaXMsICdDb3N0R3VhcmRpYW5Vc2VyUG9vbENsaWVudCcsIHtcclxuICAgICAgdXNlclBvb2wsXHJcbiAgICAgIGdlbmVyYXRlU2VjcmV0OiBmYWxzZSwgXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHcnVwbyBkZSBhZG1pbmlzdHJhZG9yZXMgbm8gQ29nbml0b1xyXG4gICAgbmV3IGNvZ25pdG8uQ2ZuVXNlclBvb2xHcm91cCh0aGlzLCAnQWRtaW5Hcm91cCcsIHtcclxuICAgICAgdXNlclBvb2xJZDogdXNlclBvb2wudXNlclBvb2xJZCxcclxuICAgICAgZ3JvdXBOYW1lOiAnQWRtaW5zJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdHcnVwbyBwYXJhIGFkbWluaXN0cmFkb3JlcyBkYSBwbGF0YWZvcm1hJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIDEuIExhbWJkYSBwYXJhIG8gQVBJIEdhdGV3YXkgKE1vbm9saXRvIEV4cHJlc3MpXHJcbiAgICBjb25zdCBhcGlIYW5kbGVyTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnQXBpSGFuZGxlcicsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdoYW5kbGVyLmFwcCcsIFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uL2JhY2tlbmQnKSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFNUUklQRV9TRUNSRVRfQVJOOiBzdHJpcGVTZWNyZXQuc2VjcmV0QXJuLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgICB0YWJsZS5ncmFudFJlYWRXcml0ZURhdGEoYXBpSGFuZGxlckxhbWJkYSk7XHJcbiAgICBzdHJpcGVTZWNyZXQuZ3JhbnRSZWFkKGFwaUhhbmRsZXJMYW1iZGEpO1xyXG5cclxuICAgIC8vIDIuIExhbWJkYSBwYXJhIG8gRXZlbnRCcmlkZ2UgKENvcnJlbGFjaW9uYXIgRXZlbnRvcyBIZWFsdGgpXHJcbiAgICBjb25zdCBoZWFsdGhFdmVudEhhbmRsZXJMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdIZWFsdGhFdmVudEhhbmRsZXInLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnZnVuY3Rpb25zL2NvcnJlbGF0ZS1oZWFsdGguaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnLi4vYmFja2VuZCcpLCBcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFNGTl9BUk46ICcnLCAvLyBTZXLDoSBwcmVlbmNoaWRvIGFiYWl4b1xyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgICB0YWJsZS5ncmFudFJlYWRXcml0ZURhdGEoaGVhbHRoRXZlbnRIYW5kbGVyTGFtYmRhKTtcclxuXHJcbiAgICAvLyAzLiBMYW1iZGFzIHBhcmEgYXMgVGFyZWZhcyBkbyBTdGVwIEZ1bmN0aW9uc1xyXG4gICAgY29uc3Qgc2xhQ2FsY3VsYXRlSW1wYWN0TGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnU2xhQ2FsY3VsYXRlSW1wYWN0Jywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2Z1bmN0aW9ucy9zbGEtd29ya2Zsb3cuY2FsY3VsYXRlSW1wYWN0JyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi9iYWNrZW5kJyksXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgfSxcclxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdTbGFDYWxjUm9sZScsIHtcclxuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcclxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcclxuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpXHJcbiAgICAgICAgXSxcclxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xyXG4gICAgICAgICAgQXNzdW1lQ3VzdG9tZXJSb2xlUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcclxuICAgICAgICAgICAgc3RhdGVtZW50czogW25ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgICBhY3Rpb25zOiBbJ3N0czpBc3N1bWVSb2xlJ10sXHJcbiAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbJ2Fybjphd3M6aWFtOjoqOnJvbGUvQ29zdEd1YXJkaWFuRGVsZWdhdGVkUm9sZSddLCBcclxuICAgICAgICAgICAgfSldXHJcbiAgICAgICAgICB9KVxyXG4gICAgICAgIH1cclxuICAgICAgfSlcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBjb25zdCBzbGFDaGVja0xhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1NsYUNoZWNrJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2Z1bmN0aW9ucy9zbGEtd29ya2Zsb3cuY2hlY2tTTEEnLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uL2JhY2tlbmQnKSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHsgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3Qgc2xhR2VuZXJhdGVSZXBvcnRMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdTbGFHZW5lcmF0ZVJlcG9ydCcsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdmdW5jdGlvbnMvc2xhLXdvcmtmbG93LmdlbmVyYXRlUmVwb3J0JyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi9iYWNrZW5kJyksXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBTVFJJUEVfU0VDUkVUX0FSTjogc3RyaXBlU2VjcmV0LnNlY3JldEFybixcclxuICAgICAgICBSRVBPUlRTX0JVQ0tFVF9OQU1FOiAnJywgLy8gU2Vyw6EgcHJlZW5jaGlkbyBhYmFpeG9cclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHNsYUdlbmVyYXRlUmVwb3J0TGFtYmRhKTtcclxuICAgIHN0cmlwZVNlY3JldC5ncmFudFJlYWQoc2xhR2VuZXJhdGVSZXBvcnRMYW1iZGEpO1xyXG5cclxuICAgIC8vIENyaWFyIGJ1Y2tldCBTMyBwYXJhIGFybWF6ZW5hciByZWxhdMOzcmlvcyBQREYgZ2VyYWRvcyBwZWxhIExhbWJkYVxyXG4gICAgY29uc3QgcmVwb3J0c0J1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ1JlcG9ydHNCdWNrZXQnLCB7XHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiB0cnVlLFxyXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gRm9ybmVjZXIgbyBub21lIGRvIGJ1Y2tldCBjb21vIHZhcmnDoXZlbCBkZSBhbWJpZW50ZSBwYXJhIGEgTGFtYmRhIChhdHVhbGl6YSlcclxuICAgIHNsYUdlbmVyYXRlUmVwb3J0TGFtYmRhLmFkZEVudmlyb25tZW50KCdSRVBPUlRTX0JVQ0tFVF9OQU1FJywgcmVwb3J0c0J1Y2tldC5idWNrZXROYW1lKTtcclxuXHJcbiAgICAvLyBQZXJtaXNzw7VlcyBuZWNlc3PDoXJpYXMgcGFyYSBhIExhbWJkYSBlc2NyZXZlciBvYmpldG9zIG5vIGJ1Y2tldFxyXG4gICAgcmVwb3J0c0J1Y2tldC5ncmFudFB1dChzbGFHZW5lcmF0ZVJlcG9ydExhbWJkYSk7XHJcblxyXG4gICAgY29uc3Qgc2xhU3VibWl0VGlja2V0TGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnU2xhU3VibWl0VGlja2V0Jywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2Z1bmN0aW9ucy9zbGEtd29ya2Zsb3cuc3VibWl0U3VwcG9ydFRpY2tldCcsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnLi4vYmFja2VuZCcpLFxyXG4gICAgICBlbnZpcm9ubWVudDogeyBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lIH0sXHJcbiAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnU2xhU3VibWl0Um9sZScsIHtcclxuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcclxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcclxuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpXHJcbiAgICAgICAgXSxcclxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xyXG4gICAgICAgICAgQXNzdW1lQ3VzdG9tZXJSb2xlUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcclxuICAgICAgICAgICAgc3RhdGVtZW50czogW25ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgICBhY3Rpb25zOiBbJ3N0czpBc3N1bWVSb2xlJ10sXHJcbiAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbJ2Fybjphd3M6aWFtOjoqOnJvbGUvQ29zdEd1YXJkaWFuRGVsZWdhdGVkUm9sZSddLFxyXG4gICAgICAgICAgICB9KV1cclxuICAgICAgICAgIH0pXHJcbiAgICAgICAgfVxyXG4gICAgICB9KVxyXG4gICAgfSk7XHJcbiAgICB0YWJsZS5ncmFudFJlYWRXcml0ZURhdGEoc2xhU3VibWl0VGlja2V0TGFtYmRhKTtcclxuICAgIFxyXG4gICAgLy8gT2J0ZXIgbyBldmVudCBidXMgcGFkcsOjbyBkYSBwbGF0YWZvcm1hXHJcbiAgICBjb25zdCBldmVudEJ1cyA9IGV2ZW50cy5FdmVudEJ1cy5mcm9tRXZlbnRCdXNOYW1lKHRoaXMsICdEZWZhdWx0QnVzJywgJ2RlZmF1bHQnKTtcclxuXHJcbiAgICAvLyBQb2zDrXRpY2Egc2VndXJhIHBhcmEgbyBFdmVudCBCdXMgcXVlIHBlcm1pdGUgYXBlbmFzIGV2ZW50b3MgZXNwZWPDrWZpY29zXHJcbiAgICBjb25zdCBldmVudEJ1c1BvbGljeSA9IG5ldyBldmVudHMuQ2ZuRXZlbnRCdXNQb2xpY3kodGhpcywgJ0V2ZW50QnVzUG9saWN5Jywge1xyXG4gICAgICBldmVudEJ1c05hbWU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZSxcclxuICAgICAgc3RhdGVtZW50SWQ6ICdBbGxvd0NsaWVudEhlYWx0aEV2ZW50cycsXHJcbiAgICAgIGFjdGlvbjogJ2V2ZW50czpQdXRFdmVudHMnLFxyXG4gICAgICBwcmluY2lwYWw6ICcqJywgLy8gTmVjZXNzw6FyaW8gcGFyYSBjcm9zcy1hY2NvdW50XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAtLS0gSU7DjUNJTyBEQSBDT1JSRcOHw4NPIC0tLVxyXG4gICAgLy8gUkVNT1ZBIGVzdGUgYmxvY28uIEEgZmlsdHJhZ2VtIGRlICdldmVudHM6c291cmNlJyDDqSBmZWl0YVxyXG4gICAgLy8gcGVsYSAnaGVhbHRoUnVsZScgYWJhaXhvLCBuw6NvIHBlbGEgcG9sw610aWNhIGRvIGJhcnJhbWVudG8uXHJcbiAgICAvKlxyXG4gICAgZXZlbnRCdXNQb2xpY3kuYWRkUHJvcGVydHlPdmVycmlkZSgnQ29uZGl0aW9uJywge1xyXG4gICAgICBUeXBlOiAnU3RyaW5nRXF1YWxzJyxcclxuICAgICAgS2V5OiAnZXZlbnRzOnNvdXJjZScsXHJcbiAgICAgIFZhbHVlOiAnYXdzLmhlYWx0aCcsXHJcbiAgICB9KTtcclxuICAgICovXHJcbiAgICAvLyAtLS0gRklNIERBIENPUlJFw4fDg08gLS0tXHJcblxyXG4gICAgLy8gRXZlbnRCcmlkZ2UgSGVhbHRoIChFc3RhIMOpIGEgcmVncmEgZGUgRklMVFJBR0VNIGNvcnJldGEpXHJcbiAgICBjb25zdCBoZWFsdGhSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdIZWFsdGhFdmVudFJ1bGUnLCB7XHJcbiAgICAgIGV2ZW50UGF0dGVybjoge1xyXG4gICAgICAgIHNvdXJjZTogWydhd3MuaGVhbHRoJ10sIC8vIEEgZmlsdHJhZ2VtIGFjb250ZWNlIGFxdWlcclxuICAgICAgICBkZXRhaWxUeXBlOiBbJ0FXUyBIZWFsdGggRXZlbnQnXSxcclxuICAgICAgfSxcclxuICAgICAgZXZlbnRCdXMsXHJcbiAgICAgIHRhcmdldHM6IFtuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihoZWFsdGhFdmVudEhhbmRsZXJMYW1iZGEpXSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFN0ZXAgRnVuY3Rpb25zIFNMQSAoVXNhbmRvIG9zIExhbWJkYXMgY29ycmV0b3MpXHJcbiAgICBjb25zdCBjYWxjdWxhdGVJbXBhY3RUYXNrID0gbmV3IHNmbl90YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ0NhbGN1bGF0ZUltcGFjdCcsIHsgbGFtYmRhRnVuY3Rpb246IHNsYUNhbGN1bGF0ZUltcGFjdExhbWJkYSwgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCcgfSk7XHJcbiAgICBjb25zdCBjaGVja1NsYVRhc2sgPSBuZXcgc2ZuX3Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnQ2hlY2tTTEEnLCB7IGxhbWJkYUZ1bmN0aW9uOiBzbGFDaGVja0xhbWJkYSwgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCcgfSk7XHJcbiAgICBjb25zdCBnZW5lcmF0ZVJlcG9ydFRhc2sgPSBuZXcgc2ZuX3Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnR2VuZXJhdGVSZXBvcnQnLCB7IGxhbWJkYUZ1bmN0aW9uOiBzbGFHZW5lcmF0ZVJlcG9ydExhbWJkYSwgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCcgfSk7XHJcbiAgICBjb25zdCBzdWJtaXRUaWNrZXRUYXNrID0gbmV3IHNmbl90YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ1N1Ym1pdFRpY2tldCcsIHsgbGFtYmRhRnVuY3Rpb246IHNsYVN1Ym1pdFRpY2tldExhbWJkYSwgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCcgfSk7XHJcbiAgICBjb25zdCBub0NsYWltID0gbmV3IHN0ZXBmdW5jdGlvbnMuU3VjY2VlZCh0aGlzLCAnTm9DbGFpbUdlbmVyYXRlZCcpO1xyXG5cclxuICAgIGNvbnN0IGNsYWltQ2hvaWNlID0gbmV3IHN0ZXBmdW5jdGlvbnMuQ2hvaWNlKHRoaXMsICdJc0NsYWltR2VuZXJhdGVkPycpXHJcbiAgICAgIC53aGVuKHN0ZXBmdW5jdGlvbnMuQ29uZGl0aW9uLnN0cmluZ0VxdWFscygnJC5zdGF0dXMnLCAnZ2VuZXJhdGVkJyksIHN1Ym1pdFRpY2tldFRhc2spXHJcbiAgICAgIC5vdGhlcndpc2Uobm9DbGFpbSk7XHJcblxyXG4gICAgY29uc3Qgc2xhRGVmaW5pdGlvbiA9IGNhbGN1bGF0ZUltcGFjdFRhc2tcclxuICAgICAgLm5leHQoY2hlY2tTbGFUYXNrKVxyXG4gICAgICAubmV4dChnZW5lcmF0ZVJlcG9ydFRhc2spXHJcbiAgICAgIC5uZXh0KGNsYWltQ2hvaWNlKTtcclxuXHJcbiAgICBjb25zdCBzZm4gPSBuZXcgc3RlcGZ1bmN0aW9ucy5TdGF0ZU1hY2hpbmUodGhpcywgJ1NMQVdvcmtmbG93Jywge1xyXG4gICAgICBkZWZpbml0aW9uQm9keTogc3RlcGZ1bmN0aW9ucy5EZWZpbml0aW9uQm9keS5mcm9tQ2hhaW5hYmxlKHNsYURlZmluaXRpb24pLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQWRpY2lvbmFyIG8gQVJOIGRvIFNGTiBhbyBMYW1iZGEgZGUgY29ycmVsYcOnw6NvXHJcbiAgICBoZWFsdGhFdmVudEhhbmRsZXJMYW1iZGEuYWRkRW52aXJvbm1lbnQoJ1NGTl9BUk4nLCBzZm4uc3RhdGVNYWNoaW5lQXJuKTtcclxuICAgIC8vIFBlcm1pc3PDo28gcGFyYSBvIExhbWJkYSBpbmljaWFyIGEgU3RhdGUgTWFjaGluZVxyXG4gICAgc2ZuLmdyYW50U3RhcnRFeGVjdXRpb24oaGVhbHRoRXZlbnRIYW5kbGVyTGFtYmRhKTtcclxuXHJcbiAgICAvLyBBUEkgR2F0ZXdheSAoVXNhbmRvIG8gJ2FwaUhhbmRsZXJMYW1iZGEnIGNvcnJldG8pXHJcbiAgICBjb25zdCBhcGkgPSBuZXcgYXBpZ3cuUmVzdEFwaSh0aGlzLCAnQ29zdEd1YXJkaWFuQVBJJywge1xyXG4gICAgICByZXN0QXBpTmFtZTogJ0Nvc3QgR3VhcmRpYW4gQVBJJyxcclxuICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB7IGFsbG93T3JpZ2luczogYXBpZ3cuQ29ycy5BTExfT1JJR0lOUyB9LFxyXG4gICAgfSk7XHJcbiAgICBjb25zdCBhdXRoID0gbmV3IGFwaWd3LkNvZ25pdG9Vc2VyUG9vbHNBdXRob3JpemVyKHRoaXMsICdDb2duaXRvQXV0aCcsIHtcclxuICAgICAgY29nbml0b1VzZXJQb29sczogW3VzZXJQb29sXSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGFwaUludGVncmF0aW9uID0gbmV3IGFwaWd3LkxhbWJkYUludGVncmF0aW9uKGFwaUhhbmRsZXJMYW1iZGEpO1xyXG5cclxuICAgIC8vIFJlc291cmNlcyBBUEkgKENvcnJpZ2lkbylcclxuICAgIGNvbnN0IG9uYm9hcmQgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnb25ib2FyZCcpO1xyXG4gICAgb25ib2FyZC5hZGRNZXRob2QoJ1BPU1QnLCBhcGlJbnRlZ3JhdGlvbik7IC8vIFdlYmhvb2ssIHNlbSBhdXRoXHJcbiAgICBcclxuICAgIC8vIE5vdm8gZW5kcG9pbnQgcGFyYSBnZXJhciBjb25maWcgZGUgb25ib2FyZGluZ1xyXG4gICAgY29uc3Qgb25ib2FyZEluaXQgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnb25ib2FyZC1pbml0Jyk7XHJcbiAgICBvbmJvYXJkSW5pdC5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gICAgY29uc3QgaW5jaWRlbnRzID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2luY2lkZW50cycpO1xyXG4gICAgaW5jaWRlbnRzLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcclxuICAgIGNvbnN0IHNsYUNsYWltcyA9IGFwaS5yb290LmFkZFJlc291cmNlKCdzbGEtY2xhaW1zJyk7XHJcbiAgICBzbGFDbGFpbXMuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xyXG5cclxuICAgIGNvbnN0IGludm9pY2VzQXBpID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2ludm9pY2VzJyk7XHJcbiAgICBpbnZvaWNlc0FwaS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gICAgY29uc3QgdGVybXNBcGkgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnYWNjZXB0LXRlcm1zJyk7XHJcbiAgICB0ZXJtc0FwaS5hZGRNZXRob2QoJ1BPU1QnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xyXG5cclxuICAgIC8vIEVuZHBvaW50IGRlIEFkbWluXHJcbiAgICBjb25zdCBhZG1pbkFwaSA9IGFwaS5yb290LmFkZFJlc291cmNlKCdhZG1pbicpO1xyXG4gICAgY29uc3QgYWRtaW5DbGFpbXMgPSBhZG1pbkFwaS5hZGRSZXNvdXJjZSgnY2xhaW1zJyk7XHJcbiAgICBcclxuICAgIC8vIEdFVCAvYXBpL2FkbWluL2NsYWltc1xyXG4gICAgYWRtaW5DbGFpbXMuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xyXG5cclxuICAgIC8vIFN1Yi1yZWN1cnNvcyBwYXJhIG9wZXJhw6fDtWVzIGVtIGNsYWltcyBlc3BlY8OtZmljYXNcclxuICAgIGNvbnN0IGNsYWltc0J5Q3VzdG9tZXIgPSBhZG1pbkNsYWltcy5hZGRSZXNvdXJjZSgne2N1c3RvbWVySWR9Jyk7XHJcbiAgICBjb25zdCBzcGVjaWZpY0NsYWltID0gY2xhaW1zQnlDdXN0b21lci5hZGRSZXNvdXJjZSgne2NsYWltSWR9Jyk7XHJcbiAgICBcclxuICAgIC8vIFBVVCAvYXBpL2FkbWluL2NsYWltcy97Y3VzdG9tZXJJZH0ve2NsYWltSWR9L3N0YXR1c1xyXG4gICAgc3BlY2lmaWNDbGFpbS5hZGRSZXNvdXJjZSgnc3RhdHVzJykuYWRkTWV0aG9kKCdQVVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xyXG4gICAgXHJcbiAgICAvLyBQT1NUIC9hcGkvYWRtaW4vY2xhaW1zL3tjdXN0b21lcklkfS97Y2xhaW1JZH0vY3JlYXRlLWludm9pY2VcclxuICAgIHNwZWNpZmljQ2xhaW0uYWRkUmVzb3VyY2UoJ2NyZWF0ZS1pbnZvaWNlJykuYWRkTWV0aG9kKCdQT1NUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcclxuXHJcbiAgICAvLyBPdXRwdXRzIChNYW50aWRvKVxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FQSVVybCcsIHsgdmFsdWU6IGFwaS51cmwgfSk7XHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xJZCcsIHsgdmFsdWU6IHVzZXJQb29sLnVzZXJQb29sSWQgfSk7XHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xDbGllbnRJZCcsIHsgdmFsdWU6IHVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQgfSk7XHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVGFibGVOYW1lJywgeyB2YWx1ZTogdGFibGUudGFibGVOYW1lIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1NGTkFybicsIHsgdmFsdWU6IHNmbi5zdGF0ZU1hY2hpbmVBcm4gfSk7XHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ2ZuVGVtcGxhdGVVcmwnLCB7XHJcbiAgICAgIHZhbHVlOiB0ZW1wbGF0ZUJ1Y2tldC51cmxGb3JPYmplY3QoJ3RlbXBsYXRlLnlhbWwnKSxcclxuICAgICAgZGVzY3JpcHRpb246ICdVUkwgZG8gdGVtcGxhdGUgZG8gQ2xvdWRGb3JtYXRpb24gcGFyYSBvIG9uYm9hcmRpbmcgZG8gY2xpZW50ZS4gVXNlIGVzdGEgVVJMIG5vIGZyb250ZW5kLicsXHJcbiAgICB9KTtcclxuICB9XHJcbn0iXX0=