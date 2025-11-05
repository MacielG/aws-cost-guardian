# 📚 AWS Cost Guardian API Documentation

## 🔗 Base URL
```
Production: https://api.costguardian.com/prod
Development: https://api.costguardian.com/dev
Local: http://localhost:3001/dev
```

## 🔐 Authentication

All protected endpoints require JWT authentication via Bearer token:

```
Authorization: Bearer <jwt-token>
```

### Getting a Token
Tokens are obtained through AWS Cognito authentication flow.

## 📋 Endpoints

### Health & Status

#### GET /health
**Public endpoint** - Basic health check

**Response (200):**
```json
{
  "status": "ok",
  "timestamp": "2025-11-05T10:00:00.000Z",
  "environment": "production"
}
```

#### GET /api/health
**Public endpoint** - Detailed health check

**Response (200):**
```json
{
  "status": "ok",
  "timestamp": "2025-11-05T10:00:00.000Z",
  "cors": {
    "allowedOrigins": "https://awscostguardian.com,https://www.awscostguardian.com",
    "credentials": true
  },
  "environment": "production"
}
```

#### GET /api/public/metrics
**Public endpoint** - System metrics

**Response (200):**
```json
{
  "status": "ok",
  "timestamp": "2025-11-05T10:00:00.000Z",
  "version": "2.0.0",
  "service": "aws-cost-guardian-backend",
  "metrics": {
    "uptime": 3600.5,
    "memoryUsage": {
      "rss": 104857600,
      "heapTotal": 67108864,
      "heapUsed": 45000000,
      "external": 2000000
    },
    "nodeVersion": "v18.17.0"
  }
}
```

### Authentication Required Endpoints

#### GET /api/onboard-init
Get user onboarding configuration

**Query Parameters:**
- `mode` (optional): `trial` or `full`

**Response (200):**
```json
{
  "id": "user-uuid",
  "status": "pending_setup",
  "mode": "trial",
  "accountType": "TRIAL",
  "createdAt": "2025-11-05T10:00:00.000Z",
  "stripeCustomerId": null,
  "stripeSubscriptionId": null,
  "subscriptionStatus": "inactive",
  "automationEnabled": false,
  "automationSettings": {}
}
```

**Error (401):**
```json
{
  "message": "Não autenticado"
}
```

#### GET /billing/subscription
Get user subscription status

**Response (200):**
```json
{
  "status": "active",
  "stripeCustomerId": "cus_1234567890",
  "stripeSubscriptionId": "sub_1234567890"
}
```

#### POST /billing/create-checkout-session
Create Stripe checkout session

**Request Body:**
```json
{
  "stripeCustomerId": "cus_1234567890"
}
```

**Response (200):**
```json
{
  "sessionId": "cs_test_1234567890"
}
```

**Error (400):**
```json
{
  "error": "stripeCustomerId é obrigatório"
}
```

#### POST /billing/create-portal-session
Create Stripe customer portal session

**Response (200):**
```json
{
  "url": "https://billing.stripe.com/p/session/1234567890"
}
```

#### GET /recommendations
List user recommendations (Pro plan required)

**Response (200):**
```json
[
  {
    "id": "rec_001",
    "type": "idle_instances",
    "title": "Idle EC2 Instances",
    "description": "3 instances running but not utilized",
    "savings": 150.00,
    "status": "pending",
    "createdAt": "2025-11-05T10:00:00.000Z"
  }
]
```

**Error (403):**
```json
{
  "error": "Acesso negado. Esta funcionalidade requer um plano Pro."
}
```

#### POST /recommendations/{recommendationId}/execute
Execute a recommendation (Pro plan required)

**Response (200):**
```json
{
  "message": "Recomendação executada com sucesso",
  "recommendationId": "rec_001",
  "status": "EXECUTED",
  "executedAt": "2025-11-05T10:00:00.000Z"
}
```

#### GET /settings/automation
Get automation settings (Pro plan required)

**Response (200):**
```json
{
  "enabled": true,
  "settings": {
    "autoStopIdle": true,
    "scheduleOptimization": true,
    "costThreshold": 100.00
  }
}
```

#### PUT /settings/automation
Update automation settings (Pro plan required)

**Request Body:**
```json
{
  "enabled": true,
  "settings": {
    "autoStopIdle": true,
    "scheduleOptimization": true,
    "costThreshold": 100.00
  }
}
```

**Response (200):**
```json
{
  "message": "Configurações de automação atualizadas com sucesso"
}
```

#### GET /api/incidents
List user incidents

**Response (200):**
```json
{
  "incidents": [
    {
      "id": "inc_001",
      "type": "scheduled_maintenance",
      "severity": "medium",
      "status": "resolved",
      "createdAt": "2025-11-05T10:00:00.000Z",
      "updatedAt": "2025-11-05T12:00:00.000Z",
      "description": "AWS scheduled maintenance",
      "resolution": "Maintenance completed successfully",
      "caseId": "case-12345"
    }
  ]
}
```

#### GET /api/system-status/aws
Get AWS services status

**Response (200):**
```json
{
  "timestamp": "2025-11-05T10:00:00.000Z",
  "services": {
    "EC2": {
      "status": "operational",
      "incidents": []
    },
    "RDS": {
      "status": "operational",
      "incidents": []
    }
  },
  "totalIncidents": 0
}
```

#### GET /api/system-status/guardian
Get Cost Guardian system status

**Response (200):**
```json
{
  "timestamp": "2025-11-05T10:00:00.000Z",
  "overallStatus": "healthy",
  "services": {
    "costIngestor": {
      "status": "healthy",
      "lastRun": "2025-11-05T09:45:00.000Z",
      "message": "Sistema funcionando normalmente"
    }
  }
}
```

### Admin Endpoints (Admin role required)

#### GET /admin/metrics
Get admin metrics

**Response (200):**
```json
{
  "customers": {
    "total": 150,
    "trial": 45,
    "active": 105,
    "churnedThisMonth": 3
  },
  "revenue": {
    "thisMonth": 2500.00,
    "lastMonth": 2200.00,
    "growth": 13.6
  },
  "leads": {
    "newThisWeek": 12,
    "conversionRate": 68.5,
    "highValueCount": 8
  },
  "recommendations": {
    "totalGenerated": 1250,
    "executed": 890,
    "executionRate": 71.2
  },
  "sla": {
    "claimsDetected": 45,
    "claimsSubmitted": 38,
    "creditsRecovered": 1250.00
  }
}
```

#### POST /admin/promotions
Create new promotion

**Request Body:**
```json
{
  "name": "Black Friday Deal",
  "discountType": "percentage",
  "discountValue": 25,
  "validUntil": "2025-12-01T00:00:00.000Z",
  "targetCustomers": "trial",
  "description": "25% off for trial users"
}
```

**Response (200):**
```json
{
  "message": "Promoção criada com sucesso"
}
```

**Error (400):**
```json
{
  "message": "Nome, tipo e valor do desconto são obrigatórios"
}
```

## 🚨 Error Responses

### 400 Bad Request
```json
{
  "error": "Descrição do erro de validação"
}
```

### 401 Unauthorized
```json
{
  "message": "Não autenticado"
}
```

### 403 Forbidden
```json
{
  "error": "Acesso negado. Esta funcionalidade requer um plano Pro."
}
```

### 404 Not Found
```json
{
  "error": "Not found",
  "path": "/unknown-endpoint"
}
```

### 500 Internal Server Error
```json
{
  "error": "Erro interno do servidor"
}
```

## 🔒 Rate Limiting

- **Public endpoints**: 1000 requests/second, 2000 burst
- **Authenticated endpoints**: 1000 requests/second, 2000 burst
- **Admin endpoints**: 100 requests/second, 500 burst

## 📊 Monitoring

All endpoints are monitored with:
- CloudWatch metrics and alarms
- X-Ray distributed tracing
- Response time tracking
- Error rate monitoring

## 🧪 Testing

Run the test suite:
```bash
# Unit tests
npm test

# Load testing
npm run load-test https://api-endpoint/dev 10 100

# Health monitoring
npm run health-check https://api-endpoint/dev 60

# Production validation
node scripts/validate-production.js
```

## 📞 Support

For API issues or questions:
- Check CloudWatch logs: `npm run logs`
- View metrics: `npm run metrics`
- Contact: dev@costguardian.com
</content>
</xai:function_call">Successfully created file /g:/aws-cost-guardian/API-DOCS.md
