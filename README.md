# Controle de Frota

MVP web para controle de frota com cadastro de veículos, motoristas, documentos, checklist digital, dashboard, relatórios e notificações automáticas por WhatsApp.

## Como executar

Execute o servidor Node.js:

```bash
node server.js
```

Depois acesse:

```text
http://127.0.0.1:4173/
```

A aplicação salva os dados no navegador e sincroniza uma cópia em `data/fleet-state.json` para o robô automático.

## Deploy online

O projeto já inclui `package.json` e `render.yaml`, então pode ser publicado como Web Service Node.js.

Variáveis importantes no provedor:

- `HOST=0.0.0.0`
- `ALERT_TIME=08:00`
- `ALERT_TIMEZONE=America/Sao_Paulo`
- `WHATSAPP_PROVIDER=dry-run`, `cloud` ou `webhook`
- `CRON_TOKEN=um_token_forte`

Em hospedagens gratuitas que dormem por inatividade, configure um cron externo para chamar:

```text
https://SEU-DOMINIO/api/run-alerts?token=SEU_CRON_TOKEN
```

Esse endpoint executa a verificação mesmo que o servidor tenha acabado de acordar.

Para executar as automações do Gmail online, configure também as variáveis secretas `GMAIL_OAUTH_CREDENTIALS_JSON`, `GMAIL_OAUTH_TOKEN_JSON` e `GMAIL_MODIFY_TOKEN_JSON` no provedor e chame:

```text
https://SEU-DOMINIO/api/run-gmail-automations?token=SEU_CRON_TOKEN
```

O painel web também possui a tela `Gmail`, disponível para gestor e supervisor, para rodar boletos e arquivamento manualmente.

## Funcionalidades

- Tela de login com perfis de hierarquia: gestor, supervisor, encarregado, analista e motorista.
- Cadastro de veículos com placa, modelo, marca, ano, Renavam, chassi, responsável, motorista principal, foto e status.
- Cadastro de motoristas com CPF, CNH, categoria, vencimento da CNH, telefone, WhatsApp e e-mail.
- Controle de documentos para veículos e motoristas.
- Checklist digital de saída e retorno com itens de vistoria, foto e assinatura.
- Dashboard com veículos, documentos próximos do vencimento, vencidos, operação e manutenção.
- Robô automático no servidor que verifica vencimentos diariamente e processa alertas para 30, 15, 7, 1 dia e vencidos.
- Envio automático por WhatsApp via WhatsApp Cloud API ou webhook de provedor externo.
- Tela `WhatsApp` para gestor/supervisor configurarem provedor, token, números de alerta e envio de teste.
- Histórico de notificações e relatórios operacionais.

## Acessos de teste

Todos usam a senha `123456`.

- `gestor@frota.com`: acesso total, incluindo restaurar dados.
- `supervisor@frota.com`: gestão operacional completa, sem restaurar dados.
- `encarregado@frota.com`: veículos, documentos, checklists e alertas.
- `analista@frota.com`: cadastros, documentos, notificações e relatórios, sem disparo de alertas.
- `motorista@frota.com`: painel, documentos e checklist.

## WhatsApp

O envio automático roda no `server.js`. Por padrão, ele vem em `dry-run`, ou seja, registra os alertas sem disparar mensagens reais. Para envio real, copie `.env.example` para `.env` e configure um provedor.

Também é possível configurar pela tela `WhatsApp` dentro do sistema, usando login de gestor ou supervisor.

### Modo simples com QR Code

Para conectar escaneando QR Code, use uma Evolution API já hospedada:

1. Entre como gestor ou supervisor.
2. Abra `WhatsApp`.
3. Escolha `Conectar com QR Code`.
4. Informe `URL da Evolution API`, `API Key` e `Nome da instância`.
5. Clique em `Salvar conexão`.
6. Clique em `Conectar / gerar QR`.
7. Escaneie o QR Code com o WhatsApp.

### Modo WhatsApp Cloud API

```env
WHATSAPP_PROVIDER=cloud
WHATSAPP_ACCESS_TOKEN=seu_token
WHATSAPP_PHONE_NUMBER_ID=id_do_numero
WHATSAPP_GRAPH_VERSION=v23.0
ALERT_TIME=08:00
```

### Modo webhook

Use para Evolution API, Z-API ou outro provedor que aceite uma requisição HTTP.

```env
WHATSAPP_PROVIDER=webhook
WHATSAPP_WEBHOOK_URL=https://sua-api.example/send
WHATSAPP_WEBHOOK_TOKEN=token_opcional
ALERT_TIME=08:00
```

O servidor envia um JSON com `to`, `message`, `contact` e `document`.

Para Z-API, use a URL `send-text` da instância em `WHATSAPP_WEBHOOK_URL` e coloque o `Client-Token` da conta em `WHATSAPP_WEBHOOK_TOKEN`. Nesse caso o servidor envia o corpo no formato exigido pela Z-API: `phone` e `message`.

### Funcionamento

1. O navegador sincroniza os dados com o servidor.
2. O servidor verifica vencimentos no horário definido em `ALERT_TIME`.
3. Para documentos em 30, 15, 7, 1 dia ou vencidos, ele envia WhatsApp aos contatos.
4. O histórico aparece na tela `Notificações`.

## Automação Gmail boletos

A automação de boletos usa a Gmail API, procura emails com assunto contendo `boleto`, baixa anexos PDF, Office e CSV e avisa o andamento pelo WhatsApp configurado.

Crie um OAuth Client ID próprio no Google Cloud:

1. Abra `APIs e serviços > Tela de consentimento OAuth`.
2. Configure o app em modo externo e adicione seu Gmail em `Usuários de teste`.
3. Em `APIs e serviços > Credenciais`, crie um `ID do cliente OAuth`.
4. Escolha `App para computador`.
5. Baixe o JSON e salve como `data/gmail-oauth-credentials.json`.

Depois execute:

```bash
npm run gmail:boletos
```

Por padrão, os anexos são salvos em `C:\Users\DevManto\Downloads\teste boleto`. Para trocar, configure `GMAIL_BOLETOS_DOWNLOAD_DIR` no `.env`.

Em deploy online, use:

```env
GMAIL_OAUTH_CREDENTIALS_JSON={"installed":...}
GMAIL_OAUTH_TOKEN_JSON={"access_token":...}
GMAIL_MODIFY_TOKEN_JSON={"access_token":...}
GMAIL_ARCHIVE_MAX_PER_RUN=50
```

Para limpar emails relacionados a cassino, apostas ou jogos de azar, execute:

```bash
npm run gmail:limpar-cassino
```

Esse comando usa permissão `gmail.modify` e move os emails encontrados para a lixeira do Gmail, sem apagar permanentemente.

Para arquivar emails de promoções ou bancos, execute:

```bash
npm run gmail:arquivar-promocoes-bancos
```

Esse comando remove os emails encontrados da Caixa de entrada, mas mantém tudo em `Todos os e-mails`.

## Próximos passos sugeridos

- Criar backend Node.js/NestJS com PostgreSQL para persistência real.
- Implementar autenticação e perfis de acesso.
- Integrar WhatsApp Cloud API, Evolution API, Baileys ou Z-API.
- Adicionar envio real de e-mails.
- Criar agendamento real com cron, fila e idempotência por documento/dia.
