const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const marketplace = new AWS.MarketplaceMetering();

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;

/**
 * Lambda agendada mensalmente para reportar uso ao AWS Marketplace
 * Calcula economias realizadas e reporta via BatchMeterUsage
 */
exports.handler = async (event) => {
  console.log('Iniciando Marketplace Metering Mensal');

  try {
    // Buscar todos os clientes ACTIVE com Marketplace
    const queryParams = {
      TableName: DYNAMODB_TABLE,
      IndexName: 'ActiveCustomerIndex',
      KeyConditionExpression: 'sk = :sk AND #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':sk': 'CONFIG#ONBOARD',
        ':status': 'ACTIVE',
      },
      FilterExpression: 'attribute_exists(marketplaceCustomerId)',
      ProjectionExpression: 'id, marketplaceCustomerId, marketplaceProductCode',
    };

    const result = await dynamoDb.query(queryParams).promise();
    const customers = result.Items || [];

    console.log(`Processando ${customers.length} clientes Marketplace`);

    const usageRecords = [];
    const now = new Date();
    const timestamp = now.toISOString();

    for (const customer of customers) {
      try {
        // Buscar recomendações executadas no último mês
        const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        
        const recParams = {
          TableName: DYNAMODB_TABLE,
          KeyConditionExpression: 'id = :userId AND begins_with(sk, :prefix)',
          FilterExpression: '#status = :executed AND executedAt >= :since',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':userId': customer.id,
            ':prefix': 'REC#',
            ':executed': 'EXECUTED',
            ':since': oneMonthAgo.toISOString(),
          },
        };

        const recResult = await dynamoDb.query(recParams).promise();
        const executedRecs = recResult.Items || [];

        // Calcular valor total economizado
        const totalSavings = executedRecs.reduce((sum, rec) => 
          sum + (rec.potentialSavings || 0), 0
        );

        // Buscar SLA claims refunded no último mês
        const claimParams = {
          TableName: DYNAMODB_TABLE,
          KeyConditionExpression: 'id = :userId AND begins_with(sk, :prefix)',
          FilterExpression: '#status = :refunded AND refundedAt >= :since',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':userId': customer.id,
            ':prefix': 'SLA#',
            ':refunded': 'REFUNDED',
            ':since': oneMonthAgo.toISOString(),
          },
        };

        const claimResult = await dynamoDb.query(claimParams).promise();
        const refundedClaims = claimResult.Items || [];

        const totalCredits = refundedClaims.reduce((sum, claim) => 
          sum + (claim.creditAmount || 0), 0
        );

        const totalValue = totalSavings + totalCredits;

        // Apenas reportar se houver valor
        if (totalValue > 0) {
          // Nossa comissão: 30%
          const commission = totalValue * 0.30;

          usageRecords.push({
            CustomerIdentifier: customer.marketplaceCustomerId,
            Dimension: 'SavingsRealized', // Nome da dimensão no Marketplace
            Quantity: Math.ceil(commission), // AWS Marketplace aceita inteiros
            Timestamp: timestamp,
          });

          console.log(`Cliente ${customer.id}: $${commission.toFixed(2)} de comissão`);

          // Salvar registro de billing no DynamoDB
          const billingId = `BILLING#${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          await dynamoDb.put({
            TableName: DYNAMODB_TABLE,
            Item: {
              id: customer.id,
              sk: billingId,
              type: 'MONTHLY_BILLING',
              period: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
              totalSavings,
              totalCredits,
              totalValue,
              commission,
              reportedToMarketplace: true,
              reportedAt: timestamp,
              usageRecords: {
                savings: executedRecs.length,
                claims: refundedClaims.length,
              },
            },
          }).promise();
        }

      } catch (customerErr) {
        console.error(`Erro ao processar cliente ${customer.id}:`, customerErr);
      }
    }

    // Reportar ao AWS Marketplace em batch
    if (usageRecords.length > 0) {
      // Marketplace aceita até 25 registros por chamada
      const batches = [];
      for (let i = 0; i < usageRecords.length; i += 25) {
        batches.push(usageRecords.slice(i, i + 25));
      }

      for (const batch of batches) {
        const meteringParams = {
          ProductCode: process.env.MARKETPLACE_PRODUCT_CODE,
          UsageRecords: batch,
        };

        const meteringResult = await marketplace.batchMeterUsage(meteringParams).promise();
        
        console.log('Marketplace metering result:', {
          successful: meteringResult.Results?.length || 0,
          failed: meteringResult.UnprocessedRecords?.length || 0,
        });

        // Logar falhas
        if (meteringResult.UnprocessedRecords?.length > 0) {
          console.error('Unprocessed records:', meteringResult.UnprocessedRecords);
        }
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Metering completo',
        customersProcessed: customers.length,
        usageRecordsReported: usageRecords.length,
      }),
    };

  } catch (error) {
    console.error('Erro no metering:', error);
    throw error;
  }
};
