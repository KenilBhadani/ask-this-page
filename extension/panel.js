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

async function highlightInPage(candidates) {
  const tab = await getActiveTab();
  await chrome.scripting.insertCSS({
    target: { tabId: tab.id },
    css: HIGHLIGHT_CSS,
  });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [candidates],
    func: (options) => {
      const sel = window.getSelection();
      sel.removeAllRanges();
      if (window.CSS && CSS.highlights) CSS.highlights.delete("ask-this-page");

      for (const text of options) {
        if (!text || !window.find(text, false, false, true)) continue;

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

// ---- Picking the sentence a citation points to ----

function words(text) {
  return text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [];
}

function bestSentence(passage, claim) {
  const claimWords = new Set(words(claim));
  const sentences = passage
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

  let best = null;
  let bestScore = 0;
  for (const sentence of sentences) {
    const sentenceWords = words(sentence);
    if (!sentenceWords.length) continue;
    const overlap = sentenceWords.filter((w) => claimWords.has(w)).length;
    const score = overlap / Math.sqrt(sentenceWords.length);
    if (score > bestScore) {
      best = sentence;
      bestScore = score;
    }
  }
  return best;
}

function searchCandidates(sentence, passage) {
  const fallback =
    passage.split("\n").find((line) => line.trim().length >= 40) || passage;
  const target = (sentence || fallback).replace(/\s+/g, " ").trim();
  return [...new Set([target, target.slice(0, 80).trim(), target.slice(0, 40).trim()])];
}

// ---- Citation chips ----

function makeChip(source, claim) {
  const btn = document.createElement("button");
  btn.className = "cite";
  btn.textContent = source.id;
  btn.title = "Show where this came from";
  btn.addEventListener("click", async () => {
    try {
      const sentence = bestSentence(source.text, claim);
      const found = await highlightInPage(searchCandidates(sentence, source.text));
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
  let claim = "";
  for (const match of text.matchAll(pattern)) {
    const segment = text.slice(last, match.index);
    el.appendChild(document.createTextNode(segment));
    if (segment.replace(/[^\p{L}\p{N}]+/gu, "")) claim = segment;

    const ids = match[1].split(",").map((n) => parseInt(n, 10));
    if (ids.every((id) => byId.has(id))) {
      ids.forEach((id) => el.appendChild(makeChip(byId.get(id), claim)));
    } else {
      el.appendChild(document.createTextNode(match[0]));
    }
    last = match.index + match[0].length;
  }
  el.appendChild(document.createTextNode(text.slice(last)));
}

// ---- Asking a question ----

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

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sources = null;
    let answer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const piece = decoder.decode(value, { stream: true });

      if (sources === null) {
        buffer += piece;
        const newline = buffer.indexOf("\n");
        if (newline === -1) continue;
        try {
          sources = JSON.parse(buffer.slice(0, newline));
        } catch {
          sources = [];
        }
        answer = buffer.slice(newline + 1);
      } else {
        answer += piece;
      }
      reply.textContent = answer;
      window.scrollTo(0, document.body.scrollHeight);
    }

    renderWithCitations(reply, answer, sources || []);
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