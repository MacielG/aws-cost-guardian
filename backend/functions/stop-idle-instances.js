const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const sts = new AWS.STS();
const ec2 = new AWS.EC2();
const cloudwatch = new AWS.CloudWatch();

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
            // Estimativa simples de economia potencial (placeholder):
            // assumimos uma economia mensal dependendo do tipo da instância (valor conservador)
            const potentialSavings = parseFloat((inst.InstanceType && inst.InstanceType.includes('t3') ? 5.00 : 10.00).toFixed(2));

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
