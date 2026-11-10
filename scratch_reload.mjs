const targets = await (await fetch('http://127.0.0.1:9480/json/list')).json();
const target = targets.find(p => p.type === 'page' && p.url.includes('obsidian.md'));
const ws = new WebSocket(target.webSocketDebuggerUrl);

ws.onopen = () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: `
        (async () => {
          await app.plugins.disablePlugin('obsidian-latex-references');
          await app.plugins.enablePlugin('obsidian-latex-references');
          return 'reloaded';
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    }
  }));
};

ws.onmessage = (msg) => {
  console.log('Reload message:', msg.data);
  ws.close();
  process.exit(0);
};

ws.onerror = (err) => {
  console.error('WS Error:', err);
  process.exit(1);
};
