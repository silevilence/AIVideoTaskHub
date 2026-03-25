/** 统一任务状态 */
export type TaskStatus = 'pending' | 'running' | 'success' | 'failed';

/** 创建任务参数 */
export interface CreateTaskParams {
    prompt: string;
    model?: string;
    imageUrl?: string;
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

/** 视频生成 Provider 统一接口 */
export interface VideoProvider {
    /** Provider 唯一名称标识 */
    readonly name: string;

    /** 向平台提交生成任务，返回平台侧任务 ID */
    createTask(params: CreateTaskParams): Promise<CreateTaskResult>;

    /** 查询平台侧任务的最新状态 */
    getStatus(providerTaskId: string): Promise<TaskStatusResult>;

    /** 将临时视频 URL 下载到本地路径 */
    downloadVideo(videoUrl: string, targetPath: string): Promise<void>;
}
