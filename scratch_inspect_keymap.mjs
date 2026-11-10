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
    const editor = leaf.view.editor;

    // Check all facets
    let keymapObj = null;
    const facets = [];
    let idx = 0;
    while (true) {
      try {
        const val = editor.state.facet({ id: idx });
        if (Array.isArray(val) && val.length > 0) {
          facets.push({ id: idx, length: val.length, sample: typeof val[0] });
          for (let item of val) {
            if (item && item.editor && (item.editor['Cmd-z'] || item.editor['Mod-z'] || item.editor['Ctrl-z'])) {
              keymapObj = Object.keys(item.editor);
            }
          }
        }
        idx++;
      } catch (e) {
        break;
      }
    }

    return {
      facetsFound: facets.length,
      keymapKeys: keymapObj ? keymapObj.slice(0, 30) : null
    };
  })()
`);

console.log('Result:', res.result.value);

ws.close();
