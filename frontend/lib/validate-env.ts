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

    // Verificar variáveis obrigatórias
    for (const envVar of REQUIRED_ENV_VARS) {
        const value = process.env[envVar];

        if (!value) {
            errors.push(`Variável obrigatória ausente: ${envVar}`);
        } else if (value.includes('XXXXXXXXX') || value.includes('your-')) {
            errors.push(`Variável ${envVar} ainda contém valor de exemplo`);
        }
    }

    // Verificar variáveis opcionais
    for (const envVar of OPTIONAL_ENV_VARS) {
        const value = process.env[envVar];

        if (!value) {
            warnings.push(`Variável opcional ausente: ${envVar}`);
        }
    }

    // Validações específicas
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (apiUrl && !apiUrl.startsWith('http')) {
        errors.push('NEXT_PUBLIC_API_URL deve começar com http:// ou https://');
    }

    const region = process.env.NEXT_PUBLIC_AMPLIFY_REGION;
    if (region && !region.match(/^[a-z]{2}-[a-z]+-\d+$/)) {
        warnings.push('NEXT_PUBLIC_AMPLIFY_REGION pode estar em formato inválido (esperado: us-east-1)');
    }

    const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
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

/**
 * Função para ser executada via CLI (Node.js) que encerra o processo em caso de erro.
 * Isso impede que o build ou o servidor de desenvolvimento prossigam com uma configuração inválida.
 */
function runCliValidation() {
    // Carrega as variáveis de .env.local para o process.env
    require('dotenv').config({ path: '.env.local' });

    const result = validateEnvironment();

    if (!result.isValid) {
        console.error('❌ ERRO: Configuração de ambiente inválida. O processo será encerrado.');
        result.errors.forEach(error => console.error(`  - ${error}`));
        console.log("\n👉 Ação necessária: Execute 'npm run export-outputs' na pasta 'infra' após um deploy bem-sucedido do CDK.");
        process.exit(1); // Encerra o processo com código de erro
    }

    console.log('✅ Configuração de ambiente validada com sucesso.');
}

// Verifica se o script está sendo executado diretamente pelo Node.js
if (require.main === module) {
    runCliValidation();
}
