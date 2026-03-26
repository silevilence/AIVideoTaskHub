import { Sun, Moon, Monitor } from 'lucide-react';
import { Button } from './ui/button';
import type { Theme } from '../hooks/use-theme';

const nextTheme: Record<Theme, Theme> = {
    system: 'light',
    light: 'dark',
    dark: 'system',
};

const themeLabel: Record<Theme, string> = {
    system: '跟随系统',
    light: '日间模式',
    dark: '夜间模式',
};

const themeIcon: Record<Theme, typeof Sun> = {
    system: Monitor,
    light: Sun,
    dark: Moon,
};

export function ThemeToggle({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
    const Icon = themeIcon[theme];

    return (
        <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(nextTheme[theme])}
            title={themeLabel[theme]}
        >
            <Icon className="h-5 w-5" />
        </Button>
    );
}
