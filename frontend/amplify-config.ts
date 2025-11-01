import { validateEnvironment } from './lib/validate-env';

if (process.env.NODE_ENV === 'development') {
    const validation = validateEnvironment();

    if (!validation.isValid) {
        console.error('❌ Erros críticos de configuração do Cognito:');
        validation.errors.forEach(error => console.error(`  - ${error}`));
        console.error('\n⚠️  Configure o arquivo .env.local corretamente antes de continuar.\n');
    }

    if (validation.warnings.length > 0) {
        console.warn('⚠️  Avisos de configuração:');
        validation.warnings.forEach(warning => console.warn(`  - ${warning}`));
    }
}

const amplifyConfig = {
    Auth: {
        Cognito: {
            region: process.env.NEXT_PUBLIC_AMPLIFY_REGION || 'us-east-1',
            userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || '',
            userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID || '',
        }
    }
};

export default amplifyConfig;