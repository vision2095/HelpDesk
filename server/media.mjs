import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
class Pool {
  constructor(limit = 2, maxQueue = 8) {
    this.limit = limit;
    this.maxQueue = maxQueue;
    this.active = 0;
    this.waiters = [];
  }
  async run(fn) {
    if (this.active >= this.limit) {
      if (this.waiters.length >= this.maxQueue) {
        const e = new Error("Media processing is busy. Try again shortly.");
        e.code = "BUSY";
        throw e;
      }
      await new Promise((r) => this.waiters.push(r));
    } else this.active++;
    try {
      return await fn();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }
}
const pool = new Pool();
export function runMediaTool(
  executable,
  args,
  { input, timeout = 15000, maxOutput = 8 * 1024 * 1024, signal } = {},
) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let bytes = 0,
      errorText = "",
      settled = false;
    const chunks = [];
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(value);
    };
    const abort = () => {
      child.kill("SIGKILL");
      finish(new Error("Media processing canceled."));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Media processing timed out. Try a smaller file."));
    }, timeout);
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxOutput) {
        child.kill("SIGKILL");
        finish(new Error("Media analysis exceeded its safe output limit."));
      } else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (errorText.length < 1000) errorText += chunk.toString();
    });
    child.on("error", (error) =>
      finish(
        new Error(
          error.code === "ENOENT"
            ? "The media processor is unavailable. The service operator must configure the required media tools."
            : "The media processor could not start.",
        ),
      ),
    );
    child.on("close", (code) => {
      if (code !== 0)
        finish(
          new Error(
            "The file could not be processed. Check that it is a valid supported media file.",
          ),
        );
      else finish(null, Buffer.concat(chunks));
    });
    child.stdin.on("error", () => {});
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    child.stdin.end(input);
  });
}
export async function measureAudio(
  base64,
  { signal, executable = process.env.FFPROBE_PATH || "ffprobe" } = {},
) {
  if (
    typeof base64 !== "string" ||
    base64.length > 28000000 ||
    !base64.match(/^[A-Za-z0-9+/=]+$/)
  )
    throw new Error("Invalid audio file.");
  return pool.run(async () => {
    const raw = await runMediaTool(
      executable,
      [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=sample_rate,channels:format=duration:packet=pts_time,duration_time",
        "-of",
        "json",
        "pipe:0",
      ],
      { input: Buffer.from(base64, "base64"), signal },
    );
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("The audio duration could not be determined.");
    }
    if (!parsed.streams?.length)
      throw new Error("No audio track was found in the recording.");
    let duration = Number(parsed.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      let first = Infinity,
        last = 0;
      for (const packet of parsed.packets || []) {
        const pts = Number(packet.pts_time),
          length = Number(packet.duration_time) || 0;
        if (Number.isFinite(pts)) {
          first = Math.min(first, pts);
          last = Math.max(last, pts + length);
        }
      }
      duration = last - (Number.isFinite(first) ? first : 0);
    }
    if (!Number.isFinite(duration) || duration <= 0 || duration > 7200)
      throw new Error(
        "Choose an audio recording between 0 and 120 minutes long.",
      );
    return {
      durationSeconds: Math.ceil(duration * 1000) / 1000,
      sampleRate: Number(parsed.streams[0].sample_rate),
      channels: parsed.streams[0].channels,
    };
  });
}
export async function recognizeImage(
  base64,
  { language = "eng", signal } = {},
) {
  if (!/^[a-z_+]+$/i.test(language) || language.length > 60)
    throw new Error("Invalid OCR language.");
  const data = String(base64).replace(/^data:image\/[^;]+;base64,/, "");
  if (data.length > 14000000 || !/^[A-Za-z0-9+/=]+$/.test(data))
    throw new Error("Invalid image.");
  return pool.run(async () => {
    const text = await runMediaTool(
      process.env.TESSERACT_PATH || "tesseract",
      ["stdin", "stdout", "-l", language],
      {
        input: Buffer.from(data, "base64"),
        timeout: 30000,
        maxOutput: 400000,
        signal,
      },
    );
    return { text: text.toString("utf8").trim() };
  });
}
export async function recognizePdf(
  buffer,
  { language = "eng", signal, maxPages = 5 } = {},
) {
  return pool.run(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lensdesk-ocr-"));
    try {
      const source = path.join(dir, "input.pdf");
      await fs.writeFile(source, buffer, { mode: 0o600 });
      await runMediaTool(
        process.env.PDFTOPPM_PATH || "pdftoppm",
        [
          "-f",
          "1",
          "-l",
          String(maxPages),
          "-scale-to",
          "1600",
          "-png",
          source,
          path.join(dir, "page"),
        ],
        { timeout: 45000, maxOutput: 1024, signal },
      );
      const pages = (await fs.readdir(dir))
        .filter((file) => /^page-.*\.png$/.test(file))
        .sort();
      if (!pages.length) throw new Error("No PDF pages could be rendered.");
      let text = "";
      for (const file of pages) {
        const output = await runMediaTool(
          process.env.TESSERACT_PATH || "tesseract",
          [path.join(dir, file), "stdout", "-l", language],
          { timeout: 30000, maxOutput: 200000, signal },
        );
        text += "\n\n" + output.toString("utf8");
      }
      return {
        text: text.trim(),
        ocr: true,
        pagesProcessed: pages.length,
        pageLimit: maxPages,
      };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
}
