const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');
const { EC2Client, DescribeVolumesCommand } = require('@aws-sdk/client-ec2');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const ddbClient = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(ddbClient);
const sts = new STSClient({});

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;

function isExcludedByTags(resourceTags, exclusionTagsList) {
  if (!exclusionTagsList?.length || !resourceTags?.length) return false;
  
  for (const tag of resourceTags) {
    const tagString = `${tag.Key}:${tag.Value}`;
    if (exclusionTagsList.includes(tagString) || exclusionTagsList.includes(tag.Key)) {
      return true;
    }
  }
  return false;
}

exports.handler = async (event) => {
  console.log('Executando automação: Recomendar Remoção de Volumes EBS Não Utilizados');

  const queryParams = {
    TableName: DYNAMODB_TABLE,
    IndexName: 'ActiveCustomerIndex',
    KeyConditionExpression: 'sk = :sk',
    ExpressionAttributeNames: { 
      '#status': 'status',
      '#automationSettings': 'automationSettings'
    },
    ExpressionAttributeValues: { 
      ':sk': 'CONFIG#ONBOARD'
    },
    ProjectionExpression: 'id, roleArn, automationSettings, #status'
  };

  const response = await dynamoDb.send(new QueryCommand(queryParams));
  const items = response.Items || [];

  if (!items.length) {
    console.log('Nenhum cliente com automação DELETE_UNUSED_EBS habilitada.');
    return { status: 'no-op' };
  }

  for (const customer of items) {
    const config = customer.automationSettings?.deleteUnusedEbs;
    
    if (!config?.enabled) {
      console.log(`Cliente ${customer.id}: automação DELETE_UNUSED_EBS desabilitada`);
      continue;
    }

    if (!customer.roleArn) {
      console.warn(`Cliente ${customer.id} sem roleArn; pulando`);
      continue;
    }

    const regions = config.regions || ['us-east-1'];
    const tagFilters = config.filters?.tags || [];
    const volumeStates = config.filters?.volumeStates || ['available'];
    const daysThreshold = config.thresholds?.daysUnused || 7;
    const exclusionTags = config.exclusionTags || [];

    try {
      const assumeCommand = new AssumeRoleCommand({ 
        RoleArn: customer.roleArn, 
        RoleSessionName: `recommend-ebs-${customer.id}-${Date.now()}`, 
        DurationSeconds: 900 
      });
      const assume = await sts.send(assumeCommand);
      const creds = assume.Credentials;

      for (const region of regions) {
        console.log(`Cliente ${customer.id}: Processando região ${region}`);

        const ec2Client = new EC2Client({ 
          credentials: {
            accessKeyId: creds.AccessKeyId,
            secretAccessKey: creds.SecretAccessKey,
            sessionToken: creds.SessionToken,
          },
          region
        });

        const filters = [
          { Name: 'status', Values: volumeStates },
          ...tagFilters.map(f => ({ Name: `tag:${f.Key}`, Values: f.Values }))
        ];

        const descCommand = new DescribeVolumesCommand({ Filters: filters });
        const desc = await ec2Client.send(descCommand);
      
        const volumes = desc.Volumes || [];

        for (const vol of volumes) {
          try {
            const volumeId = vol.VolumeId;
            const createTime = vol.CreateTime;
            const now = new Date();
            
            const daysUnused = (now - createTime) / (1000 * 60 * 60 * 24);
            
            if (isExcludedByTags(vol.Tags, exclusionTags)) {
              console.log(`Volume ${volumeId} excluído por tags. Pulando...`);
              continue;
            }

            if (daysUnused > daysThreshold) {
              const recommendationId = `REC#EBS#${volumeId}`;
              
              const sizeGb = vol.Size;
              const volumeType = vol.VolumeType;
              
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

              const accountId = assume.AssumedRoleUser.Arn.split(':')[4];
              const putCommand = new PutCommand({
                TableName: DYNAMODB_TABLE,
                Item: {
                  id: customer.id,
                  sk: recommendationId,
                  type: 'UNUSED_EBS',
                  status: 'RECOMMENDED',
                  potentialSavings: potentialSavings,
                  resourceArn: `arn:aws:ec2:${region}:${accountId}:volume/${volumeId}`,
                  region: region,
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

              console.log(`Cliente ${customer.id}: Recomendação criada para volume ${volumeId} em ${region} (economia potencial: $${potentialSavings}/mês)`);
            }
          } catch (innerErr) {
            console.error('Erro ao avaliar volume:', innerErr);
          }
        }
      }

    } catch (err) {
      console.error(`Erro ao processar cliente ${customer.id}:`, err);
    }
  }

  return { status: 'completed' };
};
