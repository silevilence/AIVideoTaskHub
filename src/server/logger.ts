import * as fs from 'fs';
import * as path from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    data?: unknown;
}

class Logger {
    private logDir: string;
    private logFile: string;
    private minLevel: LogLevel;
    private levelPriority: Record<LogLevel, number> = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
    };

    constructor() {
        const dataDir = process.env.DATA_DIR || 'data';
        this.logDir = path.resolve(dataDir, 'logs');
        this.minLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

        // 确保日志目录存在
        fs.mkdirSync(this.logDir, { recursive: true });

        // 使用日期作为日志文件名
        const date = new Date().toISOString().split('T')[0];
        this.logFile = path.join(this.logDir, `${date}.log`);
    }

    private shouldLog(level: LogLevel): boolean {
        return this.levelPriority[level] >= this.levelPriority[this.minLevel];
    }

    private formatMessage(level: LogLevel, message: string, data?: unknown): string {
        const timestamp = new Date().toISOString();
        const dataStr = data ? ` ${JSON.stringify(data)}` : '';
        return `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}`;
    }

    private writeToFile(entry: LogEntry): void {
        try {
            const line = this.formatMessage(entry.level, entry.message, entry.data) + '\n';
            fs.appendFileSync(this.logFile, line);
        } catch {
            // 写入失败时不抛出错误，避免影响主程序
        }
    }

    private writeToConsole(level: LogLevel, message: string, data?: unknown): void {
        const formatted = this.formatMessage(level, message, data);
        switch (level) {
            case 'debug':
                console.debug(formatted);
                break;
            case 'info':
                console.info(formatted);
                break;
            case 'warn':
                console.warn(formatted);
                break;
            case 'error':
                console.error(formatted);
                break;
        }
    }

    private log(level: LogLevel, message: string, data?: unknown): void {
        if (!this.shouldLog(level)) return;

        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            data,
        };

        // 同时输出到控制台和文件
        this.writeToConsole(level, message, data);
        this.writeToFile(entry);
    }

    debug(message: string, data?: unknown): void {
        this.log('debug', message, data);
    }

    info(message: string, data?: unknown): void {
        this.log('info', message, data);
    }

    warn(message: string, data?: unknown): void {
        this.log('warn', message, data);
    }

    error(message: string, data?: unknown): void {
        this.log('error', message, data);
    }

    // 任务相关日志
    taskCreated(taskId: number, provider: string, model: string | null): void {
        this.info(`任务创建: #${taskId}`, { provider, model });
    }

    taskStatusChanged(taskId: number, oldStatus: string, newStatus: string): void {
        this.info(`任务状态变更: #${taskId} ${oldStatus} -> ${newStatus}`);
    }

    taskCompleted(taskId: number, resultUrl: string): void {
        this.info(`任务完成: #${taskId}`, { resultUrl });
    }

    taskFailed(taskId: number, error: string): void {
        this.error(`任务失败: #${taskId}`, { error });
    }

    taskRetry(taskId: number, retryCount: number): void {
        this.info(`任务重试: #${taskId}`, { retryCount });
    }

    taskDeleted(taskId: number): void {
        this.info(`任务删除（移入回收站）: #${taskId}`);
    }

    taskPurged(taskId: number): void {
        this.info(`任务彻底删除: #${taskId}`);
    }

    // Provider 相关日志
    providerApiCall(provider: string, action: string, data?: unknown): void {
        this.debug(`Provider API 调用: ${provider}.${action}`, data);
    }

    providerApiError(provider: string, action: string, error: string): void {
        this.error(`Provider API 错误: ${provider}.${action}`, { error });
    }

    // 系统日志
    serverStarted(port: number): void {
        this.info(`服务启动`, { port });
    }

    pollerStarted(): void {
        this.info('任务轮询器启动');
    }
}

// 导出单例
export const logger = new Logger();
