// GET /api/onboard-init - Retorna configuração para onboarding
// NOTA: Esta rota é pública (sem authenticateUser) para permitir acesso no trial mode
app.get('/api/onboard-init', (req, res) => {
  const mode = req.query.mode || 'trial';
  
  // Tenta verificar autenticação (opcional)
  verifyJwt(req, async (err, claims) => {
    try {
      let userId = null;
      if (!err && claims) {
        userId = claims.sub;
      }

      // Se não autenticado, retorna info básica
      if (!userId) {
        const accountType = mode === 'active' ? 'ACTIVE' : 'TRIAL';
        const templateUrl = accountType === 'TRIAL'
          ? process.env.TRIAL_TEMPLATE_URL
          : process.env.FULL_TEMPLATE_URL;

        return res.json({
          mode,
          accountType,
          templateUrl,
          platformAccountId: process.env.PLATFORM_ACCOUNT_ID,
          requiresAuth: true,
          message: 'Faça login para configurar o onboarding'
        });
      }

      // Tenta recuperar a configuração existente
      const getParams = {
        TableName: process.env.DYNAMODB_TABLE,
        Key: { id: userId, sk: 'CONFIG#ONBOARD' },
      };

      const existing = await dynamoDb.get(getParams).promise();
      if (existing && existing.Item) {
        const item = existing.Item;
        const templateUrl = item.accountType === 'TRIAL'
          ? process.env.TRIAL_TEMPLATE_URL
          : process.env.FULL_TEMPLATE_URL;

        return res.json({
          externalId: item.externalId,
          platformAccountId: process.env.PLATFORM_ACCOUNT_ID,
          status: item.status || 'PENDING_CFN',
          termsAccepted: !!item.termsAccepted,
          accountType: item.accountType || 'TRIAL',
          templateUrl,
        });
      }

      // Se não existir, cria um novo registro de configuração
      const externalId = randomBytes(16).toString('hex');
      const accountType = mode === 'active' ? 'ACTIVE' : 'TRIAL';
      const templateUrl = accountType === 'TRIAL'
        ? process.env.TRIAL_TEMPLATE_URL
        : process.env.FULL_TEMPLATE_URL;

      const putParams = {
        TableName: process.env.DYNAMODB_TABLE,
        Item: {
          id: userId,
          sk: 'CONFIG#ONBOARD',
          externalId,
          status: 'PENDING_CFN',
          accountType,
          createdAt: new Date().toISOString(),
        },
      };

      await dynamoDb.put(putParams).promise();

      // Tentar criar Customer no Stripe antecipadamente (se tivermos e-mail disponível no token)
      try {
        const userEmail = claims?.email || claims?.email_address || claims?.["cognito:email"];
        if (userEmail) {
          const stripeClient = await getStripe();
          const customer = await stripeClient.customers.create({
            email: userEmail,
            metadata: { costGuardianCustomerId: userId }
          });
          if (customer && customer.id) {
            await dynamoDb.update({ 
              TableName: process.env.DYNAMODB_TABLE, 
              Key: { id: userId, sk: 'CONFIG#ONBOARD' }, 
              UpdateExpression: 'SET stripeCustomerId = :sid', 
              ExpressionAttributeValues: { ':sid': customer.id } 
            }).promise();
            console.log(`Stripe customer antecipado criado para ${userId}: ${customer.id}`);
          }
        }
      } catch (stripeErr) {
        console.error('Falha ao criar stripeCustomerId antecipado:', stripeErr);
      }

      res.json({
        externalId,
        platformAccountId: process.env.PLATFORM_ACCOUNT_ID,
        status: 'PENDING_CFN',
        termsAccepted: false,
        accountType,
        templateUrl,
      });

    } catch (error) {
      console.error('Error in /api/onboard-init:', error);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  });
});
