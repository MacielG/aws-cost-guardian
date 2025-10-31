const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');
const { EC2Client, DescribeInstancesCommand, DescribeReservedInstancesCommand } = require('@aws-sdk/client-ec2');
const { CloudWatchClient, GetMetricStatisticsCommand } = require('@aws-sdk/client-cloudwatch');
const { PricingClient, GetProductsCommand } = require('@aws-sdk/client-pricing');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const ddbClient = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(ddbClient);
const sts = new STSClient({});
const pricing = new PricingClient({ region: 'us-east-1' });

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
  console.log('Executando automação: Parar Instâncias Ociosas (v3)');

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
    console.log('Nenhum cliente com automação STOP_IDLE habilitada.');
    return { status: 'no-op' };
  }

  for (const customer of items) {
    const config = customer.automationSettings?.stopIdleInstances;
    
    if (!config?.enabled) {
      console.log(`Cliente ${customer.id}: automação STOP_IDLE desabilitada`);
      continue;
    }

    if (!customer.roleArn) {
      console.warn(`Cliente ${customer.id} sem roleArn; pulando`);
      continue;
    }

    const regions = config.regions || ['us-east-1'];
    const tagFilters = config.filters?.tags || [{ Key: 'Environment', Values: ['dev', 'staging'] }];
    const instanceStates = config.filters?.instanceStates || ['running'];
    const cpuThreshold = config.thresholds?.cpuUtilization || 5;
    const evaluationHours = config.thresholds?.evaluationPeriodHours || 24;
    const exclusionTags = config.exclusionTags || [];

    try {
      const assumeCommand = new AssumeRoleCommand({
        RoleArn: customer.roleArn,
        RoleSessionName: `stop-idle-${customer.id}-${Date.now()}`,
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
        const cwClient = new CloudWatchClient({
          credentials: {
            accessKeyId: creds.AccessKeyId,
            secretAccessKey: creds.SecretAccessKey,
            sessionToken: creds.SessionToken,
          },
          region
        });

        const filters = [
          ...tagFilters.map(f => ({ Name: `tag:${f.Key}`, Values: f.Values })),
          { Name: 'instance-state-name', Values: instanceStates }
        ];

        const descCommand = new DescribeInstancesCommand({ Filters: filters });
        const desc = await ec2Client.send(descCommand);

        const instances = [];
        for (const r of desc.Reservations || []) {
          for (const i of r.Instances || []) instances.push(i);
        }

        for (const inst of instances) {
          try {
            const id = inst.InstanceId;
            const now = Date.now();

            const metricCommand = new GetMetricStatisticsCommand({
              Namespace: 'AWS/EC2',
              MetricName: 'CPUUtilization',
              Dimensions: [{ Name: 'InstanceId', Value: id }],
              StartTime: new Date(now - evaluationHours * 60 * 60 * 1000),
              EndTime: new Date(now),
              Period: 3600,
              Statistics: ['Average'],
            });
            const metric = await cwClient.send(metricCommand);

            const points = metric.Datapoints || [];
            const avg = points.reduce((s, p) => s + (p.Average || 0), 0) / (points.length || 1);

            if (isExcludedByTags(inst.Tags, exclusionTags)) {
              console.log(`Instância ${id} excluída por tags. Pulando...`);
              continue;
            }

            if (avg < cpuThreshold) {
              const recommendationId = `REC#EC2#${id}`;
              const operatingSystem = inst.Platform === 'windows' ? 'Windows' : 'Linux';

              const isCoveredByRI = await isInstanceCoveredByRI(ec2Client, inst.InstanceType);

              let potentialSavings = 0;
              if (!isCoveredByRI) {
                try {
                  const instanceType = inst.InstanceType;
                  const price = await getEc2HourlyPrice(instanceType, region, operatingSystem);
                  if (price != null) {
                    const nowDate = new Date();
                    const daysInMonth = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate();
                    const hoursRemaining = (daysInMonth - nowDate.getDate()) * 24;
                    potentialSavings = parseFloat((price * hoursRemaining).toFixed(2));
                  }
                } catch (psErr) {
                  console.warn('Falha ao calcular preço EC2 via Pricing API:', psErr);
                }
              } else {
                console.log(`Instance ${id} is covered by RI, potential savings set to 0`);
              }

              const accountId = assume.AssumedRoleUser.Arn.split(':')[4];
              const putCommand = new PutCommand({
                TableName: DYNAMODB_TABLE,
                Item: {
                  id: customer.id,
                  sk: recommendationId,
                  type: 'IDLE_INSTANCE',
                  status: 'RECOMMENDED',
                  potentialSavings: potentialSavings,
                  resourceArn: `arn:aws:ec2:${region}:${accountId}:instance/${id}`,
                  region: region,
                  details: {
                    instanceId: id,
                    instanceType: inst.InstanceType,
                    launchTime: inst.LaunchTime,
                    cpuAvg: avg,
                    tags: inst.Tags || [],
                    operatingSystem: operatingSystem
                  },
                  createdAt: new Date().toISOString(),
                }
              });
              await dynamoDb.send(putCommand);

              console.log(`Cliente ${customer.id}: Recomendação criada para instância ${id} em ${region} (economia potencial: $${potentialSavings}/mês)`);
            }
          } catch (innerErr) {
            console.error('Erro ao avaliar instância:', innerErr);
          }
        }
      }
    } catch (err) {
      console.error(`Erro ao processar cliente ${customer.id}:`, err);
    }
  }

  return { status: 'completed' };
};

async function getEc2HourlyPrice(instanceType, regionCode, operatingSystem) {
  const regionNameMap = {
    'us-east-1': 'US East (N. Virginia)',
    'us-east-2': 'US East (Ohio)',
    'us-west-2': 'US West (Oregon)',
    'eu-west-1': 'EU (Ireland)',
  };
  const location = regionNameMap[regionCode] || regionCode;

  const filters = [
    { Type: 'TERM_MATCH', Field: 'instanceType', Value: instanceType },
    { Type: 'TERM_MATCH', Field: 'location', Value: location },
    { Type: 'TERM_MATCH', Field: 'operatingSystem', Value: operatingSystem },
    { Type: 'TERM_MATCH', Field: 'tenancy', Value: 'Shared' }
  ];

  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const command = new GetProductsCommand({
        ServiceCode: 'AmazonEC2',
        Filters: filters,
        MaxResults: 100
      });
      const resp = await pricing.send(command);

      const priceList = resp.PriceList || [];
      for (const p of priceList) {
        try {
          const prod = typeof p === 'string' ? JSON.parse(p) : p;
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
          console.warn('Error parsing pricing data:', e);
        }
      }
      return null;
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${attempt + 1} failed for getEc2HourlyPrice:`, error);
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  console.error('All attempts failed for getEc2HourlyPrice:', lastError);
  return null;
}

async function isInstanceCoveredByRI(ec2Client, instanceType) {
  try {
    const command = new DescribeReservedInstancesCommand({
      Filters: [
        { Name: 'instance-type', Values: [instanceType] },
        { Name: 'state', Values: ['active'] }
      ]
    });
    const resp = await ec2Client.send(command);
    return (resp.ReservedInstances || []).length > 0;
  } catch (err) {
    console.warn('Error checking RI coverage:', err);
    return false;
  }
}
