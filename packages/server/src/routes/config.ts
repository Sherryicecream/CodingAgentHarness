import { Router, Request, Response } from 'express';
import { createCredentialStore } from '../credential-store.js';

export const configRouter = Router();

const SERVICE_NAME = 'harness/deepseek-api-key';
const store = createCredentialStore();

// GET /api/config/status — Check API key configuration status
configRouter.get('/status', (_req: Request, res: Response) => {
  const hasKey = store.hasKey(SERVICE_NAME);
  const source = process.env.DEEPSEEK_API_KEY ? 'env' : (store.hasKey(SERVICE_NAME) ? 'file' : 'none');
  res.json({ hasKey, source });
});

// POST /api/config/key — Store API key
configRouter.post('/key', (req: Request, res: Response) => {
  const { key } = req.body;
  if (!key || typeof key !== 'string') {
    res.status(400).json({ error: '缺少必填参数：key，且必须为字符串' });
    return;
  }
  if (key.trim().length < 8) {
    res.status(400).json({ error: 'Key 太短（至少 8 个字符）' });
    return;
  }
  store.setKey(SERVICE_NAME, key.trim());
  res.json({ status: 'ok', message: 'API Key 已加密存储' });
});

// DELETE /api/config/key — Remove stored API key
configRouter.delete('/key', (_req: Request, res: Response) => {
  store.deleteKey(SERVICE_NAME);
  res.json({ status: 'ok', message: 'API Key 已清除' });
});

// GET /api/config/guide — Get first-run guide information
configRouter.get('/guide', (_req: Request, res: Response) => {
  const hasKey = store.hasKey(SERVICE_NAME);
  res.json({
    needsSetup: !hasKey,
    message: hasKey
      ? 'API Key 已配置'
      : '未找到 API Key。请配置 DeepSeek API Key 以使用真实 LLM。'
        + ' 未配置 Key 时，系统将以 Mock 模式运行（使用预设响应）。',
    instructions: [
      '1. 访问 https://platform.deepseek.com/api-keys 获取你的 API Key',
      '2. 在配置页面输入 Key（将加密存储到本地文件）',
      '3. 生产环境可设置 DEEPSEEK_API_KEY 环境变量',
    ],
  });
});