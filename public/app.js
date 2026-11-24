const $ = (id) => document.getElementById(id);

const chat = $("chat");
const traceList = $("trace-list");
const promptInput = $("prompt");
const sendButton = $("send");
const chatForm = $("chat-form");
const profileForm = $("profile-form");
const sessionInput = $("session-id");
const statusBox = $("status");
const statusText = $("status-text");
const profileStatus = $("profile-status");
const profileMessage = $("profile-message");
const turnCount = $("turn-count");

let busy = false;

const sessionId = () => sessionInput.value.trim() || "web";

const setStatus = (text, kind = "") => {
  statusText.textContent = text;
  statusBox.className = `status ${kind}`.trim();
};

const api = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
};

const scrollToBottom = () => {
  chat.scrollTop = chat.scrollHeight;
};

const removeEmptyState = () => {
  $("empty-state")?.remove();
};

const addMessage = (role, content) => {
  removeEmptyState();
  const message = document.createElement("div");
  message.className = `message ${role}`;
  message.textContent = content;
  chat.append(message);
  scrollToBottom();
};

const showEmptyState = () => {
  chat.innerHTML = `
    <div class="empty" id="empty-state">
      <h3>Start a conversation</h3>
      <p>Save your profile in the sidebar, then ask the agent to find your best-fit roles.</p>
    </div>`;
};

const renderMessages = (messages) => {
  chat.innerHTML = "";
  if (messages.length === 0) {
    showEmptyState();
    return;
  }
  for (const message of messages) {
    addMessage(message.role === "model" ? "model" : "user", message.content);
  }
};

const renderTrace = (trace, turns) => {
  traceList.innerHTML = "";
  turnCount.textContent = `${turns} turn${turns === 1 ? "" : "s"}`;

  if (!trace.length) {
    const muted = document.createElement("p");
    muted.className = "muted";
    muted.textContent = "No tool calls in the last answer.";
    traceList.append(muted);
    return;
  }

  for (const item of trace) {
    const card = document.createElement("div");
    card.className = "trace-item";

    const head = document.createElement("div");
    head.className = "trace-head";

    const name = document.createElement("span");
    name.className = "trace-name";
    name.textContent = item.name;

    const badge = document.createElement("span");
    badge.className = `trace-badge${item.ok ? "" : " failed"}`;
    badge.textContent = item.ok ? "ok" : "error";

    head.append(name, badge);

    const details = document.createElement("pre");
    details.textContent = item.error ?? JSON.stringify(item.args, null, 2);

    card.append(head, details);
    traceList.append(card);
  }
};

const loadHistory = async () => {
  const data = await api(`/history?sessionId=${encodeURIComponent(sessionId())}`);
  renderMessages(data.messages);
};

const fillProfile = (profile) => {
  if (!profile) {
    profileForm.reset();
    profileStatus.textContent = "Not saved";
    profileStatus.className = "pill";
    return;
  }
  profileForm.elements.targetRole.value = profile.targetRole ?? "";
  profileForm.elements.skills.value = (profile.skills ?? []).join(", ");
  profileForm.elements.location.value = profile.location ?? "";
  profileForm.elements.remoteOnly.checked = Boolean(profile.remoteOnly);
  profileForm.elements.summary.value = profile.summary ?? "";
  profileForm.elements.experienceYears.value = String(profile.experienceYears ?? 0);
  profileStatus.textContent = "Saved";
  profileStatus.className = "pill saved";
};

const loadProfile = async () => {
  const data = await api(`/profile?sessionId=${encodeURIComponent(sessionId())}`);
  fillProfile(data.profile);
};

const loadSession = async () => {
  try {
    setStatus("Loading", "busy");
    await Promise.all([loadHistory(), loadProfile()]);
    setStatus("Ready");
  } catch (error) {
    setStatus("Error", "error");
    profileMessage.textContent = error.message;
  }
};

const sendPrompt = async (text) => {
  const value = text.trim();
  if (!value || busy) return;

  busy = true;
  sendButton.disabled = true;
  promptInput.value = "";
  addMessage("user", value);
  setStatus("Thinking", "busy");

  const typing = document.createElement("div");
  typing.className = "message model typing";
  typing.textContent = "Working on it...";
  chat.append(typing);
  scrollToBottom();

  try {
    const result = await api("/agent", {
      method: "POST",
      body: JSON.stringify({ prompt: value, sessionId: sessionId() }),
    });
    typing.remove();
    addMessage("model", result.answer);
    renderTrace(result.trace ?? [], result.turns ?? 0);
    setStatus("Ready");
  } catch (error) {
    typing.remove();
    addMessage("error", error.message);
    setStatus("Error", "error");
  } finally {
    busy = false;
    sendButton.disabled = false;
    promptInput.focus();
  }
};

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendPrompt(promptInput.value);
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

for (const chip of document.querySelectorAll(".chip")) {
  chip.addEventListener("click", () => sendPrompt(chip.textContent));
}

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  profileMessage.textContent = "";

  const data = new FormData(profileForm);
  const skills = String(data.get("skills") ?? "")
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean);

  if (skills.length === 0) {
    profileMessage.textContent = "Add at least one skill.";
    return;
  }

  const profile = {
    targetRole: String(data.get("targetRole") ?? "").trim(),
    skills,
    location: String(data.get("location") ?? "").trim(),
    remoteOnly: data.get("remoteOnly") === "on",
    summary: String(data.get("summary") ?? "").trim(),
    experienceYears: Number(data.get("experienceYears") ?? 0),
  };

  try {
    const result = await api("/profile", {
      method: "POST",
      body: JSON.stringify({ sessionId: sessionId(), profile }),
    });
    fillProfile(result.profile);
    profileMessage.textContent = "Profile saved. Ask the agent for matches.";
  } catch (error) {
    profileMessage.textContent = error.message;
  }
});

sessionInput.addEventListener("change", () => {
  profileMessage.textContent = "";
  loadSession();
});

$("clear-chat").addEventListener("click", async () => {
  try {
    await api("/session/clear", {
      method: "POST",
      body: JSON.stringify({ sessionId: sessionId() }),
    });
    renderMessages([]);
    renderTrace([], 0);
    setStatus("Ready");
  } catch (error) {
    setStatus("Error", "error");
    addMessage("error", error.message);
  }
});

loadSession();
