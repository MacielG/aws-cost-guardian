// Múltiplas exports para tasks do Step Functions

// calculateImpact
exports.calculateImpact = async (event) => {
  const { affectedResources, timePeriod } = JSON.parse(event.input);
  // Use CostExplorer para somar
  // Simulado
  return {
    impactedCost: 150.50,
    slaThreshold: 0.001, // 99.99%
  };
};

// checkSLA
exports.checkSLA = async (event) => {
  const { impactedCost, duration, service } = event;
  // Lógica por serviço (ex.: RDS SLA 99.99%)
  const violation = duration > slaThreshold * 30 * 24 * 60; // Mensal em min
  const credit = violation ? impactedCost * 0.1 : 0; // 10% típico
  return { violation, credit };
};

// generateReport
exports.generateReport = async (event) => {
  const { violation, credit, details } = event;
  if (!violation) return { status: 'no-claim' };
  // Gere PDF via pdf-lib ou HTML to PDF (Lambda layer)
  // Salve em S3, retorne URL
  const reportUrl = `s3://bucket/report-${Date.now()}.pdf`;
  // Salve claim em DB
  await dynamoDb.put({
    TableName: process.env.DYNAMODB_TABLE,
    Item: {
      id: `sla-${Date.now()}`,
      ...details,
      credit,
      status: 'ready',
      reportUrl,
    },
  }).promise();
  return { reportUrl, status: 'generated' };
};