#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function readCargoPackage(toml) {
  let inPackage = false;
  let name;
  let version;

  for (const line of toml.split(/\r?\n/)) {
    const section = line.match(/^\[([^\]]+)\]\s*$/);
    if (section) {
      inPackage = section[1].trim() === "package";
      continue;
    }
    if (!inPackage) continue;

    const nameMatch = line.match(/^name\s*=\s*"([^"]+)"/);
    if (nameMatch) name = nameMatch[1];
    const versionMatch = line.match(/^version\s*=\s*"([^"]+)"/);
    if (versionMatch) version = versionMatch[1];
  }

  if (!name || !version) {
    throw new Error("Could not find [package] name and version in src-tauri/Cargo.toml");
  }
  return { name, version };
}

function readCargoLockVersion(lock, packageName) {
  const blocks = lock.split(/\r?\n\[\[package\]\]\r?\n/);
  for (const block of blocks) {
    const nameMatch = block.match(/^name\s*=\s*"([^"]+)"/m);
    if (nameMatch?.[1] !== packageName) continue;
    const versionMatch = block.match(/^version\s*=\s*"([^"]+)"/m);
    if (versionMatch) return versionMatch[1];
  }
  throw new Error(`Could not find package "${packageName}" in src-tauri/Cargo.lock`);
}

let pkg;
let packageLock;
let tauriConfig;
let cargoPackage;
let cargoLockVersion;

try {
  pkg = readJson("package.json");
  packageLock = readJson("package-lock.json");
  tauriConfig = readJson("src-tauri/tauri.conf.json");
  cargoPackage = readCargoPackage(read("src-tauri/Cargo.toml"));
  cargoLockVersion = readCargoLockVersion(read("src-tauri/Cargo.lock"), cargoPackage.name);
} catch (error) {
  console.error(`Version check failed: ${error.message}`);
  process.exit(1);
}

const versions = [
  ["package.json", pkg.version],
  ["package-lock.json (root)", packageLock.version],
  ['package-lock.json (packages[""])', packageLock.packages?.[""]?.version],
  ["src-tauri/Cargo.toml", cargoPackage.version],
  [`src-tauri/Cargo.lock (${cargoPackage.name})`, cargoLockVersion],
  ["src-tauri/tauri.conf.json", tauriConfig.version],
];

const missing = versions.filter(([, value]) => typeof value !== "string" || value.length === 0);
if (missing.length > 0) {
  console.error("Version check failed: missing version values.");
  for (const [label, value] of versions) {
    console.error(`  ${label}: ${value ?? "(missing)"}`);
  }
  process.exit(1);
}

const version = versions[0][1];
const mismatched = versions.filter(([, value]) => value !== version);
if (mismatched.length > 0) {
  console.error("Version check failed: version files are out of sync.");
  for (const [label, value] of versions) {
    console.error(`  ${label}: ${value}`);
  }
  console.error(`Expected all files to use ${version}.`);
  process.exit(1);
}

const ref = process.env.GITHUB_REF ?? "";
if (ref.startsWith("refs/tags/")) {
  const expectedTag = `v${version}`;
  const actualTag = process.env.GITHUB_REF_NAME ?? "";
  if (actualTag !== expectedTag) {
    console.error(
      `Version check failed: tag ${actualTag || "(unknown)"} does not match app version ${version}. Expected ${expectedTag}.`,
    );
    process.exit(1);
  }
  console.log(`Version ${version} is consistent and tag ${actualTag} matches.`);
} else {
  console.log(`Version ${version} is consistent.`);
}
