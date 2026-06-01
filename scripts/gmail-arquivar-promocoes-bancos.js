const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { google } = require("googleapis");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const STATE_FILE = path.join(DATA_DIR, "gmail-arquivar-promocoes-bancos-state.json");
const GMAIL_CREDENTIALS_FILE = path.join(DATA_DIR, "gmail-oauth-credentials.json");
const GMAIL_TOKEN_FILE = path.join(DATA_DIR, "gmail-oauth-token-modify.json");
const GMAIL_AUTH_URL_FILE = path.join(DATA_DIR, "gmail-arquivar-auth-url.txt");
const WHATSAPP_CONFIG_FILE = path.join(DATA_DIR, "whatsapp-config.json");
const MAX_PER_RUN = Number(process.env.GMAIL_ARCHIVE_MAX_PER_RUN || 50);

const SEARCH_QUERIES = [
  "in:inbox category:promotions",
  "in:inbox banco",
  "in:inbox bancos",
  "in:inbox bancario",
  "in:inbox bancaria",
  "in:inbox financeira",
  "in:inbox financiamento",
  "in:inbox cartao",
  "in:inbox cartão",
  "in:inbox credito",
  "in:inbox crédito",
  "in:inbox emprestimo",
  "in:inbox empréstimo",
  "in:inbox investimento",
  "in:inbox investimentos",
  "in:inbox nubank",
  "in:inbox inter",
  "in:inbox bradesco",
  "in:inbox itau",
  "in:inbox itaú",
  "in:inbox santander",
  "in:inbox caixa",
  "in:inbox sicredi",
  "in:inbox sicoob",
  "in:inbox safra",
  "in:inbox c6bank",
  "in:inbox \"c6 bank\"",
  "in:inbox picpay",
  "in:inbox mercado pago",
  "in:inbox pagbank",
  "in:inbox banco do brasil"
];

loadEnv();

main().catch(async (error) => {
  console.error(error);
  await safeNotifyWhatsapp(`Automação Gmail arquivo: erro - ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  ensureDir(DATA_DIR);
  const state = readJson(STATE_FILE, { archived: {} });
  const gmail = await createGmailClient();
  await safeNotifyWhatsapp("Automação Gmail arquivo: iniciando arquivamento de promoções/bancos.");

  const messageMap = new Map();
  for (const query of SEARCH_QUERIES) {
    if (messageMap.size >= MAX_PER_RUN) break;
    const messages = await listAllMessages(gmail, query);
    for (const message of messages) {
      messageMap.set(message.id, { id: message.id, query });
      if (messageMap.size >= MAX_PER_RUN) break;
    }
  }

  let archived = 0;
  let skipped = 0;
  const errors = [];

  for (const message of messageMap.values()) {
    if (state.archived[message.id]) {
      skipped += 1;
      continue;
    }

    try {
      await gmail.users.messages.modify({
        userId: "me",
        id: message.id,
        requestBody: {
          removeLabelIds: ["INBOX"]
        }
      });
      state.archived[message.id] = {
        matchedQuery: message.query,
        archivedAt: new Date().toISOString()
      };
      archived += 1;
    } catch (error) {
      errors.push({ messageId: message.id, error: error.message });
    }
  }

  writeJson(STATE_FILE, state);
  await safeNotifyWhatsapp(`Automação Gmail arquivo: concluída. Encontrados: ${messageMap.size}. Arquivados: ${archived}. Já processados: ${skipped}. Erros: ${errors.length}.`);
  console.log(JSON.stringify({ ok: errors.length === 0, found: messageMap.size, archived, skipped, errors }, null, 2));
}

async function createGmailClient() {
  const credentialsFile = ensureJsonFileFromEnv("GMAIL_OAUTH_CREDENTIALS_JSON", process.env.GMAIL_OAUTH_CREDENTIALS || GMAIL_CREDENTIALS_FILE);
  const tokenFile = ensureJsonFileFromEnv("GMAIL_MODIFY_TOKEN_JSON", process.env.GMAIL_ARCHIVE_OAUTH_TOKEN || GMAIL_TOKEN_FILE);

  if (!fs.existsSync(credentialsFile)) {
    throw new Error(`Credenciais OAuth não encontradas em ${credentialsFile}`);
  }

  const authClient = await createOAuthClient(credentialsFile, tokenFile);
  return google.gmail({ version: "v1", auth: authClient });
}

async function createOAuthClient(credentialsFile, tokenFile) {
  const credentials = readJson(credentialsFile, {});
  const app = credentials.installed || credentials.web;
  if (!app?.client_id || !app?.client_secret) {
    throw new Error(`Arquivo OAuth inválido: ${credentialsFile}`);
  }

  const savedToken = readJson(tokenFile, null);
  const redirectServer = await createRedirectServer();
  const oauth2Client = new google.auth.OAuth2(
    app.client_id,
    app.client_secret,
    redirectServer.redirectUri
  );

  if (savedToken) {
    oauth2Client.setCredentials(savedToken);
    redirectServer.close();
    return oauth2Client;
  }

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/gmail.modify"]
  });

  fs.writeFileSync(GMAIL_AUTH_URL_FILE, authUrl);
  console.log(`Autorize o Gmail abrindo esta URL:\n${authUrl}`);
  openBrowser(authUrl);

  const code = await redirectServer.waitForCode;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  writeJson(tokenFile, tokens);
  return oauth2Client;
}

async function createRedirectServer() {
  let server;
  const waitForCode = new Promise((resolve, reject) => {
    server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url, "http://127.0.0.1");
      if (requestUrl.pathname !== "/oauth2callback") {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const error = requestUrl.searchParams.get("error");
      const code = requestUrl.searchParams.get("code");
      if (error || !code) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(`Autorização falhou: ${error || "código ausente"}`);
        reject(new Error(error || "Código OAuth ausente."));
        server.close();
        return;
      }

      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Gmail autorizado para arquivamento. Você pode fechar esta janela e voltar ao Codex.");
      resolve(code);
      server.close();
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
  return {
    redirectUri,
    waitForCode,
    close: () => server.close()
  };
}

async function listAllMessages(gmail, query) {
  const messages = [];
  let pageToken;

  do {
    if (messages.length >= MAX_PER_RUN) break;
    const response = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: Math.min(50, MAX_PER_RUN - messages.length),
      pageToken
    });
    messages.push(...(response.data.messages || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return messages;
}

async function notifyWhatsapp(message) {
  const config = readJson(WHATSAPP_CONFIG_FILE, {});
  const provider = config.provider || "dry-run";
  const to = normalizePhone(config.managerWhatsapp || process.env.FLEET_MANAGER_WHATSAPP);

  if (!to || provider === "dry-run") {
    console.log(`[whatsapp:${provider}] ${message}`);
    return;
  }

  if (provider !== "webhook" || !config.webhookUrl) {
    console.log(`[whatsapp:${provider}] ${message}`);
    return;
  }

  const isZApi = isZApiWebhook(config.webhookUrl);
  const headers = { "Content-Type": "application/json" };
  if (isZApi) {
    if (!config.webhookToken) {
      console.log(`[whatsapp:z-api] Client-Token ausente. Mensagem: ${message}`);
      return;
    }
    headers["Client-Token"] = config.webhookToken;
  } else if (config.webhookToken) {
    headers.Authorization = `Bearer ${config.webhookToken}`;
  }

  const response = await fetch(config.webhookUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(isZApi ? { phone: to, message } : { to, message })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Falha ao enviar WhatsApp: ${text}`);
  }
}

async function safeNotifyWhatsapp(message) {
  try {
    await notifyWhatsapp(message);
  } catch (error) {
    console.warn(`Aviso WhatsApp não enviado: ${error.message}`);
  }
}

function loadEnv() {
  const envFile = path.join(ROOT_DIR, ".env");
  if (!fs.existsSync(envFile)) return;

  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ensureJsonFileFromEnv(envKey, filePath) {
  if (!process.env[envKey] || fs.existsSync(filePath)) return filePath;
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, process.env[envKey]);
  return filePath;
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function isZApiWebhook(url) {
  try {
    return new URL(url).hostname.toLowerCase().endsWith("z-api.io");
  } catch {
    return false;
  }
}

function openBrowser(url) {
  if (process.platform === "win32") {
    execFile("powershell.exe", ["-NoProfile", "-Command", "Start-Process", url], { windowsHide: true });
    return;
  }

  if (process.platform === "darwin") {
    execFile("open", [url]);
    return;
  }

  execFile("xdg-open", [url]);
}
