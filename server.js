const express = require("express");
const http = require("http");
const path = require("path");
const { createBareServer } = require("@tomphttp/bare-server-node");
const { uvPath } = require("@titaniumnetwork-dev/ultraviolet");

const app = express();
const server = http.createServer();
const bare = createBareServer("/bare/");

// Serve site static assets (index.html, CSS, client scripts)
app.use(express.static(__dirname));

// Serve Ultraviolet core bundle assets
app.use("/uv/", express.static(uvPath));

// Route dynamic requests via Bare server
server.on("request", (req, res) => {
  if (bare.shouldRoute(req)) {
    bare.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

server.on("upgrade", (req, socket, head) => {
  if (bare.shouldRoute(req)) {
    bare.routeUpgrade(req, socket, head);
  } else {
    socket.end();
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});