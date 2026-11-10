const targets = await (await fetch('http://127.0.0.1:9480/json/list')).json();
const target = targets.find(p => p.type === 'page' && p.url.includes('obsidian.md'));
const ws = new WebSocket(target.webSocketDebuggerUrl);

ws.onopen = () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: `
        (() => {
          const leaf = app.workspace.getLeavesOfType('latex-references-editor')[0];
          return {
            hasLeaf: !!leaf,
            view: leaf ? leaf.view?.getViewType() : null,
            hasEditor: leaf ? !!leaf.view?.editor : false,
            html: leaf ? leaf.view?.contentEl?.innerHTML : null
          };
        })()
      `,
      returnByValue: true
    }
  }));
};

ws.onmessage = (msg) => {
  console.log('Result:', msg.data);
  ws.close();
  process.exit(0);
};
