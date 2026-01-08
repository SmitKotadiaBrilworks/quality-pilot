#!/bin/bash

# Script to fix Docker permissions

echo "🔧 Fixing Docker permissions..."

# Check if user is already in docker group
if groups | grep -q docker; then
    echo "✅ User is already in docker group"
    echo "   You may need to log out and log back in for changes to take effect"
    exit 0
fi

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo "Adding user to docker group..."
    # Get the actual username (not root)
    REAL_USER=${SUDO_USER:-$USER}
    usermod -aG docker "$REAL_USER"
    echo "✅ User $REAL_USER added to docker group"
    echo ""
    echo "⚠️  IMPORTANT: You must log out and log back in for this to take effect!"
    echo "   Or run: newgrp docker"
else
    echo "❌ This script needs sudo privileges"
    echo ""
    echo "Run with sudo:"
    echo "  sudo ./scripts/fix-docker-permissions.sh"
    echo ""
    echo "Or manually add yourself to docker group:"
    echo "  sudo usermod -aG docker $USER"
    echo "  newgrp docker  # or log out and back in"
    exit 1
fi
