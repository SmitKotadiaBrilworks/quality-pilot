'use client';

import { TestExecution, TestStep } from '@quality-pilot/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react';

interface ExecutionViewProps {
  execution: TestExecution | null;
}

export function ExecutionView({ execution }: ExecutionViewProps) {
  if (!execution) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Execution View</CardTitle>
          <CardDescription>Test execution will appear here</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-12">
            No test running. Start a test to see live execution.
          </div>
        </CardContent>
      </Card>
    );
  }

  const getStatusIcon = (status: TestStep['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'running':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      default:
        return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: TestExecution['status']) => {
    const variants: Record<TestExecution['status'], string> = {
      queued: 'bg-gray-500',
      running: 'bg-blue-500',
      completed: 'bg-green-500',
      failed: 'bg-red-500',
      cancelled: 'bg-yellow-500',
    };
    return variants[status] || 'bg-gray-500';
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Test Execution</CardTitle>
            <CardDescription>{execution.prompt}</CardDescription>
          </div>
          <Badge className={getStatusBadge(execution.status)}>
            {execution.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Latest Screenshot */}
        {execution.screenshots.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <img
              src={`data:image/png;base64,${execution.screenshots[execution.screenshots.length - 1]}`}
              alt="Latest screenshot"
              className="w-full"
            />
          </div>
        )}

        {/* Steps */}
        <div className="space-y-2">
          <h3 className="font-semibold">Steps</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {execution.steps.map((step, index) => (
              <div
                key={step.id}
                className="border rounded-lg p-3 space-y-1"
              >
                <div className="flex items-center gap-2">
                  {getStatusIcon(step.status)}
                  <span className="font-medium">
                    Step {index + 1}: {step.action}
                  </span>
                </div>
                {step.target && (
                  <div className="text-sm text-muted-foreground ml-6">
                    Target: {step.target}
                  </div>
                )}
                {step.value && (
                  <div className="text-sm text-muted-foreground ml-6">
                    Value: {step.value.replace(/./g, '*')}
                  </div>
                )}
                {step.assertion && (
                  <div className="text-sm ml-6">
                    <span className={step.assertion.passed ? 'text-green-600' : 'text-red-600'}>
                      Assertion: {step.assertion.type} - {step.assertion.passed ? '✓ Passed' : '✗ Failed'}
                    </span>
                  </div>
                )}
                {step.error && (
                  <div className="text-sm text-red-600 ml-6">
                    Error: {step.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Error Message */}
        {execution.error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-800">
            <strong>Error:</strong> {execution.error}
          </div>
        )}

        {/* Timing */}
        {execution.endTime && (
          <div className="text-sm text-muted-foreground">
            Duration: {((execution.endTime - execution.startTime) / 1000).toFixed(2)}s
          </div>
        )}
      </CardContent>
    </Card>
  );
}
