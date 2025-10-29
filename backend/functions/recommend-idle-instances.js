import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { EC2Client, DescribeInstancesCommand, DescribeReservedInstancesCommand } from '@aws-sdk/client-ec2';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { PricingClient, GetProductsCommand } from '@aws-sdk/client-pricing';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const ddbClient = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(ddbClient);
const sts = new STSClient({});
const pricing = new PricingClient({ region: 'us-east-1' });
const sns = new SNSClient({});

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

export const recommendIdleInstancesHandler = async (event) => {
  console.log('Executando automação: Recomendar Instâncias Ociosas (v3)');

  const queryParams = {
    TableName: DYNAMODB_TABLE,
    IndexName: 'ActiveCustomerIndex',
    KeyConditionExpression: 'sk = :sk',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#automationSettings': 'automationSettings',
      '#stopIdleInstances': 'stopIdleInstances'
    },
    ExpressionAttributeValues: {
      ':sk': 'CONFIG#ONBOARD',
      ':true': true
    },
    FilterExpression: '#automationSettings.#stopIdleInstances = :true',
    ProjectionExpression: 'id, roleArn, automationSettings, exclusionTags, #status'
  };

  const response = await dynamoDb.send(new QueryCommand(queryParams));
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
      const assumeCommand = new AssumeRoleCommand({ 
        RoleArn: customer.roleArn, 
        RoleSessionName: `recommend-idle-${customer.id}-${Date.now()}`, 
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
      const cwClient = new CloudWatchClient({ 
        credentials: {
          accessKeyId: creds.AccessKeyId,
          secretAccessKey: creds.SecretAccessKey,
          sessionToken: creds.SessionToken,
        },
        region: 'us-east-1'
      });

      const descCommand = new DescribeInstancesCommand({ 
        Filters: [
          { Name: 'tag:Environment', Values: ['dev','staging'] }, 
          { Name: 'instance-state-name', Values: ['running'] }
        ] 
      });
      const desc = await ec2Client.send(descCommand);
      
      const instances = [];
      for (const r of desc.Reservations || []) {
        for (const i of r.Instances || []) instances.push(i);
      }

      for (const inst of instances) {
        try {
          const id = inst.InstanceId;
          const now = new Date();
          
          const metricCommand = new GetMetricStatisticsCommand({
            Namespace: 'AWS/EC2',
            MetricName: 'CPUUtilization',
            Dimensions: [{ Name: 'InstanceId', Value: id }],
            StartTime: new Date(now.getTime() - 24 * 60 * 60 * 1000),
            EndTime: now,
            Period: 3600,
            Statistics: ['Average'],
          });
          const metric = await cwClient.send(metricCommand);

          const points = metric.Datapoints || [];
          const avg = points.reduce((s,p)=>s+(p.Average||0),0) / (points.length||1);
          
          if (isExcluded(inst.Tags, customer.automationSettings?.exclusionTags)) {
            console.log(`Instância ${id} excluída por tags. Pulando...`);
            continue;
          }

          if (avg < 5) {
            const recommendationId = `REC#EC2#${id}`;
            const operatingSystem = inst.Platform === 'windows' ? 'Windows' : 'Linux';

            // Check if instance is covered by Reserved Instances
            const isCoveredByRI = await isInstanceCoveredByRI(ec2Client, inst.InstanceType);

            let potentialSavings = 0;
            if (!isCoveredByRI) {
              try {
                const price = await getEc2HourlyPrice(inst.InstanceType, 'us-east-1', operatingSystem);
                if (price != null) {
                  const hoursRemaining = (new Date(now.getFullYear(), now.getMonth()+1, 0).getDate() - now.getDate()) * 24;
                  potentialSavings = parseFloat((price * hoursRemaining).toFixed(2));
                }
              } catch (psErr) {
                console.warn('Falha ao calcular preço EC2 via Pricing API:', psErr);
              }
            } else {
              console.log(`Instance ${id} is covered by RI, potential savings set to 0`);
            }

            const putCommand = new PutCommand({
              TableName: DYNAMODB_TABLE,
              Item: {
                id: customer.id,
                sk: recommendationId,
                type: 'IDLE_INSTANCE',
                status: 'RECOMMENDED',
                potentialSavings: potentialSavings,
                resourceArn: `arn:aws:ec2:us-east-1:${assume.AssumedRoleUser.Arn.split(':')[4]}:instance/${id}`,
                details: {
                  instanceId: id,
                  instanceType: inst.InstanceType,
                  launchTime: inst.LaunchTime.toISOString(),
                  cpuAvg: avg,
                  tags: inst.Tags || [],
                  operatingSystem: operatingSystem
                },
                createdAt: now.toISOString(),
              }
            });
            await dynamoDb.send(putCommand);

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

  // Check for high-value leads
  for (const customer of items) {
    if (!customer.roleArn) continue;

    try {
      // Query all REC# items for the customer
      const recQuery = {
        TableName: DYNAMODB_TABLE,
        KeyConditionExpression: 'id = :id AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':id': customer.id,
          ':prefix': 'REC#',
        },
      };

      const recResult = await dynamoDb.send(new QueryCommand(recQuery));
      const recommendations = recResult.Items || [];

      const totalPotentialSavings = recommendations.reduce((sum, rec) => sum + (rec.potentialSavings || 0), 0);

      if (totalPotentialSavings > 500) { // High-value threshold
        console.log(`High-value lead detected for customer ${customer.id}: $${totalPotentialSavings.toFixed(2)} potential savings`);

        // Publish to SNS
        if (process.env.SNS_TOPIC_ARN) {
          await sns.send(new PublishCommand({
            TopicArn: process.env.SNS_TOPIC_ARN,
            Subject: `[Cost Guardian] High-Value Lead: ${customer.id}`,
            Message: `Cliente ${customer.id} tem $${totalPotentialSavings.toFixed(2)} em economia potencial mensal. Conta TRIAL detectada como lead de alto valor.`
          }));
        }
      }
    } catch (err) {
      console.error(`Erro ao verificar high-value para ${customer.id}:`, err);
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
    // Add more regions as needed
  };
  const location = regionNameMap[regionCode] || regionCode; // Fallback to regionCode if not mapped

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
      return null; // No price found
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${attempt + 1} failed for getEc2HourlyPrice:`, error);
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
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
    // If there are active RIs for this type, assume it's covered
    return (resp.ReservedInstances || []).length > 0;
  } catch (err) {
    console.warn('Error checking RI coverage:', err);
    return false;
  }
}
