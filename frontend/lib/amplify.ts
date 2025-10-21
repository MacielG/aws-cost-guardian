import { Amplify } from 'aws-amplify';
import outputs from '../amplify_outputs.json'; // Gerado pelo Amplify CLI

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: outputs.cognito_user_pool_id,
      userPoolClientId: outputs.cognito_user_pool_client_id,
      identityPoolId: outputs.cognito_identity_pool_id,
    },
  },
  Storage: {
    S3: {
      region: outputs.aws_region,
      bucket: outputs.storage_bucket_name,
    },
  },
  API: {
    GraphQL: {
      endpoint: outputs.api_url,
    },
  },
});