import { app } from "./app.js";

const port = Number(process.env.PORT ?? 3000);

const server = app.listen(port, () => {
  console.log(`Check-in API running at http://localhost:${port}`);
});

server.on("error", (err) => {
  console.error("Server failed to start:", err.message);
  process.exit(1);
});
