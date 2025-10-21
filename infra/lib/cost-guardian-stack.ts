import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import { eventsTargets } from 'aws-cdk-lib/aws-events-targets';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as sfn_tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export class CostGuardianStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Secrets
    const stripeSecret = new secretsmanager.Secret(this, 'StripeSecret', {
      generateSecretString: { secretStringTemplate: '{"key":""}', generateStringKey: 'key' },
    });

    // DynamoDB
    const table = new dynamodb.Table(this, 'CostGuardianTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'HealthEventsIndex',
      partitionKey: { name: 'customerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    // Cognito
    const userPool = new cognito.UserPool(this, 'CostGuardianPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
    });

    // Lambda Core
    const coreLambda = new lambda.Function(this, 'CoreHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.app',
      code: lambda.Code.fromAsset('../backend'),
      environment: {
        DYNAMODB_TABLE: table.tableName,
        STRIPE_SECRET: stripeSecret.secretArn,
      },
    });
    table.grantReadWriteData(coreLambda);
    stripeSecret.grantRead(coreLambda);

    // EventBridge Health
    const healthRule = new events.Rule(this, 'HealthEventRule', {
      eventPattern: {
        source: ['aws.health'],
        detailType: ['AWS Health Event'],
      },
    });
    healthRule.addTarget(new eventsTargets.LambdaFunction(coreLambda));

    // Step Functions SLA
    const getEventDetails = new sfn_tasks.LambdaInvoke(this, 'GetEventDetails', { lambdaFunction: coreLambda });
    const calculateImpactTask = new sfn_tasks.LambdaInvoke(this, 'CalculateImpact', { lambdaFunction: coreLambda });
    const checkSLATask = new sfn_tasks.LambdaInvoke(this, 'CheckSLA', { lambdaFunction: coreLambda });
    const generateReportTask = new sfn_tasks.LambdaInvoke(this, 'GenerateReport', { lambdaFunction: coreLambda });

    const slaDefinition = getEventDetails.next(calculateImpactTask).next(checkSLATask).next(generateReportTask);
    const sfn = new stepfunctions.StateMachine(this, 'SLAWorkflow', {
      definitionBody: stepfunctions.DefinitionBody.fromChainable(slaDefinition),
    });
    coreLambda.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      actions: ['states:StartExecution'],
      resources: [sfn.stateMachineArn],
    }));

    // API Gateway com Auth
    const api = new apigw.RestApi(this, 'CostGuardianAPI', {
      restApiName: 'Cost Guardian API',
      defaultCorsPreflightOptions: { allowOrigins: apigw.Cors.ALL_ORIGINS },
    });
    const auth = new apigw.CognitoUserPoolsAuthorizer(this, 'CognitoAuth', {
      cognitoUserPools: [userPool],
    });

    // Resources API
    const onboard = api.root.addResource('onboard');
    onboard.addMethod('POST', new apigw.LambdaIntegration(coreLambda), { authorizer: auth });
    const incidents = api.root.addResource('incidents');
    incidents.addMethod('GET', new apigw.LambdaIntegration(coreLambda), { authorizer: auth });
    const slaClaims = api.root.addResource('sla-claims');
    slaClaims.addMethod('GET', new apigw.LambdaIntegration(coreLambda), { authorizer: auth });

    // Outputs
    new cdk.CfnOutput(this, 'APIUrl', { value: api.url });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
    new cdk.CfnOutput(this, 'SFNArn', { value: sfn.stateMachineArn });
  }
}