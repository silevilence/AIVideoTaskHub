import { useRef, useCallback, useMemo } from 'react';
import { cn } from '../../lib/utils';

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function highlightMarkdown(text: string): string {
    if (!text) return '';
    const escaped = escapeHtml(text);

    return escaped
        // 占位符: ${input}, ${lang}
        .replace(/\$\{(\w+)\}/g, '<span style="color:var(--primary);font-weight:600">${$1}</span>')
        // 标题: ### text
        .replace(/^(#{1,6}\s.*)$/gm, '<span style="color:var(--primary);font-weight:700">$1</span>')
        // 粗体: **text**
        .replace(/(\*\*)(.*?)\1/g, '<span style="font-weight:700">$1$2$1</span>')
        // 斜体: *text* (排除已处理的**)
        .replace(/(?<!\*)(\*)(?!\*)(.*?)(?<!\*)\1(?!\*)/g, '<span style="font-style:italic">$1$2$1</span>')
        // 行内代码: `text`
        .replace(/`([^`]+)`/g, '<span style="background:var(--accent);border-radius:2px;padding:0 2px">`$1`</span>')
        // 分隔线: ---
        .replace(/^---$/gm, '<span style="color:var(--muted-foreground)">---</span>')
        // 有序列表: 1. text
        .replace(/^(\d+\.\s)/gm, '<span style="color:var(--primary);opacity:0.6">$1</span>')
        // 无序列表: - text
        .replace(/^(\s*[-*]\s)/gm, '<span style="color:var(--primary);opacity:0.6">$1</span>');
}

/** Markdown 语法高亮编辑器（覆盖层方式） */
export function MarkdownEditor({ value, onChange, className, placeholder }: {
    value: string;
    onChange: (value: string) => void;
    className?: string;
    placeholder?: string;
}) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const highlightRef = useRef<HTMLPreElement>(null);

    const syncScroll = useCallback(() => {
        if (textareaRef.current && highlightRef.current) {
            highlightRef.current.scrollTop = textareaRef.current.scrollTop;
            highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
        }
    }, []);

    const highlighted = useMemo(() => highlightMarkdown(value), [value]);

    const placeholderHtml = placeholder ? `<span style="color:var(--muted-foreground)">${escapeHtml(placeholder)}</span>` : '';

    return (
        <div className={cn('relative', className)} style={{ minHeight: 'inherit' }}>
            <pre
                ref={highlightRef}
                className="absolute inset-0 overflow-auto m-0 p-3 font-mono text-xs whitespace-pre-wrap wrap-break-word pointer-events-none rounded-md border border-transparent"
                style={{ lineHeight: '1.5', fontFamily: 'inherit' }}
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: highlighted || placeholderHtml }}
            />
            <textarea
                ref={textareaRef}
                value={value}
                onChange={e => onChange(e.target.value)}
                onScroll={syncScroll}
                className="relative w-full h-full font-mono text-xs p-3 bg-transparent resize-none rounded-md border border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{
                    color: 'transparent',
                    caretColor: 'var(--foreground)',
                    lineHeight: '1.5',
                    minHeight: 'inherit',
                }}
                spellCheck={false}
            />
        </div>
    );
}
