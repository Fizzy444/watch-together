import fs from 'node:fs';

const ref = process.env.GITHUB_REF_NAME || process.argv[2] || 'v1.0.0';
const version = ref.replace(/^v/, '').trim();

if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.log(`Reference "${ref}" is not a semver version. Skipping version sync.`);
  process.exit(0);
}

const tauriConfPath = 'src-tauri/tauri.conf.json';
if (fs.existsSync(tauriConfPath)) {
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
  tauriConf.version = version;
  fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
}

const cargoPath = 'src-tauri/Cargo.toml';
if (fs.existsSync(cargoPath)) {
  let cargoToml = fs.readFileSync(cargoPath, 'utf8');
  cargoToml = cargoToml.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
  fs.writeFileSync(cargoPath, cargoToml);
}

const pkgPath = 'package.json';
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

const clientPkgPath = 'client/package.json';
if (fs.existsSync(clientPkgPath)) {
  const clientPkg = JSON.parse(fs.readFileSync(clientPkgPath, 'utf8'));
  clientPkg.version = version;
  fs.writeFileSync(clientPkgPath, JSON.stringify(clientPkg, null, 2) + '\n');
}

console.log(`Synced version ${version} from tag ${ref} across configuration files.`);
