/**
 * Script exclusivo para CLI (Node.js) para validar o ambiente antes de iniciar o servidor.
 * Este script lê o arquivo .env.local (dev) ou .env.production (produção) e encerra o processo se a configuração for inválida.
 * 
 * ATENÇÃO: Este script foi descontinuado em favor da validação direta no `amplify-config.ts`.
 * Ele é mantido por enquanto para compatibilidade com o comando `npm run dev`, mas a lógica
 * principal de validação foi movida para ser universal (cliente e servidor).
 * A validação real agora acontece no `amplify-config.ts`. Este script apenas garante
 * que as variáveis mínimas estão presentes para o Next.js iniciar.
 */
// Importa módulos nativos do Node.js para manipulação de arquivos e caminhos.
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const requiredEnvs = [
'NEXT_PUBLIC_API_URL',
'NEXT_PUBLIC_COGNITO_USER_POOL_ID',
'NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID',
'NEXT_PUBLIC_AWS_REGION' // Verificação da região
];

function runCliValidation() {
    // Constrói um caminho absoluto para o arquivo .env.local a partir da localização deste script.
    // Verifica se estamos em ambiente de produção (Amplify) ou desenvolvimento
    const isProduction = process.env.NODE_ENV === 'production' || process.env.AMPLIFY_BUILD_CONFIG;
    const envFile = isProduction ? '.env.production' : '.env.local';
    const envPath = path.resolve(__dirname, '..', envFile);

    // 1. Verifica se o arquivo de configuração existe.
    if (!fs.existsSync(envPath)) {
        console.error('❌ ERRO CRÍTICO: Arquivo de configuração não encontrado.');
        console.error(`  - O arquivo '${envFile}' esperado em '${path.dirname(envPath)}' não existe.`);
        if (isProduction) {
            console.log("\n👉 Em produção, as variáveis devem ser injetadas pelo buildSpec do CDK.");
        } else {
            console.log("\n👉 Ação necessária: Execute 'npm run deploy' na pasta 'infra' para gerar este arquivo automaticamente após um deploy bem-sucedido.");
        }
        process.exit(1);
    }

    // 2. Carrega as variáveis de ambiente do arquivo.
    dotenv.config({ path: envPath });

    // 3. Valida se as variáveis obrigatórias foram carregadas do arquivo
    const missingEnvs = requiredEnvs.filter(envName => !process.env[envName]);

    if (missingEnvs.length > 0) {
        console.error('❌ ERRO: Configuração de ambiente inválida. O processo será encerrado.');
        missingEnvs.forEach(env => console.error(`  - Variável obrigatória ausente: ${env}`));
        console.log(`\n👉 Ação necessária: Verifique o arquivo '${envFile}' ou execute 'npm run deploy' na pasta 'infra' para atualizá-lo.`);
        process.exit(1);
    }

    // 4. Validar formato da API_URL
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (apiUrl) {
        // Validar protocolo HTTPS (ou http://localhost em dev)
        if (!apiUrl.startsWith('https://') && !apiUrl.startsWith('http://localhost') && !apiUrl.startsWith('http://127.0.0.1')) {
            console.error('❌ ERRO: API_URL deve usar HTTPS em produção (ou http://localhost em desenvolvimento)');
            console.error(`  - URL atual: ${apiUrl}`);
            process.exit(1);
        }

        // Validar barra final
        if (!apiUrl.endsWith('/')) {
            console.warn('⚠️  AVISO: API_URL deve terminar com / para evitar problemas de roteamento');
            console.warn(`  - URL atual: ${apiUrl}`);
            console.warn('  - URL esperada: ' + apiUrl + '/');
            console.log('\n👉 O script export-outputs.js deve garantir a barra final. Verifique a configuração.');
        }
    }

    console.log('✅ Configuração de ambiente validada com sucesso.');
}

// Executa a validação
runCliValidation();