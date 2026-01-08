# QualityPilot Setup Guide

## Prerequisites

- Node.js 18+ 
- Docker & Docker Compose
- Redis (or use Docker Compose)
- Google Gemini API Key

## Installation Steps

### 1. Install Dependencies

```bash
# Install root dependencies
npm install

# Install workspace dependencies
npm install --workspaces
```

### 2. Set Up Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit `.env` and add your configuration:

```env
GEMINI_API_KEY=your_gemini_api_key_here
PORT=3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:3001
REDIS_HOST=localhost
REDIS_PORT=6379
ENCRYPTION_KEY=your_32_character_encryption_key_here
```

**Important**: Generate a secure 32-character encryption key for `ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

### 3. Start Redis

```bash
docker-compose up -d redis
```

### 4. Install Playwright Browsers

```bash
cd packages/backend
npx playwright install chromium
```

### 5. Build Shared Package

```bash
cd packages/shared
npm run build
```

### 6. Start Development Servers

From the root directory:

```bash
# Start both frontend and backend
npm run dev
```

Or start them separately:

**Terminal 1 - Backend:**
```bash
cd packages/backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd packages/frontend
npm run dev
```

### 7. Access the Application

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- WebSocket: ws://localhost:3001

## Usage

1. **Open the dashboard** at http://localhost:3000
2. **Enter the application URL** you want to test
3. **Describe your test** in natural language (e.g., "Login with email and password, then update profile name")
4. **Add credentials** (optional, securely encrypted)
5. **Run the test** and watch live execution

## Project Structure

```
quality-pilot/
├── packages/
│   ├── frontend/          # Next.js dashboard
│   │   ├── src/
│   │   │   ├── app/       # Next.js app router
│   │   │   └── components/ # React components
│   ├── backend/           # Node.js orchestrator
│   │   ├── src/
│   │   │   ├── ai/        # Gemini AI integration
│   │   │   ├── executor/  # Playwright test executor
│   │   │   ├── queue/     # BullMQ queue
│   │   │   ├── routes/    # API routes
│   │   │   └── websocket/ # WebSocket handler
│   └── shared/            # Shared TypeScript types
├── docker-compose.yml     # Redis setup
└── Dockerfile.browser     # Browser container (future)
```

## Troubleshooting

### Redis Connection Error

Make sure Redis is running:
```bash
docker-compose ps
docker-compose logs redis
```

### Playwright Browser Not Found

Install browsers:
```bash
cd packages/backend
npx playwright install
```

### Gemini API Errors

- Verify your API key is correct
- Check API quota/limits
- Ensure internet connection

### WebSocket Connection Failed

- Check backend is running on port 3001
- Verify `NEXT_PUBLIC_WS_URL` in `.env`
- Check browser console for errors

## Production Deployment

For production, consider:

1. **Environment Variables**: Use secure secret management
2. **Docker Containers**: Use Dockerfile.browser for isolated execution
3. **VNC Streaming**: Implement VNC for live browser view
4. **Database**: Add PostgreSQL for test history
5. **Authentication**: Add user authentication
6. **Scaling**: Use Kubernetes for horizontal scaling

## Next Steps

- [ ] Add VNC streaming for live browser view
- [ ] Implement test history and reports
- [ ] Add mobile app testing support
- [ ] Create Docker containers for isolated execution
- [ ] Add user authentication
- [ ] Implement test scheduling
