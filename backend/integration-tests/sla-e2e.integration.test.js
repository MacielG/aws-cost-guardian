// SLA end-to-end integration test
// WARNING: This test performs real AWS operations. It will only run when RUN_INTEGRATION=true

const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');

AWS.config.update({ region: process.env.PLATFORM_AWS_REGION || 'us-east-1' });

const events = new AWS.EventBridge();
const stepfunctions = new AWS.StepFunctions();
const s3 = new AWS.S3();
const dynamo = new AWS.DynamoDB.DocumentClient();

const WAIT = (ms) => new Promise((r) => setTimeout(r, ms));

const describeIntegration = process.env.RUN_INTEGRATION ? describe : describe.skip;

describeIntegration('SLA Workflow E2E', () => {
  jest.setTimeout(1000 * 60 * 30);

  it('should inject event and wait for SLA workflow completion and results', async () => {
    const event = JSON.parse(fs.readFileSync(path.join(__dirname, 'mock-event.json'), 'utf8'));

    // 1) Put event into the platform Event Bus
    const putResp = await events.putEvents({ Entries: [{ Source: 'aws.health', DetailType: 'AWS Health', Detail: JSON.stringify(event), EventBusName: process.env.PLATFORM_EVENTBUS_NAME } ] }).promise();
    if (putResp.FailedEntryCount && putResp.FailedEntryCount > 0) {
      throw new Error('Failed to put event: ' + JSON.stringify(putResp));
    }

    // 2) Poll for Step Function executions for the given incident (we expect the SLAWorkflow to start)
    const sfnArn = process.env.SLA_SFN_ARN;
    if (!sfnArn) throw new Error('Environment variable SLA_SFN_ARN is required to locate the state machine');

    let executionArn = null;
    for (let i = 0; i < 60; i++) {
      const list = await stepfunctions.listExecutions({ stateMachineArn: sfnArn, statusFilter: 'RUNNING', maxResults: 50 }).promise();
      if (list.executions && list.executions.length) {
        executionArn = list.executions[0].executionArn;
        break;
      }
      await WAIT(2000);
    }

    if (!executionArn) throw new Error('Could not find running execution for SLA state machine');

    // 3) Wait for the execution to finish
    let execStatus = 'RUNNING';
    while (execStatus === 'RUNNING') {
      await WAIT(3000);
      const desc = await stepfunctions.describeExecution({ executionArn }).promise();
      execStatus = desc.status;
      console.log('Execution status:', execStatus);
      if (execStatus === 'FAILED' || execStatus === 'ABORTED' || execStatus === 'TIMED_OUT') {
        throw new Error('Execution failed: ' + execStatus);
      }
    }

    // 4) Verify PDF exists in S3 (report bucket name required)
    const reportsBucket = process.env.REPORTS_BUCKET_NAME;
    if (!reportsBucket) throw new Error('REPORTS_BUCKET_NAME is required to verify PDF output');

    // Poll for object
    let pdfFound = false;
    for (let i = 0; i < 20; i++) {
      const list = await s3.listObjectsV2({ Bucket: reportsBucket, Prefix: 'reports/' }).promise();
      if (list.KeyCount && list.KeyCount > 0) {
        pdfFound = true;
        break;
      }
      await WAIT(2000);
    }

    expect(pdfFound).toBe(true);

    // 5) Verify CLAIM#... item created in DynamoDB with status SUBMITTED
    const tableName = process.env.DYNAMODB_TABLE;
    const awsAccountId = event.detail.affectedAccount;

    // Query by AwsAccountIndex to find the customer id then query their CLAIM# items
    const lookup = await dynamo.query({ TableName: tableName, IndexName: 'AwsAccountIndex', KeyConditionExpression: 'awsAccountId = :a', ExpressionAttributeValues: { ':a': awsAccountId } }).promise();
    expect(lookup.Items && lookup.Items.length).toBeGreaterThan(0);
    const customerId = lookup.Items[0].id;

    // Query claims
    const claims = await dynamo.query({ TableName: tableName, KeyConditionExpression: 'id = :id AND begins_with(sk, :p)', ExpressionAttributeValues: { ':id': customerId, ':p': 'CLAIM#' } }).promise();
    expect(claims.Items && claims.Items.length).toBeGreaterThan(0);
    const claim = claims.Items.find(c => c.status === 'SUBMITTED');
    expect(claim).toBeTruthy();

    // 6) Optionally (and only if client credentials available), verify Support.createCase created a ticket in client account
    // This step is environment-specific and is left for manual verification if required
  });
});
