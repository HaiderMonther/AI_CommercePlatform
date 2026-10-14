import { http, unwrap } from './http';
import type { AiSettings, AiSettingsPayload, AiTestResult, AiTestTurn } from '@/types/ai';

export const aiService = {
  getConfig: () => unwrap<AiSettings>(http.get('/ai/config')),

  updateConfig: (payload: AiSettingsPayload) =>
    unwrap<AiSettings>(http.patch('/ai/config', payload)),

  // The agent may call several tools; give it longer than the default request timeout.
  test: (message: string, history: AiTestTurn[]) =>
    unwrap<AiTestResult>(http.post('/ai/test', { message, history }, { timeout: 120_000 })),
};
