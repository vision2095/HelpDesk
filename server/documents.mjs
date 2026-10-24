import { Worker } from "node:worker_threads";
import { recognizePdf } from "./media.mjs";
let active = 0;
export async function readPdf(buffer, { ocr = true, signal } = {}) {
  signal?.throwIfAborted();
  if (active >= 2) {
    const error = new Error("Document processing is busy. Try again shortly.");
    error.code = "BUSY";
    throw error;
  }
  active++;
  try {
    const parsed = await new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL("./document-worker.mjs", import.meta.url),
        {
          workerData: buffer,
          resourceLimits: {
            maxOldGenerationSizeMb: 128,
            maxYoungGenerationSizeMb: 16,
          },
        },
      );
      let done = false;
      const finish = (error, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        worker.terminate();
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(
        () =>
          finish(
            new Error("PDF processing timed out. Try a smaller document."),
          ),
        15000,
      );
      const abort = () => finish(new Error("Document processing canceled."));
      signal?.addEventListener("abort", abort, { once: true });
      worker.once("message", (data) =>
        finish(data.error ? new Error(data.error) : null, data),
      );
      worker.once("error", () =>
        finish(
          new Error("PDF processing exceeded its memory limit or failed."),
        ),
      );
      worker.once("exit", (code) => {
        if (!done && code !== 0)
          finish(new Error("PDF processing stopped unexpectedly."));
      });
    });
    if (parsed.text.trim()) return { ...parsed, ocr: false };
    if (!ocr)
      throw new Error(
        "This PDF has no text layer. Enable OCR or paste the text manually.",
      );
    return await recognizePdf(buffer, { signal });
  } finally {
    active--;
  }
}
