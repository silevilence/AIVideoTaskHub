import type { LookupAddress } from 'node:dns';
import { lookup as nodeLookup } from 'node:dns/promises';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { isIP } from 'node:net';
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

function assertSafeTarget(value: string): void {
    if (isCloudMetadataTarget(value)) {
        throw new Error('ComfyUI 地址不允许访问云元数据服务');
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
    resolver: ComfyDnsResolver
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
    for (const address of addresses) assertSafeTarget(address.address);
    return addresses;
}

function requestPinnedObjectInfo(
    url: URL,
    address: LookupAddress
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const transport = url.protocol === 'https:' ? httpsGet : httpGet;
        const request = transport(url, {
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
                byteLength += chunk.length;
                if (byteLength > 50 * 1024 * 1024) {
                    request.destroy(new Error('ComfyUI /object_info 响应过大'));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => resolve({
                status: response.statusCode ?? 0,
                body: Buffer.concat(chunks).toString('utf8'),
            }));
        });
        request.on('error', (error) => reject(new Error(`无法连接 ComfyUI：${error.message}`)));
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
    resolver: ComfyDnsResolver = defaultDnsResolver
): Promise<ComfyCompatibilityResult> {
    const baseUrl = normalizeComfyUiBaseUrl(value);
    const addresses = await resolveSafeAddresses(baseUrl, resolver);
    const objectInfo = await fetchObjectInfo(baseUrl, addresses, fetcher);
    const missingNodeTypes = new Set<string>();
    const missingRequiredInputs: ComfyIncompatibleInput[] = [];
    const incompatibleInputs: ComfyIncompatibleInput[] = [];

    for (const [nodeId, node] of Object.entries(workflow)) {
        const nodeInfo = objectInfo[node.class_type];
        if (!nodeInfo) {
            missingNodeTypes.add(node.class_type);
            continue;
        }
        const allowedInputs = new Set([
            ...Object.keys(nodeInfo.input?.required ?? {}),
            ...Object.keys(nodeInfo.input?.optional ?? {}),
            ...Object.keys(nodeInfo.input?.hidden ?? {}),
        ]);
        for (const input of Object.keys(nodeInfo.input?.required ?? {})) {
            if (!Object.hasOwn(node.inputs, input)) {
                missingRequiredInputs.push({ nodeId, classType: node.class_type, input });
            }
        }
        for (const input of Object.keys(node.inputs)) {
            if (!allowedInputs.has(input)) {
                incompatibleInputs.push({ nodeId, classType: node.class_type, input });
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
