// Script de Debug - Executar no Console do Navegador (F12)
// Colar este código após fazer login em https://awscostguardian.com

(async function debugAuth() {
  console.log('🔍 AWS Cost Guardian - Debug de Autenticação\n');
  
  try {
    // Importar fetchAuthSession do Amplify
    const { fetchAuthSession } = await import('aws-amplify/auth');
    
    console.log('1️⃣ Obtendo sessão...');
    const session = await fetchAuthSession({ forceRefresh: false });
    
    if (!session || !session.tokens) {
      console.error('❌ Sessão não encontrada. Faça login primeiro.');
      return;
    }
    
    console.log('✅ Sessão obtida\n');
    
    // ID Token
    console.log('📄 ID TOKEN:');
    if (session.tokens.idToken) {
      const idPayload = session.tokens.idToken.payload;
      console.log('  - Sub:', idPayload.sub);
      console.log('  - Email:', idPayload.email);
      console.log('  - Token Use:', idPayload.token_use);
      console.log('  - Groups:', idPayload['cognito:groups'] || '(não presente)');
      console.log('  - Exp:', new Date(idPayload.exp * 1000).toLocaleString());
    } else {
      console.log('  ❌ Não disponível');
    }
    
    console.log('');
    
    // Access Token
    console.log('🔑 ACCESS TOKEN:');
    if (session.tokens.accessToken) {
      const accessPayload = session.tokens.accessToken.payload;
      console.log('  - Sub:', accessPayload.sub);
      console.log('  - Token Use:', accessPayload.token_use);
      console.log('  - Groups:', accessPayload['cognito:groups'] || '(não presente)');
      console.log('  - Scope:', accessPayload.scope);
      console.log('  - Exp:', new Date(accessPayload.exp * 1000).toLocaleString());
      
      // Verificar se tem grupos
      const hasGroups = accessPayload['cognito:groups'];
      const isAdmin = hasGroups && accessPayload['cognito:groups'].includes('Admins');
      
      console.log('');
      if (isAdmin) {
        console.log('✅ ADMIN DETECTADO! Grupos:', accessPayload['cognito:groups']);
      } else if (hasGroups) {
        console.log('⚠️  Usuário tem grupos mas não é Admin:', accessPayload['cognito:groups']);
      } else {
        console.log('❌ PROBLEMA: cognito:groups NÃO está no Access Token!');
        console.log('   Ação necessária:');
        console.log('   1. Configure "Group Claims" no Cognito App Client');
        console.log('   2. Faça logout e login novamente');
      }
    } else {
      console.log('  ❌ Não disponível');
    }
    
    console.log('');
    console.log('🔗 Teste de chamada API:');
    
    // Testar chamada real
    try {
      const token = session.tokens.accessToken?.toString();
      const response = await fetch('https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod/admin/metrics', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log('  Status:', response.status, response.statusText);
      
      if (response.ok) {
        console.log('  ✅ API respondeu com sucesso!');
        const data = await response.json();
        console.log('  Dados:', data);
      } else if (response.status === 401) {
        console.log('  ❌ 401 Unauthorized');
        console.log('  Possíveis causas:');
        console.log('    - Token inválido ou expirado');
        console.log('    - cognito:groups não presente no token');
        const errorData = await response.text();
        console.log('  Resposta:', errorData);
      } else if (response.status === 403) {
        console.log('  ❌ 403 Forbidden');
        console.log('  Token válido mas usuário não é admin');
        console.log('  Verifique se está no grupo "Admins" no Cognito');
      } else {
        console.log('  ⚠️  Status inesperado');
        const errorData = await response.text();
        console.log('  Resposta:', errorData);
      }
    } catch (error) {
      console.error('  ❌ Erro na chamada:', error.message);
    }
    
    console.log('');
    console.log('📋 RESUMO:');
    console.log('='.repeat(50));
    
    const accessPayload = session.tokens.accessToken?.payload;
    const groups = accessPayload?.['cognito:groups'];
    const isAdmin = groups && groups.includes('Admins');
    
    if (isAdmin) {
      console.log('✅ Tudo OK! Usuário é admin.');
      console.log('   Se ainda recebe 401, aguarde deploy do frontend.');
    } else if (groups) {
      console.log('⚠️  Usuário autenticado mas não é admin.');
      console.log('   Grupos:', groups);
    } else {
      console.log('❌ cognito:groups ausente no Access Token!');
      console.log('');
      console.log('🔧 SOLUÇÃO:');
      console.log('1. Configure Group Claims no Cognito:');
      console.log('   Console > Cognito > User Pool > App Client');
      console.log('   > Token configuration > Include group claims');
      console.log('');
      console.log('2. Faça logout e login:');
      console.log('   localStorage.clear();');
      console.log('   sessionStorage.clear();');
      console.log('   location.reload();');
    }
    
    console.log('='.repeat(50));
    
    // Decodificar tokens para verificação em jwt.io
    console.log('');
    console.log('🔗 Para verificar no jwt.io:');
    console.log('Access Token (primeiros 50 chars):', session.tokens.accessToken?.toString().substring(0, 50) + '...');
    console.log('');
    console.log('Copie o token completo com:');
    console.log('copy(session.tokens.accessToken.toString())');
    
  } catch (error) {
    console.error('❌ Erro ao debug:', error);
    console.log('');
    console.log('Certifique-se de:');
    console.log('1. Estar em https://awscostguardian.com');
    console.log('2. Estar logado');
    console.log('3. Ter feito login recentemente');
  }
})();

// Para copiar o Access Token para jwt.io:
// copy((await fetchAuthSession()).tokens.accessToken.toString())
