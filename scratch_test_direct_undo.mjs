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

const testDirectUndo = await evalJs(`
  (() => {
    const leaf = app.workspace.getLeavesOfType('latex-references-editor')[0];
    const editor = leaf.view.editor;

    // Check what history facet is in editor.state
    // In CM6, history is a state extension
    const hasHistory = !!editor.state.values;

    // Let's test dispatching an undo transaction or finding what history extension exists
    // Let's check plugins/commands
    return {
      stateFields: Object.keys(editor.state),
      docLength: editor.state.doc.length
    };
  })()
`);

console.log('Direct undo debug:', testDirectUndo.result.value);

ws.close();
