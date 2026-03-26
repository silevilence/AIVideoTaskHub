import { useState } from 'react';
import { CreateTaskForm } from './components/CreateTaskForm';
import { TaskList } from './components/TaskList';
import { SettingsPanel } from './components/SettingsPanel';

function App() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          AI Video Task Hub
        </h1>

        <SettingsPanel />

        <CreateTaskForm onCreated={() => setRefreshKey((k) => k + 1)} />

        <div className="mt-6">
          <h2 className="text-sm font-medium text-gray-500 mb-3">任务列表</h2>
          <TaskList refreshKey={refreshKey} />
        </div>
      </div>
    </div>
  );
}

export default App;
