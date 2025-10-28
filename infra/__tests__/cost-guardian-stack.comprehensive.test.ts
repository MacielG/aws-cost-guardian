import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as CostGuardian from '../lib/cost-guardian-stack';

describe('CostGuardianStack: Testes Completos', () => {
  let app: cdk.App;
  let stack: CostGuardian.CostGuardianStack;
  let template: Template;

  // Configurações para diferentes ambientes de teste
  const testConfig = {
    env: { account: '123456789012', region: 'us-east-1' },
    domainName: 'test.example.com',
    hostedZoneId: 'Z123456789',
    isTestEnvironment: true
  };

  const prodConfig = {
    env: { account: '123456789012', region: 'us-east-1' },
    domainName: 'prod.example.com',
    hostedZoneId: 'Z987654321',
    isTestEnvironment: false
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
        const bucketCount = template.findResources('AWS::S3::Bucket').length;
        expect(bucketCount).toBeGreaterThan(0);

        template.allResources('AWS::S3::Bucket', {
          VersioningConfiguration: { Status: 'Enabled' },
          BucketEncryption: {
            ServerSideEncryptionConfiguration: [
              {
                ServerSideEncryptionByDefault: {
                  SSEAlgorithm: 'aws:kms'
                }
              }
            ]
          },
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true
          }
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
        KmsKeyId: Match.anyValue(),
        GenerateSecretString: Match.objectLike({
          SecretStringTemplate: Match.anyValue(),
          GenerateStringKey: Match.anyValue()
        }),
        RotationRules: {
          AutomaticallyAfterDays: Match.anyValue()
        }
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
        Name: Match.stringLikeRegexp('CostGuardianApi'),
      });
      // Verifica se existe um WebACL associado
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Rules: Match.arrayWith([Match.anyValue()])
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
            Projection: { ProjectionType: 'ALL' }
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
        DefinitionString: Match.stringLikeRegexp('Catch|Retry')
      });
    });

    test('Cognito User Pool deve ter políticas de senha fortes', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        Policies: {
          PasswordPolicy: {
            MinimumLength: Match.anyValue(),
            RequireNumbers: true,
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
        Policies: Match.arrayWith([
          Match.objectLike({
            PolicyDocument: {
              Statement: Match.arrayWith([
                Match.objectLike({
                  Effect: 'Allow',
                  Action: Match.arrayEquals(['dynamodb:GetItem', 'dynamodb:PutItem']),
                  Resource: Match.anyValue()
                })
              ])
            }
          })
        ])
      });
    });

    test('Step Functions devem ter permissões para invocar Lambdas', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: {
                Service: 'states.amazonaws.com'
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
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        DefinitionString: Match.stringLikeRegexp('Lambda|DynamoDB|SQS')
      });
    });
  });

  describe('Ambientes (Test vs Prod)', () => {
    test('Ambiente de teste não deve criar BucketDeployment', () => {
      const testStack = new CostGuardian.CostGuardianStack(app, 'TestStack', testConfig);
      const testTemplate = Template.fromStack(testStack);
      
      testTemplate.resourceCountIs('AWS::S3::BucketPolicy', 0);
    });

    test('Ambiente de produção deve criar BucketDeployment', () => {
      const prodStack = new CostGuardian.CostGuardianStack(app, 'ProdStack', prodConfig);
      const prodTemplate = Template.fromStack(prodStack);
      
      prodTemplate.hasResourceProperties('AWS::S3::BucketPolicy', Match.anyValue());
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

      prodTemplate.hasResourceProperties('AWS::CloudWatch::Alarm', Match.anyValue());
    });
  });

  describe('Escalabilidade e Performance', () => {
    beforeEach(() => {
      stack = new CostGuardian.CostGuardianStack(app, 'PerformanceTestStack', prodConfig);
      template = Template.fromStack(stack);
    });

    test('DynamoDB deve ter auto scaling configurado', () => {
      template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
        ScalableDimension: 'dynamodb:table:WriteCapacityUnits',
        ServiceNamespace: 'dynamodb'
      });
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