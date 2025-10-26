const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const sts = new AWS.STS();

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;

exports.handler = async (event) => {
  console.log('Executando automação: Excluir Volumes EBS Órfãos');

  // 1. Recuperar clientes que habilitaram DELETE_UNUSED_EBS
  // Use Query on StatusIndex to efficiently fetch ACTIVE configs, then filter by automation.deleteUnusedEbs
  const queryParamsBase = {
    TableName: DYNAMODB_TABLE,
    IndexName: 'StatusIndex',
    KeyConditionExpression: '#status = :status',
    ExpressionAttributeNames: { '#status': 'status', '#automation': 'automation', '#deleteUnusedEbs': 'deleteUnusedEbs' },
    ExpressionAttributeValues: { ':status': 'ACTIVE', ':sk': 'CONFIG#ONBOARD', ':trueVal': true },
    FilterExpression: 'sk = :sk AND #automation.#deleteUnusedEbs = :trueVal',
    ProjectionExpression: 'id, roleArn',
  };

  let items = [];
  let ExclusiveStartKey;
  do {
    const p = Object.assign({}, queryParamsBase);
    if (ExclusiveStartKey) p.ExclusiveStartKey = ExclusiveStartKey;
    const resp = await dynamoDb.query(p).promise();
    items = items.concat(resp.Items || []);
    ExclusiveStartKey = resp.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  if (!items.length) {
    console.log('Nenhum cliente com automação DELETE_UNUSED_EBS habilitada.');
    return { status: 'no-op' };
  }

  for (const customer of items) {
    if (!customer.roleArn) {
      console.warn(`Cliente ${customer.id} sem roleArn; pulando`);
      continue;
    }

    try {
      const assume = await sts.assumeRole({ RoleArn: customer.roleArn, RoleSessionName: `delete-ebs-${customer.id}-${Date.now()}`, DurationSeconds: 900 }).promise();
      const creds = assume.Credentials;
      const ec2Client = new AWS.EC2({ accessKeyId: creds.AccessKeyId, secretAccessKey: creds.SecretAccessKey, sessionToken: creds.SessionToken, region: 'us-east-1' });

      // Describe volumes with status 'available' (não anexados)
      const resp = await ec2Client.describeVolumes({ Filters: [{ Name: 'status', Values: ['available'] }] }).promise();
      const volumes = resp.Volumes || [];
      for (const v of volumes) {
        try {
          console.log(`Cliente ${customer.id}: excluir volume ${v.VolumeId} (estado ${v.State || v.Status})`);
          // Por segurança, não executar delete em ambiente de desenvolvimento
          // await ec2Client.deleteVolume({ VolumeId: v.VolumeId }).promise();
        } catch (inner) {
          console.error('Erro ao deletar volume:', inner);
        }
      }

    } catch (err) {
      console.error(`Erro ao processar cliente ${customer.id}:`, err);
    }
  }

  return { status: 'completed' };
};
