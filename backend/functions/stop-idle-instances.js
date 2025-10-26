const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const sts = new AWS.STS();
const ec2 = new AWS.EC2();
const cloudwatch = new AWS.CloudWatch();

const pricing = new AWS.Pricing({ region: 'us-east-1' });

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
  console.log('Executando automação: Parar Instâncias Ociosas');

  // 1. Usar o novo GSI ActiveCustomerIndex para recuperar clientes com automação ativada
  const queryParams = {
    TableName: DYNAMODB_TABLE,
    IndexName: 'ActiveCustomerIndex',
    KeyConditionExpression: 'sk = :sk AND #status = :status',
    ExpressionAttributeNames: { 
      '#status': 'status',
      '#automationSettings': 'automationSettings',
      '#stopIdleInstances': 'stopIdleInstances'
    },
    ExpressionAttributeValues: { 
      ':sk': 'CONFIG#ONBOARD',
      ':status': 'ACTIVE',
      ':true': true
    },
    FilterExpression: '#automationSettings.#stopIdleInstances = :true',
    ProjectionExpression: 'id, roleArn, automationSettings, exclusionTags'
  };

  const response = await dynamoDb.query(queryParams).promise();
  const items = response.Items || [];

  if (!items.length) {
    console.log('Nenhum cliente com automação STOP_IDLE habilitada.');
    return { status: 'no-op' };
  }

  for (const customer of items) {
    if (!customer.roleArn) {
      console.warn(`Cliente ${customer.id} sem roleArn; pulando`);
      continue;
    }

    try {
      // Assumir role do cliente
      const assume = await sts.assumeRole({ RoleArn: customer.roleArn, RoleSessionName: `stop-idle-${customer.id}-${Date.now()}`, DurationSeconds: 900 }).promise();
      const creds = assume.Credentials;
      const ec2Client = new AWS.EC2({ accessKeyId: creds.AccessKeyId, secretAccessKey: creds.SecretAccessKey, sessionToken: creds.SessionToken, region: 'us-east-1' });
      const cwClient = new AWS.CloudWatch({ accessKeyId: creds.AccessKeyId, secretAccessKey: creds.SecretAccessKey, sessionToken: creds.SessionToken, region: 'us-east-1' });

      // 2. Descrever instâncias com tag Environment=dev (exemplo)
      const desc = await ec2Client.describeInstances({ Filters: [{ Name: 'tag:Environment', Values: ['dev','staging'] }, { Name: 'instance-state-name', Values: ['running'] }] }).promise();
      const instances = [];
      for (const r of desc.Reservations || []) {
        for (const i of r.Instances || []) instances.push(i);
      }

      for (const inst of instances) {
        try {
          const id = inst.InstanceId;
          // Verificar CPU médio nas últimas 24h
          const now = Date.now();
          const start = new Date(now - 24 * 60 * 60 * 1000).toISOString();
          const end = new Date(now).toISOString();

          const metric = await cwClient.getMetricStatistics({
            Namespace: 'AWS/EC2',
            MetricName: 'CPUUtilization',
            Dimensions: [{ Name: 'InstanceId', Value: id }],
            StartTime: new Date(now - 24 * 60 * 60 * 1000),
            EndTime: new Date(now),
            Period: 3600,
            Statistics: ['Average'],
          }).promise();

          const points = metric.Datapoints || [];
          const avg = points.reduce((s,p)=>s+(p.Average||0),0) / (points.length||1);
          // Verificar se a instância está excluída pelas tags
          if (isExcluded(inst.Tags, customer.automationSettings?.exclusionTags)) {
            console.log(`Instância ${id} excluída por tags. Pulando...`);
            continue;
          }

          if (avg < 5) {
            // Em vez de parar automaticamente, gravamos uma recomendação para o Guardian Advisor
            const recommendationId = `REC#EC2#${id}`;
            // Estimativa de economia potencial baseada no preço horário via AWS Pricing (fallback para heurística simples)
            let potentialSavings = null;
            try {
              const instanceType = inst.InstanceType;
              // Tentar obter preço horário via Pricing API
              const price = await getEc2HourlyPrice(instanceType, 'us-east-1');
              if (price != null) {
                // Calcular horas restantes do mês (aprox.)
                const now = new Date();
                const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
                const hoursRemaining = (daysInMonth - now.getDate()) * 24;
                potentialSavings = parseFloat((price * hoursRemaining).toFixed(2));
              }
            } catch (psErr) {
              console.warn('Falha ao calcular preço EC2 via Pricing API, usando fallback heurístico:', psErr);
            }

            if (potentialSavings == null) {
              potentialSavings = parseFloat((inst.InstanceType && inst.InstanceType.includes('t3') ? 5.00 : 10.00).toFixed(2));
            }

            await dynamoDb.put({
              TableName: DYNAMODB_TABLE,
              Item: {
                id: customer.id,
                sk: recommendationId,
                type: 'IDLE_INSTANCE',
                status: 'RECOMMENDED',
                potentialSavings: potentialSavings,
                resourceArn: `arn:aws:ec2:${AWS.config.region}:${assume.AssumedRoleUser.Arn.split(':')[4]}:instance/${id}`,
                details: {
                  instanceId: id,
                  instanceType: inst.InstanceType,
                  launchTime: inst.LaunchTime,
                  cpuAvg: avg,
                  tags: inst.Tags || []
                },
                createdAt: new Date().toISOString(),
              }
            }).promise();

            console.log(`Cliente ${customer.id}: Recomendação criada para instância ${id} (economia potencial: $${potentialSavings}/mês)`);
          }
        } catch (innerErr) {
          console.error('Erro ao avaliar instância:', innerErr);
        }
      }

    } catch (err) {
      console.error(`Erro ao processar cliente ${customer.id}:`, err);
    }
  }

  return { status: 'completed' };
};

// Tenta consultar o preço horário de uma instância EC2 via API Pricing (caso não disponível, lançar erro)
async function getEc2HourlyPrice(instanceType, regionCode) {
  // Mapeamento simples de regionCode para nome usado no Pricing
  const regionNameMap = {
    'us-east-1': 'US East (N. Virginia)',
    'us-east-2': 'US East (Ohio)',
    'us-west-2': 'US West (Oregon)',
    'eu-west-1': 'EU (Ireland)'
  };
  const location = regionNameMap[regionCode] || 'US East (N. Virginia)';

  const filters = [
    { Type: 'TERM_MATCH', Field: 'instanceType', Value: instanceType },
    { Type: 'TERM_MATCH', Field: 'location', Value: location },
    { Type: 'TERM_MATCH', Field: 'operatingSystem', Value: 'Linux' },
    { Type: 'TERM_MATCH', Field: 'tenancy', Value: 'Shared' }
  ];

  const resp = await pricing.getProducts({ ServiceCode: 'AmazonEC2', Filters: filters, MaxResults: 100 }).promise();
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
            return parseFloat(pricePerUnit);
          }
        }
      }
    } catch (e) {
      // ignorar parse errors e continuar
    }
  }
  // Se não foi possível, retornar null para permitir fallback
  return null;
}
