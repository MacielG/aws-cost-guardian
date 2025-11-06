#!/bin/bash

# --- Configuração ---
APP_ID="d1w4m8xpy3lj36"
BRANCH_NAME="main"
LOG_FILE="amplify_failed_logs.txt"
REGION="us-east-1"

# Limpa o arquivo de log antigo, se existir
> "$LOG_FILE"

echo "Buscando jobs falhos para o App ID: $APP_ID na branch: $BRANCH_NAME..."

# 1. Lista os jobs falhos e extrai os IDs
FAILED_JOB_IDS=$("/mnt/c/Program Files/Amazon/AWSCLIV2/aws.exe" amplify list-jobs \
  --app-id "$APP_ID" \
  --branch-name "$BRANCH_NAME" \
  --region "$REGION" \
  --query "jobSummaries[?status=='FAILED'].jobId" \
  --output text)

if [ -z "$FAILED_JOB_IDS" ]; then
  echo "Nenhum job falho encontrado."
  exit 0
fi

echo "Jobs falhos encontrados: $FAILED_JOB_IDS"

# 2. Itera sobre cada ID de job
for JOB_ID in $FAILED_JOB_IDS; do
  echo "--- LOG DO JOB: $JOB_ID ---" >> "$LOG_FILE"
  
  # 3. Gera a URL do log para o job atual
  LOG_URL=$("/mnt/c/Program Files/Amazon/AWSCLIV2/aws.exe" amplify get-job \
    --app-id "$APP_ID" \
    --branch-name "$BRANCH_NAME" \
    --job-id "$JOB_ID" \
    --region "$REGION" \
    --query "job.steps[0].logUrl" \
    --output text)
    
  # 4. Baixa o conteúdo da URL e anexa ao arquivo
  curl -s "$LOG_URL" >> "$LOG_FILE"
  
  echo "" >> "$LOG_FILE" # Adiciona uma linha em branco para separar os logs
  echo "Log do job $JOB_ID baixado."
done

echo "✅ Concluído! Todos os logs foram salvos em: $LOG_FILE"
