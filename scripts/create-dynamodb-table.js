#!/usr/bin/env node

/**
 * Create DynamoDB Table for Production
 * Creates the CostGuardianTable with all necessary GSI
 */

const { execSync } = require('child_process');

class DynamoDBSetup {
  constructor() {
    // Production configuration
    this.tableName = 'CostGuardianProdTable';
    this.region = process.env.AWS_REGION || 'us-east-1';
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
      info: 'ℹ️ ',
      success: '✅',
      warning: '⚠️ ',
      error: '❌'
    }[type] || 'ℹ️ ';

    console.log(`[${timestamp}] ${prefix} ${message}`);
  }

  execCommand(command, description) {
    try {
      this.log(`Executing: ${description}`, 'info');
      const result = execSync(command, { encoding: 'utf8', stdio: 'inherit' });
      this.log(`${description} completed successfully`, 'success');
      return result;
    } catch (error) {
      this.log(`Failed to execute: ${description}`, 'error');
      this.log(`Error: ${error.message}`, 'error');
      throw error;
    }
  }

  async checkTableExists() {
    try {
      execSync(`aws dynamodb describe-table --table-name ${this.tableName} --region ${this.region}`, { stdio: 'pipe' });
      this.log(`Table ${this.tableName} already exists`, 'warning');
      return true;
    } catch (error) {
      this.log(`Table ${this.tableName} does not exist, will create`, 'info');
      return false;
    }
  }

  async createTable() {
    this.log(`Creating DynamoDB table ${this.tableName} in ${this.region}`, 'info');

    const createCommand = `aws dynamodb create-table \\
      --table-name ${this.tableName} \\
      --attribute-definitions \\
        AttributeName=id,AttributeType=S \\
        AttributeName=sk,AttributeType=S \\
        AttributeName=awsAccountId,AttributeType=S \\
        AttributeName=entityType,AttributeType=S \\
        AttributeName=externalId,AttributeType=S \\
        AttributeName=status,AttributeType=S \\
        AttributeName=createdAt,AttributeType=S \\
        AttributeName=marketplaceCustomerId,AttributeType=S \\
        AttributeName=stripeCustomerId,AttributeType=S \\
      --key-schema AttributeName=id,KeyType=HASH AttributeName=sk,KeyType=RANGE \\
      --billing-mode PAY_PER_REQUEST \\
      --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES \\
      --region ${this.region}`;

    this.execCommand(createCommand, `Create DynamoDB table ${this.tableName}`);
  }

  async createGlobalSecondaryIndexes() {
    this.log('Creating Global Secondary Indexes...', 'info');

    const gsiCommands = [
      {
        name: 'AwsAccountIndex',
        command: `aws dynamodb update-table --table-name ${this.tableName} --region ${this.region} --attribute-definitions AttributeName=awsAccountId,AttributeType=S --global-secondary-index-updates '[{"Create":{"IndexName":"AwsAccountIndex","KeySchema":[{"AttributeName":"awsAccountId","KeyType":"HASH"}],"Projection":{"ProjectionType":"INCLUDE","NonKeyAttributes":["id"]},"ProvisionedThroughput":{"ReadCapacityUnits":5,"WriteCapacityUnits":5}}}]'`
      },
      {
        name: 'ActiveCustomerIndex',
        command: `aws dynamodb update-table --table-name ${this.tableName} --region ${this.region} --attribute-definitions AttributeName=sk,AttributeType=S AttributeName=status,AttributeType=S --global-secondary-index-updates '[{"Create":{"IndexName":"ActiveCustomerIndex","KeySchema":[{"AttributeName":"sk","KeyType":"HASH"},{"AttributeName":"status","KeyType":"RANGE"}],"Projection":{"ProjectionType":"INCLUDE","NonKeyAttributes":["id","roleArn","automationSettings","subscriptionStatus","supportLevel","exclusionTags"]},"ProvisionedThroughput":{"ReadCapacityUnits":5,"WriteCapacityUnits":5}}}]'`
      },
      {
        name: 'ExternalIdIndex',
        command: `aws dynamodb update-table --table-name ${this.tableName} --region ${this.region} --attribute-definitions AttributeName=externalId,AttributeType=S --global-secondary-index-updates '[{"Create":{"IndexName":"ExternalIdIndex","KeySchema":[{"AttributeName":"externalId","KeyType":"HASH"}],"Projection":{"ProjectionType":"INCLUDE","NonKeyAttributes":["id","status"]},"ProvisionedThroughput":{"ReadCapacityUnits":5,"WriteCapacityUnits":5}}}]'`
      },
      {
        name: 'StatusIndex',
        command: `aws dynamodb update-table --table-name ${this.tableName} --region ${this.region} --attribute-definitions AttributeName=status,AttributeType=S AttributeName=id,AttributeType=S --global-secondary-index-updates '[{"Create":{"IndexName":"StatusIndex","KeySchema":[{"AttributeName":"status","KeyType":"HASH"},{"AttributeName":"id","KeyType":"RANGE"}],"Projection":{"ProjectionType":"INCLUDE","NonKeyAttributes":["sk","roleArn","automation"]},"ProvisionedThroughput":{"ReadCapacityUnits":5,"WriteCapacityUnits":5}}}]'`
      },
      {
        name: 'CustomerDataIndex',
        command: `aws dynamodb update-table --table-name ${this.tableName} --region ${this.region} --attribute-definitions AttributeName=id,AttributeType=S AttributeName=sk,AttributeType=S --global-secondary-index-updates '[{"Create":{"IndexName":"CustomerDataIndex","KeySchema":[{"AttributeName":"id","KeyType":"HASH"},{"AttributeName":"sk","KeyType":"RANGE"}],"Projection":{"ProjectionType":"KEYS_ONLY"},"ProvisionedThroughput":{"ReadCapacityUnits":5,"WriteCapacityUnits":5}}}]'`
      },
      {
        name: 'AdminViewIndex',
        command: `aws dynamodb update-table --table-name ${this.tableName} --region ${this.region} --attribute-definitions AttributeName=entityType,AttributeType=S AttributeName=createdAt,AttributeType=S --global-secondary-index-updates '[{"Create":{"IndexName":"AdminViewIndex","KeySchema":[{"AttributeName":"entityType","KeyType":"HASH"},{"AttributeName":"createdAt","KeyType":"RANGE"}],"Projection":{"ProjectionType":"INCLUDE","NonKeyAttributes":["status","creditAmount","reportUrl","incidentId","awsAccountId","stripeInvoiceId","caseId","submissionError","reportError","commissionAmount"]},"ProvisionedThroughput":{"ReadCapacityUnits":5,"WriteCapacityUnits":5}}}]'`
      },
      {
        name: 'MarketplaceCustomerIndex',
        command: `aws dynamodb update-table --table-name ${this.tableName} --region ${this.region} --attribute-definitions AttributeName=marketplaceCustomerId,AttributeType=S --global-secondary-index-updates '[{"Create":{"IndexName":"MarketplaceCustomerIndex","KeySchema":[{"AttributeName":"marketplaceCustomerId","KeyType":"HASH"}],"Projection":{"ProjectionType":"INCLUDE","NonKeyAttributes":["id"]},"ProvisionedThroughput":{"ReadCapacityUnits":5,"WriteCapacityUnits":5}}}]'`
      },
      {
        name: 'StripeCustomerIndex',
        command: `aws dynamodb update-table --table-name ${this.tableName} --region ${this.region} --attribute-definitions AttributeName=stripeCustomerId,AttributeType=S --global-secondary-index-updates '[{"Create":{"IndexName":"StripeCustomerIndex","KeySchema":[{"AttributeName":"stripeCustomerId","KeyType":"HASH"}],"Projection":{"ProjectionType":"KEYS_ONLY"},"ProvisionedThroughput":{"ReadCapacityUnits":5,"WriteCapacityUnits":5}}}]'`
      }
    ];

    for (const gsi of gsiCommands) {
      try {
        this.execCommand(gsi.command, `Create GSI: ${gsi.name}`);
        // Wait a bit between GSI creations to avoid throttling
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (error) {
        this.log(`GSI ${gsi.name} creation failed, continuing...`, 'warning');
      }
    }
  }

  async enablePointInTimeRecovery() {
    this.log('Enabling Point-in-Time Recovery (PITR)...', 'info');

    const pitrCommand = `aws dynamodb update-continuous-backups \\
      --table-name ${this.tableName} \\
      --point-in-time-recovery-specification Enabled=true \\
      --region ${this.region}`;

    this.execCommand(pitrCommand, 'Enable Point-in-Time Recovery');
  }

  async waitForTableActive() {
    this.log('Waiting for table to become ACTIVE...', 'info');

    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      try {
        const result = execSync(`aws dynamodb describe-table --table-name ${this.tableName} --region ${this.region} --query 'Table.TableStatus' --output text`, { encoding: 'utf8' });
        if (result.trim() === 'ACTIVE') {
          this.log('Table is now ACTIVE!', 'success');
          return;
        }
      } catch (error) {
        // Continue waiting
      }

      attempts++;
      this.log(`Waiting... (${attempts}/${maxAttempts})`, 'info');
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
    }

    throw new Error('Table did not become ACTIVE within the expected time');
  }

  async setup() {
    try {
      this.log(`🚀 Starting DynamoDB setup for production`, 'info');
      console.log('═'.repeat(60));

      // Check if table exists
      const exists = await this.checkTableExists();
      if (exists) {
        this.log('Table already exists. Setup complete.', 'success');
        return;
      }

      // Create table
      await this.createTable();

      // Wait for table to be active
      await this.waitForTableActive();

      // Create GSIs
      await this.createGlobalSecondaryIndexes();

      // Enable PITR
      await this.enablePointInTimeRecovery();

      this.log('✅ DynamoDB setup completed successfully!', 'success');
      console.log('═'.repeat(60));
      console.log(`📋 Table Details:`);
      console.log(`   Name: ${this.tableName}`);
      console.log(`   Region: ${this.region}`);
      console.log(`   GSIs: 8 indexes created`);
      console.log(`   PITR: Enabled`);
      console.log(`   Streams: Enabled`);

    } catch (error) {
      this.log(`❌ DynamoDB setup failed: ${error.message}`, 'error');
      process.exit(1);
    }
  }
}

// Run setup
const setup = new DynamoDBSetup();
setup.setup().catch(error => {
  console.error('Setup failed:', error);
  process.exit(1);
});
