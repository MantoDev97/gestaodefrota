const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

loadEnv();

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "fleet-state.json");
const WHATSAPP_CONFIG_FILE = path.join(DATA_DIR, "whatsapp-config.json");
const ALERT_DAYS = [30, 15, 7, 1, 0];
const DAY_MS = 24 * 60 * 60 * 1000;

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
    webhookUrl: process.env.WHATSAPP_WEBHOOK_URL || "",
    webhookToken: process.env.WHATSAPP_WEBHOOK_TOKEN || "",
    managerWhatsapp: process.env.FLEET_MANAGER_WHATSAPP || "5511999990001",
    supervisorWhatsapp: process.env.OPERATION_SUPERVISOR_WHATSAPP || "5511999990002",
    responsibleWhatsapp: process.env.DEFAULT_RESPONSIBLE_WHATSAPP || "5511888880000",
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
  ["accessToken", "webhookToken"].forEach((key) => {
    if (next[key] === "********") next[key] = current[key] || "";
  });
  fs.writeFileSync(WHATSAPP_CONFIG_FILE, JSON.stringify(next, null, 2));
}

function publicWhatsappConfig() {
  const config = readWhatsappConfig();
  return {
    ...config,
    accessToken: config.accessToken ? "********" : "",
    webhookToken: config.webhookToken ? "********" : ""
  };
}

function startScheduler() {
  setInterval(() => {
    const now = new Date();
    const configuredTime = process.env.ALERT_TIME || "08:00";
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

async function sendWhatsApp(to, message, meta) {
  const provider = process.env.WHATSAPP_PROVIDER || "dry-run";

  if (provider === "cloud") {
    return sendCloudApiMessage(to, message);
  }

  if (provider === "webhook") {
    return sendWebhookMessage(to, message, meta);
  }

  return { status: "simulado automatico", provider: "dry-run" };
}

async function sendCloudApiMessage(to, message) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";

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

async function sendWebhookMessage(to, message, meta) {
  const url = process.env.WHATSAPP_WEBHOOK_URL;
  if (!url) {
    return { status: "pendente configuracao", provider: "webhook", error: "Configure WHATSAPP_WEBHOOK_URL." };
  }

  const headers = { "Content-Type": "application/json" };
  if (process.env.WHATSAPP_WEBHOOK_TOKEN) {
    headers.Authorization = `Bearer ${process.env.WHATSAPP_WEBHOOK_TOKEN}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      to,
      message,
      contact: meta.contact,
      document: meta.documentItem
    })
  });

  const text = await response.text();
  if (!response.ok) {
    return { status: "erro", provider: "webhook", error: text };
  }

  return { status: "enviado", provider: "webhook", providerMessageId: text.slice(0, 120) };
}

function ownerContacts(state, documentItem) {
  const contacts = [
    { name: "Gestor da frota", whatsapp: process.env.FLEET_MANAGER_WHATSAPP || "5511999990001", email: "gestor@empresa.com" },
    { name: "Supervisor operacional", whatsapp: process.env.OPERATION_SUPERVISOR_WHATSAPP || "5511999990002", email: "supervisor@empresa.com" }
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
      whatsapp: process.env.DEFAULT_RESPONSIBLE_WHATSAPP || "5511888880000",
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
  const provider = process.env.WHATSAPP_PROVIDER || "dry-run";
  const cloudReady = provider === "cloud" && process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID;
  const webhookReady = provider === "webhook" && process.env.WHATSAPP_WEBHOOK_URL;
  return {
    provider,
    enabled: provider === "dry-run" || Boolean(cloudReady || webhookReady),
    alertTime: process.env.ALERT_TIME || "08:00",
    alertTimezone: process.env.ALERT_TIMEZONE || "America/Sao_Paulo",
    lastAutomaticRun
  };
}

function zonedParts(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.ALERT_TIMEZONE || "America/Sao_Paulo",
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
