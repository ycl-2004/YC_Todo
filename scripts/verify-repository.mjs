import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function walk(relativeDirectory = ".") {
  const directory = path.join(root, relativeDirectory);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    if ([".git", ".fable", "node_modules", "target", "dist"].includes(entry.name)) {
      return [];
    }
    return entry.isDirectory() ? walk(relativePath) : [relativePath];
  });
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

for (const relativePath of walk()) {
  if (path.basename(relativePath) === ".DS_Store") {
    fail(`macOS metadata file is present: ${relativePath}`);
  }
}

const packageJson = JSON.parse(read("package.json"));
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
const cargo = read("src-tauri/Cargo.toml");
const cargoPackage = cargo.match(
  /\[package\][\s\S]*?^name\s*=\s*"([^"]+)"[\s\S]*?^version\s*=\s*"([^"]+)"/m,
);

if (packageJson.name !== "yc-todo") fail("package.json name must be yc-todo");
if (tauriConfig.productName !== "YC Todo") fail("Tauri productName must be YC Todo");
if (!cargoPackage || cargoPackage[1] !== "yc-todo") fail("Cargo package name must be yc-todo");

const versions = [packageJson.version, tauriConfig.version, cargoPackage?.[2]];
if (new Set(versions).size !== 1) {
  fail(`Version metadata is inconsistent: ${versions.join(", ")}`);
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
