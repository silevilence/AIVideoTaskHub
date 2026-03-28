/** 统一任务状态 */
export type TaskStatus = 'pending' | 'running' | 'success' | 'failed';

/** 创建任务参数 */
export interface CreateTaskParams {
    prompt: string;
    model?: string;
    imageUrl?: string;
    /** Provider 特定的额外参数 */
    extra?: Record<string, unknown>;
}

/** 创建任务返回值 */
export interface CreateTaskResult {
    providerTaskId: string;
}

/** 查询状态返回值 */
export interface TaskStatusResult {
    status: TaskStatus;
    /** 成功时的临时视频 URL */
    videoUrl?: string;
    /** 失败时的错误信息 */
    errorMessage?: string;
}

/** 模型能力声明（前端根据此元数据动态渲染设置界面） */
export interface ModelCapabilities {
    /** 支持图生视频（首帧） */
    i2v: boolean;
    /** 支持首尾帧 */
    firstLastFrame: boolean;
    /** 支持参考图 */
    referenceImage: boolean;
    /** 支持生成音频 */
    audio: boolean;
    /** 支持固定镜头 */
    cameraFixed: boolean;
    /** 支持样片模式 */
    draft: boolean;
    /** 支持的分辨率 */
    resolutions: string[];
    /** 支持的时长范围 [min, max] */
    durationRange: [number, number];
    /** 支持自动时长 (-1) */
    autoDuration: boolean;
    /** 默认分辨率 */
    defaultResolution: string;
    /** 支持的宽高比列表 */
    ratios?: string[];
}

/** 模型信息（包含 displayName 和能力声明） */
export interface ModelInfo {
    /** 模型 ID（唯一标识） */
    id: string;
    /** 模型显示名称 */
    displayName: string;
    /** 模型能力声明（可选，无则为纯文本生成） */
    capabilities?: ModelCapabilities;
}

/** Provider 设置项声明 */
export interface ProviderSettingSchema {
    /** 设置项 key（唯一） */
    key: string;
    /** 显示名称 */
    label: string;
    /** 是否为敏感字段（如 API Key），前端显示时脱敏 */
    secret?: boolean;
    /** 是否必填 */
    required?: boolean;
    /** 默认值 */
    defaultValue?: string;
    /** 说明 */
    description?: string;
}

/** 视频生成 Provider 统一接口 */
export interface VideoProvider {
    /** Provider 唯一名称标识 */
    readonly name: string;

    /** Provider 显示名称（用于 UI 展示） */
    readonly displayName: string;

    /** 可用模型列表 */
    readonly models: string[];

    /** 返回所有模型的详细信息（包含 displayName 和能力声明） */
    getModelsInfo(): ModelInfo[];

    /** 返回此 Provider 需要的设置项声明 */
    getSettingsSchema(): ProviderSettingSchema[];

    /** 应用设置（从数据库加载或用户更新时调用） */
    applySettings(settings: Record<string, string>): void;

    /** 获取当前设置值（脱敏后，用于前端展示） */
    getCurrentSettings(): Record<string, string>;

    /** 向平台提交生成任务，返回平台侧任务 ID */
    createTask(params: CreateTaskParams): Promise<CreateTaskResult>;

    /** 查询平台侧任务的最新状态 */
    getStatus(providerTaskId: string): Promise<TaskStatusResult>;

    /** 将临时视频 URL 下载到本地路径 */
    downloadVideo(videoUrl: string, targetPath: string): Promise<void>;
}
