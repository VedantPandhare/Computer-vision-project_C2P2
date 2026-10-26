const endpoint = process.argv.find((argument) => argument.startsWith('http')) ?? 'http://127.0.0.1:9222';
const pages = await fetch(`${endpoint}/json`).then((response) => response.json());
const page = pages.find((entry) => entry.type === 'page' && entry.url.includes('127.0.0.1:3000'));

if (!page) throw new Error('DepthGuide preview page was not found in the browser.');

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

function command(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

await command('Runtime.enable');
await command('Page.enable');
await command('Page.reload', { ignoreCache: true });
await new Promise((resolve) => setTimeout(resolve, 1_500));
const pageState = await evaluate(`({
  url: location.href,
  title: document.title,
  readyState: document.readyState,
  buttons: [...document.querySelectorAll('button')].map((button) => button.textContent.trim())
})`);
await evaluate(`([...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Photo')).click()`);
await new Promise((resolve) => setTimeout(resolve, 500));

const initial = await evaluate(`({
  dropZone: Boolean(document.querySelector('.drop-zone')),
  samples: [...document.querySelectorAll('.sample-row button')].map((button) => button.textContent.trim())
})`);
const sampleDecode = await evaluate(`Promise.race([
  (async () => {
    const image = new Image();
    image.src = '/samples/terrace.png';
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  })(),
  new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 5_000))
])`);

let modelResult = null;
if (process.argv.includes('--run-model')) {
  await evaluate(`([...document.querySelectorAll('.sample-row button')].find((button) => button.textContent.trim() === 'Terrace')).click()`);
  const timeoutArgument = process.argv.find((argument) => argument.startsWith('--timeout='));
  const timeoutMs = timeoutArgument ? Number(timeoutArgument.split('=')[1]) : 240_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    modelResult = await evaluate(`({
      ready: Boolean(document.querySelector('.result-status.ready')),
      failed: Boolean(document.querySelector('.result-status.error')),
      message: document.querySelector('.result-status')?.textContent.trim() ?? document.querySelector('.drop-zone p')?.textContent.trim() ?? '',
      canvas: Boolean(document.querySelector('.depth-result canvas')),
      metrics: [...document.querySelectorAll('.result-footer dd')].map((item) => item.textContent.trim())
    })`);
    if (modelResult.ready || modelResult.failed) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

console.log(JSON.stringify({ pageState, initial, sampleDecode, modelResult }));
socket.close();
