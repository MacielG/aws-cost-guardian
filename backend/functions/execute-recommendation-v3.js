import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { EC2Client, StopInstancesCommand, DeleteVolumeCommand } from '@aws-sdk/client-ec2';
import { RDSClient, StopDBInstanceCommand } from '@aws-sdk/client-rds';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(ddbClient);
const sts = new STSClient({});

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
