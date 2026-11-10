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

    // Check view.scope
    const viewKeys = view.scope?.keys || [];
    const appKeys = app.scope?.keys || [];

    // Filter for z, y, c, v, x, a, s, enter, f
    const inspectKeys = (keys) => keys.map(k => ({
      modifiers: k.modifiers,
      key: k.key,
      hasFunc: !!k.func
    })).filter(k => ['z', 'y', 'c', 'v', 'x', 'a', 's', 'enter', 'f'].includes(k.key.toLowerCase()));

    return {
      hasViewScope: !!view.scope,
      viewScopeKeys: inspectKeys(viewKeys),
      appScopeKeys: inspectKeys(appKeys)
    };
  })()
`);

console.log('Scope debug:', JSON.stringify(res.result.value, null, 2));

ws.close();
