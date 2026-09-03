import { createServer } from "node:http";
import { createRequestHandler } from "./server/app";
import { getAuthMode } from "./server/authProvider";
import { HOST, PORT } from "./server/config";
import { send } from "./server/http";

const handle = createRequestHandler();

createServer((req, res) => {
  handle(req, res).catch((err) => {
    send(res, 500, String(err), "text/plain; charset=utf-8");
  });
}).listen(PORT, HOST, () => {
  console.log(`GitHub Issues Dashboard -> http://${HOST}:${PORT}`);
  console.log(`Auth mode: ${getAuthMode()}`);
});
