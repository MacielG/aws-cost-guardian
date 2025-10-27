/**
 * Obtém a URL base da API a partir das variáveis de ambiente.
 * A variável NEXT_PUBLIC_API_URL é injetada no processo de build do Amplify
 * conforme definido em 'infra/lib/cost-guardian-stack.ts'.
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

/**
 * Um wrapper de 'fetch' centralizado para todas as chamadas à API do Cost Guardian.
 * Ele automaticamente:
 * 1. Usa a URL correta do API Gateway (de NEXT_PUBLIC_API_URL).
 * 2. Adiciona 'credentials: "same-origin"' que você estava usando.
 * 3. (Futuramente) Adicionará o token de autenticação do Cognito/Amplify.
 *
 * @param endpoint O caminho da API que você quer chamar (ex: '/api/dashboard/costs').
 * @param options Opções padrão do 'fetch' (como method, body, etc.).
 * @returns A resposta da API em JSON.
 */
export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  // Garante que o endpoint comece com '/'
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  
  // Monta a URL completa
  const url = `${API_BASE_URL}${path}`;

  // Combina headers padrões com os headers da chamada
  const headers = {
    ...options.headers,
    'Content-Type': 'application/json',
    // TODO: Adicionar lógica de autenticação do Amplify aqui
    // const token = (await Auth.currentSession()).getIdToken().getJwtToken();
    // 'Authorization': `Bearer ${token}`
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      // Mantém a opção de credenciais que você estava usando
      credentials: 'same-origin', 
    });

    if (!response.ok) {
      // Tenta ler a mensagem de erro da API
      const errorText = await response.text();
      console.error(`Falha na API [${response.status}]: ${errorText}`);
      throw new Error(`Erro na API [${response.status}]: ${errorText || response.statusText}`);
    }

    // Se a resposta for OK, mas não tiver corpo (ex: 204 No Content)
    if (response.status === 204) {
      return null;
    }

    return response.json();

  } catch (err) {
    console.error('Erro de rede ou de fetch:', err);
    // Propaga o erro para o componente React poder tratar (ex: setLoading(false))
    throw err;
  }
}
