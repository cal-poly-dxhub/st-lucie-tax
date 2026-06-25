import { app } from "./app.js";
import { SERVICE } from "./config.js";

// Plain HTTP entrypoint. In production this same server runs unchanged inside
// Lambda via the Lambda Web Adapter (LWA), which bridges API Gateway events to
// the listening port — no handler rewrite. Locally it's `tsx server/index.ts`.
const port = Number(process.env.PORT ?? 3000);

const server = app.listen(port, () => {
  console.log(`API running at http://localhost:${port} (SERVICE=${SERVICE})`);
});

server.on("error", (err) => {
  console.error("Server failed to start:", err.message);
  process.exit(1);
});
