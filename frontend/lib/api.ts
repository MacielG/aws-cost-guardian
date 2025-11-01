import { fetchAuthSession } from 'aws-amplify/auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

/**
 * Um wrapper de 'fetch' centralizado para todas as chamadas à API do Cost Guardian.
 * Ele automaticamente:
 * 1. Usa a URL correta do API Gateway (de NEXT_PUBLIC_API_URL).
 * 2. Adiciona o token JWT de autenticação do Cognito/Amplify.
 * 3. Trata erros de autenticação e de rede.
 *
 * @param endpoint O caminho da API que você quer chamar (ex: '/api/dashboard/costs').
 * @param options Opções padrão do 'fetch' (como method, body, etc.).
 * @param skipAuth Se true, não adiciona token de autenticação (para endpoints públicos).
 * @returns A resposta da API em JSON.
 */
export async function apiFetch(endpoint: string, options: RequestInit = {}, skipAuth = false) {
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${API_BASE_URL}${path}`;

  let token = '';
  
  // Obter token de autenticação, exceto se skipAuth for true
  if (!skipAuth) {
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken;
      
      if (!idToken) {
        console.warn('Sessão sem token de ID válido');
      } else {
        token = idToken.toString();
      }
    } catch (err: any) {
      console.warn('Não foi possível obter sessão de autenticação:', err?.message || err);
      
      if (err?.name === 'InvalidCharacterError' || err?.message?.includes('token')) {
        if (typeof window !== 'undefined') {
          localStorage.clear();
          sessionStorage.clear();
        }
        throw new Error('Token inválido. Por favor, faça login novamente.');
      }
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'same-origin',
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Falha na API [${response.status}]: ${errorText}`);
      
      if (response.status === 401) {
        if (typeof window !== 'undefined') {
          localStorage.clear();
          sessionStorage.clear();
        }
        throw new Error('Sessão expirada. Por favor, faça login novamente.');
      }
      
      throw new Error(`Erro na API [${response.status}]: ${errorText || response.statusText}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();

  } catch (err) {
    console.error('Erro de rede ou de fetch:', err);
    throw err;
  }
}
