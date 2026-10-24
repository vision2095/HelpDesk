import { parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
try {
  const pdf = require("pdf-parse/lib/pdf-parse.js");
  const result = await pdf(Buffer.from(workerData));
  parentPort.postMessage({
    text: result.text.slice(0, 100000),
    pages: result.numpages,
  });
} catch {
  parentPort.postMessage({
    error:
      "The PDF could not be read. Check that it is a valid, unencrypted PDF.",
  });
}
