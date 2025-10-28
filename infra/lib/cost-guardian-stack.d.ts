import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
export interface CostGuardianStackProps extends cdk.StackProps {
    domainName?: string;
    hostedZoneId?: string;
    githubRepo?: string;
    githubBranch?: string;
    githubTokenSecretName?: string;
}
export declare class CostGuardianStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: CostGuardianStackProps);
}
