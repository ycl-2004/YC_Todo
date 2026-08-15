import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const forbiddenRoots = [
  "_HowToWork",
  "Upload_App_Store",
  "my_react_test",
  "my_todolist_explain",
];

for (const relativePath of forbiddenRoots) {
  if (fs.existsSync(path.join(root, relativePath))) {
    fail(`Legacy path is still present: ${relativePath}`);
  }
}

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
}).split("\0");

for (const relativePath of trackedFiles) {
  if (path.basename(relativePath) === ".DS_Store") {
    fail(`macOS metadata file is tracked: ${relativePath}`);
  }
}

const packageJson = JSON.parse(read("package.json"));
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
const cargo = read("src-tauri/Cargo.toml");
const cargoLock = read("src-tauri/Cargo.lock");
const cargoPackage = cargo.match(
  /\[package\][\s\S]*?^name\s*=\s*"([^"]+)"[\s\S]*?^version\s*=\s*"([^"]+)"/m,
);
const cargoLockPackage = cargoLock.match(
  /\[\[package\]\]\nname = "yc-todo"\nversion = "([^"]+)"/,
);

if (packageJson.name !== "yc-todo") fail("package.json name must be yc-todo");
if (tauriConfig.productName !== "YC Todo") fail("Tauri productName must be YC Todo");
if (!cargoPackage || cargoPackage[1] !== "yc-todo") fail("Cargo package name must be yc-todo");

const versions = [
  packageJson.version,
  tauriConfig.version,
  cargoPackage?.[2],
  cargoLockPackage?.[1],
];
if (new Set(versions).size !== 1) {
  fail(`Version metadata is inconsistent: ${versions.join(", ")}`);
}

if (packageJson.scripts?.["release:macos"] !== "bash scripts/build-release.sh") {
  fail("package.json must expose the Universal macOS release command");
}

if (
  !Array.isArray(tauriConfig.bundle?.targets) ||
  !tauriConfig.bundle.targets.includes("app")
) {
  fail("Tauri bundle targets must include the macOS app bundle");
}

if (tauriConfig.bundle?.macOS?.minimumSystemVersion !== "12.0") {
  fail("Tauri minimum macOS version must match the documented 12.0 baseline");
}

for (const requiredPath of [
  "CHANGELOG.md",
  "docs/decisions/0003-universal-release-artifacts.md",
  "docs/release-checklist.md",
  "docs/screenshots/README.md",
  "scripts/build-release.sh",
]) {
  if (!fs.existsSync(path.join(root, requiredPath))) {
    fail(`Required release file is missing: ${requiredPath}`);
  }
}

if (packageJson.dependencies?.["tauri-plugin-nspopover"]) {
  fail("Unused JavaScript nspopover dependency is still present");
}

if (!fs.existsSync(path.join(root, "src-tauri/vendor/tauri-plugin-nspopover/LICENSE"))) {
  fail("Vendored nspopover plugin or its license is missing");
}

if (/Vite \+ React|my_react_test|A Tauri App/.test(read("README.md"))) {
  fail("README still contains template or experimental project language");
}

if (failures.length > 0) {
  console.error("Repository verification failed:");
  failures.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log(`Repository verification passed (${versions[0]}).`);
