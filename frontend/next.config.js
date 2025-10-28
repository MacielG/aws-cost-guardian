// Carrega o .env.production se ele existir (no build do Amplify)
require('dotenv').config({ path: './.env.production' });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_AWS_REGION: process.env.NEXT_PUBLIC_AWS_REGION,
    NEXT_PUBLIC_AMPLIFY_REGION: process.env.NEXT_PUBLIC_AMPLIFY_REGION,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_COGNITO_USER_POOL_ID: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
    NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID,
    NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID: process.env.NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID,
    NEXT_PUBLIC_CFN_TEMPLATE_URL: process.env.NEXT_PUBLIC_CFN_TEMPLATE_URL,
  },
  images: {
    domains: ['aws.amazon.com'],
  },
};

module.exports = nextConfig;