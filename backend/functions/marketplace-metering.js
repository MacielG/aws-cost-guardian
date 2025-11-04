const { MarketplaceMeteringClient, MeterUsageCommand } = require('@aws-sdk/client-marketplace-metering');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, UpdateCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const ddbClient = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(ddbClient);
const metering = new MarketplaceMeteringClient({});

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;

export const handler = async (event) => {
  console.log('Marketplace Metering Lambda triggered');

  try {
    // Buscar todos os clientes ACTIVE
    const activeCustomersParams = {
      TableName: DYNAMODB_TABLE,
      IndexName: 'ActiveCustomerIndex',
      KeyConditionExpression: 'sk = :sk',
      FilterExpression: 'subscriptionStatus = :status',
      ExpressionAttributeValues: {
        ':sk': 'CONFIG#ONBOARD',
        ':status': 'active',
      },
    };

    const activeCustomers = await dynamoDb.send(new QueryCommand(activeCustomersParams));
    const customers = activeCustomers.Items || [];

    for (const customer of customers) {
      const customerId = customer.id;
      const marketplaceCustomerId = customer.marketplaceCustomerId;

      if (!marketplaceCustomerId) {
        console.log(`Cliente ${customerId} não tem marketplaceCustomerId, pulando`);
        continue;
      }

      const lastMeteringAt = customer.lastMeteringAt || '2020-01-01T00:00:00.000Z'; // Antigo se não existir

      // Buscar SAVING# items não metrificados
      const savingsParams = {
      TableName: DYNAMODB_TABLE,
      KeyConditionExpression: 'id = :id AND begins_with(sk, :prefix)',
      FilterExpression: 'attribute_not_exists(meteredAt)',
      ExpressionAttributeValues: {
      ':id': customerId,
      ':prefix': 'SAVING#',
      },
      };

      const savingsResult = await dynamoDb.send(new QueryCommand(savingsParams));
      const savings = savingsResult.Items || [];

      // Calcular valor das economias: amountPerHour * horas desde timestamp
      let totalSavingsValue = 0;
      const now = new Date();
      for (const saving of savings) {
        const hours = (now - new Date(saving.timestamp)) / (1000 * 60 * 60);
        totalSavingsValue += saving.amountPerHour * hours;
      }

      // Buscar CLAIM#RECOVERED não metrificados
      const claimsParams = {
      TableName: DYNAMODB_TABLE,
      KeyConditionExpression: 'id = :id AND begins_with(sk, :prefix)',
      FilterExpression: '#status = :status AND attribute_not_exists(meteredAt)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
      ':id': customerId,
      ':prefix': 'CLAIM#',
      ':status': 'RECOVERED',
      },
      };

      const claimsResult = await dynamoDb.send(new QueryCommand(claimsParams));
      const claims = claimsResult.Items || [];

      // Somar recoveredAmount
      let totalCreditsValue = 0;
      for (const claim of claims) {
        totalCreditsValue += claim.recoveredAmount || 0;
      }

      const totalValue = totalSavingsValue + totalCreditsValue;

      if (totalValue > 0) {
        // Chamar meterUsage
        const meterCommand = new MeterUsageCommand({
          ProductCode: process.env.PRODUCT_CODE, // Definir no env
          UsageDimension: 'SavingsRealized', // Ou 'SLACreditsRecovered', mas para simplificar
          UsageQuantity: Math.round(totalValue * 100), // Em centavos ou unidades
          CustomerIdentifier: marketplaceCustomerId,
          Timestamp: now,
        });

        await metering.send(meterCommand);
        console.log(`Metered ${totalValue} for customer ${marketplaceCustomerId}`);

        // Marcar savings como metrificados
          for (const saving of savings) {
            await dynamoDb.send(new UpdateCommand({
            TableName: DYNAMODB_TABLE,
            Key: { id: saving.id, sk: saving.sk },
            UpdateExpression: 'SET meteredAt = :now',
            ExpressionAttributeValues: { ':now': now.toISOString() },
            }));
        }

        // Marcar claims como metrificados
        for (const claim of claims) {
          await dynamoDb.send(new UpdateCommand({
            TableName: DYNAMODB_TABLE,
            Key: { id: claim.id, sk: claim.sk },
            UpdateExpression: 'SET meteredAt = :now',
            ExpressionAttributeValues: { ':now': now.toISOString() },
          }));
        }
      }

      // Atualizar lastMeteringAt
      await dynamoDb.send(new UpdateCommand({
        TableName: DYNAMODB_TABLE,
        Key: { id: customerId, sk: 'CONFIG#ONBOARD' },
        UpdateExpression: 'SET lastMeteringAt = :now',
        ExpressionAttributeValues: { ':now': now.toISOString() },
      }));
    }

    // Registrar heartbeat de sucesso
    try {
      await dynamoDb.send(new PutCommand({
        TableName: DYNAMODB_TABLE,
        Item: {
          id: 'SYSTEM#STATUS',
          sk: 'HEARTBEAT#MARKETPLACEMETERING',
          lastRun: new Date().toISOString(),
          status: 'SUCCESS'
        }
      }));
    } catch (heartbeatErr) {
      console.error('Falha ao registrar heartbeat:', heartbeatErr);
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: 'Metering completed'
    };
  } catch (error) {
    console.error('Erro no metering:', error);
    throw error;
  }
};
