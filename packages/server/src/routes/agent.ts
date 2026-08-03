import { Router, Request, Response } from 'express';
import {
  createAgentLoop, MockLLMAdapter, DeepSeekAdapter,
  createToolRegistry, createReadFileTool, createWriteFileTool,
  createExecuteShellTool, createRunTestsTool, createSearchCodeTool,
  createGitDiffTool, createGitCommitTool,
  createGovernanceService, createFeedbackLoop,
  createTestRunner, createResultParser, createFailureClassifier, createFixSuggestionBuilder,
  createContextBuilder, createStopCondition, createSessionStore,
  type AgentLoop,
} from '@harness/core';
import { createSSEManager, type SSEManager, type SSEEvent } from '../sse/sse-manager.js';
import { createCredentialStore } from '../credential-store.js';

export const agentRouter = Router();

// Shared state
const sseManager: SSEManager = createSSEManager();
const sessionStore = createSessionStore('.harness-sessions');
const activeLoops = new Map<string, AgentLoop>();
const credentialStore = createCredentialStore();

function buildAgentLoop(workingDir: string, sessionId?: string): AgentLoop {
  const tools = createToolRegistry();
  tools.register(createReadFileTool(workingDir));
  tools.register(createWriteFileTool(workingDir));
  tools.register(createExecuteShellTool(workingDir));
  tools.register(createRunTestsTool(workingDir));
  tools.register(createSearchCodeTool(workingDir));
  tools.register(createGitDiffTool(workingDir));
  tools.register(createGitCommitTool(workingDir));

  const governance = createGovernanceService();
  const testRunner = createTestRunner();
  const resultParser = createResultParser();
  const failureClassifier = createFailureClassifier();
  const fixSuggestionBuilder = createFixSuggestionBuilder();
  const feedback = createFeedbackLoop(testRunner, resultParser, failureClassifier, fixSuggestionBuilder);

  const contextBuilder = createContextBuilder();
  const stopCondition = createStopCondition();

  // Check credential store first, then environment variable
  const storedKey = credentialStore.getKey('harness/deepseek-api-key');
  const apiKey = storedKey || process.env.DEEPSEEK_API_KEY || '';
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';

  const llm = apiKey
    ? new DeepSeekAdapter({ apiKey, baseUrl })
    : new MockLLMAdapter([
        {
          content: 'I will read the project files to understand the codebase.',
          toolCalls: [{ id: 'call_1', name: 'read_file', arguments: { filePath: 'src/index.ts' } }],
        },
        {
          content: 'Task completed successfully.',
          toolCalls: [],
        },
      ]);

  return createAgentLoop({
    llm,
    tools,
    governance,
    feedback,
    contextBuilder,
    stopCondition,
    config: { maxIterations: 10 },
    onEvent: sessionId ? (type, data) => emit(sessionId, type as any, data) : undefined,
  });
}

function emit(sessionId: string, type: SSEEvent['type'], data: unknown) {
  sseManager.push(sessionId, { type, data, timestamp: new Date() });
}

// POST /api/agent/run — Run an agent loop
agentRouter.post('/run', async (req: Request, res: Response) => {
  try {
    const { task, workingDir, sessionId } = req.body;
    if (!task || !workingDir || !sessionId) {
      res.status(400).json({ error: '缺少必填参数：task、workingDir、sessionId' });
      return;
    }

    const agentLoop = buildAgentLoop(workingDir, sessionId);
    activeLoops.set(sessionId, agentLoop);

    emit(sessionId, 'loop_step', { phase: 'starting', task });

    // Run the agent loop
    agentLoop.run(task, workingDir).then(async (result) => {
      await sessionStore.save(result.session);
      emit(sessionId, 'complete', { status: result.status, sessionId: result.session.id });

      if (result.status === 'blocked') {
        // Don't remove from activeLoops — waiting for approve/reject
      } else {
        activeLoops.delete(sessionId);
        sseManager.close(sessionId);
      }
    }).catch((err: Error) => {
      const message = err.name === 'LLMCallError'
        ? `${err.message}`
        : err.message;
      emit(sessionId, 'error', { message });
      activeLoops.delete(sessionId);
      sseManager.close(sessionId);
    });

    res.json({ sessionId, status: 'started' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agent/stream/:sessionId — SSE endpoint
agentRouter.get('/stream/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  sseManager.createConnection(sessionId, res);

  // Keep connection alive
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseManager.close(sessionId);
  });
});

// POST /api/agent/test-key — Test if the API key is valid
agentRouter.post('/test-key', async (_req: Request, res: Response) => {
  try {
    const storedKey = credentialStore.getKey('harness/deepseek-api-key');
    const apiKey = storedKey || process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      res.json({ valid: false, error: '未配置 API Key' });
      return;
    }

    const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 5,
      }),
    });

    if (response.ok) {
      res.json({ valid: true });
    } else {
      const text = await response.text();
      res.json({ valid: false, error: `API 返回 ${response.status}: ${text}` });
    }
  } catch (err: any) {
    res.json({ valid: false, error: `连接失败：${err.message}` });
  }
});

// POST /api/agent/approve — Approve HITL blocked action
agentRouter.post('/approve', (req: Request, res: Response) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    res.status(400).json({ error: '缺少必填参数：sessionId' });
    return;
  }

  const loop = activeLoops.get(sessionId);
  if (!loop) {
    res.status(404).json({ error: '未找到会话，或会话不在阻断状态' });
    return;
  }

  loop.handleApproval(true);
  emit(sessionId, 'guardrail', { approved: true, sessionId });
  res.json({ sessionId, status: 'approved' });
});

// POST /api/agent/reject — Reject HITL blocked action
agentRouter.post('/reject', (req: Request, res: Response) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    res.status(400).json({ error: '缺少必填参数：sessionId' });
    return;
  }

  const loop = activeLoops.get(sessionId);
  if (!loop) {
    res.status(404).json({ error: '未找到会话，或会话不在阻断状态' });
    return;
  }

  loop.handleApproval(false);
  emit(sessionId, 'guardrail', { approved: false, sessionId });
  activeLoops.delete(sessionId);
  sseManager.close(sessionId);
  res.json({ sessionId, status: 'rejected' });
});