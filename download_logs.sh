#!/bin/bash
APP_ID="d1w4m8xpy3lj36"
BRANCH="main"

for id in {1..23}; do
    LOGS_URL=$("/mnt/c/Program Files/Amazon/AWSCLIV2/aws.exe" amplify get-job --app-id $APP_ID --branch-name $BRANCH --job-id $id --query 'job.steps[0].logUrl' --output text)
    if [ -n "$LOGS_URL" ] && [ "$LOGS_URL" != "None" ]; then
        curl -s -o log_$id.txt "$LOGS_URL" &
        echo "Downloading log for job $id"
    else
        echo "No logs URL for job $id"
    fi
done
wait
