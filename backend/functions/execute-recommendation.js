// backend/functions/execute-recommendation.js
const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;

// Helper para assumir a role do cliente
async function getAssumedClients(roleArn, region = 'us-east-1') {
  const sts = new AWS.STS();
  try {
    const assumedRole = await sts.assumeRole({
      RoleArn: roleArn,
      RoleSessionName: 'GuardianAdvisorExecution',
      DurationSeconds: 900,
    }).promise();

    const credentials = {
      accessKeyId: assumedRole.Credentials.AccessKeyId,
      secretAccessKey: assumedRole.Credentials.SecretAccessKey,
      sessionToken: assumedRole.Credentials.SessionToken,
    };
    
    return {
      ec2: new AWS.EC2({ ...credentials, region }),
      rds: new AWS.RDS({ ...credentials, region }),
      // Adicione outros serviços conforme necessário
    };
  } catch (err) {
    console.error(`Falha ao assumir role ${roleArn}:`, err);
    throw new Error(`STS AssumeRole failed: ${err.message}`);
  }
}

exports.handler = async (event) => {
  try {
    const customerId = event.requestContext.authorizer.claims.sub;
    const recommendationId = event.pathParameters.recommendationId;
    const recSk = `REC#${recommendationId.replace('REC#', '')}`;

    // 1. Obter recomendação e config do cliente
    const rec = (await dynamoDb.get({ 
      TableName: DYNAMODB_TABLE, 
      Key: { id: customerId, sk: recSk } 
    }).promise()).Item;

    if (!rec) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Recomendação não encontrada' })
      };
    }

    // Verificar se já foi executada
    if (rec.status === 'COMPLETED') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Recomendação já foi executada' })
      };
    }

    const config = (await dynamoDb.get({ 
      TableName: DYNAMODB_TABLE, 
      Key: { id: customerId, sk: 'CONFIG#ONBOARD' } 
    }).promise()).Item;

    if (!config?.roleArn) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Role ARN não configurada' })
      };
    }

    // 2. Assumir a role do cliente
    const clients = await getAssumedClients(config.roleArn);

    // 3. Executar ação com base no tipo
    try {
      let actionResult;

      if (rec.type === 'UNUSED_EBS_VOLUME') {
        const volumeId = rec.details.volumeId;
        actionResult = await clients.ec2.deleteVolume({ 
          VolumeId: volumeId 
        }).promise();
      } else if (rec.type === 'IDLE_INSTANCE') {
        const instanceId = rec.details.instanceId;
        actionResult = await clients.ec2.stopInstances({ 
          InstanceIds: [instanceId] 
        }).promise();
      }
      // Adicione outros tipos de recomendação aqui

      // 4. Marcar como concluído e salvar resultado
      await dynamoDb.update({
        TableName: DYNAMODB_TABLE,
        Key: { id: customerId, sk: recSk },
        UpdateExpression: 'SET #status = :status, executedAt = :now, actionResult = :result',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { 
          ':status': 'COMPLETED',
          ':now': new Date().toISOString(),
          ':result': actionResult
        }
      }).promise();

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Ação executada com sucesso',
          recommendationId: recommendationId,
          executedAt: new Date().toISOString()
        })
      };

    } catch (actionError) {
      console.error('Erro ao executar ação:', actionError);
      
      // Marcar como falha
      await dynamoDb.update({
        TableName: DYNAMODB_TABLE,
        Key: { id: customerId, sk: recSk },
        UpdateExpression: 'SET #status = :status, error = :error, lastAttemptAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { 
          ':status': 'FAILED',
          ':error': actionError.message,
          ':now': new Date().toISOString()
        }
      }).promise();

      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Falha ao executar ação',
          details: actionError.message
        })
      };
    }

  } catch (err) {
    console.error('Erro geral:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Erro interno do servidor' })
    };
  }
};