const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');
const { SupportClient, DescribeCasesCommand, CreateCaseCommand } = require('@aws-sdk/client-support');

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;

const ddbClient = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(ddbClient);

/**
 * Lambda para submeter ticket ao AWS Support
 * Parte da Step Function de SLA
 */
exports.handler = async (event) => {
  console.log('Submit Support Ticket:', JSON.stringify(event));

  try {
    const { customerId, claimId, impactedCost, healthEvent, reportKey, roleArn, externalId } = event;

    // Assumir role do cliente para criar ticket em nome dele (SDK v3)
    const sts = new STSClient({});
    const assumeParams = {
      RoleArn: roleArn,
      RoleSessionName: `CostGuardianSLATicket-${Date.now()}`,
      DurationSeconds: 900,
    };

    if (externalId) {
      assumeParams.ExternalId = externalId;
    }

    const assumedRole = await sts.send(new AssumeRoleCommand(assumeParams));
    const credentials = {
      accessKeyId: assumedRole.Credentials.AccessKeyId,
      secretAccessKey: assumedRole.Credentials.SecretAccessKey,
      sessionToken: assumedRole.Credentials.SessionToken,
    };

    // Cliente AWS Support com credenciais assumidas (SDK v3)
    const support = new SupportClient({ region: 'us-east-1', credentials });

    // Verificar se tem plano de suporte (exceto Basic)
    let hasSupportPlan = false;
    try {
      // Tentar listar casos - se funcionar, tem suporte premium
      await support.send(new DescribeCasesCommand({ maxResults: 1 }));
      hasSupportPlan = true;
    } catch (err) {
      if (err.name === 'SubscriptionRequiredException' || err.code === 'SubscriptionRequiredException') {
        console.log('Cliente não tem plano de suporte premium');
        hasSupportPlan = false;
      } else {
        throw err;
      }
    }

    if (!hasSupportPlan) {
      // Atualizar status no DynamoDB
      await dynamoDb.update({
        TableName: DYNAMODB_TABLE,
        Key: { id: customerId, sk: claimId },
        UpdateExpression: 'SET #status = :status, statusMessage = :message',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'NO_SUPPORT_PLAN',
          ':message': 'Cliente não possui plano AWS Support para criar tickets automaticamente',
        },
      }).promise();

      return {
        ...event,
        status: 'NO_SUPPORT_PLAN',
        ticketCreated: false,
      };
    }

    // Montar corpo do ticket
    const ticketSubject = `Solicitação de Crédito SLA - Incidente ${healthEvent.eventTypeCode || 'AWS Health'}`;
    
    const ticketBody = `
Prezada Equipe de Suporte AWS,

Solicito crédito de serviço referente ao incidente que afetou nossos recursos.

DETALHES DO INCIDENTE:
- Evento: ${healthEvent.eventTypeCode || 'N/A'}
- Serviço Afetado: ${healthEvent.service || 'N/A'}
- Região: ${healthEvent.region || 'N/A'}
- Início: ${healthEvent.startTime || 'N/A'}
- Fim: ${healthEvent.endTime || 'Em andamento'}

IMPACTO FINANCEIRO:
- Custo Total Impactado: $${impactedCost.toFixed(2)}
- Crédito Solicitado: $${impactedCost.toFixed(2)}

RECURSOS AFETADOS:
${healthEvent.resources ? healthEvent.resources.slice(0, 20).map(r => `- ${r}`).join('\n') : 'Ver anexo'}

DOCUMENTAÇÃO:
Um relatório detalhado com análise de impacto foi gerado automaticamente e está disponível para revisão.

Aguardo retorno sobre a análise do crédito SLA.

Atenciosamente,
AWS Cost Guardian (Automated)
    `.trim();

    // Criar caso de suporte
    const caseParams = {
      subject: ticketSubject,
      communicationBody: ticketBody,
      serviceCode: 'customer-account', // Categoria de billing/account
      severityCode: 'low', // SLA não é emergência
      categoryCode: 'billing',
      language: 'en',
    };

  const caseResult = await support.send(new CreateCaseCommand(caseParams));
  const caseId = caseResult.caseId;

    console.log(`Ticket criado com sucesso: ${caseId}`);

    // Atualizar claim no DynamoDB
    await dynamoDb.send(new UpdateCommand({
      TableName: DYNAMODB_TABLE,
      Key: { id: customerId, sk: claimId },
      UpdateExpression: 'SET #status = :status, supportTicketId = :ticketId, submittedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'SUBMITTED',
        ':ticketId': caseId,
        ':now': new Date().toISOString(),
      },
    }));

    return {
      ...event,
      status: 'SUBMITTED',
      ticketCreated: true,
      supportTicketId: caseId,
    };

  } catch (error) {
    console.error('Erro ao criar ticket de suporte:', error);

    // Tentar atualizar status de erro
    try {
      await dynamoDb.send(new UpdateCommand({
        TableName: DYNAMODB_TABLE,
        Key: { id: event.customerId, sk: event.claimId },
        UpdateExpression: 'SET #status = :status, error = :error',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'FAILED',
          ':error': error.message,
        },
      }));
    } catch (updateErr) {
      console.error('Erro ao atualizar status de falha:', updateErr);
    }

    throw error;
  }
};
