// Test execution types
export interface TestPrompt {
  prompt: string;
  credentials?: Record<string, string>;
  testData?: Record<string, any>;
  url: string;
  options?: TestOptions;
}

export interface TestOptions {
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  timeout?: number;
  viewport?: {
    width: number;
    height: number;
  };
}

// AI-generated test steps
export interface TestStep {
  id: string;
  action: TestAction;
  target?: string;
  value?: string;
  assertion?: Assertion;
  timestamp: number;
  status: StepStatus;
  error?: string;
  screenshot?: string;
}

export type TestAction =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'select'
  | 'wait'
  | 'assert'
  | 'screenshot'
  | 'scroll'
  | 'hover'
  | 'keyboard';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface Assertion {
  type: 'text' | 'element' | 'url' | 'title' | 'count';
  expected: string | number;
  actual?: string | number;
  passed?: boolean;
}

// Test execution state
export interface TestExecution {
  id: string;
  prompt: string;
  status: ExecutionStatus;
  steps: TestStep[];
  startTime: number;
  endTime?: number;
  error?: string;
  screenshots: string[];
  video?: string;
}

export type ExecutionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

// WebSocket messages
export interface WSMessage {
  type: WSMessageType;
  testId: string;
  data: any;
}

export type WSMessageType =
  | 'test_started'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'test_completed'
  | 'test_failed'
  | 'log'
  | 'screenshot'
  | 'error';

// Credential management
export interface Credential {
  id: string;
  name: string;
  fields: Record<string, string>; // Encrypted
  createdAt: number;
  updatedAt: number;
}
