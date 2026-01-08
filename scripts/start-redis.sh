#!/bin/bash

# Script to start Redis using available Docker Compose command

if docker compose version &> /dev/null; then
    echo "🐳 Starting Redis with 'docker compose'..."
    docker compose up -d redis
elif command -v docker-compose &> /dev/null; then
    echo "🐳 Starting Redis with 'docker-compose'..."
    docker-compose up -d redis
else
    echo "❌ Docker Compose not found!"
    echo ""
    echo "Install options:"
    echo "1. Install docker-compose: sudo apt install docker-compose"
    echo "2. Or use system Redis: sudo systemctl start redis"
    echo "3. Or install Docker Desktop which includes compose"
    exit 1
fi

echo "✅ Redis should be running. Check with: docker ps"
