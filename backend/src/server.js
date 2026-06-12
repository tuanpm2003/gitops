const http = require("http");

const PORT = Number(process.env.PORT || 3000);
const APP_NAME = process.env.APP_NAME || "Patronik Demo API";

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.url === "/api/health") {
    sendJson(res, 200, {
      status: "ok",
      service: APP_NAME,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (req.url === "/api/message") {
    sendJson(res, 200, {
      title: "Hello from backend",
      message: "Ung dung backend + frontend da san sang cho CI/CD va GitOps.",
      version: "1.0.0",
    });
    return;
  }

  sendJson(res, 404, {
    error: "Not found",
    paths: ["/api/health", "/api/message"],
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`${APP_NAME} is running on port ${PORT}`);
});

module.exports = server;
