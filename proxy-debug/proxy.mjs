#!/usr/bin/env node
/**
 * OpenCode Go — Debug Proxy
 *
 * Zero-dependency local proxy that forwards all HTTP traffic to a target
 * API server and logs every byte sent and received.
 *
 * Usage:
 *   node proxy.mjs --target https://api.opencode.ai [--port 3456] [--log-file proxy.log]
 *   TARGET_URL=https://api.opencode.ai node proxy.mjs
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx < 0 ? undefined : args[idx + 1] ?? true;
}

const TARGET = getArg("target") || process.env.TARGET_URL;
const PORT = parseInt(getArg("port") || process.env.PORT || "3456", 10);
const LOG_FILE = getArg("log-file") || process.env.LOG_FILE;
const MAX_BODY_LOG = getArg("max-body-log") ? parseInt(getArg("max-body-log"), 10) : Infinity; // chars to log before truncating (default: no limit)

if (!TARGET) {
  console.error("Usage: node proxy.mjs --target <BASE_URL> [--port <PORT>] [--log-file <PATH>] [--max-body-log <N>]");
  console.error("  Or set TARGET_URL environment variable.");
  console.error("");
  console.error("Examples:");
  console.error("  node proxy.mjs --target https://api.opencode.ai");
  console.error("  node proxy.mjs --target https://api.opencode.ai --port 4567 --log-file debug.log");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Target URL parsing
// ---------------------------------------------------------------------------
const targetUrl = new URL(TARGET);
const isHttps = targetUrl.protocol === "https:";
const httpModule = isHttps ? https : http;
const defaultPort = isHttps ? 443 : 80;

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------
let requestId = 0;
let logStream = null;

if (LOG_FILE) {
  logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (logStream) {
    logStream.write(line + "\n");
  }
}

function logDivider(title) {
  const line = "─".repeat(70);
  if (title) {
    log(`\n${line}\n  ${title}\n${line}`);
  }
}

function safeHeaderValue(key, value) {
  const sensitive = ["authorization", "x-api-key", "api-key", "cookie", "set-cookie"];
  if (sensitive.includes(key.toLowerCase())) {
    if (value.length <= 12) return "***REDACTED***";
    return value.slice(0, 8) + "..." + value.slice(-4);
  }
  return value;
}

function formatBody(data, contentType) {
  if (!data || data.length === 0) return "(empty)";

  const str = Buffer.isBuffer(data) ? data.toString("utf-8") : String(data);

  // Try to pretty-print JSON
  const looksLikeJson =
    (contentType && (contentType.includes("json") || contentType.includes("event-stream"))) ||
    (str.startsWith("{") || str.startsWith("["));

  if (looksLikeJson) {
    // For SSE streams, format each line individually
    if (contentType && contentType.includes("event-stream")) {
      const lines = str.split("\n").filter((l) => l.trim());
      return lines
        .map((line) => {
          if (line.startsWith("data:")) {
            try {
              const json = JSON.parse(line.slice(5).trim());
              return "data: " + JSON.stringify(json);
            } catch {
              return line;
            }
          }
          return line;
        })
        .join("\n");
    }

    try {
      return JSON.stringify(JSON.parse(str), null, 2);
    } catch {
      // not JSON after all
    }
  }

  return str;
}

// ---------------------------------------------------------------------------
// Proxy server
// ---------------------------------------------------------------------------
const server = http.createServer((clientReq, clientRes) => {
  const id = ++requestId;
  const method = clientReq.method;
  const reqPath = clientReq.url;
  const startTime = Date.now();

  logDivider(`REQUEST #${id}  ${method} ${reqPath}`);

  // ── Collect client request body ──────────────────────────────────────
  const reqChunks = [];
  clientReq.on("data", (chunk) => reqChunks.push(chunk));
  clientReq.on("end", () => {
    const reqBody = Buffer.concat(reqChunks);

    // Log request headers
    log("── Request Headers ──");
    for (const [k, v] of Object.entries(clientReq.headers)) {
      if (Array.isArray(v)) {
        v.forEach((val) => log(`  ${k}: ${safeHeaderValue(k, val)}`));
      } else if (v !== undefined) {
        log(`  ${k}: ${safeHeaderValue(k, String(v))}`);
      }
    }

    // Log request body
    log(`\n── Request Body (${reqBody.length} bytes) ──`);
    const reqBodyStr = formatBody(reqBody, clientReq.headers["content-type"]);
    if (reqBodyStr.length > MAX_BODY_LOG) {
      log(reqBodyStr.slice(0, MAX_BODY_LOG));
      log(`\n... [truncated — total ${reqBodyStr.length} chars]`);
    } else {
      log(reqBodyStr);
    }

    // ── Build upstream request ─────────────────────────────────────────
    const parsedPath = new URL(reqPath, targetUrl.origin);
    const proxyOptions = {
      hostname: parsedPath.hostname,
      port: parsedPath.port || defaultPort,
      path: parsedPath.pathname + parsedPath.search,
      method,
      headers: {
        ...clientReq.headers,
        host: parsedPath.hostname,
      },
      rejectUnauthorized: false, // tolerate self-signed certs in dev
    };

    // Remove hop-by-hop headers that Node auto-sets
    delete proxyOptions.headers["transfer-encoding"];
    delete proxyOptions.headers["connection"];

    // Strip accept-encoding so the upstream sends uncompressed data.
    // Otherwise we'd log raw gzip/deflate bytes instead of readable text.
    delete proxyOptions.headers["accept-encoding"];

    log(`\n── Upstream → ${proxyOptions.hostname}:${proxyOptions.port}${proxyOptions.path} ──`);

    const proxyReq = httpModule.request(proxyOptions, (proxyRes) => {
      const respChunks = [];
      let respHeadersLogged = false;

      proxyRes.on("data", (chunk) => {
        respChunks.push(chunk);
        clientRes.write(chunk);
      });

      proxyRes.on("end", () => {
        const respBody = Buffer.concat(respChunks);
        const elapsed = Date.now() - startTime;

        // Log response headers (only once)
        if (!respHeadersLogged) {
          log(`\n── Response #${id}  ${proxyRes.statusCode} ${proxyRes.statusMessage} (${elapsed}ms) ──`);
          log("── Response Headers ──");
          for (const [k, v] of Object.entries(proxyRes.headers)) {
            log(`  ${k}: ${safeHeaderValue(k, Array.isArray(v) ? v.join(", ") : String(v))}`);
          }
        }

        // Log response body
        log(`\n── Response Body (${respBody.length} bytes) ──`);
        const respBodyStr = formatBody(respBody, proxyRes.headers["content-type"]);
        if (respBodyStr.length > MAX_BODY_LOG) {
          log(respBodyStr.slice(0, MAX_BODY_LOG));
          log(`\n... [truncated — total ${respBodyStr.length} chars]`);
        } else {
          log(respBodyStr);
        }

        log(`── END #${id} (${elapsed}ms) ──\n`);
        clientRes.end();
      });

      proxyRes.on("error", (err) => {
        log(`!!! Upstream error #${id}: ${err.message}`);
        if (!clientRes.headersSent) {
          clientRes.writeHead(502, { "content-type": "text/plain" });
        }
        clientRes.end(`Proxy error: ${err.message}`);
      });

      // Send response headers immediately (before body streaming ends)
      // so streaming responses aren't delayed
      if (!clientRes.headersSent) {
        clientRes.writeHead(proxyRes.statusCode, proxyRes.statusMessage, proxyRes.headers);
        respHeadersLogged = true;
      }
    });

    proxyReq.on("error", (err) => {
      log(`!!! Proxy request error #${id}: ${err.message}`);
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { "content-type": "text/plain" });
      }
      clientRes.end(`Upstream unreachable: ${err.message}`);
    });

    // Forward request body
    if (reqBody.length > 0) {
      proxyReq.write(reqBody);
    }
    proxyReq.end();
  });

  clientReq.on("error", (err) => {
    log(`!!! Client error #${id}: ${err.message}`);
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
server.listen(PORT, "127.0.0.1", () => {
  console.log("");
  logDivider("OpenCode Debug Proxy");
  log(`  Listening : http://127.0.0.1:${PORT}`);
  log(`  Target    : ${TARGET}`);
  log(`  Log file  : ${LOG_FILE || "(console only)"}`);
  log(`  Max body  : ${MAX_BODY_LOG.toLocaleString()} chars`);
  log("");
  log("  Configure your extension to use:");
  log(`    http://127.0.0.1:${PORT}/v1`);
  log("");
  log("  Press Ctrl+C to stop.");
  logDivider("");
});
