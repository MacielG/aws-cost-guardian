'use client';

import { Amplify } from 'aws-amplify';
import amplifyConfig from '../amplify-config';

// Configura o Amplify uma vez no lado do cliente
Amplify.configure(amplifyConfig, { ssr: true });

export default function ConfigureAmplifyClientSide() {
  // Este componente não precisa renderizar nada,
  // ele apenas executa o código de configuração quando montado no cliente.
  return null;
}
