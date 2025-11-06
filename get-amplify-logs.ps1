# Get Amplify build logs
$appId = "d1w4m8xpy3lj36"
$branchName = "main"
$jobId = "23"
$region = "us-east-1"

# Get job details
Write-Host "Fetching job details..."
$job = aws amplify get-job --app-id $appId --branch-name $branchName --job-id $jobId --region $region | ConvertFrom-Json

# Extract log URL
$logUrl = $job.job.steps[0].logUrl

# Download log
Write-Host "Downloading log from S3..."
Invoke-WebRequest -Uri $logUrl -OutFile "latest-build-log.txt"

Write-Host "Log saved to latest-build-log.txt"
Get-Content "latest-build-log.txt" | Select-Object -Last 100
