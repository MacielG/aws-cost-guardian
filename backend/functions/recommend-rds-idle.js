const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');
const { RDSClient, DescribeDBInstancesCommand } = require('@aws-sdk/client-rds');
const { CloudWatchClient, GetMetricStatisticsCommand } = require('@aws-sdk/client-cloudwatch');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const ddbClient = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(ddbClient);
const sts = new STSClient({});

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;

function isExcluded(resourceTags, exclusionTagsString) {
  if (!exclusionTagsString || !resourceTags?.length) return false;
  const exclusionTags = exclusionTagsString.split(',').map(t => t.trim());

  for (const tag of resourceTags) {
    const tagString = `${tag.Key}:${tag.Value}`;
    if (exclusionTags.includes(tagString) || exclusionTags.includes(tag.Key)) {
      return true;
    }
  }
  return false;
}

export const handler = async (event) => {
  console.log('Executando automação: Recomendar Parada de Instâncias RDS Ociosas');

  const queryParams = {
    TableName: DYNAMODB_TABLE,
    IndexName: 'ActiveCustomerIndex',
    KeyConditionExpression: 'sk = :sk AND #status = :status',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#automationSettings': 'automationSettings',
      '#stopIdleRds': 'stopIdleRds' // Assuming we add this setting
    },
    ExpressionAttributeValues: {
      ':sk': 'CONFIG#ONBOARD',
      ':status': 'ACTIVE',
      ':true': true
    },
    FilterExpression: '#automationSettings.#stopIdleRds = :true',
  ProjectionExpression: 'id, roleArn, automationSettings, exclusionTags, externalId'
  };

  const response = await dynamoDb.send(new QueryCommand(queryParams));
  const items = response.Items || [];

  if (!items.length) {
    console.log('Nenhum cliente com automação STOP_IDLE_RDS habilitada.');
    return { status: 'no-op' };
  }

    for (const customer of items) {
    if (!customer.roleArn) {
      console.warn(`Cliente ${customer.id} sem roleArn; pulando`);
      continue;
    }

    try {
      if (!customer.externalId) {
        console.warn(`Cliente ${customer.id} não possui externalId; pulando`);
        continue;
      }
      const assumeCommand = new AssumeRoleCommand({
        RoleArn: customer.roleArn,
        RoleSessionName: `recommend-rds-${customer.id}-${Date.now()}`,
        DurationSeconds: 900,
        ExternalId: customer.externalId,
      });
      const assume = await sts.send(assumeCommand);
      const creds = assume.Credentials;

      const rdsClient = new RDSClient({
        credentials: {
          accessKeyId: creds.AccessKeyId,
          secretAccessKey: creds.SecretAccessKey,
          sessionToken: creds.SessionToken,
        },
        region: 'us-east-1'
      });

      const cwClient = new CloudWatchClient({
        credentials: creds,
        region: 'us-east-1'
      });

      // Descrever DB instances
      const descCommand = new DescribeDBInstancesCommand({});
      const desc = await rdsClient.send(descCommand);

      const instances = desc.DBInstances || [];

      for (const db of instances) {
        try {
          const dbInstanceId = db.DBInstanceIdentifier;
          const dbInstanceStatus = db.DBInstanceStatus;

          if (dbInstanceStatus !== 'available') continue; // Only check running instances

          if (isExcluded(db.TagList, customer.automationSettings?.exclusionTags)) {
            console.log(`RDS ${dbInstanceId} excluído por tags. Pulando...`);
            continue;
          }

          // Check CPU utilization over last 7 days
          const cwCommand = new GetMetricStatisticsCommand({
            Namespace: 'AWS/RDS',
            MetricName: 'CPUUtilization',
            Dimensions: [
              {
                Name: 'DBInstanceIdentifier',
                Value: dbInstanceId,
              },
            ],
            StartTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            EndTime: new Date(),
            Period: 3600, // 1 hour
            Statistics: ['Average'],
          });

          const cwResponse = await cwClient.send(cwCommand);
          const datapoints = cwResponse.Datapoints || [];

          if (datapoints.length === 0) continue;

          const avgCpu = datapoints.reduce((sum, dp) => sum + dp.Average, 0) / datapoints.length;

          if (avgCpu < 5) { // Idle threshold
            const recommendationId = `REC#RDS#${dbInstanceId}`;

            // Estimate monthly cost (simplified)
            const instanceClass = db.DBInstanceClass;
            const hourlyCost = 0.05; // Approximate for small instances
            const potentialSavings = hourlyCost * 24 * 30;

            const putCommand = new PutCommand({
              TableName: DYNAMODB_TABLE,
              Item: {
                id: customer.id,
                sk: recommendationId,
                type: 'IDLE_RDS',
                status: 'RECOMMENDED',
                potentialSavings: potentialSavings,
                resourceArn: db.DBInstanceArn,
                details: {
                  dbInstanceId: dbInstanceId,
                  dbInstanceClass: instanceClass,
                  avgCpu: avgCpu,
                  tags: db.TagList || []
                },
                createdAt: new Date().toISOString(),
              }
            });
            await dynamoDb.send(putCommand);

            console.log(`Cliente ${customer.id}: Recomendação criada para RDS ${dbInstanceId} (CPU média: ${avgCpu.toFixed(2)}%, economia potencial: $${potentialSavings.toFixed(2)}/mês)`);
          }
        } catch (innerErr) {
          console.error('Erro ao avaliar RDS instance:', innerErr);
        }
      }

    } catch (err) {
      console.error(`Erro ao processar cliente ${customer.id}:`, err);
    }
  }

  return { status: 'completed' };
};
