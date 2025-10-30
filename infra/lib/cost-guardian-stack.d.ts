import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
export interface CostGuardianStackProps extends cdk.StackProps {
    domainName?: string;
    hostedZoneId?: string;
    githubRepo?: string;
    githubBranch?: string;
    githubTokenSecretName?: string;
    /**
     * Se true, desativa recursos que dependem de assets físicos durante os testes.
     * @default false
     */
    isTestEnvironment?: boolean;
    /**
     * Se true, cria alarmes do CloudWatch.
     * @default true
     */
    createAlarms?: boolean;
    depsLockFilePath?: string;
    /**
     * Caminho absoluto para a pasta backend
     */
    backendPath?: string;
    /**
     * Caminho absoluto para a pasta backend/functions
     */
    backendFunctionsPath?: string;
    /**
     * Caminho absoluto para a pasta docs
     */
    docsPath?: string;
}
export declare class CostGuardianStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: CostGuardianStackProps);
}
