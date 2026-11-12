#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

if (!version || !semverPattern.test(version)) {
  console.error("Usage: npm run version:bump -- X.Y.Z");
  console.error(`Received: ${version ?? "(nothing)"}`);
  process.exit(1);
}

const files = {
  packageJson: resolve(root, "package.json"),
  packageLock: resolve(root, "package-lock.json"),
  tauriConfig: resolve(root, "src-tauri/tauri.conf.json"),
  cargoToml: resolve(root, "src-tauri/Cargo.toml"),
  cargoLock: resolve(root, "src-tauri/Cargo.lock"),
};

const read = (file) => readFileSync(file, "utf8");

function eolOf(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function readCargoPackage(toml) {
  let inPackage = false;
  let name;
  let packageVersion;

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
    if (versionMatch) packageVersion = versionMatch[1];
  }

  if (!name || !packageVersion) {
    throw new Error("Could not find [package] name and version in src-tauri/Cargo.toml");
  }
  return { name, version: packageVersion };
}

function updateCargoToml(toml, nextVersion) {
  const eol = eolOf(toml);
  let inPackage = false;
  let updated = false;

  const lines = toml.split(/\r?\n/).map((line) => {
    const section = line.match(/^\[([^\]]+)\]\s*$/);
    if (section) {
      inPackage = section[1].trim() === "package";
      return line;
    }
    if (inPackage && !updated && /^version\s*=\s*"[^"]*"/.test(line)) {
      updated = true;
      return `version = "${nextVersion}"`;
    }
    return line;
  });

  if (!updated) {
    throw new Error("Could not find version in src-tauri/Cargo.toml [package]");
  }
  return lines.join(eol);
}

function updateCargoLock(lock, packageName, nextVersion) {
  const eol = eolOf(lock);
  let matchedPackage = false;
  let updated = false;

  const lines = lock.split(/\r?\n/).map((line) => {
    if (line.trim() === "[[package]]") {
      matchedPackage = false;
      return line;
    }

    const nameMatch = line.match(/^name\s*=\s*"([^"]+)"/);
    if (nameMatch) {
      matchedPackage = nameMatch[1] === packageName;
      return line;
    }

    if (matchedPackage && !updated && /^version\s*=\s*"[^"]*"/.test(line)) {
      matchedPackage = false;
      updated = true;
      return `version = "${nextVersion}"`;
    }
    return line;
  });

  if (!updated) {
    throw new Error(`Could not find package "${packageName}" in src-tauri/Cargo.lock`);
  }
  return lines.join(eol);
}

function replaceFirstJsonVersion(text, nextVersion, label) {
  const pattern = /^(\s*"version"\s*:\s*")[^"]+(")/m;
  if (!pattern.test(text)) {
    throw new Error(`Could not find a version field in ${label}`);
  }
  return text.replace(pattern, `$1${nextVersion}$2`);
}

function replacePackageLockVersions(text, nextVersion) {
  const topLevelPattern = /^(\s*"version"\s*:\s*")[^"]+(")/m;
  if (!topLevelPattern.test(text)) {
    throw new Error("Could not find the root version in package-lock.json");
  }
  let updated = text.replace(topLevelPattern, `$1${nextVersion}$2`);

  const rootPackagePattern = /("packages"\s*:\s*\{\s*""\s*:\s*\{[^{}]*?"version"\s*:\s*")[^"]+(")/;
  if (!rootPackagePattern.test(updated)) {
    throw new Error('Could not find packages[""].version in package-lock.json');
  }
  return updated.replace(rootPackagePattern, `$1${nextVersion}$2`);
}

let packageJsonText;
let packageLockText;
let tauriConfigText;
let cargoTomlText;
let cargoLockText;
let packageJson;
let packageLock;
let tauriConfig;
let cargoPackage;

try {
  packageJsonText = read(files.packageJson);
  packageLockText = read(files.packageLock);
  tauriConfigText = read(files.tauriConfig);
  cargoTomlText = read(files.cargoToml);
  cargoLockText = read(files.cargoLock);

  packageJson = JSON.parse(packageJsonText);
  packageLock = JSON.parse(packageLockText);
  tauriConfig = JSON.parse(tauriConfigText);
  cargoPackage = readCargoPackage(cargoTomlText);

  if (!packageLock.packages?.[""]) {
    throw new Error('package-lock.json is missing packages[""]');
  }
} catch (error) {
  console.error(`Version bump failed: ${error.message}`);
  process.exit(1);
}

let updatedPackageJson;
let updatedPackageLock;
let updatedTauriConfig;
let updatedCargoToml;
let updatedCargoLock;

try {
  updatedPackageJson = replaceFirstJsonVersion(packageJsonText, version, "package.json");
  updatedPackageLock = replacePackageLockVersions(packageLockText, version);
  updatedTauriConfig = replaceFirstJsonVersion(tauriConfigText, version, "src-tauri/tauri.conf.json");
  updatedCargoToml = updateCargoToml(cargoTomlText, version);
  updatedCargoLock = updateCargoLock(cargoLockText, cargoPackage.name, version);

  if (JSON.parse(updatedPackageJson).version !== version) {
    throw new Error("package.json was not updated correctly");
  }
  const parsedPackageLock = JSON.parse(updatedPackageLock);
  if (parsedPackageLock.version !== version || parsedPackageLock.packages[""].version !== version) {
    throw new Error("package-lock.json was not updated correctly");
  }
  if (JSON.parse(updatedTauriConfig).version !== version) {
    throw new Error("src-tauri/tauri.conf.json was not updated correctly");
  }
} catch (error) {
  console.error(`Version bump failed: ${error.message}`);
  process.exit(1);
}

const ensureTrailingNewline = (text) => (text.endsWith("\n") ? text : `${text}\n`);

writeFileSync(files.packageJson, ensureTrailingNewline(updatedPackageJson));
writeFileSync(files.packageLock, ensureTrailingNewline(updatedPackageLock));
writeFileSync(files.tauriConfig, ensureTrailingNewline(updatedTauriConfig));
writeFileSync(files.cargoToml, ensureTrailingNewline(updatedCargoToml));
writeFileSync(files.cargoLock, ensureTrailingNewline(updatedCargoLock));

console.log(`Bumped ${cargoPackage.name} to ${version} in:`);
for (const file of Object.values(files)) {
  console.log(`  ${relative(root, file)}`);
}
console.log("Review the diff, then run `npm run verify`.");
