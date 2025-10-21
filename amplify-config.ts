rmdir /s /q frontend\.next
import { ResourcesConfig } from 'aws-amplify';

const amplifyConfig: ResourcesConfig = {
	Auth: {
		Cognito: {
			region: process.env.NEXT_PUBLIC_AMPLIFY_REGION || 'us-east-1',
			userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
			userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID,
			loginWith: { oauth: undefined, email: true, phone: false },
		},
	},
};

export default amplifyConfig;
