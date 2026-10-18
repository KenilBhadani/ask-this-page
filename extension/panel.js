const BACKEND_URL = "http://127.0.0.1:8000";

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

async function getPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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

async function ask() {
  const question = input.value.trim();
  if (!question) return;
  input.value = "";
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

    const data = await res.json();
    reply.textContent = data.answer;
  } catch (e) {
    reply.textContent = "Error: " + e.message;
  }
}

sendBtn.addEventListener("click", ask);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") ask();
});