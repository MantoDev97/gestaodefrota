const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");

loadEnv();

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "fleet-state.json");
const WHATSAPP_CONFIG_FILE = path.join(DATA_DIR, "whatsapp-config.json");
const ALERT_DAYS = [30, 15, 7, 1, 0];
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ALERT_WHATSAPP = "5594991712559";

let lastAutomaticRun = "";

ensureDataDir();
startScheduler();

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/automation-status") {
      return sendJson(response, automationStatus());
    }

    if (request.method === "GET" && request.url === "/api/whatsapp-config") {
      return sendJson(response, publicWhatsappConfig());
    }

    if (request.method === "POST" && request.url === "/api/whatsapp-config") {
      const body = await readJsonBody(request);
      writeWhatsappConfig(body);
      return sendJson(response, { ok: true, status: automationStatus() });
    }

    if (request.method === "POST" && request.url === "/api/test-whatsapp") {
      const body = await readJsonBody(request);
      const result = await sendWhatsApp(normalizePhone(body.to), body.message || "Teste do Controle de Frota.", {
        contact: { name: "Teste", whatsapp: body.to },
        documentItem: { type: "Teste", dueDate: localDateKey(new Date()) }
      });
      return sendJson(response, { ok: result.status !== "erro", ...result });
    }

    if (request.method === "POST" && request.url === "/api/whatsapp-connect") {
      const result = await connectWhatsApp();
      return sendJson(response, result, result.ok ? 200 : 400);
    }

    if (request.method === "GET" && request.url === "/api/state") {
      return sendJson(response, readState());
    }

    if (request.method === "POST" && request.url === "/api/state") {
      const body = await readJsonBody(request);
      writeState(body);
      return sendJson(response, { ok: true });
    }

    if (request.method === "POST" && request.url === "/api/run-alerts") {
      const result = await runAutomaticAlerts("manual");
      return sendJson(response, result);
    }

    if (request.method === "GET" && request.url.startsWith("/api/run-alerts")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const token = url.searchParams.get("token");
      if (!process.env.CRON_TOKEN || token !== process.env.CRON_TOKEN) {
        return sendJson(response, { ok: false, error: "Token de automação inválido." }, 403);
      }
      const result = await runAutomaticAlerts("cron");
      return sendJson(response, result);
    }

    if (request.method === "GET" && request.url.startsWith("/api/run-gmail-automations")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const token = url.searchParams.get("token");
      if (!process.env.CRON_TOKEN || token !== process.env.CRON_TOKEN) {
        return sendJson(response, { ok: false, error: "Token de automação inválido." }, 403);
      }
      const result = await runGmailAutomations();
      return sendJson(response, result, result.ok ? 200 : 500);
    }

    if (request.method === "POST" && request.url === "/api/run-gmail-automations") {
      const result = await runGmailAutomations();
      return sendJson(response, result, result.ok ? 200 : 500);
    }

    if (request.method === "POST" && request.url === "/api/run-gmail-boletos") {
      const result = await runNodeScript("scripts/gmail-boletos.js");
      return sendJson(response, result, result.ok ? 200 : 500);
    }

    if (request.method === "POST" && request.url === "/api/run-gmail-archive") {
      const result = await runNodeScript("scripts/gmail-arquivar-promocoes-bancos.js");
      return sendJson(response, result, result.ok ? 200 : 500);
    }

    serveStatic(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, { ok: false, error: error.message }, 500);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Controle de Frota rodando em http://${HOST}:${PORT}/`);
  console.log(`WhatsApp automático: ${automationStatus().enabled ? "configurado" : "aguardando configuração"}`);
});

function loadEnv() {
  const envFile = path.join(__dirname, ".env");
  if (!fs.existsSync(envFile)) return;

  const lines = fs.readFileSync(envFile, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  });
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) {
    writeState({ vehicles: [], drivers: [], documents: [], checklists: [], notifications: [] });
  }
  if (!fs.existsSync(WHATSAPP_CONFIG_FILE)) {
    writeWhatsappConfig({});
  }
}

function readState() {
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(normalizeState(state), null, 2));
}

function normalizeState(state) {
  return {
    vehicles: Array.isArray(state.vehicles) ? state.vehicles : [],
    drivers: Array.isArray(state.drivers) ? state.drivers : [],
    documents: Array.isArray(state.documents) ? state.documents : [],
    checklists: Array.isArray(state.checklists) ? state.checklists : [],
    notifications: Array.isArray(state.notifications) ? state.notifications : []
  };
}

function defaultWhatsappConfig() {
  return {
    provider: process.env.WHATSAPP_PROVIDER || "dry-run",
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION || "v23.0",
    evolutionUrl: process.env.EVOLUTION_API_URL || "",
    evolutionApiKey: process.env.EVOLUTION_API_KEY || "",
    evolutionInstance: process.env.EVOLUTION_INSTANCE || "gestao-frota",
    webhookUrl: process.env.WHATSAPP_WEBHOOK_URL || "",
    webhookToken: process.env.WHATSAPP_WEBHOOK_TOKEN || "",
    managerWhatsapp: process.env.FLEET_MANAGER_WHATSAPP || DEFAULT_ALERT_WHATSAPP,
    supervisorWhatsapp: process.env.OPERATION_SUPERVISOR_WHATSAPP || DEFAULT_ALERT_WHATSAPP,
    responsibleWhatsapp: process.env.DEFAULT_RESPONSIBLE_WHATSAPP || DEFAULT_ALERT_WHATSAPP,
    alertTime: process.env.ALERT_TIME || "08:00",
    alertTimezone: process.env.ALERT_TIMEZONE || "America/Sao_Paulo"
  };
}

function readWhatsappConfig() {
  const saved = fs.existsSync(WHATSAPP_CONFIG_FILE)
    ? JSON.parse(fs.readFileSync(WHATSAPP_CONFIG_FILE, "utf8"))
    : {};
  return { ...defaultWhatsappConfig(), ...saved };
}

function writeWhatsappConfig(config) {
  const current = fs.existsSync(WHATSAPP_CONFIG_FILE)
    ? JSON.parse(fs.readFileSync(WHATSAPP_CONFIG_FILE, "utf8"))
    : {};
  const next = { ...current, ...config };
  ["accessToken", "webhookToken", "evolutionApiKey"].forEach((key) => {
    if (next[key] === "********") next[key] = current[key] || "";
  });
  fs.writeFileSync(WHATSAPP_CONFIG_FILE, JSON.stringify(next, null, 2));
}

function publicWhatsappConfig() {
  const config = readWhatsappConfig();
  return {
    ...config,
    accessToken: config.accessToken ? "********" : "",
    webhookToken: config.webhookToken ? "********" : "",
    evolutionApiKey: config.evolutionApiKey ? "********" : ""
  };
}

function startScheduler() {
  setInterval(() => {
    const now = new Date();
    const config = readWhatsappConfig();
    const configuredTime = config.alertTime || "08:00";
    const zonedNow = zonedParts(now);
    const today = zonedNow.date;
    const currentTime = zonedNow.time;

    if (currentTime === configuredTime && lastAutomaticRun !== today) {
      lastAutomaticRun = today;
      runAutomaticAlerts("scheduled").catch((error) => console.error("Falha no alerta automático:", error));
    }
  }, 30 * 1000);
}

async function runAutomaticAlerts(source) {
  const state = readState();
  const created = [];
  const today = localDateKey(new Date());

  for (const documentItem of state.documents) {
    const days = daysUntil(documentItem.dueDate);
    const shouldAlert = ALERT_DAYS.includes(days) || days < 0;
    if (!shouldAlert) continue;

    for (const contact of ownerContacts(state, documentItem)) {
      const phone = normalizePhone(contact.whatsapp);
      if (!phone) continue;

      const alreadySent = state.notifications.some((notification) =>
        notification.documentId === documentItem.id &&
        notification.sentTo === contact.name &&
        notification.channel === "WhatsApp" &&
        notification.days === days &&
        notification.sentDate === today &&
        ["enviado", "simulado automatico", "pendente configuracao"].includes(notification.status)
      );
      if (alreadySent) continue;

      const message = alertMessage(state, documentItem);
      const sendResult = await sendWhatsApp(phone, message, { contact, documentItem });

      created.push({
        id: randomUUID(),
        documentId: documentItem.id,
        sentTo: contact.name,
        sentToWhatsapp: phone,
        sentToEmail: contact.email || "",
        channel: "WhatsApp",
        sentAt: new Date().toISOString(),
        sentDate: today,
        status: sendResult.status,
        source,
        days,
        provider: sendResult.provider,
        providerMessageId: sendResult.providerMessageId || "",
        error: sendResult.error || "",
        message
      });
    }
  }

  if (created.length) {
    state.notifications.unshift(...created);
    writeState(state);
  }

  return { ok: true, created: created.length, notifications: created, status: automationStatus() };
}

async function runGmailAutomations() {
  const boletos = await runNodeScript("scripts/gmail-boletos.js");
  const arquivamento = await runNodeScript("scripts/gmail-arquivar-promocoes-bancos.js");
  const ok = boletos.ok && arquivamento.ok;
  return {
    ok,
    ranAt: new Date().toISOString(),
    boletos,
    arquivamento
  };
}

function runNodeScript(scriptPath) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(__dirname, scriptPath)], {
      cwd: __dirname,
      windowsHide: true,
      timeout: 120000
    }, (error, stdout, stderr) => {
      const parsed = parseLastJson(stdout);
      resolve({
        ok: !error && (!parsed || parsed.ok !== false),
        code: error?.code || 0,
        signal: error?.signal || "",
        stdout: stdout.trim().slice(-4000),
        stderr: stderr.trim().slice(-4000),
        result: parsed
      });
    });
  });
}

function parseLastJson(output) {
  const start = output.lastIndexOf("{");
  if (start === -1) return null;
  try {
    return JSON.parse(output.slice(start));
  } catch {
    return null;
  }
}

async function sendWhatsApp(to, message, meta) {
  const config = readWhatsappConfig();
  const provider = config.provider || "dry-run";

  if (provider === "cloud") {
    return sendCloudApiMessage(to, message, config);
  }

  if (provider === "webhook") {
    return sendWebhookMessage(to, message, meta, config);
  }

  if (provider === "evolution") {
    return sendEvolutionMessage(to, message, config);
  }

  return { status: "simulado automatico", provider: "dry-run" };
}

async function sendCloudApiMessage(to, message, config) {
  const token = config.accessToken;
  const phoneNumberId = config.phoneNumberId;
  const version = config.graphVersion || "v23.0";

  if (!token || !phoneNumberId) {
    return { status: "pendente configuracao", provider: "cloud", error: "Configure WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID." };
  }

  const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: message }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { status: "erro", provider: "cloud", error: JSON.stringify(payload) };
  }

  return {
    status: "enviado",
    provider: "cloud",
    providerMessageId: payload.messages?.[0]?.id || ""
  };
}

async function sendWebhookMessage(to, message, meta, config) {
  const url = config.webhookUrl;
  if (!url) {
    return { status: "pendente configuracao", provider: "webhook", error: "Configure WHATSAPP_WEBHOOK_URL." };
  }

  const headers = { "Content-Type": "application/json" };
  const isZApi = isZApiWebhook(url);

  if (isZApi && !config.webhookToken) {
    return { status: "pendente configuracao", provider: "z-api", error: "Configure WHATSAPP_WEBHOOK_TOKEN com o Client-Token da Z-API." };
  }

  if (isZApi) {
    headers["Client-Token"] = config.webhookToken;
  } else if (config.webhookToken) {
    headers.Authorization = `Bearer ${config.webhookToken}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(isZApi
      ? { phone: to, message }
      : {
          to,
          message,
          contact: meta.contact,
          document: meta.documentItem
        })
  });

  const text = await response.text();
  if (!response.ok) {
    return { status: "erro", provider: isZApi ? "z-api" : "webhook", error: text };
  }

  return { status: "enviado", provider: isZApi ? "z-api" : "webhook", providerMessageId: text.slice(0, 120) };
}

function isZApiWebhook(url) {
  try {
    return new URL(url).hostname.toLowerCase().endsWith("z-api.io");
  } catch {
    return false;
  }
}

async function sendEvolutionMessage(to, message, config) {
  if (!config.evolutionUrl || !config.evolutionApiKey || !config.evolutionInstance) {
    return { status: "pendente configuracao", provider: "evolution", error: "Configure URL, API Key e instância da Evolution API." };
  }

  const response = await fetch(`${trimSlash(config.evolutionUrl)}/message/sendText/${encodeURIComponent(config.evolutionInstance)}`, {
    method: "POST",
    headers: evolutionHeaders(config),
    body: JSON.stringify({
      number: to,
      text: message
    })
  });

  const text = await response.text();
  if (!response.ok) {
    return { status: "erro", provider: "evolution", error: text };
  }

  return { status: "enviado", provider: "evolution", providerMessageId: text.slice(0, 120) };
}

async function connectWhatsApp() {
  const config = readWhatsappConfig();

  if (config.provider === "cloud") {
    const ready = Boolean(config.accessToken && config.phoneNumberId);
    return {
      ok: ready,
      provider: "cloud",
      message: ready
        ? "WhatsApp Cloud API configurada. O número oficial enviará os alertas."
        : "Informe Token Cloud API e Phone Number ID."
    };
  }

  if (config.provider !== "evolution") {
    return {
      ok: config.provider === "dry-run",
      provider: config.provider,
      message: config.provider === "dry-run"
        ? "Modo teste ativo. Os alertas serão registrados sem envio real."
        : "Para conexão por QR, selecione Conectar com QR Code."
    };
  }

  if (!config.evolutionUrl || !config.evolutionApiKey || !config.evolutionInstance) {
    return { ok: false, provider: "evolution", error: "Informe URL da Evolution API, API Key e nome da instância." };
  }

  await ensureEvolutionInstance(config);
  const response = await fetch(`${trimSlash(config.evolutionUrl)}/instance/connect/${encodeURIComponent(config.evolutionInstance)}`, {
    method: "GET",
    headers: evolutionHeaders(config)
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return { ok: false, provider: "evolution", error: JSON.stringify(payload) };
  }

  const qrCode = payload.base64 || payload.qrcode?.base64 || payload.qr || payload.code || "";
  return {
    ok: true,
    provider: "evolution",
    message: qrCode ? "Escaneie o QR Code com o WhatsApp." : "Instância conectada ou aguardando status.",
    qrCode
  };
}

async function ensureEvolutionInstance(config) {
  const response = await fetch(`${trimSlash(config.evolutionUrl)}/instance/create`, {
    method: "POST",
    headers: evolutionHeaders(config),
    body: JSON.stringify({
      instanceName: config.evolutionInstance,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS"
    })
  });

  if ([200, 201, 409, 422].includes(response.status)) return;
  const text = await response.text();
  throw new Error(text || "Falha ao criar instância na Evolution API.");
}

function evolutionHeaders(config) {
  return {
    "Content-Type": "application/json",
    apikey: config.evolutionApiKey,
    Authorization: `Bearer ${config.evolutionApiKey}`
  };
}

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function ownerContacts(state, documentItem) {
  const config = readWhatsappConfig();
  const contacts = [
    { name: "Gestor da frota", whatsapp: config.managerWhatsapp || "5511999990001", email: "gestor@empresa.com" },
    { name: "Supervisor operacional", whatsapp: config.supervisorWhatsapp || "5511999990002", email: "supervisor@empresa.com" }
  ];

  if (documentItem.ownerType === "driver") {
    const driver = state.drivers.find((item) => item.id === documentItem.ownerId);
    if (driver) contacts.unshift(driver);
    return contacts;
  }

  const vehicle = state.vehicles.find((item) => item.id === documentItem.ownerId);
  const driver = state.drivers.find((item) => item.id === vehicle?.driverId);
  if (driver) contacts.unshift(driver);
  if (vehicle?.responsible) {
    contacts.unshift({
      name: vehicle.responsible,
      whatsapp: config.responsibleWhatsapp || "5511888880000",
      email: "responsavel@empresa.com"
    });
  }
  return contacts;
}

function ownerName(state, documentItem) {
  if (documentItem.ownerType === "vehicle") {
    const vehicle = state.vehicles.find((item) => item.id === documentItem.ownerId);
    return vehicle ? `${vehicle.plate} - ${vehicle.model}` : "Veículo removido";
  }
  const driver = state.drivers.find((item) => item.id === documentItem.ownerId);
  return driver ? driver.name : "Motorista removido";
}

function alertMessage(state, documentItem) {
  const days = daysUntil(documentItem.dueDate);
  const target = ownerName(state, documentItem);
  if (days < 0) return `DOCUMENTO VENCIDO! ${documentItem.type} de ${target}. Regularização necessária imediatamente.`;
  if (days === 1) return `ALERTA CRÍTICO! ${documentItem.type} de ${target} vence amanhã.`;
  if (days === 7) return `URGENTE! ${documentItem.type} de ${target} vence em 7 dias.`;
  if (days === 15) return `Aviso importante! ${documentItem.type} de ${target} vence em 15 dias.`;
  if (days === 30) return `Atenção! ${documentItem.type} de ${target} vence em 30 dias.`;
  return `${documentItem.type} de ${target} vence em ${days} dias.`;
}

function daysUntil(dateString) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(`${dateString}T00:00:00`);
  return Math.ceil((date - today) / DAY_MS);
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function automationStatus() {
  const config = readWhatsappConfig();
  const provider = config.provider || "dry-run";
  const cloudReady = provider === "cloud" && config.accessToken && config.phoneNumberId;
  const webhookReady = provider === "webhook" && config.webhookUrl;
  const evolutionReady = provider === "evolution" && config.evolutionUrl && config.evolutionApiKey && config.evolutionInstance;
  const ready = provider === "dry-run" || Boolean(cloudReady || webhookReady || evolutionReady);
  return {
    provider,
    enabled: ready,
    ready,
    alertTime: config.alertTime || "08:00",
    alertTimezone: config.alertTimezone || "America/Sao_Paulo",
    lastAutomaticRun
  };
}

function zonedParts(date) {
  const config = readWhatsappConfig();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.alertTimezone || "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(__dirname, pathname));

  if (!filePath.startsWith(__dirname)) {
    response.writeHead(403);
    response.end("Acesso negado");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Arquivo não encontrado");
      return;
    }

    response.writeHead(200, { "Content-Type": contentType(filePath) });
    response.end(content);
  });
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml"
  }[extension] || "application/octet-stream";
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error("Payload muito grande"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body ? JSON.parse(body) : {}));
    request.on("error", reject);
  });
}

function sendJson(response, payload, statusCode = 200) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
