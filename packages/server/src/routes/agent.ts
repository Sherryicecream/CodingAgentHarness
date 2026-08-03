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

export const agentRouter = Router();

// Shared state
const sseManager: SSEManager = createSSEManager();
const sessionStore = createSessionStore('.harness-sessions');
const activeLoops = new Map<string, AgentLoop>();

function buildAgentLoop(workingDir: string): AgentLoop {
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

  // Use real LLM if API key is configured, otherwise fall back to mock
  const apiKey = process.env.DEEPSEEK_API_KEY;
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
  });
}

function emit(sessionId: string, type: SSEEvent['type'], data: unknown) {
  sseManager.push(sessionId, { type, data, timestamp: new Date() });
}

// POST /api/agent/run — Run an agent loop
agentRouter.post('/run', async (req: Request, res: Response) => {
  try {
    const { task, workingDir } = req.body;
    if (!task || !workingDir) {
      res.status(400).json({ error: 'task and workingDir are required' });
      return;
    }

    const agentLoop = buildAgentLoop(workingDir);

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    activeLoops.set(sessionId, agentLoop);

    emit(sessionId, 'loop_step', { phase: 'starting', task });

    // Run the agent loop (non-blocking via SSE)
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
      emit(sessionId, 'error', { message: err.message });
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

// POST /api/agent/approve — Approve HITL blocked action
agentRouter.post('/approve', (req: Request, res: Response) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    res.status(400).json({ error: 'sessionId is required' });
    return;
  }

  const loop = activeLoops.get(sessionId);
  if (!loop) {
    res.status(404).json({ error: 'Session not found or not in blocked state' });
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
    res.status(400).json({ error: 'sessionId is required' });
    return;
  }

  const loop = activeLoops.get(sessionId);
  if (!loop) {
    res.status(404).json({ error: 'Session not found or not in blocked state' });
    return;
  }

  loop.handleApproval(false);
  emit(sessionId, 'guardrail', { approved: false, sessionId });
  activeLoops.delete(sessionId);
  sseManager.close(sessionId);
  res.json({ sessionId, status: 'rejected' });
});