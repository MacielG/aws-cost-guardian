import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { EC2Client, DescribeVolumesCommand } from '@aws-sdk/client-ec2';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { PricingClient, GetProductsCommand } from '@aws-sdk/client-pricing';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(ddbClient);
const sts = new STSClient({});
const pricing = new PricingClient({ region: 'us-east-1' });

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
  console.log('Executando automação: Recomendar Remoção de Volumes EBS Não Utilizados');

  const queryParams = {
    TableName: DYNAMODB_TABLE,
    IndexName: 'ActiveCustomerIndex',
    KeyConditionExpression: 'sk = :sk AND #status = :status',
    ExpressionAttributeNames: { 
      '#status': 'status',
      '#automationSettings': 'automationSettings',
      '#deleteUnusedEbs': 'deleteUnusedEbs'
    },
    ExpressionAttributeValues: { 
      ':sk': 'CONFIG#ONBOARD',
      ':status': 'ACTIVE',
      ':true': true
    },
    FilterExpression: '#automationSettings.#deleteUnusedEbs = :true',
    ProjectionExpression: 'id, roleArn, automationSettings, exclusionTags'
  };

  const response = await dynamoDb.send(new QueryCommand(queryParams));
  const items = response.Items || [];

  if (!items.length) {
    console.log('Nenhum cliente com automação DELETE_UNUSED_EBS habilitada.');
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
        RoleSessionName: `recommend-ebs-${customer.id}-${Date.now()}`, 
        DurationSeconds: 900 
      });
      const assume = await sts.send(assumeCommand);
      const creds = assume.Credentials;

      const ec2Client = new EC2Client({ 
        credentials: {
          accessKeyId: creds.AccessKeyId,
          secretAccessKey: creds.SecretAccessKey,
          sessionToken: creds.SessionToken,
        },
        region: 'us-east-1'
      });

      // Descrever volumes disponíveis (não attached)
      const descCommand = new DescribeVolumesCommand({
        Filters: [
          { Name: 'status', Values: ['available'] }
        ]
      });
      const desc = await ec2Client.send(descCommand);
      
      const volumes = desc.Volumes || [];

      for (const vol of volumes) {
        try {
          const volumeId = vol.VolumeId;
          const createTime = vol.CreateTime;
          const now = new Date();
          
          // Verificar se o volume está disponível há mais de 7 dias
          const daysUnused = (now - createTime) / (1000 * 60 * 60 * 24);
          
          if (isExcluded(vol.Tags, customer.automationSettings?.exclusionTags)) {
            console.log(`Volume ${volumeId} excluído por tags. Pulando...`);
            continue;
          }

          if (daysUnused > 7) {
            const recommendationId = `REC#EBS#${volumeId}`;
            
            // Estimar economia baseado no tipo e tamanho
            const sizeGb = vol.Size;
            const volumeType = vol.VolumeType;
            
            // Preços aproximados por GB/mês
            const pricePerGb = {
              'gp2': 0.10,
              'gp3': 0.08,
              'io1': 0.125,
              'io2': 0.125,
              'st1': 0.045,
              'sc1': 0.025,
              'standard': 0.05,
            };
            
            const monthlyPrice = (pricePerGb[volumeType] || 0.10) * sizeGb;
            const potentialSavings = parseFloat(monthlyPrice.toFixed(2));

            const putCommand = new PutCommand({
              TableName: DYNAMODB_TABLE,
              Item: {
                id: customer.id,
                sk: recommendationId,
                type: 'UNUSED_EBS',
                status: 'RECOMMENDED',
                potentialSavings: potentialSavings,
                resourceArn: `arn:aws:ec2:us-east-1:${assume.AssumedRoleUser.Arn.split(':')[4]}:volume/${volumeId}`,
                details: {
                  volumeId: volumeId,
                  volumeType: volumeType,
                  sizeGb: sizeGb,
                  createTime: createTime.toISOString(),
                  daysUnused: Math.floor(daysUnused),
                  tags: vol.Tags || []
                },
                createdAt: now.toISOString(),
              }
            });
            await dynamoDb.send(putCommand);

            console.log(`Cliente ${customer.id}: Recomendação criada para volume ${volumeId} (economia potencial: $${potentialSavings}/mês)`);
          }
        } catch (innerErr) {
          console.error('Erro ao avaliar volume:', innerErr);
        }
      }

    } catch (err) {
      console.error(`Erro ao processar cliente ${customer.id}:`, err);
    }
  }

  return { status: 'completed' };
};
