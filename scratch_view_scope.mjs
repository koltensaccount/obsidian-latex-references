const targets = await (await fetch('http://127.0.0.1:9480/json/list')).json();
const target = targets.find(p => p.type === 'page' && p.url.includes('obsidian.md'));
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 1;
const callbacks = new Map();

ws.onmessage = (msg) => {
  const data = JSON.parse(msg.data);
  if (callbacks.has(data.id)) {
    callbacks.get(data.id)(data.result);
    callbacks.delete(data.id);
  }
};

await new Promise(r => ws.onopen = r);

function evalJs(expr) {
  return new Promise(resolve => {
    const callId = id++;
    callbacks.set(callId, resolve);
    ws.send(JSON.stringify({
      id: callId,
      method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true }
    }));
  });
}

const res = await evalJs(`
  (() => {
    const leaf = app.workspace.getLeavesOfType('latex-references-editor')[0];
    const view = leaf.view;
    return {
      scopeExists: !!view.scope,
      scopeMethods: view.scope ? Object.getOwnPropertyNames(Object.getPrototypeOf(view.scope)) : []
    };
  })()
`);

console.log('View scope:', res.result.value);

ws.close();
process.exit(0);
