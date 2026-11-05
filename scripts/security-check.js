#!/usr/bin/env node
// Scans every tracked source/config file for obfuscated or backdoor-style code, and flags any
// file with a binary extension (image/font/etc) whose real content is actually text/script —
// exactly how a past incident hid a malicious payload inside a file named like a font.
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");

const SUSPICIOUS_PATTERNS = [
  [/_0x[a-f0-9]{4,}/i, "obfuscated variable name (e.g. _0x499797)"],
  [/\beval\s*\(/, "dynamic eval() execution"],
  [/new\s+Function\s*\(/, "dynamic Function() construction from a string"],
  [/child_process[^\n]{0,40}\b(spawn|exec)\b/, "spawning a child process"],
  [/spawnNodeScript/i, "known dropper helper name"],
  [/eth_getBlockByNumber|eth_getTransactionCount/, "blockchain RPC call (crypto-stealer signature)"],
  [/global\s*\[\s*['"`]_V['"`]\s*\]|global\.i\s*=\s*['"`]A\d/i, "known malware global-state marker"],
];

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json"]);
const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".otf", ".ttf", ".woff", ".woff2", ".eot", ".webp", ".pdf", ".zip"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
// This file's own pattern list literally contains the strings it looks for — exclude itself.
const SELF_PATH = path.relative(ROOT_DIR, __filename);

function listTrackedFiles() {
  try {
    return execSync("git ls-files", { cwd: ROOT_DIR, encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.split("/").some((part) => SKIP_DIRS.has(part)));
  } catch {
    return [];
  }
}

let failed = false;
const files = listTrackedFiles();

console.log("🔒 [Security Check] Scanning codebase for unauthorized code patterns...");

for (const relativePath of files) {
  if (relativePath === SELF_PATH) continue;
  const absolutePath = path.join(ROOT_DIR, relativePath);
  const ext = path.extname(relativePath).toLowerCase();
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue;

  if (BINARY_EXTENSIONS.has(ext)) {
    const head = fs.readFileSync(absolutePath, { encoding: "latin1", flag: "r" }).slice(0, 512);
    const printableRatio = [...head].filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127).length / (head.length || 1);
    if (printableRatio > 0.95) {
      console.error(`❌ SECURITY ALERT: ${relativePath} has a "${ext}" extension but looks like text/script, not a binary asset.`);
      failed = true;
    }
    continue;
  }

  if (!SOURCE_EXTENSIONS.has(ext)) continue;
  const content = fs.readFileSync(absolutePath, "utf8");
  for (const [pattern, label] of SUSPICIOUS_PATTERNS) {
    if (pattern.test(content)) {
      console.error(`❌ SECURITY ALERT: ${relativePath} matches a suspicious pattern — ${label}.`);
      failed = true;
    }
  }
}

if (failed) {
  console.error("\n🚨 Security check failed! Malicious or obfuscated code detected. Build / Commit aborted.");
  process.exit(1);
} else {
  console.log(`✅ [Security Check] Scanned ${files.length} tracked files — all clean.`);
  process.exit(0);
}
