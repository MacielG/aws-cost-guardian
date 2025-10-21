const amplifyConfig = {
	Auth: {
		region: process.env.NEXT_PUBLIC_AMPLIFY_REGION || 'us-east-1',
		userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || undefined,
		userPoolWebClientId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID || undefined,
		mandatorySignIn: false,
	},
};

export default amplifyConfig;
