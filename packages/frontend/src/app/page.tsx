'use client';

import { useState, useEffect, useRef } from 'react';
import { TestExecution, TestStep, WSMessage } from '@quality-pilot/shared';
import { TestRunner } from '@/components/TestRunner';
import { ExecutionView } from '@/components/ExecutionView';
import { LogsPanel } from '@/components/LogsPanel';

export default function Home() {
  const [testExecution, setTestExecution] = useState<TestExecution | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Connect to WebSocket
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('Connected to WebSocket');
    };

    ws.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);

        if (message.type === 'test_started') {
          setTestExecution({
            id: message.testId,
            prompt: message.data.prompt,
            status: 'running',
            steps: [],
            startTime: Date.now(),
            screenshots: [],
          });
          setLogs([`Test started: ${message.data.prompt}`]);
        } else if (message.type === 'step_started') {
          setTestExecution((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              steps: [...prev.steps, message.data.step],
            };
          });
        } else if (message.type === 'step_completed' || message.type === 'step_failed') {
          setTestExecution((prev) => {
            if (!prev) return null;
            const updatedSteps = prev.steps.map((step) =>
              step.id === message.data.step.id ? message.data.step : step
            );
            return {
              ...prev,
              steps: updatedSteps,
            };
          });
        } else if (message.type === 'screenshot') {
          setTestExecution((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              screenshots: [...prev.screenshots, message.data.screenshot],
            };
          });
        } else if (message.type === 'log') {
          setLogs((prev) => [...prev, message.data.message]);
        } else if (message.type === 'test_completed') {
          setTestExecution((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              status: 'completed',
              endTime: Date.now(),
            };
          });
          setLogs((prev) => [...prev, '✅ Test completed']);
        } else if (message.type === 'test_failed') {
          setTestExecution((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              status: 'failed',
              endTime: Date.now(),
              error: message.data.error,
            };
          });
          setLogs((prev) => [...prev, `❌ Test failed: ${message.data.error}`]);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
    };

    wsRef.current = ws;

    return () => {
      ws.close();
    };
  }, []);

  const handleTestSubmit = async (prompt: string, url: string, credentials?: Record<string, string>) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const response = await fetch(`${apiUrl}/api/test/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          url,
          credentials,
        }),
      });

      const data = await response.json();
      if (data.success) {
        // Subscribe to test updates
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'subscribe',
            testId: data.testId,
          }));
        }
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error('Error submitting test:', error);
      alert('Failed to submit test');
    }
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-4xl font-bold mb-2">QualityPilot</h1>
          <p className="text-muted-foreground">AI Test Agent Platform</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Test Runner */}
          <div className="space-y-6">
            <TestRunner onSubmit={handleTestSubmit} />
            <LogsPanel logs={logs} />
          </div>

          {/* Right: Execution View */}
          <div>
            <ExecutionView execution={testExecution} />
          </div>
        </div>
      </div>
    </main>
  );
}
