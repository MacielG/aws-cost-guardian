# DynamoDB Schema v2 - Configurações Parametrizadas

## Modelo de Configuração do Cliente (CONFIG#ONBOARD)

```json
{
  "id": "user-cognito-sub",
  "sk": "CONFIG#ONBOARD",
  "awsAccountId": "123456789012",
  "roleArn": "arn:aws:iam::123456789012:role/CostGuardianRole",
  "externalId": "unique-external-id",
  "status": "ACTIVE",
  "subscriptionStatus": "active",
  "stripeCustomerId": "cus_xxx",
  "stripeSubscriptionId": "sub_xxx",
  "supportLevel": "business",
  
  // Configurações de Automação - NOVO SCHEMA
  "automationSettings": {
    "stopIdleInstances": {
      "enabled": true,
      "regions": ["us-east-1", "us-west-2", "eu-west-1"],
      "filters": {
        "tags": [
          {"Key": "Environment", "Values": ["dev", "staging"]},
          {"Key": "AutoShutdown", "Values": ["true"]}
        ],
        "instanceStates": ["running"]
      },
      "thresholds": {
        "cpuUtilization": 5,
        "evaluationPeriodHours": 24
      },
      "exclusionTags": ["CostGuardian:Exclude", "Production:Critical"]
    },
    "deleteUnusedEbs": {
      "enabled": true,
      "regions": ["us-east-1", "us-west-2"],
      "filters": {
        "tags": [
          {"Key": "Environment", "Values": ["dev", "staging"]}
        ],
        "volumeStates": ["available"]
      },
      "thresholds": {
        "daysUnused": 7
      },
      "exclusionTags": ["CostGuardian:Exclude", "Backup:Required"]
    },
    "stopIdleRds": {
      "enabled": false,
      "regions": ["us-east-1"],
      "filters": {
        "tags": [
          {"Key": "Environment", "Values": ["dev"]}
        ]
      },
      "thresholds": {
        "maxConnections": 1,
        "evaluationPeriodDays": 1
      },
      "exclusionTags": ["CostGuardian:Exclude"]
    }
  },
  
  "createdAt": "2025-01-15T10:00:00Z",
  "updatedAt": "2025-01-15T10:00:00Z"
}
```

## Modelo de Tracking de Economias (SAVINGS#REALIZED)

```json
{
  "id": "user-cognito-sub",
  "sk": "SAVINGS#REALIZED#2025-01",
  "month": "2025-01",
  "totalSavings": 450.32,
  "breakdown": {
    "slaCredits": 200.00,
    "idleInstances": 180.00,
    "unusedEbs": 50.32,
    "idleRds": 20.00
  },
  "attribution": {
    "automated": 230.32,
    "manual": 220.00
  },
  "commission": 135.10,
  "commissionRate": 0.30,
  "items": [
    {
      "type": "IDLE_INSTANCE",
      "recommendationId": "REC#EC2#i-1234567890",
      "resourceArn": "arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890",
      "actionType": "STOP",
      "executedAt": "2025-01-15T14:30:00Z",
      "executedBy": "AUTO",
      "estimatedSavings": 45.00,
      "realizedSavings": 42.50,
      "attributionMethod": "HOURLY_RATE_PRORATED",
      "details": {
        "instanceType": "t3.large",
        "hourlyRate": 0.0832,
        "hoursRemaining": 540,
        "region": "us-east-1"
      }
    }
  ],
  "createdAt": "2025-01-31T23:59:59Z"
}
```

## Padrões de Acesso

1. **Buscar configuração do cliente**: `GetItem(id, sk="CONFIG#ONBOARD")`
2. **Buscar economias do mês**: `Query(id, sk="SAVINGS#REALIZED#2025-01")`
3. **Buscar clientes com automação ativa**: `Query(ActiveCustomerIndex, sk="CONFIG#ONBOARD", status="ACTIVE")`

## Migração

Para clientes existentes sem o novo schema:
- Default `regions`: ["us-east-1"]
- Default `filters.tags`: [{"Key": "Environment", "Values": ["dev", "staging"]}]
- Backward compatible com campo `exclusionTags` (string CSV)
