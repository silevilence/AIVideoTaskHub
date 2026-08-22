import type { ComfyTaskSnapshotView } from '../api';

function displayValue(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value === undefined) return '—';
    return JSON.stringify(value);
}

export function ComfyTaskSnapshotDetails({ snapshot }: { snapshot: ComfyTaskSnapshotView }) {
    return (
        <section
            aria-label="ComfyUI 任务快照"
            className="space-y-3 rounded-lg border border-primary/20 bg-primary/[0.03] p-3"
        >
            <p className="text-xs font-semibold text-primary">ComfyUI 工作流快照</p>
            <dl className="space-y-2 text-sm">
                <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">模板</dt>
                    <dd className="text-right font-medium">{snapshot.templateName}</dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">实际地址</dt>
                    <dd className="break-all text-right font-mono text-xs">{snapshot.baseUrl}</dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">主输出</dt>
                    <dd className="font-mono text-xs">
                        {snapshot.primaryOutput.nodeId} · {snapshot.primaryOutput.field}
                        [{snapshot.primaryOutput.index}]
                    </dd>
                </div>
                {snapshot.variables.map((variable) => (
                    <div key={variable.key} className="flex items-start justify-between gap-4">
                        <dt className="text-muted-foreground">{variable.label}</dt>
                        <dd className="max-w-[65%] break-words text-right font-medium">
                            {displayValue(variable.value)}
                        </dd>
                    </div>
                ))}
            </dl>
            {snapshot.images.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                    {snapshot.images.map((image, index) => (
                        <figure key={`${image.variableKey}-${index}`} className="space-y-1">
                            <img
                                src={image.source}
                                alt={`${image.variableKey} 图片预览`}
                                className="aspect-square w-full rounded-md border border-border object-cover"
                            />
                            <figcaption className="truncate text-center text-[10px] text-muted-foreground">
                                {image.variableKey}
                            </figcaption>
                        </figure>
                    ))}
                </div>
            )}
        </section>
    );
}
