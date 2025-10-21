import { Amplify } from 'aws-amplify';
import outputs from '../../amplify_outputs.json'; // Gerado pelo Amplify CLI

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: outputs.cognitoUserPoolId,
      userPoolClientId: outputs.cognitoUserPoolClientId,
      identityPoolId: outputs.cognitoIdentityPoolId,
    },
  },
  Storage: {
    S3: {
      region: outputs.awsRegion,
      bucket: outputs.storageBucketName,
    },
  },
  API: {
    GraphQL: {
      endpoint: outputs.apiUrl,
    },
  },
});