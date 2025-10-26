const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const sts = new AWS.STS();
const CostExplorer = AWS.CostExplorer;

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;

// Helper: assume role do cliente e retorna um client CostExplorer configurado
async function getAssumedCostExplorer(roleArn) {
  if (!roleArn) throw new Error('roleArn ausente ao assumir role do cliente');

  const assumeResp = await sts.assumeRole({
    RoleArn: roleArn,
    RoleSessionName: `cost-ingest-${Date.now()}`,
    DurationSeconds: 900,
  }).promise();

  const creds = assumeResp.Credentials;
  if (!creds) throw new Error('Falha ao assumir role: sem credenciais retornadas');

  // Cria um cliente CostExplorer com as credenciais temporárias
  const ce = new CostExplorer({
    accessKeyId: creds.AccessKeyId,
    secretAccessKey: creds.SecretAccessKey,
    sessionToken: creds.SessionToken,
    region: 'us-east-1', // Cost Explorer opera em us-east-1
  });

  return { costExplorer: ce };
}

exports.handler = async () => {
  console.log('Iniciando ingestão diária de custos');

  // 1. Paginar scan para encontrar clientes com sk = CONFIG#ONBOARD e status = ACTIVE
  // Use Query on StatusIndex to efficiently fetch ACTIVE configs (then filter by sk)
  const queryParamsBase = {
    TableName: DYNAMODB_TABLE,
    IndexName: 'StatusIndex',
    KeyConditionExpression: '#status = :status',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':status': 'ACTIVE', ':sk': 'CONFIG#ONBOARD' },
    FilterExpression: 'sk = :sk',
    ProjectionExpression: 'id, roleArn',
  };

  let customers = [];
  let ExclusiveStartKey;
  do {
    const p = Object.assign({}, queryParamsBase);
    if (ExclusiveStartKey) p.ExclusiveStartKey = ExclusiveStartKey;
    const resp = await dynamoDb.query(p).promise();
    customers = customers.concat(resp.Items || []);
    ExclusiveStartKey = resp.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  if (!customers || customers.length === 0) {
    console.log('Nenhum cliente ativo encontrado para ingestão de custos.');
    return;
  }

  // 2. Iterar sobre os clientes
  for (const customer of customers) {
    if (!customer.roleArn) {
      console.warn(`Cliente ${customer.id} não possui roleArn; pulando`);
      continue;
    }

    try {
      const { costExplorer } = await getAssumedCostExplorer(customer.roleArn);

      // 3. Buscar dados de custo (últimos 30 dias, agrupados por serviço)
      const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const end = new Date().toISOString().split('T')[0];

      const costParams = {
        TimePeriod: { Start: start, End: end },
        Granularity: 'DAILY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      };

      const costData = await costExplorer.getCostAndUsage(costParams).promise();

      // 4. Salvar dados no DynamoDB
      const dataId = `COST#DASHBOARD#${new Date().toISOString().split('T')[0]}`;
      await dynamoDb.put({
        TableName: DYNAMODB_TABLE,
        Item: {
          id: customer.id,
          sk: dataId,
          data: costData.ResultsByTime,
          ttl: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 90), // 90 dias
          createdAt: new Date().toISOString(),
        },
      }).promise();

      console.log(`Custos ingeridos para o cliente: ${customer.id}`);
    } catch (err) {
      console.error(`Falha ao ingerir custos para ${customer.id}:`, err);
    }
  }

  console.log('Ingestão diária de custos concluída');
};
