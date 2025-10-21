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
            principal: '*', // Necess e1rio para cross-account
        });
        // Injetar a condição como JSON bruto no template CloudFormation. Usamos
        // addPropertyOverride para garantir que o formato seja exatamente o
        // necessário pelo CloudFormation: { "StringEquals": { "events:source": "aws.health" } }
        eventBusPolicy.addPropertyOverride('Condition', {
            StringEquals: {
                'events:source': 'aws.health',
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29zdC1ndWFyZGlhbi1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNvc3QtZ3VhcmRpYW4tc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLG1DQUFtQzs7O0FBRW5DLG1DQUFtQztBQUVuQyxpREFBaUQ7QUFDakQsb0RBQW9EO0FBQ3BELHFEQUFxRDtBQUNyRCxtREFBbUQ7QUFDbkQseUNBQXlDO0FBQ3pDLDBEQUEwRDtBQUMxRCxpREFBaUQ7QUFDakQsMERBQTBELENBQUMscUJBQXFCO0FBQ2hGLCtEQUErRDtBQUMvRCxpRUFBaUU7QUFDakUsaUVBQWlFO0FBQ2pFLDJDQUEyQyxDQUFDLGVBQWU7QUFFM0QsTUFBYSxpQkFBa0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUM5QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLG9CQUFvQjtRQUNwQixNQUFNLFlBQVksR0FBRyxJQUFJLGNBQWMsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUNuRSxvQkFBb0IsRUFBRSxFQUFFLG9CQUFvQixFQUFFLFlBQVksRUFBRSxpQkFBaUIsRUFBRSxLQUFLLEVBQUU7U0FDdkYsQ0FBQyxDQUFDO1FBRUgsb0VBQW9FO1FBQ3BFLE1BQU0sS0FBSyxHQUFHLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsbUJBQW1CLEVBQUU7WUFDMUQsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUU7WUFDakUsT0FBTyxFQUFFLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUU7WUFDNUQsV0FBVyxFQUFFLFFBQVEsQ0FBQyxXQUFXLENBQUMsZUFBZTtZ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RiwrREFBK0Q7UUFDL0QsYUFBYSxDQUFDLFdBQVcsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxNQUFNLEVBQUUsY0FBYyxFQUFFLEVBQUUsVUFBVSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7UUFFcEcsb0JBQW9CO1FBQ3BCLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLEVBQUUsS0FBSyxFQUFFLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO1FBQ3RELElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO1FBQ3RFLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUUsRUFBRSxLQUFLLEVBQUUsY0FBYyxDQUFDLGdCQUFnQixFQUFFLENBQUMsQ0FBQztRQUN4RixJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFdBQVcsRUFBRSxFQUFFLEtBQUssRUFBRSxLQUFLLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQztRQUNqRSxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRSxFQUFFLEtBQUssRUFBRSxHQUFHLENBQUMsZUFBZSxFQUFFLENBQUMsQ0FBQztRQUNsRSxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQ3hDLEtBQUssRUFBRSxjQUFjLENBQUMsWUFBWSxDQUFDLGVBQWUsQ0FBQztZQUNuRCxXQUFXLEVBQUUsMkZBQTJGO1NBQ3pHLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQXhURCw4Q0F3VEMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBpbmZyYS9saWIvY29zdC1ndWFyZGlhbi1zdGFjay50c1xyXG5cclxuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcclxuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XHJcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcclxuaW1wb3J0ICogYXMgYXBpZ3cgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xyXG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xyXG5pbXBvcnQgKiBhcyBjb2duaXRvIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2duaXRvJztcclxuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcclxuaW1wb3J0ICogYXMgczNkZXBsb3kgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzLWRlcGxveW1lbnQnO1xyXG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cyc7XHJcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJzsgLy8gQ29ycmlnaWRvIG8gaW1wb3J0XHJcbmltcG9ydCAqIGFzIHN0ZXBmdW5jdGlvbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXN0ZXBmdW5jdGlvbnMnO1xyXG5pbXBvcnQgKiBhcyBzZm5fdGFza3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLXN0ZXBmdW5jdGlvbnMtdGFza3MnO1xyXG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInO1xyXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7IC8vIEltcG9ydGFyIElBTVxyXG5cclxuZXhwb3J0IGNsYXNzIENvc3RHdWFyZGlhblN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcclxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XHJcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcclxuXHJcbiAgICAvLyBTZWNyZXRzIChNYW50aWRvKVxyXG4gICAgY29uc3Qgc3RyaXBlU2VjcmV0ID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldCh0aGlzLCAnU3RyaXBlU2VjcmV0Jywge1xyXG4gICAgICBnZW5lcmF0ZVNlY3JldFN0cmluZzogeyBzZWNyZXRTdHJpbmdUZW1wbGF0ZTogJ3tcImtleVwiOlwiXCJ9JywgZ2VuZXJhdGVTdHJpbmdLZXk6ICdrZXknIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBEeW5hbW9EQiAoTWFudGlkbywgbWFzIGFkaWNpb25hbmRvIHN0cmVhbSBwYXJhIGVmaWNpw6puY2lhIGZ1dHVyYSlcclxuICAgIGNvbnN0IHRhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdDb3N0R3VhcmRpYW5UYWJsZScsIHtcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sIC8vIENoYXZlIHByaW3DoXJpYSBwYXJhIHVzdcOhcmlvcywgY2xhaW1zLCBldGMuXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3NrJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgLy8gQ2hhdmUgZGUgY2xhc3NpZmljYcOnw6NvIHBhcmEgbW9kZWxhZ2VtIGZsZXjDrXZlbFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgICBzdHJlYW06IGR5bmFtb2RiLlN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFUywgLy8gSGFiaWxpdGFyIHN0cmVhbVxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR1NJIHBhcmEgbWFwZWFyIEFXUyBBY2NvdW50IElEIHBhcmEgbm9zc28gQ3VzdG9tZXIgSUQgKENSw41USUNPIHBhcmEgY29ycmVsYcOnw6NvKVxyXG4gICAgdGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdBd3NBY2NvdW50SW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2F3c0FjY291bnRJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5JTkNMVURFLFxyXG4gICAgICBub25LZXlBdHRyaWJ1dGVzOiBbJ2lkJ10sIC8vIFByb2pldGFyIG8gJ2lkJyAobm9zc28gQ3VzdG9tZXIgSUQpXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHU0kgcGFyYSBvIGNhbGxiYWNrIGRvIG9uYm9hcmRpbmcgdmlhIEV4dGVybmFsSWRcclxuICAgIHRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnRXh0ZXJuYWxJZEluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdleHRlcm5hbElkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLklOQ0xVREUsXHJcbiAgICAgIG5vbktleUF0dHJpYnV0ZXM6IFsnaWQnLCAnc3RhdHVzJ10sXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgLy8gR1NJIHBhcmEgY29uc3VsdGFyIHBvciBjbGllbnRlIChleDogaW5jaWRlbnRlcywgY2xhaW1zKVxyXG4gICAgdGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdDdXN0b21lckRhdGFJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdzaycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHU0kgcGFyYSBjb25zdWx0YXMgZGUgQWRtaW4gKHVzYXIgZW50aXR5L3BhcnRpdGlvbiBzaGFyZGluZyBwYXJhIHBlcmZvcm1hbmNlKVxyXG4gICAgdGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdBZG1pblZpZXdJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnZW50aXR5VHlwZScsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ2NyZWF0ZWRBdCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5JTkNMVURFLFxyXG4gICAgICBub25LZXlBdHRyaWJ1dGVzOiBbJ3N0YXR1cycsICdjcmVkaXRBbW91bnQnLCAncmVwb3J0VXJsJywgJ2luY2lkZW50SWQnLCAnYXdzQWNjb3VudElkJywgJ3N0cmlwZUludm9pY2VJZCcsICdjYXNlSWQnLCAnc3VibWlzc2lvbkVycm9yJywgJ3JlcG9ydEVycm9yJywgJ2NvbW1pc3Npb25BbW91bnQnXSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFMzIEJ1Y2tldCBwYXJhIGhvc3BlZGFyIG8gdGVtcGxhdGUgZG8gQ2xvdWRGb3JtYXRpb25cclxuICAgIGNvbnN0IHRlbXBsYXRlQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnQ2ZuVGVtcGxhdGVCdWNrZXQnLCB7XHJcbiAgICAgIC8vIEFURU7Dh8ODTzogcHVibGljUmVhZEFjY2VzcyDDqSBkZXByZWNhdGVkLiBFbSBwcm9kdcOnw6NvLCBjb25zaWRlcmUgdXNhclxyXG4gICAgICAvLyBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUNMUyBlIHVtYSBCdWNrZXRQb2xpY3lcclxuICAgICAgLy8gbWFpcyBncmFudWxhciBwYXJhIHMzOkdldE9iamVjdC4gUGFyYSBlc3RlIGNhc28gZGUgdXNvIGVzcGVjw61maWNvXHJcbiAgICAgIC8vIGRlIHRlbXBsYXRlIHDDumJsaWNvLCBwdWJsaWNSZWFkQWNjZXNzOiB0cnVlIMOpIGZ1bmNpb25hbC5cclxuICAgICAgcHVibGljUmVhZEFjY2VzczogdHJ1ZSxcclxuICAgICAgd2Vic2l0ZUluZGV4RG9jdW1lbnQ6ICd0ZW1wbGF0ZS55YW1sJywgLy8gRGVmaW5lIG8gYXJxdWl2byBwYWRyw6NvIHBhcmEgYWNlc3NvIHZpYSB3ZWJzaXRlIGVuZHBvaW50XHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksIC8vIFBhcmEgZsOhY2lsIGxpbXBlemEgZW0gYW1iaWVudGVzIGRlIGRlc2Vudm9sdmltZW50b1xyXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSwgLy8gUGFyYSBmw6FjaWwgbGltcGV6YSBlbSBhbWJpZW50ZXMgZGUgZGVzZW52b2x2aW1lbnRvXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBJbXBsYW50YcOnw6NvIGRvIHRlbXBsYXRlIGRvIENsb3VkRm9ybWF0aW9uIG5vIGJ1Y2tldCBTM1xyXG4gICAgbmV3IHMzZGVwbG95LkJ1Y2tldERlcGxveW1lbnQodGhpcywgJ0RlcGxveUNmblRlbXBsYXRlJywge1xyXG4gICAgICBzb3VyY2VzOiBbczNkZXBsb3kuU291cmNlLmFzc2V0KCcuLi9kb2NzJyldLFxyXG4gICAgICBkZXN0aW5hdGlvbkJ1Y2tldDogdGVtcGxhdGVCdWNrZXQsXHJcbiAgICAgIGRlc3RpbmF0aW9uS2V5UHJlZml4OiAnJyxcclxuICAgIH0pO1xyXG5cclxuXHJcbiAgICAvLyBDb2duaXRvIChNYW50aWRvKVxyXG4gICAgY29uc3QgdXNlclBvb2wgPSBuZXcgY29nbml0by5Vc2VyUG9vbCh0aGlzLCAnQ29zdEd1YXJkaWFuUG9vbCcsIHtcclxuICAgICAgc2VsZlNpZ25VcEVuYWJsZWQ6IHRydWUsXHJcbiAgICAgIHNpZ25JbkFsaWFzZXM6IHsgZW1haWw6IHRydWUgfSxcclxuICAgICAgYXV0b1ZlcmlmeTogeyBlbWFpbDogdHJ1ZSB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ2xpZW50ZSBkbyBVc2VyIFBvb2wgcGFyYSBhIGFwbGljYcOnw6NvIHdlYlxyXG4gICAgY29uc3QgdXNlclBvb2xDbGllbnQgPSBuZXcgY29nbml0by5Vc2VyUG9vbENsaWVudCh0aGlzLCAnQ29zdEd1YXJkaWFuVXNlclBvb2xDbGllbnQnLCB7XHJcbiAgICAgIHVzZXJQb29sLFxyXG4gICAgICBnZW5lcmF0ZVNlY3JldDogZmFsc2UsIC8vIEFwbGljYcOnw7VlcyB3ZWIgZGUgY2xpZW50ZSBuw6NvIGRldmVtIHRlciBzZWdyZWRvc1xyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR3J1cG8gZGUgYWRtaW5pc3RyYWRvcmVzIG5vIENvZ25pdG9cclxuICAgIG5ldyBjb2duaXRvLkNmblVzZXJQb29sR3JvdXAodGhpcywgJ0FkbWluR3JvdXAnLCB7XHJcbiAgICAgIHVzZXJQb29sSWQ6IHVzZXJQb29sLnVzZXJQb29sSWQsXHJcbiAgICAgIGdyb3VwTmFtZTogJ0FkbWlucycsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnR3J1cG8gcGFyYSBhZG1pbmlzdHJhZG9yZXMgZGEgcGxhdGFmb3JtYScsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAqKiogSU7DjUNJTyBEQVMgQ09SUkXDh8OVRVMgREUgTEFNQkRBICoqKlxyXG5cclxuICAgIC8vIDEuIExhbWJkYSBwYXJhIG8gQVBJIEdhdGV3YXkgKE1vbm9saXRvIEV4cHJlc3MpXHJcbiAgICBjb25zdCBhcGlIYW5kbGVyTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnQXBpSGFuZGxlcicsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdoYW5kbGVyLmFwcCcsIC8vIEFwb250YSBwYXJhIG8gRXhwcmVzcyBhcHBcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi9iYWNrZW5kJyksXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBTVFJJUEVfU0VDUkVUX0FSTjogc3RyaXBlU2VjcmV0LnNlY3JldEFybiwgLy8gUmVub21lYWRvIHBhcmEgY2xhcmV6YVxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgICB0YWJsZS5ncmFudFJlYWRXcml0ZURhdGEoYXBpSGFuZGxlckxhbWJkYSk7XHJcbiAgICBzdHJpcGVTZWNyZXQuZ3JhbnRSZWFkKGFwaUhhbmRsZXJMYW1iZGEpO1xyXG5cclxuICAgIC8vIDIuIExhbWJkYSBwYXJhIG8gRXZlbnRCcmlkZ2UgKENvcnJlbGFjaW9uYXIgRXZlbnRvcyBIZWFsdGgpXHJcbiAgICBjb25zdCBoZWFsdGhFdmVudEhhbmRsZXJMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdIZWFsdGhFdmVudEhhbmRsZXInLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnZnVuY3Rpb25zL2NvcnJlbGF0ZS1oZWFsdGguaGFuZGxlcicsIC8vIEhhbmRsZXIgZXNwZWPDrWZpY29cclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi9iYWNrZW5kJyksIC8vIE1lc21vIHBhY290ZSBkZSBjw7NkaWdvXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBTRk5fQVJOOiAnJywgLy8gU2Vyw6EgcHJlZW5jaGlkbyBhYmFpeG9cclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGhlYWx0aEV2ZW50SGFuZGxlckxhbWJkYSk7IC8vIFByZWNpc2EgbGVyIG8gR1NJIGUgZXNjcmV2ZXIgaW5jaWRlbnRlc1xyXG5cclxuICAgIC8vIDMuIExhbWJkYXMgcGFyYSBhcyBUYXJlZmFzIGRvIFN0ZXAgRnVuY3Rpb25zXHJcbiAgICBjb25zdCBzbGFDYWxjdWxhdGVJbXBhY3RMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdTbGFDYWxjdWxhdGVJbXBhY3QnLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnZnVuY3Rpb25zL3NsYS13b3JrZmxvdy5jYWxjdWxhdGVJbXBhY3QnLCAvLyBIYW5kbGVyIGVzcGVjw61maWNvXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnLi4vYmFja2VuZCcpLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUsXHJcbiAgICAgIH0sXHJcbiAgICAgIC8vIFBlcm1pc3PDo28gcGFyYSBjaGFtYXIgQ29zdCBFeHBsb3JlciAoQXNzdW1pbmRvIGEgUm9sZSBkbyBDbGllbnRlKVxyXG4gICAgICByb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ1NsYUNhbGNSb2xlJywge1xyXG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxyXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xyXG4gICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJylcclxuICAgICAgICBdLFxyXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XHJcbiAgICAgICAgICBBc3N1bWVDdXN0b21lclJvbGVQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xyXG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgIGFjdGlvbnM6IFsnc3RzOkFzc3VtZVJvbGUnXSxcclxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnYXJuOmF3czppYW06Oio6cm9sZS9Db3N0R3VhcmRpYW5EZWxlZ2F0ZWRSb2xlJ10sIC8vIFBlcm1pdGUgYXNzdW1pciBhIHJvbGUgZW0gKnF1YWxxdWVyKiBjb250YSBjbGllbnRlXHJcbiAgICAgICAgICAgIH0pXVxyXG4gICAgICAgICAgfSlcclxuICAgICAgICB9XHJcbiAgICAgIH0pXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgY29uc3Qgc2xhQ2hlY2tMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdTbGFDaGVjaycsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdmdW5jdGlvbnMvc2xhLXdvcmtmbG93LmNoZWNrU0xBJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi9iYWNrZW5kJyksXHJcbiAgICAgIGVudmlyb25tZW50OiB7IERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHNsYUdlbmVyYXRlUmVwb3J0TGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnU2xhR2VuZXJhdGVSZXBvcnQnLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnZnVuY3Rpb25zL3NsYS13b3JrZmxvdy5nZW5lcmF0ZVJlcG9ydCcsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnLi4vYmFja2VuZCcpLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgU1RSSVBFX1NFQ1JFVF9BUk46IHN0cmlwZVNlY3JldC5zZWNyZXRBcm4sIC8vIFBhc3NhIGEgcmVmZXLDqm5jaWEgYW8gc2VjcmV0XHJcbiAgICAgICAgUkVQT1JUU19CVUNLRVRfTkFNRTogJycsIC8vIFNlcsOhIHByZWVuY2hpZG8gYXDDs3MgY3JpYXIgbyBidWNrZXQgYWJhaXhvXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuICAgIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShzbGFHZW5lcmF0ZVJlcG9ydExhbWJkYSk7XHJcbiAgICBzdHJpcGVTZWNyZXQuZ3JhbnRSZWFkKHNsYUdlbmVyYXRlUmVwb3J0TGFtYmRhKTtcclxuXHJcbiAgICAvLyBDcmlhciBidWNrZXQgUzMgcGFyYSBhcm1hemVuYXIgcmVsYXTDs3Jpb3MgUERGIGdlcmFkb3MgcGVsYSBMYW1iZGFcclxuICAgIGNvbnN0IHJlcG9ydHNCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdSZXBvcnRzQnVja2V0Jywge1xyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcclxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEZvcm5lY2VyIG8gbm9tZSBkbyBidWNrZXQgY29tbyB2YXJpw6F2ZWwgZGUgYW1iaWVudGUgcGFyYSBhIExhbWJkYSAoYXR1YWxpemEpXHJcbiAgICBzbGFHZW5lcmF0ZVJlcG9ydExhbWJkYS5hZGRFbnZpcm9ubWVudCgnUkVQT1JUU19CVUNLRVRfTkFNRScsIHJlcG9ydHNCdWNrZXQuYnVja2V0TmFtZSk7XHJcblxyXG4gICAgLy8gUGVybWlzc8O1ZXMgbmVjZXNzw6FyaWFzIHBhcmEgYSBMYW1iZGEgZXNjcmV2ZXIgb2JqZXRvcyBubyBidWNrZXRcclxuICAgIHJlcG9ydHNCdWNrZXQuZ3JhbnRQdXQoc2xhR2VuZXJhdGVSZXBvcnRMYW1iZGEpO1xyXG5cclxuICAgIGNvbnN0IHNsYVN1Ym1pdFRpY2tldExhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1NsYVN1Ym1pdFRpY2tldCcsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdmdW5jdGlvbnMvc2xhLXdvcmtmbG93LnN1Ym1pdFN1cHBvcnRUaWNrZXQnLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uL2JhY2tlbmQnKSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHsgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSB9LFxyXG4gICAgICByb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ1NsYVN1Ym1pdFJvbGUnLCB7XHJcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXHJcbiAgICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXHJcbiAgICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKVxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcclxuICAgICAgICAgIEFzc3VtZUN1c3RvbWVyUm9sZVBvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XHJcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgYWN0aW9uczogWydzdHM6QXNzdW1lUm9sZSddLFxyXG4gICAgICAgICAgICAgIHJlc291cmNlczogWydhcm46YXdzOmlhbTo6Kjpyb2xlL0Nvc3RHdWFyZGlhbkRlbGVnYXRlZFJvbGUnXSxcclxuICAgICAgICAgICAgfSldXHJcbiAgICAgICAgICB9KVxyXG4gICAgICAgIH1cclxuICAgICAgfSlcclxuICAgIH0pO1xyXG4gICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHNsYVN1Ym1pdFRpY2tldExhbWJkYSk7XHJcbiAgICBcclxuICAgIC8vICoqKiBGSU0gREFTIENPUlJFw4fDlUVTIERFIExBTUJEQSAqKipcclxuXHJcbiAgICAvLyBPYnRlciBvIGV2ZW50IGJ1cyBwYWRyw6NvIGRhIHBsYXRhZm9ybWFcclxuICAgIGNvbnN0IGV2ZW50QnVzID0gZXZlbnRzLkV2ZW50QnVzLmZyb21FdmVudEJ1c05hbWUodGhpcywgJ0RlZmF1bHRCdXMnLCAnZGVmYXVsdCcpO1xyXG5cclxuICAgIC8vIFBvbMOtdGljYSBzZWd1cmEgcGFyYSBvIEV2ZW50IEJ1cyBxdWUgcGVybWl0ZSBhcGVuYXMgZXZlbnRvcyBlc3BlY8OtZmljb3NcclxuICAgIGNvbnN0IGV2ZW50QnVzUG9saWN5ID0gbmV3IGV2ZW50cy5DZm5FdmVudEJ1c1BvbGljeSh0aGlzLCAnRXZlbnRCdXNQb2xpY3knLCB7XHJcbiAgICAgIGV2ZW50QnVzTmFtZTogZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxyXG4gICAgICBzdGF0ZW1lbnRJZDogJ0FsbG93Q2xpZW50SGVhbHRoRXZlbnRzJyxcclxuICAgICAgYWN0aW9uOiAnZXZlbnRzOlB1dEV2ZW50cycsXHJcbiAgICAgIHByaW5jaXBhbDogJyonLCAvLyBOZWNlc3NcdTAwMDBlMXJpbyBwYXJhIGNyb3NzLWFjY291bnRcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEluamV0YXIgYSBjb25kacOnw6NvIGNvbW8gSlNPTiBicnV0byBubyB0ZW1wbGF0ZSBDbG91ZEZvcm1hdGlvbi4gVXNhbW9zXHJcbiAgICAvLyBhZGRQcm9wZXJ0eU92ZXJyaWRlIHBhcmEgZ2FyYW50aXIgcXVlIG8gZm9ybWF0byBzZWphIGV4YXRhbWVudGUgb1xyXG4gICAgLy8gbmVjZXNzw6FyaW8gcGVsbyBDbG91ZEZvcm1hdGlvbjogeyBcIlN0cmluZ0VxdWFsc1wiOiB7IFwiZXZlbnRzOnNvdXJjZVwiOiBcImF3cy5oZWFsdGhcIiB9IH1cclxuICAgIGV2ZW50QnVzUG9saWN5LmFkZFByb3BlcnR5T3ZlcnJpZGUoJ0NvbmRpdGlvbicsIHtcclxuICAgICAgU3RyaW5nRXF1YWxzOiB7XHJcbiAgICAgICAgJ2V2ZW50czpzb3VyY2UnOiAnYXdzLmhlYWx0aCcsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBFdmVudEJyaWRnZSBIZWFsdGggKENvcnJpZ2lkbyBjb20gcGVybWlzc2lvbmFtZW50byBzZWd1cm8pXHJcbiAgICBjb25zdCBoZWFsdGhSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdIZWFsdGhFdmVudFJ1bGUnLCB7XHJcbiAgICAgIGV2ZW50UGF0dGVybjoge1xyXG4gICAgICAgIHNvdXJjZTogWydhd3MuaGVhbHRoJ10sXHJcbiAgICAgICAgZGV0YWlsVHlwZTogWydBV1MgSGVhbHRoIEV2ZW50J10sXHJcbiAgICAgIH0sXHJcbiAgICAgIGV2ZW50QnVzLFxyXG4gICAgICB0YXJnZXRzOiBbbmV3IHRhcmdldHMuTGFtYmRhRnVuY3Rpb24oaGVhbHRoRXZlbnRIYW5kbGVyTGFtYmRhKV0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTdGVwIEZ1bmN0aW9ucyBTTEEgKFVzYW5kbyBvcyBMYW1iZGFzIGNvcnJldG9zKVxyXG4gICAgY29uc3QgY2FsY3VsYXRlSW1wYWN0VGFzayA9IG5ldyBzZm5fdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdDYWxjdWxhdGVJbXBhY3QnLCB7IGxhbWJkYUZ1bmN0aW9uOiBzbGFDYWxjdWxhdGVJbXBhY3RMYW1iZGEsIG91dHB1dFBhdGg6ICckLlBheWxvYWQnIH0pO1xyXG4gICAgY29uc3QgY2hlY2tTbGFUYXNrID0gbmV3IHNmbl90YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ0NoZWNrU0xBJywgeyBsYW1iZGFGdW5jdGlvbjogc2xhQ2hlY2tMYW1iZGEsIG91dHB1dFBhdGg6ICckLlBheWxvYWQnIH0pO1xyXG4gICAgY29uc3QgZ2VuZXJhdGVSZXBvcnRUYXNrID0gbmV3IHNmbl90YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ0dlbmVyYXRlUmVwb3J0JywgeyBsYW1iZGFGdW5jdGlvbjogc2xhR2VuZXJhdGVSZXBvcnRMYW1iZGEsIG91dHB1dFBhdGg6ICckLlBheWxvYWQnIH0pO1xyXG4gICAgY29uc3Qgc3VibWl0VGlja2V0VGFzayA9IG5ldyBzZm5fdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdTdWJtaXRUaWNrZXQnLCB7IGxhbWJkYUZ1bmN0aW9uOiBzbGFTdWJtaXRUaWNrZXRMYW1iZGEsIG91dHB1dFBhdGg6ICckLlBheWxvYWQnIH0pO1xyXG4gICAgY29uc3Qgbm9DbGFpbSA9IG5ldyBzdGVwZnVuY3Rpb25zLlN1Y2NlZWQodGhpcywgJ05vQ2xhaW1HZW5lcmF0ZWQnKTtcclxuXHJcbiAgICBjb25zdCBjbGFpbUNob2ljZSA9IG5ldyBzdGVwZnVuY3Rpb25zLkNob2ljZSh0aGlzLCAnSXNDbGFpbUdlbmVyYXRlZD8nKVxyXG4gICAgICAud2hlbihzdGVwZnVuY3Rpb25zLkNvbmRpdGlvbi5zdHJpbmdFcXVhbHMoJyQuc3RhdHVzJywgJ2dlbmVyYXRlZCcpLCBzdWJtaXRUaWNrZXRUYXNrKVxyXG4gICAgICAub3RoZXJ3aXNlKG5vQ2xhaW0pO1xyXG5cclxuICAgIGNvbnN0IHNsYURlZmluaXRpb24gPSBjYWxjdWxhdGVJbXBhY3RUYXNrXHJcbiAgICAgIC5uZXh0KGNoZWNrU2xhVGFzaylcclxuICAgICAgLm5leHQoZ2VuZXJhdGVSZXBvcnRUYXNrKVxyXG4gICAgICAubmV4dChjbGFpbUNob2ljZSk7XHJcblxyXG4gICAgY29uc3Qgc2ZuID0gbmV3IHN0ZXBmdW5jdGlvbnMuU3RhdGVNYWNoaW5lKHRoaXMsICdTTEFXb3JrZmxvdycsIHtcclxuICAgICAgZGVmaW5pdGlvbkJvZHk6IHN0ZXBmdW5jdGlvbnMuRGVmaW5pdGlvbkJvZHkuZnJvbUNoYWluYWJsZShzbGFEZWZpbml0aW9uKSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFkaWNpb25hciBvIEFSTiBkbyBTRk4gYW8gTGFtYmRhIGRlIGNvcnJlbGHDp8Ojb1xyXG4gICAgaGVhbHRoRXZlbnRIYW5kbGVyTGFtYmRhLmFkZEVudmlyb25tZW50KCdTRk5fQVJOJywgc2ZuLnN0YXRlTWFjaGluZUFybik7XHJcbiAgICAvLyBQZXJtaXNzw6NvIHBhcmEgbyBMYW1iZGEgaW5pY2lhciBhIFN0YXRlIE1hY2hpbmVcclxuICAgIHNmbi5ncmFudFN0YXJ0RXhlY3V0aW9uKGhlYWx0aEV2ZW50SGFuZGxlckxhbWJkYSk7XHJcblxyXG4gICAgLy8gQVBJIEdhdGV3YXkgKFVzYW5kbyBvICdhcGlIYW5kbGVyTGFtYmRhJyBjb3JyZXRvKVxyXG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWd3LlJlc3RBcGkodGhpcywgJ0Nvc3RHdWFyZGlhbkFQSScsIHtcclxuICAgICAgcmVzdEFwaU5hbWU6ICdDb3N0IEd1YXJkaWFuIEFQSScsXHJcbiAgICAgIGRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9uczogeyBhbGxvd09yaWdpbnM6IGFwaWd3LkNvcnMuQUxMX09SSUdJTlMgfSxcclxuICAgIH0pO1xyXG4gICAgY29uc3QgYXV0aCA9IG5ldyBhcGlndy5Db2duaXRvVXNlclBvb2xzQXV0aG9yaXplcih0aGlzLCAnQ29nbml0b0F1dGgnLCB7XHJcbiAgICAgIGNvZ25pdG9Vc2VyUG9vbHM6IFt1c2VyUG9vbF0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBhcGlJbnRlZ3JhdGlvbiA9IG5ldyBhcGlndy5MYW1iZGFJbnRlZ3JhdGlvbihhcGlIYW5kbGVyTGFtYmRhKTtcclxuXHJcbiAgICAvLyBSZXNvdXJjZXMgQVBJIChDb3JyaWdpZG8pXHJcbiAgICBjb25zdCBvbmJvYXJkID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ29uYm9hcmQnKTtcclxuICAgIG9uYm9hcmQuYWRkTWV0aG9kKCdQT1NUJywgYXBpSW50ZWdyYXRpb24pOyAvLyBXZWJob29rLCBzZW0gYXV0aFxyXG4gICAgXHJcbiAgICAvLyBOb3ZvIGVuZHBvaW50IHBhcmEgZ2VyYXIgY29uZmlnIGRlIG9uYm9hcmRpbmdcclxuICAgIGNvbnN0IG9uYm9hcmRJbml0ID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ29uYm9hcmQtaW5pdCcpO1xyXG4gICAgb25ib2FyZEluaXQuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xyXG5cclxuICAgIGNvbnN0IGluY2lkZW50cyA9IGFwaS5yb290LmFkZFJlc291cmNlKCdpbmNpZGVudHMnKTtcclxuICAgIGluY2lkZW50cy5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcbiAgICBjb25zdCBzbGFDbGFpbXMgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnc2xhLWNsYWltcycpO1xyXG4gICAgc2xhQ2xhaW1zLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcclxuXHJcbiAgICBjb25zdCBpbnZvaWNlc0FwaSA9IGFwaS5yb290LmFkZFJlc291cmNlKCdpbnZvaWNlcycpO1xyXG4gICAgaW52b2ljZXNBcGkuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xyXG5cclxuICAgIGNvbnN0IHRlcm1zQXBpID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2FjY2VwdC10ZXJtcycpO1xyXG4gICAgdGVybXNBcGkuYWRkTWV0aG9kKCdQT1NUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcclxuXHJcbiAgICAvLyBFbmRwb2ludCBkZSBBZG1pblxyXG4gICAgY29uc3QgYWRtaW5BcGkgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnYWRtaW4nKTtcclxuICAgIGNvbnN0IGFkbWluQ2xhaW1zID0gYWRtaW5BcGkuYWRkUmVzb3VyY2UoJ2NsYWltcycpO1xyXG4gICAgXHJcbiAgICAvLyBHRVQgL2FwaS9hZG1pbi9jbGFpbXNcclxuICAgIGFkbWluQ2xhaW1zLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcclxuXHJcbiAgICAvLyBTdWItcmVjdXJzb3MgcGFyYSBvcGVyYcOnw7VlcyBlbSBjbGFpbXMgZXNwZWPDrWZpY2FzXHJcbiAgICBjb25zdCBjbGFpbXNCeUN1c3RvbWVyID0gYWRtaW5DbGFpbXMuYWRkUmVzb3VyY2UoJ3tjdXN0b21lcklkfScpO1xyXG4gICAgY29uc3Qgc3BlY2lmaWNDbGFpbSA9IGNsYWltc0J5Q3VzdG9tZXIuYWRkUmVzb3VyY2UoJ3tjbGFpbUlkfScpO1xyXG4gICAgXHJcbiAgICAvLyBQVVQgL2FwaS9hZG1pbi9jbGFpbXMve2N1c3RvbWVySWR9L3tjbGFpbUlkfS9zdGF0dXNcclxuICAgIHNwZWNpZmljQ2xhaW0uYWRkUmVzb3VyY2UoJ3N0YXR1cycpLmFkZE1ldGhvZCgnUFVUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcclxuICAgIFxyXG4gICAgLy8gUE9TVCAvYXBpL2FkbWluL2NsYWltcy97Y3VzdG9tZXJJZH0ve2NsYWltSWR9L2NyZWF0ZS1pbnZvaWNlXHJcbiAgICBzcGVjaWZpY0NsYWltLmFkZFJlc291cmNlKCdjcmVhdGUtaW52b2ljZScpLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gICAgLy8gT3V0cHV0cyAoTWFudGlkbylcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBUElVcmwnLCB7IHZhbHVlOiBhcGkudXJsIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sSWQnLCB7IHZhbHVlOiB1c2VyUG9vbC51c2VyUG9vbElkIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sQ2xpZW50SWQnLCB7IHZhbHVlOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1RhYmxlTmFtZScsIHsgdmFsdWU6IHRhYmxlLnRhYmxlTmFtZSB9KTtcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTRk5Bcm4nLCB7IHZhbHVlOiBzZm4uc3RhdGVNYWNoaW5lQXJuIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0NmblRlbXBsYXRlVXJsJywge1xyXG4gICAgICB2YWx1ZTogdGVtcGxhdGVCdWNrZXQudXJsRm9yT2JqZWN0KCd0ZW1wbGF0ZS55YW1sJyksXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnVVJMIGRvIHRlbXBsYXRlIGRvIENsb3VkRm9ybWF0aW9uIHBhcmEgbyBvbmJvYXJkaW5nIGRvIGNsaWVudGUuIFVzZSBlc3RhIFVSTCBubyBmcm9udGVuZC4nLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59Il19