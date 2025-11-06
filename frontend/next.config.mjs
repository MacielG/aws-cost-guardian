/** @type {import('next').NextConfig} */

// Carrega as variáveis de ambiente do .env.local para o processo do Next.js
import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });

import { withAmplifyAdapter } from '@aws-amplify/adapter-nextjs';

const nextConfig = {
  // Configurações do Next.js
};

export default withAmplifyAdapter(nextConfig);