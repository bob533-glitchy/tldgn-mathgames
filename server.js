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

// Must match ADMIN_PASSWORD in index.html so only the real admin can
// broadcast announcements to everyone connected.
const ADMIN_PASSWORD = "TLDDEVPASS86";

// Memes given to everyone. Kept in memory and sent to each visitor when they
// connect, so people who show up later still get them. (Resets if the server
// restarts/redeploys.)
const globalMemes = [];

// The event currently running for everyone (Disco / Raining Tacos / Raining
// Memes), or null. Events last 2 minutes unless the admin stops them first.
const EVENT_DURATION_MS = 2 * 60 * 1000;
let currentEvent = null;

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

function broadcast(obj) {
    const payload = JSON.stringify(obj);
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    }
}

function eventForClient() {
    if (!currentEvent) return null;
    return {
        id: currentEvent.id,
        type: currentEvent.type,
        memes: currentEvent.memes,
        remainingMs: Math.max(0, currentEvent.endsAt - Date.now())
    };
}

function endEvent() {
    if (!currentEvent) return;
    clearTimeout(currentEvent.timer);
    currentEvent = null;
    broadcast({ type: 'event_stop' });
}

function startEvent(type, memes) {
    if (currentEvent) clearTimeout(currentEvent.timer);
    const id = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    currentEvent = {
        id,
        type,
        memes: (memes || []).map((m, i) => ({ id: 'r_' + id + '_' + i, title: m.title, image: m.image })),
        endsAt: Date.now() + EVENT_DURATION_MS,
        timer: setTimeout(endEvent, EVENT_DURATION_MS)
    };
    broadcast({ type: 'event', event: eventForClient() });
}

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
    // Catch the new visitor up on every meme given so far.
    ws.send(JSON.stringify({ type: 'memes', memes: globalMemes }));

    // ...and start any event that's already in progress.
    if (currentEvent) {
        ws.send(JSON.stringify({ type: 'event', event: eventForClient() }));
    }

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

    ws.on('message', (raw) => {
        let data;
        try {
            data = JSON.parse(raw);
        } catch (err) {
            return;
        }
        if (data.type === 'startevent' && data.password === ADMIN_PASSWORD) {
            const kind = data.eventType;
            if (kind === 'disco' || kind === 'tacos') {
                startEvent(kind);
            } else if (kind === 'memes' && Array.isArray(data.memes)) {
                const list = [];
                for (const m of data.memes.slice(0, 4)) {
                    const title = String((m && m.title) || '').trim().slice(0, 60);
                    const image = String((m && m.image) || '').trim().slice(0, 2000);
                    if (title && /^https?:\/\//i.test(image)) list.push({ title, image });
                }
                if (list.length) startEvent('memes', list);
            }
            return;
        }
        if (data.type === 'stopevent' && data.password === ADMIN_PASSWORD) {
            endEvent();
            return;
        }
        if (data.type === 'globalmeme' && data.password === ADMIN_PASSWORD) {
            const title = String(data.title || '').trim().slice(0, 60);
            const image = String(data.image || '').trim().slice(0, 2000);
            if (!title || !/^https?:\/\//i.test(image)) return;
            const meme = {
                id: 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
                title,
                image
            };
            globalMemes.push(meme);
            if (globalMemes.length > 500) globalMemes.shift();
            const memePayload = JSON.stringify({ type: 'meme', meme });
            for (const client of wss.clients) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(memePayload);
                }
            }
            return;
        }
        if (data.type === 'announcement' && data.password === ADMIN_PASSWORD) {
            const payload = JSON.stringify({
                type: 'announcement',
                name: String(data.name || '').slice(0, 50),
                message: String(data.message || '').slice(0, 300)
            });
            for (const client of wss.clients) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(payload);
                }
            }
        }
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
