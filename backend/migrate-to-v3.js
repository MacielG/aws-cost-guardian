#!/usr/bin/env node
/**
 * Script de migração automática: aws-sdk v2 → @aws-sdk v3
 * 
 * Migra todos os arquivos .js em backend/functions de aws-sdk v2 para @aws-sdk v3
 */

const fs = require('fs');
const path = require('path');

const FUNCTIONS_DIR = path.join(__dirname, 'functions');

// Mapa de transformações
const migrations = {
  // DynamoDB
  'const dynamoDb = new AWS.DynamoDB.DocumentClient()': 
    `const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const dynamoDb = DynamoDBDocumentClient.from(new DynamoDBClient({}))`,

  // STS
  'const sts = new AWS.STS()':
    `const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');
const sts = new STSClient({})`,
  
  // SNS
  'const sns = new AWS.SNS()':
    `const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const sns = new SNSClient({})`,

  // S3
  'const s3 = new AWS.S3()':
    `const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const s3 = new S3Client({})`,

  // Cost Explorer
  'const CostExplorer = AWS.CostExplorer':
    `const { CostExplorerClient, GetCostAndUsageCommand } = require('@aws-sdk/client-cost-explorer')`,

  // Support  
  'new AWS.Support':
    `const { SupportClient, CreateCaseCommand } = require('@aws-sdk/client-support')`,
};

// Transformações de chamadas de API
const apiTransforms = [
  // DynamoDB .promise() calls
  { pattern: /\.get\((.*?)\)\.promise\(\)/g, replace: '.send(new GetCommand($1))' },
  { pattern: /\.put\((.*?)\)\.promise\(\)/g, replace: '.send(new PutCommand($1))' },
  { pattern: /\.update\((.*?)\)\.promise\(\)/g, replace: '.send(new UpdateCommand($1))' },
  { pattern: /\.query\((.*?)\)\.promise\(\)/g, replace: '.send(new QueryCommand($1))' },
  { pattern: /\.delete\((.*?)\)\.promise\(\)/g, replace: '.send(new DeleteCommand($1))' },
  
  // STS
  { pattern: /sts\.assumeRole\((.*?)\)\.promise\(\)/g, replace: 'sts.send(new AssumeRoleCommand($1))' },
  
  // SNS
  { pattern: /sns\.publish\((.*?)\)\.promise\(\)/g, replace: 'sns.send(new PublishCommand($1))' },
  
  // S3
  { pattern: /s3\.putObject\((.*?)\)\.promise\(\)/g, replace: 's3.send(new PutObjectCommand($1))' },
  { pattern: /s3\.getObject\((.*?)\)\.promise\(\)/g, replace: 's3.send(new GetObjectCommand($1))' },
  
  // Cost Explorer
  { pattern: /\.getCostAndUsage\((.*?)\)\.promise\(\)/g, replace: '.send(new GetCostAndUsageCommand($1))' },
  
  // Support
  { pattern: /support\.createCase\((.*?)\)\.promise\(\)/g, replace: 'support.send(new CreateCaseCommand($1))' },
];

function migrateFile(filePath) {
  console.log(`\n🔄 Migrando: ${path.basename(filePath)}`);
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Verificar se já está migrado
  if (!content.includes("require('aws-sdk')") && !content.includes('require("aws-sdk")')) {
    console.log(`  ✅ Já migrado (sem require('aws-sdk'))`);
    return false;
  }

  let changed = false;
  
  // Remover linha do require('aws-sdk')
  const oldContent = content;
  content = content.replace(/const AWS = require\(['"]aws-sdk['"]\);?\n?/g, '');
  
  // Aplicar migrações de inicializações
  for (const [oldCode, newCode] of Object.entries(migrations)) {
    if (content.includes(oldCode)) {
      content = content.replace(oldCode, newCode);
      changed = true;
      console.log(`  ✓ Substituído: ${oldCode.substring(0, 40)}...`);
    }
  }
  
  // Aplicar transformações de API calls
  for (const { pattern, replace } of apiTransforms) {
    const matches = content.match(pattern);
    if (matches) {
      content = content.replace(pattern, replace);
      changed = true;
      console.log(`  ✓ Transformado ${matches.length} chamada(s): ${pattern.source.substring(0, 40)}...`);
    }
  }
  
  if (changed || content !== oldContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  ✅ Arquivo migrado com sucesso!`);
    return true;
  } else {
    console.log(`  ⚠️  Nenhuma mudança necessária`);
    return false;
  }
}

function main() {
  console.log('🚀 Iniciando migração aws-sdk v2 → @aws-sdk v3\n');
  console.log(`📁 Diretório: ${FUNCTIONS_DIR}\n`);

  if (!fs.existsSync(FUNCTIONS_DIR)) {
    console.error(`❌ Diretório não encontrado: ${FUNCTIONS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(FUNCTIONS_DIR)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(FUNCTIONS_DIR, f));

  let migratedCount = 0;
  
  for (const file of files) {
    if (migrateFile(file)) {
      migratedCount++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ Migração concluída!`);
  console.log(`📊 Arquivos migrados: ${migratedCount}/${files.length}`);
  console.log(`${'='.repeat(60)}\n`);
  
  console.log('⚠️  ATENÇÃO:');
  console.log('1. Revise manualmente os arquivos migrados');
  console.log('2. Verifique casos especiais (new AWS.XXX com credenciais)');
  console.log('3. Teste localmente antes do deploy\n');
}

main();
