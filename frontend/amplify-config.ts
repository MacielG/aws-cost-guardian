const amplifyConfig = {
  Auth: {
    region: process.env.NEXT_PUBLIC_AMPLIFY_REGION || 'us-east-1',
    userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
    userPoolWebClientId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID,
    mandatorySignIn: false,
  },
  ssr: true,
} as const;

export default amplifyConfig;