# QualityPilot Architecture

## System Overview

QualityPilot is an AI-powered test automation platform that converts natural language prompts into executable UI tests. The system uses a microservices architecture with clear separation between frontend, backend, and shared components.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Web Dashboard (Next.js)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Test Runner  │  │ Execution    │  │ Logs Panel  │     │
│  │   Component  │  │    View      │  │             │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└───────────────────────────┬─────────────────────────────────┘
                            │ WebSocket (Real-time updates)
                            │ HTTP (API calls)
┌───────────────────────────▼─────────────────────────────────┐
│              Backend Orchestrator (Node.js)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Express    │  │  WebSocket   │  │   BullMQ     │     │
│  │     API      │  │    Server    │  │    Queue     │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Gemini     │  │  Test        │  │  Security   │     │
│  │     AI       │  │  Executor    │  │  (Encrypt)   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│            Browser Engine (Playwright)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Chromium    │  │   Firefox    │  │   WebKit     │     │
│  │   Browser    │  │   Browser    │  │   Browser    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                    Redis (Queue & Cache)                      │
└─────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Frontend (Next.js Dashboard)

**Technology**: Next.js 14 (App Router), React, TypeScript, Tailwind CSS

**Responsibilities**:
- User interface for creating tests
- Real-time execution visualization
- Step-by-step test progress
- Screenshot display
- Logs and error reporting

**Key Components**:
- `TestRunner`: Form for entering test prompts and credentials
- `ExecutionView`: Live test execution display with steps and screenshots
- `LogsPanel`: Real-time log streaming

**Communication**:
- WebSocket connection for real-time updates
- REST API for test submission and status

### 2. Backend Orchestrator

**Technology**: Node.js, Express, TypeScript

**Responsibilities**:
- API endpoints for test management
- WebSocket server for real-time communication
- Queue management (BullMQ)
- Test execution orchestration
- Credential encryption/decryption

**Key Modules**:

#### API Routes (`/api/test`)
- `POST /run`: Submit a new test
- `GET /status/:testId`: Get test execution status

#### WebSocket Handler
- Broadcasts test execution events
- Handles client subscriptions
- Real-time step updates

#### Queue System (BullMQ)
- Job queue for test execution
- Concurrency control (max 3 concurrent tests)
- Job persistence and retry logic

#### AI Agent (`geminiAgent.ts`)
- Converts natural language to structured steps
- Uses Google Gemini Pro model
- Handles credential injection

#### Test Executor (`testExecutor.ts`)
- Executes Playwright commands
- Manages browser lifecycle
- Captures screenshots and videos
- Performs assertions

### 3. Browser Engine (Playwright)

**Technology**: Playwright

**Capabilities**:
- Multi-browser support (Chromium, Firefox, WebKit)
- Mobile emulation
- Screenshot and video recording
- Network interception
- Headless and headed modes

**Execution Flow**:
1. Launch browser instance
2. Create browser context
3. Navigate to target URL
4. Execute AI-generated steps
5. Capture screenshots after each step
6. Perform assertions
7. Clean up resources

### 4. AI Layer (Google Gemini)

**Model**: Gemini Pro

**Process**:
1. **Input**: Natural language prompt + URL
2. **Processing**: AI generates structured JSON steps
3. **Output**: Array of test actions (navigate, click, fill, assert, etc.)

**Step Structure**:
```typescript
{
  action: 'click' | 'fill' | 'navigate' | 'assert' | ...
  target: string,      // Element selector or text
  value?: string,       // For fill actions
  assertion?: {         // For assert actions
    type: 'text' | 'url' | 'title' | 'element' | 'count',
    expected: string | number
  },
  description: string   // Human-readable description
}
```

### 5. Security Layer

**Encryption**: AES-256-GCM

**Features**:
- Credentials encrypted at rest
- Never exposed to LLM (only placeholders)
- Runtime decryption only
- Secure key management

**Flow**:
1. User enters credentials in UI
2. Credentials encrypted before storage
3. Placeholders ({{email}}, {{password}}) sent to AI
4. Credentials decrypted only during test execution
5. Never logged or exposed

### 6. Queue System (BullMQ + Redis)

**Purpose**: 
- Async test execution
- Concurrency control
- Job persistence
- Retry logic

**Configuration**:
- Max 3 concurrent tests
- Completed jobs kept for 1 hour
- Failed jobs kept for 24 hours

## Data Flow

### Test Execution Flow

1. **User submits test** via frontend
   - Prompt, URL, credentials entered
   - POST to `/api/test/run`

2. **Backend queues test**
   - Generate unique test ID
   - Add job to BullMQ queue
   - Return test ID to client

3. **Worker picks up job**
   - WebSocket: `test_started` event
   - Call AI agent to generate steps
   - WebSocket: `log` with step count

4. **Execute test steps**
   - Launch Playwright browser
   - For each step:
     - WebSocket: `step_started`
     - Execute Playwright command
     - Capture screenshot
     - WebSocket: `screenshot` + `step_completed`
   - Handle errors: `step_failed`

5. **Test completion**
   - WebSocket: `test_completed` or `test_failed`
   - Clean up browser resources
   - Store results (future: database)

### WebSocket Message Types

- `test_started`: Test execution began
- `step_started`: Step execution started
- `step_completed`: Step finished successfully
- `step_failed`: Step failed with error
- `test_completed`: All steps finished
- `test_failed`: Test execution failed
- `log`: General log message
- `screenshot`: Base64 encoded screenshot
- `error`: Error occurred

## Scalability Considerations

### Current Architecture
- Single backend instance
- Local Playwright execution
- In-memory WebSocket connections

### Production Enhancements

1. **Horizontal Scaling**
   - Multiple backend instances
   - Load balancer
   - Shared Redis for queue
   - WebSocket sticky sessions

2. **Isolated Execution**
   - Docker containers per test
   - Kubernetes pods
   - Resource limits
   - Auto-scaling

3. **VNC Streaming**
   - Browser in Docker with VNC
   - Stream to frontend
   - Real-time browser view

4. **Database**
   - PostgreSQL for test history
   - Test results storage
   - Analytics and reporting

5. **Caching**
   - Redis for frequently accessed data
   - Screenshot caching
   - Test step templates

## Security Considerations

1. **Credential Management**
   - Encryption at rest
   - Secure key storage (KMS in production)
   - No credential exposure to AI

2. **API Security**
   - Rate limiting
   - Authentication (future)
   - Input validation
   - CORS configuration

3. **Container Security**
   - Isolated execution environments
   - Resource limits
   - Network isolation
   - No persistent storage

4. **Data Privacy**
   - Encrypted test data
   - Secure WebSocket (WSS in production)
   - Audit logging

## Future Enhancements

- [ ] Mobile app testing (Appium integration)
- [ ] VNC streaming for live browser view
- [ ] Test scheduling and cron jobs
- [ ] Test history and reporting
- [ ] User authentication and authorization
- [ ] Team collaboration features
- [ ] CI/CD integration
- [ ] Test analytics and insights
- [ ] Custom assertion builders
- [ ] Test templates and libraries
