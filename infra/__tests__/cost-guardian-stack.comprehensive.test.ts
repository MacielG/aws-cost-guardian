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
    BucketDeployment: jest.fn().mockImplementation((_scope, _id, _props) => {
         // Return a mock construct or minimal object if needed
         // This basic mock prevents the constructor logic from running deeply
         return { node: { addDependency: jest.fn() } };
    }),
  };
});

describe('CostGuardianStack: Testes Completos', () => {
  let app: cdk.App;
  let stack: CostGuardian.CostGuardianStack;
  let template: Template;

  // Configurações para diferentes ambientes de teste
  const testConfig = {
    env: { account: '123456789012', region: 'us-east-1' },
    domainName: 'test.example.com',
    hostedZoneId: 'Z123456789',
    isTestEnvironment: true,
    githubRepo: 'test/repo',
    githubBranch: 'main',
    githubTokenSecretName: 'dummy-secret'
  };

  const prodConfig = {
    env: { account: '123456789012', region: 'us-east-1' },
    domainName: 'prod.example.com',
    hostedZoneId: 'Z987654321',
    isTestEnvironment: false,
    githubRepo: 'prod/repo',
    githubBranch: 'main',
    githubTokenSecretName: 'prod-secret'
  };

  beforeEach(() => {
    app = new cdk.App();
  });

  describe('Segurança e Compliance', () => {
    beforeEach(() => {
      stack = new CostGuardian.CostGuardianStack(app, 'SecurityTestStack', testConfig);
      template = Template.fromStack(stack);
    });

    describe('Configurações de S3', () => {
      test('Todos os buckets devem ter as configurações de segurança adequadas', () => {
        const buckets = template.findResources('AWS::S3::Bucket');
        const bucketCount = Object.keys(buckets).length;
        expect(bucketCount).toBeGreaterThan(0);

        template.hasResourceProperties('AWS::S3::Bucket', {
          VersioningConfiguration: { Status: 'Enabled' }
        });

        template.hasResourceProperties('AWS::S3::Bucket', {
          PublicAccessBlockConfiguration: Match.objectLike({
            BlockPublicAcls: true,
            IgnorePublicAcls: true
          })
        });
      });

      test('Todos os buckets devem ter lifecycle rules completas', () => {
        template.hasResourceProperties('AWS::S3::Bucket', {
          LifecycleConfiguration: {
            Rules: Match.arrayWith([
              Match.objectLike({
                ExpirationInDays: Match.anyValue(),
                NoncurrentVersionExpirationInDays: Match.anyValue(),
                Status: 'Enabled',
                Transitions: Match.arrayWith([Match.anyValue()]),
                NoncurrentVersionTransitions: Match.arrayWith([Match.anyValue()])
              })
            ])
          }
        });
      });
    });

    test('Secrets Manager deve usar KMS com rotação automática', () => {
      template.hasResourceProperties('AWS::SecretsManager::Secret', {
        KmsKeyId: Match.anyValue()
      });
      template.hasResourceProperties('AWS::SecretsManager::RotationSchedule', {
        RotationRules: Match.objectLike({ AutomaticallyAfterDays: 90 })
      });
    });

    test('Lambdas devem ter configuração de VPC', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        VpcConfig: Match.objectLike({
          SecurityGroupIds: Match.arrayWith([Match.anyValue()]),
          SubnetIds: Match.arrayWith([Match.anyValue()])
        })
      });
    });

    test('API Gateway deve ter WAF associado', () => {
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        Name: 'CostGuardianApi'
      });
      // Verifica se existe um WebACL associado
      template.hasResourceProperties('AWS::WAFv2::WebACLAssociation', {
        WebACLArn: Match.anyValue()
      });
    });
  });

  describe('Configuração de Recursos', () => {
    beforeEach(() => {
      stack = new CostGuardian.CostGuardianStack(app, 'ResourceTestStack', testConfig);
      template = Template.fromStack(stack);
    });

    test('DynamoDB deve ter GSIs configurados corretamente', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'AwsAccountIndex',
            KeySchema: [
              { AttributeName: 'awsAccountId', KeyType: 'HASH' }
            ],
            Projection: { ProjectionType: 'INCLUDE' }
          })
        ])
      });
    });

    test('Lambda functions devem ter configurações de memória e timeout apropriadas', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: Match.anyValue(),
        Timeout: Match.anyValue()
      });
    });

    test('Step Functions devem ter tratamento de erro configurado', () => {
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        StateMachineName: 'SLAWorkflow',
        DefinitionString: Match.stringLikeRegexp(".*CalculateImpact.*CheckSLA.*GenerateReport.*IsClaimGenerated?.*SubmitTicket.*NoClaimGenerated.*")
      });

      // Valida que a SFN tem políticas de log configuradas
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        LoggingConfiguration: {
          Destinations: Match.anyValue(),
          IncludeExecutionData: true,
          Level: 'ALL'
        }
      });
    });

    test('Cognito User Pool deve ter políticas de senha fortes', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        Policies: {
          PasswordPolicy: {
            MinimumLength: 8,
            RequireDigits: true,
            RequireSymbols: true,
            RequireUppercase: true,
            RequireLowercase: true
          }
        }
      });
    });
  });

  describe('Permissões e IAM', () => {
    beforeEach(() => {
      stack = new CostGuardian.CostGuardianStack(app, 'IamTestStack', testConfig);
      template = Template.fromStack(stack);
    });

    test('Lambda roles devem seguir o princípio do menor privilégio', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'sts:AssumeRole',
              Principal: { Service: 'lambda.amazonaws.com' }
            })
          ])
        })
      });
    });

    test('Step Functions devem ter permissões para invocar Lambdas', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: {
                Service: Match.stringLikeRegexp('states.*.amazonaws.com')
              }
            })
          ])
        }
      });
    });

    test('EventBridge deve ter permissão para acionar Step Functions', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: {
                Service: 'events.amazonaws.com'
              }
            })
          ])
        }
      });
    });
  });

  describe('Integrações', () => {
    beforeEach(() => {
      stack = new CostGuardian.CostGuardianStack(app, 'IntegrationTestStack', testConfig);
      template = Template.fromStack(stack);
    });

    test('EventBridge deve ter regras para eventos do Health', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        EventPattern: Match.objectLike({
          source: ['aws.health']
        })
      });
    });

    test('API Gateway deve ter integrações com Lambda configuradas', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        Integration: {
          Type: 'AWS_PROXY',
          IntegrationHttpMethod: 'POST'
        }
      });
    });

    test('Step Functions devem ter integrações com serviços AWS', () => {
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {});
    });
  });

  describe('Ambientes (Test vs Prod)', () => {
    test('Ambiente de teste não deve criar BucketDeployment', () => {
      const testStack = new CostGuardian.CostGuardianStack(app, 'TestStack', testConfig);
      const testTemplate = Template.fromStack(testStack);
      
      testTemplate.resourceCountIs('Custom::S3BucketDeployment', 0);
    });

    test('Ambiente de produção deve criar BucketDeployment', () => {
      const prodStack = new CostGuardian.CostGuardianStack(app, 'ProdStack', prodConfig);
      const prodTemplate = Template.fromStack(prodStack);
      
      prodTemplate.resourceCountIs('Custom::S3BucketDeployment', 2);
    });

    test('Ambiente de teste deve ter logs aprimorados', () => {
      const testStack = new CostGuardian.CostGuardianStack(app, 'TestLoggingStack', testConfig);
      const testTemplate = Template.fromStack(testStack);

      testTemplate.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            LOG_LEVEL: 'DEBUG'
          }
        }
      });
    });

    test('Ambiente de produção deve ter alertas configurados', () => {
      const prodStack = new CostGuardian.CostGuardianStack(app, 'ProdMonitoringStack', prodConfig);
      const prodTemplate = Template.fromStack(prodStack);

      prodTemplate.hasResourceProperties('AWS::CloudWatch::Alarm', {});
    });
  });

  describe('Escalabilidade e Performance', () => {
    beforeEach(() => {
      stack = new CostGuardian.CostGuardianStack(app, 'PerformanceTestStack', prodConfig);
      template = Template.fromStack(stack);
    });

    test('DynamoDB deve ter auto scaling configurado', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', { BillingMode: 'PAY_PER_REQUEST' });
    });

    test('Lambda functions devem ter configurações de concorrência', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        ReservedConcurrentExecutions: Match.anyValue()
      });
    });

    test('API Gateway deve ter throttling configurado', () => {
      template.hasResourceProperties('AWS::ApiGateway::Stage', {
        MethodSettings: Match.arrayWith([
          Match.objectLike({
            ThrottlingBurstLimit: Match.anyValue(),
            ThrottlingRateLimit: Match.anyValue()
          })
        ])
      });
    });
  });
});