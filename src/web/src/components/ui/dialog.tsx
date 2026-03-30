import { type ReactNode } from 'react';
import { Button } from './button';
import { cn } from '../../lib/utils';
import { AlertTriangle, Info, X } from 'lucide-react';

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    description?: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'default' | 'destructive';
    onConfirm: () => void;
    onCancel: () => void;
    icon?: ReactNode;
}

export function ConfirmDialog({
    open,
    title,
    description,
    confirmText = '确定',
    cancelText = '取消',
    variant = 'default',
    onConfirm,
    onCancel,
    icon,
}: ConfirmDialogProps) {
    if (!open) return null;

    const defaultIcon = variant === 'destructive'
        ? <AlertTriangle className="h-5 w-5 text-destructive" />
        : <Info className="h-5 w-5 text-primary" />;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
            onClick={onCancel}
        >
            <div
                className="relative w-full max-w-sm mx-4 rounded-xl border border-border bg-card shadow-2xl animate-in fade-in-0 zoom-in-95"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-6 pt-6 pb-2">
                    <div className="flex items-start gap-3">
                        <div className="shrink-0 mt-0.5">
                            {icon ?? defaultIcon}
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="text-base font-semibold leading-tight">
                                {title}
                            </h3>
                            {description && (
                                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                                    {description}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex items-center justify-end gap-2 px-6 py-4">
                    <Button variant="outline" size="sm" onClick={onCancel}>
                        {cancelText}
                    </Button>
                    <Button
                        variant={variant === 'destructive' ? 'destructive' : 'default'}
                        size="sm"
                        onClick={onConfirm}
                    >
                        {confirmText}
                    </Button>
                </div>
            </div>
        </div>
    );
}

interface AlertDialogProps {
    open: boolean;
    title: string;
    description?: string;
    confirmText?: string;
    variant?: 'default' | 'destructive';
    onClose: () => void;
    icon?: ReactNode;
}

export function AlertDialog({
    open,
    title,
    description,
    confirmText = '知道了',
    variant = 'default',
    onClose,
    icon,
}: AlertDialogProps) {
    if (!open) return null;

    const defaultIcon = variant === 'destructive'
        ? <AlertTriangle className="h-5 w-5 text-destructive" />
        : <Info className="h-5 w-5 text-primary" />;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="relative w-full max-w-sm mx-4 rounded-xl border border-border bg-card shadow-2xl animate-in fade-in-0 zoom-in-95"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-6 pt-6 pb-2">
                    <div className="flex items-start gap-3">
                        <div className="shrink-0 mt-0.5">
                            {icon ?? defaultIcon}
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="text-base font-semibold leading-tight">
                                {title}
                            </h3>
                            {description && (
                                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                                    {description}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex items-center justify-end px-6 py-4">
                    <Button
                        variant={variant === 'destructive' ? 'destructive' : 'default'}
                        size="sm"
                        onClick={onClose}
                    >
                        {confirmText}
                    </Button>
                </div>
            </div>
        </div>
    );
}
