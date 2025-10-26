const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const sts = new AWS.STS();

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;

// Helper para verificar se um recurso está excluído pelas tags
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

exports.handler = async (event) => {
  console.log('Executando automação: Excluir Volumes EBS Órfãos');

  // 1. Usar o novo GSI ActiveCustomerIndex para buscar clientes que habilitaram DELETE_UNUSED_EBS
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

  const response = await dynamoDb.query(queryParams).promise();
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
      const assume = await sts.assumeRole({ RoleArn: customer.roleArn, RoleSessionName: `delete-ebs-${customer.id}-${Date.now()}`, DurationSeconds: 900 }).promise();
      const creds = assume.Credentials;
      const ec2Client = new AWS.EC2({ accessKeyId: creds.AccessKeyId, secretAccessKey: creds.SecretAccessKey, sessionToken: creds.SessionToken, region: 'us-east-1' });

      // Describe volumes with status 'available' (não anexados)
      const resp = await ec2Client.describeVolumes({ Filters: [{ Name: 'status', Values: ['available'] }] }).promise();
      const volumes = resp.Volumes || [];
      for (const v of volumes) {
        try {
          // Verificar se o volume está excluído pelas tags
          if (isExcluded(v.Tags, customer.automationSettings?.exclusionTags)) {
            console.log(`Volume ${v.VolumeId} excluído por tags. Pulando...`);
            continue;
          }

          // Calcular economia potencial (preço médio por GB/mês é $0.10)
          const potentialSavings = (v.Size * 0.10).toFixed(2);
          const recommendationId = `REC#EBS#${v.VolumeId}`;

          // Salvar recomendação no DynamoDB
          await dynamoDb.put({
            TableName: DYNAMODB_TABLE,
            Item: {
              id: customer.id,
              sk: recommendationId,
              type: 'UNUSED_EBS_VOLUME',
              status: 'RECOMMENDED',
              potentialSavings: parseFloat(potentialSavings),
              resourceArn: `arn:aws:ec2:${AWS.config.region}:${assume.AssumedRoleUser.Arn.split(':')[4]}:volume/${v.VolumeId}`,
              details: {
                volumeId: v.VolumeId,
                volumeSize: v.Size,
                volumeType: v.VolumeType,
                createTime: v.CreateTime,
                tags: v.Tags || []
              },
              createdAt: new Date().toISOString(),
            }
          }).promise();
          
          console.log(`Cliente ${customer.id}: Recomendação criada para volume ${v.VolumeId} (economia potencial: $${potentialSavings}/mês)`);
        } catch (inner) {
          console.error('Erro ao deletar volume:', inner);
        }
      }

    } catch (err) {
      console.error(`Erro ao processar cliente ${customer.id}:`, err);
    }
  }

  return { status: 'completed' };
};
