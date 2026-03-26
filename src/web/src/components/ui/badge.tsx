import { type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const variantStyles = {
    default: 'bg-primary/15 text-primary border-primary/20',
    secondary: 'bg-secondary text-secondary-foreground border-secondary',
    destructive: 'bg-destructive/15 text-destructive border-destructive/20',
    warning: 'bg-amber-500/15 text-amber-600 border-amber-500/20 dark:text-amber-400',
    success: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/20 dark:text-emerald-400',
};

interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
    variant?: keyof typeof variantStyles;
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
    return (
        <div
            className={cn(
                'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                variantStyles[variant],
                className,
            )}
            {...props}
        />
    );
}

export { Badge };
export type { BadgeProps };
