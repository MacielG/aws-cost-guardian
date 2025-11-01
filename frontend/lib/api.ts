import { fetchAuthSession } from 'aws-amplify/auth';

// URL base da API (API Gateway). Erro fatal se não definido em ambiente local/produção.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

if (!API_BASE_URL) {
    // Aviso para o desenvolvedor — em produção isso deveria estar sempre definido
    console.error('ERRO FATAL: NEXT_PUBLIC_API_URL não está definido. Configure .env.local');
}

/**
 * Existia anteriormente um `apiFetch` usado em várias partes do código.
 * Vamos manter essa função por compatibilidade e também exportar `apiClient` (recomendado).
 */
export async function apiFetch(endpoint: string, options: RequestInit = {}, skipAuth = false) {
    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${API_BASE_URL}${path}`;

    let token = '';

    if (!skipAuth) {
        try {
            const session = await fetchAuthSession();
            const idToken = session.tokens?.idToken;
            if (idToken) token = idToken.toString();
        } catch (err: any) {
            console.warn('Não foi possível obter sessão de autenticação:', err?.message || err);
        }
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
    };

    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'same-origin',
    });

    if (!response.ok) {
        const text = await response.text().catch(() => undefined);
        const message = text || response.statusText || `Erro ${response.status}`;
        if (response.status === 401) {
            // limpar estado local para forçar novo login
            if (typeof window !== 'undefined') {
                try {
                    localStorage.clear();
                    sessionStorage.clear();
                } catch {}
            }
            throw new Error('Sessão expirada. Por favor, faça login novamente.');
        }
        throw new Error(message);
    }

    if (response.status === 204) return null;

    return response.json();
}

/**
 * apiClient: alternativa recomendada que segue a implementação pedida pelo time.
 * Ela tenta obter a sessão do Cognito via `fetchAuthSession` e injeta o token
 * no header Authorization. Além disso dá mensagens de erro melhores.
 */
const apiClientInternal = async function apiClient<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (!API_BASE_URL) {
        console.error("ERRO FATAL: NEXT_PUBLIC_API_URL não está definido no .env.local");
    }

    let token: string | undefined;

    try {
        const session = await fetchAuthSession();
        token = session.tokens?.idToken?.toString();
    } catch (error) {
        // Permite chamadas não autenticadas — o backend deve rejeitar se necessário
        console.warn('Não foi possível obter sessão do Cognito. Chamada não autenticada.', error);
    }

    const headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type')) headers.append('Content-Type', 'application/json');
    if (token) headers.append('Authorization', `Bearer ${token}`);

    const config: RequestInit = {
        ...options,
        headers,
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, config);

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = (errorData && (errorData.message || errorData.error)) || `Erro ${response.status}: ${response.statusText}`;
        throw new Error(errorMessage);
    }

    if (response.status === 204) return null as unknown as T;
    return response.json();
};

// Attach convenience methods: get/post/put/delete similar to axios style used in the codebase
const apiClient: any = apiClientInternal;

apiClient.get = (endpoint: string, options: RequestInit = {}) => apiClientInternal(endpoint, { ...options, method: 'GET' });
apiClient.post = (endpoint: string, body?: any, options: RequestInit = {}) => apiClientInternal(endpoint, { ...options, method: 'POST', body: body ? JSON.stringify(body) : undefined });
apiClient.put = (endpoint: string, body?: any, options: RequestInit = {}) => apiClientInternal(endpoint, { ...options, method: 'PUT', body: body ? JSON.stringify(body) : undefined });
apiClient.delete = (endpoint: string, options: RequestInit = {}) => apiClientInternal(endpoint, { ...options, method: 'DELETE' });

export { apiClient, apiClientInternal as apiClientFn };
export default apiFetch;
