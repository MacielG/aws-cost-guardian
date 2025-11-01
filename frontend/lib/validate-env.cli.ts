/**
 * Script exclusivo para CLI (Node.js) para validar o ambiente antes de iniciar o servidor.
 * Este script lê o arquivo .env.local e encerra o processo se a configuração for inválida.
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
    'NEXT_PUBLIC_AMPLIFY_REGION' // Adicionada a verificação da região
];

function runCliValidation() {
    // Constrói um caminho absoluto para o arquivo .env.local a partir da localização deste script.
    const envPath = path.resolve(__dirname, '..', '.env.local');

    // 1. Verifica se o arquivo .env.local existe.
    if (!fs.existsSync(envPath)) {
        console.error('❌ ERRO CRÍTICO: Arquivo de configuração não encontrado.');
        console.error(`  - O arquivo '.env.local' esperado em '${path.dirname(envPath)}' não existe.`);
        console.log("\n👉 Ação necessária: Execute 'npm run deploy' na pasta 'infra' para gerar este arquivo automaticamente após um deploy bem-sucedido.");
        process.exit(1);
    }

    // 2. Carrega as variáveis de ambiente do arquivo .env.local.
    dotenv.config({ path: envPath });

    // 3. Valida se as variáveis obrigatórias foram carregadas do .env.local
    const missingEnvs = requiredEnvs.filter(envName => !process.env[envName]);

    if (missingEnvs.length > 0) {
        console.error('❌ ERRO: Configuração de ambiente inválida. O processo será encerrado.');
        missingEnvs.forEach(env => console.error(`  - Variável obrigatória ausente: ${env}`));
        console.log("\n👉 Ação necessária: Verifique o arquivo '.env.local' ou execute 'npm run deploy' na pasta 'infra' para atualizá-lo.");
        process.exit(1);
    }

    console.log('✅ Configuração de ambiente validada com sucesso.');
}

// Executa a validação
runCliValidation();