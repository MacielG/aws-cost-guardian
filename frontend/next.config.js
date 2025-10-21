/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_AMPLIFY_REGION: process.env.NEXT_PUBLIC_AMPLIFY_REGION,
  },
  images: {
    domains: ['aws.amazon.com'],
  },
};

module.exports = nextConfig;