import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const [, , manifestPath, outputPath] = process.argv;

if (!manifestPath || !outputPath) {
  console.error('Usage: node remotion/render.mjs <manifest_path> <output_path>');
  process.exit(1);
}

const remotionDir = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(remotionDir, 'src/index.ts');
const resolvedManifestPath = path.resolve(process.cwd(), manifestPath);
const resolvedOutputPath = path.resolve(process.cwd(), outputPath);
const args = [
  'remotion',
  'render',
  entry,
  'WeddingVideo',
  resolvedOutputPath,
  `--props=${resolvedManifestPath}`,
  '--overwrite',
  '--codec=h264',
  '--pixel-format=yuv420p',
];

const result = spawnSync('npx', args, {
  cwd: remotionDir,
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
