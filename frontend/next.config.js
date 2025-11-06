/** @type {import('next').NextConfig} */

// Carrega as variáveis de ambiente do .env.local para o processo do Next.js
require('dotenv').config({ path: './.env.local' });

const nextConfig = {
  output: 'standalone',
};

module.exports = nextConfig;