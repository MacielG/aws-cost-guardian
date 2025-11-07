import { fetchAuthSession } from 'aws-amplify/auth';
// utilitário para juntar URLs de forma segura
// usa CommonJS module criado em frontend/lib/url.js
const { joinUrl } = require('./url');

// URL base da API (API Gateway). Em dev o `.env.local` é gerado automaticamente,
// mas ainda assim suportamos um fallback seguro para evitar chamadas para
// caminhos inválidos. Nunca exponha tokens nos logs.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

function resolveApiBaseUrl(): string {
    if (API_BASE_URL) return API_BASE_URL;
    // Em runtime no browser, caia para o origin da página para chamadas relativas
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
        console.warn('WARNING: NEXT_PUBLIC_API_URL não definido — usando window.location.origin como fallback');
        return window.location.origin;
    }
    // Em SSR/ambiente sem URL conhecida, retorna string vazia — chamador deve detectar
    console.error('NEXT_PUBLIC_API_URL não está definido e não há fallback disponível (SSR). Configure .env.local');
    return '';
}

function truncate(s: string | undefined, n = 1000) {
    if (!s) return '';
    return s.length > n ? `${s.slice(0, n)}... (truncated ${s.length - n} chars)` : s;
}

async function readResponseBody(response: Response) {
    // Tenta JSON primeiro, se falhar lê como texto.
    try {
        const data = await response.clone().json();
        return { json: data, text: undefined };
    } catch (_) {
        try {
            const txt = await response.clone().text();
            return { json: undefined, text: txt };
        } catch (e) {
            return { json: undefined, text: undefined };
        }
    }
}

/**
 * Existia anteriormente um `apiFetch` usado em várias partes do código.
 * Vamos manter essa função por compatibilidade e também exportar `apiClient` (recomendado).
 */
export async function apiFetch(endpoint: string, options: RequestInit = {}, skipAuth = false) {
    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = joinUrl(API_BASE_URL, path);

    let token = '';

    if (!skipAuth) {
        try {
            const session = await fetchAuthSession();
            const accessToken = session.tokens?.accessToken;
            if (accessToken) token = accessToken.toString();
        } catch (err: any) {
            console.warn('Não foi possível obter sessão de autenticação:', err?.message || err);
        }
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
    };

    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Decide credentials mode dynamically. When talking to an API on a different
    // origin, using `credentials: 'include'` requires the server to return a
    // specific Access-Control-Allow-Origin header (not '*') and
    // Access-Control-Allow-Credentials: true. In dev this often causes CORS
    // failures. Allow overriding via NEXT_PUBLIC_API_CREDENTIALS (include|omit).
    const envCreds = process.env.NEXT_PUBLIC_API_CREDENTIALS;
    let credentialsMode: RequestCredentials = 'include';
    try {
        if (envCreds === 'include' || envCreds === 'omit' || envCreds === 'same-origin') {
            credentialsMode = envCreds as RequestCredentials;
        } else if (typeof window !== 'undefined' && API_BASE_URL) {
            const apiOrigin = new URL(url).origin;
            const pageOrigin = window.location.origin;
            // If origins differ, default to 'omit' to avoid CORS credential errors
            // unless the env explicitly asks for include.
            credentialsMode = apiOrigin === pageOrigin ? 'include' : 'omit';
        }
    } catch (e) {
        // Fallback: keep include
        credentialsMode = 'include';
    }

    let response: Response;
    try {
        response = await fetch(url, {
            ...options,
            headers,
            credentials: credentialsMode,
        });
    } catch (err: any) {
        // Falha de rede / DNS / CORS preflight que impede a requisição
        const msg = err?.message || String(err) || 'Erro de rede ao chamar API';
        console.error('Network/API fetch error:', msg);
        throw new Error(`Erro de rede: ${msg}`);
    }

    if (!response.ok) {
        const body = await readResponseBody(response);
        const bodyMsg = body.json?.message || body.json?.error || body.text;
        const shortBody = truncate(String(bodyMsg || ''));

        if (response.status === 401) {
            if (typeof window !== 'undefined') {
                try {
                    localStorage.clear();
                    sessionStorage.clear();
                } catch {}
            }
            throw new Error('Sessão expirada. Por favor, faça login novamente.');
        }

        const publicMessage = bodyMsg || response.statusText || `Erro ${response.status}`;
        // Log detalhado no console (útil em dev). Não inclua tokens.
        console.error('API error', {
            status: response.status,
            statusText: response.statusText,
            body: shortBody,
            url,
        });

        throw new Error(`${publicMessage} (status ${response.status})`);
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
    let token: string | undefined;

    try {
        const session = await fetchAuthSession();
        token = session.tokens?.accessToken?.toString();
    } catch (error) {
        // Permite chamadas não autenticadas — o backend deve rejeitar se necessário
        console.warn('Não foi possível obter sessão do Cognito. Chamada não autenticada.', error);
    }

    const headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type')) headers.append('Content-Type', 'application/json');
    if (token) headers.append('Authorization', `Bearer ${token}`);

    // Decide credentials similarly for apiClient
    const envCreds2 = process.env.NEXT_PUBLIC_API_CREDENTIALS;
    let credentialsMode2: RequestCredentials = 'include';
    try {
        if (envCreds2 === 'include' || envCreds2 === 'omit' || envCreds2 === 'same-origin') {
            credentialsMode2 = envCreds2 as RequestCredentials;
        } else if (typeof window !== 'undefined' && API_BASE_URL) {
            const apiOrigin = new URL(joinUrl(API_BASE_URL, endpoint)).origin;
            const pageOrigin = window.location.origin;
            credentialsMode2 = apiOrigin === pageOrigin ? 'include' : 'omit';
        }
    } catch (e) {
        credentialsMode2 = 'include';
    }

    const config: RequestInit = {
        ...options,
        headers,
        credentials: credentialsMode2,
    };

    const baseUrl = resolveApiBaseUrl();
    if (!baseUrl) throw new Error('Configuração inválida: NEXT_PUBLIC_API_URL não configurada');

    let response: Response;
    try {
        response = await fetch(joinUrl(baseUrl, endpoint), config);
    } catch (err: any) {
        const msg = err?.message || String(err) || 'Erro de rede ao chamar API';
        console.error('Network/API fetch error (apiClient):', msg);
        throw new Error(`Erro de rede: ${msg}`);
    }

    if (!response.ok) {
        const body = await readResponseBody(response);
        const bodyMsg = body.json?.message || body.json?.error || body.text;
        const shortBody = truncate(String(bodyMsg || ''));

        // Log detalhado para debugging (não exponha tokens nos logs)
        console.error('API client error', {
            status: response.status,
            statusText: response.statusText,
            body: shortBody,
            endpoint,
        });

        if (response.status === 401) {
            if (typeof window !== 'undefined') {
                try {
                    localStorage.clear();
                    sessionStorage.clear();
                } catch {}
            }
            throw new Error('Sessão expirada. Por favor, faça login novamente.');
        }

        const publicMessage = bodyMsg || response.statusText || `Erro ${response.status}`;
        throw new Error(`${publicMessage} (status ${response.status})`);
    }

    if (response.status === 204) return null as unknown as T;
    // Se a resposta não for JSON válido, isso irá propagar - chamado deve estar preparado
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
