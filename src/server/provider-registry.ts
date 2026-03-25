import type { VideoProvider } from './provider.js';

export class ProviderRegistry {
    private readonly providers = new Map<string, VideoProvider>();

    /** 注册一个 Provider，名称重复时抛出错误 */
    register(provider: VideoProvider): void {
        if (this.providers.has(provider.name)) {
            throw new Error(`Provider "${provider.name}" 已注册，不可重复注册`);
        }
        this.providers.set(provider.name, provider);
    }

    /** 按名称获取 Provider */
    get(name: string): VideoProvider | undefined {
        return this.providers.get(name);
    }

    /** 判断某个 Provider 是否已注册 */
    has(name: string): boolean {
        return this.providers.has(name);
    }

    /** 列出所有已注册的 Provider 名称 */
    listNames(): string[] {
        return [...this.providers.keys()];
    }
}
