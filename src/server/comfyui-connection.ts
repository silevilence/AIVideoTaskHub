import { randomUUID } from 'node:crypto';
import type { LookupAddress } from 'node:dns';
import { lookup as nodeLookup } from 'node:dns/promises';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ComfyApiWorkflow } from './comfy-workflow-template.js';

interface ComfyObjectInfoNode {
    input?: {
        required?: Record<string, unknown>;
        optional?: Record<string, unknown>;
        hidden?: Record<string, unknown>;
    };
}

export type ComfyObjectInfo = Record<string, ComfyObjectInfoNode>;

export interface ComfyIncompatibleInput {
    nodeId: string;
    classType: string;
    input: string;
    reason?: string;
}

export interface ComfyCompatibilityResult {
    ok: boolean;
    baseUrl: string;
    nodeTypeCount: number;
    missingNodeTypes: string[];
    missingRequiredInputs: ComfyIncompatibleInput[];
    incompatibleInputs: ComfyIncompatibleInput[];
}

export type ComfyDnsResolver = (hostname: string) => Promise<readonly LookupAddress[]>;

const defaultDnsResolver: ComfyDnsResolver = (hostname) => nodeLookup(hostname, {
    all: true,
    verbatim: true,
});
const nativeFetch = globalThis.fetch;

function normalizedHostname(value: string): string {
    return value.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function mappedIpv4Address(value: string): string | undefined {
    if (!value.startsWith('::ffff:')) return undefined;
    const suffix = value.slice('::ffff:'.length);
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(suffix)) return suffix;
    const words = suffix.split(':');
    if (words.length !== 2 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) {
        return undefined;
    }
    const high = Number.parseInt(words[0], 16);
    const low = Number.parseInt(words[1], 16);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

function isCloudMetadataTarget(value: string): boolean {
    const normalized = normalizedHostname(value);
    const hostname = mappedIpv4Address(normalized) ?? normalized;
    return /^169\.254\./.test(hostname)
        || /^fe[89ab][0-9a-f]:/.test(hostname)
        || hostname === '100.100.100.200'
        || hostname === 'fd00:ec2::254'
        || hostname === 'metadata.google.internal';
}

function assertSafeTarget(value: string, label = 'ComfyUI 地址'): void {
    if (isCloudMetadataTarget(value)) {
        throw new Error(`${label}不允许访问云元数据服务`);
    }
}

export function normalizeComfyUiBaseUrl(value: string): string {
    const candidate = value.trim();
    let url: URL;
    try {
        url = new URL(candidate);
    } catch {
        throw new Error('ComfyUI 地址无效');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('ComfyUI 地址仅支持 HTTP 或 HTTPS');
    }
    if (!url.hostname || url.username || url.password || url.search || url.hash) {
        throw new Error('ComfyUI 地址无效');
    }
    const hostname = normalizedHostname(url.hostname);
    assertSafeTarget(hostname);
    if (url.hostname.endsWith('.')) url.hostname = hostname;
    return url.toString().replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function resolveSafeAddresses(
    baseUrl: string,
    resolver: ComfyDnsResolver,
    label = 'ComfyUI 地址'
): Promise<readonly LookupAddress[]> {
    const hostname = normalizedHostname(new URL(baseUrl).hostname);
    const family = isIP(hostname);
    if (family) return [{ address: hostname, family }];

    let addresses: readonly LookupAddress[];
    try {
        addresses = await resolver(hostname);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`无法解析 ComfyUI 地址：${message}`);
    }
    if (addresses.length === 0) throw new Error('无法解析 ComfyUI 地址：DNS 未返回地址');
    for (const address of addresses) assertSafeTarget(address.address, label);
    return addresses;
}

export interface SafeHttpRequestOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit | Buffer;
    maxResponseBytes?: number;
    targetLabel?: string;
    safeTarget?: SafeHttpTarget;
}

export interface SafeHttpResponse {
    status: number;
    headers: Headers;
    body: Buffer;
}

export interface SafeHttpTarget {
    origin: string;
    address: LookupAddress;
}

export function validateSafeHttpTarget(
    value: string,
    target: SafeHttpTarget,
    label = 'HTTP 地址'
): SafeHttpTarget {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`${label}无效`);
    }
    if (url.origin !== target.origin) throw new Error(`${label}与固定目标不一致`);
    const family = isIP(target.address.address);
    if ((family !== 4 && family !== 6) || family !== target.address.family) {
        throw new Error(`${label}固定目标无效`);
    }
    assertSafeTarget(target.address.address, label);
    return {
        origin: url.origin,
        address: { address: target.address.address, family },
    };
}

export async function createSafeHttpTarget(
    value: string,
    resolver: ComfyDnsResolver = defaultDnsResolver,
    label = 'HTTP 地址'
): Promise<SafeHttpTarget> {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`${label}无效`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`${label}仅支持 HTTP 或 HTTPS`);
    }
    if (!url.hostname || url.username || url.password) throw new Error(`${label}无效`);
    assertSafeTarget(normalizedHostname(url.hostname), label);
    const addresses = await resolveSafeAddresses(url.toString(), resolver, label);
    return { origin: url.origin, address: addresses[0] };
}

function requestPinnedBuffer(
    url: URL,
    address: LookupAddress,
    options: SafeHttpRequestOptions
): Promise<SafeHttpResponse> {
    return new Promise((resolve, reject) => {
        let settled = false;
        let request: ReturnType<typeof httpRequest>;
        const finish = (result: SafeHttpResponse) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve(result);
        };
        const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (request && !request.destroyed) request.destroy();
            reject(error);
        };
        const timeout = setTimeout(() => {
            fail(new Error(`${options.targetLabel ?? 'HTTP'}请求超时`));
        }, 10_000);
        const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
        request = transport(url, {
            method: options.method ?? 'GET',
            headers: options.headers,
            signal: AbortSignal.timeout(10_000),
            lookup: (_hostname, lookupOptions, callback) => {
                if (lookupOptions.all) callback(null, [address]);
                else callback(null, address.address, address.family);
            },
            ...(url.protocol === 'https:' ? { servername: normalizedHostname(url.hostname) } : {}),
        }, (response) => {
            const chunks: Buffer[] = [];
            let byteLength = 0;
            response.on('data', (chunk: Buffer) => {
                if (settled) return;
                byteLength += chunk.length;
                if (byteLength > (options.maxResponseBytes ?? 50 * 1024 * 1024)) {
                    fail(new Error(`${options.targetLabel ?? 'HTTP'} 响应过大`));
                    return;
                }
                chunks.push(chunk);
            });
            response.once('aborted', () => fail(new Error(
                `${options.targetLabel ?? 'HTTP'} 响应中断`
            )));
            response.once('error', (error) => fail(error));
            response.once('close', () => {
                if (!settled && !response.complete) {
                    fail(new Error(`${options.targetLabel ?? 'HTTP'} 响应中断`));
                }
            });
            response.once('end', () => {
                if (!response.complete) {
                    fail(new Error(`${options.targetLabel ?? 'HTTP'} 响应中断`));
                    return;
                }
                finish({
                    status: response.statusCode ?? 0,
                    headers: new Headers(Object.entries(response.headers).flatMap(([key, value]) => (
                        Array.isArray(value)
                            ? value.map((item) => [key, item] as [string, string])
                            : value === undefined ? [] : [[key, String(value)] as [string, string]]
                    ))),
                    body: Buffer.concat(chunks),
                });
            });
        });
        request.once('error', (error) => fail(error));
        const body = options.body;
        if (typeof body === 'string' || Buffer.isBuffer(body)) request.write(body);
        else if (body !== undefined) {
            request.destroy(new Error('原生安全请求仅支持字符串或 Buffer 请求体'));
            return;
        }
        request.end();
    });
}

export async function requestSafeHttpUrl(
    value: string,
    options: SafeHttpRequestOptions = {},
    fetcher: typeof fetch = fetch,
    resolver: ComfyDnsResolver = defaultDnsResolver
): Promise<SafeHttpResponse> {
    const label = options.targetLabel ?? 'HTTP 地址';
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`${label}无效`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`${label}仅支持 HTTP 或 HTTPS`);
    }
    if (!url.hostname || url.username || url.password) throw new Error(`${label}无效`);
    assertSafeTarget(normalizedHostname(url.hostname), label);
    let addresses: readonly LookupAddress[];
    if (options.safeTarget) {
        if (url.origin !== options.safeTarget.origin) {
            throw new Error(`${label}与已检查地址不一致`);
        }
        addresses = [options.safeTarget.address];
    } else {
        addresses = await resolveSafeAddresses(url.toString(), resolver, label);
    }

    let response: SafeHttpResponse;
    if (fetcher === nativeFetch) {
        response = await requestPinnedBuffer(url, addresses[0], options);
    } else {
        let fetched: Response;
        try {
            fetched = await fetcher(url.toString(), {
                method: options.method ?? 'GET',
                headers: options.headers,
                body: options.body as BodyInit | undefined,
                signal: AbortSignal.timeout(10_000),
                redirect: 'manual',
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`${label}请求失败：${message}`);
        }
        const body = Buffer.from(await fetched.arrayBuffer());
        if (body.length > (options.maxResponseBytes ?? 50 * 1024 * 1024)) {
            throw new Error(`${label}响应过大`);
        }
        response = { status: fetched.status, headers: fetched.headers, body };
    }
    if (response.status >= 300 && response.status < 400) {
        throw new Error(`${label}不允许重定向`);
    }
    return response;
}

export interface SafeDownloadOptions {
    maxResponseBytes?: number;
    targetLabel?: string;
    safeTarget?: SafeHttpTarget;
    allowedContentTypes?: readonly string[];
}

function isAllowedContentType(value: string | null | undefined, allowed?: readonly string[]): boolean {
    if (!allowed || allowed.length === 0) return true;
    const normalized = value?.split(';')[0].trim().toLowerCase() ?? '';
    return allowed.some((candidate) => candidate.endsWith('/')
        ? normalized.startsWith(candidate)
        : normalized === candidate);
}

async function requestPinnedToFile(
    url: URL,
    address: LookupAddress,
    targetPath: string,
    options: SafeDownloadOptions
): Promise<void> {
    const label = options.targetLabel ?? 'HTTP 下载';
    await new Promise<void>((resolve, reject) => {
        let settled = false;
        let request: ReturnType<typeof httpRequest>;
        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (error) {
                if (request && !request.destroyed) request.destroy();
                reject(error);
            } else {
                resolve();
            }
        };
        const timeout = setTimeout(() => finish(new Error(`${label}请求超时`)), 60_000);
        const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
        request = transport(url, {
            signal: AbortSignal.timeout(60_000),
            lookup: (_hostname, lookupOptions, callback) => {
                if (lookupOptions.all) callback(null, [address]);
                else callback(null, address.address, address.family);
            },
            ...(url.protocol === 'https:' ? { servername: normalizedHostname(url.hostname) } : {}),
        }, (response) => {
            if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400) {
                response.resume();
                finish(new Error(`${label}不允许重定向`));
                return;
            }
            if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
                response.resume();
                finish(new Error(`${label}失败（HTTP ${response.statusCode ?? 0}）`));
                return;
            }
            if (!isAllowedContentType(response.headers['content-type'], options.allowedContentTypes)) {
                response.resume();
                finish(new Error(`${label}响应类型无效`));
                return;
            }
            let byteLength = 0;
            const limiter = new Transform({
                transform(chunk: Buffer, _encoding, callback) {
                    byteLength += chunk.length;
                    if (byteLength > (options.maxResponseBytes ?? 2 * 1024 * 1024 * 1024)) {
                        callback(new Error(`${label}响应过大`));
                        return;
                    }
                    callback(null, chunk);
                },
            });
            void pipeline(response, limiter, createWriteStream(targetPath, { flags: 'wx' }))
                .then(() => {
                    if (byteLength === 0) finish(new Error(`${label}内容为空`));
                    else finish();
                })
                .catch((error) => finish(error as Error));
        });
        request.once('upgrade', (_response, socket) => {
            socket.destroy();
            finish(new Error(`${label}不允许协议升级`));
        });
        request.once('error', (error) => finish(error));
        request.end();
    });
}

export async function downloadSafeHttpUrl(
    value: string,
    targetPath: string,
    options: SafeDownloadOptions = {},
    fetcher: typeof fetch = fetch,
    resolver: ComfyDnsResolver = defaultDnsResolver
): Promise<void> {
    const label = options.targetLabel ?? 'HTTP 下载';
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`${label}地址无效`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`${label}仅支持 HTTP 或 HTTPS`);
    }
    if (!url.hostname || url.username || url.password) throw new Error(`${label}地址无效`);
    assertSafeTarget(normalizedHostname(url.hostname), label);
    const addresses = options.safeTarget
        ? [validateSafeHttpTarget(value, options.safeTarget, label).address]
        : await resolveSafeAddresses(value, resolver, label);
    await mkdir(path.dirname(targetPath), { recursive: true });
    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
    try {
        if (fetcher === nativeFetch) {
            await requestPinnedToFile(url, addresses[0], temporaryPath, options);
        } else {
            const response = await requestSafeHttpUrl(value, {
                maxResponseBytes: options.maxResponseBytes,
                targetLabel: label,
                safeTarget: options.safeTarget,
            }, fetcher, resolver);
            if (response.status < 200 || response.status >= 300) {
                throw new Error(`${label}失败（HTTP ${response.status}）`);
            }
            if (!isAllowedContentType(
                response.headers.get('content-type'),
                options.allowedContentTypes
            )) {
                throw new Error(`${label}响应类型无效`);
            }
            if (response.body.length === 0) throw new Error(`${label}内容为空`);
            await writeFile(temporaryPath, response.body, { flag: 'wx' });
        }
        await rename(temporaryPath, targetPath);
    } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
    }
}

function requestPinnedObjectInfo(
    url: URL,
    address: LookupAddress
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        let settled = false;
        let request: ReturnType<typeof httpRequest>;
        const finish = (result: { status: number; body: string }) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve(result);
        };
        const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (request && !request.destroyed) request.destroy();
            reject(error);
        };
        const timeout = setTimeout(() => fail(new Error('ComfyUI /object_info 请求超时')), 10_000);
        const transport = url.protocol === 'https:' ? httpsGet : httpGet;
        request = transport(url, {
            signal: AbortSignal.timeout(10_000),
            lookup: (_hostname, options, callback) => {
                if (options.all) callback(null, [address]);
                else callback(null, address.address, address.family);
            },
            ...(url.protocol === 'https:' ? { servername: normalizedHostname(url.hostname) } : {}),
        }, (response) => {
            const chunks: Buffer[] = [];
            let byteLength = 0;
            response.on('data', (chunk: Buffer) => {
                if (settled) return;
                byteLength += chunk.length;
                if (byteLength > 50 * 1024 * 1024) {
                    fail(new Error('ComfyUI /object_info 响应过大'));
                    return;
                }
                chunks.push(chunk);
            });
            response.once('aborted', () => fail(new Error('ComfyUI /object_info 响应中断')));
            response.once('error', (error) => fail(error));
            response.once('close', () => {
                if (!settled && !response.complete) {
                    fail(new Error('ComfyUI /object_info 响应中断'));
                }
            });
            response.once('end', () => {
                if (!response.complete) {
                    fail(new Error('ComfyUI /object_info 响应中断'));
                    return;
                }
                finish({
                    status: response.statusCode ?? 0,
                    body: Buffer.concat(chunks).toString('utf8'),
                });
            });
        });
        request.once('error', (error) => fail(new Error(`无法连接 ComfyUI：${error.message}`)));
    });
}

async function fetchObjectInfo(
    baseUrl: string,
    addresses: readonly LookupAddress[],
    fetcher: typeof fetch
): Promise<ComfyObjectInfo> {
    const objectInfoUrl = new URL(`${baseUrl}/object_info`);
    let status: number;
    let value: unknown;
    if (fetcher === nativeFetch) {
        const response = await requestPinnedObjectInfo(objectInfoUrl, addresses[0]);
        status = response.status;
        try {
            value = JSON.parse(response.body) as unknown;
        } catch {
            value = undefined;
        }
    } else {
        let response: Response;
        try {
            response = await fetcher(objectInfoUrl.toString(), {
                signal: AbortSignal.timeout(10_000),
                redirect: 'manual',
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`无法连接 ComfyUI：${message}`);
        }
        status = response.status;
        value = await response.json().catch(() => undefined) as unknown;
    }
    if (status >= 300 && status < 400) {
        throw new Error('ComfyUI /object_info 不允许重定向');
    }
    if (status < 200 || status >= 300) {
        throw new Error(`ComfyUI /object_info 请求失败（HTTP ${status}）`);
    }
    if (!isRecord(value)) throw new Error('ComfyUI /object_info 返回了无效数据');
    return value as ComfyObjectInfo;
}

export async function checkComfyWorkflowCompatibility(
    value: string,
    workflow: ComfyApiWorkflow,
    fetcher: typeof fetch = fetch,
    resolver: ComfyDnsResolver = defaultDnsResolver,
    safeTarget?: SafeHttpTarget,
    options: { skipTemplateVariableValues?: boolean } = {}
): Promise<ComfyCompatibilityResult> {
    const baseUrl = normalizeComfyUiBaseUrl(value);
    if (safeTarget && new URL(baseUrl).origin !== safeTarget.origin) {
        throw new Error('ComfyUI 地址与已检查地址不一致');
    }
    const addresses = safeTarget
        ? [safeTarget.address]
        : await resolveSafeAddresses(baseUrl, resolver);
    const objectInfo = await fetchObjectInfo(baseUrl, addresses, fetcher);
    const missingNodeTypes = new Set<string>();
    const missingRequiredInputs: ComfyIncompatibleInput[] = [];
    const incompatibleInputs: ComfyIncompatibleInput[] = [];

    for (const [nodeId, node] of Object.entries(workflow)) {
        const nodeInfo = Object.hasOwn(objectInfo, node.class_type)
            ? objectInfo[node.class_type]
            : undefined;
        if (!isRecord(nodeInfo)) {
            missingNodeTypes.add(node.class_type);
            continue;
        }
        const typedNodeInfo = nodeInfo as ComfyObjectInfoNode;
        const descriptors = {
            ...typedNodeInfo.input?.required,
            ...typedNodeInfo.input?.optional,
            ...typedNodeInfo.input?.hidden,
        };
        const allowedInputs = new Set(Object.keys(descriptors));
        for (const input of Object.keys(typedNodeInfo.input?.required ?? {})) {
            if (!Object.hasOwn(node.inputs, input)) {
                missingRequiredInputs.push({ nodeId, classType: node.class_type, input });
            }
        }
        for (const input of Object.keys(node.inputs)) {
            if (!allowedInputs.has(input)) {
                incompatibleInputs.push({ nodeId, classType: node.class_type, input });
                continue;
            }
            const inputValue = node.inputs[input];
            const isTemplateValue = options.skipTemplateVariableValues
                && typeof inputValue === 'string'
                && /\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(inputValue);
            const reason = isTemplateValue
                ? undefined
                : recognizableInputIssue(descriptors[input], inputValue);
            if (reason) {
                incompatibleInputs.push({ nodeId, classType: node.class_type, input, reason });
            }
        }
    }

    const missing = [...missingNodeTypes].sort();
    return {
        ok: missing.length === 0
            && missingRequiredInputs.length === 0
            && incompatibleInputs.length === 0,
        baseUrl,
        nodeTypeCount: Object.keys(objectInfo).length,
        missingNodeTypes: missing,
        missingRequiredInputs,
        incompatibleInputs,
    };
}

/** 管理器在线检查：校验节点和输入名称，但把尚未渲染的模板变量留到任务预检。 */
export function checkComfyWorkflowTemplateCompatibility(
    value: string,
    workflow: ComfyApiWorkflow,
    fetcher: typeof fetch = fetch,
    resolver: ComfyDnsResolver = defaultDnsResolver,
    safeTarget?: SafeHttpTarget
): Promise<ComfyCompatibilityResult> {
    return checkComfyWorkflowCompatibility(
        value,
        workflow,
        fetcher,
        resolver,
        safeTarget,
        { skipTemplateVariableValues: true }
    );
}

function isNodeConnection(value: unknown): boolean {
    return Array.isArray(value)
        && value.length === 2
        && typeof value[0] === 'string'
        && Number.isInteger(value[1]);
}

function recognizableInputIssue(descriptor: unknown, value: unknown): string | undefined {
    if (isNodeConnection(value) || !Array.isArray(descriptor) || descriptor.length === 0) {
        return undefined;
    }
    const declaredType = descriptor[0];
    const config = isRecord(descriptor[1]) ? descriptor[1] : {};
    const options = Array.isArray(declaredType)
        ? declaredType
        : declaredType === 'COMBO' && Array.isArray(config.options) ? config.options : undefined;
    if (options) {
        return options.some((option) => Object.is(option, value))
            ? undefined
            : '必须是已声明的选项';
    }
    if (declaredType === 'INT') {
        if (typeof value !== 'number' || !Number.isInteger(value)) return '必须是整数';
    } else if (declaredType === 'FLOAT') {
        if (typeof value !== 'number' || !Number.isFinite(value)) return '必须是数值';
    } else if (declaredType === 'STRING') {
        if (typeof value !== 'string') return '必须是字符串';
    } else if (declaredType === 'BOOLEAN') {
        if (typeof value !== 'boolean') return '必须是布尔值';
    } else {
        return undefined;
    }
    if (typeof value === 'number') {
        if (typeof config.min === 'number' && value < config.min) return `不能小于 ${config.min}`;
        if (typeof config.max === 'number' && value > config.max) return `不能大于 ${config.max}`;
        if (typeof config.step === 'number' && config.step > 0) {
            const base = typeof config.min === 'number' ? config.min : 0;
            const steps = (value - base) / config.step;
            if (Math.abs(steps - Math.round(steps)) > 1e-9) {
                return `必须符合步进 ${config.step}`;
            }
        }
    }
    return undefined;
}
