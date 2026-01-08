'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

interface LogsPanelProps {
  logs: string[];
}

export function LogsPanel({ logs }: LogsPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Execution Logs</CardTitle>
        <CardDescription>Real-time test execution logs</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-64 w-full">
          <div className="space-y-1 font-mono text-sm">
            {logs.length === 0 ? (
              <div className="text-muted-foreground">No logs yet...</div>
            ) : (
              logs.map((log, index) => (
                <div key={index} className="py-1">
                  <span className="text-muted-foreground">[{new Date().toLocaleTimeString()}]</span>{' '}
                  {log}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
