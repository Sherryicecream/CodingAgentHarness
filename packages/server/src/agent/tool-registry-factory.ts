import {
  createExecuteShellTool,
  createGitCommitTool,
  createGitDiffTool,
  createReadFileTool,
  createRunTestsTool,
  createSearchCodeTool,
  createToolRegistry,
  createWriteFileTool,
  type ToolRegistry,
} from '@harness/core';
import type { RuntimePolicy } from '../security/runtime-policy.js';

export const createPolicyToolRegistry = (
  policy: RuntimePolicy,
  workspaceRoot: string,
): ToolRegistry => {
  const registry = createToolRegistry();

  registry.register(createReadFileTool(workspaceRoot));
  registry.register(createWriteFileTool(workspaceRoot));
  registry.register(createSearchCodeTool(workspaceRoot));

  if (!policy.allowProcessTools) {
    return registry;
  }

  registry.register(createExecuteShellTool(workspaceRoot));
  registry.register(createRunTestsTool(workspaceRoot));
  registry.register(createGitDiffTool(workspaceRoot));
  registry.register(createGitCommitTool(workspaceRoot));

  return registry;
};
