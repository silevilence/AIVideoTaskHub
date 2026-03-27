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
