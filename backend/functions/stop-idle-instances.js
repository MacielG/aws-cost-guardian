const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const sts = new AWS.STS();
const ec2 = new AWS.EC2();
const cloudwatch = new AWS.CloudWatch();

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;

exports.handler = async (event) => {
  console.log('Executando automação: Parar Instâncias Ociosas');

  // 1. Recuperar clientes com CONFIG#ONBOARD onde automation.stopIdle = true
  // Use Query on StatusIndex to efficiently fetch ACTIVE configs, then filter by automation.stopIdle
  const queryParamsBase = {
    TableName: DYNAMODB_TABLE,
    IndexName: 'StatusIndex',
    KeyConditionExpression: '#status = :status',
    ExpressionAttributeNames: { '#status': 'status', '#automation': 'automation', '#stopIdle': 'stopIdle' },
    ExpressionAttributeValues: { ':status': 'ACTIVE', ':sk': 'CONFIG#ONBOARD', ':trueVal': true },
    FilterExpression: 'sk = :sk AND #automation.#stopIdle = :trueVal',
    ProjectionExpression: 'id, roleArn',
  };

  let items = [];
  let ExclusiveStartKey;
  do {
    const p = Object.assign({}, queryParamsBase);
    if (ExclusiveStartKey) p.ExclusiveStartKey = ExclusiveStartKey;
    const resp = await dynamoDb.query(p).promise();
    items = items.concat(resp.Items || []);
    ExclusiveStartKey = resp.LastEvaluatedKey;
  } while (ExclusiveStartKey);

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
          if (avg < 5) {
            console.log(`Instância ${id} do cliente ${customer.id} está ociosa (CPU avg ${avg}). Parando...`);
            // Aqui chamaria ec2Client.stopInstances({ InstanceIds: [id] })
            // Comentado por segurança em ambiente de desenvolvimento
            // await ec2Client.stopInstances({ InstanceIds: [id] }).promise();
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
