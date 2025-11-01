import { ResourcesConfig } from 'aws-amplify';

/**
 * Este arquivo valida as variáveis de ambiente e constrói o objeto de configuração do Amplify.
 * Ele é projetado para ser "universal", funcionando tanto no servidor quanto no cliente.
 */

// 1. Define as variáveis obrigatórias.
const region = process.env.NEXT_PUBLIC_AMPLIFY_REGION;
const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
const userPoolClientId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID;

// 2. Valida se todas as variáveis obrigatórias estão presentes.
// Esta verificação é crucial e impede a criação de uma configuração inválida.
if (!region || !userPoolId || !userPoolClientId) {
  // No lado do servidor, isso pode ser logado. No cliente, isso ajuda a depurar.
  console.error('❌ Erro crítico de configuração do Amplify: Uma ou mais variáveis de ambiente obrigatórias estão ausentes.');
  console.error('Verifique se NEXT_PUBLIC_AMPLIFY_REGION, NEXT_PUBLIC_COGNITO_USER_POOL_ID, e NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID estão no seu .env.local');

  // Lançar um erro impede que a aplicação continue com uma configuração inválida.
  // Isso é melhor do que ter falhas inesperadas mais tarde.
  throw new Error('Configuração do Amplify incompleta. Verifique as variáveis de ambiente.');
}

// 3. Cria a configuração somente se a validação passar.
// Como a validação acima garante que as variáveis não são `undefined`, o TypeScript agora fica satisfeito.
const amplifyConfig: ResourcesConfig = {
  Auth: {
    Cognito: {
      region,
      userPoolId,
      userPoolClientId,
      loginWith: { email: true }, // Simplificado para focar no login com email.
    },
  },
};

export default amplifyConfig;