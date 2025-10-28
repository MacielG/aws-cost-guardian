import { MarketplaceMeteringClient, MeterUsageCommand } from '@aws-sdk/client-marketplace-metering';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

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

      // Buscar SAVING# items desde lastMeteringAt
      const savingsParams = {
        TableName: DYNAMODB_TABLE,
        KeyConditionExpression: 'id = :id AND begins_with(sk, :prefix)',
        FilterExpression: 'timestamp > :last',
        ExpressionAttributeValues: {
          ':id': customerId,
          ':prefix': 'SAVING#',
          ':last': lastMeteringAt,
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

      // Buscar CLAIM#RECOVERED items desde lastMeteringAt
      const claimsParams = {
        TableName: DYNAMODB_TABLE,
        KeyConditionExpression: 'id = :id AND begins_with(sk, :prefix)',
        FilterExpression: '#status = :status AND recoveredAt > :last',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':id': customerId,
          ':prefix': 'CLAIM#',
          ':status': 'RECOVERED',
          ':last': lastMeteringAt,
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
      }

      // Atualizar lastMeteringAt
      await dynamoDb.send(new UpdateCommand({
        TableName: DYNAMODB_TABLE,
        Key: { id: customerId, sk: 'CONFIG#ONBOARD' },
        UpdateExpression: 'SET lastMeteringAt = :now',
        ExpressionAttributeValues: { ':now': now.toISOString() },
      }));
    }

    return { statusCode: 200, body: 'Metering completed' };
  } catch (error) {
    console.error('Erro no metering:', error);
    throw error;
  }
};
