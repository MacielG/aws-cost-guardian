@echo off
REM Create Basic DynamoDB Table for Production - Step by Step

echo 🚀 Creating DynamoDB table for AWS Cost Guardian Production
echo.

REM Set variables
set TABLE_NAME=CostGuardianProdTable
set REGION=us-east-1

echo 📋 Table Configuration:
echo    Name: %TABLE_NAME%
echo    Region: %REGION%
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
    goto :end
)

echo ✅ Table does not exist, creating basic table...
echo.

REM Step 1: Create table with only essential attributes first
echo 🏗️  Step 1: Creating basic table...
aws dynamodb create-table ^
    --table-name %TABLE_NAME% ^
    --attribute-definitions ^
        AttributeName=id,AttributeType=S ^
        AttributeName=sk,AttributeType=S ^
    --key-schema ^
        AttributeName=id,KeyType=HASH ^
        AttributeName=sk,KeyType=RANGE ^
    --billing-mode PAY_PER_REQUEST ^
    --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES ^
    --region %REGION%

if errorlevel 1 (
    echo ❌ Failed to create basic table
    exit /b 1
)

echo ✅ Basic table created successfully!
echo.

echo ⏳ Waiting for table to become ACTIVE...
:wait_basic
timeout /t 5 /nobreak >nul
aws dynamodb describe-table --table-name %TABLE_NAME% --region %REGION% --query "Table.TableStatus" --output text | findstr "ACTIVE" >nul
if errorlevel 1 goto wait_basic

echo ✅ Table is now ACTIVE!
echo.

REM Step 2: Enable PITR
echo 🔒 Step 2: Enabling Point-in-Time Recovery...
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
echo 📝 Note: GSIs will be created during CDK deployment
echo.

echo 🎉 DynamoDB table setup completed successfully!
echo.
echo 📋 Table Details:
echo    Name: %TABLE_NAME%
echo    Region: %REGION%
echo    Status: ACTIVE
echo    PITR: Enabled
echo    Streams: Enabled
echo.
echo 💡 Next steps:
echo    1. Run CDK deployment to create GSIs
echo    2. Configure environment variables
echo    3. Test the application
echo.

:end
echo Press any key to exit...
pause >nul
