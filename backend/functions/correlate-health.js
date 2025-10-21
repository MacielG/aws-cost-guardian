const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const { Health } = require('@aws-sdk/client-health');

exports.handler = async (event) => {
  const healthEvent = event.detail;
  const customerId = 'from-event'; // Extraia do contexto

  // Armazena no DynamoDB
  await dynamoDb.put({
    TableName: process.env.DYNAMODB_TABLE,
    Item: {
      id: `health-${healthEvent.id}`,
      customerId,
      timestamp: healthEvent.startTime,
      service: healthEvent.service,
      affectedResources: healthEvent.resources || [],
      status: 'correlated',
    },
  }).promise();

  // Correlaciona com custos
  const { CostExplorer } = require('@aws-sdk/client-cost-explorer');
  const ce = new CostExplorer({ region: 'us-east-1' });
  const costData = await ce.getCostAndUsageWithResources({
    TimePeriod: {
      Start: healthEvent.startTime,
      End: healthEvent.endTime || new Date().toISOString(),
    },
    Granularity: 'DAILY',
    Metrics: ['UnblendedCost'],
    Filter: {
      Dimensions: {
        Key: 'SERVICE',
        Values: [healthEvent.service],
      },
    },
  });

  const impactedCost = costData.ResultsByTime[0]?.Total?.UnblendedCost?.Amount || 0;

  // Gera alerta (envie via SNS/SES)
  console.log(`Alerta: ${healthEvent.summary} impactou $${impactedCost}`);

  // Trigger Step Functions para SLA se aplicável
  const sfn = new AWS.StepFunctions();
  await sfn.startExecution({
    stateMachineArn: process.env.SFN_ARN, // De CDK output
    input: JSON.stringify({ event: healthEvent, impactedCost }),
  }).promise();

  return { status: 'success', impactedCost };
};