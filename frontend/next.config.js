// Carrega as variáveis de ambiente
require('dotenv').config({ path: './.env.local' });

// Importa o adapter oficial (CommonJS)
const { withAmplifyAdapter } = require('@aws-amplify/adapter-nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // ...outras configurações do Next.js podem estar aqui
};

// Envolve a configuração com o adapter
module.exports = withAmplifyAdapter(nextConfig);