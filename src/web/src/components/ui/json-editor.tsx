import { useCallback, useEffect, useMemo, useRef } from 'react';
import { cn } from '../../lib/utils';
import {
    highlightWorkflowJson,
    validateWorkflowJson,
    type WorkflowEditorDiagnostic,
} from '../../lib/comfy-workflow-editor';

interface JsonEditorProps {
    value: string;
    onChange: (value: string) => void;
    className?: string;
    onDiagnostics?: (diagnostics: WorkflowEditorDiagnostic[]) => void;
}

export function JsonEditor({ value, onChange, className, onDiagnostics }: JsonEditorProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const highlightRef = useRef<HTMLPreElement>(null);
    const gutterRef = useRef<HTMLPreElement>(null);
    const diagnostics = useMemo(() => validateWorkflowJson(value), [value]);
    const highlighted = useMemo(() => highlightWorkflowJson(value), [value]);
    const lineNumbers = useMemo(
        () => Array.from({ length: Math.max(1, value.split('\n').length) }, (_, index) => index + 1).join('\n'),
        [value]
    );

    const syncScroll = useCallback(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        if (highlightRef.current) {
            highlightRef.current.scrollTop = textarea.scrollTop;
            highlightRef.current.scrollLeft = textarea.scrollLeft;
        }
        if (gutterRef.current) gutterRef.current.scrollTop = textarea.scrollTop;
    }, []);

    useEffect(() => onDiagnostics?.(diagnostics), [diagnostics, onDiagnostics]);

    return (
        <div className={cn('json-editor-shell relative overflow-hidden rounded-xl border bg-[#101722]', className)}>
            <pre
                ref={gutterRef}
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-12 overflow-hidden border-r border-white/8 bg-black/20 px-3 py-4 text-right font-mono text-xs leading-6 text-slate-600 select-none"
            >
                {lineNumbers}
            </pre>
            <pre
                ref={highlightRef}
                aria-hidden="true"
                className="absolute inset-y-0 right-0 left-12 m-0 overflow-auto whitespace-pre p-4 font-mono text-xs leading-6 text-slate-300 pointer-events-none"
                dangerouslySetInnerHTML={{ __html: highlighted }}
            />
            <textarea
                ref={textareaRef}
                aria-label="ComfyUI API 工作流 JSON"
                aria-invalid={diagnostics.length > 0}
                aria-describedby="comfy-workflow-json-diagnostics"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onScroll={syncScroll}
                spellCheck={false}
                className="relative ml-12 h-full w-[calc(100%-3rem)] resize-none overflow-auto bg-transparent p-4 font-mono text-xs leading-6 text-transparent caret-emerald-300 outline-none selection:bg-emerald-400/25"
            />
        </div>
    );
}
