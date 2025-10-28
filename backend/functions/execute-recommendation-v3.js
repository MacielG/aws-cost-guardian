import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { EC2Client, StopInstancesCommand, DeleteVolumeCommand, DescribeReservedInstancesCommand } from '@aws-sdk/client-ec2';
import { RDSClient, StopDBInstanceCommand } from '@aws-sdk/client-rds';
import { PricingClient, GetProductsCommand } from '@aws-sdk/client-pricing';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(ddbClient);
const sts = new STSClient({});
const pricing = new PricingClient({ region: 'us-east-1' });

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;



async function getAssumedCredentials(roleArn, externalId, region = 'us-east-1') {
  const command = new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: `GuardianExec-${Date.now()}`,
    DurationSeconds: 900,
    ExternalId: externalId,
  });

  const response = await sts.send(command);
  const creds = response.Credentials;

  return {
    accessKeyId: creds.AccessKeyId,
    secretAccessKey: creds.SecretAccessKey,
    sessionToken: creds.SessionToken,
  };
}

export const handler = async (event) => {
  console.log('Execute Recommendation Lambda triggered:', JSON.stringify(event));

  try {
    const { userId, recommendationId, recommendation, roleArn, externalId } = event;

    if (!userId || !recommendationId || !recommendation || !roleArn) {
      throw new Error('Missing required parameters');
    }

    // Assumir role do cliente
    const credentials = await getAssumedCredentials(roleArn, externalId);

    let actionResult;
    const region = 'us-east-1'; // TODO: Extrair da recomendação

    // Executar ação baseada no tipo
    switch (recommendation.type) {
      case 'IDLE_INSTANCE': {
        const instanceId = recommendation.details.instanceId;
        const ec2 = new EC2Client({ credentials, region });

        const stopCommand = new StopInstancesCommand({
          InstanceIds: [instanceId],
        });

        actionResult = await ec2.send(stopCommand);
        console.log(`Instância ${instanceId} parada com sucesso`);
        break;
      }

      case 'UNUSED_EBS': {
        const volumeId = recommendation.details.volumeId;
        const ec2 = new EC2Client({ credentials, region });

        const deleteCommand = new DeleteVolumeCommand({
          VolumeId: volumeId,
        });

        actionResult = await ec2.send(deleteCommand);
        console.log(`Volume ${volumeId} deletado com sucesso`);
        break;
      }

      case 'IDLE_RDS': {
        const dbInstanceId = recommendation.details.dbInstanceId;
        const rds = new RDSClient({ credentials, region });

        const stopCommand = new StopDBInstanceCommand({
          DBInstanceIdentifier: dbInstanceId,
        });

        actionResult = await rds.send(stopCommand);
        console.log(`RDS ${dbInstanceId} parado com sucesso`);
        break;
      }

      default:
        throw new Error(`Tipo de recomendação não suportado: ${recommendation.type}`);
    }

    // Calcular economia horária
    let amountPerHour = 0;
    if (recommendation.type === 'IDLE_INSTANCE') {
      const arnParts = recommendation.resourceArn.split(':');
      const actualRegion = arnParts[3];
      const os = recommendation.details.operatingSystem || 'Linux';
      const ec2 = new EC2Client({ credentials, region: actualRegion });
      const isCovered = await isInstanceCoveredByRI(ec2, recommendation.details.instanceType);
      if (!isCovered) {
        const price = await getEc2HourlyPrice(recommendation.details.instanceType, actualRegion, os);
        amountPerHour = price || 0;
      }
    }

    // Registrar economia realizada
    const savingItem = {
      id: userId,
      sk: `SAVING#REC#${recommendationId}`,
      amountPerHour,
      timestamp: new Date().toISOString(),
      recommendationType: recommendation.type,
    };
    await dynamoDb.send(new PutCommand({
      TableName: DYNAMODB_TABLE,
      Item: savingItem,
    }));

    // Atualizar status no DynamoDB
    const updateCommand = new UpdateCommand({
      TableName: DYNAMODB_TABLE,
      Key: {
        id: userId,
        sk: recommendationId,
      },
      UpdateExpression: 'SET #status = :status, executedAt = :executedAt, actionResult = :result',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': 'EXECUTED',
        ':executedAt': new Date().toISOString(),
        ':result': JSON.stringify(actionResult),
      },
    });

    await dynamoDb.send(updateCommand);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Recomendação executada com sucesso',
        recommendationId,
      }),
    };

  } catch (error) {
    console.error('Erro ao executar recomendação:', error);

    // Tentar atualizar status para FAILED
    try {
      if (event.userId && event.recommendationId) {
        const updateCommand = new UpdateCommand({
          TableName: DYNAMODB_TABLE,
          Key: {
            id: event.userId,
            sk: event.recommendationId,
          },
          UpdateExpression: 'SET #status = :status, error = :error, lastAttemptAt = :now',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'FAILED',
            ':error': error.message,
            ':now': new Date().toISOString(),
          },
        });

        await dynamoDb.send(updateCommand);
      }
    } catch (updateError) {
      console.error('Erro ao atualizar status de falha:', updateError);
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Erro ao executar recomendação',
        message: error.message,
      }),
    };
  }
};

async function getEc2HourlyPrice(instanceType, regionCode, operatingSystem) {
  const regionNameMap = {
    'us-east-1': 'US East (N. Virginia)',
    'us-east-2': 'US East (Ohio)',
    'us-west-2': 'US West (Oregon)',
    'eu-west-1': 'EU (Ireland)',
    // Add more regions as needed
  };
  const location = regionNameMap[regionCode] || regionCode; // Fallback to regionCode if not mapped

  const filters = [
    { Type: 'TERM_MATCH', Field: 'instanceType', Value: instanceType },
    { Type: 'TERM_MATCH', Field: 'location', Value: location },
    { Type: 'TERM_MATCH', Field: 'operatingSystem', Value: operatingSystem },
    { Type: 'TERM_MATCH', Field: 'tenancy', Value: 'Shared' }
  ];

  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const command = new GetProductsCommand({
        ServiceCode: 'AmazonEC2',
        Filters: filters,
        MaxResults: 100
      });
      const resp = await pricing.send(command);

      const priceList = resp.PriceList || [];
      for (const p of priceList) {
        try {
          const prod = typeof p === 'string' ? JSON.parse(p) : p;
          const onDemandTerms = prod.terms && prod.terms.OnDemand;
          if (!onDemandTerms) continue;
          for (const termKey of Object.keys(onDemandTerms)) {
            const term = onDemandTerms[termKey];
            const priceDimensions = term.priceDimensions || {};
            for (const pdKey of Object.keys(priceDimensions)) {
              const pd = priceDimensions[pdKey];
              const pricePerUnit = pd.pricePerUnit && pd.pricePerUnit.USD;
              if (pricePerUnit) {
                return parseFloat(pricePerUnit);
              }
            }
          }
        } catch (e) {
          console.warn('Error parsing pricing data:', e);
        }
      }
      return null; // No price found
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${attempt + 1} failed for getEc2HourlyPrice:`, error);
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  console.error('All attempts failed for getEc2HourlyPrice:', lastError);
  return null;
}

async function isInstanceCoveredByRI(ec2Client, instanceType) {
  try {
    const command = new DescribeReservedInstancesCommand({
      Filters: [
        { Name: 'instance-type', Values: [instanceType] },
        { Name: 'state', Values: ['active'] }
      ]
    });
    const resp = await ec2Client.send(command);
    // If there are active RIs for this type, assume it's covered
    return (resp.ReservedInstances || []).length > 0;
  } catch (err) {
    console.warn('Error checking RI coverage:', err);
    return false;
  }
}
