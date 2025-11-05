#!/usr/bin/env node

/**
 * Environment Setup Script
 * Configures AWS resources for different environments
 * Usage: node setup-environment.js [environment] [action]
 * Example: node setup-environment.js production init
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class EnvironmentSetup {
  constructor() {
    this.environments = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'environments.json'), 'utf8'));
    this.currentEnv = process.env.NODE_ENV || 'development';
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

  validateEnvironment(env) {
    if (!this.environments[env]) {
      throw new Error(`Environment '${env}' not found. Available: ${Object.keys(this.environments).join(', ')}`);
    }
    return this.environments[env];
  }

  async createDynamoDBTable(env, config) {
    this.log(`Creating DynamoDB table for ${env} environment`, 'info');

    const tableName = config.dynamodb.tableName;
    const region = config.region;

    // Check if table exists
    try {
      execSync(`aws dynamodb describe-table --table-name ${tableName} --region ${region}`, { stdio: 'pipe' });
      this.log(`Table ${tableName} already exists`, 'warning');
      return;
    } catch (error) {
      // Table doesn't exist, create it
    }

    const createCommand = `aws dynamodb create-table \\
      --table-name ${tableName} \\
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
      --region ${region}`;

    this.execCommand(createCommand, `Create DynamoDB table ${tableName}`);

    // Create Global Secondary Indexes
    const gsiCommands = [
      `aws dynamodb update-table --table-name ${tableName} --region ${region} --attribute-definitions AttributeName=awsAccountId,AttributeType=S --global-secondary-index-updates '[{"Create":{"IndexName":"AwsAccountIndex","KeySchema":[{"AttributeName":"awsAccountId","KeyType":"HASH"}],"Projection":{"ProjectionType":"INCLUDE","NonKeyAttributes":["id"]},"ProvisionedThroughput":{"ReadCapacityUnits":5,"WriteCapacityUnits":5}}}]'`,
      `aws dynamodb update-table --table-name ${tableName} --region ${region} --attribute-definitions AttributeName=sk,AttributeType=S AttributeName=status,AttributeType=S --global-secondary-index-updates '[{"Create":{"IndexName":"ActiveCustomerIndex","KeySchema":[{"AttributeName":"sk","KeyType":"HASH"},{"AttributeName":"status","KeyType":"RANGE"}],"Projection":{"ProjectionType":"INCLUDE","NonKeyAttributes":["id","roleArn","automationSettings","subscriptionStatus","supportLevel","exclusionTags"]},"ProvisionedThroughput":{"ReadCapacityUnits":5,"WriteCapacityUnits":5}}}]'`,
      `aws dynamodb update-table --table-name ${tableName} --region ${region} --attribute-definitions AttributeName=externalId,AttributeType=S --global-secondary-index-updates '[{"Create":{"IndexName":"ExternalIdIndex","KeySchema":[{"AttributeName":"externalId","KeyType":"HASH"}],"Projection":{"ProjectionType":"INCLUDE","NonKeyAttributes":["id","status"]},"ProvisionedThroughput":{"ReadCapacityUnits":5,"WriteCapacityUnits":5}}}]'`,
      `aws dynamodb update-table --table-name ${tableName} --region ${region} --attribute-definitions AttributeName=status,AttributeType=S AttributeName=id,AttributeType=S --global-secondary-index-updates '[{"Create":{"IndexName":"StatusIndex","KeySchema":[{"AttributeName":"status","KeyType":"HASH"},{"AttributeName":"id","KeyType":"RANGE"}],"Projection":{"ProjectionType":"INCLUDE","NonKeyAttributes":["sk","roleArn","automation"]},"ProvisionedThroughput":{"ReadCapacityUnits":5,"WriteCapacityUnits":5}}}]'`,
      `aws dynamodb update-table --table-name ${tableName} --region ${region} --attribute-definitions AttributeName=id,AttributeType=S AttributeName=sk,AttributeType=S --global-secondary-index-updates '[{"Create":{"IndexName":"CustomerDataIndex","KeySchema":[{"AttributeName":"id","KeyType":"HASH"},{"AttributeName":"sk","KeyType":"RANGE"}],"Projection":{"ProjectionType":"KEYS_ONLY"},"ProvisionedThroughput":{"ReadCapacityUnits":5,"WriteCapacityUnits":5}}}]'`,
      `aws dynamodb update-table --table-name ${tableName} --region ${region} --attribute-definitions AttributeName=entityType,AttributeType=S AttributeName=createdAt,AttributeType=S --global-secondary-index-updates '[{"Create":{"IndexName":"AdminViewIndex","KeySchema":[{"AttributeName":"entityType","KeyType":"HASH"},{"AttributeName":"createdAt","KeyType":"RANGE"}],"Projection":{"ProjectionType":"INCLUDE","NonKeyAttributes":["status","creditAmount","reportUrl","incidentId","awsAccountId","stripeInvoiceId","caseId","submissionError","reportError","commissionAmount"]},"ProvisionedThroughput":{"ReadCapacityUnits":5,"WriteCapacityUnits":5}}}]'`,
      `aws dynamodb update-table --table-name ${tableName} --region ${region} --attribute-definitions AttributeName=marketplaceCustomerId,AttributeType=S --global-secondary-index-updates '[{"Create":{"IndexName":"MarketplaceCustomerIndex","KeySchema":[{"AttributeName":"marketplaceCustomerId","KeyType":"HASH"}],"Projection":{"ProjectionType":"INCLUDE","NonKeyAttributes":["id"]},"ProvisionedThroughput":{"ReadCapacityUnits":5,"WriteCapacityUnits":5}}}]'`,
      `aws dynamodb update-table --table-name ${tableName} --region ${region} --attribute-definitions AttributeName=stripeCustomerId,AttributeType=S --global-secondary-index-updates '[{"Create":{"IndexName":"StripeCustomerIndex","KeySchema":[{"AttributeName":"stripeCustomerId","KeyType":"HASH"}],"Projection":{"ProjectionType":"KEYS_ONLY"},"ProvisionedThroughput":{"ReadCapacityUnits":5,"WriteCapacityUnits":5}}}]'`
    ];

    for (const command of gsiCommands) {
      try {
        this.execCommand(command, 'Create GSI');
        // Wait a bit between GSI creations
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        this.log(`GSI creation failed, continuing...`, 'warning');
      }
    }

    // Enable PITR if configured
    if (config.dynamodb.pitRecovery) {
      const pitrCommand = `aws dynamodb update-continuous-backups \\
        --table-name ${tableName} \\
        --point-in-time-recovery-specification Enabled=true \\
        --region ${region}`;

      this.execCommand(pitrCommand, 'Enable Point-in-Time Recovery');
    }

    this.log(`DynamoDB table ${tableName} created successfully`, 'success');
  }

  async createSecrets(env, config) {
    this.log(`Setting up secrets for ${env} environment`, 'info');

    const region = config.region;

    // Create Stripe secret placeholder
    if (config.stripe.enabled) {
      try {
        execSync(`aws secretsmanager describe-secret --secret-id StripeSecret --region ${region}`, { stdio: 'pipe' });
        this.log('StripeSecret already exists', 'warning');
      } catch {
        const createSecretCommand = `aws secretsmanager create-secret \\
          --name StripeSecret \\
          --description "Stripe API credentials for Cost Guardian" \\
          --secret-string '{"key":"PLACEHOLDER_STRIPE_SECRET_KEY"}' \\
          --region ${region}`;

        this.execCommand(createSecretCommand, 'Create Stripe secret');
      }

      // Create webhook secret
      try {
        execSync(`aws secretsmanager describe-secret --secret-id StripeWebhookSecret --region ${region}`, { stdio: 'pipe' });
        this.log('StripeWebhookSecret already exists', 'warning');
      } catch {
        const createWebhookSecretCommand = `aws secretsmanager create-secret \\
          --name StripeWebhookSecret \\
          --description "Stripe webhook signing secret for Cost Guardian" \\
          --secret-string '{"webhook":"PLACEHOLDER_WEBHOOK_SECRET"}' \\
          --region ${region}`;

        this.execCommand(createWebhookSecretCommand, 'Create webhook secret');
      }
    }

    // Create GitHub token secret for Amplify
    if (env !== 'development') {
      try {
        execSync(`aws secretsmanager describe-secret --secret-id github-token --region ${region}`, { stdio: 'pipe' });
        this.log('github-token secret already exists', 'warning');
      } catch {
        const createGithubSecretCommand = `aws secretsmanager create-secret \\
          --name github-token \\
          --description "GitHub token for Amplify deployments" \\
          --secret-string "PLACEHOLDER_GITHUB_TOKEN" \\
          --region ${region}`;

        this.execCommand(createGithubSecretCommand, 'Create GitHub token secret');
      }
    }
  }

  async deployInfrastructure(env, config) {
    this.log(`Deploying infrastructure for ${env} environment`, 'info');

    // Set environment variables for CDK
    process.env.NODE_ENV = env;
    process.env.CDK_DEFAULT_REGION = config.region;

    // Deploy CDK stack
    const deployCommand = `cd infra && npm run cdk -- deploy --require-approval never --outputs-file cdk-outputs.json`;
    this.execCommand(deployCommand, 'Deploy CDK infrastructure');

    // Read outputs
    const outputsPath = path.join(__dirname, '..', 'infra', 'cdk-outputs.json');
    if (fs.existsSync(outputsPath)) {
      const outputs = JSON.parse(fs.readFileSync(outputsPath, 'utf8'));
      this.log('CDK deployment outputs:', 'info');
      console.log(JSON.stringify(outputs, null, 2));
    }
  }

  async setupEnvironment(env, action = 'all') {
    const config = this.validateEnvironment(env);

    this.log(`Setting up ${config.name} environment (${env})`, 'info');
    console.log('═'.repeat(60));

    try {
      switch (action) {
        case 'dynamodb':
          await this.createDynamoDBTable(env, config);
          break;

        case 'secrets':
          await this.createSecrets(env, config);
          break;

        case 'infra':
          await this.deployInfrastructure(env, config);
          break;

        case 'all':
          await this.createDynamoDBTable(env, config);
          await this.createSecrets(env, config);
          await this.deployInfrastructure(env, config);
          break;

        default:
          throw new Error(`Unknown action: ${action}. Use: dynamodb, secrets, infra, or all`);
      }

      this.log(`${config.name} environment setup completed successfully!`, 'success');

    } catch (error) {
      this.log(`Environment setup failed: ${error.message}`, 'error');
      process.exit(1);
    }
  }
}

// CLI interface
const args = process.argv.slice(2);
const environment = args[0] || 'development';
const action = args[1] || 'all';

const setup = new EnvironmentSetup();
setup.setupEnvironment(environment, action).catch(error => {
  console.error('Setup failed:', error);
  process.exit(1);
});</xai:function_call">Successfully created file /g:/aws-cost-guardian/scripts/setup-environment.js
