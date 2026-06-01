const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { google } = require("googleapis");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const STATE_FILE = path.join(DATA_DIR, "gmail-boletos-state.json");
const GMAIL_CREDENTIALS_FILE = path.join(DATA_DIR, "gmail-oauth-credentials.json");
const GMAIL_TOKEN_FILE = path.join(DATA_DIR, "gmail-oauth-token.json");
const GMAIL_AUTH_URL_FILE = path.join(DATA_DIR, "gmail-auth-url.txt");
const GMAIL_DEBUG_FILE = path.join(DATA_DIR, "gmail-boletos-debug.log");
const WHATSAPP_CONFIG_FILE = path.join(DATA_DIR, "whatsapp-config.json");
const DEFAULT_DOWNLOAD_DIR = "C:\\Users\\DevManto\\Downloads\\teste boleto";
const OFFICE_EXTENSIONS = new Set([
  ".csv",
  ".doc",
  ".docm",
  ".docx",
  ".dot",
  ".dotm",
  ".dotx",
  ".pot",
  ".potm",
  ".potx",
  ".pdf",
  ".pps",
  ".ppsm",
  ".ppsx",
  ".ppt",
  ".pptm",
  ".pptx",
  ".rtf",
  ".xls",
  ".xlsb",
  ".xlsm",
  ".xlsx",
  ".xlt",
  ".xltm",
  ".xltx"
]);

loadEnv();

main().catch(async (error) => {
  console.error(error);
  await notifyWhatsapp(`Automação Gmail boletos: erro - ${error.message}`).catch(() => {});
  process.exitCode = 1;
});

async function main() {
  ensureDir(DATA_DIR);
  debugLog("main:start");
  const downloadDir = process.env.GMAIL_BOLETOS_DOWNLOAD_DIR || DEFAULT_DOWNLOAD_DIR;
  ensureDir(downloadDir);

  const state = readJson(STATE_FILE, { attachments: {} });
  debugLog("main:create-gmail-client");
  const gmail = await createGmailClient();
  debugLog("main:gmail-client-ready");
  await safeNotifyWhatsapp("Automação Gmail boletos: iniciando verificação.");
  const messages = await listAllMessages(gmail, 'subject:boleto has:attachment');
  let saved = 0;
  let skipped = 0;

  for (const messageRef of messages) {
    const message = await gmail.users.messages.get({
      userId: "me",
      id: messageRef.id,
      format: "full"
    });
    const attachments = collectAttachments(message.data.payload);

    for (const attachment of attachments) {
      const extension = path.extname(attachment.filename || "").toLowerCase();
      if (!OFFICE_EXTENSIONS.has(extension)) continue;

      const stateKey = `${messageRef.id}:${attachment.attachmentId}:${attachment.filename}`;
      if (state.attachments[stateKey] || alreadySavedAttachment(state, messageRef.id, attachment.filename)) {
        skipped += 1;
        continue;
      }

      const result = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId: messageRef.id,
        id: attachment.attachmentId
      });
      const buffer = Buffer.from(result.data.data || "", "base64url");
      const outputPath = uniquePath(path.join(downloadDir, safeFilename(attachment.filename)));
      fs.writeFileSync(outputPath, buffer);

      state.attachments[stateKey] = {
        messageId: messageRef.id,
        filename: attachment.filename,
        outputPath,
        savedAt: new Date().toISOString()
      };
      saved += 1;
    }
  }

  writeJson(STATE_FILE, state);
  await safeNotifyWhatsapp(`Automação Gmail boletos: verificação concluída. Emails encontrados: ${messages.length}. Arquivos salvos: ${saved}. Já processados: ${skipped}.`);
  console.log(JSON.stringify({ ok: true, messages: messages.length, saved, skipped, downloadDir }, null, 2));
}

async function createGmailClient() {
  const credentialsFile = ensureJsonFileFromEnv("GMAIL_OAUTH_CREDENTIALS_JSON", process.env.GMAIL_OAUTH_CREDENTIALS || GMAIL_CREDENTIALS_FILE);
  const tokenFile = ensureJsonFileFromEnv("GMAIL_OAUTH_TOKEN_JSON", process.env.GMAIL_OAUTH_TOKEN || GMAIL_TOKEN_FILE);

  if (fs.existsSync(credentialsFile)) {
    debugLog(`auth:using-oauth-file:${credentialsFile}`);
    const authClient = await createOAuthClient(credentialsFile, tokenFile);
    return google.gmail({ version: "v1", auth: authClient });
  }

  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"]
  });
  const authClient = await auth.getClient();
  return google.gmail({ version: "v1", auth: authClient });
}

async function createOAuthClient(credentialsFile, tokenFile) {
  debugLog("oauth:read-credentials");
  const credentials = readJson(credentialsFile, {});
  const app = credentials.installed || credentials.web;
  if (!app?.client_id || !app?.client_secret) {
    throw new Error(`Arquivo OAuth inválido: ${credentialsFile}`);
  }

  const savedToken = readJson(tokenFile, null);
  debugLog(savedToken ? "oauth:using-saved-token" : "oauth:create-redirect-server");
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
    scope: ["https://www.googleapis.com/auth/gmail.readonly"]
  });

  fs.writeFileSync(GMAIL_AUTH_URL_FILE, authUrl);
  debugLog(`oauth:auth-url-written:${GMAIL_AUTH_URL_FILE}`);
  console.log(`Autorize o Gmail abrindo esta URL:\n${authUrl}`);
  openBrowser(authUrl);

  const code = await redirectServer.waitForCode;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  writeJson(tokenFile, tokens);
  return oauth2Client;
}

async function createRedirectServer() {
  debugLog("redirect:create-server");
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
      response.end("Gmail autorizado. Você pode fechar esta janela e voltar ao Codex.");
      resolve(code);
      server.close();
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  debugLog(`redirect:listening:${JSON.stringify(address)}`);
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
    const response = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 100,
      pageToken
    });
    messages.push(...(response.data.messages || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return messages;
}

function collectAttachments(part, attachments = []) {
  if (!part) return attachments;

  if (part.filename && part.body?.attachmentId) {
    attachments.push({
      filename: part.filename,
      attachmentId: part.body.attachmentId
    });
  }

  for (const child of part.parts || []) {
    collectAttachments(child, attachments);
  }

  return attachments;
}

function alreadySavedAttachment(state, messageId, filename) {
  return Object.values(state.attachments || {}).some((attachment) =>
    attachment.messageId === messageId &&
    attachment.filename === filename &&
    attachment.outputPath &&
    fs.existsSync(attachment.outputPath)
  );
}

async function notifyWhatsapp(message) {
  const config = readJson(WHATSAPP_CONFIG_FILE, {});
  const provider = config.provider || "dry-run";
  const to = normalizePhone(config.managerWhatsapp || process.env.FLEET_MANAGER_WHATSAPP);

  if (!to || provider === "dry-run") {
    console.log(`[whatsapp:${provider}] ${message}`);
    return;
  }

  if (provider !== "webhook") {
    console.log(`[whatsapp:${provider}] Envio direto da automação só usa webhook/Z-API. Mensagem: ${message}`);
    return;
  }

  if (!config.webhookUrl) {
    console.log(`[whatsapp:webhook] WHATSAPP_WEBHOOK_URL ausente. Mensagem: ${message}`);
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

function safeFilename(filename) {
  return String(filename || "anexo")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function uniquePath(filePath) {
  if (!fs.existsSync(filePath)) return filePath;
  const dir = path.dirname(filePath);
  const extension = path.extname(filePath);
  const base = path.basename(filePath, extension);

  for (let index = 2; index < 10000; index += 1) {
    const candidate = path.join(dir, `${base} (${index})${extension}`);
    if (!fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`Não foi possível gerar nome único para ${filePath}`);
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

function debugLog(message) {
  try {
    fs.appendFileSync(GMAIL_DEBUG_FILE, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Debug logging must never block the automation.
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
