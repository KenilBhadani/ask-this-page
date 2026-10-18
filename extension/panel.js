const BACKEND_URL = "http://127.0.0.1:8000";
const HIGHLIGHT_CSS =
  "::highlight(ask-this-page) { background-color: #fde047; color: #000; }";

const chat = document.getElementById("chat");
const info = document.getElementById("info");
const input = document.getElementById("question");
const sendBtn = document.getElementById("send");

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  chat.appendChild(div);
  return div;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getPage() {
  const tab = await getActiveTab();
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      url: location.href,
      title: document.title,
      text: document.body.innerText,
    }),
  });
  return result;
}

async function highlightInPage(snippet) {
  const tab = await getActiveTab();
  await chrome.scripting.insertCSS({
    target: { tabId: tab.id },
    css: HIGHLIGHT_CSS,
  });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [snippet],
    func: (text) => {
      const sel = window.getSelection();
      sel.removeAllRanges();
      if (window.CSS && CSS.highlights) CSS.highlights.delete("ask-this-page");

      for (const attempt of [text, text.slice(0, 40)]) {
        if (!attempt || !window.find(attempt, false, false, true)) continue;

        const range = sel.getRangeAt(0).cloneRange();
        if (window.CSS && CSS.highlights && window.Highlight) {
          sel.removeAllRanges();
          CSS.highlights.set("ask-this-page", new Highlight(range));
        }
        const el = range.startContainer.parentElement;
        if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
        return true;
      }
      return false;
    },
  });
  return result;
}

function makeChip(id, snippet) {
  const btn = document.createElement("button");
  btn.className = "cite";
  btn.textContent = id;
  btn.title = "Show this passage on the page";
  btn.addEventListener("click", async () => {
    try {
      const found = await highlightInPage(snippet);
      if (!found) info.textContent = "Couldn't find that passage on the page.";
    } catch (e) {
      info.textContent = "Can't highlight on this page: " + e.message;
    }
  });
  return btn;
}

function renderWithCitations(el, text, sources) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const pattern = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
  el.textContent = "";

  let last = 0;
  for (const match of text.matchAll(pattern)) {
    el.appendChild(document.createTextNode(text.slice(last, match.index)));
    const ids = match[1].split(",").map((n) => parseInt(n, 10));
    if (ids.every((id) => byId.has(id))) {
      ids.forEach((id) => el.appendChild(makeChip(id, byId.get(id).snippet)));
    } else {
      el.appendChild(document.createTextNode(match[0]));
    }
    last = match.index + match[0].length;
  }
  el.appendChild(document.createTextNode(text.slice(last)));
}

async function ask() {
  const question = input.value.trim();
  if (!question || sendBtn.disabled) return;
  input.value = "";
  sendBtn.disabled = true;
  addMessage("user", question);
  const reply = addMessage("bot", "Thinking...");

  try {
    const page = await getPage();
    info.textContent = `${page.title} (${page.text.length} characters)`;

    const res = await fetch(`${BACKEND_URL}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, ...page }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Backend returned ${res.status}`);
    }

    let sources = [];
    try {
      sources = JSON.parse(
        decodeURIComponent(res.headers.get("X-Sources") || "[]")
      );
    } catch {
      sources = [];
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let answer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      answer += decoder.decode(value, { stream: true });
      reply.textContent = answer;
      window.scrollTo(0, document.body.scrollHeight);
    }

    renderWithCitations(reply, answer, sources);
  } catch (e) {
    reply.textContent = "Error: " + e.message;
  } finally {
    sendBtn.disabled = false;
  }
}

sendBtn.addEventListener("click", ask);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") ask();
});