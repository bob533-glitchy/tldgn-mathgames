// server.js
// Minimal WebSocket server that tracks how many clients are currently
// connected and broadcasts the live count to everyone whenever it changes.
//
// Setup:
//   npm install ws
//   node server.js
//
// Deploy this anywhere that can run a persistent Node process (Render,
// Railway, Fly.io, a VPS, etc. — NOT static hosting like GitHub Pages,
// since that can't run a server). Once deployed, update WS_URL in your
// site's index.html to point at wss://your-deployed-domain/ws (or ws://
// if you're testing locally without TLS).

const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;

// Basic HTTP server (mostly just so the process has something to bind to
// and you get a simple health check at "/").
const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', online: wss ? wss.clients.size : 0 }));
        return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Online-count WebSocket server is running.');
});

const wss = new WebSocket.Server({ server, path: '/ws' });

function broadcastOnlineCount() {
    const count = wss.clients.size;
    const payload = JSON.stringify({ type: 'online', count });
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    }
}

wss.on('connection', (ws) => {
    // Let the new client know the count immediately, and tell everyone
    // else the count just went up.
    broadcastOnlineCount();

    // Simple keep-alive so dead connections (e.g. closed laptops) get
    // cleaned up instead of inflating the count forever.
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('close', () => {
        broadcastOnlineCount();
    });

    ws.on('error', () => {
        broadcastOnlineCount();
    });
});

// Ping every client every 30s; terminate anyone that didn't respond to the
// last ping (they've likely disconnected without a clean close event).
const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
        if (ws.isAlive === false) {
            ws.terminate();
            continue;
        }
        ws.isAlive = false;
        ws.ping();
    }
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
    console.log(`Online-count server listening on port ${PORT} (ws path: /ws)`);
});
