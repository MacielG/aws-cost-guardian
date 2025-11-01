#!/usr/bin/env node
/**
 * Teste Automatizado de Configuração do Cognito
 * Valida a configuração sem necessidade de login
 */

const { 
  CognitoIdentityProviderClient, 
  DescribeUserPoolCommand,
  DescribeUserPoolClientCommand,
  ListUsersCommand
} = require('@aws-sdk/client-cognito-identity-provider');

// Configuração
const USER_POOL_ID = 'us-east-1_VsN8wZ32M';
const CLIENT_ID = '7bi5nil8r30fgfjqs5rvfi8trs';
const REGION = 'us-east-1';

const client = new CognitoIdentityProviderClient({ region: REGION });

// Cores
const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

function log(msg, color = 'reset') {
  console.log(`${c[color]}${msg}${c.reset}`);
}

async function validateCognito() {
  log('\n🔐 VALIDAÇÃO DE CONFIGURAÇÃO DO COGNITO', 'cyan');
  log('='.repeat(70), 'cyan');
  
  let allTestsPassed = true;
  
  try {
    // Teste 1: User Pool existe e está ativo
    log('\n📋 Teste 1: Validar User Pool', 'blue');
    
    const poolCommand = new DescribeUserPoolCommand({
      UserPoolId: USER_POOL_ID
    });
    
    const poolResponse = await client.send(poolCommand);
    const pool = poolResponse.UserPool;
    
    if (!pool) {
      log('   ❌ User Pool não encontrado', 'red');
      allTestsPassed = false;
    } else {
      log(`   ✅ User Pool encontrado: ${pool.Name}`, 'green');
      log(`   ✅ ID: ${pool.Id}`, 'green');
      log(`   ✅ ARN: ${pool.Arn}`, 'green');
      log(`   ✅ Criado em: ${pool.CreationDate}`, 'green');
      log(`   ✅ Última modificação: ${pool.LastModifiedDate}`, 'green');
      
      // Verificar políticas de senha
      const pwdPolicy = pool.Policies?.PasswordPolicy;
      if (pwdPolicy) {
        log(`   ✅ Política de senha configurada:`, 'green');
        log(`      - Mínimo ${pwdPolicy.MinimumLength} caracteres`, 'green');
        log(`      - Requer maiúscula: ${pwdPolicy.RequireUppercase}`, 'green');
        log(`      - Requer minúscula: ${pwdPolicy.RequireLowercase}`, 'green');
        log(`      - Requer número: ${pwdPolicy.RequireNumbers}`, 'green');
        log(`      - Requer símbolo: ${pwdPolicy.RequireSymbols}`, 'green');
      }
      
      // Verificar MFA
      log(`   ${pool.MfaConfiguration === 'OFF' ? '⚠️' : '✅'}  MFA: ${pool.MfaConfiguration}`, 
          pool.MfaConfiguration === 'OFF' ? 'yellow' : 'green');
      
      // Verificar configuração de email
      if (pool.EmailConfiguration) {
        log(`   ✅ Email configurado: ${pool.EmailConfiguration.EmailSendingAccount}`, 'green');
      }
    }
    
    // Teste 2: Client App existe e está configurado
    log('\n📱 Teste 2: Validar Client App', 'blue');
    
    const clientCommand = new DescribeUserPoolClientCommand({
      UserPoolId: USER_POOL_ID,
      ClientId: CLIENT_ID
    });
    
    const clientResponse = await client.send(clientCommand);
    const appClient = clientResponse.UserPoolClient;
    
    if (!appClient) {
      log('   ❌ Client App não encontrado', 'red');
      allTestsPassed = false;
    } else {
      log(`   ✅ Client App encontrado: ${appClient.ClientName}`, 'green');
      log(`   ✅ Client ID: ${appClient.ClientId}`, 'green');
      
      // Verificar fluxos OAuth
      if (appClient.AllowedOAuthFlows && appClient.AllowedOAuthFlows.length > 0) {
        log(`   ✅ OAuth Flows: ${appClient.AllowedOAuthFlows.join(', ')}`, 'green');
      }
      
      // Verificar fluxos de autenticação explícitos
      if (appClient.ExplicitAuthFlows && appClient.ExplicitAuthFlows.length > 0) {
        log(`   ✅ Auth Flows: ${appClient.ExplicitAuthFlows.join(', ')}`, 'green');
      } else {
        log(`   ⚠️  Nenhum Explicit Auth Flow configurado`, 'yellow');
        log(`      Para USER_PASSWORD_AUTH, pode ser necessário habilitar via CDK`, 'yellow');
      }
      
      // Verificar token refresh
      if (appClient.RefreshTokenValidity) {
        log(`   ✅ Token Refresh válido por: ${appClient.RefreshTokenValidity} dias`, 'green');
      }
    }
    
    // Teste 3: Listar usuários
    log('\n👥 Teste 3: Verificar Usuários', 'blue');
    
    const usersCommand = new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Limit: 10
    });
    
    const usersResponse = await client.send(usersCommand);
    const users = usersResponse.Users || [];
    
    if (users.length === 0) {
      log('   ⚠️  Nenhum usuário encontrado', 'yellow');
      log('   💡 Dica: Crie um usuário de teste ou faça sign up no frontend', 'yellow');
    } else {
      log(`   ✅ ${users.length} usuário(s) encontrado(s):`, 'green');
      
      users.forEach((user, index) => {
        const email = user.Attributes?.find(attr => attr.Name === 'email')?.Value;
        const emailVerified = user.Attributes?.find(attr => attr.Name === 'email_verified')?.Value;
        
        log(`\n   Usuário ${index + 1}:`, 'cyan');
        log(`      Username: ${user.Username}`, 'green');
        log(`      Email: ${email}`, 'green');
        log(`      Email verificado: ${emailVerified}`, 'green');
        log(`      Status: ${user.UserStatus}`, 'green');
        log(`      Habilitado: ${user.Enabled}`, 'green');
        log(`      Criado em: ${user.UserCreateDate}`, 'green');
        log(`      Última modificação: ${user.UserLastModifiedDate}`, 'green');
        
        if (user.UserStatus !== 'CONFIRMED') {
          log(`      ⚠️  Usuário não confirmado! Status: ${user.UserStatus}`, 'yellow');
          allTestsPassed = false;
        }
        
        if (emailVerified !== 'true') {
          log(`      ⚠️  Email não verificado!`, 'yellow');
        }
      });
    }
    
    // Teste 4: Validar variáveis de ambiente do frontend
    log('\n🔧 Teste 4: Validar Configuração do Frontend', 'blue');
    
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, 'frontend', '.env.local');
    
    if (!fs.existsSync(envPath)) {
      log('   ❌ Arquivo .env.local não encontrado!', 'red');
      log(`   Esperado em: ${envPath}`, 'yellow');
      allTestsPassed = false;
    } else {
      log('   ✅ Arquivo .env.local existe', 'green');
      
      const envContent = fs.readFileSync(envPath, 'utf8');
      const requiredVars = [
        'NEXT_PUBLIC_COGNITO_USER_POOL_ID',
        'NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID',
        'NEXT_PUBLIC_AMPLIFY_REGION',
        'NEXT_PUBLIC_API_URL'
      ];
      
      requiredVars.forEach(varName => {
        const regex = new RegExp(`${varName}=(.+)`);
        const match = envContent.match(regex);
        
        if (!match) {
          log(`   ❌ Variável ${varName} não encontrada`, 'red');
          allTestsPassed = false;
        } else {
          const value = match[1].trim();
          if (value) {
            log(`   ✅ ${varName} configurado`, 'green');
            
            // Validar valores específicos
            if (varName === 'NEXT_PUBLIC_COGNITO_USER_POOL_ID' && value !== USER_POOL_ID) {
              log(`      ⚠️  Valor diferente do esperado!`, 'yellow');
              log(`      Esperado: ${USER_POOL_ID}`, 'yellow');
              log(`      Atual: ${value}`, 'yellow');
            }
            
            if (varName === 'NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID' && value !== CLIENT_ID) {
              log(`      ⚠️  Valor diferente do esperado!`, 'yellow');
              log(`      Esperado: ${CLIENT_ID}`, 'yellow');
              log(`      Atual: ${value}`, 'yellow');
            }
          } else {
            log(`   ⚠️  ${varName} está vazio`, 'yellow');
          }
        }
      });
    }
    
    // Resumo Final
    log('\n' + '='.repeat(70), 'cyan');
    log('📊 RESUMO DA VALIDAÇÃO', 'cyan');
    log('='.repeat(70), 'cyan');
    
    if (allTestsPassed && users.length > 0) {
      log('\n✅ TODOS OS TESTES PASSARAM!', 'green');
      log('\n🎉 Cognito está configurado corretamente e pronto para uso!', 'green');
      
      log('\n📋 Próximos passos:', 'cyan');
      log('   1. Iniciar servidores:', 'yellow');
      log('      npm run dev', 'cyan');
      log('   2. Acessar frontend:', 'yellow');
      log('      http://localhost:3000/login', 'cyan');
      log('   3. Fazer login com:', 'yellow');
      if (users.length > 0) {
        const email = users[0].Attributes?.find(attr => attr.Name === 'email')?.Value;
        log(`      Email: ${email}`, 'cyan');
        log(`      Senha: [sua senha]`, 'cyan');
      }
      log('   4. Verificar token no DevTools Network tab', 'yellow');
      
    } else {
      log('\n⚠️  ALGUNS TESTES FALHARAM', 'yellow');
      log('\n📋 Ações necessárias:', 'yellow');
      
      if (users.length === 0) {
        log('   • Criar usuário de teste (Sign Up no frontend)', 'yellow');
      }
      
      users.forEach(user => {
        if (user.UserStatus !== 'CONFIRMED') {
          log(`   • Confirmar usuário ${user.Username}`, 'yellow');
        }
      });
      
      log('\n💡 Comandos úteis:', 'cyan');
      log('   # Resetar senha de usuário:', 'yellow');
      log(`   aws cognito-idp admin-set-user-password \\`, 'cyan');
      log(`     --user-pool-id ${USER_POOL_ID} \\`, 'cyan');
      log(`     --username EMAIL@example.com \\`, 'cyan');
      log(`     --password "NovaSenha123!" \\`, 'cyan');
      log(`     --permanent \\`, 'cyan');
      log(`     --region ${REGION}`, 'cyan');
    }
    
  } catch (error) {
    log('\n❌ ERRO NA VALIDAÇÃO:', 'red');
    log(`   ${error.name}: ${error.message}`, 'red');
    
    if (error.name === 'ResourceNotFoundException') {
      log('\n   User Pool ou Client não encontrado!', 'red');
      log('   Verifique se o deploy do CDK foi realizado corretamente.', 'yellow');
    } else if (error.name === 'AccessDeniedException') {
      log('\n   Sem permissão para acessar o Cognito!', 'red');
      log('   Verifique suas credenciais AWS.', 'yellow');
    }
    
    allTestsPassed = false;
  }
  
  process.exit(allTestsPassed ? 0 : 1);
}

// Verificar dependências
try {
  require.resolve('@aws-sdk/client-cognito-identity-provider');
} catch (e) {
  log('\n❌ ERRO: Dependência não instalada', 'red');
  log('\nExecute:', 'yellow');
  log('   npm install @aws-sdk/client-cognito-identity-provider', 'cyan');
  process.exit(1);
}

validateCognito();
