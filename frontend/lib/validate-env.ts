/**
 * Validação automática de variáveis de ambiente
 * Pode ser executado no build-time (Node.js) ou no runtime (Navegador).
 * Garante que todas as configurações necessárias estejam presentes
 */

export interface EnvValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

const REQUIRED_ENV_VARS = [
    'NEXT_PUBLIC_API_URL',
    'NEXT_PUBLIC_COGNITO_USER_POOL_ID',
    'NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID',
    'NEXT_PUBLIC_AMPLIFY_REGION',
] as const;

const OPTIONAL_ENV_VARS = [
    'NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID',
    'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_CFN_TEMPLATE_URL',
] as const;

export function validateEnvironment(): EnvValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Helper para obter variáveis de ambiente tanto no servidor quanto no cliente
    const getEnvVar = (key: string): string | undefined => {
        // No cliente (browser), as variáveis NEXT_PUBLIC_ são injetadas em tempo de build
        // No servidor, elas estão em process.env
        if (typeof window !== 'undefined') {
            // Cliente: acessa diretamente as variáveis que foram injetadas no bundle
            return (process.env as any)[key];
        }
        // Servidor: acessa process.env normalmente
        return process.env[key];
    };

    // Verificar variáveis obrigatórias
    for (const envVar of REQUIRED_ENV_VARS) {
        const value = getEnvVar(envVar);

        if (!value) {
            errors.push(`Variável obrigatória ausente: ${envVar}`);
        } else if (value.includes('XXXXXXXXX') || value.includes('your-')) {
            errors.push(`Variável ${envVar} ainda contém valor de exemplo`);
        }
    }

    // Verificar variáveis opcionais
    for (const envVar of OPTIONAL_ENV_VARS) {
        const value = getEnvVar(envVar);

        if (!value) {
            warnings.push(`Variável opcional ausente: ${envVar}`);
        }
    }

    // Validações específicas
    const apiUrl = getEnvVar('NEXT_PUBLIC_API_URL');
    if (apiUrl && !apiUrl.startsWith('http')) {
        errors.push('NEXT_PUBLIC_API_URL deve começar com http:// ou https://');
    }

    const region = getEnvVar('NEXT_PUBLIC_AMPLIFY_REGION');
    if (region && !region.match(/^[a-z]{2}-[a-z]+-\d+$/)) {
        warnings.push('NEXT_PUBLIC_AMPLIFY_REGION pode estar em formato inválido (esperado: us-east-1)');
    }

    const userPoolId = getEnvVar('NEXT_PUBLIC_COGNITO_USER_POOL_ID');
    if (userPoolId && !userPoolId.match(/^[a-z]{2}-[a-z]+-\d+_[a-zA-Z0-9]+$/)) {
        warnings.push('NEXT_PUBLIC_COGNITO_USER_POOL_ID pode estar em formato inválido');
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
    };
}

export function logValidationResults(): void {
    const result = validateEnvironment();

    if (!result.isValid) {
        console.error('❌ Erros de configuração encontrados:');
        result.errors.forEach(error => console.error(`  - ${error}`));
    }

    if (result.warnings.length > 0) {
        console.warn('⚠️  Avisos de configuração:');
        result.warnings.forEach(warning => console.warn(`  - ${warning}`));
    }

    if (result.isValid && result.warnings.length === 0) {
        console.log('✅ Todas as variáveis de ambiente estão configuradas corretamente');
    }
}
