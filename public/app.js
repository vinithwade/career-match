const $ = (id) => document.getElementById(id);

const chat = $("chat");
const traceList = $("trace-list");
const promptInput = $("prompt");
const sendButton = $("send");
const chatForm = $("chat-form");
const profileForm = $("profile-form");
const saveProfileButton = $("save-profile");
const sessionInput = $("session-id");
const statusBox = $("status");
const statusText = $("status-text");
const profileStatus = $("profile-status");
const profileMessage = $("profile-message");
const turnCount = $("turn-count");
const discoverSection = $("discover-section");
const matchesList = $("matches-list");
const matchesSummary = $("matches-summary");
const matchesCount = $("matches-count");
const refreshMatchesButton = $("refresh-matches");
const onboarding = $("onboarding");
const onboardingForm = $("onboarding-form");
const onboardingSubmit = $("onboarding-submit");
const onboardingError = $("onboarding-error");
const editProfileButton = $("edit-profile");

sessionInput.value = `visit-${Date.now().toString(36)}`;

let busy = false;
let currentMatches = [];
let matchesSummaryText = "";

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

const appendLinkedText = (element, text) => {
  const pattern = /https?:\/\/[^\s<>]+/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) element.append(document.createTextNode(text.slice(lastIndex, index)));

    const link = document.createElement("a");
    link.href = match[0].replace(/[.,;:)\]]+$/, "");
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "message-link";
    link.textContent = "Apply / open link";
    element.append(link);
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) element.append(document.createTextNode(text.slice(lastIndex)));
};

const addMessage = (role, content, links = []) => {
  removeEmptyState();
  const message = document.createElement("div");
  message.className = `message ${role}`;
  appendLinkedText(message, content);

  if (links.length) {
    const box = document.createElement("div");
    box.className = "message-links";
    const label = document.createElement("span");
    label.className = "message-links-label";
    label.textContent = "Apply links";
    box.append(label);

    for (const job of links) {
      const link = document.createElement("a");
      link.href = job.applyUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "message-link";
      link.textContent = `${job.title}${job.company ? ` — ${job.company}` : ""} ↗`;
      box.append(link);
    }

    message.append(box);
  }

  chat.append(message);
  scrollToBottom();
};

const showEmptyState = () => {
  chat.innerHTML = `
    <div class="empty" id="empty-state">
      <h3>Your next move starts here</h3>
      <p>Save your profile to see ranked roles, then ask the agent anything about your search.</p>
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
  return data.profile;
};

const createMatchCard = (job, index = 0) => {
  const card = document.createElement("article");
  card.className = "match-card";
  card.style.setProperty("--i", String(index));

  const head = document.createElement("div");
  head.className = "match-card-head";

  const titleWrap = document.createElement("div");
  const title = document.createElement("h4");
  title.className = "match-title";
  title.textContent = job.title;
  const company = document.createElement("p");
  company.className = "match-company";
  company.textContent = job.company;
  titleWrap.append(title, company);

  const scoreValue = Math.round((job.matchScore ?? 0) * 100);
  const score = document.createElement("span");
  score.className = "match-score";
  score.textContent = `${scoreValue}%`;
  score.title = `${scoreValue}% match`;
  score.setAttribute("aria-label", `${scoreValue}% match`);
  card.style.setProperty("--score", `${Math.max(0, Math.min(scoreValue, 100))}%`);

  head.append(titleWrap, score);

  const meta = document.createElement("p");
  meta.className = "match-meta";
  meta.textContent = [job.location, job.mode, job.employmentType, job.pay].filter(Boolean).join(" · ");

  const tags = document.createElement("div");
  tags.className = "match-tags";
  for (const skill of (job.matchedSkills ?? []).slice(0, 3)) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = skill;
    tags.append(tag);
  }
  for (const skill of (job.missingSkills ?? []).slice(0, 1)) {
    const tag = document.createElement("span");
    tag.className = "tag missing";
    tag.textContent = `needs ${skill}`;
    tags.append(tag);
  }

  let apply;
  if (job.applyUrl) {
    apply = document.createElement("a");
    apply.className = "match-apply";
    apply.href = job.applyUrl;
    apply.target = "_blank";
    apply.rel = "noopener noreferrer";
    apply.textContent = "Apply / find role ↗";
  }

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "match-toggle";
  toggle.textContent = "Why this match?";

  const details = document.createElement("p");
  details.className = "match-details";
  details.hidden = true;
  details.textContent = [
    job.description,
    `Matched skills: ${(job.matchedSkills ?? []).join(", ") || "none yet"}`,
    `Missing skills: ${(job.missingSkills ?? []).join(", ") || "none"}`,
  ].join("\n\n");

  toggle.addEventListener("click", () => {
    details.hidden = !details.hidden;
    toggle.textContent = details.hidden ? "Why this match?" : "Hide details";
  });

  card.append(head, meta, tags);
  if (apply) card.append(apply);
  card.append(toggle, details);
  return card;
};

const renderMatchCards = () => {
  matchesList.innerHTML = "";
  matchesSummary.textContent = matchesSummaryText;
  matchesCount.textContent = `${currentMatches.length}`;

  if (!currentMatches.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No matches to show yet.";
    matchesList.append(empty);
    return;
  }

  currentMatches.forEach((job, index) => {
    matchesList.append(createMatchCard(job, index));
  });
};

const renderMatches = (data) => {
  discoverSection.hidden = false;
  currentMatches = data.results ?? [];

  const role = data.profile?.targetRole || "your profile";
  matchesSummaryText = data.count
    ? `${data.count} role${data.count === 1 ? "" : "s"} ranked for ${role} by meaning and skill overlap.`
    : "No roles matched your filters. Try removing the location or remote-only constraint.";

  renderMatchCards();
};

const loadMatches = async (profile) => {
  setStatus("Matching", "busy");
  try {
    const payload = { sessionId: sessionId(), limit: 10 };
    if (profile) payload.profile = profile;
    const data = await api("/matches", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    renderMatches(data);
    setStatus("Ready");
    return data;
  } catch (error) {
    setStatus("Error", "error");
    throw error;
  }
};

const loadSession = async () => {
  try {
    setStatus("Loading", "busy");
    const [, profile] = await Promise.all([loadHistory(), loadProfile()]);
    if (profile) {
      await loadMatches();
    } else {
      discoverSection.hidden = true;
      matchesList.innerHTML = "";
      onboarding.hidden = false;
    }
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
    addMessage("model", result.answer, result.applyLinks ?? []);
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

const readProfileFrom = (form, errorElement) => {
  const data = new FormData(form);
  const skills = String(data.get("skills") ?? "")
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean);

  if (skills.length === 0) {
    errorElement.textContent = "Add at least one skill.";
    return null;
  }

  return {
    targetRole: String(data.get("targetRole") ?? "").trim(),
    skills,
    location: String(data.get("location") ?? "").trim(),
    remoteOnly: data.get("remoteOnly") === "on",
    summary: String(data.get("summary") ?? "").trim(),
    experienceYears: Number(data.get("experienceYears") ?? 0),
  };
};

const readProfileForm = () => readProfileFrom(profileForm, profileMessage);

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

  const profile = readProfileForm();
  if (!profile) return;

  saveProfileButton.disabled = true;
  try {
    const data = await loadMatches(profile);
    fillProfile(data.profile);
    profileMessage.textContent = `Saved. Found ${data.count} match${data.count === 1 ? "" : "es"} below.`;
  } catch (error) {
    profileMessage.textContent = error.message;
  } finally {
    saveProfileButton.disabled = false;
  }
});

refreshMatchesButton.addEventListener("click", async () => {
  try {
    await loadMatches();
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

onboardingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  onboardingError.textContent = "";

  const profile = readProfileFrom(onboardingForm, onboardingError);
  if (!profile) return;

  onboardingSubmit.disabled = true;
  try {
    const data = await loadMatches(profile);
    fillProfile(data.profile);
    onboarding.hidden = true;
    profileMessage.textContent = "Profile ready. Your best matches are below.";
  } catch (error) {
    onboardingError.textContent = error.message;
  } finally {
    onboardingSubmit.disabled = false;
  }
});

editProfileButton.addEventListener("click", () => {
  onboardingForm.elements.targetRole.value = profileForm.elements.targetRole.value;
  onboardingForm.elements.skills.value = profileForm.elements.skills.value;
  onboardingForm.elements.location.value = profileForm.elements.location.value;
  onboardingForm.elements.remoteOnly.checked = profileForm.elements.remoteOnly.checked;
  onboardingError.textContent = "";
  onboarding.hidden = false;
});

loadSession();
