import { createApp } from './app.js';
import { initDb } from './database.js';
import { getSetting, setSetting } from './task-model.js';
import { ProviderRegistry } from './provider-registry.js';
import { MockProvider } from './providers/mock-provider.js';
import { SiliconFlowProvider } from './providers/siliconflow-provider.js';
import { VolcEngineProvider } from './providers/volcengine-provider.js';
import { AIHubMixProvider } from './providers/aihubmix-provider.js';
import { TaskPoller } from './task-poller.js';

const PORT = process.env.PORT || 3000;

// 初始化数据库
initDb();
console.log('[server] database initialized');

// 初始化 Provider 注册表
const registry = new ProviderRegistry();
registry.register(new MockProvider());
registry.register(
  new SiliconFlowProvider({
    apiKey: process.env.SILICONFLOW_API_KEY || '',
    defaultModel: process.env.SILICONFLOW_MODEL || undefined,
  })
);
registry.register(
  new VolcEngineProvider({
    apiKey: process.env.VOLCENGINE_API_KEY || '',
  })
);
registry.register(
  new AIHubMixProvider({
    apiKey: process.env.AIHUBMIX_API_KEY || '',
  })
);

// 从数据库加载已保存的 Provider 设置
for (const name of registry.listNames()) {
  const provider = registry.get(name);
  if (!provider) continue;
  const schema = provider.getSettingsSchema();
  if (schema.length === 0) continue;
  const saved: Record<string, string> = {};
  for (const s of schema) {
    const val = getSetting(`provider:${name}:${s.key}`);
    if (val) saved[s.key] = val;
  }
  // 加载缓存的模型数据（用于支持动态模型列表的 Provider）
  const cachedModels = getSetting(`provider:${name}:_cached_models`);
  const modelsUpdatedAt = getSetting(`provider:${name}:_models_updated_at`);
  if (cachedModels) saved._cached_models = cachedModels;
  if (modelsUpdatedAt) saved._models_updated_at = modelsUpdatedAt;

  if (Object.keys(saved).length > 0) {
    provider.applySettings(saved);
    console.log(`[server] loaded saved settings for provider: ${name}`);
  }
}

console.log(`[server] registered providers: ${registry.listNames().join(', ')}`);

// 自动刷新过期的动态模型列表
(async () => {
  for (const name of registry.listNames()) {
    const provider = registry.get(name);
    if (!provider?.needsModelRefresh?.()) continue;
    try {
      console.log(`[server] refreshing models for ${name}...`);
      await provider.refreshModels!();
      const cacheData = provider.getCacheData?.();
      if (cacheData) {
        for (const [key, value] of Object.entries(cacheData)) {
          setSetting(`provider:${name}:${key}`, value);
        }
      }
      console.log(`[server] refreshed models for ${name}`);
    } catch (err) {
      console.error(`[server] failed to refresh models for ${name}:`, err);
    }
  }
})();

// 启动任务轮询调度
const poller = new TaskPoller({
  registry,
  intervalMs: Number(process.env.POLL_INTERVAL_MS) || 5000,
  maxRetries: Number(process.env.MAX_RETRIES) || 3,
});
poller.start();

export { registry, poller };

const app = createApp(registry);

app.listen(PORT, () => {
  console.log(`[server] running at http://localhost:${PORT}`);
});
