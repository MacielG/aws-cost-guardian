// Carrega as variáveis de ambiente do .env.local para o processo do Next.js
require('dotenv').config({ path: './.env.local' });

const withAmplifyAdapter = require('@aws-amplify/adapter-nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Suas outras configurações do Next.js aqui...
};

module.exports = withAmplifyAdapter(nextConfig);
