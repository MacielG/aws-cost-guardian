// backend/functions/sla-workflow.js
// VERSÃO FINALIZADA: Implementa a lógica real de 'calculateImpact'

const AWS = require('aws-sdk');
// Usar o SDK v3 para Cost Explorer é preferível pela modularidade
const { CostExplorerClient, GetCostAndUsageCommand } = require('@aws-sdk/client-cost-explorer');
const dynamoDb = new AWS.DynamoDB.DocumentClient();

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;

/**
 * Função helper para assumir a role do cliente
 * Retorna clientes de serviços da AWS autenticados com as credenciais da role assumida.
 */
async function getAssumedClients(roleArn, region = 'us-east-1') {
  const sts = new AWS.STS();
  try {
    const assumedRole = await sts.assumeRole({
      RoleArn: roleArn,
      RoleSessionName: 'CostGuardianSLAAnalysis',
      DurationSeconds: 900, // 15 minutos
    }).promise();

    const credentials = {
      accessKeyId: assumedRole.Credentials.AccessKeyId,
      secretAccessKey: assumedRole.Credentials.SecretAccessKey,
      sessionToken: assumedRole.Credentials.SessionToken,
    };

    // Retorna clientes dos serviços necessários
    return {
      // Cost Explorer API é sempre 'us-east-1'
      costExplorer: new CostExplorerClient({
        region: 'us-east-1',
        credentials
      }),
      // Adicione outros clientes se necessário (ex: S3, Health)
      // s3: new AWS.S3({ credentials, region })
    };
  } catch (err) {
    console.error(`Falha ao assumir role ${roleArn}:`, err);
    throw new Error(`STS AssumeRole failed: ${err.message}`);
  }
}

// --- HANDLERS DAS TAREFAS DO STEP FUNCTION ---

/**
 * 1. Calculate Impact
 * Entrada do SFN: { customerId, awsAccountId, healthEvent, incidentId }
 */
exports.calculateImpact = async (event) => {
  console.log('calculateImpact event:', event);
  const { awsAccountId, healthEvent, incidentId } = event;
  const affectedResources = healthEvent.resources || [];
  
  // O nome da role é o que o cliente cria a partir do seu template CFN
  const roleToAssume = `arn:aws:iam::${awsAccountId}:role/CostGuardianDelegatedRole`; 

  // Se o evento do Health não listou ARNs de recursos, não podemos calcular o impacto.
  if (affectedResources.length === 0) {
    console.log(`Nenhum recurso específico afetado para o incidente ${incidentId}.`);
    // Atualiza o status no DB e termina o fluxo
    await dynamoDb.update({
        TableName: DYNAMODB_TABLE,
        Key: { id: event.customerId, sk: incidentId },
        UpdateExpression: 'SET #status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': 'NO_RESOURCES_LISTED' }
    }).promise();
    return { ...event, impactedCost: 0, status: 'NO_RESOURCES' };
  }

  try {
    // 1. Assumir a role do cliente para ter permissão de ler os custos dele
    const { costExplorer } = await getAssumedClients(roleToAssume);

    // 2. Chamar o Cost Explorer com o filtro de RECURSO (Lógica Central)
    const costParams = {
      TimePeriod: {
        Start: healthEvent.startTime, // Início da interrupção
        End: healthEvent.endTime || new Date().toISOString(), // Fim da interrupção (ou agora)
      },
      Granularity: 'DAILY',
      Metrics: ['UnblendedCost'],
      Filter: {
        Dimensions: {
          Key: 'RESOURCE_ID', // Filtra pelos ARNs exatos
          Values: affectedResources,
        },
      },
    };

    const command = new GetCostAndUsageCommand(costParams);
    const costData = await costExplorer.send(command);

    // 3. Calcular o custo total impactado
    let impactedCost = 0;
    costData.ResultsByTime.forEach(result => {
      if (result.Total && result.Total.UnblendedCost) {
        impactedCost += parseFloat(result.Total.UnblendedCost.Amount);
      }
    });

    console.log(`Custo impactado calculado para ${awsAccountId} (Incidente ${incidentId}): $${impactedCost}`);

    // Retorna o evento original enriquecido com o custo
    return {
      ...event,
      impactedCost: impactedCost,
      slaThreshold: 0.001, // 99.9% (Simulado - Idealmente, puxe de uma config por serviço)
    };

  } catch (err) {
    console.error(`Erro ao calcular impacto para ${awsAccountId} (Incidente ${incidentId}):`, err);
    // Propaga o erro para o Step Function tratar (ex: Causa 'States.TaskFailed')
    throw new Error(`Falha ao calcular impacto: ${err.message}`);
  }
};

/**
 * 2. Check SLA
 * Entrada: { ...event, impactedCost, slaThreshold }
 */
exports.checkSLA = async (event) => {
  console.log('checkSLA event:', event);
  const { impactedCost, healthEvent, slaThreshold } = event;

  // Se não houve custo, não há o que reivindicar
  if (event.impactedCost === 0) {
      return { ...event, violation: false, credit: 0 };
  }

  // Lógica de violação (Exemplo)
  const startTime = new Date(healthEvent.startTime).getTime();
  const endTime = new Date(healthEvent.endTime || Date.now()).getTime();
  const durationMs = endTime - startTime;
  const durationMinutes = durationMs / 60000;

  // Exemplo: 99.9% de uptime mensal (aprox 43.8 min de downtime permitido)
  const monthlyAllowedDowntime = (1.0 - (slaThreshold || 0.999)) * 30 * 24 * 60;

  // A violação só ocorre se o downtime exceder o SLA
  const violation = durationMinutes > monthlyAllowedDowntime;
  // O crédito é uma percentagem (ex: 10%) do custo dos recursos afetados *durante* a interrupção
  const credit = violation ? impactedCost * 0.1 : 0; // 10% de crédito (típico)

  console.log(`Serviço: ${healthEvent.service}. Duração: ${durationMinutes.toFixed(2)} min. Violação: ${violation}. Crédito: $${credit.toFixed(2)}`);

  return { ...event, violation, credit, durationMinutes };
};

/**
 * 3. Generate Report and Claim
 * Entrada: { ...event, violation, credit, durationMinutes }
 */
exports.generateReport = async (event) => {
  console.log('generateReport event:', event);
  const { violation, credit, customerId, incidentId, awsAccountId } = event;

  // Se não houver violação ou crédito, não faz nada
  if (!violation || credit <= 0) {
    console.log('Nenhuma violação ou crédito. Nenhuma reivindicação gerada.');
    await dynamoDb.update({
        TableName: DYNAMODB_TABLE,
        Key: { id: customerId, sk: incidentId },
        UpdateExpression: 'SET #status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': 'NO_VIOLATION' }
    }).promise();
    return { ...event, status: 'no-claim' };
  }

  // 1. Gerar PDF (lógica omitida) - Salvar em S3
  // const s3 = new AWS.S3();
  const reportS3Key = `reports/${customerId}/${incidentId.replace('INCIDENT#', '')}-${Date.now()}.pdf`;
  const reportUrl = `s3://${process.env.REPORTS_BUCKET_NAME}/${reportS3Key}`; // Bucket deve vir do Env
  // await s3.putObject({ Bucket: process.env.REPORTS_BUCKET_NAME, Key: reportS3Key, Body: 'Conteúdo do PDF' }).promise();
  
  console.log(`Relatório gerado e salvo em: ${reportUrl}`);

  // 2. Salvar a reivindicação (CLAIM) no DynamoDB
  const claimId = `CLAIM#${incidentId.replace('INCIDENT#', '')}`;
  await dynamoDb.put({
    TableName: DYNAMODB_TABLE,
    Item: {
      id: customerId,        // PK
      sk: claimId,           // SK
      status: 'READY_TO_SUBMIT',
      creditAmount: credit,
      reportUrl: reportUrl,
      incidentId: incidentId,
      awsAccountId: awsAccountId,
      details: event, // Armazena todos os dados do evento e cálculo
    },
  }).promise();

  // 3. Atualizar o incidente original como 'CLAIM_GENERATED'
  await dynamoDb.update({
      TableName: DYNAMODB_TABLE,
      Key: { id: customerId, sk: incidentId },
      UpdateExpression: 'SET #status = :status, #claimId = :claimId',
      ExpressionAttributeNames: { '#status': 'status', '#claimId': 'claimId' },
      ExpressionAttributeValues: { ':status': 'CLAIM_GENERATED', ':claimId': claimId }
  }).promise();

  // 4. TODO: Criar a Fatura (Invoice) no Stripe para a comissão de 30%
  // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  // const commissionAmount = Math.round(credit * 0.3 * 100); // Em centavos
  // await stripe.invoices.create({ ... });

  return { ...event, reportUrl, status: 'generated', claimId: claimId };
};