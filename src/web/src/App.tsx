import { useState } from 'react';
import { CreateTaskForm } from './components/CreateTaskForm';
import { TaskList } from './components/TaskList';
import { RecycleBin } from './components/RecycleBin';
import { SettingsPanel } from './components/SettingsPanel';
import { ThemeToggle } from './components/ThemeToggle';
import { useTheme } from './hooks/use-theme';
import { cn } from './lib/utils';
import { Sparkles, ListTodo, Settings, Trash2 } from 'lucide-react';
import appIcon from './assets/icons/app-icon.svg';
import type { ApplyParams } from './api';

type Tab = 'create' | 'tasks' | 'trash' | 'settings';

const tabs: { id: Tab; label: string; icon: typeof Sparkles }[] = [
  { id: 'create', label: '创建任务', icon: Sparkles },
  { id: 'tasks', label: '任务状态', icon: ListTodo },
  { id: 'trash', label: '回收站', icon: Trash2 },
  { id: 'settings', label: '设置', icon: Settings },
];

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('create');
  const [refreshKey, setRefreshKey] = useState(0);
  const [applyParams, setApplyParams] = useState<ApplyParams | null>(null);
  const { theme, setTheme } = useTheme();

  // 从任务列表或回收站套用参数
  const handleApplyParams = (params: ApplyParams) => {
    setApplyParams(params);
    setActiveTab('create');
  };

  // 创建表单确认收到参数后清空
  const handleApplyParamsConsumed = () => {
    setApplyParams(null);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header with Tabs */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={appIcon} alt="logo" className="h-6 w-6" />
            <h1 className="text-lg font-heading font-bold tracking-wider">
              AI Video Task Hub
            </h1>
          </div>
          <nav className="flex items-center gap-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors duration-200 cursor-pointer whitespace-nowrap',
                    activeTab === tab.id
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
            <div className="ml-2 border-l border-border pl-2">
              <ThemeToggle theme={theme} setTheme={setTheme} />
            </div>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {activeTab === 'create' && (
          <CreateTaskForm
            onCreated={() => {
              setRefreshKey((k) => k + 1);
              setActiveTab('tasks');
            }}
            applyParams={applyParams}
            onApplyParamsConsumed={handleApplyParamsConsumed}
          />
        )}
        {activeTab === 'tasks' && <TaskList refreshKey={refreshKey} onApplyParams={handleApplyParams} />}
        {activeTab === 'trash' && <RecycleBin onApplyParams={handleApplyParams} />}
        {activeTab === 'settings' && <SettingsPanel />}
      </main>
    </div>
  );
}

export default App;
