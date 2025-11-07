# 🔧 Guia: Atualizar Lambda no Console AWS

## Método 1: Via AWS CLI (MAIS RÁPIDO) ⚡

Execute este comando no terminal:

```bash
cd G:\aws-cost-guardian\backend
aws lambda update-function-code \
  --function-name CostGuardianStack-ApiHandler5E7490E8-vSXCjTTqhugv \
  --zip-file fileb://lambda-code.zip \
  --region us-east-1
```

Mas primeiro precisa criar o ZIP:
```bash
# No PowerShell
cd G:\aws-cost-guardian\backend
Compress-Archive -Path handler-simple.js,package.json,node_modules -DestinationPath lambda-code.zip -Force
```

Depois alterar o handler:
```bash
aws lambda update-function-configuration \
  --function-name CostGuardianStack-ApiHandler5E7490E8-vSXCjTTqhugv \
  --handler handler-simple.app \
  --region us-east-1
```

---

## Método 2: Via Console AWS (MANUAL) 🖱️

### Passo 1: Preparar o código

1. Abra o Explorador de Arquivos
2. Navegue até: `G:\aws-cost-guardian\backend`
3. Selecione os seguintes arquivos/pastas:
   - ✅ `handler-simple.js`
   - ✅ `package.json`  
   - ✅ pasta `node_modules` (completa)
4. Clique com botão direito → **Enviar para** → **Pasta compactada (zip)**
5. Renomeie para: `lambda-code.zip`

### Passo 2: Upload no Console AWS

1. **Acesse**: [AWS Lambda Console](https://console.aws.amazon.com/lambda)
2. **Selecione a função**: `CostGuardianStack-ApiHandler5E7490E8-vSXCjTTqhugv`
3. Na seção **Code source**, clique em **Upload from**
4. Selecione **`.zip file`**
5. Clique em **Upload** e escolha o arquivo `lambda-code.zip`
6. Clique em **Save**
7. ⏳ Aguarde o upload completar (pode demorar 1-2 minutos)

### Passo 3: Alterar o Handler

1. Role para baixo até a seção **Runtime settings**
2. Clique em **Edit**
3. Altere o campo **Handler** de:
   ```
   handler.app
   ```
   para:
   ```
   handler-simple.app
   ```
4. Clique em **Save**

### Passo 4: Testar

1. Clique na aba **Test**
2. Clique em **Create new event**
3. Nome do evento: `TestPublicMetrics`
4. Cole este JSON:
   ```json
   {
     "path": "/api/public/metrics",
     "httpMethod": "GET",
     "headers": {
       "Content-Type": "application/json"
     }
   }
   ```
5. Clique em **Save**
6. Clique em **Test**
7. ✅ **Resultado esperado**: Status 200 com dados de métricas

### Passo 5: Verificar na Web

Abra o navegador e teste:
```
https://0s4kvds1a2.execute-api.us-east-1.amazonaws.com/prod/api/public/metrics
```

Deve retornar:
```json
{
  "monthlySavings": 47832,
  "slaCreditsRecovered": 12450,
  "accountsManaged": 156,
  "monthlyGrowth": 23.5,
  "activeUsers": 98,
  "trialUsers": 34,
  "commissionRate": 30
}
```

---

## ⚠️ Troubleshooting

### Erro: "Code size exceeds maximum"
- O ZIP está muito grande (>50MB)
- **Solução**: Use AWS CLI ao invés do console

### Erro: "Cannot find module 'serverless-http'"
- O handler ainda está apontando para `handler.app`
- **Solução**: Volte ao Passo 3 e altere para `handler-simple.app`

### Erro 500 persiste
- Verifique os logs no CloudWatch:
  1. Vá para **Monitor** tab no Lambda
  2. Clique em **View CloudWatch logs**
  3. Veja o erro específico

---

## ✅ Sucesso!

Se tudo funcionou, você deve ver:
- ✅ Status 200 no teste do Lambda
- ✅ Métricas retornando na API pública
- ✅ Frontend carregando dados sem erros no console

Frontend atualizado em: https://main.d1w4m8xpy3lj36.amplifyapp.com
