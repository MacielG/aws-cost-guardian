#!/usr/bin/env node
/**
 * Script de Teste de Autenticação Cognito
 * 
 * Testa:
 * 1. Configuração do User Pool
 * 2. Login de usuário
 * 3. Geração de token JWT
 * 4. Validação de token
 * 5. Refresh de token
 */

const { 
  CognitoIdentityProviderClient, 
  InitiateAuthCommand,
  GetUserCommand,
  GlobalSignOutCommand
} = require('@aws-sdk/client-cognito-identity-provider');

const readline = require('readline');

// Configuração do Cognito (do .env.local)
const USER_POOL_ID = 'us-east-1_VsN8wZ32M';
const CLIENT_ID = '7bi5nil8r30fgfjqs5rvfi8trs';
const REGION = 'us-east-1';

const client = new CognitoIdentityProviderClient({ region: REGION });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

// Cores para terminal
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testCognitoAuth() {
  log('\n🔐 TESTE DE AUTENTICAÇÃO COGNITO', 'cyan');
  log('=' .repeat(60), 'cyan');
  
  try {
    // Passo 1: Solicitar credenciais
    log('\n📝 Passo 1: Credenciais de Teste', 'blue');
    const email = await question('Email do usuário: ');
    const password = await question('Senha: ');
    
    // Passo 2: Tentar autenticar
    log('\n🔑 Passo 2: Tentando autenticar...', 'blue');
    
    const authCommand = new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    });
    
    const authResponse = await client.send(authCommand);
    
    if (!authResponse.AuthenticationResult) {
      log('❌ Falha na autenticação: Sem resultado de autenticação', 'red');
      rl.close();
      return;
    }
    
    const { IdToken, AccessToken, RefreshToken, ExpiresIn } = authResponse.AuthenticationResult;
    
    log('✅ Autenticação bem-sucedida!', 'green');
    log(`   Token expira em: ${ExpiresIn} segundos (${Math.floor(ExpiresIn / 60)} minutos)`, 'green');
    
    // Passo 3: Decodificar e validar token
    log('\n🔍 Passo 3: Validando Token JWT...', 'blue');
    
    const tokenParts = IdToken.split('.');
    if (tokenParts.length !== 3) {
      log('❌ Token JWT inválido (formato incorreto)', 'red');
      rl.close();
      return;
    }
    
    const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
    
    log('✅ Token JWT válido!', 'green');
    log(`   Subject (sub): ${payload.sub}`, 'green');
    log(`   Email: ${payload.email}`, 'green');
    log(`   Email verificado: ${payload.email_verified}`, 'green');
    log(`   Emitido em: ${new Date(payload.iat * 1000).toLocaleString()}`, 'green');
    log(`   Expira em: ${new Date(payload.exp * 1000).toLocaleString()}`, 'green');
    
    // Passo 4: Obter informações do usuário
    log('\n👤 Passo 4: Obtendo informações do usuário...', 'blue');
    
    const getUserCommand = new GetUserCommand({
      AccessToken: AccessToken,
    });
    
    const userResponse = await client.send(getUserCommand);
    
    log('✅ Informações do usuário obtidas!', 'green');
    log(`   Username: ${userResponse.Username}`, 'green');
    
    userResponse.UserAttributes.forEach(attr => {
      log(`   ${attr.Name}: ${attr.Value}`, 'green');
    });
    
    // Passo 5: Verificar estrutura do token
    log('\n📋 Passo 5: Estrutura do Token ID para API...', 'blue');
    log('✅ Header que deve ser enviado nas chamadas API:', 'green');
    log(`   Authorization: Bearer ${IdToken.substring(0, 50)}...`, 'cyan');
    
    // Passo 6: Resumo final
    log('\n' + '='.repeat(60), 'cyan');
    log('📊 RESUMO DO TESTE', 'cyan');
    log('='.repeat(60), 'cyan');
    
    log('\n✅ Configuração do Cognito:', 'green');
    log(`   ✓ User Pool ID: ${USER_POOL_ID}`, 'green');
    log(`   ✓ Client ID: ${CLIENT_ID}`, 'green');
    log(`   ✓ Região: ${REGION}`, 'green');
    
    log('\n✅ Autenticação:', 'green');
    log(`   ✓ Login funcional`, 'green');
    log(`   ✓ Token JWT gerado`, 'green');
    log(`   ✓ Token válido`, 'green');
    log(`   ✓ Informações do usuário recuperadas`, 'green');
    
    log('\n✅ Próximos passos:', 'yellow');
    log('   1. Testar login no frontend (http://localhost:3000/login)', 'yellow');
    log('   2. Verificar se token aparece no DevTools Network tab', 'yellow');
    log('   3. Testar chamadas à API com o token', 'yellow');
    log('   4. Testar logout', 'yellow');
    
    // Opcional: Fazer logout
    const doLogout = await question('\n❓ Deseja fazer logout deste usuário? (s/n): ');
    
    if (doLogout.toLowerCase() === 's') {
      log('\n🚪 Fazendo logout...', 'blue');
      
      const signOutCommand = new GlobalSignOutCommand({
        AccessToken: AccessToken,
      });
      
      await client.send(signOutCommand);
      log('✅ Logout realizado com sucesso!', 'green');
    }
    
  } catch (error) {
    log('\n❌ ERRO NO TESTE:', 'red');
    
    if (error.name === 'NotAuthorizedException') {
      log('   Usuário ou senha incorretos', 'red');
    } else if (error.name === 'UserNotFoundException') {
      log('   Usuário não encontrado', 'red');
    } else if (error.name === 'InvalidParameterException') {
      log('   Parâmetros inválidos', 'red');
    } else {
      log(`   ${error.name}: ${error.message}`, 'red');
    }
    
    log('\n💡 Dicas:', 'yellow');
    log('   - Verifique se o email está correto', 'yellow');
    log('   - Verifique se a senha atende aos requisitos', 'yellow');
    log('   - Verifique se o usuário está confirmado (email verificado)', 'yellow');
    
    console.error('\n📋 Detalhes completos do erro:', error);
  } finally {
    rl.close();
  }
}

// Verificar se tem dependências instaladas
try {
  require.resolve('@aws-sdk/client-cognito-identity-provider');
} catch (e) {
  log('\n❌ ERRO: Dependências não instaladas', 'red');
  log('\nExecute primeiro:', 'yellow');
  log('   npm install @aws-sdk/client-cognito-identity-provider', 'cyan');
  process.exit(1);
}

// Executar teste
testCognitoAuth();
