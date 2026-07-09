import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const [, , manifestPath, outputPath] = process.argv;

if (!manifestPath || !outputPath) {
  console.error('Usage: node remotion/render.mjs <manifest_path> <output_path>');
  process.exit(1);
}

const remotionDir = path.dirname(fileURLToPath(import.meta.url));
const remotionBin = path.join(remotionDir, 'node_modules/.bin/remotion');
const entry = path.join(remotionDir, 'src/index.ts');
const resolvedManifestPath = path.resolve(process.cwd(), manifestPath);
const resolvedOutputPath = path.resolve(process.cwd(), outputPath);
const browserExecutable =
  process.env.REMOTION_BROWSER_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : null);
const args = [
  'render',
  entry,
  'WeddingVideo',
  resolvedOutputPath,
  `--props=${resolvedManifestPath}`,
  '--overwrite',
  '--codec=h264',
  '--pixel-format=yuv420p',
];

if (browserExecutable) {
  args.push(`--browser-executable=${browserExecutable}`);
}

const result = spawnSync(remotionBin, args, {
  cwd: remotionDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    CI: '1',
    NO_UPDATE_NOTIFIER: '1',
    DISABLE_OPENCOLLECTIVE: '1',
    REMOTION_DISABLE_TELEMETRY: '1',
  },
});

process.exit(result.status ?? 1);
