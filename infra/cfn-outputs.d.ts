declare global {
    namespace NodeJS {
        interface ProcessEnv {
            CDK_DEFAULT_ACCOUNT: string;
            CDK_DEFAULT_REGION: string;
        }
    }
}
export {};
