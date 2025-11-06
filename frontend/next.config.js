/** @type {import('next').NextConfig} */

// Carrega as variáveis de ambiente do .env.local para o processo do Next.js
require('dotenv').config({ path: './.env.local' });

const { withAmplifyAdapter } = require('@aws-amplify/adapter-nextjs');

const nextConfig = {
  // Configurações do Next.js
};

module.exports = withAmplifyAdapter(nextConfig);