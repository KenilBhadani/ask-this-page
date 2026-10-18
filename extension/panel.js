const info = document.getElementById("info");
const out = document.getElementById("out");

document.getElementById("read").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        url: location.href,
        title: document.title,
        text: document.body.innerText,
      }),
    });
    info.textContent = `${result.title} (${result.text.length} characters)`;
    out.textContent = result.text.slice(0, 2000);
  } catch (e) {
    info.textContent = "Can't read this page: " + e.message;
  }
});