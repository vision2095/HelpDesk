import sys
import re
from collections import defaultdict

HINTLENS_EXE = "/Users/vivek/new repo/research/hintlens-static-20261017/TiWorker.exe"

with open(HINTLENS_EXE, "rb") as f:
    data = f.read()

# Extract ASCII strings
ascii_strings = re.findall(b"[\x20-\x7e]{4,}", data)
ascii_strings = [s.decode("ascii", errors="ignore") for s in ascii_strings]

# Extract UTF-16LE strings
utf16_strings = re.findall(b"(?:[\x20-\x7e]\x00){4,}", data)
utf16_strings = [s.decode("utf-16le", errors="ignore") for s in utf16_strings]

all_strings = sorted(list(set(ascii_strings + utf16_strings)))

print(f"Total unique strings extracted: {len(all_strings)}")

categories = {
    "Hotkeys & Shortcuts": [],
    "Settings & Configuration": [],
    "Layouts & Views (Minimal, Compact, Full, Floating, Browser, Interview)": [],
    "Capture & Screenshots": [],
    "Audio & Speech / WASAPI": [],
    "AI Models & Providers": [],
    "Auto-Type & Human Typing": [],
    "Auth, Login, Tokens & Subscriptions": [],
    "Stealth & Proctoring (Window Protection, Z-order, Hooks)": [],
    "UI Elements, Buttons, Tooltips & Labels": [],
    "API Endpoints & Network URLs": [],
    "Data & Storage (Sessions, History, Cache, Deletion)": []
}

for s in all_strings:
    low = s.lower()
    
    # Hotkeys
    if any(k in low for k in ["ctrl+", "shift+", "alt+", "hotkey", "vk_", "modifier"]):
        categories["Hotkeys & Shortcuts"].append(s)
        
    # Settings
    if any(k in low for k in ["settings", "preset", "preferences", "config", "slider", "checkbox", "dropdown"]):
        categories["Settings & Configuration"].append(s)
        
    # Layouts & Views
    if any(k in low for k in ["layout", "compact", "minimal", "portrait", "interview", "browser", "split", "ticker"]):
        categories["Layouts & Views (Minimal, Compact, Full, Floating, Browser, Interview)"].append(s)
        
    # Capture
    if any(k in low for k in ["capture", "screenshot", "region", "snip", "monitor", "display", "ocr", "bundle"]):
        categories["Capture & Screenshots"].append(s)
        
    # Audio
    if any(k in low for k in ["audio", "speech", "transcribe", "interviewer", "loopback", "wasapi", "mic"]):
        categories["Audio & Speech / WASAPI"].append(s)
        
    # AI Models
    if any(k in low for k in ["claude", "gpt", "gemini", "ollama", "qwen", "llama", "deepseek", "model", "temperature", "tokens", "provider"]):
        categories["AI Models & Providers"].append(s)
        
    # Auto-type
    if any(k in low for k in ["autotype", "type", "typing", "sendinput", "wpm", "typo", "delay"]):
        categories["Auto-Type & Human Typing"].append(s)
        
    # Auth & Tokens
    if any(k in low for k in ["login", "signin", "auth", "token", "session", "license", "device_id", "tier", "plan", "upgrade", "quota"]):
        categories["Auth, Login, Tokens & Subscriptions"].append(s)
        
    # Stealth
    if any(k in low for k in ["stealth", "invisib", "protection", "hook", "z-order", "topmost", "affinity", "exclude", "wda_", "cloak"]):
        categories["Stealth & Proctoring (Window Protection, Z-order, Hooks)"].append(s)
        
    # Endpoints
    if any(k in low for k in ["http://", "https://", "api/", "/v1/", "ws://", "wss://", ".com"]):
        categories["API Endpoints & Network URLs"].append(s)

with open("/Users/vivek/.gemini/antigravity/brain/cbe293b7-de13-4d14-82bd-6905a960de4e/scratch/hintlens_categorized_strings.txt", "w") as out:
    for cat, items in categories.items():
        out.write(f"\n{'='*70}\nCATEGORY: {cat} ({len(items)} items)\n{'='*70}\n")
        for item in sorted(set(items)):
            out.write(f"  {item}\n")

print("Wrote categorized strings to hintlens_categorized_strings.txt")
