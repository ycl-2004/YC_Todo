const fs = require("fs");

const mode = process.argv[2]; // patch | minor | major

const files = [
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
];

function bump(version) {
  let [major, minor, patch] = version.split(".").map(Number);

  if (mode === "patch") patch += 1;
  else if (mode === "minor") {
    minor += 1;
    patch = 0;
  } else if (mode === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else {
    throw new Error("Unknown bump mode");
  }

  return `${major}.${minor}.${patch}`;
}

files.forEach((file) => {
  const text = fs.readFileSync(file, "utf8");
  const match = text.match(/version[\" =:]+([0-9]+\.[0-9]+\.[0-9]+)/);

  if (!match) return;

  const oldVersion = match[1];
  const newVersion = bump(oldVersion);

  const updated = text.replace(oldVersion, newVersion);
  fs.writeFileSync(file, updated);

  console.log(`${file}: ${oldVersion} → ${newVersion}`);
});
