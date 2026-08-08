import { describe, expect, it } from 'vitest';
import { createPolicyToolRegistry } from '../../src/agent/tool-registry-factory.js';
import { resolveRuntimePolicy } from '../../src/security/runtime-policy.js';

const workspaceRoot = process.cwd();

describe('createPolicyToolRegistry', () => {
  it('registers only workspace-confined file tools for the public policy', () => {
    const registry = createPolicyToolRegistry(resolveRuntimePolicy('public'), workspaceRoot);

    expect(registry.list().map((tool) => tool.name).sort())
      .toEqual(['read_file', 'search_code', 'write_file']);
  });

  it('retains every trusted tool for the local policy', () => {
    const registry = createPolicyToolRegistry(resolveRuntimePolicy('local'), workspaceRoot);

    expect(registry.list().map((tool) => tool.name).sort())
      .toEqual([
        'execute_shell',
        'git_commit',
        'git_diff',
        'read_file',
        'run_tests',
        'search_code',
        'write_file',
      ]);
  });
});
