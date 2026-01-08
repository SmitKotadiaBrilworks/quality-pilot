# QualityPilot 🚀

**AI Test Agent Platform** - Agent-based UI automation for web and mobile applications.

## Overview

QualityPilot transforms test automation by using AI agents to understand natural language prompts and automatically execute UI tests. Instead of writing test scripts, you describe what you want to test, and QualityPilot handles the rest.

## Core Capabilities

- ✅ **Natural Language Testing** - Describe tests in plain English
- ✅ **Automatic UI Interaction** - Login, CRUD operations, form filling, navigation
- ✅ **Live Execution View** - Watch tests run in real-time
- ✅ **Multi-Browser Support** - Chromium, Firefox, WebKit via Playwright
- ✅ **Secure Credential Management** - Encrypted secrets, never exposed to LLM
- ✅ **Isolated Execution** - Each test runs in a Docker container

## Architecture

```
┌───────────────┐
│  Web Dashboard│  (Next.js)
│  (User UI)    │
└───────┬───────┘
        │ WebSocket (live steps)
┌───────▼───────┐
│ Orchestrator  │  (Node.js)
│ (Test Runner) │
└───────┬───────┘
        │
┌───────▼────────┐
│ Browser Engine │  (Playwright)
│  (Dockerized)  │
└───────┬────────┘
        │
┌───────▼────────┐
│ AI Agent Layer │  (Gemini)
│ Prompt → Steps │
└────────────────┘
```

## Tech Stack

- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS, ShadCN UI
- **Backend**: Node.js, Express, WebSocket
- **Automation**: Playwright
- **AI**: Google Gemini (via @google/generative-ai)
- **Queue**: BullMQ with Redis
- **Containerization**: Docker
- **Live View**: VNC Streaming

## Getting Started

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- Redis (or use Docker Compose)

### Installation

```bash
# Install dependencies
npm install

# Start Redis
docker-compose up -d redis

# Set up environment variables
cp .env.example .env

# Run development servers
npm run dev
```

### Environment Variables

See `.env.example` for required configuration.

## Project Structure

```
quality-pilot/
├── packages/
│   ├── frontend/          # Next.js dashboard
│   ├── backend/           # Node.js orchestrator
│   └── shared/            # Shared TypeScript types
├── docker/                # Docker configurations
└── docs/                  # Documentation
```

## Usage

1. **Create a Test**: Enter a natural language prompt describing your test
2. **Provide Credentials**: Securely store credentials (encrypted)
3. **Run Test**: Watch live execution with step-by-step logs
4. **Review Results**: Screenshots, videos, and detailed logs

## License

MIT
