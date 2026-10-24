const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { systemPreferences, clipboard } = require("electron");
const execFileAsync = promisify(execFile);
function extractCode(text, codeOnly = true) {
  if (!codeOnly || typeof text !== "string") return text || "";
  const blocks = [
    ...text.matchAll(/```[a-zA-Z0-9_+#.-]*[^\S\r\n]*\r?\n([\s\S]*?)(?:```|$)/g),
  ]
    .map((m) => m[1].replace(/\r\n/g, "\n").replace(/\n$/, ""))
    .filter((s) => s.trim());
  return blocks.length ? blocks.join("\n\n") : text.trim();
}
function canceled(signal) {
  if (signal?.aborted) throw new Error("Auto-typing canceled.");
}
function sleep(ms, signal) {
  canceled(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("Auto-typing canceled."));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
function timingOptions({ speed = "human", wpm, jitter, pauses } = {}) {
  const defaults = {
    human: { wpm: 65, jitter: 20, pauses: 25 },
    fast: { wpm: 140, jitter: 0, pauses: 0 },
    turbo: { wpm: 250, jitter: 0, pauses: 0 },
  };
  if (!Object.hasOwn(defaults, speed))
    throw new Error("Invalid auto-typing options.");
  const options = {
    wpm: wpm === undefined ? defaults[speed].wpm : wpm,
    jitter: jitter === undefined ? defaults[speed].jitter : jitter,
    pauses: pauses === undefined ? defaults[speed].pauses : pauses,
  };
  for (const [name, value] of Object.entries(options)) {
    const [minimum, maximum] = name === "wpm" ? [10, 250] : [0, 100];
    if (!Number.isFinite(value) || value < minimum || value > maximum)
      throw new Error("Invalid auto-typing options.");
  }
  return options;
}
// WPM uses five characters per word. Timing variation never changes the text.
// Both native engines consume this same plan; individual waits are capped at 5s.
function computeTypingDelays(text, options = {}, random = Math.random) {
  if (typeof text !== "string" || text.length > 20000)
    throw new Error("Provide no more than 20,000 characters to type.");
  const { wpm, jitter, pauses } = timingOptions(options);
  const characters = Array.from(text.replace(/\r\n/g, "\n"));
  const base = 12000 / wpm;
  return characters.map((character, index) => {
    if (index === characters.length - 1) return 0;
    const sample = jitter ? random() : 0.5;
    if (!Number.isFinite(sample) || sample < 0 || sample > 1)
      throw new Error("Invalid auto-typing timing sample.");
    const varied = base * (1 + (sample * 2 - 1) * (jitter / 100) * 0.75);
    const pause =
      character === "\n"
        ? base * 2
        : /[.!?;:]/.test(character)
          ? base * 1.5
          : /\s/.test(character)
            ? base * 0.5
            : 0;
    return Math.min(
      5000,
      Math.max(1, Math.round(varied + pause * (pauses / 100))),
    );
  });
}
function escapeAppleScript(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
async function run(command, args, signal, timeout = 10000) {
  canceled(signal);
  try {
    const result = await execFileAsync(command, args, {
      signal,
      timeout,
      maxBuffer: 65536,
    });
    canceled(signal);
    return result;
  } catch (error) {
    canceled(signal);
    throw error;
  }
}
async function typeMac(text, options, signal) {
  const timing = typeof options === "string" ? { speed: options } : options;
  const delays = computeTypingDelays(text, timing);
  let targetPid = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    canceled(signal);
    try {
      const { stdout } = await run(
        "osascript",
        [
          "-e",
          'tell application "System Events" to get unix id of first application process whose frontmost is true',
        ],
        signal,
      );
      targetPid = Number(stdout.trim());
      if (
        Number.isInteger(targetPid) &&
        targetPid > 0 &&
        targetPid !== process.pid
      ) {
        break;
      }
    } catch {}
    if (attempt < 4) await sleep(200, signal);
  }
  if (
    !Number.isInteger(targetPid) ||
    targetPid <= 0 ||
    targetPid === process.pid
  )
    throw new Error("Focus a destination editor before typing.");
  // Never retry or paste after this starts: an error may follow partial output.
  let index = 0;
  for (const char of text.replace(/\r\n/g, "\n")) {
    canceled(signal);
    const statement =
      char === "\n"
        ? "key code 36"
        : char === "\t"
          ? "key code 48"
          : `keystroke "${escapeAppleScript(char)}"`;
    await run(
      "osascript",
      [
        "-e",
        `tell application "System Events"\nif (unix id of first application process whose frontmost is true) is not ${targetPid} then error "Destination changed. Typing stopped."\n${statement}\nend tell`,
      ],
      signal,
    );
    if (delays[index] > 0) await sleep(delays[index], signal);
    index++;
  }
}
async function paste(text, signal) {
  canceled(signal);
  const previous = new Map(
    clipboard
      .availableFormats()
      .map((format) => [format, clipboard.readBuffer(format)]),
  );
  clipboard.writeText(text);
  try {
    if (process.platform === "darwin") {
      let targetPid = 0;
      for (let attempt = 0; attempt < 5; attempt++) {
        canceled(signal);
        try {
          const { stdout } = await run(
            "osascript",
            [
              "-e",
              'tell application "System Events" to get unix id of first application process whose frontmost is true',
            ],
            signal,
          );
          targetPid = Number(stdout.trim());
          if (
            Number.isInteger(targetPid) &&
            targetPid > 0 &&
            targetPid !== process.pid
          ) {
            break;
          }
        } catch {}
        if (attempt < 4) await sleep(200, signal);
      }
      if (
        !Number.isInteger(targetPid) ||
        targetPid <= 0 ||
        targetPid === process.pid
      )
        throw new Error("Focus a destination editor before typing.");
      await run(
        "osascript",
        [
          "-e",
          'tell application "System Events" to keystroke "v" using command down',
        ],
        signal,
      );
    } else {
      const command = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class LensDeskFocus { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }'; [uint32]$targetProcess = 0; [void][LensDeskFocus]::GetWindowThreadProcessId([LensDeskFocus]::GetForegroundWindow(), [ref]$targetProcess); if ($targetProcess -eq 0 -or $targetProcess -eq ${process.pid}) { throw 'Focus a destination editor before typing.' }; [System.Windows.Forms.SendKeys]::SendWait('^v')`;
      await run(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        signal,
      );
    }
    await sleep(300, signal);
  } finally {
    // Do not destroy content copied by the user while the paste was in flight.
    if (clipboard.readText() === text) {
      clipboard.clear();
      for (const [format, data] of previous)
        clipboard.writeBuffer(format, data);
    }
  }
}
async function typeWindows(text, options, signal) {
  canceled(signal);
  const timing = typeof options === "string" ? { speed: options } : options;
  const delays = computeTypingDelays(text, timing);
  // A file payload avoids Windows command-line limits for long answers and keeps
  // the answer out of the process arguments. Only this invocation's files are removed.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-typing-"));
  const payloadFile = path.join(directory, "payload.json");
  try {
    fs.writeFileSync(
      payloadFile,
      JSON.stringify({
        characters: Array.from(text.replace(/\r\n/g, "\n")),
        delays,
      }),
      { mode: 0o600 },
    );
    const psScript = `$PayloadPath = '${payloadFile.replaceAll("'", "''")}'
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class LensDeskWinFocus { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }'
[uint32]$targetProcess = 0
$targetWindow = [LensDeskWinFocus]::GetForegroundWindow()
[void][LensDeskWinFocus]::GetWindowThreadProcessId($targetWindow, [ref]$targetProcess)
if ($targetProcess -eq 0 -or $targetProcess -eq ${process.pid}) { throw 'Focus a destination editor before typing.' }
$payload = Get-Content -LiteralPath $PayloadPath -Raw -Encoding UTF8 | ConvertFrom-Json
for ($index = 0; $index -lt $payload.characters.Count; $index++) {
  [uint32]$currentProcess = 0
  $currentWindow = [LensDeskWinFocus]::GetForegroundWindow()
  [void][LensDeskWinFocus]::GetWindowThreadProcessId($currentWindow, [ref]$currentProcess)
  if ($currentProcess -ne $targetProcess -or $currentWindow -ne $targetWindow) { throw 'Destination changed. Typing stopped.' }
  $s = [string]$payload.characters[$index]
  if ($s -eq "\`n") {
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  } elseif ($s -eq "\`r") {
    continue
  } elseif ($s -eq "\`t") {
    [System.Windows.Forms.SendKeys]::SendWait('{TAB}')
  } elseif ('+^%~(){}[]'.Contains($s)) {
    [System.Windows.Forms.SendKeys]::SendWait('{' + $s + '}')
  } else {
    [System.Windows.Forms.SendKeys]::SendWait($s)
  }
  [System.Threading.Thread]::Sleep([int]$payload.delays[$index])
}
`;
    await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", psScript],
      signal,
      Math.min(
        2147483647,
        delays.reduce((total, delay) => total + delay, 30000),
      ),
    );
  } finally {
    // Never paste after an error: SendKeys may already have entered part of the answer.
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
async function autoType({
  text,
  codeOnly = true,
  speed = "human",
  delaySeconds = 1,
  method,
  wpm,
  jitter,
  pauses,
  signal,
} = {}) {
  if (typeof text !== "string" || !text.trim() || text.length > 20000)
    throw new Error("Provide between 1 and 20,000 characters to type.");
  if (
    typeof codeOnly !== "boolean" ||
    ![undefined, "keystroke", "clipboard"].includes(method) ||
    !Number.isFinite(delaySeconds) ||
    delaySeconds < 0 ||
    delaySeconds > 10
  )
    throw new Error("Invalid auto-typing options.");
  const timing = timingOptions({ speed, wpm, jitter, pauses });
  if (!["darwin", "win32"].includes(process.platform))
    throw new Error("Direct typing is available on macOS and Windows.");
  canceled(signal);
  if (
    process.platform === "darwin" &&
    !systemPreferences.isTrustedAccessibilityClient(false)
  ) {
    systemPreferences.isTrustedAccessibilityClient(true);
    throw new Error(
      "Enable LensDesk in System Settings > Privacy & Security > Accessibility, then retry. Nothing was typed.",
    );
  }
  const target = extractCode(text, codeOnly);
  if (!target.trim()) throw new Error("No text is available to type.");
  await sleep(delaySeconds * 1000, signal);
  if (process.platform === "darwin") {
    if (method === "clipboard") {
      await paste(target, signal);
    } else {
      await typeMac(target, timing, signal);
    }
  } else if (method === "keystroke") {
    await typeWindows(target, timing, signal);
  } else {
    await paste(target, signal);
  }
  return {
    ok: true,
    method:
      (process.platform === "darwin" && method !== "clipboard") ||
      method === "keystroke"
        ? "keystroke"
        : "clipboard",
  };
}
module.exports = {
  autoType,
  extractCode,
  computeTypingDelays,
  typeMac,
  typeWindows,
  paste,
};
