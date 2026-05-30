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

## Funcionalidades

- Tela de login com perfis de hierarquia: gestor, supervisor, encarregado, analista e motorista.
- Cadastro de veículos com placa, modelo, marca, ano, Renavam, chassi, responsável, motorista principal, foto e status.
- Cadastro de motoristas com CPF, CNH, categoria, vencimento da CNH, telefone, WhatsApp e e-mail.
- Controle de documentos para veículos e motoristas.
- Checklist digital de saída e retorno com itens de vistoria, foto e assinatura.
- Dashboard com veículos, documentos próximos do vencimento, vencidos, operação e manutenção.
- Robô automático no servidor que verifica vencimentos diariamente e processa alertas para 30, 15, 7, 1 dia e vencidos.
- Envio automático por WhatsApp via WhatsApp Cloud API ou webhook de provedor externo.
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

### Funcionamento

1. O navegador sincroniza os dados com o servidor.
2. O servidor verifica vencimentos no horário definido em `ALERT_TIME`.
3. Para documentos em 30, 15, 7, 1 dia ou vencidos, ele envia WhatsApp aos contatos.
4. O histórico aparece na tela `Notificações`.

## Próximos passos sugeridos

- Criar backend Node.js/NestJS com PostgreSQL para persistência real.
- Implementar autenticação e perfis de acesso.
- Integrar WhatsApp Cloud API, Evolution API, Baileys ou Z-API.
- Adicionar envio real de e-mails.
- Criar agendamento real com cron, fila e idempotência por documento/dia.
