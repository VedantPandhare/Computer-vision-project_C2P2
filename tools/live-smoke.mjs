const endpoint = process.argv.find((argument) => argument.startsWith('http')) ?? 'http://127.0.0.1:9223';
const pages = await fetch(`${endpoint}/json`).then((response) => response.json());
const page = pages.find((entry) => entry.type === 'page' && entry.url.includes('127.0.0.1:3000'));
if (!page) throw new Error('DepthGuide preview page was not found.');

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
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

await command('Runtime.enable');
await command('Page.enable');
await command('Page.reload', { ignoreCache: true });
await new Promise((resolve) => setTimeout(resolve, 1_500));
await evaluate(`([...document.querySelectorAll('button')].find((button) => button.textContent.includes('Start camera'))).click()`);

const deadline = Date.now() + 180_000;
let state;
while (Date.now() < deadline) {
  state = await evaluate(`({
    status: document.querySelector('.result-status')?.textContent.trim() ?? '',
    videoReady: (document.querySelector('.live-grid video')?.readyState ?? 0) >= 3,
    depthReady: !document.querySelector('.live-placeholder'),
    metrics: [...document.querySelectorAll('.telemetry-strip dd')].map((item) => item.textContent.trim())
  })`);
  if (state.depthReady || state.status.toLowerCase().includes('failed')) break;
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
console.log(JSON.stringify(state));
socket.close();
if (!state?.videoReady || !state?.depthReady) process.exitCode = 1;
