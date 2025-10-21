'use client';

import { Amplify } from 'aws-amplify';
import amplifyConfig from './amplify-config';

// Configura Amplify somente no lado do cliente
if (typeof window !== 'undefined') {
  Amplify.configure(amplifyConfig as any, { ssr: true });
}