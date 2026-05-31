const STORAGE_KEY = "controleFrotaData";
const SESSION_KEY = "controleFrotaSession";
const DAY_MS = 24 * 60 * 60 * 1000;
const alertDays = [30, 15, 7, 1, 0];

const users = [
  { id: "u-gestor", name: "Gestor da Frota", email: "gestor@frota.com", password: "123456", role: "gestor" },
  { id: "u-supervisor", name: "Supervisor Operacional", email: "supervisor@frota.com", password: "123456", role: "supervisor" },
  { id: "u-encarregado", name: "Encarregado de Pátio", email: "encarregado@frota.com", password: "123456", role: "encarregado" },
  { id: "u-analista", name: "Analista Administrativo", email: "analista@frota.com", password: "123456", role: "analista" },
  { id: "u-motorista", name: "Motorista", email: "motorista@frota.com", password: "123456", role: "motorista" }
];

const roleLabels = {
  gestor: "Gestor",
  supervisor: "Supervisor",
  encarregado: "Encarregado",
  analista: "Analista",
  motorista: "Motorista"
};

const permissions = {
  gestor: {
    views: ["dashboard", "vehicles", "drivers", "documents", "checklists", "notifications", "whatsapp", "reports"],
    canManageVehicles: true,
    canManageDrivers: true,
    canManageDocuments: true,
    canManageChecklists: true,
    canSendAlerts: true,
    canResetData: true,
    canConfigureWhatsapp: true
  },
  supervisor: {
    views: ["dashboard", "vehicles", "drivers", "documents", "checklists", "notifications", "whatsapp", "reports"],
    canManageVehicles: true,
    canManageDrivers: true,
    canManageDocuments: true,
    canManageChecklists: true,
    canSendAlerts: true,
    canResetData: false,
    canConfigureWhatsapp: true
  },
  encarregado: {
    views: ["dashboard", "vehicles", "drivers", "documents", "checklists", "notifications"],
    canManageVehicles: true,
    canManageDrivers: false,
    canManageDocuments: true,
    canManageChecklists: true,
    canSendAlerts: true,
    canResetData: false,
    canConfigureWhatsapp: false
  },
  analista: {
    views: ["dashboard", "vehicles", "drivers", "documents", "notifications", "reports"],
    canManageVehicles: true,
    canManageDrivers: true,
    canManageDocuments: true,
    canManageChecklists: false,
    canSendAlerts: false,
    canResetData: false,
    canConfigureWhatsapp: false
  },
  motorista: {
    views: ["dashboard", "documents", "checklists"],
    canManageVehicles: false,
    canManageDrivers: false,
    canManageDocuments: false,
    canManageChecklists: true,
    canSendAlerts: false,
    canResetData: false,
    canConfigureWhatsapp: false
  }
};

const sampleData = {
  vehicles: [
    {
      id: crypto.randomUUID(),
      plate: "ABC-1234",
      model: "Constellation 24.280",
      brand: "Volkswagen",
      year: 2022,
      renavam: "01234567890",
      chassis: "9BWZZZ377VT004251",
      responsible: "Carlos Mendes",
      driverId: "",
      photo: "https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?auto=format&fit=crop&w=900&q=80",
      status: "operacao"
    },
    {
      id: crypto.randomUUID(),
      plate: "DEF-5678",
      model: "Daily 35-150",
      brand: "Iveco",
      year: 2021,
      renavam: "98765432100",
      chassis: "93ZA01LF0M8940042",
      responsible: "Marina Costa",
      driverId: "",
      photo: "https://images.unsplash.com/photo-1519003722824-194d4455a60c?auto=format&fit=crop&w=900&q=80",
      status: "manutencao"
    }
  ],
  drivers: [
    {
      id: crypto.randomUUID(),
      name: "João Silva",
      cpf: "123.456.789-00",
      cnh: "04876543210",
      category: "D",
      cnhDue: addDays(7),
      phone: "(11) 98888-1000",
      whatsapp: "5511988881000",
      email: "joao@empresa.com"
    },
    {
      id: crypto.randomUUID(),
      name: "Ana Pereira",
      cpf: "321.654.987-00",
      cnh: "02987654321",
      category: "E",
      cnhDue: addDays(45),
      phone: "(11) 97777-2000",
      whatsapp: "5511977772000",
      email: "ana@empresa.com"
    }
  ],
  documents: [],
  checklists: [],
  notifications: []
};

sampleData.vehicles[0].driverId = sampleData.drivers[0].id;
sampleData.vehicles[1].driverId = sampleData.drivers[1].id;
sampleData.documents = [
  { id: crypto.randomUUID(), ownerType: "vehicle", ownerId: sampleData.vehicles[0].id, type: "Licenciamento", dueDate: addDays(30), cost: 980 },
  { id: crypto.randomUUID(), ownerType: "vehicle", ownerId: sampleData.vehicles[0].id, type: "Seguro", dueDate: addDays(15), cost: 4200 },
  { id: crypto.randomUUID(), ownerType: "driver", ownerId: sampleData.drivers[0].id, type: "CNH", dueDate: addDays(7), cost: 0 },
  { id: crypto.randomUUID(), ownerType: "vehicle", ownerId: sampleData.vehicles[1].id, type: "Tacógrafo", dueDate: addDays(-2), cost: 360 }
];

let state = loadState();
let currentUser = loadSession();
let syncTimer = null;

const views = {
  dashboard: "Dashboard",
  vehicles: "Veículos",
  drivers: "Motoristas",
  documents: "Documentos",
  checklists: "Checklists",
  notifications: "Notificações",
  whatsapp: "WhatsApp",
  reports: "Relatórios"
};

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => showView(item.dataset.view));
});

document.getElementById("loginForm").addEventListener("submit", login);
document.getElementById("logoutButton").addEventListener("click", logout);
document.getElementById("vehicleForm").addEventListener("submit", saveVehicle);
document.getElementById("driverForm").addEventListener("submit", saveDriver);
document.getElementById("documentForm").addEventListener("submit", saveDocument);
document.getElementById("checklistForm").addEventListener("submit", saveChecklist);
document.getElementById("whatsappForm").addEventListener("submit", saveWhatsappConfig);
document.getElementById("whatsappTestForm").addEventListener("submit", sendWhatsappTest);
document.getElementById("connectWhatsappButton").addEventListener("click", connectWhatsapp);
document.getElementById("docOwnerType").addEventListener("change", renderOwnerOptions);
document.getElementById("runRobot").addEventListener("click", runNotificationRobot);
document.getElementById("openQuickDoc").addEventListener("click", () => showView("documents"));
document.getElementById("resetData").addEventListener("click", resetData);
document.getElementById("clearNotifications").addEventListener("click", clearNotifications);
document.getElementById("closeToast").addEventListener("click", () => document.getElementById("toastDialog").close());
document.getElementById("notificationRows").addEventListener("click", handleNotificationAction);
document.getElementById("documentRows").addEventListener("click", handleDocumentAction);
document.getElementById("dueTable").addEventListener("click", handleDocumentAction);

applyAuthState();
render();
syncServerState();
refreshAutomationStatus();
setInterval(refreshServerState, 60 * 1000);
setInterval(refreshAutomationStatus, 60 * 1000);

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? JSON.parse(saved) : structuredClone(sampleData);
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  syncServerState();
}

function syncServerState() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state)
    }).catch(() => {
      // O app também funciona aberto como arquivo; nesse caso não há backend para sincronizar.
    });
  }, 250);
}

async function refreshServerState() {
  if (!currentUser) return;
  try {
    const response = await fetch("/api/state");
    if (!response.ok) return;
    const serverState = await response.json();
    if (!Array.isArray(serverState.notifications)) return;

    const knownIds = new Set(state.notifications.map((item) => item.id));
    const newNotifications = serverState.notifications.filter((item) => !knownIds.has(item.id));
    if (!newNotifications.length) return;

    state.notifications.unshift(...newNotifications);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    render();
  } catch {
    // Sem backend ativo.
  }
}

async function refreshAutomationStatus() {
  const statusElement = document.getElementById("automationStatus");
  if (!statusElement) return;

  try {
    const response = await fetch("/api/automation-status");
    if (!response.ok) throw new Error("offline");
    const status = await response.json();
    const provider = status.provider === "dry-run" ? "simulação" : status.provider;
    statusElement.textContent = `Automático ${status.alertTime} · ${provider}`;
    const whatsappStatus = document.getElementById("whatsappStatus");
    if (whatsappStatus) {
      whatsappStatus.textContent = status.ready ? `Conectado · ${provider}` : `Pendente · ${provider}`;
    }
  } catch {
    statusElement.textContent = "Servidor automático offline";
    const whatsappStatus = document.getElementById("whatsappStatus");
    if (whatsappStatus) whatsappStatus.textContent = "Servidor offline";
  }
}

async function loadWhatsappConfig() {
  if (!currentUser || !can("canConfigureWhatsapp")) return;
  try {
    const response = await fetch("/api/whatsapp-config");
    if (!response.ok) return;
    const config = await response.json();
    const form = document.getElementById("whatsappForm");
    Object.entries(config).forEach(([key, value]) => {
      if (form.elements[key]) form.elements[key].value = value || "";
    });
  } catch {
    // Sem backend ativo.
  }
}

async function saveWhatsappConfig(event) {
  event.preventDefault();
  if (!requirePermission("canConfigureWhatsapp", "Apenas gestor ou supervisor podem configurar o WhatsApp.")) return;

  const config = Object.fromEntries(new FormData(event.target));
  try {
    const response = await fetch("/api/whatsapp-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config)
    });
    if (!response.ok) throw new Error("Falha ao salvar.");
    await refreshAutomationStatus();
    showToast("Conexão do WhatsApp salva. O robô automático usará esta configuração.");
  } catch {
    showToast("Não foi possível salvar no servidor. Verifique se o backend está online.");
  }
}

async function connectWhatsapp() {
  if (!requirePermission("canConfigureWhatsapp", "Apenas gestor ou supervisor podem conectar o WhatsApp.")) return;

  const qrBox = document.getElementById("qrBox");
  qrBox.textContent = "Conectando...";

  try {
    await fetch("/api/whatsapp-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(document.getElementById("whatsappForm"))))
    });
    const response = await fetch("/api/whatsapp-connect", { method: "POST" });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Não foi possível conectar.");

    if (result.qrCode) {
      qrBox.innerHTML = `<img src="${normalizeQrCode(result.qrCode)}" alt="QR Code para conectar WhatsApp" />`;
    } else {
      qrBox.innerHTML = `<strong>${result.message || "WhatsApp configurado."}</strong>`;
    }

    await refreshAutomationStatus();
  } catch (error) {
    qrBox.textContent = error.message || "Falha ao conectar WhatsApp.";
  }
}

function normalizeQrCode(qrCode) {
  if (!qrCode) return "";
  if (qrCode.startsWith("data:image")) return qrCode;
  return `data:image/png;base64,${qrCode}`;
}

async function sendWhatsappTest(event) {
  event.preventDefault();
  if (!requirePermission("canConfigureWhatsapp", "Apenas gestor ou supervisor podem testar o WhatsApp.")) return;

  const payload = Object.fromEntries(new FormData(event.target));
  try {
    const response = await fetch("/api/test-whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Falha no teste.");
    showToast(`Teste processado: ${result.status}.`);
  } catch (error) {
    showToast(error.message || "Não foi possível enviar o teste.");
  }
}

function loadSession() {
  const saved = localStorage.getItem(SESSION_KEY);
  if (!saved) return null;
  const session = JSON.parse(saved);
  return users.find((user) => user.id === session.userId) || null;
}

function login(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const user = users.find((item) =>
    item.email.toLowerCase() === data.email.toLowerCase().trim() &&
    item.password === data.password
  );

  if (!user) {
    document.getElementById("loginError").textContent = "E-mail ou senha inválidos.";
    return;
  }

  currentUser = user;
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id }));
  event.target.reset();
  document.getElementById("loginError").textContent = "";
  applyAuthState();
  render();
  showView(firstAllowedView());
}

function logout() {
  localStorage.removeItem(SESSION_KEY);
  currentUser = null;
  applyAuthState();
}

function currentPermissions() {
  return permissions[currentUser?.role] || permissions.motorista;
}

function can(action) {
  return Boolean(currentPermissions()[action]);
}

function canView(viewId) {
  return currentPermissions().views.includes(viewId);
}

function firstAllowedView() {
  return currentPermissions().views[0];
}

function requirePermission(action, message) {
  if (can(action)) return true;
  showToast(message || "Seu perfil não possui permissão para esta ação.");
  return false;
}

function applyAuthState() {
  document.body.classList.toggle("is-logged-out", !currentUser);
  document.body.classList.toggle("is-logged-in", Boolean(currentUser));
  document.getElementById("loginScreen").hidden = Boolean(currentUser);

  if (!currentUser) return;

  document.getElementById("userBadge").innerHTML = `
    <strong>${currentUser.name}</strong>
    <span>${roleLabels[currentUser.role]}</span>
  `;

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.hidden = !canView(item.dataset.view);
  });

  document.getElementById("resetData").hidden = !can("canResetData");
  document.getElementById("runRobot").hidden = !can("canSendAlerts");
  document.getElementById("openQuickDoc").hidden = !can("canManageDocuments");
  document.getElementById("vehicleForm").closest(".form-panel").hidden = !can("canManageVehicles");
  document.getElementById("driverForm").closest(".form-panel").hidden = !can("canManageDrivers");
  document.getElementById("documentForm").closest(".form-panel").hidden = !can("canManageDocuments");
  document.getElementById("checklistForm").closest(".form-panel").hidden = !can("canManageChecklists");
  document.querySelector('[data-view="whatsapp"]').hidden = !can("canConfigureWhatsapp");

  if (!canView(document.querySelector(".view.active")?.id)) {
    showView(firstAllowedView());
  }
}

function addDays(days) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysUntil(dateString) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(`${dateString}T00:00:00`);
  return Math.ceil((date - today) / DAY_MS);
}

function formatDate(dateString) {
  return new Date(`${dateString}T00:00:00`).toLocaleDateString("pt-BR");
}

function ownerName(documentItem) {
  if (documentItem.ownerType === "vehicle") {
    const vehicle = state.vehicles.find((item) => item.id === documentItem.ownerId);
    return vehicle ? `${vehicle.plate} - ${vehicle.model}` : "Veículo removido";
  }
  const driver = state.drivers.find((item) => item.id === documentItem.ownerId);
  return driver ? driver.name : "Motorista removido";
}

function ownerContacts(documentItem) {
  const contacts = [
    { name: "Gestor da frota", whatsapp: "5511999990001", email: "gestor@empresa.com" },
    { name: "Supervisor operacional", whatsapp: "5511999990002", email: "supervisor@empresa.com" }
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
    contacts.unshift({ name: vehicle.responsible, whatsapp: "5511888880000", email: "responsavel@empresa.com" });
  }
  return contacts;
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function whatsappUrl(phone, message) {
  const normalized = normalizePhone(phone);
  if (!normalized) return "";
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

function statusFor(documentItem) {
  const days = daysUntil(documentItem.dueDate);
  if (days < 0) return { label: "Vencido", className: "danger" };
  if (days <= 7) return { label: "Crítico", className: "danger" };
  if (days <= 30) return { label: "Atenção", className: "warn" };
  return { label: "Em dia", className: "ok" };
}

function alertMessage(documentItem) {
  const days = daysUntil(documentItem.dueDate);
  const target = ownerName(documentItem);
  if (days < 0) return `DOCUMENTO VENCIDO! ${documentItem.type} de ${target}. Regularização necessária imediatamente.`;
  if (days === 1) return `ALERTA CRÍTICO! ${documentItem.type} de ${target} vence amanhã.`;
  if (days === 7) return `URGENTE! ${documentItem.type} de ${target} vence em 7 dias.`;
  if (days === 15) return `Aviso importante! ${documentItem.type} de ${target} vence em 15 dias.`;
  if (days === 30) return `Atenção! ${documentItem.type} de ${target} vence em 30 dias.`;
  return `${documentItem.type} de ${target} vence em ${days} dias.`;
}

function showView(viewId) {
  if (!canView(viewId)) {
    showToast("Seu perfil não possui acesso a esta tela.");
    viewId = firstAllowedView();
  }
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
  document.getElementById(viewId).classList.add("active");
  document.getElementById("viewTitle").textContent = views[viewId];
}

function saveVehicle(event) {
  event.preventDefault();
  if (!requirePermission("canManageVehicles")) return;
  const data = Object.fromEntries(new FormData(event.target));
  state.vehicles.push({ id: crypto.randomUUID(), ...data });
  event.target.reset();
  persistAndRender("Veículo cadastrado com sucesso.");
}

function saveDriver(event) {
  event.preventDefault();
  if (!requirePermission("canManageDrivers")) return;
  const data = Object.fromEntries(new FormData(event.target));
  const driver = { id: crypto.randomUUID(), ...data };
  state.drivers.push(driver);
  state.documents.push({
    id: crypto.randomUUID(),
    ownerType: "driver",
    ownerId: driver.id,
    type: "CNH",
    dueDate: driver.cnhDue,
    cost: 0
  });
  event.target.reset();
  persistAndRender("Motorista cadastrado e CNH adicionada aos documentos.");
}

function saveDocument(event) {
  event.preventDefault();
  if (!requirePermission("canManageDocuments")) return;
  const data = Object.fromEntries(new FormData(event.target));
  state.documents.push({ id: crypto.randomUUID(), ...data, cost: Number(data.cost || 0) });
  event.target.reset();
  persistAndRender("Documento cadastrado com sucesso.");
}

function saveChecklist(event) {
  event.preventDefault();
  if (!requirePermission("canManageChecklists")) return;
  const formData = new FormData(event.target);
  state.checklists.unshift({
    id: crypto.randomUUID(),
    vehicleId: formData.get("vehicleId"),
    kind: formData.get("kind"),
    date: new Date().toISOString(),
    items: {
      tires: formData.has("tires"),
      lights: formData.has("lights"),
      documents: formData.has("documents"),
      body: formData.has("body")
    },
    photo: formData.get("photo"),
    signature: formData.get("signature")
  });
  event.target.reset();
  persistAndRender("Checklist registrado com assinatura digital.");
}

function runNotificationRobot() {
  if (!requirePermission("canSendAlerts", "Seu perfil não pode disparar alertas.")) return;
  runServerAlerts();
}

async function runServerAlerts() {
  try {
    persist();
    await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state)
    });
    const response = await fetch("/api/run-alerts", { method: "POST" });
    if (!response.ok) throw new Error("Falha ao acionar o servidor.");
    const result = await response.json();

    if (Array.isArray(result.notifications) && result.notifications.length) {
      const knownIds = new Set(state.notifications.map((item) => item.id));
      const newNotifications = result.notifications.filter((item) => !knownIds.has(item.id));
      state.notifications.unshift(...newNotifications);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
    }

    showToast(result.created
      ? `${result.created} alertas automáticos processados pelo servidor.`
      : "Nenhum novo alerta automático para enviar hoje.");
  } catch {
    runLocalNotificationRobot();
  }
}

function runLocalNotificationRobot() {
  const created = [];
  state.documents.forEach((documentItem) => {
    const days = daysUntil(documentItem.dueDate);
    const shouldAlert = alertDays.includes(days) || days < 0;
    if (!shouldAlert) return;

    ownerContacts(documentItem).forEach((contact) => {
      ["WhatsApp", "E-mail"].forEach((channel) => {
        const alreadySent = state.notifications.some((notification) =>
          notification.documentId === documentItem.id &&
          notification.sentTo === contact.name &&
          notification.channel === channel &&
          notification.days === days
        );
        if (alreadySent) return;

        created.push({
          id: crypto.randomUUID(),
          documentId: documentItem.id,
          sentTo: contact.name,
          sentToWhatsapp: normalizePhone(contact.whatsapp),
          sentToEmail: contact.email || "",
          channel,
          sentAt: new Date().toISOString(),
          status: channel === "WhatsApp" ? "pronto para envio" : "simulado",
          days,
          message: alertMessage(documentItem)
        });
      });
    });
  });
  state.notifications.unshift(...created);
  persistAndRender(created.length
    ? `${created.length} notificações simuladas. Inicie o servidor para envio automático real.`
    : "Nenhum novo alerta para enviar hoje.");
}

function queueDocumentWhatsapp(documentId) {
  if (!requirePermission("canSendAlerts", "Seu perfil não pode gerar alertas por WhatsApp.")) return;
  const documentItem = state.documents.find((item) => item.id === documentId);
  if (!documentItem) return;

  const days = daysUntil(documentItem.dueDate);
  const created = ownerContacts(documentItem)
    .filter((contact) => normalizePhone(contact.whatsapp))
    .map((contact) => ({
      id: crypto.randomUUID(),
      documentId: documentItem.id,
      sentTo: contact.name,
      sentToWhatsapp: normalizePhone(contact.whatsapp),
      sentToEmail: contact.email || "",
      channel: "WhatsApp",
      sentAt: new Date().toISOString(),
      status: "pronto para envio",
      days,
      message: alertMessage(documentItem)
    }));

  state.notifications.unshift(...created);
  persistAndRender(`${created.length} alertas WhatsApp adicionados à fila.`);
  showView("notifications");
}

function handleDocumentAction(event) {
  const button = event.target.closest("[data-queue-whatsapp]");
  if (!button) return;
  queueDocumentWhatsapp(button.dataset.queueWhatsapp);
}

function handleNotificationAction(event) {
  const button = event.target.closest("[data-open-whatsapp]");
  if (!button) return;
  if (!requirePermission("canSendAlerts", "Seu perfil não pode abrir disparos de WhatsApp.")) return;

  const notification = state.notifications.find((item) => item.id === button.dataset.openWhatsapp);
  if (!notification) return;

  const url = whatsappUrl(notification.sentToWhatsapp, notification.message);
  if (!url) {
    showToast("Este destinatário não possui WhatsApp cadastrado.");
    return;
  }

  notification.status = "link aberto";
  persist();
  render();
  window.open(url, "_blank", "noopener,noreferrer");
}

function clearNotifications() {
  state.notifications = [];
  persistAndRender("Histórico de notificações limpo.");
}

function resetData() {
  if (!requirePermission("canResetData", "Apenas o gestor pode restaurar os dados de exemplo.")) return;
  state = structuredClone(sampleData);
  persistAndRender("Dados de exemplo restaurados.");
}

function persistAndRender(message) {
  persist();
  render();
  showToast(message);
}

function showToast(message) {
  const dialog = document.getElementById("toastDialog");
  document.getElementById("toastMessage").textContent = message;
  dialog.showModal();
}

function render() {
  if (!currentUser) return;
  applyAuthState();
  renderOptions();
  renderMetrics();
  renderDocuments();
  renderVehicles();
  renderDrivers();
  renderChecklists();
  renderNotifications();
  renderReports();
  renderRobotTimeline();
  loadWhatsappConfig();
}

function renderOptions() {
  const driverOptions = state.drivers.map((driver) => `<option value="${driver.id}">${driver.name}</option>`).join("");
  const vehicleOptions = state.vehicles.map((vehicle) => `<option value="${vehicle.id}">${vehicle.plate} - ${vehicle.model}</option>`).join("");
  document.getElementById("vehicleDriver").innerHTML = `<option value="">Motorista principal</option>${driverOptions}`;
  document.getElementById("checklistVehicle").innerHTML = vehicleOptions;
  renderOwnerOptions();
}

function renderOwnerOptions() {
  const type = document.getElementById("docOwnerType").value;
  const items = type === "vehicle" ? state.vehicles : state.drivers;
  document.getElementById("docOwner").innerHTML = items.map((item) => {
    const label = type === "vehicle" ? `${item.plate} - ${item.model}` : item.name;
    return `<option value="${item.id}">${label}</option>`;
  }).join("");
}

function renderMetrics() {
  const expired = state.documents.filter((item) => daysUntil(item.dueDate) < 0).length;
  const soon = state.documents.filter((item) => daysUntil(item.dueDate) >= 0 && daysUntil(item.dueDate) <= 30).length;
  const inOperation = state.vehicles.filter((item) => item.status === "operacao").length;
  const maintenance = state.vehicles.filter((item) => item.status === "manutencao").length;
  const metrics = [
    ["Veículos", state.vehicles.length],
    ["Próximos vencimentos", soon],
    ["Documentos vencidos", expired],
    ["Operação / manutenção", `${inOperation} / ${maintenance}`]
  ];
  document.getElementById("metricGrid").innerHTML = metrics.map(([label, value]) => `
    <article class="metric">
      <span class="meta">${label}</span>
      <strong>${value}</strong>
    </article>
  `).join("");
}

function renderDocuments() {
  const sorted = [...state.documents].sort((a, b) => daysUntil(a.dueDate) - daysUntil(b.dueDate));
  document.getElementById("documentRows").innerHTML = sorted.map(documentRow).join("");
  const dueSoon = sorted.filter((item) => daysUntil(item.dueDate) <= 30).slice(0, 6);
  document.getElementById("dueTable").innerHTML = dueSoon.map(documentRow).join("");
  document.getElementById("nextDueCount").textContent = `${dueSoon.length} itens`;
}

function documentRow(documentItem) {
  const days = daysUntil(documentItem.dueDate);
  const status = statusFor(documentItem);
  const action = can("canSendAlerts")
    ? `<button class="mini-button" data-queue-whatsapp="${documentItem.id}">WhatsApp</button>`
    : `<span class="meta">Sem permissão</span>`;
  return `
    <tr>
      <td>${documentItem.type}</td>
      <td>${ownerName(documentItem)}</td>
      <td>${formatDate(documentItem.dueDate)}</td>
      <td>${days < 0 ? `${Math.abs(days)} dias vencido` : `${days} dias`}</td>
      <td><span class="status ${status.className}">${status.label}</span></td>
      <td>${action}</td>
    </tr>
  `;
}

function renderVehicles() {
  document.getElementById("vehicleCards").innerHTML = state.vehicles.map((vehicle) => {
    const driver = state.drivers.find((item) => item.id === vehicle.driverId);
    return `
      <article class="entity-card">
        ${vehicle.photo ? `<img src="${vehicle.photo}" alt="${vehicle.plate}" />` : ""}
        <div>
          <h2>${vehicle.plate}</h2>
          <span class="meta">${vehicle.brand} ${vehicle.model} · ${vehicle.year}</span>
        </div>
        <p>Responsável: ${vehicle.responsible || "Não informado"}</p>
        <p>Motorista: ${driver?.name || "Não definido"}</p>
        <span class="status ${vehicle.status === "manutencao" ? "warn" : vehicle.status === "operacao" ? "ok" : "danger"}">${labelStatus(vehicle.status)}</span>
      </article>
    `;
  }).join("");
}

function labelStatus(status) {
  return ({ operacao: "Em operação", manutencao: "Em manutenção", inativo: "Inativo" })[status] || status;
}

function renderDrivers() {
  document.getElementById("driverRows").innerHTML = state.drivers.map((driver) => `
    <tr>
      <td>${driver.name}<span class="meta">${driver.cpf}</span></td>
      <td>${driver.cnh}</td>
      <td>${driver.category}</td>
      <td>${formatDate(driver.cnhDue)}</td>
      <td>${driver.whatsapp}</td>
    </tr>
  `).join("");
}

function renderChecklists() {
  document.getElementById("checklistCards").innerHTML = state.checklists.map((checklist) => {
    const vehicle = state.vehicles.find((item) => item.id === checklist.vehicleId);
    const completed = Object.values(checklist.items).filter(Boolean).length;
    return `
      <article class="entity-card">
        <h2>${checklist.kind === "saida" ? "Vistoria de saída" : "Vistoria de retorno"}</h2>
        <span class="meta">${vehicle?.plate || "Veículo removido"} · ${new Date(checklist.date).toLocaleString("pt-BR")}</span>
        <p>${completed}/4 itens aprovados</p>
        <p>Assinatura: ${checklist.signature}</p>
        ${checklist.photo ? `<span class="meta">Foto: ${checklist.photo}</span>` : ""}
      </article>
    `;
  }).join("") || `<article class="entity-card"><p>Nenhum checklist registrado ainda.</p></article>`;
}

function renderNotifications() {
  document.getElementById("notificationRows").innerHTML = state.notifications.map((notification) => {
    const documentItem = state.documents.find((item) => item.id === notification.documentId);
    const action = notification.channel === "WhatsApp" && can("canSendAlerts")
      ? `<button class="mini-button" data-open-whatsapp="${notification.id}">Abrir WhatsApp</button>`
      : `<span class="meta">Sem ação</span>`;
    return `
      <tr>
        <td>${new Date(notification.sentAt).toLocaleString("pt-BR")}</td>
        <td>${documentItem ? `${documentItem.type} · ${ownerName(documentItem)}` : "Documento removido"}</td>
        <td>${notification.sentTo}</td>
        <td>${notification.channel}</td>
        <td><span class="status ok">${notification.status}</span></td>
        <td>${action}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="6">Nenhuma notificação enviada.</td></tr>`;
}

function renderReports() {
  const totalCosts = state.documents.reduce((sum, item) => sum + Number(item.cost || 0), 0);
  const futureDue = state.documents.filter((item) => daysUntil(item.dueDate) >= 0).length;
  const reports = [
    ["Veículos ativos", state.vehicles.filter((item) => item.status !== "inativo").length],
    ["Custos em documentos", totalCosts.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })],
    ["Histórico de manutenções", state.vehicles.filter((item) => item.status === "manutencao").map((item) => item.plate).join(", ") || "Sem veículos em manutenção"],
    ["Histórico de notificações", `${state.notifications.length} registros`],
    ["Vencimentos futuros", `${futureDue} documentos`],
    ["Checklists digitais", `${state.checklists.length} registros`]
  ];
  document.getElementById("reportGrid").innerHTML = reports.map(([title, value]) => `
    <article class="report-card">
      <span class="meta">${title}</span>
      <strong>${value}</strong>
    </article>
  `).join("");
}

function renderRobotTimeline() {
  const steps = [
    "Servidor verifica vencimentos diariamente no horário configurado",
    "Encontra documentos em 30, 15, 7, 1 dia ou vencidos",
    "Envia WhatsApp pela Cloud API ou webhook configurado",
    "Motorista, responsável, gestor e supervisor recebem o alerta"
  ];
  document.getElementById("robotTimeline").innerHTML = steps.map((step) => `
    <div class="timeline-item">
      <strong>${step}</strong>
    </div>
  `).join("");
}
