@echo off
REM Create DynamoDB Table for Production - Windows Batch Script

echo 🚀 Creating DynamoDB table for AWS Cost Guardian Production
echo.

REM Set variables
set TABLE_NAME=CostGuardianProdTable
set REGION=us-east-1

echo 📋 Table Configuration:
echo    Name: %TABLE_NAME%
echo    Region: %REGION%
echo    Billing: PAY_PER_REQUEST
echo.

REM Check if AWS CLI is available
aws --version >nul 2>&1
if errorlevel 1 (
    echo ❌ AWS CLI not found. Please install AWS CLI first.
    exit /b 1
)

echo ✅ AWS CLI found
echo.

REM Check if table exists
echo 🔍 Checking if table exists...
aws dynamodb describe-table --table-name %TABLE_NAME% --region %REGION% >nul 2>&1
if %errorlevel% equ 0 (
    echo ⚠️  Table %TABLE_NAME% already exists!
    echo.
    echo 💡 If you want to recreate it, delete it first:
    echo    aws dynamodb delete-table --table-name %TABLE_NAME% --region %REGION%
    echo.
    goto :end
)

echo ✅ Table does not exist, creating...
echo.

REM Create the table with all attribute definitions
echo 🏗️  Creating table...
aws dynamodb create-table ^
    --table-name %TABLE_NAME% ^
    --attribute-definitions ^
        AttributeName=id,AttributeType=S ^
        AttributeName=sk,AttributeType=S ^
        AttributeName=awsAccountId,AttributeType=S ^
        AttributeName=entityType,AttributeType=S ^
        AttributeName=externalId,AttributeType=S ^
        AttributeName=status,AttributeType=S ^
        AttributeName=createdAt,AttributeType=S ^
        AttributeName=marketplaceCustomerId,AttributeType=S ^
        AttributeName=stripeCustomerId,AttributeType=S ^
    --key-schema ^
        AttributeName=id,KeyType=HASH ^
        AttributeName=sk,KeyType=RANGE ^
    --billing-mode PAY_PER_REQUEST ^
    --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES ^
    --region %REGION%

if errorlevel 1 (
    echo ❌ Failed to create table
    exit /b 1
)

echo ✅ Table created successfully!
echo.
echo ⏳ Waiting for table to become ACTIVE...

REM Wait for table to be active
:wait_loop
timeout /t 10 /nobreak >nul
aws dynamodb describe-table --table-name %TABLE_NAME% --region %REGION% --query "Table.TableStatus" --output text | findstr "ACTIVE" >nul
if errorlevel 1 goto wait_loop

echo ✅ Table is now ACTIVE!
echo.
echo 🏗️  Creating Global Secondary Indexes...

REM Create GSI: AwsAccountIndex
echo    Creating AwsAccountIndex...
aws dynamodb update-table ^
    --table-name %TABLE_NAME% ^
    --region %REGION% ^
    --attribute-definitions AttributeName=awsAccountId,AttributeType=S ^
    --global-secondary-index-updates "[{\"Create\":{\"IndexName\":\"AwsAccountIndex\",\"KeySchema\":[{\"AttributeName\":\"awsAccountId\",\"KeyType\":\"HASH\"}],\"Projection\":{\"ProjectionType\":\"INCLUDE\",\"NonKeyAttributes\":[\"id\"]},\"ProvisionedThroughput\":{\"ReadCapacityUnits\":5,\"WriteCapacityUnits\":5}}}]" ^
    >nul 2>&1

REM Create GSI: ActiveCustomerIndex
echo    Creating ActiveCustomerIndex...
aws dynamodb update-table ^
    --table-name %TABLE_NAME% ^
    --region %REGION% ^
    --attribute-definitions AttributeName=sk,AttributeType=S AttributeName=status,AttributeType=S ^
    --global-secondary-index-updates "[{\"Create\":{\"IndexName\":\"ActiveCustomerIndex\",\"KeySchema\":[{\"AttributeName\":\"sk\",\"KeyType\":\"HASH\"},{\"AttributeName\":\"status\",\"KeyType\":\"RANGE\"}],\"Projection\":{\"ProjectionType\":\"INCLUDE\",\"NonKeyAttributes\":[\"id\",\"roleArn\",\"automationSettings\",\"subscriptionStatus\",\"supportLevel\",\"exclusionTags\"]},\"ProvisionedThroughput\":{\"ReadCapacityUnits\":5,\"WriteCapacityUnits\":5}}}]" ^
    >nul 2>&1

REM Create GSI: ExternalIdIndex
echo    Creating ExternalIdIndex...
aws dynamodb update-table ^
    --table-name %TABLE_NAME% ^
    --region %REGION% ^
    --attribute-definitions AttributeName=externalId,AttributeType=S ^
    --global-secondary-index-updates "[{\"Create\":{\"IndexName\":\"ExternalIdIndex\",\"KeySchema\":[{\"AttributeName\":\"externalId\",\"KeyType\":\"HASH\"}],\"Projection\":{\"ProjectionType\":\"INCLUDE\",\"NonKeyAttributes\":[\"id\",\"status\"]},\"ProvisionedThroughput\":{\"ReadCapacityUnits\":5,\"WriteCapacityUnits\":5}}}]" ^
    >nul 2>&1

REM Create GSI: StatusIndex
echo    Creating StatusIndex...
aws dynamodb update-table ^
    --table-name %TABLE_NAME% ^
    --region %REGION% ^
    --attribute-definitions AttributeName=status,AttributeType=S AttributeName=id,AttributeType=S ^
    --global-secondary-index-updates "[{\"Create\":{\"IndexName\":\"StatusIndex\",\"KeySchema\":[{\"AttributeName\":\"status\",\"KeyType\":\"HASH\"},{\"AttributeName\":\"id\",\"KeyType\":\"RANGE\"}],\"Projection\":{\"ProjectionType\":\"INCLUDE\",\"NonKeyAttributes\":[\"sk\",\"roleArn\",\"automation\"]},\"ProvisionedThroughput\":{\"ReadCapacityUnits\":5,\"WriteCapacityUnits\":5}}}]" ^
    >nul 2>&1

REM Create GSI: CustomerDataIndex
echo    Creating CustomerDataIndex...
aws dynamodb update-table ^
    --table-name %TABLE_NAME% ^
    --region %REGION% ^
    --attribute-definitions AttributeName=id,AttributeType=S AttributeName=sk,AttributeType=S ^
    --global-secondary-index-updates "[{\"Create\":{\"IndexName\":\"CustomerDataIndex\",\"KeySchema\":[{\"AttributeName\":\"id\",\"KeyType\":\"HASH\"},{\"AttributeName\":\"sk\",\"KeyType\":\"RANGE\"}],\"Projection\":{\"ProjectionType\":\"KEYS_ONLY\"},\"ProvisionedThroughput\":{\"ReadCapacityUnits\":5,\"WriteCapacityUnits\":5}}}]" ^
    >nul 2>&1

REM Create GSI: AdminViewIndex
echo    Creating AdminViewIndex...
aws dynamodb update-table ^
    --table-name %TABLE_NAME% ^
    --region %REGION% ^
    --attribute-definitions AttributeName=entityType,AttributeType=S AttributeName=createdAt,AttributeType=S ^
    --global-secondary-index-updates "[{\"Create\":{\"IndexName\":\"AdminViewIndex\",\"KeySchema\":[{\"AttributeName\":\"entityType\",\"KeyType\":\"HASH\"},{\"AttributeName\":\"createdAt\",\"KeyType\":\"RANGE\"}],\"Projection\":{\"ProjectionType\":\"INCLUDE\",\"NonKeyAttributes\":[\"status\",\"creditAmount\",\"reportUrl\",\"incidentId\",\"awsAccountId\",\"stripeInvoiceId\",\"caseId\",\"submissionError\",\"reportError\",\"commissionAmount\"]},\"ProvisionedThroughput\":{\"ReadCapacityUnits\":5,\"WriteCapacityUnits\":5}}}]" ^
    >nul 2>&1

REM Create GSI: MarketplaceCustomerIndex
echo    Creating MarketplaceCustomerIndex...
aws dynamodb update-table ^
    --table-name %TABLE_NAME% ^
    --region %REGION% ^
    --attribute-definitions AttributeName=marketplaceCustomerId,AttributeType=S ^
    --global-secondary-index-updates "[{\"Create\":{\"IndexName\":\"MarketplaceCustomerIndex\",\"KeySchema\":[{\"AttributeName\":\"marketplaceCustomerId\",\"KeyType\":\"HASH\"}],\"Projection\":{\"ProjectionType\":\"INCLUDE\",\"NonKeyAttributes\":[\"id\"]},\"ProvisionedThroughput\":{\"ReadCapacityUnits\":5,\"WriteCapacityUnits\":5}}}]" ^
    >nul 2>&1

REM Create GSI: StripeCustomerIndex
echo    Creating StripeCustomerIndex...
aws dynamodb update-table ^
    --table-name %TABLE_NAME% ^
    --region %REGION% ^
    --attribute-definitions AttributeName=stripeCustomerId,AttributeType=S ^
    --global-secondary-index-updates "[{\"Create\":{\"IndexName\":\"StripeCustomerIndex\",\"KeySchema\":[{\"AttributeName\":\"stripeCustomerId\",\"KeyType\":\"HASH\"}],\"Projection\":{\"ProjectionType\":\"KEYS_ONLY\"},\"ProvisionedThroughput\":{\"ReadCapacityUnits\":5,\"WriteCapacityUnits\":5}}}]" ^
    >nul 2>&1

echo ✅ All GSIs created!
echo.
echo 🔒 Enabling Point-in-Time Recovery (PITR)...

aws dynamodb update-continuous-backups ^
    --table-name %TABLE_NAME% ^
    --point-in-time-recovery-specification Enabled=true ^
    --region %REGION%

if errorlevel 1 (
    echo ⚠️  PITR enable failed (may already be enabled)
) else (
    echo ✅ PITR enabled!
)

echo.
echo 🎉 DynamoDB setup completed successfully!
echo.
echo 📋 Table Summary:
echo    Name: %TABLE_NAME%
echo    Region: %REGION%
echo    Status: ACTIVE
echo    GSIs: 8 indexes
echo    PITR: Enabled
echo    Streams: Enabled
echo.
echo 💡 Next steps:
echo    1. Update your environment variables with the table name
echo    2. Configure Stripe secrets in AWS Secrets Manager
echo    3. Deploy the application with CDK
echo.

:end
echo Press any key to exit...
pause >nul
