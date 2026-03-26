import app from './app.js';
import { ProviderRegistry } from './provider-registry.js';
import { MockProvider } from './providers/mock-provider.js';
import { SiliconFlowProvider } from './providers/siliconflow-provider.js';

const PORT = process.env.PORT || 3000;

// 初始化 Provider 注册表
const registry = new ProviderRegistry();
registry.register(new MockProvider());

if (process.env.SILICONFLOW_API_KEY) {
  registry.register(
    new SiliconFlowProvider({
      apiKey: process.env.SILICONFLOW_API_KEY,
      defaultModel: process.env.SILICONFLOW_MODEL || undefined,
    })
  );
  console.log('[server] SiliconFlow provider registered');
}

console.log(`[server] registered providers: ${registry.listNames().join(', ')}`);

export { registry };

app.listen(PORT, () => {
  console.log(`[server] running at http://localhost:${PORT}`);
});
