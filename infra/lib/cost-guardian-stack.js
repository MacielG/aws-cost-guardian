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
            blockPublicAccess: new s3.BlockPublicAccess({
                blockPublicAcls: true,
                ignorePublicAcls: true,
                blockPublicPolicy: false,
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
            value: `${templateBucket.bucketWebsiteUrl}/template.yaml`,
            description: 'URL do template do CloudFormation para o onboarding do cliente. Use esta URL no frontend.',
        });
    }
}
exports.CostGuardianStack = CostGuardianStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29zdC1ndWFyZGlhbi1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNvc3QtZ3VhcmRpYW4tc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLG1DQUFtQzs7O0FBRW5DLG1DQUFtQztBQUVuQyxpREFBaUQ7QUFDakQsb0RBQW9EO0FBQ3BELHFEQUFxRDtBQUNyRCxtREFBbUQ7QUFDbkQseUNBQXlDO0FBQ3pDLDBEQUEwRDtBQUMxRCxpREFBaUQ7QUFDakQsMERBQTBEO0FBQzFELCtEQUErRDtBQUMvRCxpRUFBaUU7QUFDakUsaUVBQWlFO0FBQ2pFLDJDQUEyQztBQUUzQyxNQUFhLGlCQUFrQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzlDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsb0JBQW9CO1FBQ3BCLE1BQU0sWUFBWSxHQUFHLElBQUksY0FBYyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ25FLG9CQUFvQixFQUFFLEVBQUUsb0JBQW9CLEVBQUUsWUFBWSxFQUFFLGlCQUFpQixFQUFFLEtBQUssRUFBRTtTQUN2RixDQUFDLENBQUM7UUFFSCxvRUFBb0U7UUFDcEUsTUFBTSxLQUFLLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRTtZQUMxRCxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtZQUNqRSxPQUFPLEVBQUUsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtZQUM1RCxXQUFXLEVBQUUsUUFBUSxDQUFDLFdBQVcsQ0FBQyxlQUFlO1lBQ2pELGFBQWEsRUFBRSxHQUFHLENB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LEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUVwRyxvQkFBb0I7UUFDcEIsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxRQUFRLEVBQUUsRUFBRSxLQUFLLEVBQUUsR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUM7UUFDdEQsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7UUFDdEUsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRSxFQUFFLEtBQUssRUFBRSxjQUFjLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxDQUFDO1FBQ3hGLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsV0FBVyxFQUFFLEVBQUUsS0FBSyxFQUFFLEtBQUssQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDO1FBQ2pFLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLEVBQUUsS0FBSyxFQUFFLEdBQUcsQ0FBQyxlQUFlLEVBQUUsQ0FBQyxDQUFDO1FBQ2xFLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7WUFDeEMsS0FBSyxFQUFFLEdBQUcsY0FBYyxDQUFDLGdCQUFnQixnQkFBZ0I7WUFDekQsV0FBVyxFQUFFLDJGQUEyRjtTQUN6RyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF4VEQsOENBd1RDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gaW5mcmEvbGliL2Nvc3QtZ3VhcmRpYW4tc3RhY2sudHNcclxuXHJcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XHJcbmltcG9ydCAqIGFzIGFwaWd3IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5JztcclxuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcclxuaW1wb3J0ICogYXMgY29nbml0byBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29nbml0byc7XHJcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XHJcbmltcG9ydCAqIGFzIHMzZGVwbG95IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMy1kZXBsb3ltZW50JztcclxuaW1wb3J0ICogYXMgZXZlbnRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMnO1xyXG5pbXBvcnQgKiBhcyB0YXJnZXRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMtdGFyZ2V0cyc7XHJcbmltcG9ydCAqIGFzIHN0ZXBmdW5jdGlvbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXN0ZXBmdW5jdGlvbnMnO1xyXG5pbXBvcnQgKiBhcyBzZm5fdGFza3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLXN0ZXBmdW5jdGlvbnMtdGFza3MnO1xyXG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInO1xyXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XHJcblxyXG5leHBvcnQgY2xhc3MgQ29zdEd1YXJkaWFuU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcclxuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xyXG5cclxuICAgIC8vIFNlY3JldHMgKE1hbnRpZG8pXHJcbiAgICBjb25zdCBzdHJpcGVTZWNyZXQgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdTdHJpcGVTZWNyZXQnLCB7XHJcbiAgICAgIGdlbmVyYXRlU2VjcmV0U3RyaW5nOiB7IHNlY3JldFN0cmluZ1RlbXBsYXRlOiAne1wia2V5XCI6XCJcIn0nLCBnZW5lcmF0ZVN0cmluZ0tleTogJ2tleScgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIER5bmFtb0RCIChNYW50aWRvLCBtYXMgYWRpY2lvbmFuZG8gc3RyZWFtIHBhcmEgZWZpY2nDqm5jaWEgZnV0dXJhKVxyXG4gICAgY29uc3QgdGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ0Nvc3RHdWFyZGlhblRhYmxlJywge1xyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgLy8gQ2hhdmUgcHJpbcOhcmlhIHBhcmEgdXN1w6FyaW9zLCBjbGFpbXMsIGV0Yy5cclxuICAgICAgc29ydEtleTogeyBuYW1lOiAnc2snLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LCAvLyBDaGF2ZSBkZSBjbGFzc2lmaWNhw6fDo28gcGFyYSBtb2RlbGFnZW0gZmxleMOtdmVsXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICAgIHN0cmVhbTogZHluYW1vZGIuU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTLCAvLyBIYWJpbGl0YXIgc3RyZWFtXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHU0kgcGFyYSBtYXBlYXIgQVdTIEFjY291bnQgSUQgcGFyYSBub3NzbyBDdXN0b21lciBJRCAoQ1LDjVRJQ08gcGFyYSBjb3JyZWxhw6fDo28pXHJcbiAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0F3c0FjY291bnRJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnYXdzQWNjb3VudElkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLklOQ0xVREUsXHJcbiAgICAgIG5vbktleUF0dHJpYnV0ZXM6IFsnaWQnXSwgLy8gUHJvamV0YXIgbyAnaWQnIChub3NzbyBDdXN0b21lciBJRClcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdTSSBwYXJhIG8gY2FsbGJhY2sgZG8gb25ib2FyZGluZyB2aWEgRXh0ZXJuYWxJZFxyXG4gICAgdGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdFeHRlcm5hbElkSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2V4dGVybmFsSWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuSU5DTFVERSxcclxuICAgICAgbm9uS2V5QXR0cmlidXRlczogWydpZCcsICdzdGF0dXMnXSxcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBHU0kgcGFyYSBjb25zdWx0YXIgcG9yIGNsaWVudGUgKGV4OiBpbmNpZGVudGVzLCBjbGFpbXMpXHJcbiAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0N1c3RvbWVyRGF0YUluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3NrJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdTSSBwYXJhIGNvbnN1bHRhcyBkZSBBZG1pbiAodXNhciBlbnRpdHkvcGFydGl0aW9uIHNoYXJkaW5nIHBhcmEgcGVyZm9ybWFuY2UpXHJcbiAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0FkbWluVmlld0luZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdlbnRpdHlUeXBlJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAnY3JlYXRlZEF0JywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLklOQ0xVREUsXHJcbiAgICAgIG5vbktleUF0dHJpYnV0ZXM6IFsnc3RhdHVzJywgJ2NyZWRpdEFtb3VudCcsICdyZXBvcnRVcmwnLCAnaW5jaWRlbnRJZCcsICdhd3NBY2NvdW50SWQnLCAnc3RyaXBlSW52b2ljZUlkJywgJ2Nhc2VJZCcsICdzdWJtaXNzaW9uRXJyb3InLCAncmVwb3J0RXJyb3InLCAnY29tbWlzc2lvbkFtb3VudCddLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gUzMgQnVja2V0IHBhcmEgaG9zcGVkYXIgbyB0ZW1wbGF0ZSBkbyBDbG91ZEZvcm1hdGlvblxyXG4gICAgY29uc3QgdGVtcGxhdGVCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdDZm5UZW1wbGF0ZUJ1Y2tldCcsIHtcclxuICAgICAgcHVibGljUmVhZEFjY2VzczogdHJ1ZSxcclxuICAgICAgd2Vic2l0ZUluZGV4RG9jdW1lbnQ6ICd0ZW1wbGF0ZS55YW1sJyxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgICAgYXV0b0RlbGV0ZU9iamVjdHM6IHRydWUsXHJcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBuZXcgczMuQmxvY2tQdWJsaWNBY2Nlc3Moe1xyXG4gICAgICAgIGJsb2NrUHVibGljQWNsczogdHJ1ZSxcclxuICAgICAgICBpZ25vcmVQdWJsaWNBY2xzOiB0cnVlLFxyXG4gICAgICAgIGJsb2NrUHVibGljUG9saWN5OiBmYWxzZSwgLy8gUGVybWl0ZSBwb2zDrXRpY2FzIHDDumJsaWNhc1xyXG4gICAgICAgIHJlc3RyaWN0UHVibGljQnVja2V0czogZmFsc2UsXHJcbiAgICAgIH0pLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gSW1wbGFudGHDp8OjbyBkbyB0ZW1wbGF0ZSBkbyBDbG91ZEZvcm1hdGlvbiBubyBidWNrZXQgUzNcclxuICAgIG5ldyBzM2RlcGxveS5CdWNrZXREZXBsb3ltZW50KHRoaXMsICdEZXBsb3lDZm5UZW1wbGF0ZScsIHtcclxuICAgICAgc291cmNlczogW3MzZGVwbG95LlNvdXJjZS5hc3NldCgnLi4vZG9jcycpXSxcclxuICAgICAgZGVzdGluYXRpb25CdWNrZXQ6IHRlbXBsYXRlQnVja2V0LFxyXG4gICAgICBkZXN0aW5hdGlvbktleVByZWZpeDogJycsXHJcbiAgICB9KTtcclxuXHJcblxyXG4gICAgLy8gQ29nbml0byAoTWFudGlkbylcclxuICAgIGNvbnN0IHVzZXJQb29sID0gbmV3IGNvZ25pdG8uVXNlclBvb2wodGhpcywgJ0Nvc3RHdWFyZGlhblBvb2wnLCB7XHJcbiAgICAgIHNlbGZTaWduVXBFbmFibGVkOiB0cnVlLFxyXG4gICAgICBzaWduSW5BbGlhc2VzOiB7IGVtYWlsOiB0cnVlIH0sXHJcbiAgICAgIGF1dG9WZXJpZnk6IHsgZW1haWw6IHRydWUgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENsaWVudGUgZG8gVXNlciBQb29sIHBhcmEgYSBhcGxpY2HDp8OjbyB3ZWJcclxuICAgIGNvbnN0IHVzZXJQb29sQ2xpZW50ID0gbmV3IGNvZ25pdG8uVXNlclBvb2xDbGllbnQodGhpcywgJ0Nvc3RHdWFyZGlhblVzZXJQb29sQ2xpZW50Jywge1xyXG4gICAgICB1c2VyUG9vbCxcclxuICAgICAgZ2VuZXJhdGVTZWNyZXQ6IGZhbHNlLCBcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdydXBvIGRlIGFkbWluaXN0cmFkb3JlcyBubyBDb2duaXRvXHJcbiAgICBuZXcgY29nbml0by5DZm5Vc2VyUG9vbEdyb3VwKHRoaXMsICdBZG1pbkdyb3VwJywge1xyXG4gICAgICB1c2VyUG9vbElkOiB1c2VyUG9vbC51c2VyUG9vbElkLFxyXG4gICAgICBncm91cE5hbWU6ICdBZG1pbnMnLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0dydXBvIHBhcmEgYWRtaW5pc3RyYWRvcmVzIGRhIHBsYXRhZm9ybWEnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gMS4gTGFtYmRhIHBhcmEgbyBBUEkgR2F0ZXdheSAoTW9ub2xpdG8gRXhwcmVzcylcclxuICAgIGNvbnN0IGFwaUhhbmRsZXJMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdBcGlIYW5kbGVyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2hhbmRsZXIuYXBwJywgXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnLi4vYmFja2VuZCcpLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgU1RSSVBFX1NFQ1JFVF9BUk46IHN0cmlwZVNlY3JldC5zZWNyZXRBcm4sXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuICAgIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShhcGlIYW5kbGVyTGFtYmRhKTtcclxuICAgIHN0cmlwZVNlY3JldC5ncmFudFJlYWQoYXBpSGFuZGxlckxhbWJkYSk7XHJcblxyXG4gICAgLy8gMi4gTGFtYmRhIHBhcmEgbyBFdmVudEJyaWRnZSAoQ29ycmVsYWNpb25hciBFdmVudG9zIEhlYWx0aClcclxuICAgIGNvbnN0IGhlYWx0aEV2ZW50SGFuZGxlckxhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0hlYWx0aEV2ZW50SGFuZGxlcicsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdmdW5jdGlvbnMvY29ycmVsYXRlLWhlYWx0aC5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi9iYWNrZW5kJyksIFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgU0ZOX0FSTjogJycsIC8vIFNlcsOhIHByZWVuY2hpZG8gYWJhaXhvXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuICAgIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShoZWFsdGhFdmVudEhhbmRsZXJMYW1iZGEpO1xyXG5cclxuICAgIC8vIDMuIExhbWJkYXMgcGFyYSBhcyBUYXJlZmFzIGRvIFN0ZXAgRnVuY3Rpb25zXHJcbiAgICBjb25zdCBzbGFDYWxjdWxhdGVJbXBhY3RMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdTbGFDYWxjdWxhdGVJbXBhY3QnLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnZnVuY3Rpb25zL3NsYS13b3JrZmxvdy5jYWxjdWxhdGVJbXBhY3QnLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uL2JhY2tlbmQnKSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lLFxyXG4gICAgICB9LFxyXG4gICAgICByb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ1NsYUNhbGNSb2xlJywge1xyXG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxyXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xyXG4gICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJylcclxuICAgICAgICBdLFxyXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XHJcbiAgICAgICAgICBBc3N1bWVDdXN0b21lclJvbGVQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xyXG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgIGFjdGlvbnM6IFsnc3RzOkFzc3VtZVJvbGUnXSxcclxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnYXJuOmF3czppYW06Oio6cm9sZS9Db3N0R3VhcmRpYW5EZWxlZ2F0ZWRSb2xlJ10sIFxyXG4gICAgICAgICAgICB9KV1cclxuICAgICAgICAgIH0pXHJcbiAgICAgICAgfVxyXG4gICAgICB9KVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIGNvbnN0IHNsYUNoZWNrTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnU2xhQ2hlY2snLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnZnVuY3Rpb25zL3NsYS13b3JrZmxvdy5jaGVja1NMQScsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnLi4vYmFja2VuZCcpLFxyXG4gICAgICBlbnZpcm9ubWVudDogeyBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBzbGFHZW5lcmF0ZVJlcG9ydExhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1NsYUdlbmVyYXRlUmVwb3J0Jywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2Z1bmN0aW9ucy9zbGEtd29ya2Zsb3cuZ2VuZXJhdGVSZXBvcnQnLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uL2JhY2tlbmQnKSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFNUUklQRV9TRUNSRVRfQVJOOiBzdHJpcGVTZWNyZXQuc2VjcmV0QXJuLFxyXG4gICAgICAgIFJFUE9SVFNfQlVDS0VUX05BTUU6ICcnLCAvLyBTZXLDoSBwcmVlbmNoaWRvIGFiYWl4b1xyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgICB0YWJsZS5ncmFudFJlYWRXcml0ZURhdGEoc2xhR2VuZXJhdGVSZXBvcnRMYW1iZGEpO1xyXG4gICAgc3RyaXBlU2VjcmV0LmdyYW50UmVhZChzbGFHZW5lcmF0ZVJlcG9ydExhbWJkYSk7XHJcblxyXG4gICAgLy8gQ3JpYXIgYnVja2V0IFMzIHBhcmEgYXJtYXplbmFyIHJlbGF0w7NyaW9zIFBERiBnZXJhZG9zIHBlbGEgTGFtYmRhXHJcbiAgICBjb25zdCByZXBvcnRzQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnUmVwb3J0c0J1Y2tldCcsIHtcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgICAgYXV0b0RlbGV0ZU9iamVjdHM6IHRydWUsXHJcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBGb3JuZWNlciBvIG5vbWUgZG8gYnVja2V0IGNvbW8gdmFyacOhdmVsIGRlIGFtYmllbnRlIHBhcmEgYSBMYW1iZGEgKGF0dWFsaXphKVxyXG4gICAgc2xhR2VuZXJhdGVSZXBvcnRMYW1iZGEuYWRkRW52aXJvbm1lbnQoJ1JFUE9SVFNfQlVDS0VUX05BTUUnLCByZXBvcnRzQnVja2V0LmJ1Y2tldE5hbWUpO1xyXG5cclxuICAgIC8vIFBlcm1pc3PDtWVzIG5lY2Vzc8OhcmlhcyBwYXJhIGEgTGFtYmRhIGVzY3JldmVyIG9iamV0b3Mgbm8gYnVja2V0XHJcbiAgICByZXBvcnRzQnVja2V0LmdyYW50UHV0KHNsYUdlbmVyYXRlUmVwb3J0TGFtYmRhKTtcclxuXHJcbiAgICBjb25zdCBzbGFTdWJtaXRUaWNrZXRMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdTbGFTdWJtaXRUaWNrZXQnLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnZnVuY3Rpb25zL3NsYS13b3JrZmxvdy5zdWJtaXRTdXBwb3J0VGlja2V0JyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi9iYWNrZW5kJyksXHJcbiAgICAgIGVudmlyb25tZW50OiB7IERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUgfSxcclxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdTbGFTdWJtaXRSb2xlJywge1xyXG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxyXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xyXG4gICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJylcclxuICAgICAgICBdLFxyXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XHJcbiAgICAgICAgICBBc3N1bWVDdXN0b21lclJvbGVQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xyXG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgIGFjdGlvbnM6IFsnc3RzOkFzc3VtZVJvbGUnXSxcclxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnYXJuOmF3czppYW06Oio6cm9sZS9Db3N0R3VhcmRpYW5EZWxlZ2F0ZWRSb2xlJ10sXHJcbiAgICAgICAgICAgIH0pXVxyXG4gICAgICAgICAgfSlcclxuICAgICAgICB9XHJcbiAgICAgIH0pXHJcbiAgICB9KTtcclxuICAgIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShzbGFTdWJtaXRUaWNrZXRMYW1iZGEpO1xyXG4gICAgXHJcbiAgICAvLyBPYnRlciBvIGV2ZW50IGJ1cyBwYWRyw6NvIGRhIHBsYXRhZm9ybWFcclxuICAgIGNvbnN0IGV2ZW50QnVzID0gZXZlbnRzLkV2ZW50QnVzLmZyb21FdmVudEJ1c05hbWUodGhpcywgJ0RlZmF1bHRCdXMnLCAnZGVmYXVsdCcpO1xyXG5cclxuICAgIC8vIFBvbMOtdGljYSBzZWd1cmEgcGFyYSBvIEV2ZW50IEJ1cyBxdWUgcGVybWl0ZSBhcGVuYXMgZXZlbnRvcyBlc3BlY8OtZmljb3NcclxuICAgIGNvbnN0IGV2ZW50QnVzUG9saWN5ID0gbmV3IGV2ZW50cy5DZm5FdmVudEJ1c1BvbGljeSh0aGlzLCAnRXZlbnRCdXNQb2xpY3knLCB7XHJcbiAgICAgIGV2ZW50QnVzTmFtZTogZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxyXG4gICAgICBzdGF0ZW1lbnRJZDogJ0FsbG93Q2xpZW50SGVhbHRoRXZlbnRzJyxcclxuICAgICAgYWN0aW9uOiAnZXZlbnRzOlB1dEV2ZW50cycsXHJcbiAgICAgIHByaW5jaXBhbDogJyonLCAvLyBOZWNlc3PDoXJpbyBwYXJhIGNyb3NzLWFjY291bnRcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIC0tLSBJTsONQ0lPIERBIENPUlJFw4fDg08gLS0tXHJcbiAgICAvLyBSRU1PVkEgZXN0ZSBibG9jby4gQSBmaWx0cmFnZW0gZGUgJ2V2ZW50czpzb3VyY2UnIMOpIGZlaXRhXHJcbiAgICAvLyBwZWxhICdoZWFsdGhSdWxlJyBhYmFpeG8sIG7Do28gcGVsYSBwb2zDrXRpY2EgZG8gYmFycmFtZW50by5cclxuICAgIC8qXHJcbiAgICBldmVudEJ1c1BvbGljeS5hZGRQcm9wZXJ0eU92ZXJyaWRlKCdDb25kaXRpb24nLCB7XHJcbiAgICAgIFR5cGU6ICdTdHJpbmdFcXVhbHMnLFxyXG4gICAgICBLZXk6ICdldmVudHM6c291cmNlJyxcclxuICAgICAgVmFsdWU6ICdhd3MuaGVhbHRoJyxcclxuICAgIH0pO1xyXG4gICAgKi9cclxuICAgIC8vIC0tLSBGSU0gREEgQ09SUkXDh8ODTyAtLS1cclxuXHJcbiAgICAvLyBFdmVudEJyaWRnZSBIZWFsdGggKEVzdGEgw6kgYSByZWdyYSBkZSBGSUxUUkFHRU0gY29ycmV0YSlcclxuICAgIGNvbnN0IGhlYWx0aFJ1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ0hlYWx0aEV2ZW50UnVsZScsIHtcclxuICAgICAgZXZlbnRQYXR0ZXJuOiB7XHJcbiAgICAgICAgc291cmNlOiBbJ2F3cy5oZWFsdGgnXSwgLy8gQSBmaWx0cmFnZW0gYWNvbnRlY2UgYXF1aVxyXG4gICAgICAgIGRldGFpbFR5cGU6IFsnQVdTIEhlYWx0aCBFdmVudCddLFxyXG4gICAgICB9LFxyXG4gICAgICBldmVudEJ1cyxcclxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKGhlYWx0aEV2ZW50SGFuZGxlckxhbWJkYSldLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gU3RlcCBGdW5jdGlvbnMgU0xBIChVc2FuZG8gb3MgTGFtYmRhcyBjb3JyZXRvcylcclxuICAgIGNvbnN0IGNhbGN1bGF0ZUltcGFjdFRhc2sgPSBuZXcgc2ZuX3Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnQ2FsY3VsYXRlSW1wYWN0JywgeyBsYW1iZGFGdW5jdGlvbjogc2xhQ2FsY3VsYXRlSW1wYWN0TGFtYmRhLCBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyB9KTtcclxuICAgIGNvbnN0IGNoZWNrU2xhVGFzayA9IG5ldyBzZm5fdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdDaGVja1NMQScsIHsgbGFtYmRhRnVuY3Rpb246IHNsYUNoZWNrTGFtYmRhLCBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyB9KTtcclxuICAgIGNvbnN0IGdlbmVyYXRlUmVwb3J0VGFzayA9IG5ldyBzZm5fdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdHZW5lcmF0ZVJlcG9ydCcsIHsgbGFtYmRhRnVuY3Rpb246IHNsYUdlbmVyYXRlUmVwb3J0TGFtYmRhLCBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyB9KTtcclxuICAgIGNvbnN0IHN1Ym1pdFRpY2tldFRhc2sgPSBuZXcgc2ZuX3Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnU3VibWl0VGlja2V0JywgeyBsYW1iZGFGdW5jdGlvbjogc2xhU3VibWl0VGlja2V0TGFtYmRhLCBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyB9KTtcclxuICAgIGNvbnN0IG5vQ2xhaW0gPSBuZXcgc3RlcGZ1bmN0aW9ucy5TdWNjZWVkKHRoaXMsICdOb0NsYWltR2VuZXJhdGVkJyk7XHJcblxyXG4gICAgY29uc3QgY2xhaW1DaG9pY2UgPSBuZXcgc3RlcGZ1bmN0aW9ucy5DaG9pY2UodGhpcywgJ0lzQ2xhaW1HZW5lcmF0ZWQ/JylcclxuICAgICAgLndoZW4oc3RlcGZ1bmN0aW9ucy5Db25kaXRpb24uc3RyaW5nRXF1YWxzKCckLnN0YXR1cycsICdnZW5lcmF0ZWQnKSwgc3VibWl0VGlja2V0VGFzaylcclxuICAgICAgLm90aGVyd2lzZShub0NsYWltKTtcclxuXHJcbiAgICBjb25zdCBzbGFEZWZpbml0aW9uID0gY2FsY3VsYXRlSW1wYWN0VGFza1xyXG4gICAgICAubmV4dChjaGVja1NsYVRhc2spXHJcbiAgICAgIC5uZXh0KGdlbmVyYXRlUmVwb3J0VGFzaylcclxuICAgICAgLm5leHQoY2xhaW1DaG9pY2UpO1xyXG5cclxuICAgIGNvbnN0IHNmbiA9IG5ldyBzdGVwZnVuY3Rpb25zLlN0YXRlTWFjaGluZSh0aGlzLCAnU0xBV29ya2Zsb3cnLCB7XHJcbiAgICAgIGRlZmluaXRpb25Cb2R5OiBzdGVwZnVuY3Rpb25zLkRlZmluaXRpb25Cb2R5LmZyb21DaGFpbmFibGUoc2xhRGVmaW5pdGlvbiksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZGljaW9uYXIgbyBBUk4gZG8gU0ZOIGFvIExhbWJkYSBkZSBjb3JyZWxhw6fDo29cclxuICAgIGhlYWx0aEV2ZW50SGFuZGxlckxhbWJkYS5hZGRFbnZpcm9ubWVudCgnU0ZOX0FSTicsIHNmbi5zdGF0ZU1hY2hpbmVBcm4pO1xyXG4gICAgLy8gUGVybWlzc8OjbyBwYXJhIG8gTGFtYmRhIGluaWNpYXIgYSBTdGF0ZSBNYWNoaW5lXHJcbiAgICBzZm4uZ3JhbnRTdGFydEV4ZWN1dGlvbihoZWFsdGhFdmVudEhhbmRsZXJMYW1iZGEpO1xyXG5cclxuICAgIC8vIEFQSSBHYXRld2F5IChVc2FuZG8gbyAnYXBpSGFuZGxlckxhbWJkYScgY29ycmV0bylcclxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcGlndy5SZXN0QXBpKHRoaXMsICdDb3N0R3VhcmRpYW5BUEknLCB7XHJcbiAgICAgIHJlc3RBcGlOYW1lOiAnQ29zdCBHdWFyZGlhbiBBUEknLFxyXG4gICAgICBkZWZhdWx0Q29yc1ByZWZsaWdodE9wdGlvbnM6IHsgYWxsb3dPcmlnaW5zOiBhcGlndy5Db3JzLkFMTF9PUklHSU5TIH0sXHJcbiAgICB9KTtcclxuICAgIGNvbnN0IGF1dGggPSBuZXcgYXBpZ3cuQ29nbml0b1VzZXJQb29sc0F1dGhvcml6ZXIodGhpcywgJ0NvZ25pdG9BdXRoJywge1xyXG4gICAgICBjb2duaXRvVXNlclBvb2xzOiBbdXNlclBvb2xdLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgYXBpSW50ZWdyYXRpb24gPSBuZXcgYXBpZ3cuTGFtYmRhSW50ZWdyYXRpb24oYXBpSGFuZGxlckxhbWJkYSk7XHJcblxyXG4gICAgLy8gUmVzb3VyY2VzIEFQSSAoQ29ycmlnaWRvKVxyXG4gICAgY29uc3Qgb25ib2FyZCA9IGFwaS5yb290LmFkZFJlc291cmNlKCdvbmJvYXJkJyk7XHJcbiAgICBvbmJvYXJkLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uKTsgLy8gV2ViaG9vaywgc2VtIGF1dGhcclxuICAgIFxyXG4gICAgLy8gTm92byBlbmRwb2ludCBwYXJhIGdlcmFyIGNvbmZpZyBkZSBvbmJvYXJkaW5nXHJcbiAgICBjb25zdCBvbmJvYXJkSW5pdCA9IGFwaS5yb290LmFkZFJlc291cmNlKCdvbmJvYXJkLWluaXQnKTtcclxuICAgIG9uYm9hcmRJbml0LmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcclxuXHJcbiAgICBjb25zdCBpbmNpZGVudHMgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnaW5jaWRlbnRzJyk7XHJcbiAgICBpbmNpZGVudHMuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xyXG4gICAgY29uc3Qgc2xhQ2xhaW1zID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ3NsYS1jbGFpbXMnKTtcclxuICAgIHNsYUNsYWltcy5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gICAgY29uc3QgaW52b2ljZXNBcGkgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnaW52b2ljZXMnKTtcclxuICAgIGludm9pY2VzQXBpLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcclxuXHJcbiAgICBjb25zdCB0ZXJtc0FwaSA9IGFwaS5yb290LmFkZFJlc291cmNlKCdhY2NlcHQtdGVybXMnKTtcclxuICAgIHRlcm1zQXBpLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gICAgLy8gRW5kcG9pbnQgZGUgQWRtaW5cclxuICAgIGNvbnN0IGFkbWluQXBpID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2FkbWluJyk7XHJcbiAgICBjb25zdCBhZG1pbkNsYWltcyA9IGFkbWluQXBpLmFkZFJlc291cmNlKCdjbGFpbXMnKTtcclxuICAgIFxyXG4gICAgLy8gR0VUIC9hcGkvYWRtaW4vY2xhaW1zXHJcbiAgICBhZG1pbkNsYWltcy5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gICAgLy8gU3ViLXJlY3Vyc29zIHBhcmEgb3BlcmHDp8O1ZXMgZW0gY2xhaW1zIGVzcGVjw61maWNhc1xyXG4gICAgY29uc3QgY2xhaW1zQnlDdXN0b21lciA9IGFkbWluQ2xhaW1zLmFkZFJlc291cmNlKCd7Y3VzdG9tZXJJZH0nKTtcclxuICAgIGNvbnN0IHNwZWNpZmljQ2xhaW0gPSBjbGFpbXNCeUN1c3RvbWVyLmFkZFJlc291cmNlKCd7Y2xhaW1JZH0nKTtcclxuICAgIFxyXG4gICAgLy8gUFVUIC9hcGkvYWRtaW4vY2xhaW1zL3tjdXN0b21lcklkfS97Y2xhaW1JZH0vc3RhdHVzXHJcbiAgICBzcGVjaWZpY0NsYWltLmFkZFJlc291cmNlKCdzdGF0dXMnKS5hZGRNZXRob2QoJ1BVVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcbiAgICBcclxuICAgIC8vIFBPU1QgL2FwaS9hZG1pbi9jbGFpbXMve2N1c3RvbWVySWR9L3tjbGFpbUlkfS9jcmVhdGUtaW52b2ljZVxyXG4gICAgc3BlY2lmaWNDbGFpbS5hZGRSZXNvdXJjZSgnY3JlYXRlLWludm9pY2UnKS5hZGRNZXRob2QoJ1BPU1QnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xyXG5cclxuICAgIC8vIE91dHB1dHMgKE1hbnRpZG8pXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQVBJVXJsJywgeyB2YWx1ZTogYXBpLnVybCB9KTtcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyUG9vbElkJywgeyB2YWx1ZTogdXNlclBvb2wudXNlclBvb2xJZCB9KTtcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyUG9vbENsaWVudElkJywgeyB2YWx1ZTogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCB9KTtcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdUYWJsZU5hbWUnLCB7IHZhbHVlOiB0YWJsZS50YWJsZU5hbWUgfSk7XHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU0ZOQXJuJywgeyB2YWx1ZTogc2ZuLnN0YXRlTWFjaGluZUFybiB9KTtcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDZm5UZW1wbGF0ZVVybCcsIHtcclxuICAgICAgdmFsdWU6IGAke3RlbXBsYXRlQnVja2V0LmJ1Y2tldFdlYnNpdGVVcmx9L3RlbXBsYXRlLnlhbWxgLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1VSTCBkbyB0ZW1wbGF0ZSBkbyBDbG91ZEZvcm1hdGlvbiBwYXJhIG8gb25ib2FyZGluZyBkbyBjbGllbnRlLiBVc2UgZXN0YSBVUkwgbm8gZnJvbnRlbmQuJyxcclxuICAgIH0pO1xyXG4gIH1cclxufSJdfQ==