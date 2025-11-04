// backend/functions/sla-workflow.js
// VERSÃO FINALIZADA: Implementa a lógica real de 'calculateImpact'

// SDK v3 clients (modulares)
const { CostExplorerClient, GetCostAndUsageCommand } = require('@aws-sdk/client-cost-explorer');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SupportClient, CreateCaseCommand } = require('@aws-sdk/client-support');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

// clients
const ddbClient = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(ddbClient);
const s3Client = new S3Client({});

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;

// Simplified SLA table (MVP)
const slaTable = {
  'EC2': { uptime: 0.999, creditPercent: 0.1 }, // 99.9% uptime, 10% credit
  'RDS': { uptime: 0.999, creditPercent: 0.1 },
  'S3': { uptime: 0.999, creditPercent: 0.1 },
  // Add more services as needed
};

/**
 * Função helper para assumir a role do cliente
 * Retorna clientes de serviços da AWS autenticados com as credenciais da role assumida.
 */
async function getAssumedClients(roleArn, externalId, region = 'us-east-1') {
  if (!externalId) throw new Error('ExternalId is required for AssumeRole');
  const sts = new STSClient({});
  try {
    const assumedRole = await sts.send(new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: 'CostGuardianSLAAnalysis',
      DurationSeconds: 900, // 15 minutos
      ExternalId: externalId,
    }));

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
      // AWS Support API também é 'us-east-1' para operações de caso (SDK v3)
      support: new SupportClient({ region: 'us-east-1', credentials }),
      // Adicione outros clientes se necessário (ex: S3, Health)
      // s3: new S3Client({ credentials, region })
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
  const { awsAccountId, healthEvent, incidentId, customerId } = event;
  const affectedResources = healthEvent.resources || [];
  
  // O nome da role é o que o cliente cria a partir do seu template CFN
  const roleToAssume = `arn:aws:iam::${awsAccountId}:role/CostGuardianDelegatedRole`;

  // Buscar a configuração do cliente para verificar o nível de suporte
  const configKey = { id: customerId, sk: 'CONFIG#ONBOARD' };
  const configResp = await dynamoDb.send(new GetCommand({ TableName: DYNAMODB_TABLE, Key: configKey }));
  const configData = { Item: configResp.Item };
  const supportLevel = configData.Item?.supportLevel || 'basic'; 

  // Se o evento do Health não listou ARNs de recursos, não podemos calcular o impacto.
  if (affectedResources.length === 0) {
  console.log(`Nenhum recurso específico afetado para o incidente ${incidentId}.`);
  // Atualiza o status no DB e termina o fluxo
  await dynamoDb.send(new UpdateCommand({
  TableName: DYNAMODB_TABLE,
  Key: { id: event.customerId, sk: incidentId },
  UpdateExpression: 'SET #status = :status',
  ExpressionAttributeNames: { '#status': 'status' },
  ExpressionAttributeValues: { ':status': 'NO_RESOURCES_LISTED' }
  }));
  throw new Error('Nenhum recurso específico afetado para o incidente.');
  }

  try {
  // 1. Assumir a role do cliente para ter permissão de ler os custos dele
  const externalId = configData.Item?.externalId;
  if (!externalId) throw new Error('externalId not found for customer');
  const { costExplorer } = await getAssumedClients(roleToAssume, externalId);

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

    // Calculate potential credit using SLA
    let potentialCredit = 0;
    const service = healthEvent.service.toUpperCase();
    const sla = slaTable[service];
    if (sla) {
      const startTime = new Date(healthEvent.startTime).getTime();
      const endTime = new Date(healthEvent.endTime || new Date()).getTime();
      const durationMs = endTime - startTime;
      const durationMinutes = durationMs / 60000;
      const monthlyAllowedDowntime = (1.0 - sla.uptime) * 30 * 24 * 60;
      const violation = durationMinutes > monthlyAllowedDowntime;
      if (violation) {
        potentialCredit = impactedCost * sla.creditPercent;
        console.log(`SLA violation for ${service}: duration ${durationMinutes.toFixed(2)} min > ${monthlyAllowedDowntime.toFixed(2)} min allowed. Potential credit: $${potentialCredit.toFixed(2)}`);
      } else {
        console.log(`No SLA violation for ${service}: duration ${durationMinutes.toFixed(2)} min <= ${monthlyAllowedDowntime.toFixed(2)} min allowed.`);
      }
    } else {
      console.warn(`No SLA data for service ${service}`);
    }

    // Save potentialCredit to DB
    await dynamoDb.send(new UpdateCommand({
      TableName: DYNAMODB_TABLE,
      Key: { id: customerId, sk: incidentId },
      UpdateExpression: 'SET potentialCredit = :potentialCredit, impactedCost = :impactedCost',
      ExpressionAttributeValues: { ':potentialCredit': potentialCredit, ':impactedCost': impactedCost }
    }));

    // Retorna o evento original enriquecido
    return {
      ...event,
      impactedCost: impactedCost,
      potentialCredit: potentialCredit,
      externalId: externalId,
      roleArn: roleToAssume,
    };

  } catch (err) {
  console.error(`Erro ao calcular impacto para ${awsAccountId} (Incidente ${incidentId}):`, err);
  // Padroniza a mensagem de erro lançada
  let errorMessage = `Falha ao calcular impacto: ${err.message}`;
    if (err.message.includes('AssumeRole failed')) { // Verifica se o erro original foi do assumeRole
        errorMessage = `Falha ao assumir role: ${err.message}`;
    }
     // Lança o erro padronizado ou específico
    throw new Error(errorMessage);
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
  console.log('generateReport event:', JSON.stringify(event, null, 2));
  const { violation, credit, customerId, incidentId, awsAccountId } = event;

  // Se não houver violação ou crédito, não faz nada
  if (!violation || credit <= 0) {
  console.log('Nenhuma violação ou crédito. Nenhuma reivindicação gerada.');
  await dynamoDb.send(new UpdateCommand({
  TableName: DYNAMODB_TABLE,
  Key: { id: customerId, sk: incidentId },
  UpdateExpression: 'SET #status = :status',
  ExpressionAttributeNames: { '#status': 'status' },
  ExpressionAttributeValues: { ':status': 'NO_VIOLATION' }
  }));
  return { ...event, claimGenerated: false }; // <-- Retorna explicitamente
  }

  // 1. Gerar PDF com pdf-lib e salvar em S3
  const reportS3Key = `reports/${customerId}/${incidentId.replace('INCIDENT#', '')}-${Date.now()}.pdf`;
  const reportBucket = process.env.REPORTS_BUCKET_NAME;
  if (!reportBucket) {
    throw new Error('REPORTS_BUCKET_NAME environment variable not set.');
  }
  const reportUrl = `s3://${reportBucket}/${reportS3Key}`;

    try {
      const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const fontSize = 12;
    let y = height - 4 * fontSize;

    const drawText = (text, options) => {
      page.drawText(text, options);
      y -= options.font.heightAtSize(options.size) * 1.5;
    };

    drawText('SLA Credit Claim Report - AWS Cost Guardian', { x: 50, y, font, size: 18, color: rgb(0, 0, 0) });
    y -= 20;
    drawText(`Incident ID: ${incidentId}`, { x: 50, y, font, size: fontSize });
    drawText(`AWS Account: ${awsAccountId}`, { x: 50, y, font, size: fontSize });
    drawText(`Service: ${event.healthEvent.service}`, { x: 50, y, font, size: fontSize });
    drawText(`Start Time: ${event.healthEvent.startTime}`, { x: 50, y, font, size: fontSize });
    drawText(`Duration: ${event.durationMinutes.toFixed(2)} minutes`, { x: 50, y, font, size: fontSize });
    drawText(`Calculated Impacted Cost: $${event.impactedCost.toFixed(4)}`, { x: 50, y, font, size: fontSize });
    drawText(`Requested Credit (10%): $${credit.toFixed(2)}`, { x: 50, y, font, size: 14, color: rgb(0.1, 0.5, 0.1) });

    const pdfBytes = await pdfDoc.save();

  await s3Client.send(new PutObjectCommand({ Bucket: reportBucket, Key: reportS3Key, Body: pdfBytes, ContentType: 'application/pdf' }));

  } catch (pdfError) {
    console.error(`[generateReport] Falha ao gerar ou fazer upload do relatório PDF para o incidente ${incidentId} do cliente ${customerId}:`, pdfError);
    // Atualizar DynamoDB para indicar falha na geração do relatório para rastreabilidade
    try {
      await dynamoDb.send(new UpdateCommand({
        TableName: DYNAMODB_TABLE,
        Key: { id: customerId, sk: incidentId },
        UpdateExpression: 'SET #status = :status, reportError = :err',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': 'REPORT_FAILED', ':err': String(pdfError.stack || pdfError.message) }
      }));
    } catch (dbErr) { // Este catch é para o erro de atualização do DB, não do PDF
      console.error('Falha ao atualizar DynamoDB após erro de PDF:', dbErr);
    }
    throw new Error(`PDF generation failed: ${pdfError.message}`);
  }
  console.log(`Relatório gerado e salvo em: ${reportUrl}`);

  // Verificar se o cliente possui assinatura ativa
  const userConfigKey = { id: customerId, sk: 'CONFIG#ONBOARD' };
  const userConfigResp = await dynamoDb.send(new GetCommand({ TableName: DYNAMODB_TABLE, Key: userConfigKey }));
  const config = userConfigResp.Item;
  
  let invoiceId = null;
  const hasActivePlan = config?.subscriptionStatus === 'active';

  // Criar a Fatura (Invoice) no Stripe para a comissão de 30% apenas se NÃO for plano Pro
  if (!hasActivePlan) {
    try {
      const commissionAmount = Math.round(credit * 0.30 * 100); // Em centavos (30% de comissão)
      
      if (commissionAmount > 50) { // Stripe tem um valor mínimo de cobrança (ex: $0.50)
        // Obter ou criar o ID do cliente no Stripe
        let stripeCustomerId = config?.stripeCustomerId;
 
        if (!stripeCustomerId) {
          const customer = await stripe.customers.create({
            description: `AWS Cost Guardian Customer ${customerId}`,
            metadata: { costGuardianUserId: customerId }
          });
          stripeCustomerId = customer.id;
 
          await dynamoDb.send(new UpdateCommand({
            TableName: DYNAMODB_TABLE,
            Key: userConfigKey,
            UpdateExpression: 'SET stripeCustomerId = :sid',
            ExpressionAttributeValues: { ':sid': stripeCustomerId }
          }));
        }

        // Criar o item de fatura
        const invoiceItem = await stripe.invoiceItems.create({
          customer: stripeCustomerId,
          amount: commissionAmount,
          currency: 'usd',
          description: `Comissão de 30% sobre crédito SLA de $${credit.toFixed(2)} (Incidente: ${incidentId})`,
        });

        // Criar e finalizar a fatura
        const invoice = await stripe.invoices.create({
          customer: stripeCustomerId,
          collection_method: 'charge_automatically',
          auto_advance: true,
          metadata: {
            claimId: incidentId.replace('INCIDENT#', ''),
            customerId: customerId,
          },
        });
        invoiceId = invoice.id;
      }
    } catch (stripeError) {
      console.error(`[generateReport] Erro ao criar fatura no Stripe para o cliente ${customerId} e incidente ${incidentId}:`, stripeError);
      try {
        const tmpClaimId = `CLAIM#${incidentId.replace('INCIDENT#', '')}`;
        await dynamoDb.send(new UpdateCommand({
          TableName: DYNAMODB_TABLE,
          Key: { id: customerId, sk: tmpClaimId },
          UpdateExpression: 'SET stripeError = :err',
          ExpressionAttributeValues: { ':err': String(stripeError.stack || stripeError.message) }
        }));
      } catch (dbErr) {
        console.error('Erro ao gravar stripeError no DynamoDB:', dbErr);
      }
    }
  }
  //     const userConfig = await dynamoDb.get({ TableName: DYNAMODB_TABLE, Key: userConfigKey }).promise();
 
  //     let stripeCustomerId = userConfig.Item?.stripeCustomerId;
 
  //     if (!stripeCustomerId) {
  //       console.log(`Cliente Stripe não encontrado para ${customerId}. Criando um novo.`);
  //       const customer = await stripe.customers.create({
  //         description: `AWS Cost Guardian Customer ${customerId}`,
  //         metadata: { costGuardianUserId: customerId }
  //       });
  //       stripeCustomerId = customer.id;
 
  //       // Salvar o novo ID no DynamoDB para uso futuro
  //       await dynamoDb.update({
  //         TableName: DYNAMODB_TABLE,
  //         Key: userConfigKey,
  //         UpdateExpression: 'SET stripeCustomerId = :sid',
  //         ExpressionAttributeValues: { ':sid': stripeCustomerId }
  //       }).promise();
  //       console.log(`Novo cliente Stripe ${stripeCustomerId} criado e associado ao usuário ${customerId}.`);
  //     } else {
  //       console.log(`Cliente Stripe ${stripeCustomerId} encontrado para o usuário ${customerId}.`);
  //     }
 
  //     // Etapa 1: Criar um item de fatura pendente
  //     const invoiceItem = await stripe.invoiceItems.create({
  //       customer: stripeCustomerId, // Usa o ID correto do Stripe
  //       amount: commissionAmount,
  //       currency: 'usd',
  //       description: `Comissão de 30% sobre crédito SLA de $${credit.toFixed(2)} (Incidente: ${incidentId})`,
  //     });

  //     // Etapa 2: Criar a fatura a partir do item e finalizá-la
  //     const invoice = await stripe.invoices.create({
  //       customer: stripeCustomerId, // Usa o ID correto do Stripe
  //       collection_method: 'charge_automatically', // Tenta cobrar o método de pagamento padrão
  //       auto_advance: true, // Move a fatura do estado 'draft' para 'open'
  //       metadata: {
  //         claimId: incidentId.replace('INCIDENT#', ''), // Link para o webhook
  //         customerId: customerId,
  //       },
  //     });
  //     invoiceId = invoice.id;
  //     console.log(`Fatura ${invoiceId} criada no Stripe para o cliente ${customerId} no valor de ${commissionAmount / 100} USD.`);
  //   }
  // } catch (stripeError) {
  //   console.error(`[generateReport] Erro ao criar fatura no Stripe para o cliente ${customerId} e incidente ${incidentId}:`, stripeError);
  //   // Gravar o erro no item da claim (quando possível) para facilitar diagnóstico
  //   try {
  //     const tmpClaimId = `CLAIM#${incidentId.replace('INCIDENT#', '')}`;
  //     await dynamoDb.update({
  //       TableName: DYNAMODB_TABLE,
  //       Key: { id: customerId, sk: tmpClaimId },
  //       UpdateExpression: 'SET stripeError = :err',
  //       ExpressionAttributeValues: { ':err': String(stripeError.stack || stripeError.message) }
  //     }).promise();
  //   } catch (dbErr) { // Este catch é para o erro de atualização do DB, não do Stripe
  //     console.error('Erro ao gravar stripeError no DynamoDB:', dbErr);
  //   }
  //   // Não interromper o fluxo, apenas registrar o erro.
  // }

  // 2. Salvar a reivindicação (CLAIM) no DynamoDB
  const claimId = `CLAIM#${incidentId.replace('INCIDENT#', '')}`;
  await dynamoDb.send(new PutCommand({
    TableName: DYNAMODB_TABLE,
    Item: {
      id: customerId,        // PK
      sk: claimId,           // SK
      status: 'READY_TO_SUBMIT',
      creditAmount: credit,
      reportUrl: reportUrl,
      incidentId: incidentId,
      awsAccountId: awsAccountId,
      stripeInvoiceId: null, // A fatura será criada posteriormente por um endpoint de admin
      details: event, // Armazena todos os dados do evento e cálculo
    },
  }));

  // 3. Atualizar o incidente original como 'CLAIM_GENERATED'
  await dynamoDb.send(new UpdateCommand({
    TableName: DYNAMODB_TABLE,
    Key: { id: customerId, sk: incidentId },
    UpdateExpression: 'SET #status = :status, #claimId = :claimId',
    ExpressionAttributeNames: { '#status': 'status', '#claimId': 'claimId' },
    ExpressionAttributeValues: { ':status': 'CLAIM_GENERATED', ':claimId': claimId }
  }));

  return { ...event, reportUrl, claimGenerated: true, claimId: claimId };
};

/**
 * 4. Submit Support Ticket
 * Entrada: { ...event, claimId, credit }
 */
exports.submitSupportTicket = async (event) => {
  console.log('submitSupportTicket event:', event);
  const { customerId, awsAccountId, claimId, credit, healthEvent, durationMinutes, supportLevel } = event;
  
  // Se o cliente está no plano Basic, atualizar status para submissão manual
  if (supportLevel === 'basic') {
  console.log(`Cliente ${customerId} está no plano Basic. Requer ação manual.`);
  await dynamoDb.send(new UpdateCommand({
  TableName: DYNAMODB_TABLE,
  Key: { id: customerId, sk: claimId },
  UpdateExpression: 'SET #status = :status',
  ExpressionAttributeNames: { '#status': 'status' },
  ExpressionAttributeValues: { ':status': 'PENDING_MANUAL_SUBMISSION' }
  }));
  return { ...event, status: 'manual-submission-required' };
  }

  // Se não houver claimId, algo deu errado.
  if (!claimId) {
  console.warn('Nenhum claimId encontrado. Pulando envio de ticket.');
  return { ...event, status: 'submission-skipped' };
  }

  // Usar externalId do event (passado de calculateImpact) ou buscar do DB se não disponível
  let externalId = event.externalId;
  if (!externalId) {
    const configKey = { id: customerId, sk: 'CONFIG#ONBOARD' };
    const configResp = await dynamoDb.send(new GetCommand({ TableName: DYNAMODB_TABLE, Key: configKey }));
     const configData = { Item: configResp.Item };
    externalId = configData.Item?.externalId;
   }

  const roleToAssume = event.roleArn || `arn:aws:iam::${awsAccountId}:role/CostGuardianDelegatedRole`;

   try {
     // 1. Assumir a role do cliente para ter permissão de criar um caso de suporte
     if (!externalId) throw new Error('externalId not found for customer');
  const { support } = await getAssumedClients(roleToAssume, externalId);

    // 2. Montar o corpo do ticket de suporte
    const subject = `[Cost Guardian] Reivindicação de Crédito SLA para ${healthEvent.service}`;
    const communicationBody = `
Prezada equipe de suporte da AWS,

Esta é uma solicitação de crédito de SLA gerada automaticamente pela plataforma AWS Cost Guardian em nome de nosso cliente mútuo (Conta AWS: ${awsAccountId}).

Detectamos uma violação do Acordo de Nível de Serviço (SLA) para o serviço ${healthEvent.service} com base no seguinte evento do AWS Health:

- ID do Evento: ${healthEvent.eventArn}
- Início do Incidente: ${healthEvent.startTime}
- Fim do Incidente: ${healthEvent.endTime || 'Em andamento'}
- Duração da Interrupção: ${durationMinutes.toFixed(2)} minutos
- Recursos Afetados: ${healthEvent.resources.join(', ')}

Com base no custo dos recursos afetados durante o período da interrupção, calculamos um crédito de SLA estimado de US$ ${credit.toFixed(2)}.

Solicitamos a análise deste evento e a aplicação do crédito de SLA correspondente na fatura desta conta.

Obrigado,
AWS Cost Guardian
    `;

    // 3. Chamar a API CreateCase
    const caseResult = await support.send(new CreateCaseCommand({
      subject,
      communicationBody,
      serviceCode: healthEvent.service.toLowerCase(), // Ex: 'ec2'. Requer mapeamento ou pode falhar.
      categoryCode: 'billing', // Categoria apropriada
      severityCode: 'low', // Casos de faturamento geralmente são de baixa severidade
    }));

    console.log(`Ticket de suporte criado com sucesso: Case ID ${caseResult.caseId || caseResult.caseId}`);

    // 4. Atualizar o status da reivindicação no DynamoDB
  await dynamoDb.send(new UpdateCommand({
    TableName: DYNAMODB_TABLE,
    Key: { id: customerId, sk: claimId },
    UpdateExpression: 'SET #status = :status, #caseId = :caseId',
    ExpressionAttributeNames: { '#status': 'status', '#caseId': 'caseId' },
    ExpressionAttributeValues: { ':status': 'SUBMITTED', ':caseId': caseResult.caseId }
  }));

    return { ...event, status: 'submitted', caseId: caseResult.caseId };

  } catch (err) {
    console.error(`Erro ao enviar ticket de suporte para ${awsAccountId} (Claim ${claimId}):`, err);
    // Atualizar status para falha para não tentar novamente
  await dynamoDb.send(new UpdateCommand({
    TableName: DYNAMODB_TABLE,
    Key: { id: customerId, sk: claimId },
    UpdateExpression: 'SET #status = :status, #error = :error',
    ExpressionAttributeNames: { '#status': 'status', '#error': 'submissionError' },
    ExpressionAttributeValues: { ':status': 'SUBMISSION_FAILED', ':error': err.message }
  }));
    throw new Error(`Falha ao enviar ticket de suporte: ${err.message}`);
  }
};