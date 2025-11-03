import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// utilitário para juntar URLs de forma segura (CommonJS module)
const { joinUrl } = require('./url');

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Permite override do locale, default 'en-US' se não especificado
export function formatCurrency(value: number, locale = 'en-US'): string {
  const currency = locale === 'pt-BR' ? 'BRL' : 'USD'; // Define a moeda baseada no locale
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
    }).format(value);
  } catch (e) {
    console.error("Error formatting currency:", e);
    // Fallback simples
    return `${currency === 'BRL' ? 'R$' : '$'}${value.toFixed(2)}`;
  }
}

// Se você tiver uma função formatDate, aplique lógica similar se necessário
export function formatDate(dateString: string | Date, locale = 'en-US'): string {
  try {
    const date = new Date(dateString as any);
    // Defensive: if invalid date, return empty/fallback
    if (isNaN(date.getTime())) {
      // don't throw — return original string so callers can handle
      return String(dateString || '');
    }
    // Exemplo: Formato DD/MM/YYYY para pt-BR, MM/DD/YYYY para en-US
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  } catch(e) {
    console.error("Error formatting date:", e);
    return String(dateString); // Fallback
  }
}

export const sanitizeHtml = (html: string): string => {
  return html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

// Opções padrão para chamadas de API
const defaultOptions = {
  headers: {
    'Content-Type': 'application/json',
  },
  credentials: 'include' as RequestCredentials,
};

// Função para inicializar o Stripe
export async function initializeStripe() {
  if (!window.Stripe) {
    throw new Error('Stripe.js não está carregado');
  }

  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!key) {
    throw new Error('STRIPE_PUBLISHABLE_KEY não está definida');
  }

  return window.Stripe(key);
}

declare global {
  interface Window {
    Stripe: (key: string) => any;
  }
}

// Função helper para chamadas de API
export async function api<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) {
    throw new Error('API_URL não configurada');
  }

  // Use joinUrl para evitar '//' duplicados ao concatenar base + endpoint
  const url = joinUrl(apiUrl, endpoint);
  const response = await fetch(url, {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Erro na chamada da API');
  }

  return response.json();
}