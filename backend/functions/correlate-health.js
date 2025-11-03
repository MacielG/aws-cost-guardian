// backend/functions/correlate-health.js

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { CostExplorer } = require('@aws-sdk/client-cost-explorer');
const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');

const ce = new CostExplorer({ region: 'us-east-1' });
const ddbClient = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(ddbClient);
const sfn = new SFNClient({});
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;
const SFN_ARN = process.env.SFN_ARN;

exports.handler = async (event) => {
  const healthEvent = event.detail;
  const affectedAccount = healthEvent.affectedAccount; // ID da conta AWS do cliente
  const affectedResources = healthEvent.resources || []; // ARNs dos recursos

  // 1. Encontrar nosso customerId usando o ID da conta AWS do cliente
  // Esta query usa o GSI 'AwsAccountIndex' definido no CDK
  const queryParams = {
    TableName: DYNAMODB_TABLE,
    IndexName: 'AwsAccountIndex',
    KeyConditionExpression: 'awsAccountId = :awsAccountId',
    ExpressionAttributeValues: {
      ':awsAccountId': affectedAccount,
    },
    ProjectionExpression: 'id', // 'id' é o nosso customerId
  };

  let customerId;
  try {
    const data = await dynamoDb.send(new QueryCommand(queryParams));
    if (!data.Items || data.Items.length === 0) {
      console.error(`Nenhum cliente encontrado para AWS Account ID: ${affectedAccount}`);
      return { status: 'error', reason: 'Customer not found' };
    }
    customerId = data.Items[0].id; // Encontramos nosso cliente!
  } catch (err) {
    console.error('Erro ao consultar DynamoDB:', err);
    return { status: 'error', reason: 'DB query failed' };
  }

  // 2. Armazenar o incidente no DynamoDB (agora com o customerId correto)
  const incidentId = `INCIDENT#${healthEvent.id}`;
  const timestamp = healthEvent.startTime || new Date().toISOString();
  await dynamoDb.send(new PutCommand({
    TableName: DYNAMODB_TABLE,
    Item: {
      id: customerId, // PK: Nosso Customer ID
      sk: incidentId, // SK: ID do incidente
      timestamp: timestamp,
      service: healthEvent.service,
      affectedResources: affectedResources,
      status: 'correlated',
      awsAccountId: affectedAccount,
      details: healthEvent, // Armazena o evento completo
    },
  }));

  // 3. Correlacionar com custos (lógica movida para o Step Function 'calculateImpact')
  // O Lambda do EventBridge deve ser rápido. Ele apenas identifica o cliente,
  // armazena o incidente e inicia o fluxo de trabalho.
  // A chamada ao Cost Explorer (que é lenta) deve ser a primeira etapa do Step Function.

  if (!SFN_ARN) {
      console.error('ARN do Step Function não definido');
      return { status: 'error', reason: 'SFN_ARN not set' };
  }

  // 4. Iniciar o Step Function para análise de impacto
  await sfn.send(new StartExecutionCommand({
    stateMachineArn: SFN_ARN,
    input: JSON.stringify({
      customerId: customerId,
      awsAccountId: affectedAccount,
      healthEvent: healthEvent,
      incidentId: incidentId
    }),
  }));

  return { status: 'success', customerId: customerId, incidentId: incidentId };
};