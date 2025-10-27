import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as CostGuardian from '../lib/cost-guardian-stack';

describe('CostGuardianStack: Testes de Asserção e Segurança', () => {
  let app: cdk.App;
  let stack: CostGuardian.CostGuardianStack;
  let template: Template;

  beforeAll(() => {
    app = new cdk.App();
    stack = new CostGuardian.CostGuardianStack(app, 'MyTestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });
    template = Template.fromStack(stack);
  });

  test('Snapshot do Stack está consistente', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });

  test('Bucket S3 de Relatórios deve ser privado e encriptado', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          },
        ],
      },
    });
  });

  test('Tabela DynamoDB (dataTable) deve ter Point-in-Time Recovery e Encriptação', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true,
      },
      SSESpecification: {
        SSEEnabled: true,
      },
    });
  });

  test('Role da API (ApiHandlerLambdaRole) deve ter permissão de escrita no DynamoDB', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyName: Match.stringLikeRegexp('ApiHandlerLambdaRolePolicy'),
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'dynamodb:PutItem',
              'dynamodb:UpdateItem',
              'dynamodb:Query',
              'dynamodb:GetItem'
            ]),
            Effect: 'Allow',
            Resource: Match.arrayWith([
              { 'Fn::GetAtt': [Match.stringLikeRegexp('DataTable'), 'Arn'] }
            ]),
          }),
        ]),
      },
    });
  });

  test('Deve criar exatamente uma State Machine (SLA Workflow)', () => {
    template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
  });
});
