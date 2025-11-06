// Carrega as variáveis de ambiente do .env.local para o processo do Next.js
require('dotenv').config({ path: './.env.local' });

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Suas outras configurações do Next.js aqui...
};

module.exports = nextConfig;
