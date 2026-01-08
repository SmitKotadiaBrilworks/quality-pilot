#!/bin/bash

set -e

echo "🚀 Setting up QualityPilot..."

# Check Node.js version
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Check Docker
DOCKER_COMPOSE_CMD=""
if command -v docker &> /dev/null; then
    echo "✅ Docker is installed"
    # Check for docker compose (newer) or docker-compose (older)
    if docker compose version &> /dev/null; then
        DOCKER_COMPOSE_CMD="docker compose"
        echo "✅ Docker Compose (plugin) is available"
    elif command -v docker-compose &> /dev/null; then
        DOCKER_COMPOSE_CMD="docker-compose"
        echo "✅ Docker Compose (standalone) is available"
    else
        echo "⚠️  Docker Compose not found. You can:"
        echo "   - Install: sudo apt install docker-compose"
        echo "   - Or use: docker compose (if Docker 20.10+)"
        echo "   - Or install Redis separately"
    fi
else
    echo "⚠️  Docker is not installed. Redis will need to be installed separately."
    echo "   Install options:"
    echo "   - sudo snap install docker"
    echo "   - Or install Redis directly: sudo apt install redis-server"
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Install workspace dependencies
echo "📦 Installing workspace dependencies..."
npm install --workspaces

# Build shared package
echo "🔨 Building shared package..."
cd packages/shared
npm run build
cd ../..

# Install Playwright browsers
echo "🌐 Installing Playwright browsers..."
cd packages/backend
npx playwright install chromium
cd ../..

# Check for .env file
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating from .env.example..."
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "📝 Please edit .env and add your GEMINI_API_KEY and ENCRYPTION_KEY"
    else
        echo "❌ .env.example not found"
    fi
else
    echo "✅ .env file exists"
fi

# Generate encryption key if not set
if ! grep -q "ENCRYPTION_KEY=.*[a-zA-Z0-9]" .env 2>/dev/null; then
    echo "🔑 Generating encryption key..."
    ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")
    if grep -q "ENCRYPTION_KEY=" .env; then
        sed -i "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$ENCRYPTION_KEY/" .env
    else
        echo "ENCRYPTION_KEY=$ENCRYPTION_KEY" >> .env
    fi
    echo "✅ Encryption key generated"
fi

# Try to start Redis if Docker Compose is available
if [ -n "$DOCKER_COMPOSE_CMD" ]; then
    echo ""
    echo "🐳 Starting Redis with Docker..."
    if $DOCKER_COMPOSE_CMD up -d redis 2>/dev/null; then
        echo "✅ Redis started successfully"
    else
        echo "⚠️  Failed to start Redis. You may need to:"
        echo "   - Install Docker Compose: sudo apt install docker-compose"
        echo "   - Or start Redis manually: sudo systemctl start redis"
    fi
else
    echo ""
    echo "⚠️  Skipping Redis startup (Docker Compose not available)"
    echo "   To start Redis manually:"
    echo "   - With Docker: docker-compose up -d redis (after installing docker-compose)"
    echo "   - Or system Redis: sudo systemctl start redis"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env and add your GEMINI_API_KEY"
if [ -z "$DOCKER_COMPOSE_CMD" ]; then
    echo "2. Start Redis (see instructions above)"
else
    echo "2. Redis should be running (check with: $DOCKER_COMPOSE_CMD ps)"
fi
echo "3. Run: npm run dev"
echo ""
