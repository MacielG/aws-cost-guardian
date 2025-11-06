// Carrega as variáveis de ambiente do .env.local para o processo do Next.js
require('dotenv').config({ path: './.env.local' });

// CORREÇÃO AQUI: Importe 'withAmplify' em vez de 'withAmplifyAdapter'
const { withAmplify } = require('@aws-amplify/adapter-nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Suas outras configurações do Next.js aqui...
};

// CORREÇÃO AQUI: Use 'withAmplify'
module.exports = withAmplify(nextConfig);
