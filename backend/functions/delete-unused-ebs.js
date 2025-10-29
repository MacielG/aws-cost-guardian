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

exports.deleteUnusedEbsHandler = async (event) => {
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
      const pricing = new AWS.Pricing({ region: 'us-east-1' });

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

          // Calcular economia potencial (tentar Pricing API, fallback para heurística)
          let potentialSavings = null;
          try {
            const pricePerGb = await getEbsGbMonthPrice(v.VolumeType, 'us-east-1', pricing);
            if (pricePerGb != null) {
              potentialSavings = parseFloat((v.Size * pricePerGb).toFixed(2));
            }
          } catch (priceErr) {
            console.warn('Erro ao obter preço EBS via Pricing API, usando fallback:', priceErr);
          }

          if (potentialSavings == null) {
            // fallback heurístico
            const fallbackMap = { gp3: 0.08, gp2: 0.10, standard: 0.05 };
            const key = (v.VolumeType || 'gp2').toLowerCase();
            const priceGb = fallbackMap[key] || 0.10;
            potentialSavings = parseFloat((v.Size * priceGb).toFixed(2));
          }
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

async function getEbsGbMonthPrice(volumeType, regionCode, pricingClient) {
  // best-effort via Pricing API
  const regionNameMap = {
    'us-east-1': 'US East (N. Virginia)',
    'us-east-2': 'US East (Ohio)',
    'us-west-2': 'US West (Oregon)',
    'eu-west-1': 'EU (Ireland)'
  };
  const location = regionNameMap[regionCode] || 'US East (N. Virginia)';

  const filters = [
    { Type: 'TERM_MATCH', Field: 'location', Value: location },
    { Type: 'TERM_MATCH', Field: 'volumeType', Value: volumeType },
  ];

  const resp = await pricingClient.getProducts({ ServiceCode: 'AmazonEC2', Filters: filters, MaxResults: 100 }).promise();
  const priceList = resp.PriceList || [];
  for (const p of priceList) {
    try {
      const prod = JSON.parse(p);
      const onDemandTerms = prod.terms && prod.terms.OnDemand;
      if (!onDemandTerms) continue;
      for (const termKey of Object.keys(onDemandTerms)) {
        const term = onDemandTerms[termKey];
        const priceDimensions = term.priceDimensions || {};
        for (const pdKey of Object.keys(priceDimensions)) {
          const pd = priceDimensions[pdKey];
          const pricePerUnit = pd.pricePerUnit && pd.pricePerUnit.USD;
          if (pricePerUnit) {
            // pricePerUnit here may be per GB-month
            return parseFloat(pricePerUnit);
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }
  return null;
}
