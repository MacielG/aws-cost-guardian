import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as CostGuardian from '../lib/cost-guardian-stack';
// V-- Import the modules to mock V--
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';

// V-- Mock the specific part causing issues V--
jest.mock('aws-cdk-lib/aws-s3-deployment', () => {
  return {
    ...jest.requireActual('aws-cdk-lib/aws-s3-deployment'), // Keep original exports
    Source: {
      ...jest.requireActual('aws-cdk-lib/aws-s3-deployment').Source,
      asset: jest.fn().mockReturnValue({ // Mock the 'asset' static method
          isAsset: true,
          bind: jest.fn().mockReturnValue({ /* return minimal required config */ bucket: {}, zipObjectKey: '' }), // Mock bind if needed
          // Add other properties/methods if the mock complains
      }),
    },
    BucketDeployment: jest.fn().mockImplementation((scope, id, props) => {
         // Return a mock construct or minimal object if needed
         // This basic mock prevents the constructor logic from running deeply
         return { node: { addDependency: jest.fn() } };
    }),
  };
});

describe('CostGuardianStack: Testes de Asserção e Segurança', () => {
  let app: cdk.App;
  let stack: CostGuardian.CostGuardianStack;
  let template: Template;

  beforeAll(() => {
    app = new cdk.App();
    // Create stack WITHOUT isTestEnvironment if mocking effectively prevents asset logic
    stack = new CostGuardian.CostGuardianStack(app, 'MyTestStack', {
      // isTestEnvironment: true, // Maybe no longer needed with the mock
      githubRepo: 'test/repo',
      githubBranch: 'main',
      githubTokenSecretName: 'dummy-secret',
      // ... other props ...
    });
    template = Template.fromStack(stack);
    // Optional: Reset mock calls if needed between tests
     (s3deploy.Source.asset as jest.Mock).mockClear();
     (s3deploy.BucketDeployment as unknown as jest.Mock).mockClear();
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
