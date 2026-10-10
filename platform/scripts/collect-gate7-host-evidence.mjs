import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statfsSync } from 'node:fs';
import { cpus, freemem, hostname, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const platformRoot = resolve(scriptDir, '..');
const repositoryRoot = resolve(platformRoot, '..');
const manifest = JSON.parse(readFileSync(resolve(platformRoot, 'ops/selfhosted-gate7-staging.json'), 'utf8'));

const APP_SERVICES = ['api', 'worker', 'notification-gateway', 'web', 'migrate'];
const ALL_SERVICES = [...APP_SERVICES, 'edge'];
const EXPECTED_REPOSITORY = 'https://github.com/karimelzoser/realestate';
const EXPECTED_SCHEMA = String(manifest.release?.runtimeSchemaVersion ?? '');
const MANIFEST_DEPLOYMENT_SHA = String(manifest.release?.deploymentBundleSha ?? '');
const EXPECTED_APPLICATION_RUNTIME_SHA = String(manifest.release?.applicationRuntimeSha ?? '');

function fullSha(value, name) {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error(`${name} must be a full 40-character lowercase Git SHA.`);
  return value;
}

fullSha(MANIFEST_DEPLOYMENT_SHA, 'manifest deploymentBundleSha');
fullSha(EXPECTED_APPLICATION_RUNTIME_SHA, 'manifest applicationRuntimeSha');
if (!/^\d+$/.test(EXPECTED_SCHEMA)) throw new Error('Manifest runtime schema version is invalid.');

const requestedDeploymentSha = fullSha(
  String(process.env.GATE7_EXPECTED_DEPLOYMENT_SHA ?? MANIFEST_DEPLOYMENT_SHA),
  'GATE7_EXPECTED_DEPLOYMENT_SHA',
);
const allowCiOverride =
  process.env.GITHUB_ACTIONS === 'true' && process.env.GATE7_COLLECTOR_ALLOW_SHA_OVERRIDE === 'true';
if (requestedDeploymentSha !== MANIFEST_DEPLOYMENT_SHA && !allowCiOverride) {
  throw new Error(
    `Expected deployment SHA override ${requestedDeploymentSha} does not match manifest ${MANIFEST_DEPLOYMENT_SHA}. ` +
      'Overrides are allowed only inside GitHub Actions certification.',
  );
}

const composeFile = resolveInputPath(
  process.env.GATE7_COMPOSE_FILE ?? 'deploy/docker-compose.production.yml',
);
const composeEnvFile = resolveInputPath(
  process.env.GATE7_COMPOSE_ENV_FILE ?? 'deploy/.env.production',
);
if (!existsSync(composeFile)) throw new Error(`Compose file does not exist: ${composeFile}`);
if (!existsSync(composeEnvFile)) throw new Error(`Compose env file does not exist: ${composeEnvFile}`);

const localEdgeUrl = new URL(process.env.GATE7_LOCAL_EDGE_URL ?? 'http://127.0.0.1:8080');
if (!['http:', 'https:'].includes(localEdgeUrl.protocol)) {
  throw new Error('GATE7_LOCAL_EDGE_URL must use http or https.');
}
if (localEdgeUrl.username || localEdgeUrl.password || localEdgeUrl.search || localEdgeUrl.hash) {
  throw new Error('GATE7_LOCAL_EDGE_URL must not contain credentials, query strings or fragments.');
}

const outputPath = resolveInputPath(process.env.GATE7_HOST_EVIDENCE_PATH ?? 'gate7-host-evidence.json');
const minimumFreeDiskGb = boundedNumber('GATE7_MIN_FREE_DISK_GB', 10, 1, 10_000);
const minimumFreeMemoryMb = boundedNumber('GATE7_MIN_FREE_MEMORY_MB', 1024, 128, 1_048_576);
const minimumCpuCount = boundedNumber('GATE7_MIN_CPU_COUNT', 2, 1, 1024);
const failures = [];
const assertions = [];

function resolveInputPath(value) {
  return value.startsWith('/') ? value : resolve(platformRoot, value);
}

function boundedNumber(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function command(commandName, args, options = {}) {
  return execFileSync(commandName, args, {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function optionalCommand(commandName, args, options = {}) {
  try {
    return command(commandName, args, options);
  } catch {
    return null;
  }
}

function composeArgs(...args) {
  return ['compose', '--env-file', composeEnvFile, '-f', composeFile, ...args];
}

function compose(...args) {
  return command('docker', composeArgs(...args));
}

function inspect(containerId, template) {
  return command('docker', ['inspect', '--format', template, containerId]);
}

function imageInspect(imageId, template) {
  return command('docker', ['image', 'inspect', '--format', template, imageId]);
}

function parseJson(value, fallback) {
  if (!value || value === '<no value>' || value === 'null') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function assertCondition(name, passed, detail) {
  assertions.push({ name, passed: Boolean(passed), detail });
  if (!passed) failures.push(`${name}: ${detail}`);
}

function safeOsRelease() {
  try {
    const lines = readFileSync('/etc/os-release', 'utf8').split(/\r?\n/);
    const data = {};
    for (const line of lines) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (!match) continue;
      const [, key, raw] = match;
      data[key] = raw.replace(/^"|"$/g, '');
    }
    return {
      id: data.ID ?? null,
      versionId: data.VERSION_ID ?? null,
      prettyName: data.PRETTY_NAME ?? null,
    };
  } catch {
    return { id: null, versionId: null, prettyName: null };
  }
}

function diskSnapshot(path) {
  const stats = statfsSync(path);
  const blockSize = Number(stats.bsize || stats.frsize || 4096);
  const totalBytes = Number(stats.blocks) * blockSize;
  const availableBytes = Number(stats.bavail) * blockSize;
  return {
    path,
    totalBytes,
    availableBytes,
    usedPercent: totalBytes > 0 ? Math.round(((totalBytes - availableBytes) / totalBytes) * 10_000) / 100 : null,
  };
}

function networksFor(containerId) {
  const value = inspect(
    containerId,
    '{{range $name, $network := .NetworkSettings.Networks}}{{$name}} {{end}}',
  );
  return value.split(/\s+/).filter(Boolean).sort();
}

function containerEvidence(service) {
  const containerId = compose('ps', '--all', '-q', service);
  if (!containerId) {
    assertCondition(`service.${service}.exists`, false, 'container is missing');
    return null;
  }

  const imageId = inspect(containerId, '{{.Image}}');
  const health = inspect(
    containerId,
    '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}',
  );
  const portBindingsRaw = inspect(containerId, '{{json .HostConfig.PortBindings}}');
  const labels = {
    source: inspect(containerId, '{{index .Config.Labels "org.opencontainers.image.source"}}'),
    revision: inspect(containerId, '{{index .Config.Labels "org.opencontainers.image.revision"}}'),
    applicationRuntimeSha: inspect(
      containerId,
      '{{index .Config.Labels "com.preneura.application-runtime-sha"}}',
    ),
    runtimeSchemaVersion: inspect(
      containerId,
      '{{index .Config.Labels "com.preneura.runtime-schema-version"}}',
    ),
  };

  const evidence = {
    service,
    containerId,
    image: {
      id: imageId,
      createdAt: imageInspect(imageId, '{{.Created}}'),
      os: imageInspect(imageId, '{{.Os}}'),
      architecture: imageInspect(imageId, '{{.Architecture}}'),
      repoDigests: parseJson(imageInspect(imageId, '{{json .RepoDigests}}'), []),
    },
    state: {
      status: inspect(containerId, '{{.State.Status}}'),
      running: inspect(containerId, '{{.State.Running}}') === 'true',
      exitCode: Number(inspect(containerId, '{{.State.ExitCode}}')),
      health,
      restartCount: Number(inspect(containerId, '{{.RestartCount}}')),
      startedAt: inspect(containerId, '{{.State.StartedAt}}'),
      finishedAt: inspect(containerId, '{{.State.FinishedAt}}'),
    },
    security: {
      user: inspect(containerId, '{{.Config.User}}'),
      privileged: inspect(containerId, '{{.HostConfig.Privileged}}') === 'true',
      securityOptions: parseJson(inspect(containerId, '{{json .HostConfig.SecurityOpt}}'), []),
      capDrop: parseJson(inspect(containerId, '{{json .HostConfig.CapDrop}}'), []),
    },
    network: {
      networks: networksFor(containerId),
      portBindings: parseJson(portBindingsRaw, null),
    },
    provenance: labels,
  };

  if (APP_SERVICES.includes(service)) {
    assertCondition(
      `service.${service}.provenance.revision`,
      labels.revision === requestedDeploymentSha,
      `expected ${requestedDeploymentSha}, found ${labels.revision || 'missing'}`,
    );
    assertCondition(
      `service.${service}.provenance.applicationRuntime`,
      labels.applicationRuntimeSha === EXPECTED_APPLICATION_RUNTIME_SHA,
      `expected ${EXPECTED_APPLICATION_RUNTIME_SHA}, found ${labels.applicationRuntimeSha || 'missing'}`,
    );
    assertCondition(
      `service.${service}.provenance.schema`,
      labels.runtimeSchemaVersion === EXPECTED_SCHEMA,
      `expected ${EXPECTED_SCHEMA}, found ${labels.runtimeSchemaVersion || 'missing'}`,
    );
    assertCondition(
      `service.${service}.provenance.repository`,
      labels.source === EXPECTED_REPOSITORY,
      `expected ${EXPECTED_REPOSITORY}, found ${labels.source || 'missing'}`,
    );
    assertCondition(
      `service.${service}.security.user`,
      evidence.security.user === 'node',
      `expected node, found ${evidence.security.user || 'empty'}`,
    );
    assertCondition(
      `service.${service}.security.privileged`,
      evidence.security.privileged === false,
      'application containers must not be privileged',
    );
    assertCondition(
      `service.${service}.network.private`,
      evidence.network.portBindings === null || Object.keys(evidence.network.portBindings).length === 0,
      `private service has host port bindings: ${JSON.stringify(evidence.network.portBindings)}`,
    );
  }

  return evidence;
}

async function probeLocal(path, kind) {
  const url = new URL(path, `${localEdgeUrl.toString().replace(/\/$/, '')}/`);
  try {
    const response = await fetch(url, {
      redirect: 'error',
      headers: { accept: kind === 'json' ? 'application/json' : 'text/html' },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (kind === 'json') {
      const parsed = JSON.parse(text);
      return {
        ok: true,
        status: response.status,
        body: {
          status: parsed.status ?? null,
          service: parsed.service ?? null,
          checks: parsed.checks
            ? {
                database: parsed.checks.database ?? null,
                schema: parsed.checks.schema ?? null,
                runtimeSchemaVersion: parsed.checks.runtimeSchemaVersion ?? null,
                databaseSchemaVersion: parsed.checks.databaseSchemaVersion ?? null,
                minimumRuntimeVersion: parsed.checks.minimumRuntimeVersion ?? null,
                migrationMarker: parsed.checks.migrationMarker ?? null,
              }
            : null,
        },
      };
    }
    return { ok: /<html[\s>]/i.test(text), status: response.status, bytes: Buffer.byteLength(text) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const collectedAt = new Date().toISOString();
const disk = diskSnapshot(repositoryRoot);
const host = {
  hostname: hostname(),
  os: safeOsRelease(),
  kernel: optionalCommand('uname', ['-r']),
  architecture: optionalCommand('uname', ['-m']),
  cpuCount: cpus().length,
  memory: {
    totalBytes: totalmem(),
    freeBytes: freemem(),
  },
  disk,
  docker: {
    clientVersion: optionalCommand('docker', ['version', '--format', '{{.Client.Version}}']),
    serverVersion: optionalCommand('docker', ['version', '--format', '{{.Server.Version}}']),
    composeVersion: optionalCommand('docker', ['compose', 'version', '--short']),
  },
};

assertCondition(
  'host.cpu.minimum',
  host.cpuCount >= minimumCpuCount,
  `requires >= ${minimumCpuCount} CPUs, found ${host.cpuCount}`,
);
assertCondition(
  'host.memory.minimum',
  host.memory.freeBytes >= minimumFreeMemoryMb * 1024 * 1024,
  `requires >= ${minimumFreeMemoryMb} MiB free, found ${Math.round(host.memory.freeBytes / 1024 / 1024)} MiB`,
);
assertCondition(
  'host.disk.minimum',
  disk.availableBytes >= minimumFreeDiskGb * 1024 * 1024 * 1024,
  `requires >= ${minimumFreeDiskGb} GiB free, found ${Math.round((disk.availableBytes / 1024 / 1024 / 1024) * 100) / 100} GiB`,
);
assertCondition('host.docker.available', Boolean(host.docker.serverVersion), 'Docker server is unavailable');
assertCondition('host.compose.available', Boolean(host.docker.composeVersion), 'Docker Compose is unavailable');

const services = {};
for (const service of ALL_SERVICES) services[service] = containerEvidence(service);

const migrate = services.migrate;
assertCondition(
  'migration.completed',
  Boolean(migrate && migrate.state.status === 'exited' && migrate.state.exitCode === 0),
  migrate ? `status=${migrate.state.status} exitCode=${migrate.state.exitCode}` : 'migration container unavailable',
);

const edge = services.edge;
const edgeBindings = edge?.network?.portBindings ?? null;
assertCondition(
  'edge.public.8080',
  Boolean(edgeBindings && Object.prototype.hasOwnProperty.call(edgeBindings, '8080/tcp')),
  `edge 8080/tcp is not host-published: ${JSON.stringify(edgeBindings)}`,
);
assertCondition(
  'edge.onlyPublicService',
  APP_SERVICES.every((service) => {
    const bindings = services[service]?.network?.portBindings;
    return bindings === null || Object.keys(bindings).length === 0;
  }),
  'one or more private PRENEURA application services expose a host port',
);

const workerLogs = optionalCommand('docker', [...composeArgs('logs', '--no-color', '--tail', '300', 'worker')]);
const workerReady = Boolean(workerLogs?.includes('worker.ready'));
assertCondition('worker.ready', workerReady, 'worker.ready marker was not found in the last 300 worker log lines');

const probes = {
  liveness: await probeLocal('/livez', 'json'),
  readiness: await probeLocal('/healthz', 'json'),
  web: await probeLocal('/login', 'html'),
};
assertCondition('edge.liveness', probes.liveness.ok, probes.liveness.error ?? `HTTP ${probes.liveness.status}`);
assertCondition('edge.readiness', probes.readiness.ok, probes.readiness.error ?? `HTTP ${probes.readiness.status}`);
assertCondition('edge.web', probes.web.ok, probes.web.error ?? `HTTP ${probes.web.status}`);

const readiness = probes.readiness.body?.checks;
assertCondition(
  'edge.readiness.schema',
  readiness?.database === 'ok' && readiness?.schema === 'ok' && String(readiness?.runtimeSchemaVersion) === EXPECTED_SCHEMA,
  `readiness=${JSON.stringify(readiness ?? null)}`,
);

const checkoutSha = optionalCommand('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD']);
const payload = {
  schemaVersion: 1,
  decision: failures.length === 0 ? 'PASS' : 'FAIL',
  collectedAt,
  release: {
    manifestDeploymentSha: MANIFEST_DEPLOYMENT_SHA,
    expectedDeploymentSha: requestedDeploymentSha,
    applicationRuntimeSha: EXPECTED_APPLICATION_RUNTIME_SHA,
    runtimeSchemaVersion: Number(EXPECTED_SCHEMA),
    collectorCheckoutSha: checkoutSha,
    ciOverride: requestedDeploymentSha !== MANIFEST_DEPLOYMENT_SHA,
  },
  host,
  compose: {
    file: composeFile,
    envFileBasename: composeEnvFile.split('/').at(-1),
    localEdgeUrl: localEdgeUrl.toString().replace(/\/$/, ''),
  },
  services,
  probes,
  workerReady,
  assertions,
  failures,
};

const evidenceDigestSha256 = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const report = { ...payload, evidenceDigestSha256 };
const serialized = `${JSON.stringify(report, null, 2)}\n`;

for (const forbidden of [
  'DATABASE_URL=',
  'OIDC_CLIENT_SECRET=',
  'META_WHATSAPP_ACCESS_TOKEN=',
  'OBJECT_STORAGE_SECRET_ACCESS_KEY=',
  'NOTIFICATION_GATEWAY_TOKEN=',
  'DOCUMENT_SCANNER_TOKEN=',
  'FINANCE_PROVIDER_INGRESS_TOKEN=',
  'SETTLEMENT_PROVIDER_INGRESS_TOKEN=',
]) {
  if (serialized.includes(forbidden)) throw new Error(`Evidence report contains forbidden secret marker ${forbidden}`);
}

await writeFile(outputPath, serialized, { mode: 0o600 });
console.log(`GATE7_HOST_EVIDENCE_DECISION=${report.decision}`);
console.log(`GATE7_HOST_EVIDENCE_SHA256=${evidenceDigestSha256}`);
console.log(`GATE7_HOST_EVIDENCE_PATH=${outputPath}`);
console.log(`GATE7_EXPECTED_DEPLOYMENT_SHA=${requestedDeploymentSha}`);

if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
