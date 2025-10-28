import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

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
  console.log('Executando automação: Recomendar RDS Ociosas');

  const queryParams = {
    TableName: DYNAMODB_TABLE,
    IndexName: 'ActiveCustomerIndex',
    KeyConditionExpression: 'sk = :sk AND #status = :status',
    ExpressionAttributeNames: { 
      '#status': 'status',
      '#automationSettings': 'automationSettings',
      '#stopIdleRds': 'stopIdleRds'
    },
    ExpressionAttributeValues: { 
      ':sk': 'CONFIG#ONBOARD',
      ':status': 'ACTIVE',
      ':true': true
    },
    FilterExpression: '#automationSettings.#stopIdleRds = :true',
    ProjectionExpression: 'id, roleArn, automationSettings, exclusionTags'
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
      const assumeCommand = new AssumeRoleCommand({ 
        RoleArn: customer.roleArn, 
        RoleSessionName: `recommend-rds-${customer.id}-${Date.now()}`, 
        DurationSeconds: 900 
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
        credentials: {
          accessKeyId: creds.AccessKeyId,
          secretAccessKey: creds.SecretAccessKey,
          sessionToken: creds.SessionToken,
        },
        region: 'us-east-1'
      });

      // Descrever instâncias RDS
      const descCommand = new DescribeDBInstancesCommand({});
      const desc = await rdsClient.send(descCommand);
      
      const instances = desc.DBInstances || [];

      for (const db of instances) {
        try {
          const dbId = db.DBInstanceIdentifier;
          
          // Pular instâncias de produção
          if (dbId.toLowerCase().includes('prod') || dbId.toLowerCase().includes('production')) {
            continue;
          }

          // Verificar conexões nas últimas 24h
          const now = new Date();
          const metricCommand = new GetMetricStatisticsCommand({
            Namespace: 'AWS/RDS',
            MetricName: 'DatabaseConnections',
            Dimensions: [{ Name: 'DBInstanceIdentifier', Value: dbId }],
            StartTime: new Date(now.getTime() - 24 * 60 * 60 * 1000),
            EndTime: now,
            Period: 3600,
            Statistics: ['Average'],
          });
          
          const metric = await cwClient.send(metricCommand);
          const points = metric.Datapoints || [];
          const avgConnections = points.reduce((s,p)=>s+(p.Average||0),0) / (points.length||1);
          
          if (isExcluded(db.TagList, customer.automationSettings?.exclusionTags)) {
            console.log(`RDS ${dbId} excluída por tags. Pulando...`);
            continue;
          }

          // Se média de conexões < 1 nas últimas 24h
          if (avgConnections < 1) {
            const recommendationId = `REC#RDS#${dbId}`;
            
            // Estimar economia baseado no tipo de instância
            const instanceClass = db.DBInstanceClass;
            // Preços aproximados por hora (db.t3.micro ~ $0.017/h = ~$12/mês)
            const hourlyPrices = {
              'db.t3.micro': 0.017,
              'db.t3.small': 0.034,
              'db.t3.medium': 0.068,
              'db.t4g.micro': 0.016,
              'db.t4g.small': 0.032,
              'db.m5.large': 0.192,
              'db.m5.xlarge': 0.384,
            };

            const hourlyPrice = hourlyPrices[instanceClass] || 0.1;
            const monthlyPrice = hourlyPrice * 730; // 730 horas/mês
            const potentialSavings = parseFloat(monthlyPrice.toFixed(2));

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
                  dbInstanceId: dbId,
                  instanceClass: instanceClass,
                  engine: db.Engine,
                  engineVersion: db.EngineVersion,
                  allocatedStorage: db.AllocatedStorage,
                  avgConnections: avgConnections,
                  tags: db.TagList || []
                },
                createdAt: now.toISOString(),
              }
            });
            await dynamoDb.send(putCommand);

            console.log(`Cliente ${customer.id}: Recomendação criada para RDS ${dbId} (economia potencial: $${potentialSavings}/mês)`);
          }
        } catch (innerErr) {
          console.error('Erro ao avaliar RDS:', innerErr);
        }
      }

    } catch (err) {
      console.error(`Erro ao processar cliente ${customer.id}:`, err);
    }
  }

  return { status: 'completed' };
};
