import http from "node:http";

const MAX_CLIENTS = 32;
const MAX_SECONDS = 30;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function assertLoopbackEndpoint(value) {
  const endpoint = new URL(value);
  if (!LOOPBACK_HOSTS.has(endpoint.hostname) || !["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw Error("Only loopback HTTP endpoints are allowed");
  }
  return endpoint;
}

function assertLimits(clients, seconds) {
  if (!Number.isInteger(clients) || clients < 1 || clients > MAX_CLIENTS || !Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SECONDS) {
    throw Error(`Clients must be 1-${MAX_CLIENTS} and duration 1-${MAX_SECONDS} seconds`);
  }
}

/**
 * Opens a bounded number of read-only SSE streams and always closes their body
 * readers at the deadline. AbortController alone does not consistently close
 * already-open undici response readers in every supported Node runtime.
 */
export async function runSSEStress(endpointValue, clients, seconds) {
  const endpoint = assertLoopbackEndpoint(endpointValue);
  assertLimits(clients, seconds);

  const activeReaders = new Set();
  const activeControllers = new Set();
  let connected = 0;
  let chunks = 0;
  let failed = 0;
  let cancelledReaders = 0;
  let deadlineExpired = false;

  const cancelActiveStreams = async () => {
    deadlineExpired = true;
    for (const controller of activeControllers) controller.abort();
    const readers = [...activeReaders];
    cancelledReaders += readers.length;
    await Promise.allSettled(readers.map((reader) => reader.cancel("stress duration elapsed")));
  };

  let expire;
  const deadline = new Promise((resolve) => {
    expire = setTimeout(() => { void cancelActiveStreams().then(resolve); }, seconds * 1_000);
  });

  const workers = Array.from({ length: clients }, async () => {
    const controller = new AbortController();
    activeControllers.add(controller);
    let reader;
    try {
      const response = await fetch(endpoint, { signal: controller.signal, redirect: "error", headers: { connection: "close" } });
      if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream") || !response.body) throw Error("Expected SSE response");
      connected++;
      reader = response.body.getReader();
      activeReaders.add(reader);
      while (true) {
        const { done } = await reader.read();
        if (done) {
          if (!deadlineExpired) throw Error("SSE stream ended before duration elapsed");
          break;
        }
        chunks++;
      }
    } catch (error) {
      if (!deadlineExpired) {
        failed++;
        console.error(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (reader) activeReaders.delete(reader);
      activeControllers.delete(controller);
    }
  });

  // The hard deadline actively cancels every reader, then every worker settles.
  await deadline;
  await Promise.allSettled(workers);
  clearTimeout(expire);
  return { clients, seconds, connected, chunks, failed, cancelledReaders };
}

async function runSelfTest() {
  let serverConnections = 0;
  let serverDisconnects = 0;
  const server = http.createServer((request, response) => {
    if (request.url !== "/events") { response.writeHead(404).end(); return; }
    serverConnections++;
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.write(": ping\n\n");
    const heartbeat = setInterval(() => response.write("data: heartbeat\n\n"), 25);
    request.on("close", () => { clearInterval(heartbeat); serverDisconnects++; });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw Error("Mock SSE server did not expose a TCP port");
    const startedAt = Date.now();
    const result = await runSSEStress(`http://127.0.0.1:${address.port}/events`, 3, 1);
    const elapsedMs = Date.now() - startedAt;
    if (result.connected !== 3 || result.failed !== 0 || result.chunks === 0 || result.cancelledReaders !== 3 || elapsedMs > 2_500) {
      throw Error(`Self-test failed: ${JSON.stringify({ ...result, elapsedMs })}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (serverConnections !== 3 || serverDisconnects !== 3) throw Error(`Self-test did not close every reader: ${JSON.stringify({ serverConnections, serverDisconnects })}`);
    console.log(JSON.stringify({ selfTest: true, ...result, elapsedMs }));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (process.argv[2] === "--self-test") {
    await runSelfTest();
  } else {
    const result = await runSSEStress(process.argv[2] ?? "http://127.0.0.1:4300/events", Number(process.argv[3] ?? 8), Number(process.argv[4] ?? 5));
    console.log(JSON.stringify(result));
    process.exitCode = result.failed > 0 || result.connected !== result.clients ? 1 : 0;
  }
}
