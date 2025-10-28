import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as CostGuardian from '../lib/cost-guardian-stack';

describe('CostGuardianStack: Testes de Asserção e Segurança', () => {
  let app: cdk.App;
  let stack: CostGuardian.CostGuardianStack;
  let template: Template;

  beforeAll(() => {
app = new cdk.App();
    // Passa a flag isTestEnvironment como true para evitar o deploy de assets
    stack = new CostGuardian.CostGuardianStack(app, 'MyTestStack', {
        env: { account: '123456789012', region: 'us-east-1' },
        isTestEnvironment: true
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

  test('Todos os recursos devem ter tags obrigatórias', () => {
    const requiredTags = ['Environment', 'Project', 'Owner', 'CostCenter'];
    
    template.allResources('AWS::Lambda::Function', {
      Tags: Match.arrayWith(
        requiredTags.map(tagKey => ({
          Key: tagKey,
          Value: Match.anyValue()
        }))
      )
    });

    template.allResources('AWS::DynamoDB::Table', {
      Tags: Match.arrayWith(
        requiredTags.map(tagKey => ({
          Key: tagKey,
          Value: Match.anyValue()
        }))
      )
    });
  });

  test('CloudWatch Logs devem ter retenção e encriptação configuradas', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      RetentionInDays: Match.anyValue(),
      KmsKeyId: Match.anyValue()
    });
  });

  test('Backup automático deve estar configurado para recursos críticos', () => {
    template.hasResourceProperties('AWS::Backup::BackupVault', {
      EncryptionKeyArn: Match.anyValue()
    });

    template.hasResourceProperties('AWS::Backup::BackupPlan', {
      BackupPlan: {
        BackupPlanRule: Match.arrayWith([
          Match.objectLike({
            TargetBackupVault: Match.anyValue(),
            ScheduleExpression: Match.anyValue(),
            StartWindowMinutes: Match.anyValue(),
            DeleteAfterDays: Match.anyValue()
          })
        ])
      }
    });

    template.hasResourceProperties('AWS::Backup::BackupSelection', {
      BackupSelection: {
        IamRoleArn: Match.anyValue(),
        Resources: Match.arrayWith([
          Match.stringLikeRegexp('arn:aws:dynamodb:'),
          Match.stringLikeRegexp('arn:aws:s3:')
        ])
      }
    });
  });

  test('CloudWatch Alarms devem estar configurados para monitoramento', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: Match.anyValue(),
      Namespace: Match.anyValue(),
      Period: Match.anyValue(),
      EvaluationPeriods: Match.anyValue(),
      Threshold: Match.anyValue(),
      AlarmActions: Match.arrayWith([Match.anyValue()]),
      OKActions: Match.arrayWith([Match.anyValue()]),
      InsufficientDataActions: Match.arrayWith([Match.anyValue()])
    });
  });

  test('VPC Endpoints devem estar configurados para serviços essenciais', () => {
    const requiredEndpoints = ['dynamodb', 's3', 'logs', 'monitoring'];
    
    requiredEndpoints.forEach(service => {
      template.hasResourceProperties('AWS::EC2::VPCEndpoint', {
        ServiceName: Match.stringLikeRegexp(service),
        VpcEndpointType: Match.anyValue(),
        SecurityGroupIds: Match.arrayWith([Match.anyValue()]),
        SubnetIds: Match.arrayWith([Match.anyValue()])
      });
    });
  });
});
