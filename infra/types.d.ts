declare namespace NodeJS {
  interface Process {
    env: ProcessEnv;
  }
  interface ProcessEnv {
    CDK_DEFAULT_ACCOUNT: string;
    CDK_DEFAULT_REGION: string;
    NODE_ENV: 'development' | 'production' | 'test';
  }
}