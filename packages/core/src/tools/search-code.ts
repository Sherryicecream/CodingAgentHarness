import { Tool, ToolResult } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

export interface SearchMatch {
  file: string;
  line: number;
  content: string;
}

function shouldExcludeDir(dirName: string): boolean {
  return dirName === 'node_modules' || dirName === '.git';
}

function matchesFileType(filePath: string, fileTypes?: string[]): boolean {
  if (!fileTypes || fileTypes.length === 0) {
    return true;
  }
  const ext = path.extname(filePath).toLowerCase();
  return fileTypes.some(ft => {
    const normalized = ft.startsWith('.') ? ft.toLowerCase() : `.${ft.toLowerCase()}`;
    return ext === normalized;
  });
}

function searchInDirectory(
  dirPath: string,
  pattern: RegExp,
  fileTypes: string[] | undefined,
  workspaceRoot: string,
  results: SearchMatch[]
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    // Skip directories we can't read
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (shouldExcludeDir(entry.name)) {
        continue;
      }
      searchInDirectory(fullPath, pattern, fileTypes, workspaceRoot, results);
    } else if (entry.isFile()) {
      if (!matchesFileType(fullPath, fileTypes)) {
        continue;
      }

      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            const relativePath = path.relative(workspaceRoot, fullPath);
            results.push({
              file: relativePath,
              line: i + 1,
              content: lines[i],
            });
          }
        }
      } catch {
        // Skip files we can't read
      }
    }
  }
}

export function createSearchCodeTool(workspaceRoot: string): Tool {
  const resolvedRoot = path.resolve(workspaceRoot);

  return {
    definition: {
      name: 'search_code',
      description:
        'Search for patterns in files using regex. Returns array of matches with file, line number, and content.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Regex pattern to search for in file contents.',
          },
          path: {
            type: 'string',
            description:
              'Optional subdirectory within workspaceRoot to search in. Defaults to workspaceRoot.',
          },
          fileTypes: {
            type: 'string',
            description:
              'Optional comma-separated file extensions to filter by (e.g., ".ts,.js").',
          },
        },
        required: ['pattern'],
      },
    },
    riskLevel: 'safe',

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const patternStr = String(params.pattern);
      const subPath = params.path !== undefined ? String(params.path) : undefined;
      const fileTypesStr = params.fileTypes !== undefined ? String(params.fileTypes) : undefined;

      let searchDir = resolvedRoot;
      if (subPath) {
        searchDir = path.resolve(resolvedRoot, subPath);

        // Prevent path traversal
        if (!searchDir.startsWith(resolvedRoot + path.sep) && searchDir !== resolvedRoot) {
          return {
            success: false,
            output: '',
            error: `Access denied: path is outside workspace root. Requested: ${subPath}`,
          };
        }

        // Verify the directory exists
        if (!fs.existsSync(searchDir) || !fs.statSync(searchDir).isDirectory()) {
          return {
            success: false,
            output: '',
            error: `Directory not found: ${subPath}`,
          };
        }
      }

      let pattern: RegExp;
      try {
        pattern = new RegExp(patternStr);
      } catch (err: any) {
        return {
          success: false,
          output: '',
          error: `Invalid regex pattern: ${err.message}`,
        };
      }

      const fileTypes = fileTypesStr
        ? fileTypesStr.split(',').map(s => s.trim()).filter(s => s.length > 0)
        : undefined;

      const results: SearchMatch[] = [];
      searchInDirectory(searchDir, pattern, fileTypes, resolvedRoot, results);

      return {
        success: true,
        output: JSON.stringify(results),
      };
    },
  };
}