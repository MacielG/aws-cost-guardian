## Como o AWS Cost Guardian Calcula Seu Crédito

Nosso processo é 100% transparente e baseado em dados diretos da sua conta AWS. Não usamos estimativas, apenas cálculos precisos.

### Etapa 1: O Gatilho (Evento Oficial da AWS)
Tudo começa quando a AWS emite um **Evento do AWS Health** (ex: `AWS_EC2_INSTANCE_STOP_FAILURE`). Este é um relatório oficial da AWS confirmando uma falha de serviço que afetou sua conta. O evento nos diz:
* Qual serviço falhou (ex: EC2, RDS).
* Quando a falha começou (`startTime`) e terminou (`endTime`).
* Quais dos *seus* recursos específicos (ARNs) foram impactados.

### Etapa 2: Cálculo de Impacto (API do Cost Explorer)
Assim que recebemos o evento, nossa automação assume a permissão segura (a Role IAM que você criou) e faz uma pergunta cirúrgica à **API do AWS Cost Explorer** em sua conta. A pergunta é:

*"Quanto eu gastei (Custo Não Misturado) exatamente nos recursos que a AWS disse que falharam, e somente durante o período exato em que a AWS disse que eles falharam?"*

A AWS nos retorna um valor exato (ex: $15.75). Este é o "Custo Impactado".

### Etapa 3: Verificação da Violação do SLA
Ter um custo impactado não é o suficiente. Precisamos provar que a duração da falha violou o SLA (Contrato de Nível de Serviço).
Calculamos a duração exata da falha em minutos. Se essa duração for *maior* que o tempo de inatividade máximo permitido pelo SLA (ex: 99.9% de uptime permite ~43 minutos de inatividade por mês), consideramos uma violação.

### Etapa 4: Cálculo e Reivindicação
Se (e somente se) for uma violação, calculamos seu crédito (geralmente 10% ou 30% do Custo Impactado, dependendo do SLA do serviço).
Geramos um relatório em PDF com todas essas provas e abrimos automaticamente um caso de suporte (Billing) na sua conta AWS, solicitando formalmente o reembolso daquele valor.