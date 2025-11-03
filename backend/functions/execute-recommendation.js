const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');
const { EC2Client, DeleteVolumeCommand, StopInstancesCommand } = require('@aws-sdk/client-ec2');
const { RDSClient, StopDBInstanceCommand } = require('@aws-sdk/client-rds');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const ddbClient = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(ddbClient);
const sts = new STSClient({});

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;

async function getAssumedClients(roleArn, externalId, region = 'us-east-1') {
  if (!externalId) throw new Error('ExternalId is required for AssumeRole');
  try {
    const assumeCommand = new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: 'GuardianAdvisorExecution',
      DurationSeconds: 900,
      ExternalId: externalId,
    });
    const assumedRole = await sts.send(assumeCommand);

    const credentials = {
      accessKeyId: assumedRole.Credentials.AccessKeyId,
      secretAccessKey: assumedRole.Credentials.SecretAccessKey,
      sessionToken: assumedRole.Credentials.SessionToken,
    };

    return {
      ec2: new EC2Client({ credentials, region }),
      rds: new RDSClient({ credentials, region }),
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

    const recCommand = new GetCommand({
      TableName: DYNAMODB_TABLE,
      Key: { id: customerId, sk: recSk }
    });
    const rec = (await dynamoDb.send(recCommand)).Item;

    if (!rec) {
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
          'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({ error: 'Recomendação não encontrada' })
      };
    }

    if (rec.status === 'COMPLETED') {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
          'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({ error: 'Recomendação já foi executada' })
      };
    }

    const configCommand = new GetCommand({
      TableName: DYNAMODB_TABLE,
      Key: { id: customerId, sk: 'CONFIG#ONBOARD' }
    });
    const config = (await dynamoDb.send(configCommand)).Item;

    if (!config?.roleArn) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
          'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({ error: 'Role ARN não configurada' })
      };
    }

    const region = rec.region || 'us-east-1';
    if (!config.externalId) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
          'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({ error: 'externalId not configured for this customer' })
      };
    }

    const clients = await getAssumedClients(config.roleArn, config.externalId, region);

    try {
      let actionResult;
      let realizedSavings = rec.potentialSavings || 0;

      if (rec.type === 'UNUSED_EBS' || rec.type === 'UNUSED_EBS_VOLUME') {
        const volumeId = rec.details.volumeId;
        const deleteCommand = new DeleteVolumeCommand({ VolumeId: volumeId });
        actionResult = await clients.ec2.send(deleteCommand);
      } else if (rec.type === 'IDLE_INSTANCE') {
        const instanceId = rec.details.instanceId;
        const stopCommand = new StopInstancesCommand({ InstanceIds: [instanceId] });
        actionResult = await clients.ec2.send(stopCommand);
      } else if (rec.type === 'IDLE_RDS') {
        const dbInstanceId = rec.details.dbInstanceIdentifier;
        const stopCommand = new StopDBInstanceCommand({ DBInstanceIdentifier: dbInstanceId });
        actionResult = await clients.rds.send(stopCommand);
      }

      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const updateCommand = new UpdateCommand({
        TableName: DYNAMODB_TABLE,
        Key: { id: customerId, sk: recSk },
        UpdateExpression: 'SET #status = :status, executedAt = :now, executedBy = :executedBy, actionResult = :result, realizedSavings = :realized',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'COMPLETED',
          ':now': now.toISOString(),
          ':executedBy': 'AUTO',
          ':result': actionResult,
          ':realized': realizedSavings
        }
      });
      await dynamoDb.send(updateCommand);

      await trackSavings(customerId, monthKey, rec.type, realizedSavings, recSk);

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
          'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({
          message: 'Ação executada com sucesso',
          recommendationId: recommendationId,
          executedAt: now.toISOString(),
          realizedSavings: realizedSavings
        })
      };

    } catch (actionError) {
      console.error('Erro ao executar ação:', actionError);

      const updateCommand = new UpdateCommand({
        TableName: DYNAMODB_TABLE,
        Key: { id: customerId, sk: recSk },
        UpdateExpression: 'SET #status = :status, error = :error, lastAttemptAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'FAILED',
          ':error': actionError.message,
          ':now': new Date().toISOString()
        }
      });
      await dynamoDb.send(updateCommand);

      return {
        statusCode: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
          'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
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
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({ error: 'Erro interno do servidor' })
    };
  }
};

async function trackSavings(customerId, monthKey, savingType, amount, recommendationId) {
  try {
    const savingsSk = `SAVINGS#REALIZED#${monthKey}`;
    
    const getCommand = new GetCommand({
      TableName: DYNAMODB_TABLE,
      Key: { id: customerId, sk: savingsSk }
    });
    const existing = (await dynamoDb.send(getCommand)).Item;

    const typeMap = {
      'IDLE_INSTANCE': 'idleInstances',
      'UNUSED_EBS': 'unusedEbs',
      'UNUSED_EBS_VOLUME': 'unusedEbs',
      'IDLE_RDS': 'idleRds',
      'SLA_CREDIT': 'slaCredits'
    };
    const breakdownKey = typeMap[savingType] || 'other';

    if (existing) {
      const currentBreakdown = existing.breakdown || {};
      const currentTotal = existing.totalSavings || 0;
      const newTotal = currentTotal + amount;
      
      const updateCommand = new UpdateCommand({
        TableName: DYNAMODB_TABLE,
        Key: { id: customerId, sk: savingsSk },
        UpdateExpression: 'SET totalSavings = :newTotal, breakdown.#key = :newBreakdown, commission = :commission, updatedAt = :now, #items = list_append(if_not_exists(#items, :emptyList), :newItem)',
        ExpressionAttributeNames: {
          '#key': breakdownKey,
          '#items': 'items'
        },
        ExpressionAttributeValues: {
          ':newTotal': newTotal,
          ':newBreakdown': (currentBreakdown[breakdownKey] || 0) + amount,
          ':commission': newTotal * 0.30,
          ':now': new Date().toISOString(),
          ':emptyList': [],
          ':newItem': [{
            type: savingType,
            recommendationId: recommendationId,
            amount: amount,
            executedAt: new Date().toISOString(),
            executedBy: 'AUTO'
          }]
        }
      });
      await dynamoDb.send(updateCommand);
    } else {
      const newItem = {
        id: customerId,
        sk: savingsSk,
        month: monthKey,
        totalSavings: amount,
        breakdown: {
          [breakdownKey]: amount
        },
        attribution: {
          automated: amount,
          manual: 0
        },
        commission: amount * 0.30,
        commissionRate: 0.30,
        items: [{
          type: savingType,
          recommendationId: recommendationId,
          amount: amount,
          executedAt: new Date().toISOString(),
          executedBy: 'AUTO'
        }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const updateCommand = new UpdateCommand({
        TableName: DYNAMODB_TABLE,
        Key: { id: customerId, sk: savingsSk },
        UpdateExpression: 'SET #month = :month, totalSavings = :total, breakdown = :breakdown, attribution = :attribution, commission = :commission, commissionRate = :rate, #items = :items, createdAt = :created, updatedAt = :updated',
        ExpressionAttributeNames: {
          '#month': 'month',
          '#items': 'items'
        },
        ExpressionAttributeValues: {
          ':month': monthKey,
          ':total': newItem.totalSavings,
          ':breakdown': newItem.breakdown,
          ':attribution': newItem.attribution,
          ':commission': newItem.commission,
          ':rate': newItem.commissionRate,
          ':items': newItem.items,
          ':created': newItem.createdAt,
          ':updated': newItem.updatedAt
        }
      });
      await dynamoDb.send(updateCommand);
    }

    console.log(`Tracking: ${customerId} salvou $${amount} em ${monthKey} via ${savingType}`);
  } catch (err) {
    console.error('Erro ao trackear economias:', err);
  }
}
