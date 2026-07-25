import { AgentConfig } from '../types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export interface ConfigLoader {
  load(projectPath: string): Promise<AgentConfig>;
  getDefaults(): AgentConfig;
  validate(config: unknown): config is AgentConfig;
}

export function createConfigLoader(): ConfigLoader {
  const defaults: AgentConfig = {
    maxIterations: 20,
    testCommand: 'npm test',
    allowedTools: ['*'],
    blockedCommands: ['rm -rf', 'DROP TABLE', 'git push --force', 'npm publish'],
    ignoredPaths: ['node_modules', '.git', 'dist'],
  };

  return {
    getDefaults() {
      return { ...defaults };
    },

    async load(projectPath: string) {
      const configPath = path.join(projectPath, '.harness', 'config.yaml');
      if (!fs.existsSync(configPath)) {
        return { ...defaults };
      }
      try {
        const raw = yaml.parse(fs.readFileSync(configPath, 'utf-8'));
        const merged = { ...defaults, ...raw };
        if (!this.validate(merged)) {
          throw new ConfigValidationError('Invalid config structure');
        }
        return merged;
      } catch (err: any) {
        if (err instanceof ConfigValidationError) throw err;
        throw new ConfigValidationError(`Failed to load config: ${err.message}`);
      }
    },

    validate(config: unknown): config is AgentConfig {
      if (!config || typeof config !== 'object') return false;
      const c = config as any;
      return (
        typeof c.maxIterations === 'number' &&
        typeof c.testCommand === 'string' &&
        Array.isArray(c.allowedTools) &&
        Array.isArray(c.blockedCommands) &&
        Array.isArray(c.ignoredPaths)
      );
    },
  };
}