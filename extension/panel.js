const BACKEND_URL = "http://127.0.0.1:8000";
const HIGHLIGHT_CSS =
  "::highlight(ask-this-page) { background-color: #fde047; color: #000; }";

const chat = document.getElementById("chat");
const info = document.getElementById("info");
const input = document.getElementById("question");
const sendBtn = document.getElementById("send");
const newChatBtn = document.getElementById("new-chat");

const history = [];

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
    func: () => {
      const body = document.body.innerText;
      const main = document.querySelector("main, article, [role='main']");
      const mainText = main ? main.innerText : "";
      const useMain =
        mainText.length > 500 && mainText.length >= body.length * 0.3;
      return {
        url: location.href,
        title: document.title,
        text: useMain ? mainText : body,
      };
    },
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

async function clearHighlight() {
  try {
    const tab = await getActiveTab();
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (window.CSS && CSS.highlights) CSS.highlights.delete("ask-this-page");
        window.getSelection().removeAllRanges();
      },
    });
  } catch {
    // The tab may be a page we cannot access. Nothing to clear there.
  }
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
  return [
    ...new Set([target, target.slice(0, 80).trim(), target.slice(0, 40).trim()]),
  ];
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

// ---- Rendering answers: Markdown plus citation chips ----

const INLINE =
  /\[(\d+(?:\s*,\s*\d+)*)\]|\*\*(.+?)\*\*|\*([^*\s][^*]*?)\*|`([^`]+)`/g;

function renderInline(parent, text, sources, state) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  let last = 0;

  const addText = (t) => {
    if (!t) return;
    parent.appendChild(document.createTextNode(t));
    state.pending += t;
  };
  const addStyled = (tag, t) => {
    const el = document.createElement(tag);
    el.textContent = t;
    parent.appendChild(el);
    state.pending += t;
  };

  for (const m of text.matchAll(INLINE)) {
    addText(text.slice(last, m.index));

    if (m[1] !== undefined) {
      const ids = m[1].split(",").map((n) => parseInt(n, 10));
      if (ids.every((id) => byId.has(id))) {
        if (state.pending.trim()) state.lastClaim = state.pending;
        state.pending = "";
        ids.forEach((id) =>
          parent.appendChild(makeChip(byId.get(id), state.lastClaim))
        );
      } else {
        parent.appendChild(document.createTextNode(m[0]));
      }
    } else if (m[2] !== undefined) {
      addStyled("strong", m[2]);
    } else if (m[3] !== undefined) {
      addStyled("em", m[3]);
    } else {
      addStyled("code", m[4]);
    }
    last = m.index + m[0].length;
  }
  addText(text.slice(last));
}

function renderMarkdown(el, text, sources) {
  el.textContent = "";
  el.classList.add("rendered");
  const state = { pending: "", lastClaim: "" };
  let list = null;
  let listTag = "";

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    state.pending = "";

    const item = line.match(/^\s*([*-]|\d+\.)\s+(.*)$/);
    if (item) {
      const tag = /\d/.test(item[1]) ? "ol" : "ul";
      if (!list || listTag !== tag) {
        list = document.createElement(tag);
        listTag = tag;
        el.appendChild(list);
      }
      const li = document.createElement("li");
      renderInline(li, item[2], sources, state);
      list.appendChild(li);
      continue;
    }

    if (!line.trim()) continue;
    list = null;

    const p = document.createElement("p");
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      const strong = document.createElement("strong");
      renderInline(strong, heading[1], sources, state);
      p.appendChild(strong);
    } else {
      renderInline(p, line, sources, state);
    }
    el.appendChild(p);
  }
}

function stripCitations(text) {
  return text.replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "");
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
      body: JSON.stringify({ question, history: history.slice(-6), ...page }),
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
      renderMarkdown(reply, answer, sources);
      window.scrollTo(0, document.body.scrollHeight);
    }

    history.push(
      { role: "user", content: question },
      { role: "assistant", content: stripCitations(answer) }
    );
  } catch (e) {
    reply.textContent = "Error: " + e.message;
  } finally {
    sendBtn.disabled = false;
  }
}

async function newChat() {
  if (sendBtn.disabled) return;
  chat.replaceChildren();
  history.length = 0;
  info.textContent = "";
  await clearHighlight();
}

sendBtn.addEventListener("click", ask);
newChatBtn.addEventListener("click", newChat);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") ask();
});