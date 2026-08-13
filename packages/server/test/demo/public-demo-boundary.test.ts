import { existsSync } from 'node:fs';
import { Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { build, type Metafile } from 'esbuild';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SSEEvent, SSEManager } from '../../src/sse/sse-manager.js';

const temporaryRoots: string[] = [];
const closeApp: Array<() => void | Promise<void>> = [];
const coreEntry = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../core/src/index.ts',
);

const resolveSourceImport = (from: string, specifier: string): string | null => {
  if (specifier === '@harness/core') {
    return coreEntry;
  }
  if (!specifier.startsWith('.')) return null;
  const candidate = resolve(dirname(from), specifier);
  const paths = [
    candidate.replace(/\.js$/, '.ts'),
    `${candidate}.ts`,
    join(candidate, 'index.ts'),
  ];
  return paths.find((path) => existsSync(path)) ?? null;
};

const importClauseHasRuntimeValue = (clause: ts.ImportClause | undefined): boolean => {
  if (!clause) return true;
  if (clause.isTypeOnly || clause.name) return !clause.isTypeOnly;
  if (!clause.namedBindings || ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings.elements.some((element) => !element.isTypeOnly);
};

interface ModuleGraph {
  readonly eagerFiles: ReadonlySet<string>;
  readonly eagerExternalImports: ReadonlySet<string>;
  readonly lazyImports: ReadonlySet<string>;
}

const collectOutputClosure = (
  metafile: Metafile,
  roots: readonly string[],
): ReadonlySet<string> => {
  const outputs = new Set<string>();
  const visit = (output: string): void => {
    if (outputs.has(output) || !metafile.outputs[output]) return;
    outputs.add(output);
    for (const dependency of metafile.outputs[output].imports) {
      if (dependency.kind !== 'dynamic-import') visit(dependency.path);
    }
  };
  roots.forEach(visit);
  return outputs;
};

const collectInputs = (metafile: Metafile, outputs: ReadonlySet<string>): string[] => (
  [...new Set([...outputs].flatMap((output) => (
    Object.keys(metafile.outputs[output]!.inputs)
  )))]
);

const within = async <T>(operation: PromiseLike<T>, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 1_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const waitForEvent = async (
  events: readonly SSEEvent[],
  type: SSEEvent['type'],
): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (events.some((event) => event.type === type)) return;
    await new Promise<void>((resolveTurn) => setTimeout(resolveTurn, 10));
  }
  throw new Error(`Timed out waiting for ${type} event`);
};

const buildModuleGraph = async (entry: string): Promise<ModuleGraph> => {
  const eagerFiles = new Set<string>();
  const eagerExternalImports = new Set<string>();
  const lazyImports = new Set<string>();

  const visit = async (file: string): Promise<void> => {
    if (eagerFiles.has(file)) return;
    eagerFiles.add(file);
    const source = await readFile(file, 'utf8');
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);

    const follow = async (specifier: string): Promise<void> => {
      const dependency = resolveSourceImport(file, specifier);
      if (dependency) {
        await visit(dependency);
      } else {
        eagerExternalImports.add(specifier);
      }
    };
    for (const statement of parsed.statements) {
      if (
        ts.isImportDeclaration(statement)
        && ts.isStringLiteral(statement.moduleSpecifier)
        && importClauseHasRuntimeValue(statement.importClause)
      ) {
        await follow(statement.moduleSpecifier.text);
      }
      if (
        ts.isExportDeclaration(statement)
        && !statement.isTypeOnly
        && statement.moduleSpecifier
        && ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        await follow(statement.moduleSpecifier.text);
      }
    }
    const requiredImports: string[] = [];
    const inspectCalls = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node)
        && node.arguments.length === 1
        && ts.isStringLiteral(node.arguments[0]!)
      ) {
        const specifier = node.arguments[0]!.text;
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          lazyImports.add(specifier);
        } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
          requiredImports.push(specifier);
        }
      }
      ts.forEachChild(node, inspectCalls);
    };
    inspectCalls(parsed);
    for (const specifier of requiredImports) await follow(specifier);
  };

  await visit(entry);
  return { eagerFiles, eagerExternalImports, lazyImports };
};

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(closeApp.splice(0).map((close) => close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => (
    rm(root, { recursive: true, force: true })
  )));
});

describe('public demo capability boundary', () => {
  it('keeps unsafe capabilities in dynamic chunks in the real in-memory server build', async () => {
    const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
    const result = await build({
      entryPoints: [join(sourceRoot, 'server.ts')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      external: ['@napi-rs/keyring'],
      target: 'node22',
      splitting: true,
      write: false,
      metafile: true,
      outdir: 'memory-build',
      tsconfig: resolve(sourceRoot, '../tsconfig.json'),
      logLevel: 'silent',
    });
    const entry = Object.entries(result.metafile.outputs).find(([, output]) => (
      output.entryPoint?.replace(/\\/g, '/').endsWith('/src/server.ts')
      || output.entryPoint?.replace(/\\/g, '/') === 'src/server.ts'
    ))?.[0];
    expect(entry).toBeDefined();
    const eagerOutputs = collectOutputClosure(result.metafile, [entry!]);
    const eagerInputs = collectInputs(result.metafile, eagerOutputs);
    const eagerImports = [...eagerOutputs].flatMap((output) => (
      result.metafile.outputs[output]!.imports
        .filter((dependency) => dependency.kind !== 'dynamic-import')
        .map((dependency) => dependency.path)
    ));
    const dynamicRoots = [...eagerOutputs].flatMap((output) => (
      result.metafile.outputs[output]!.imports
        .filter((dependency) => dependency.kind === 'dynamic-import')
        .map((dependency) => dependency.path)
    ));
    const lazyInputs = collectInputs(
      result.metafile,
      collectOutputClosure(result.metafile, dynamicRoots),
    );
    const prohibitedEagerInputs = eagerInputs.filter((input) => (
      /[\\/](?:credential-store|privileged-agent-run|tool-registry-factory|deepseek|test-runner|execute-shell|run-tests|git-diff|git-commit)\.ts$/.test(input)
    ));
    const prohibitedEagerImports = eagerImports.filter((specifier) => (
      /^(?:node:)?child_process$/.test(specifier)
    ));

    expect({ prohibitedEagerInputs, prohibitedEagerImports }).toEqual({
      prohibitedEagerInputs: [],
      prohibitedEagerImports: [],
    });
    expect(lazyInputs.some((input) => /[\\/]credential-store\.ts$/.test(input))).toBe(true);
    expect(lazyInputs.some((input) => /[\\/]privileged-agent-run\.ts$/.test(input))).toBe(true);
    expect(lazyInputs.some((input) => /[\\/]deepseek\.ts$/.test(input))).toBe(true);
    expect(lazyInputs.some((input) => /[\\/]test-runner\.ts$/.test(input))).toBe(true);
  });

  it('keeps provider, credentials, and process capabilities out of the real app eager graph', async () => {
    const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
    const appGraph = await buildModuleGraph(join(sourceRoot, 'app.ts'));
    const serverGraph = await buildModuleGraph(join(sourceRoot, 'server.ts'));
    const prohibitedFiles = [...new Set([
      ...appGraph.eagerFiles,
      ...serverGraph.eagerFiles,
    ])].filter((file) => (
      /[\\/](?:credential-store|privileged-agent-run|tool-registry-factory|deepseek|test-runner|execute-shell|run-tests|git-diff|git-commit)\.ts$/.test(file)
    ));
    const prohibitedExternal = [...new Set([
      ...appGraph.eagerExternalImports,
      ...serverGraph.eagerExternalImports,
    ])].filter((specifier) => (
      /^(?:node:)?child_process$/.test(specifier)
    ));

    expect({ prohibitedFiles, prohibitedExternal }).toEqual({
      prohibitedFiles: [],
      prohibitedExternal: [],
    });
    expect([...appGraph.lazyImports]).toEqual(expect.arrayContaining([
      './privileged-agent-run.js',
      './routes/test-key.js',
    ]));
    expect([...serverGraph.lazyImports]).toEqual(expect.arrayContaining([
      './credential-store.js',
      '@harness/core',
    ]));
  });

  it('serves a real HTTP demo without loading credential, provider, or process modules', async () => {
    vi.doMock('@harness/core', () => {
      throw new Error('CORE_BARREL_LOADED');
    });
    vi.doMock('node:child_process', () => {
      throw new Error('CHILD_PROCESS_MODULE_LOADED');
    });
    vi.doMock('../../src/credential-store.js', () => {
      throw new Error('CREDENTIAL_MODULE_LOADED');
    });
    vi.doMock('../../../core/src/llm/deepseek.js', () => {
      throw new Error('PROVIDER_MODULE_LOADED');
    });
    vi.doMock('../../../core/src/feedback/test-runner.js', () => {
      throw new Error('PROCESS_MODULE_LOADED');
    });
    vi.doMock('../../../core/src/tools/execute-shell.js', () => {
      throw new Error('PROCESS_TOOL_MODULE_LOADED');
    });
    vi.doMock('../../src/tool-registry-factory.js', () => {
      throw new Error('PROCESS_REGISTRY_MODULE_LOADED');
    });
    vi.doMock('../../src/agent/privileged-agent-run.js', () => {
      throw new Error('PRIVILEGED_AGENT_MODULE_LOADED');
    });
    vi.doMock('../../src/routes/test-key.js', () => {
      throw new Error('CREDENTIAL_ROUTE_MODULE_LOADED');
    });
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'harness-demo-boundary-'));
    temporaryRoots.push(workspaceRoot);
    const events: SSEEvent[] = [];
    const sseManager: SSEManager = {
      createConnection: () => undefined,
      disconnect: () => undefined,
      setSecrets: () => undefined,
      clearSecrets: () => undefined,
      push: (_sessionId, event) => { events.push(event); },
      close: () => undefined,
    };

    const { createApp } = await import('../../src/app.js');
    const app = createApp({
      mode: 'public',
      workspaceRoot,
      idGenerator: () => 'boundary-demo',
      sseManager,
    });
    closeApp.push(app.close);
    await within(request(app).post('/api/agent/sessions').send({}), 'issue session');
    const started = await within(request(app).post('/api/agent/run').send({
      sessionId: 'boundary-demo',
      task: 'show the safe demo',
      mode: 'demo',
    }), 'start demo');
    await waitForEvent(events, 'complete');

    expect(started.status).toBe(202);
    expect(events.some((event) => event.type === 'complete')).toBe(true);
  });

  it('imports safely and resolves startServer only after HTTP listening', async () => {
    vi.stubEnv('HARNESS_MODE', 'public');
    vi.doMock('@harness/core', () => { throw new Error('CORE_BARREL_LOADED'); });
    vi.doMock('node:child_process', () => { throw new Error('CHILD_PROCESS_MODULE_LOADED'); });
    vi.doMock('../../src/credential-store.js', () => {
      throw new Error('CREDENTIAL_MODULE_LOADED');
    });
    vi.doMock('../../src/agent/privileged-agent-run.js', () => {
      throw new Error('PRIVILEGED_AGENT_MODULE_LOADED');
    });
    let listeningCallback: (() => void) | undefined;
    const listen = vi.spyOn(Server.prototype, 'listen')
      .mockImplementation(function mockListen(this: Server, ...args: unknown[]) {
        listeningCallback = args.find((argument) => typeof argument === 'function') as (() => void) | undefined;
        return this;
      });

    const serverModule = await import('../../src/server.js');
    expect(serverModule.startServer).toEqual(expect.any(Function));
    expect(listen).not.toHaveBeenCalled();

    let resolved = false;
    const started = serverModule.startServer().then((app) => {
      resolved = true;
      return app;
    });
    await Promise.resolve();

    expect(listen).toHaveBeenCalledTimes(1);
    expect(listeningCallback).toEqual(expect.any(Function));
    expect(resolved).toBe(false);

    listeningCallback!();
    const app = await started;
    closeApp.push(app.close);
    expect(resolved).toBe(true);
  });

  it('rejects startServer when the HTTP listener fails before readiness', async () => {
    vi.stubEnv('HARNESS_MODE', 'public');
    let httpServer: Server | undefined;
    vi.spyOn(Server.prototype, 'listen')
      .mockImplementation(function mockListen(this: Server) {
        httpServer = this;
        return this;
      });

    const { startServer } = await import('../../src/server.js');
    const started = startServer();
    await Promise.resolve();
    expect(httpServer).toBeDefined();

    const bindingError = new Error('EADDRINUSE regression');
    httpServer!.once('error', () => undefined);
    httpServer!.emit('error', bindingError);

    await expect(started).rejects.toBe(bindingError);
  });

  it('restores the real HTTP listen implementation after server import coverage', () => {
    expect(vi.isMockFunction(Server.prototype.listen)).toBe(false);
  });
});
