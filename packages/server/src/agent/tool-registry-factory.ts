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
import type { ArtifactTracker } from '../session/artifact-tracker.js';

export const createPolicyToolRegistry = (
  policy: RuntimePolicy,
  workspaceRoot: string,
  artifactTracker?: ArtifactTracker,
): ToolRegistry => {
  const registry = createToolRegistry();

  registry.register(createReadFileTool(workspaceRoot));
  registry.register(createWriteFileTool(workspaceRoot));
  registry.register(createSearchCodeTool(workspaceRoot));

  if (!policy.allowProcessTools) {
    return withArtifactTracking(registry, artifactTracker);
  }

  registry.register(createExecuteShellTool(workspaceRoot));
  registry.register(createRunTestsTool(workspaceRoot));
  registry.register(createGitDiffTool(workspaceRoot));
  registry.register(createGitCommitTool(workspaceRoot));

  return withArtifactTracking(registry, artifactTracker);
};

const withArtifactTracking = (
  registry: ToolRegistry,
  artifactTracker?: ArtifactTracker,
): ToolRegistry => {
  if (!artifactTracker) return registry;
  return {
    ...registry,
    async execute(name, params, context) {
      const result = await registry.execute(name, params, context);
      if (name === 'write_file' && result.success) {
        artifactTracker.record({
          relativePath: String(params.path),
          content: Buffer.from(String(params.content)),
          toolCallId: context?.toolCallId ?? 'write_file',
        });
      }
      return result;
    },
  };
};
