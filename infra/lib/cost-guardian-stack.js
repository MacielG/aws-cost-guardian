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
const targets = require("aws-cdk-lib/aws-events-targets"); // Corrigido o import
const stepfunctions = require("aws-cdk-lib/aws-stepfunctions");
const sfn_tasks = require("aws-cdk-lib/aws-stepfunctions-tasks");
const secretsmanager = require("aws-cdk-lib/aws-secretsmanager");
const iam = require("aws-cdk-lib/aws-iam"); // Importar IAM
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
            // ATENÇÃO: publicReadAccess é deprecated. Em produção, considere usar
            // blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS e uma BucketPolicy
            // mais granular para s3:GetObject. Para este caso de uso específico
            // de template público, publicReadAccess: true é funcional.
            publicReadAccess: true,
            websiteIndexDocument: 'template.yaml',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true, // Para fácil limpeza em ambientes de desenvolvimento
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
            handler: 'handler.app',
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
            handler: 'functions/correlate-health.handler',
            code: lambda.Code.fromAsset('../backend'),
            environment: {
                DYNAMODB_TABLE: table.tableName,
                SFN_ARN: '', // Será preenchido abaixo
            },
        });
        table.grantReadWriteData(healthEventHandlerLambda); // Precisa ler o GSI e escrever incidentes
        // 3. Lambdas para as Tarefas do Step Functions
        const slaCalculateImpactLambda = new lambda.Function(this, 'SlaCalculateImpact', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'functions/sla-workflow.calculateImpact',
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
                STRIPE_SECRET_ARN: stripeSecret.secretArn,
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
        // Política segura para o Event Bus que permite apenas eventos específicos
        const eventBusPolicy = new events.CfnEventBusPolicy(this, 'EventBusPolicy', {
            eventBusName: eventBus.eventBusName,
            statementId: 'AllowClientHealthEvents',
            action: 'events:PutEvents',
            principal: '*', // Necessário para cross-account
        });
        // --- INÍCIO DA CORREÇÃO ---
        // Injetar a condição como JSON bruto no template CloudFormation.
        // A estrutura 'Condition' do CfnEventBusPolicy (L1) é diferente
        // da estrutura de Condição de uma política IAM e espera Type/Key/Value.
        eventBusPolicy.addPropertyOverride('Condition', {
            Type: 'StringEquals',
            Key: 'events:source',
            Value: 'aws.health',
        });
        // --- FIM DA CORREÇÃO ---
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29zdC1ndWFyZGlhbi1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNvc3QtZ3VhcmRpYW4tc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLG1DQUFtQzs7O0FBRW5DLG1DQUFtQztBQUVuQyxpREFBaUQ7QUFDakQsb0RBQW9EO0FBQ3BELHFEQUFxRDtBQUNyRCxtREFBbUQ7QUFDbkQseUNBQXlDO0FBQ3pDLDBEQUEwRDtBQUMxRCxpREFBaUQ7QUFDakQsMERBQTBELENBQUMscUJBQXFCO0FBQ2hGLCtEQUErRDtBQUMvRCxpRUFBaUU7QUFDakUsaUVBQWlFO0FBQ2pFLDJDQUEyQyxDQUFDLGVBQWU7QUFFM0QsTUFBYSxpQkFBa0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUM5QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLG9CQUFvQjtRQUNwQixNQUFNLFlBQVksR0FBRyxJQUFJLGNBQWMsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUNuRSxvQkFBb0IsRUFBRSxFQUFFLG9CQUFvQixFQUFFLFlBQVksRUFBRSxpQkFBaUIsRUFBRSxLQUFLLEVBQUU7U0FDdkYsQ0FBQyxDQUFDO1FBRUgsb0VBQW9FO1FBQ3BFLE1BQU0sS0FBSyxHQUFHLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsbUJBQW1CLEVBQUU7WUFDMUQsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUU7WUFDakUsT0FBTyxFQUFFLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUU7WUFDNUQsV0FBVyxFQUFFLFFBQVEsQ0FBQyxXQUFXLENBQUMsZUFBZTtZ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QWMsRUFBRSxFQUFFLFVBQVUsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBRTNGLCtEQUErRDtRQUMvRCxhQUFhLENBQUMsV0FBVyxDQUFDLGdCQUFnQixDQUFDLENBQUMsU0FBUyxDQUFDLE1BQU0sRUFBRSxjQUFjLEVBQUUsRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUVwRyxvQkFBb0I7UUFDcEIsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxRQUFRLEVBQUUsRUFBRSxLQUFLLEVBQUUsR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUM7UUFDdEQsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7UUFDdEUsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRSxFQUFFLEtBQUssRUFBRSxjQUFjLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxDQUFDO1FBQ3hGLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsV0FBVyxFQUFFLEVBQUUsS0FBSyxFQUFFLEtBQUssQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDO1FBQ2pFLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLEVBQUUsS0FBSyxFQUFFLEdBQUcsQ0FBQyxlQUFlLEVBQUUsQ0FBQyxDQUFDO1FBQ2xFLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7WUFDeEMsS0FBSyxFQUFFLGNBQWMsQ0FBQyxZQUFZLENBQUMsZUFBZSxDQUFDO1lBQ25ELFdBQVcsRUFBRSwyRkFBMkY7U0FDekcsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBMVRELDhDQTBUQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIGluZnJhL2xpYi9jb3N0LWd1YXJkaWFuLXN0YWNrLnRzXHJcblxyXG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xyXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcclxuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgKiBhcyBhcGlndyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSc7XHJcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYic7XHJcbmltcG9ydCAqIGFzIGNvZ25pdG8gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZ25pdG8nO1xyXG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xyXG5pbXBvcnQgKiBhcyBzM2RlcGxveSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMtZGVwbG95bWVudCc7XHJcbmltcG9ydCAqIGFzIGV2ZW50cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzJztcclxuaW1wb3J0ICogYXMgdGFyZ2V0cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzLXRhcmdldHMnOyAvLyBDb3JyaWdpZG8gbyBpbXBvcnRcclxuaW1wb3J0ICogYXMgc3RlcGZ1bmN0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucyc7XHJcbmltcG9ydCAqIGFzIHNmbl90YXNrcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucy10YXNrcyc7XHJcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJzsgLy8gSW1wb3J0YXIgSUFNXHJcblxyXG5leHBvcnQgY2xhc3MgQ29zdEd1YXJkaWFuU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcclxuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xyXG5cclxuICAgIC8vIFNlY3JldHMgKE1hbnRpZG8pXHJcbiAgICBjb25zdCBzdHJpcGVTZWNyZXQgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdTdHJpcGVTZWNyZXQnLCB7XHJcbiAgICAgIGdlbmVyYXRlU2VjcmV0U3RyaW5nOiB7IHNlY3JldFN0cmluZ1RlbXBsYXRlOiAne1wia2V5XCI6XCJcIn0nLCBnZW5lcmF0ZVN0cmluZ0tleTogJ2tleScgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIER5bmFtb0RCIChNYW50aWRvLCBtYXMgYWRpY2lvbmFuZG8gc3RyZWFtIHBhcmEgZWZpY2nDqm5jaWEgZnV0dXJhKVxyXG4gICAgY29uc3QgdGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ0Nvc3RHdWFyZGlhblRhYmxlJywge1xyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgLy8gQ2hhdmUgcHJpbcOhcmlhIHBhcmEgdXN1w6FyaW9zLCBjbGFpbXMsIGV0Yy5cclxuICAgICAgc29ydEtleTogeyBuYW1lOiAnc2snLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LCAvLyBDaGF2ZSBkZSBjbGFzc2lmaWNhw6fDo28gcGFyYSBtb2RlbGFnZW0gZmxleMOtdmVsXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICAgIHN0cmVhbTogZHluYW1vZGIuU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTLCAvLyBIYWJpbGl0YXIgc3RyZWFtXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHU0kgcGFyYSBtYXBlYXIgQVdTIEFjY291bnQgSUQgcGFyYSBub3NzbyBDdXN0b21lciBJRCAoQ1LDjVRJQ08gcGFyYSBjb3JyZWxhw6fDo28pXHJcbiAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0F3c0FjY291bnRJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnYXdzQWNjb3VudElkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLklOQ0xVREUsXHJcbiAgICAgIG5vbktleUF0dHJpYnV0ZXM6IFsnaWQnXSwgLy8gUHJvamV0YXIgbyAnaWQnIChub3NzbyBDdXN0b21lciBJRClcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdTSSBwYXJhIG8gY2FsbGJhY2sgZG8gb25ib2FyZGluZyB2aWEgRXh0ZXJuYWxJZFxyXG4gICAgdGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdFeHRlcm5hbElkSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2V4dGVybmFsSWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuSU5DTFVERSxcclxuICAgICAgbm9uS2V5QXR0cmlidXRlczogWydpZCcsICdzdGF0dXMnXSxcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBHU0kgcGFyYSBjb25zdWx0YXIgcG9yIGNsaWVudGUgKGV4OiBpbmNpZGVudGVzLCBjbGFpbXMpXHJcbiAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0N1c3RvbWVyRGF0YUluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3NrJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdTSSBwYXJhIGNvbnN1bHRhcyBkZSBBZG1pbiAodXNhciBlbnRpdHkvcGFydGl0aW9uIHNoYXJkaW5nIHBhcmEgcGVyZm9ybWFuY2UpXHJcbiAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0FkbWluVmlld0luZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdlbnRpdHlUeXBlJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAnY3JlYXRlZEF0JywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLklOQ0xVREUsXHJcbiAgICAgIG5vbktleUF0dHJpYnV0ZXM6IFsnc3RhdHVzJywgJ2NyZWRpdEFtb3VudCcsICdyZXBvcnRVcmwnLCAnaW5jaWRlbnRJZCcsICdhd3NBY2NvdW50SWQnLCAnc3RyaXBlSW52b2ljZUlkJywgJ2Nhc2VJZCcsICdzdWJtaXNzaW9uRXJyb3InLCAncmVwb3J0RXJyb3InLCAnY29tbWlzc2lvbkFtb3VudCddLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gUzMgQnVja2V0IHBhcmEgaG9zcGVkYXIgbyB0ZW1wbGF0ZSBkbyBDbG91ZEZvcm1hdGlvblxyXG4gICAgY29uc3QgdGVtcGxhdGVCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdDZm5UZW1wbGF0ZUJ1Y2tldCcsIHtcclxuICAgICAgLy8gQVRFTsOHw4NPOiBwdWJsaWNSZWFkQWNjZXNzIMOpIGRlcHJlY2F0ZWQuIEVtIHByb2R1w6fDo28sIGNvbnNpZGVyZSB1c2FyXHJcbiAgICAgIC8vIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BQ0xTIGUgdW1hIEJ1Y2tldFBvbGljeVxyXG4gICAgICAvLyBtYWlzIGdyYW51bGFyIHBhcmEgczM6R2V0T2JqZWN0LiBQYXJhIGVzdGUgY2FzbyBkZSB1c28gZXNwZWPDrWZpY29cclxuICAgICAgLy8gZGUgdGVtcGxhdGUgcMO6YmxpY28sIHB1YmxpY1JlYWRBY2Nlc3M6IHRydWUgw6kgZnVuY2lvbmFsLlxyXG4gICAgICBwdWJsaWNSZWFkQWNjZXNzOiB0cnVlLFxyXG4gICAgICB3ZWJzaXRlSW5kZXhEb2N1bWVudDogJ3RlbXBsYXRlLnlhbWwnLCAvLyBEZWZpbmUgbyBhcnF1aXZvIHBhZHLDo28gcGFyYSBhY2Vzc28gdmlhIHdlYnNpdGUgZW5kcG9pbnRcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSwgLy8gUGFyYSBmw6FjaWwgbGltcGV6YSBlbSBhbWJpZW50ZXMgZGUgZGVzZW52b2x2aW1lbnRvXHJcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiB0cnVlLCAvLyBQYXJhIGbDoWNpbCBsaW1wZXphIGVtIGFtYmllbnRlcyBkZSBkZXNlbnZvbHZpbWVudG9cclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEltcGxhbnRhw6fDo28gZG8gdGVtcGxhdGUgZG8gQ2xvdWRGb3JtYXRpb24gbm8gYnVja2V0IFMzXHJcbiAgICBuZXcgczNkZXBsb3kuQnVja2V0RGVwbG95bWVudCh0aGlzLCAnRGVwbG95Q2ZuVGVtcGxhdGUnLCB7XHJcbiAgICAgIHNvdXJjZXM6IFtzM2RlcGxveS5Tb3VyY2UuYXNzZXQoJy4uL2RvY3MnKV0sXHJcbiAgICAgIGRlc3RpbmF0aW9uQnVja2V0OiB0ZW1wbGF0ZUJ1Y2tldCxcclxuICAgICAgZGVzdGluYXRpb25LZXlQcmVmaXg6ICcnLFxyXG4gICAgfSk7XHJcblxyXG5cclxuICAgIC8vIENvZ25pdG8gKE1hbnRpZG8pXHJcbiAgICBjb25zdCB1c2VyUG9vbCA9IG5ldyBjb2duaXRvLlVzZXJQb29sKHRoaXMsICdDb3N0R3VhcmRpYW5Qb29sJywge1xyXG4gICAgICBzZWxmU2lnblVwRW5hYmxlZDogdHJ1ZSxcclxuICAgICAgc2lnbkluQWxpYXNlczogeyBlbWFpbDogdHJ1ZSB9LFxyXG4gICAgICBhdXRvVmVyaWZ5OiB7IGVtYWlsOiB0cnVlIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDbGllbnRlIGRvIFVzZXIgUG9vbCBwYXJhIGEgYXBsaWNhw6fDo28gd2ViXHJcbiAgICBjb25zdCB1c2VyUG9vbENsaWVudCA9IG5ldyBjb2duaXRvLlVzZXJQb29sQ2xpZW50KHRoaXMsICdDb3N0R3VhcmRpYW5Vc2VyUG9vbENsaWVudCcsIHtcclxuICAgICAgdXNlclBvb2wsXHJcbiAgICAgIGdlbmVyYXRlU2VjcmV0OiBmYWxzZSwgLy8gQXBsaWNhw6fDtWVzIHdlYiBkZSBjbGllbnRlIG7Do28gZGV2ZW0gdGVyIHNlZ3JlZG9zXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHcnVwbyBkZSBhZG1pbmlzdHJhZG9yZXMgbm8gQ29nbml0b1xyXG4gICAgbmV3IGNvZ25pdG8uQ2ZuVXNlclBvb2xHcm91cCh0aGlzLCAnQWRtaW5Hcm91cCcsIHtcclxuICAgICAgdXNlclBvb2xJZDogdXNlclBvb2wudXNlclBvb2xJZCxcclxuICAgICAgZ3JvdXBOYW1lOiAnQWRtaW5zJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdHcnVwbyBwYXJhIGFkbWluaXN0cmFkb3JlcyBkYSBwbGF0YWZvcm1hJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vICoqKiBJTsONQ0lPIERBUyBDT1JSRcOHw5VFUyBERSBMQU1CREEgKioqXHJcblxyXG4gICAgLy8gMS4gTGFtYmRhIHBhcmEgbyBBUEkgR2F0ZXdheSAoTW9ub2xpdG8gRXhwcmVzcylcclxuICAgIGNvbnN0IGFwaUhhbmRsZXJMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdBcGlIYW5kbGVyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2hhbmRsZXIuYXBwJywgLy8gQXBvbnRhIHBhcmEgbyBFeHByZXNzIGFwcFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uL2JhY2tlbmQnKSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFNUUklQRV9TRUNSRVRfQVJOOiBzdHJpcGVTZWNyZXQuc2VjcmV0QXJuLCAvLyBSZW5vbWVhZG8gcGFyYSBjbGFyZXphXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuICAgIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShhcGlIYW5kbGVyTGFtYmRhKTtcclxuICAgIHN0cmlwZVNlY3JldC5ncmFudFJlYWQoYXBpSGFuZGxlckxhbWJkYSk7XHJcblxyXG4gICAgLy8gMi4gTGFtYmRhIHBhcmEgbyBFdmVudEJyaWRnZSAoQ29ycmVsYWNpb25hciBFdmVudG9zIEhlYWx0aClcclxuICAgIGNvbnN0IGhlYWx0aEV2ZW50SGFuZGxlckxhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0hlYWx0aEV2ZW50SGFuZGxlcicsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdmdW5jdGlvbnMvY29ycmVsYXRlLWhlYWx0aC5oYW5kbGVyJywgLy8gSGFuZGxlciBlc3BlY8OtZmljb1xyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uL2JhY2tlbmQnKSwgLy8gTWVzbW8gcGFjb3RlIGRlIGPDs2RpZ29cclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFNGTl9BUk46ICcnLCAvLyBTZXLDoSBwcmVlbmNoaWRvIGFiYWl4b1xyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgICB0YWJsZS5ncmFudFJlYWRXcml0ZURhdGEoaGVhbHRoRXZlbnRIYW5kbGVyTGFtYmRhKTsgLy8gUHJlY2lzYSBsZXIgbyBHU0kgZSBlc2NyZXZlciBpbmNpZGVudGVzXHJcblxyXG4gICAgLy8gMy4gTGFtYmRhcyBwYXJhIGFzIFRhcmVmYXMgZG8gU3RlcCBGdW5jdGlvbnNcclxuICAgIGNvbnN0IHNsYUNhbGN1bGF0ZUltcGFjdExhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1NsYUNhbGN1bGF0ZUltcGFjdCcsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdmdW5jdGlvbnMvc2xhLXdvcmtmbG93LmNhbGN1bGF0ZUltcGFjdCcsIC8vIEhhbmRsZXIgZXNwZWPDrWZpY29cclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi9iYWNrZW5kJyksXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgfSxcclxuICAgICAgLy8gUGVybWlzc8OjbyBwYXJhIGNoYW1hciBDb3N0IEV4cGxvcmVyIChBc3N1bWluZG8gYSBSb2xlIGRvIENsaWVudGUpXHJcbiAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnU2xhQ2FsY1JvbGUnLCB7XHJcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXHJcbiAgICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXHJcbiAgICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKVxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcclxuICAgICAgICAgIEFzc3VtZUN1c3RvbWVyUm9sZVBvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XHJcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgYWN0aW9uczogWydzdHM6QXNzdW1lUm9sZSddLFxyXG4gICAgICAgICAgICAgIHJlc291cmNlczogWydhcm46YXdzOmlhbTo6Kjpyb2xlL0Nvc3RHdWFyZGlhbkRlbGVnYXRlZFJvbGUnXSwgLy8gUGVybWl0ZSBhc3N1bWlyIGEgcm9sZSBlbSAqcXVhbHF1ZXIqIGNvbnRhIGNsaWVudGVcclxuICAgICAgICAgICAgfSldXHJcbiAgICAgICAgICB9KVxyXG4gICAgICAgIH1cclxuICAgICAgfSlcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBjb25zdCBzbGFDaGVja0xhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1NsYUNoZWNrJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2Z1bmN0aW9ucy9zbGEtd29ya2Zsb3cuY2hlY2tTTEEnLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uL2JhY2tlbmQnKSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHsgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3Qgc2xhR2VuZXJhdGVSZXBvcnRMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdTbGFHZW5lcmF0ZVJlcG9ydCcsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdmdW5jdGlvbnMvc2xhLXdvcmtmbG93LmdlbmVyYXRlUmVwb3J0JyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi9iYWNrZW5kJyksXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBTVFJJUEVfU0VDUkVUX0FSTjogc3RyaXBlU2VjcmV0LnNlY3JldEFybiwgLy8gUGFzc2EgYSByZWZlcsOqbmNpYSBhbyBzZWNyZXRcclxuICAgICAgICBSRVBPUlRTX0JVQ0tFVF9OQU1FOiAnJywgLy8gU2Vyw6EgcHJlZW5jaGlkbyBhcMOzcyBjcmlhciBvIGJ1Y2tldCBhYmFpeG9cclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHNsYUdlbmVyYXRlUmVwb3J0TGFtYmRhKTtcclxuICAgIHN0cmlwZVNlY3JldC5ncmFudFJlYWQoc2xhR2VuZXJhdGVSZXBvcnRMYW1iZGEpO1xyXG5cclxuICAgIC8vIENyaWFyIGJ1Y2tldCBTMyBwYXJhIGFybWF6ZW5hciByZWxhdMOzcmlvcyBQREYgZ2VyYWRvcyBwZWxhIExhbWJkYVxyXG4gICAgY29uc3QgcmVwb3J0c0J1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ1JlcG9ydHNCdWNrZXQnLCB7XHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiB0cnVlLFxyXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gRm9ybmVjZXIgbyBub21lIGRvIGJ1Y2tldCBjb21vIHZhcmnDoXZlbCBkZSBhbWJpZW50ZSBwYXJhIGEgTGFtYmRhIChhdHVhbGl6YSlcclxuICAgIHNsYUdlbmVyYXRlUmVwb3J0TGFtYmRhLmFkZEVudmlyb25tZW50KCdSRVBPUlRTX0JVQ0tFVF9OQU1FJywgcmVwb3J0c0J1Y2tldC5idWNrZXROYW1lKTtcclxuXHJcbiAgICAvLyBQZXJtaXNzw7VlcyBuZWNlc3PDoXJpYXMgcGFyYSBhIExhbWJkYSBlc2NyZXZlciBvYmpldG9zIG5vIGJ1Y2tldFxyXG4gICAgcmVwb3J0c0J1Y2tldC5ncmFudFB1dChzbGFHZW5lcmF0ZVJlcG9ydExhbWJkYSk7XHJcblxyXG4gICAgY29uc3Qgc2xhU3VibWl0VGlja2V0TGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnU2xhU3VibWl0VGlja2V0Jywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2Z1bmN0aW9ucy9zbGEtd29ya2Zsb3cuc3VibWl0U3VwcG9ydFRpY2tldCcsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnLi4vYmFja2VuZCcpLFxyXG4gICAgICBlbnZpcm9ubWVudDogeyBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lIH0sXHJcbiAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnU2xhU3VibWl0Um9sZScsIHtcclxuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcclxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcclxuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpXHJcbiAgICAgICAgXSxcclxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xyXG4gICAgICAgICAgQXNzdW1lQ3VzdG9tZXJSb2xlUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcclxuICAgICAgICAgICAgc3RhdGVtZW50czogW25ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgICBhY3Rpb25zOiBbJ3N0czpBc3N1bWVSb2xlJ10sXHJcbiAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbJ2Fybjphd3M6aWFtOjoqOnJvbGUvQ29zdEd1YXJkaWFuRGVsZWdhdGVkUm9sZSddLFxyXG4gICAgICAgICAgICB9KV1cclxuICAgICAgICAgIH0pXHJcbiAgICAgICAgfVxyXG4gICAgICB9KVxyXG4gICAgfSk7XHJcbiAgICB0YWJsZS5ncmFudFJlYWRXcml0ZURhdGEoc2xhU3VibWl0VGlja2V0TGFtYmRhKTtcclxuICAgIFxyXG4gICAgLy8gKioqIEZJTSBEQVMgQ09SUkXDh8OVRVMgREUgTEFNQkRBICoqKlxyXG5cclxuICAgIC8vIE9idGVyIG8gZXZlbnQgYnVzIHBhZHLDo28gZGEgcGxhdGFmb3JtYVxyXG4gICAgY29uc3QgZXZlbnRCdXMgPSBldmVudHMuRXZlbnRCdXMuZnJvbUV2ZW50QnVzTmFtZSh0aGlzLCAnRGVmYXVsdEJ1cycsICdkZWZhdWx0Jyk7XHJcblxyXG4gICAgLy8gUG9sw610aWNhIHNlZ3VyYSBwYXJhIG8gRXZlbnQgQnVzIHF1ZSBwZXJtaXRlIGFwZW5hcyBldmVudG9zIGVzcGVjw61maWNvc1xyXG4gICAgY29uc3QgZXZlbnRCdXNQb2xpY3kgPSBuZXcgZXZlbnRzLkNmbkV2ZW50QnVzUG9saWN5KHRoaXMsICdFdmVudEJ1c1BvbGljeScsIHtcclxuICAgICAgZXZlbnRCdXNOYW1lOiBldmVudEJ1cy5ldmVudEJ1c05hbWUsXHJcbiAgICAgIHN0YXRlbWVudElkOiAnQWxsb3dDbGllbnRIZWFsdGhFdmVudHMnLFxyXG4gICAgICBhY3Rpb246ICdldmVudHM6UHV0RXZlbnRzJyxcclxuICAgICAgcHJpbmNpcGFsOiAnKicsIC8vIE5lY2Vzc8OhcmlvIHBhcmEgY3Jvc3MtYWNjb3VudFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gLS0tIElOw41DSU8gREEgQ09SUkXDh8ODTyAtLS1cclxuICAgIC8vIEluamV0YXIgYSBjb25kacOnw6NvIGNvbW8gSlNPTiBicnV0byBubyB0ZW1wbGF0ZSBDbG91ZEZvcm1hdGlvbi5cclxuICAgIC8vIEEgZXN0cnV0dXJhICdDb25kaXRpb24nIGRvIENmbkV2ZW50QnVzUG9saWN5IChMMSkgw6kgZGlmZXJlbnRlXHJcbiAgICAvLyBkYSBlc3RydXR1cmEgZGUgQ29uZGnDp8OjbyBkZSB1bWEgcG9sw610aWNhIElBTSBlIGVzcGVyYSBUeXBlL0tleS9WYWx1ZS5cclxuICAgIGV2ZW50QnVzUG9saWN5LmFkZFByb3BlcnR5T3ZlcnJpZGUoJ0NvbmRpdGlvbicsIHtcclxuICAgICAgVHlwZTogJ1N0cmluZ0VxdWFscycsXHJcbiAgICAgIEtleTogJ2V2ZW50czpzb3VyY2UnLFxyXG4gICAgICBWYWx1ZTogJ2F3cy5oZWFsdGgnLFxyXG4gICAgfSk7XHJcbiAgICAvLyAtLS0gRklNIERBIENPUlJFw4fDg08gLS0tXHJcblxyXG4gICAgLy8gRXZlbnRCcmlkZ2UgSGVhbHRoIChDb3JyaWdpZG8gY29tIHBlcm1pc3Npb25hbWVudG8gc2VndXJvKVxyXG4gICAgY29uc3QgaGVhbHRoUnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnSGVhbHRoRXZlbnRSdWxlJywge1xyXG4gICAgICBldmVudFBhdHRlcm46IHtcclxuICAgICAgICBzb3VyY2U6IFsnYXdzLmhlYWx0aCddLFxyXG4gICAgICAgIGRldGFpbFR5cGU6IFsnQVdTIEhlYWx0aCBFdmVudCddLFxyXG4gICAgICB9LFxyXG4gICAgICBldmVudEJ1cyxcclxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKGhlYWx0aEV2ZW50SGFuZGxlckxhbWJkYSldLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gU3RlcCBGdW5jdGlvbnMgU0xBIChVc2FuZG8gb3MgTGFtYmRhcyBjb3JyZXRvcylcclxuICAgIGNvbnN0IGNhbGN1bGF0ZUltcGFjdFRhc2sgPSBuZXcgc2ZuX3Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnQ2FsY3VsYXRlSW1wYWN0JywgeyBsYW1iZGFGdW5jdGlvbjogc2xhQ2FsY3VsYXRlSW1wYWN0TGFtYmRhLCBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyB9KTtcclxuICAgIGNvbnN0IGNoZWNrU2xhVGFzayA9IG5ldyBzZm5fdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdDaGVja1NMQScsIHsgbGFtYmRhRnVuY3Rpb246IHNsYUNoZWNrTGFtYmRhLCBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyB9KTtcclxuICAgIGNvbnN0IGdlbmVyYXRlUmVwb3J0VGFzayA9IG5ldyBzZm5fdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdHZW5lcmF0ZVJlcG9ydCcsIHsgbGFtYmRhRnVuY3Rpb246IHNsYUdlbmVyYXRlUmVwb3J0TGFtYmRhLCBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyB9KTtcclxuICAgIGNvbnN0IHN1Ym1pdFRpY2tldFRhc2sgPSBuZXcgc2ZuX3Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnU3VibWl0VGlja2V0JywgeyBsYW1iZGFGdW5jdGlvbjogc2xhU3VibWl0VGlja2V0TGFtYmRhLCBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyB9KTtcclxuICAgIGNvbnN0IG5vQ2xhaW0gPSBuZXcgc3RlcGZ1bmN0aW9ucy5TdWNjZWVkKHRoaXMsICdOb0NsYWltR2VuZXJhdGVkJyk7XHJcblxyXG4gICAgY29uc3QgY2xhaW1DaG9pY2UgPSBuZXcgc3RlcGZ1bmN0aW9ucy5DaG9pY2UodGhpcywgJ0lzQ2xhaW1HZW5lcmF0ZWQ/JylcclxuICAgICAgLndoZW4oc3RlcGZ1bmN0aW9ucy5Db25kaXRpb24uc3RyaW5nRXF1YWxzKCckLnN0YXR1cycsICdnZW5lcmF0ZWQnKSwgc3VibWl0VGlja2V0VGFzaylcclxuICAgICAgLm90aGVyd2lzZShub0NsYWltKTtcclxuXHJcbiAgICBjb25zdCBzbGFEZWZpbml0aW9uID0gY2FsY3VsYXRlSW1wYWN0VGFza1xyXG4gICAgICAubmV4dChjaGVja1NsYVRhc2spXHJcbiAgICAgIC5uZXh0KGdlbmVyYXRlUmVwb3J0VGFzaylcclxuICAgICAgLm5leHQoY2xhaW1DaG9pY2UpO1xyXG5cclxuICAgIGNvbnN0IHNmbiA9IG5ldyBzdGVwZnVuY3Rpb25zLlN0YXRlTWFjaGluZSh0aGlzLCAnU0xBV29ya2Zsb3cnLCB7XHJcbiAgICAgIGRlZmluaXRpb25Cb2R5OiBzdGVwZnVuY3Rpb25zLkRlZmluaXRpb25Cb2R5LmZyb21DaGFpbmFibGUoc2xhRGVmaW5pdGlvbiksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZGljaW9uYXIgbyBBUk4gZG8gU0ZOIGFvIExhbWJkYSBkZSBjb3JyZWxhw6fDo29cclxuICAgIGhlYWx0aEV2ZW50SGFuZGxlckxhbWJkYS5hZGRFbnZpcm9ubWVudCgnU0ZOX0FSTicsIHNmbi5zdGF0ZU1hY2hpbmVBcm4pO1xyXG4gICAgLy8gUGVybWlzc8OjbyBwYXJhIG8gTGFtYmRhIGluaWNpYXIgYSBTdGF0ZSBNYWNoaW5lXHJcbiAgICBzZm4uZ3JhbnRTdGFydEV4ZWN1dGlvbihoZWFsdGhFdmVudEhhbmRsZXJMYW1iZGEpO1xyXG5cclxuICAgIC8vIEFQSSBHYXRld2F5IChVc2FuZG8gbyAnYXBpSGFuZGxlckxhbWJkYScgY29ycmV0bylcclxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcGlndy5SZXN0QXBpKHRoaXMsICdDb3N0R3VhcmRpYW5BUEknLCB7XHJcbiAgICAgIHJlc3RBcGlOYW1lOiAnQ29zdCBHdWFyZGlhbiBBUEknLFxyXG4gICAgICBkZWZhdWx0Q29yc1ByZWZsaWdodE9wdGlvbnM6IHsgYWxsb3dPcmlnaW5zOiBhcGlndy5Db3JzLkFMTF9PUklHSU5TIH0sXHJcbiAgICB9KTtcclxuICAgIGNvbnN0IGF1dGggPSBuZXcgYXBpZ3cuQ29nbml0b1VzZXJQb29sc0F1dGhvcml6ZXIodGhpcywgJ0NvZ25pdG9BdXRoJywge1xyXG4gICAgICBjb2duaXRvVXNlclBvb2xzOiBbdXNlclBvb2xdLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgYXBpSW50ZWdyYXRpb24gPSBuZXcgYXBpZ3cuTGFtYmRhSW50ZWdyYXRpb24oYXBpSGFuZGxlckxhbWJkYSk7XHJcblxyXG4gICAgLy8gUmVzb3VyY2VzIEFQSSAoQ29ycmlnaWRvKVxyXG4gICAgY29uc3Qgb25ib2FyZCA9IGFwaS5yb290LmFkZFJlc291cmNlKCdvbmJvYXJkJyk7XHJcbiAgICBvbmJvYXJkLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uKTsgLy8gV2ViaG9vaywgc2VtIGF1dGhcclxuICAgIFxyXG4gICAgLy8gTm92byBlbmRwb2ludCBwYXJhIGdlcmFyIGNvbmZpZyBkZSBvbmJvYXJkaW5nXHJcbiAgICBjb25zdCBvbmJvYXJkSW5pdCA9IGFwaS5yb290LmFkZFJlc291cmNlKCdvbmJvYXJkLWluaXQnKTtcclxuICAgIG9uYm9hcmRJbml0LmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcclxuXHJcbiAgICBjb25zdCBpbmNpZGVudHMgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnaW5jaWRlbnRzJyk7XHJcbiAgICBpbmNpZGVudHMuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xyXG4gICAgY29uc3Qgc2xhQ2xhaW1zID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ3NsYS1jbGFpbXMnKTtcclxuICAgIHNsYUNsYWltcy5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gICAgY29uc3QgaW52b2ljZXNBcGkgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnaW52b2ljZXMnKTtcclxuICAgIGludm9pY2VzQXBpLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcclxuXHJcbiAgICBjb25zdCB0ZXJtc0FwaSA9IGFwaS5yb290LmFkZFJlc291cmNlKCdhY2NlcHQtdGVybXMnKTtcclxuICAgIHRlcm1zQXBpLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gICAgLy8gRW5kcG9pbnQgZGUgQWRtaW5cclxuICAgIGNvbnN0IGFkbWluQXBpID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2FkbWluJyk7XHJcbiAgICBjb25zdCBhZG1pbkNsYWltcyA9IGFkbWluQXBpLmFkZFJlc291cmNlKCdjbGFpbXMnKTtcclxuICAgIFxyXG4gICAgLy8gR0VUIC9hcGkvYWRtaW4vY2xhaW1zXHJcbiAgICBhZG1pbkNsYWltcy5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gICAgLy8gU3ViLXJlY3Vyc29zIHBhcmEgb3BlcmHDp8O1ZXMgZW0gY2xhaW1zIGVzcGVjw61maWNhc1xyXG4gICAgY29uc3QgY2xhaW1zQnlDdXN0b21lciA9IGFkbWluQ2xhaW1zLmFkZFJlc291cmNlKCd7Y3VzdG9tZXJJZH0nKTtcclxuICAgIGNvbnN0IHNwZWNpZmljQ2xhaW0gPSBjbGFpbXNCeUN1c3RvbWVyLmFkZFJlc291cmNlKCd7Y2xhaW1JZH0nKTtcclxuICAgIFxyXG4gICAgLy8gUFVUIC9hcGkvYWRtaW4vY2xhaW1zL3tjdXN0b21lcklkfS97Y2xhaW1JZH0vc3RhdHVzXHJcbiAgICBzcGVjaWZpY0NsYWltLmFkZFJlc291cmNlKCdzdGF0dXMnKS5hZGRNZXRob2QoJ1BVVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcbiAgICBcclxuICAgIC8vIFBPU1QgL2FwaS9hZG1pbi9jbGFpbXMve2N1c3RvbWVySWR9L3tjbGFpbUlkfS9jcmVhdGUtaW52b2ljZVxyXG4gICAgc3BlY2lmaWNDbGFpbS5hZGRSZXNvdXJjZSgnY3JlYXRlLWludm9pY2UnKS5hZGRNZXRob2QoJ1BPU1QnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xyXG5cclxuICAgIC8vIE91dHB1dHMgKE1hbnRpZG8pXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQVBJVXJsJywgeyB2YWx1ZTogYXBpLnVybCB9KTtcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyUG9vbElkJywgeyB2YWx1ZTogdXNlclBvb2wudXNlclBvb2xJZCB9KTtcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyUG9vbENsaWVudElkJywgeyB2YWx1ZTogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCB9KTtcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdUYWJsZU5hbWUnLCB7IHZhbHVlOiB0YWJsZS50YWJsZU5hbWUgfSk7XHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU0ZOQXJuJywgeyB2YWx1ZTogc2ZuLnN0YXRlTWFjaGluZUFybiB9KTtcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDZm5UZW1wbGF0ZVVybCcsIHtcclxuICAgICAgdmFsdWU6IHRlbXBsYXRlQnVja2V0LnVybEZvck9iamVjdCgndGVtcGxhdGUueWFtbCcpLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1VSTCBkbyB0ZW1wbGF0ZSBkbyBDbG91ZEZvcm1hdGlvbiBwYXJhIG8gb25ib2FyZGluZyBkbyBjbGllbnRlLiBVc2UgZXN0YSBVUkwgbm8gZnJvbnRlbmQuJyxcclxuICAgIH0pO1xyXG4gIH1cclxufSJdfQ==