Ask this page

A Chrome extension that lets you ask questions about the web page you are reading. Open any page, open the side panel, and chat with its content.

Status: work in progress. The commit history shows how the project is being built, step by step.

Demo

Demo video coming soon.

<!-- Add a GIF later: ![Demo](docs/demo.gif) -->
How it works
You open a web page and click the extension icon. A side panel opens.
The extension reads the text of the page directly from your browser, so it also works on pages that need a login or are built with JavaScript.
You ask a question. The panel sends the question and the page text to a small local backend.
The backend finds the most relevant parts of the page and asks an LLM to answer using only that text.
The answer is streamed back into the panel, with a reference to the passage it came from.
Tech stack
Extension: Chrome Manifest V3, side panel, JavaScript
Backend: Python, FastAPI
Retrieval: text chunking and vector search with FAISS
LLM: a free-tier API (provider to be decided)