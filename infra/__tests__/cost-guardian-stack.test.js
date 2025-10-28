"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = require("aws-cdk-lib");
const assertions_1 = require("aws-cdk-lib/assertions");
const CostGuardian = require("../lib/cost-guardian-stack");
describe('CostGuardianStack: Testes de Asserção e Segurança', () => {
    let app;
    let stack;
    let template;
    beforeAll(() => {
        app = new cdk.App();
        stack = new CostGuardian.CostGuardianStack(app, 'MyTestStack', {
            env: { account: '123456789012', region: 'us-east-1' },
        });
        template = assertions_1.Template.fromStack(stack);
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
            PolicyName: assertions_1.Match.stringLikeRegexp('ApiHandlerLambdaRolePolicy'),
            PolicyDocument: {
                Statement: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        Action: assertions_1.Match.arrayWith([
                            'dynamodb:PutItem',
                            'dynamodb:UpdateItem',
                            'dynamodb:Query',
                            'dynamodb:GetItem'
                        ]),
                        Effect: 'Allow',
                        Resource: assertions_1.Match.arrayWith([
                            { 'Fn::GetAtt': [assertions_1.Match.stringLikeRegexp('DataTable'), 'Arn'] }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29zdC1ndWFyZGlhbi1zdGFjay50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY29zdC1ndWFyZGlhbi1zdGFjay50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsbUNBQW1DO0FBQ25DLHVEQUF5RDtBQUN6RCwyREFBMkQ7QUFFM0QsUUFBUSxDQUFDLG1EQUFtRCxFQUFFLEdBQUcsRUFBRTtJQUNqRSxJQUFJLEdBQVksQ0FBQztJQUNqQixJQUFJLEtBQXFDLENBQUM7SUFDMUMsSUFBSSxRQUFrQixDQUFDO0lBRXZCLFNBQVMsQ0FBQyxHQUFHLEVBQUU7UUFDYixHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUM7UUFDcEIsS0FBSyxHQUFHLElBQUksWUFBWSxDQUFDLGlCQUFpQixDQUFDLEdBQUcsRUFBRSxhQUFhLEVBQUU7WUFDN0QsR0FBRyxFQUFFLEVBQUUsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFO1NBQ3RELENBQUMsQ0FBQztRQUNILFFBQVEsR0FBRyxxQkFBUSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUN2QyxDQUFDLENBQUMsQ0FBQztJQUVILElBQUksQ0FBQyxvQ0FBb0MsRUFBRSxHQUFHLEVBQUU7UUFDOUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLGVBQWUsRUFBRSxDQUFDO0lBQzlDLENBQUMsQ0FBQyxDQUFDO0lBRUgsSUFBSSxDQUFDLHVEQUF1RCxFQUFFLEdBQUcsRUFBRTtRQUNqRSxRQUFRLENBQUMscUJBQXFCLENBQUMsaUJBQWlCLEVBQUU7WUFDaEQsOEJBQThCLEVBQUU7Z0JBQzlCLGVBQWUsRUFBRSxJQUFJO2dCQUNyQixpQkFBaUIsRUFBRSxJQUFJO2dCQUN2QixnQkFBZ0IsRUFBRSxJQUFJO2dCQUN0QixxQkFBcUIsRUFBRSxJQUFJO2FBQzVCO1lBQ0QsZ0JBQWdCLEVBQUU7Z0JBQ2hCLGlDQUFpQyxFQUFFO29CQUNqQzt3QkFDRSw2QkFBNkIsRUFBRTs0QkFDN0IsWUFBWSxFQUFFLFFBQVE7eUJBQ3ZCO3FCQUNGO2lCQUNGO2FBQ0Y7U0FDRixDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILElBQUksQ0FBQywyRUFBMkUsRUFBRSxHQUFHLEVBQUU7UUFDckYsUUFBUSxDQUFDLHFCQUFxQixDQUFDLHNCQUFzQixFQUFFO1lBQ3JELGdDQUFnQyxFQUFFO2dCQUNoQywwQkFBMEIsRUFBRSxJQUFJO2FBQ2pDO1lBQ0QsZ0JBQWdCLEVBQUU7Z0JBQ2hCLFVBQVUsRUFBRSxJQUFJO2FBQ2pCO1NBQ0YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFJLENBQUMsOEVBQThFLEVBQUUsR0FBRyxFQUFFO1FBQ3hGLFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQyxrQkFBa0IsRUFBRTtZQUNqRCxVQUFVLEVBQUUsa0JBQUssQ0FBQyxnQkFBZ0IsQ0FBQyw0QkFBNEIsQ0FBQztZQUNoRSxjQUFjLEVBQUU7Z0JBQ2QsU0FBUyxFQUFFLGtCQUFLLENBQUMsU0FBUyxDQUFDO29CQUN6QixrQkFBSyxDQUFDLFVBQVUsQ0FBQzt3QkFDZixNQUFNLEVBQUUsa0JBQUssQ0FBQyxTQUFTLENBQUM7NEJBQ3RCLGtCQUFrQjs0QkFDbEIscUJBQXFCOzRCQUNyQixnQkFBZ0I7NEJBQ2hCLGtCQUFrQjt5QkFDbkIsQ0FBQzt3QkFDRixNQUFNLEVBQUUsT0FBTzt3QkFDZixRQUFRLEVBQUUsa0JBQUssQ0FBQyxTQUFTLENBQUM7NEJBQ3hCLEVBQUUsWUFBWSxFQUFFLENBQUMsa0JBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxXQUFXLENBQUMsRUFBRSxLQUFLLENBQUMsRUFBRTt5QkFDL0QsQ0FBQztxQkFDSCxDQUFDO2lCQUNILENBQUM7YUFDSDtTQUNGLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsSUFBSSxDQUFDLHdEQUF3RCxFQUFFLEdBQUcsRUFBRTtRQUNsRSxRQUFRLENBQUMsZUFBZSxDQUFDLGtDQUFrQyxFQUFFLENBQUMsQ0FBQyxDQUFDO0lBQ2xFLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgVGVtcGxhdGUsIE1hdGNoIH0gZnJvbSAnYXdzLWNkay1saWIvYXNzZXJ0aW9ucyc7XG5pbXBvcnQgKiBhcyBDb3N0R3VhcmRpYW4gZnJvbSAnLi4vbGliL2Nvc3QtZ3VhcmRpYW4tc3RhY2snO1xuXG5kZXNjcmliZSgnQ29zdEd1YXJkaWFuU3RhY2s6IFRlc3RlcyBkZSBBc3NlcsOnw6NvIGUgU2VndXJhbsOnYScsICgpID0+IHtcbiAgbGV0IGFwcDogY2RrLkFwcDtcbiAgbGV0IHN0YWNrOiBDb3N0R3VhcmRpYW4uQ29zdEd1YXJkaWFuU3RhY2s7XG4gIGxldCB0ZW1wbGF0ZTogVGVtcGxhdGU7XG5cbiAgYmVmb3JlQWxsKCgpID0+IHtcbiAgICBhcHAgPSBuZXcgY2RrLkFwcCgpO1xuICAgIHN0YWNrID0gbmV3IENvc3RHdWFyZGlhbi5Db3N0R3VhcmRpYW5TdGFjayhhcHAsICdNeVRlc3RTdGFjaycsIHtcbiAgICAgIGVudjogeyBhY2NvdW50OiAnMTIzNDU2Nzg5MDEyJywgcmVnaW9uOiAndXMtZWFzdC0xJyB9LFxuICAgIH0pO1xuICAgIHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgfSk7XG5cbiAgdGVzdCgnU25hcHNob3QgZG8gU3RhY2sgZXN0w6EgY29uc2lzdGVudGUnLCAoKSA9PiB7XG4gICAgZXhwZWN0KHRlbXBsYXRlLnRvSlNPTigpKS50b01hdGNoU25hcHNob3QoKTtcbiAgfSk7XG5cbiAgdGVzdCgnQnVja2V0IFMzIGRlIFJlbGF0w7NyaW9zIGRldmUgc2VyIHByaXZhZG8gZSBlbmNyaXB0YWRvJywgKCkgPT4ge1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpTMzo6QnVja2V0Jywge1xuICAgICAgUHVibGljQWNjZXNzQmxvY2tDb25maWd1cmF0aW9uOiB7XG4gICAgICAgIEJsb2NrUHVibGljQWNsczogdHJ1ZSxcbiAgICAgICAgQmxvY2tQdWJsaWNQb2xpY3k6IHRydWUsXG4gICAgICAgIElnbm9yZVB1YmxpY0FjbHM6IHRydWUsXG4gICAgICAgIFJlc3RyaWN0UHVibGljQnVja2V0czogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBCdWNrZXRFbmNyeXB0aW9uOiB7XG4gICAgICAgIFNlcnZlclNpZGVFbmNyeXB0aW9uQ29uZmlndXJhdGlvbjogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIFNlcnZlclNpZGVFbmNyeXB0aW9uQnlEZWZhdWx0OiB7XG4gICAgICAgICAgICAgIFNTRUFsZ29yaXRobTogJ0FFUzI1NicsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdUYWJlbGEgRHluYW1vREIgKGRhdGFUYWJsZSkgZGV2ZSB0ZXIgUG9pbnQtaW4tVGltZSBSZWNvdmVyeSBlIEVuY3JpcHRhw6fDo28nLCAoKSA9PiB7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkR5bmFtb0RCOjpUYWJsZScsIHtcbiAgICAgIFBvaW50SW5UaW1lUmVjb3ZlcnlTcGVjaWZpY2F0aW9uOiB7XG4gICAgICAgIFBvaW50SW5UaW1lUmVjb3ZlcnlFbmFibGVkOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIFNTRVNwZWNpZmljYXRpb246IHtcbiAgICAgICAgU1NFRW5hYmxlZDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ1JvbGUgZGEgQVBJIChBcGlIYW5kbGVyTGFtYmRhUm9sZSkgZGV2ZSB0ZXIgcGVybWlzc8OjbyBkZSBlc2NyaXRhIG5vIER5bmFtb0RCJywgKCkgPT4ge1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpJQU06OlBvbGljeScsIHtcbiAgICAgIFBvbGljeU5hbWU6IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJ0FwaUhhbmRsZXJMYW1iZGFSb2xlUG9saWN5JyksXG4gICAgICBQb2xpY3lEb2N1bWVudDoge1xuICAgICAgICBTdGF0ZW1lbnQ6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgICBBY3Rpb246IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgICAgICdkeW5hbW9kYjpQdXRJdGVtJyxcbiAgICAgICAgICAgICAgJ2R5bmFtb2RiOlVwZGF0ZUl0ZW0nLFxuICAgICAgICAgICAgICAnZHluYW1vZGI6UXVlcnknLFxuICAgICAgICAgICAgICAnZHluYW1vZGI6R2V0SXRlbSdcbiAgICAgICAgICAgIF0pLFxuICAgICAgICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgICAgICAgUmVzb3VyY2U6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgICAgIHsgJ0ZuOjpHZXRBdHQnOiBbTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnRGF0YVRhYmxlJyksICdBcm4nXSB9XG4gICAgICAgICAgICBdKSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSksXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdEZXZlIGNyaWFyIGV4YXRhbWVudGUgdW1hIFN0YXRlIE1hY2hpbmUgKFNMQSBXb3JrZmxvdyknLCAoKSA9PiB7XG4gICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OlN0ZXBGdW5jdGlvbnM6OlN0YXRlTWFjaGluZScsIDEpO1xuICB9KTtcbn0pO1xuIl19