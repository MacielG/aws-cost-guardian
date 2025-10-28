const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;
const REPORTS_BUCKET = process.env.REPORTS_BUCKET;

exports.handler = async (event) => {
  console.log('Generate PDF Report:', JSON.stringify(event));

  try {
    const { customerId, claimId, impactedCost, healthEvent, incidentDetails } = event;

    // Criar novo documento PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]); // A4
    const { width, height } = page.getSize();

    // Carregar fontes
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Título
    page.drawText('AWS Cost Guardian - Relatório de Crédito SLA', {
      x: 50,
      y: height - 50,
      size: 18,
      font: helveticaBold,
      color: rgb(0, 0.33, 0.66),
    });

    // Linha separadora
    page.drawLine({
      start: { x: 50, y: height - 70 },
      end: { x: width - 50, y: height - 70 },
      thickness: 2,
      color: rgb(0, 0.33, 0.66),
    });

    let yPos = height - 100;

    // Informações do Claim
    page.drawText('Informações do Claim', {
      x: 50,
      y: yPos,
      size: 14,
      font: helveticaBold,
    });
    yPos -= 25;

    page.drawText(`ID do Claim: ${claimId}`, {
      x: 50,
      y: yPos,
      size: 11,
      font: helveticaFont,
    });
    yPos -= 20;

    page.drawText(`Cliente: ${customerId}`, {
      x: 50,
      y: yPos,
      size: 11,
      font: helveticaFont,
    });
    yPos -= 20;

    page.drawText(`Data: ${new Date().toLocaleDateString('pt-BR')}`, {
      x: 50,
      y: yPos,
      size: 11,
      font: helveticaFont,
    });
    yPos -= 40;

    // Impacto Financeiro
    page.drawText('Impacto Financeiro', {
      x: 50,
      y: yPos,
      size: 14,
      font: helveticaBold,
    });
    yPos -= 25;

    page.drawText(`Custo Impactado: $${impactedCost.toFixed(2)}`, {
      x: 50,
      y: yPos,
      size: 12,
      font: helveticaBold,
      color: rgb(0.8, 0, 0),
    });
    yPos -= 25;

    page.drawText(`Crédito Solicitado: $${(impactedCost * 1.0).toFixed(2)}`, {
      x: 50,
      y: yPos,
      size: 12,
      font: helveticaBold,
      color: rgb(0, 0.6, 0),
    });
    yPos -= 40;

    // Detalhes do Incidente
    page.drawText('Detalhes do Incidente AWS Health', {
      x: 50,
      y: yPos,
      size: 14,
      font: helveticaBold,
    });
    yPos -= 25;

    if (healthEvent) {
      const details = [
        `Evento: ${healthEvent.eventTypeCode || 'N/A'}`,
        `Serviço: ${healthEvent.service || 'N/A'}`,
        `Região: ${healthEvent.region || 'N/A'}`,
        `Início: ${healthEvent.startTime ? new Date(healthEvent.startTime).toLocaleString('pt-BR') : 'N/A'}`,
        `Fim: ${healthEvent.endTime ? new Date(healthEvent.endTime).toLocaleString('pt-BR') : 'Em andamento'}`,
      ];

      for (const detail of details) {
        page.drawText(detail, {
          x: 50,
          y: yPos,
          size: 10,
          font: helveticaFont,
        });
        yPos -= 18;
      }
    }

    yPos -= 20;

    // Recursos Afetados
    if (healthEvent?.resources && healthEvent.resources.length > 0) {
      page.drawText('Recursos Afetados:', {
        x: 50,
        y: yPos,
        size: 12,
        font: helveticaBold,
      });
      yPos -= 20;

      const resourcesToShow = healthEvent.resources.slice(0, 10);
      for (const resource of resourcesToShow) {
        const resourceText = `• ${resource}`;
        if (yPos < 100) break; // Evitar sair da página

        page.drawText(resourceText, {
          x: 60,
          y: yPos,
          size: 9,
          font: helveticaFont,
        });
        yPos -= 15;
      }

      if (healthEvent.resources.length > 10) {
        page.drawText(`... e mais ${healthEvent.resources.length - 10} recursos`, {
          x: 60,
          y: yPos,
          size: 9,
          font: helveticaFont,
          color: rgb(0.5, 0.5, 0.5),
        });
      }
    }

    // Rodapé
    page.drawText('Gerado automaticamente por AWS Cost Guardian', {
      x: 50,
      y: 50,
      size: 8,
      font: helveticaFont,
      color: rgb(0.5, 0.5, 0.5),
    });

    // Serializar PDF
    const pdfBytes = await pdfDoc.save();

    // Upload para S3
    const reportKey = `reports/${customerId}/${claimId}.pdf`;
    await s3.putObject({
      Bucket: REPORTS_BUCKET,
      Key: reportKey,
      Body: Buffer.from(pdfBytes),
      ContentType: 'application/pdf',
    }).promise();

    console.log(`PDF gerado e salvo em S3: ${reportKey}`);

    // Atualizar claim no DynamoDB com URL do relatório
    await dynamoDb.update({
      TableName: DYNAMODB_TABLE,
      Key: {
        id: customerId,
        sk: claimId,
      },
      UpdateExpression: 'SET reportUrl = :reportUrl, reportGeneratedAt = :now',
      ExpressionAttributeValues: {
        ':reportUrl': `s3://${REPORTS_BUCKET}/${reportKey}`,
        ':now': new Date().toISOString(),
      },
    }).promise();

    return {
      ...event,
      reportUrl: `s3://${REPORTS_BUCKET}/${reportKey}`,
      reportKey,
    };

  } catch (error) {
    console.error('Erro ao gerar PDF:', error);
    throw error;
  }
};
