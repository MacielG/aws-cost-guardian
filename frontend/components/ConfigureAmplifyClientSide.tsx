'use client';

import { Amplify } from 'aws-amplify';
import amplifyConfig from '@/amplify-config'; // Importa a configuração já validada.

/**
 * Este componente cliente é responsável por configurar o Amplify no lado do navegador.
 * Ele importa a configuração que já foi validada em `amplify-config.ts`.
 * O `ssr: true` é importante para que o Amplify saiba lidar com a autenticação
 * em ambientes de renderização no servidor (SSR) e no cliente.
 */
Amplify.configure(amplifyConfig, { ssr: true });

export default function ConfigureAmplifyClientSide() {
  // Este componente não renderiza nada, ele apenas executa a lógica de configuração uma vez.
  return null;
}