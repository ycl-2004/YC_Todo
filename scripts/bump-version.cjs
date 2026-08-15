const fs = require("fs");

const mode = process.argv[2]; // patch | minor | major

if (!new Set(["patch", "minor", "major"]).has(mode)) {
  throw new Error("Usage: node scripts/bump-version.cjs <patch|minor|major>");
}

function bump(version) {
  let [major, minor, patch] = version.split(".").map(Number);

  if (mode === "patch") patch += 1;
  else if (mode === "minor") {
    minor += 1;
    patch = 0;
  } else {
    major += 1;
    minor = 0;
    patch = 0;
  }

  return `${major}.${minor}.${patch}`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

// Tauri recommends tauri.conf.json as the application version source.
// Source: https://v2.tauri.app/distribute/#versioning
const tauriConfigPath = "src-tauri/tauri.conf.json";
const tauriConfig = readJson(tauriConfigPath);
const oldVersion = tauriConfig.version;
const newVersion = bump(oldVersion);

tauriConfig.version = newVersion;
writeJson(tauriConfigPath, tauriConfig);

const packageJson = readJson("package.json");
packageJson.version = newVersion;
writeJson("package.json", packageJson);

if (fs.existsSync("package-lock.json")) {
  const packageLock = readJson("package-lock.json");
  packageLock.version = newVersion;
  if (packageLock.packages?.[""]) {
    packageLock.packages[""].version = newVersion;
  }
  writeJson("package-lock.json", packageLock);
}

const cargoPath = "src-tauri/Cargo.toml";
const cargo = fs.readFileSync(cargoPath, "utf8");
const updatedCargo = cargo.replace(
  /(\[package\][\s\S]*?^version\s*=\s*")[^"]+("\s*$)/m,
  `$1${newVersion}$2`,
);

if (updatedCargo === cargo) {
  throw new Error(`Could not update [package].version in ${cargoPath}`);
}

fs.writeFileSync(cargoPath, updatedCargo);
console.log(`YC Todo: ${oldVersion} → ${newVersion}`);
