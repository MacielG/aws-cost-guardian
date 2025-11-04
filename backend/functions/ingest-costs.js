const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');
const { CostExplorerClient, GetCostAndUsageCommand } = require('@aws-sdk/client-cost-explorer');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const dynamoDb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;
const sns = new SNSClient({});

// Helper: assume role do cliente e retorna um client CostExplorer configurado
// Refinamento da detecção: aplicar threshold absoluto e comparação com mesmo dia nas últimas 4 semanas
async function getAssumedCostExplorer(roleArn, externalId) {
  if (!roleArn) throw new Error('roleArn ausente ao assumir role do cliente');

    const sts = new STSClient({});
    const assumeResp = await sts.send(new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: `cost-ingest-${Date.now()}`,
      DurationSeconds: 900,
      ExternalId: externalId,
    }));

  const creds = assumeResp.Credentials;
  if (!creds) throw new Error('Falha ao assumir role: sem credenciais retornadas');

  // Cria um cliente CostExplorer com as credenciais temporárias
  const ce = new CostExplorerClient({
    region: 'us-east-1', // Cost Explorer opera em us-east-1
    credentials: {
      accessKeyId: creds.AccessKeyId,
      secretAccessKey: creds.SecretAccessKey,
      sessionToken: creds.SessionToken,
    }
  });

  return { costExplorer: ce };
}

exports.handler = async () => {
  console.log('Iniciando ingestão diária de custos');

  // 1. Usar o novo GSI ActiveCustomerIndex para buscar clientes ativos eficientemente
  const queryParams = {
    TableName: DYNAMODB_TABLE,
    IndexName: 'ActiveCustomerIndex',
    KeyConditionExpression: 'sk = :sk AND #status = :status',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { 
      ':sk': 'CONFIG#ONBOARD',
      ':status': 'ACTIVE'
    },
  // Inclui externalId para permitir AssumeRole seguro
  ProjectionExpression: 'id, roleArn, automationSettings, externalId'
  };

  // Usar uma única query para buscar todos os clientes ativos
  const response = await dynamoDb.send(new QueryCommand(queryParams));
  const customers = response.Items || [];

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
      if (!customer.externalId) {
        console.warn(`Cliente ${customer.id} não possui externalId; pulando`);
        continue;
      }
      const { costExplorer } = await getAssumedCostExplorer(customer.roleArn, customer.externalId);

      // 3. Buscar dados de custo (últimos 30 dias, agrupados por serviço)
      const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const end = new Date().toISOString().split('T')[0];

      const costParams = {
        TimePeriod: { Start: start, End: end },
        Granularity: 'DAILY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      };

      const costData = await costExplorer.send(new GetCostAndUsageCommand(costParams));

      // 4. Salvar dados no DynamoDB
      const dataId = `COST#DASHBOARD#${new Date().toISOString().split('T')[0]}`;
      await dynamoDb.send(new PutCommand({
        TableName: DYNAMODB_TABLE,
        Item: {
          id: customer.id,
          sk: dataId,
          data: costData.ResultsByTime,
          ttl: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 90), // 90 dias
          createdAt: new Date().toISOString(),
        },
      }));

      // 4.1 Detecção simples de anomalia (estatística) nos últimos 7 dias
      try {
        const results = costData.ResultsByTime || [];
        const daily = results.map(r => parseFloat(r.Total?.UnblendedCost?.Amount || 0));
        if (daily.length >= 2) {
          const last7 = daily.slice(-7);
          const mean = last7.reduce((s, v) => s + v, 0) / last7.length;
          const variance = last7.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / last7.length;
          const stddev = Math.sqrt(variance);
          const lastDayCost = daily[daily.length - 1];

          const isStatAnomaly = lastDayCost > (mean + 3 * stddev);
          const minAbsoluteThreshold = 20; // mínimo absoluto para considerar uma anomalia

          // Média dos mesmos dias das últimas 4 semanas (se disponível)
          let prevWeeks = [];
          for (let w = 1; w <= 4; w++) {
            const idx = daily.length - 1 - (7 * w);
            if (idx >= 0) prevWeeks.push(daily[idx]);
          }
          const prevWeeksAvg = prevWeeks.length ? prevWeeks.reduce((s,v) => s+v,0)/prevWeeks.length : null;

          const weekOverWeekFactor = prevWeeksAvg ? (lastDayCost / (prevWeeksAvg || 1)) : null;

          const isAnomalyFinal = (
            (isStatAnomaly && lastDayCost > minAbsoluteThreshold) ||
            (prevWeeksAvg !== null && weekOverWeekFactor > 1.5)
          );

          if (isAnomalyFinal) {
            console.log(`ANOMALIA DETECTADA para ${customer.id}! Custo: ${lastDayCost} (média: ${mean.toFixed(2)}, stdev: ${stddev.toFixed(2)}). PrevWeeksAvg: ${prevWeeksAvg}`);

            // Salvar alerta no DynamoDB
            await dynamoDb.send(new PutCommand({
              TableName: DYNAMODB_TABLE,
              Item: {
                id: customer.id,
                sk: `ALERT#ANOMALY#${new Date().toISOString()}`,
                status: 'ACTIVE',
                details: `Custo de ${lastDayCost.toFixed(2)} excedeu a média de ${mean.toFixed(2)} (stdev ${stddev.toFixed(2)}). PrevWeeksAvg: ${prevWeeksAvg}`,
                createdAt: new Date().toISOString(),
              }
            }));

            // Publicar no SNS (se configurado)
            if (process.env.SNS_TOPIC_ARN) {
              await sns.send(new PublishCommand({
                TopicArn: process.env.SNS_TOPIC_ARN,
                Subject: `[Cost Guardian] Alerta de Anomalia de Custo Detectada para ${customer.id}`,
                Message: `Detectamos um gasto anômalo de $${lastDayCost.toFixed(2)} para o cliente ${customer.id}. Média: ${mean.toFixed(2)}, stdev: ${stddev.toFixed(2)}, PrevWeeksAvg: ${prevWeeksAvg}`
              }));
            }
          }
        }
      } catch (anErr) {
        console.error(`Falha na detecção de anomalia para ${customer.id}:`, anErr);
      }
      console.log(`Custos ingeridos para o cliente: ${customer.id}`);
    } catch (err) {
      console.error(`Falha ao ingerir custos para ${customer.id}:`, err);
    }
  }

  // Registrar heartbeat de sucesso
  try {
    await dynamoDb.send(new PutCommand({
      TableName: DYNAMODB_TABLE,
      Item: {
        id: 'SYSTEM#STATUS',
        sk: 'HEARTBEAT#COSTINGESTOR',
        lastRun: new Date().toISOString(),
        status: 'SUCCESS',
        ttl: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 7), // 7 dias
      }
    }));
  } catch (heartbeatErr) {
    console.error('Falha ao registrar heartbeat:', heartbeatErr);
  }

  console.log('Ingestão diária de custos concluída');
};
