"use strict";
// infra/lib/cost-guardian-stack.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.CostGuardianStack = void 0;
const cdk = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const aws_lambda_nodejs_1 = require("aws-cdk-lib/aws-lambda-nodejs");
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
        // Usamos NodejsFunction para empacotar apenas o necessário com esbuild
        const apiHandlerLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'ApiHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, '../../backend/handler.js'),
            handler: 'app',
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
        const healthEventHandlerLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'HealthEventHandler', {
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
        const slaCalculateImpactLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'SlaCalculateImpact', {
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
        const slaCheckLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'SlaCheck', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: path.join(__dirname, '../../backend/functions/sla-workflow.js'),
            handler: 'checkSLA',
            bundling: { externalModules: ['aws-sdk'] },
            environment: { DYNAMODB_TABLE: table.tableName },
        });
        const slaGenerateReportLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'SlaGenerateReport', {
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
        const slaSubmitTicketLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'SlaSubmitTicket', {
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
exports.CostGuardianStack = CostGuardianStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29zdC1ndWFyZGlhbi1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNvc3QtZ3VhcmRpYW4tc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLG1DQUFtQzs7O0FBRW5DLG1DQUFtQztBQUVuQyxpREFBaUQ7QUFDakQscUVBQStEO0FBQy9ELDZCQUE2QjtBQUM3QixvREFBb0Q7QUFDcEQscURBQXFEO0FBQ3JELG1EQUFtRDtBQUNuRCx5Q0FBeUM7QUFDekMsMERBQTBEO0FBQzFELGlEQUFpRDtBQUNqRCwwREFBMEQ7QUFDMUQsK0RBQStEO0FBQy9ELGlFQUFpRTtBQUNqRSxpRUFBaUU7QUFDakUsMkNBQTJDO0FBRTNDLE1BQWEsaUJBQWtCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDOUMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixvQkFBb0I7UUFDcEIsTUFBTSxZQUFZLEdBQUcsSUFBSSxjQUFjLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDbkUsb0JBQW9CLEVBQUUsRUFBRSxvQkFBb0IsRUFBRSxZQUFZLEVBQUUsaUJBQWlCLEVBQUUsS0FBSyxFQUFFO1NBQ3ZGLENBQUMsQ0FBQztRQUVILG9FQUFvRTtRQUNwRSxNQUFNLEtBQUssR0FBRyxJQUFJLFFBQVEsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQzFELFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFO1lBQ2pFLE9BQU8sRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFO1lBQzVELFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLGVB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LENBQUMsSUFBSSxFQUFFLFdBQVcsRUFBRSxFQUFFLEtBQUssRUFBRSxLQUFLLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQztRQUNqRSxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRSxFQUFFLEtBQUssRUFBRSxHQUFHLENBQUMsZUFBZSxFQUFFLENBQUMsQ0FBQztRQUNsRSxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQ3hDLEtBQUssRUFBRSxHQUFHLGNBQWMsQ0FBQyxnQkFBZ0IsZ0JBQWdCO1lBQ3pELFdBQVcsRUFBRSwyRkFBMkY7U0FDekcsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBM1VELDhDQTJVQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIGluZnJhL2xpYi9jb3N0LWd1YXJkaWFuLXN0YWNrLnRzXHJcblxyXG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xyXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcclxuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzJztcclxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcclxuaW1wb3J0ICogYXMgYXBpZ3cgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xyXG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xyXG5pbXBvcnQgKiBhcyBjb2duaXRvIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2duaXRvJztcclxuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcclxuaW1wb3J0ICogYXMgczNkZXBsb3kgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzLWRlcGxveW1lbnQnO1xyXG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cyc7XHJcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcclxuaW1wb3J0ICogYXMgc3RlcGZ1bmN0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucyc7XHJcbmltcG9ydCAqIGFzIHNmbl90YXNrcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucy10YXNrcyc7XHJcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuXHJcbmV4cG9ydCBjbGFzcyBDb3N0R3VhcmRpYW5TdGFjayBleHRlbmRzIGNkay5TdGFjayB7XHJcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xyXG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XHJcblxyXG4gICAgLy8gU2VjcmV0cyAoTWFudGlkbylcclxuICAgIGNvbnN0IHN0cmlwZVNlY3JldCA9IG5ldyBzZWNyZXRzbWFuYWdlci5TZWNyZXQodGhpcywgJ1N0cmlwZVNlY3JldCcsIHtcclxuICAgICAgZ2VuZXJhdGVTZWNyZXRTdHJpbmc6IHsgc2VjcmV0U3RyaW5nVGVtcGxhdGU6ICd7XCJrZXlcIjpcIlwifScsIGdlbmVyYXRlU3RyaW5nS2V5OiAna2V5JyB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gRHluYW1vREIgKE1hbnRpZG8sIG1hcyBhZGljaW9uYW5kbyBzdHJlYW0gcGFyYSBlZmljacOqbmNpYSBmdXR1cmEpXHJcbiAgICBjb25zdCB0YWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnQ29zdEd1YXJkaWFuVGFibGUnLCB7XHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LCAvLyBDaGF2ZSBwcmltw6FyaWEgcGFyYSB1c3XDoXJpb3MsIGNsYWltcywgZXRjLlxyXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdzaycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sIC8vIENoYXZlIGRlIGNsYXNzaWZpY2HDp8OjbyBwYXJhIG1vZGVsYWdlbSBmbGV4w612ZWxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgICAgc3RyZWFtOiBkeW5hbW9kYi5TdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVMsIC8vIEhhYmlsaXRhciBzdHJlYW1cclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdTSSBwYXJhIG1hcGVhciBBV1MgQWNjb3VudCBJRCBwYXJhIG5vc3NvIEN1c3RvbWVyIElEIChDUsONVElDTyBwYXJhIGNvcnJlbGHDp8OjbylcclxuICAgIHRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnQXdzQWNjb3VudEluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdhd3NBY2NvdW50SWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuSU5DTFVERSxcclxuICAgICAgbm9uS2V5QXR0cmlidXRlczogWydpZCddLCAvLyBQcm9qZXRhciBvICdpZCcgKG5vc3NvIEN1c3RvbWVyIElEKVxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR1NJIHBhcmEgbyBjYWxsYmFjayBkbyBvbmJvYXJkaW5nIHZpYSBFeHRlcm5hbElkXHJcbiAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0V4dGVybmFsSWRJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnZXh0ZXJuYWxJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5JTkNMVURFLFxyXG4gICAgICBub25LZXlBdHRyaWJ1dGVzOiBbJ2lkJywgJ3N0YXR1cyddLFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIEdTSSBwYXJhIGNvbnN1bHRhciBwb3IgY2xpZW50ZSAoZXg6IGluY2lkZW50ZXMsIGNsYWltcylcclxuICAgIHRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnQ3VzdG9tZXJEYXRhSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAnc2snLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR1NJIHBhcmEgY29uc3VsdGFzIGRlIEFkbWluICh1c2FyIGVudGl0eS9wYXJ0aXRpb24gc2hhcmRpbmcgcGFyYSBwZXJmb3JtYW5jZSlcclxuICAgIHRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnQWRtaW5WaWV3SW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2VudGl0eVR5cGUnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdjcmVhdGVkQXQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuSU5DTFVERSxcclxuICAgICAgbm9uS2V5QXR0cmlidXRlczogWydzdGF0dXMnLCAnY3JlZGl0QW1vdW50JywgJ3JlcG9ydFVybCcsICdpbmNpZGVudElkJywgJ2F3c0FjY291bnRJZCcsICdzdHJpcGVJbnZvaWNlSWQnLCAnY2FzZUlkJywgJ3N1Ym1pc3Npb25FcnJvcicsICdyZXBvcnRFcnJvcicsICdjb21taXNzaW9uQW1vdW50J10sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTMyBCdWNrZXQgcGFyYSBob3NwZWRhciBvIHRlbXBsYXRlIGRvIENsb3VkRm9ybWF0aW9uXHJcbiAgICBjb25zdCB0ZW1wbGF0ZUJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ0NmblRlbXBsYXRlQnVja2V0Jywge1xyXG4gICAgICBwdWJsaWNSZWFkQWNjZXNzOiB0cnVlLFxyXG4gICAgICB3ZWJzaXRlSW5kZXhEb2N1bWVudDogJ3RlbXBsYXRlLnlhbWwnLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcclxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IG5ldyBzMy5CbG9ja1B1YmxpY0FjY2Vzcyh7XHJcbiAgICAgICAgYmxvY2tQdWJsaWNBY2xzOiB0cnVlLFxyXG4gICAgICAgIGlnbm9yZVB1YmxpY0FjbHM6IHRydWUsXHJcbiAgICAgICAgYmxvY2tQdWJsaWNQb2xpY3k6IGZhbHNlLCAvLyBQZXJtaXRlIHBvbMOtdGljYXMgcMO6YmxpY2FzXHJcbiAgICAgICAgcmVzdHJpY3RQdWJsaWNCdWNrZXRzOiBmYWxzZSxcclxuICAgICAgfSksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBJbXBsYW50YcOnw6NvIGRvIHRlbXBsYXRlIGRvIENsb3VkRm9ybWF0aW9uIG5vIGJ1Y2tldCBTM1xyXG4gICAgbmV3IHMzZGVwbG95LkJ1Y2tldERlcGxveW1lbnQodGhpcywgJ0RlcGxveUNmblRlbXBsYXRlJywge1xyXG4gICAgICBzb3VyY2VzOiBbczNkZXBsb3kuU291cmNlLmFzc2V0KCcuLi9kb2NzJyldLFxyXG4gICAgICBkZXN0aW5hdGlvbkJ1Y2tldDogdGVtcGxhdGVCdWNrZXQsXHJcbiAgICAgIGRlc3RpbmF0aW9uS2V5UHJlZml4OiAnJyxcclxuICAgIH0pO1xyXG5cclxuXHJcbiAgICAvLyBDb2duaXRvIChNYW50aWRvKVxyXG4gICAgY29uc3QgdXNlclBvb2wgPSBuZXcgY29nbml0by5Vc2VyUG9vbCh0aGlzLCAnQ29zdEd1YXJkaWFuUG9vbCcsIHtcclxuICAgICAgc2VsZlNpZ25VcEVuYWJsZWQ6IHRydWUsXHJcbiAgICAgIHNpZ25JbkFsaWFzZXM6IHsgZW1haWw6IHRydWUgfSxcclxuICAgICAgYXV0b1ZlcmlmeTogeyBlbWFpbDogdHJ1ZSB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ2xpZW50ZSBkbyBVc2VyIFBvb2wgcGFyYSBhIGFwbGljYcOnw6NvIHdlYlxyXG4gICAgY29uc3QgdXNlclBvb2xDbGllbnQgPSBuZXcgY29nbml0by5Vc2VyUG9vbENsaWVudCh0aGlzLCAnQ29zdEd1YXJkaWFuVXNlclBvb2xDbGllbnQnLCB7XHJcbiAgICAgIHVzZXJQb29sLFxyXG4gICAgICBnZW5lcmF0ZVNlY3JldDogZmFsc2UsIFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR3J1cG8gZGUgYWRtaW5pc3RyYWRvcmVzIG5vIENvZ25pdG9cclxuICAgIG5ldyBjb2duaXRvLkNmblVzZXJQb29sR3JvdXAodGhpcywgJ0FkbWluR3JvdXAnLCB7XHJcbiAgICAgIHVzZXJQb29sSWQ6IHVzZXJQb29sLnVzZXJQb29sSWQsXHJcbiAgICAgIGdyb3VwTmFtZTogJ0FkbWlucycsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnR3J1cG8gcGFyYSBhZG1pbmlzdHJhZG9yZXMgZGEgcGxhdGFmb3JtYScsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAxLiBMYW1iZGEgcGFyYSBvIEFQSSBHYXRld2F5IChNb25vbGl0byBFeHByZXNzKVxyXG4gICAgLy8gVXNhbW9zIE5vZGVqc0Z1bmN0aW9uIHBhcmEgZW1wYWNvdGFyIGFwZW5hcyBvIG5lY2Vzc8OhcmlvIGNvbSBlc2J1aWxkXHJcbiAgICBjb25zdCBhcGlIYW5kbGVyTGFtYmRhID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsICdBcGlIYW5kbGVyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9iYWNrZW5kL2hhbmRsZXIuanMnKSxcclxuICAgICAgaGFuZGxlcjogJ2FwcCcsIC8vIGV4cG9ydCBkbyBleHByZXNzICsgc2VydmVybGVzcyDDqSBleHBvc3RvIGNvbW8gJ2FwcCcgbm8gaGFuZGxlci5qc1xyXG4gICAgICBidW5kbGluZzoge1xyXG4gICAgICAgIGV4dGVybmFsTW9kdWxlczogWydhd3Mtc2RrJ10sXHJcbiAgICAgIH0sXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBTVFJJUEVfU0VDUkVUX0FSTjogc3RyaXBlU2VjcmV0LnNlY3JldEFybixcclxuICAgICAgICBVU0VSX1BPT0xfSUQ6IHVzZXJQb29sLnVzZXJQb29sSWQsXHJcbiAgICAgICAgVVNFUl9QT09MX0NMSUVOVF9JRDogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCxcclxuICAgICAgICBQTEFURk9STV9BQ0NPVU5UX0lEOiB0aGlzLmFjY291bnQgfHwgcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfQUNDT1VOVCxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGFwaUhhbmRsZXJMYW1iZGEpO1xyXG4gICAgc3RyaXBlU2VjcmV0LmdyYW50UmVhZChhcGlIYW5kbGVyTGFtYmRhKTtcclxuXHJcbiAgICAvLyAyLiBMYW1iZGEgcGFyYSBvIEV2ZW50QnJpZGdlIChDb3JyZWxhY2lvbmFyIEV2ZW50b3MgSGVhbHRoKVxyXG4gICAgY29uc3QgaGVhbHRoRXZlbnRIYW5kbGVyTGFtYmRhID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsICdIZWFsdGhFdmVudEhhbmRsZXInLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL2JhY2tlbmQvZnVuY3Rpb25zL2NvcnJlbGF0ZS1oZWFsdGguanMnKSxcclxuICAgICAgaGFuZGxlcjogJ2hhbmRsZXInLFxyXG4gICAgICBidW5kbGluZzogeyBleHRlcm5hbE1vZHVsZXM6IFsnYXdzLXNkayddIH0sXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBTRk5fQVJOOiAnJywgLy8gU2Vyw6EgcHJlZW5jaGlkbyBhYmFpeG9cclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGhlYWx0aEV2ZW50SGFuZGxlckxhbWJkYSk7XHJcblxyXG4gICAgLy8gMy4gTGFtYmRhcyBwYXJhIGFzIFRhcmVmYXMgZG8gU3RlcCBGdW5jdGlvbnNcclxuICAgIGNvbnN0IHNsYUNhbGN1bGF0ZUltcGFjdExhbWJkYSA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLCAnU2xhQ2FsY3VsYXRlSW1wYWN0Jywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9iYWNrZW5kL2Z1bmN0aW9ucy9zbGEtd29ya2Zsb3cuanMnKSxcclxuICAgICAgaGFuZGxlcjogJ2NhbGN1bGF0ZUltcGFjdCcsXHJcbiAgICAgIGJ1bmRsaW5nOiB7IGV4dGVybmFsTW9kdWxlczogWydhd3Mtc2RrJ10gfSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBEWU5BTU9EQl9UQUJMRTogdGFibGUudGFibGVOYW1lLFxyXG4gICAgICB9LFxyXG4gICAgICByb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ1NsYUNhbGNSb2xlJywge1xyXG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxyXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xyXG4gICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJylcclxuICAgICAgICBdLFxyXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XHJcbiAgICAgICAgICBBc3N1bWVDdXN0b21lclJvbGVQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xyXG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgIGFjdGlvbnM6IFsnc3RzOkFzc3VtZVJvbGUnXSxcclxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnYXJuOmF3czppYW06Oio6cm9sZS9Db3N0R3VhcmRpYW5EZWxlZ2F0ZWRSb2xlJ10sIFxyXG4gICAgICAgICAgICB9KV1cclxuICAgICAgICAgIH0pXHJcbiAgICAgICAgfVxyXG4gICAgICB9KVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIGNvbnN0IHNsYUNoZWNrTGFtYmRhID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsICdTbGFDaGVjaycsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vYmFja2VuZC9mdW5jdGlvbnMvc2xhLXdvcmtmbG93LmpzJyksXHJcbiAgICAgIGhhbmRsZXI6ICdjaGVja1NMQScsXHJcbiAgICAgIGJ1bmRsaW5nOiB7IGV4dGVybmFsTW9kdWxlczogWydhd3Mtc2RrJ10gfSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHsgRFlOQU1PREJfVEFCTEU6IHRhYmxlLnRhYmxlTmFtZSB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3Qgc2xhR2VuZXJhdGVSZXBvcnRMYW1iZGEgPSBuZXcgTm9kZWpzRnVuY3Rpb24odGhpcywgJ1NsYUdlbmVyYXRlUmVwb3J0Jywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9iYWNrZW5kL2Z1bmN0aW9ucy9zbGEtd29ya2Zsb3cuanMnKSxcclxuICAgICAgaGFuZGxlcjogJ2dlbmVyYXRlUmVwb3J0JyxcclxuICAgICAgYnVuZGxpbmc6IHsgZXh0ZXJuYWxNb2R1bGVzOiBbJ2F3cy1zZGsnXSB9LFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgU1RSSVBFX1NFQ1JFVF9BUk46IHN0cmlwZVNlY3JldC5zZWNyZXRBcm4sXHJcbiAgICAgICAgUkVQT1JUU19CVUNLRVRfTkFNRTogJycsIC8vIFNlcsOhIHByZWVuY2hpZG8gYWJhaXhvXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuICAgIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShzbGFHZW5lcmF0ZVJlcG9ydExhbWJkYSk7XHJcbiAgICBzdHJpcGVTZWNyZXQuZ3JhbnRSZWFkKHNsYUdlbmVyYXRlUmVwb3J0TGFtYmRhKTtcclxuXHJcbiAgICAvLyBDcmlhciBidWNrZXQgUzMgcGFyYSBhcm1hemVuYXIgcmVsYXTDs3Jpb3MgUERGIGdlcmFkb3MgcGVsYSBMYW1iZGFcclxuICAgIGNvbnN0IHJlcG9ydHNCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdSZXBvcnRzQnVja2V0Jywge1xyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcclxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEZvcm5lY2VyIG8gbm9tZSBkbyBidWNrZXQgY29tbyB2YXJpw6F2ZWwgZGUgYW1iaWVudGUgcGFyYSBhIExhbWJkYSAoYXR1YWxpemEpXHJcbiAgICBzbGFHZW5lcmF0ZVJlcG9ydExhbWJkYS5hZGRFbnZpcm9ubWVudCgnUkVQT1JUU19CVUNLRVRfTkFNRScsIHJlcG9ydHNCdWNrZXQuYnVja2V0TmFtZSk7XHJcblxyXG4gICAgLy8gUGVybWlzc8O1ZXMgbmVjZXNzw6FyaWFzIHBhcmEgYSBMYW1iZGEgZXNjcmV2ZXIgb2JqZXRvcyBubyBidWNrZXRcclxuICAgIHJlcG9ydHNCdWNrZXQuZ3JhbnRQdXQoc2xhR2VuZXJhdGVSZXBvcnRMYW1iZGEpO1xyXG5cclxuICAgIGNvbnN0IHNsYVN1Ym1pdFRpY2tldExhbWJkYSA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLCAnU2xhU3VibWl0VGlja2V0Jywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9iYWNrZW5kL2Z1bmN0aW9ucy9zbGEtd29ya2Zsb3cuanMnKSxcclxuICAgICAgaGFuZGxlcjogJ3N1Ym1pdFN1cHBvcnRUaWNrZXQnLFxyXG4gICAgICBidW5kbGluZzogeyBleHRlcm5hbE1vZHVsZXM6IFsnYXdzLXNkayddIH0sXHJcbiAgICAgIGVudmlyb25tZW50OiB7IERZTkFNT0RCX1RBQkxFOiB0YWJsZS50YWJsZU5hbWUgfSxcclxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdTbGFTdWJtaXRSb2xlJywge1xyXG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxyXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xyXG4gICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJylcclxuICAgICAgICBdLFxyXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XHJcbiAgICAgICAgICBBc3N1bWVDdXN0b21lclJvbGVQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xyXG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgIGFjdGlvbnM6IFsnc3RzOkFzc3VtZVJvbGUnXSxcclxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnYXJuOmF3czppYW06Oio6cm9sZS9Db3N0R3VhcmRpYW5EZWxlZ2F0ZWRSb2xlJ10sXHJcbiAgICAgICAgICAgIH0pXVxyXG4gICAgICAgICAgfSlcclxuICAgICAgICB9XHJcbiAgICAgIH0pXHJcbiAgICB9KTtcclxuICAgIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShzbGFTdWJtaXRUaWNrZXRMYW1iZGEpO1xyXG4gICAgXHJcbiAgICAvLyBPYnRlciBvIGV2ZW50IGJ1cyBwYWRyw6NvIGRhIHBsYXRhZm9ybWFcclxuICAgIGNvbnN0IGV2ZW50QnVzID0gZXZlbnRzLkV2ZW50QnVzLmZyb21FdmVudEJ1c05hbWUodGhpcywgJ0RlZmF1bHRCdXMnLCAnZGVmYXVsdCcpO1xyXG5cclxuICAgIC8vIFBvbMOtdGljYSBzZWd1cmEgcGFyYSBvIEV2ZW50IEJ1cyBxdWUgcGVybWl0ZSBhcGVuYXMgZXZlbnRvcyBlc3BlY8OtZmljb3NcclxuICAgIG5ldyBldmVudHMuQ2ZuRXZlbnRCdXNQb2xpY3kodGhpcywgJ0V2ZW50QnVzUG9saWN5Jywge1xyXG4gICAgICBldmVudEJ1c05hbWU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZSxcclxuICAgICAgc3RhdGVtZW50SWQ6ICdBbGxvd0NsaWVudEhlYWx0aEV2ZW50cycsXHJcbiAgICAgIGFjdGlvbjogJ2V2ZW50czpQdXRFdmVudHMnLFxyXG4gICAgICBwcmluY2lwYWw6ICcqJywgLy8gTmVjZXNzw6FyaW8gcGFyYSBjcm9zcy1hY2NvdW50XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAtLS0gSU7DjUNJTyBEQSBDT1JSRcOHw4NPIC0tLVxyXG4gICAgLy8gUkVNT1ZBIGVzdGUgYmxvY28uIEEgZmlsdHJhZ2VtIGRlICdldmVudHM6c291cmNlJyDDqSBmZWl0YVxyXG4gICAgLy8gcGVsYSAnaGVhbHRoUnVsZScgYWJhaXhvLCBuw6NvIHBlbGEgcG9sw610aWNhIGRvIGJhcnJhbWVudG8uXHJcbiAgICAvKlxyXG4gICAgZXZlbnRCdXNQb2xpY3kuYWRkUHJvcGVydHlPdmVycmlkZSgnQ29uZGl0aW9uJywge1xyXG4gICAgICBUeXBlOiAnU3RyaW5nRXF1YWxzJyxcclxuICAgICAgS2V5OiAnZXZlbnRzOnNvdXJjZScsXHJcbiAgICAgIFZhbHVlOiAnYXdzLmhlYWx0aCcsXHJcbiAgICB9KTtcclxuICAgICovXHJcbiAgICAvLyAtLS0gRklNIERBIENPUlJFw4fDg08gLS0tXHJcblxyXG4gICAgLy8gRXZlbnRCcmlkZ2UgSGVhbHRoIChFc3RhIMOpIGEgcmVncmEgZGUgRklMVFJBR0VNIGNvcnJldGEpXHJcbiAgICBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ0hlYWx0aEV2ZW50UnVsZScsIHtcclxuICAgICAgZXZlbnRQYXR0ZXJuOiB7XHJcbiAgICAgICAgc291cmNlOiBbJ2F3cy5oZWFsdGgnXSwgLy8gQSBmaWx0cmFnZW0gYWNvbnRlY2UgYXF1aVxyXG4gICAgICAgIGRldGFpbFR5cGU6IFsnQVdTIEhlYWx0aCBFdmVudCddLFxyXG4gICAgICB9LFxyXG4gICAgICBldmVudEJ1cyxcclxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKGhlYWx0aEV2ZW50SGFuZGxlckxhbWJkYSldLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gU3RlcCBGdW5jdGlvbnMgU0xBIChVc2FuZG8gb3MgTGFtYmRhcyBjb3JyZXRvcylcclxuICAgIGNvbnN0IGNhbGN1bGF0ZUltcGFjdFRhc2sgPSBuZXcgc2ZuX3Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnQ2FsY3VsYXRlSW1wYWN0JywgeyBsYW1iZGFGdW5jdGlvbjogc2xhQ2FsY3VsYXRlSW1wYWN0TGFtYmRhLCBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyB9KTtcclxuICAgIGNvbnN0IGNoZWNrU2xhVGFzayA9IG5ldyBzZm5fdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdDaGVja1NMQScsIHsgbGFtYmRhRnVuY3Rpb246IHNsYUNoZWNrTGFtYmRhLCBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyB9KTtcclxuICAgIGNvbnN0IGdlbmVyYXRlUmVwb3J0VGFzayA9IG5ldyBzZm5fdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdHZW5lcmF0ZVJlcG9ydCcsIHsgbGFtYmRhRnVuY3Rpb246IHNsYUdlbmVyYXRlUmVwb3J0TGFtYmRhLCBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyB9KTtcclxuICAgIGNvbnN0IHN1Ym1pdFRpY2tldFRhc2sgPSBuZXcgc2ZuX3Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnU3VibWl0VGlja2V0JywgeyBsYW1iZGFGdW5jdGlvbjogc2xhU3VibWl0VGlja2V0TGFtYmRhLCBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyB9KTtcclxuICAgIGNvbnN0IG5vQ2xhaW0gPSBuZXcgc3RlcGZ1bmN0aW9ucy5TdWNjZWVkKHRoaXMsICdOb0NsYWltR2VuZXJhdGVkJyk7XHJcblxyXG4gICAgY29uc3QgY2xhaW1DaG9pY2UgPSBuZXcgc3RlcGZ1bmN0aW9ucy5DaG9pY2UodGhpcywgJ0lzQ2xhaW1HZW5lcmF0ZWQ/JylcclxuICAgICAgLndoZW4oc3RlcGZ1bmN0aW9ucy5Db25kaXRpb24uc3RyaW5nRXF1YWxzKCckLnN0YXR1cycsICdnZW5lcmF0ZWQnKSwgc3VibWl0VGlja2V0VGFzaylcclxuICAgICAgLm90aGVyd2lzZShub0NsYWltKTtcclxuXHJcbiAgICBjb25zdCBzbGFEZWZpbml0aW9uID0gY2FsY3VsYXRlSW1wYWN0VGFza1xyXG4gICAgICAubmV4dChjaGVja1NsYVRhc2spXHJcbiAgICAgIC5uZXh0KGdlbmVyYXRlUmVwb3J0VGFzaylcclxuICAgICAgLm5leHQoY2xhaW1DaG9pY2UpO1xyXG5cclxuICAgIGNvbnN0IHNmbiA9IG5ldyBzdGVwZnVuY3Rpb25zLlN0YXRlTWFjaGluZSh0aGlzLCAnU0xBV29ya2Zsb3cnLCB7XHJcbiAgICAgIGRlZmluaXRpb25Cb2R5OiBzdGVwZnVuY3Rpb25zLkRlZmluaXRpb25Cb2R5LmZyb21DaGFpbmFibGUoc2xhRGVmaW5pdGlvbiksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZGljaW9uYXIgbyBBUk4gZG8gU0ZOIGFvIExhbWJkYSBkZSBjb3JyZWxhw6fDo29cclxuICAgIGhlYWx0aEV2ZW50SGFuZGxlckxhbWJkYS5hZGRFbnZpcm9ubWVudCgnU0ZOX0FSTicsIHNmbi5zdGF0ZU1hY2hpbmVBcm4pO1xyXG4gICAgLy8gUGVybWlzc8OjbyBwYXJhIG8gTGFtYmRhIGluaWNpYXIgYSBTdGF0ZSBNYWNoaW5lXHJcbiAgICBzZm4uZ3JhbnRTdGFydEV4ZWN1dGlvbihoZWFsdGhFdmVudEhhbmRsZXJMYW1iZGEpO1xyXG5cclxuICAgIC8vIEFQSSBHYXRld2F5IChVc2FuZG8gbyAnYXBpSGFuZGxlckxhbWJkYScgY29ycmV0bylcclxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcGlndy5SZXN0QXBpKHRoaXMsICdDb3N0R3VhcmRpYW5BUEknLCB7XHJcbiAgICAgIHJlc3RBcGlOYW1lOiAnQ29zdCBHdWFyZGlhbiBBUEknLFxyXG4gICAgICBkZWZhdWx0Q29yc1ByZWZsaWdodE9wdGlvbnM6IHsgYWxsb3dPcmlnaW5zOiBhcGlndy5Db3JzLkFMTF9PUklHSU5TIH0sXHJcbiAgICB9KTtcclxuICAgIGNvbnN0IGF1dGggPSBuZXcgYXBpZ3cuQ29nbml0b1VzZXJQb29sc0F1dGhvcml6ZXIodGhpcywgJ0NvZ25pdG9BdXRoJywge1xyXG4gICAgICBjb2duaXRvVXNlclBvb2xzOiBbdXNlclBvb2xdLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgYXBpSW50ZWdyYXRpb24gPSBuZXcgYXBpZ3cuTGFtYmRhSW50ZWdyYXRpb24oYXBpSGFuZGxlckxhbWJkYSk7XHJcblxyXG4gICAgLy8gRXhwb3IgdG9kYXMgYXMgcm90YXMgc29iIC9hcGkgcGFyYSBjb2luY2lkaXIgY29tIGFzIHJvdGFzIEV4cHJlc3MgZG8gYmFja2VuZCAoL2FwaS8qKVxyXG4gICAgY29uc3QgYXBpUm9vdCA9IGFwaS5yb290LmFkZFJlc291cmNlKCdhcGknKTtcclxuXHJcbiAgLy8gSGVhbHRoIHDDumJsaWNvOiBHRVQgL2FwaS9oZWFsdGggLT4gc2VtIGF1dGhvcml6ZXJcclxuICBjb25zdCBoZWFsdGggPSBhcGlSb290LmFkZFJlc291cmNlKCdoZWFsdGgnKTtcclxuICBoZWFsdGguYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbik7IC8vIHB1YmxpYyBoZWFsdGggY2hlY2tcclxuXHJcbiAgICAvLyBSZXNvdXJjZXMgQVBJIChhZ29yYSBzb2IgL2FwaSlcclxuICAgIGNvbnN0IG9uYm9hcmQgPSBhcGlSb290LmFkZFJlc291cmNlKCdvbmJvYXJkJyk7XHJcbiAgICBvbmJvYXJkLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uKTsgLy8gV2ViaG9vaywgc2VtIGF1dGhcclxuXHJcbiAgICAvLyBOb3ZvIGVuZHBvaW50IHBhcmEgZ2VyYXIgY29uZmlnIGRlIG9uYm9hcmRpbmdcclxuICAgIGNvbnN0IG9uYm9hcmRJbml0ID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnb25ib2FyZC1pbml0Jyk7XHJcbiAgICBvbmJvYXJkSW5pdC5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gICAgY29uc3QgaW5jaWRlbnRzID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnaW5jaWRlbnRzJyk7XHJcbiAgICBpbmNpZGVudHMuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xyXG4gICAgY29uc3Qgc2xhQ2xhaW1zID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnc2xhLWNsYWltcycpO1xyXG4gICAgc2xhQ2xhaW1zLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24sIHsgYXV0aG9yaXplcjogYXV0aCB9KTtcclxuXHJcbiAgICBjb25zdCBpbnZvaWNlc0FwaSA9IGFwaVJvb3QuYWRkUmVzb3VyY2UoJ2ludm9pY2VzJyk7XHJcbiAgICBpbnZvaWNlc0FwaS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gICAgY29uc3QgdGVybXNBcGkgPSBhcGlSb290LmFkZFJlc291cmNlKCdhY2NlcHQtdGVybXMnKTtcclxuICAgIHRlcm1zQXBpLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gICAgLy8gRW5kcG9pbnQgZGUgQWRtaW5cclxuICAgIGNvbnN0IGFkbWluQXBpID0gYXBpUm9vdC5hZGRSZXNvdXJjZSgnYWRtaW4nKTtcclxuICAgIGNvbnN0IGFkbWluQ2xhaW1zID0gYWRtaW5BcGkuYWRkUmVzb3VyY2UoJ2NsYWltcycpO1xyXG5cclxuICAgIC8vIEdFVCAvYXBpL2FkbWluL2NsYWltc1xyXG4gICAgYWRtaW5DbGFpbXMuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbiwgeyBhdXRob3JpemVyOiBhdXRoIH0pO1xyXG5cclxuICAgIC8vIFN1Yi1yZWN1cnNvcyBwYXJhIG9wZXJhw6fDtWVzIGVtIGNsYWltcyBlc3BlY8OtZmljYXNcclxuICAgIGNvbnN0IGNsYWltc0J5Q3VzdG9tZXIgPSBhZG1pbkNsYWltcy5hZGRSZXNvdXJjZSgne2N1c3RvbWVySWR9Jyk7XHJcbiAgICBjb25zdCBzcGVjaWZpY0NsYWltID0gY2xhaW1zQnlDdXN0b21lci5hZGRSZXNvdXJjZSgne2NsYWltSWR9Jyk7XHJcblxyXG4gICAgLy8gUFVUIC9hcGkvYWRtaW4vY2xhaW1zL3tjdXN0b21lcklkfS97Y2xhaW1JZH0vc3RhdHVzXHJcbiAgICBzcGVjaWZpY0NsYWltLmFkZFJlc291cmNlKCdzdGF0dXMnKS5hZGRNZXRob2QoJ1BVVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gICAgLy8gUE9TVCAvYXBpL2FkbWluL2NsYWltcy97Y3VzdG9tZXJJZH0ve2NsYWltSWR9L2NyZWF0ZS1pbnZvaWNlXHJcbiAgICBzcGVjaWZpY0NsYWltLmFkZFJlc291cmNlKCdjcmVhdGUtaW52b2ljZScpLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uLCB7IGF1dGhvcml6ZXI6IGF1dGggfSk7XHJcblxyXG4gICAgLy8gT3V0cHV0cyAoTWFudGlkbylcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBUElVcmwnLCB7IHZhbHVlOiBhcGkudXJsIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sSWQnLCB7IHZhbHVlOiB1c2VyUG9vbC51c2VyUG9vbElkIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sQ2xpZW50SWQnLCB7IHZhbHVlOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1RhYmxlTmFtZScsIHsgdmFsdWU6IHRhYmxlLnRhYmxlTmFtZSB9KTtcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTRk5Bcm4nLCB7IHZhbHVlOiBzZm4uc3RhdGVNYWNoaW5lQXJuIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0NmblRlbXBsYXRlVXJsJywge1xyXG4gICAgICB2YWx1ZTogYCR7dGVtcGxhdGVCdWNrZXQuYnVja2V0V2Vic2l0ZVVybH0vdGVtcGxhdGUueWFtbGAsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnVVJMIGRvIHRlbXBsYXRlIGRvIENsb3VkRm9ybWF0aW9uIHBhcmEgbyBvbmJvYXJkaW5nIGRvIGNsaWVudGUuIFVzZSBlc3RhIFVSTCBubyBmcm9udGVuZC4nLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59Il19