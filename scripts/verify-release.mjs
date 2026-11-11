import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = resolve(process.argv[2] ?? join(root, 'release-artifacts'));
const cli = JSON.parse(
  await readFile(join(root, 'packages/cli/package.json'), 'utf8'),
);
for (const line of (await readFile(join(artifacts, 'SHA256SUMS'), 'utf8'))
  .trim()
  .split('\n')) {
  const [expected, name] = line.split('  ');
  assert.match(name, /^vivid-(cli|sdk)-\d+\.\d+\.\d+\.tgz$/);
  assert.equal(
    createHash('sha256')
      .update(await readFile(join(artifacts, name)))
      .digest('hex'),
    expected,
  );
}
const staging = await mkdtemp(join(tmpdir(), 'vivid-install-'));
try {
  // No key and an empty config dir: nothing here may reach the live API.
  const env = {
    ...process.env,
    CI: '1',
    VIVID_API_KEY: '',
    XDG_CONFIG_HOME: staging,
    NO_COLOR: '1',
  };
  for (const kind of ['sdk', 'cli']) {
    const prefix = join(staging, kind);
    await exec(
      'npm',
      [
        'install',
        '--prefix',
        prefix,
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        join(artifacts, `vivid-${kind}-${cli.version}.tgz`),
      ],
      { cwd: staging, env },
    );
    const installed = JSON.parse(
      await readFile(
        join(prefix, 'node_modules/@genz-its', `vivid-${kind}`, 'package.json'),
        'utf8',
      ),
    );
    assert.equal(installed.version, cli.version);
    assert.equal(
      await readFile(
        join(prefix, 'node_modules/@genz-its', `vivid-${kind}`, 'LICENSE'),
        'utf8',
      ),
      await readFile(join(root, 'LICENSE'), 'utf8'),
    );
  }
  const cliRoot = join(staging, 'cli/node_modules/@genz-its/vivid-cli');
  const bundledSdk = JSON.parse(
    await readFile(
      join(cliRoot, 'node_modules/@genz-its/vivid-sdk/package.json'),
      'utf8',
    ),
  );
  assert.equal(bundledSdk.version, cli.version);
  assert.equal(
    await readFile(
      join(cliRoot, 'node_modules/@genz-its/vivid-sdk/LICENSE'),
      'utf8',
    ),
    await readFile(join(root, 'LICENSE'), 'utf8'),
  );
  const bin = join(cliRoot, 'dist/index.js');
  const run = async (...args) =>
    (await exec(process.execPath, [bin, ...args], { cwd: staging, env }))
      .stdout;
  assert.match(
    await run('--version'),
    new RegExp(cli.version.replaceAll('.', '\\.')),
  );
  for (const command of [
    'login',
    'logout',
    'doctor',
    'accounts:list',
    'accounts:get',
    'transactions:list',
    'transactions:get',
    'cards:list',
    'cards:get',
  ])
    assert.match(await run(command, '--help'), new RegExp(command));
  // Without a key, doctor reports the missing key and exits 1 offline.
  const doctor = await exec(process.execPath, [bin, 'doctor', '--json'], {
    cwd: staging,
    env,
  }).then(
    () => assert.fail('doctor must exit 1 without an API key'),
    (error) => error,
  );
  assert.equal(doctor.code, 1);
  assert.equal(JSON.parse(doctor.stdout).keySource, 'none');
  console.log(
    `Verified checksums, isolated SDK/CLI installation, bundled SDK ${cli.version}, and offline command smoke tests.`,
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}
