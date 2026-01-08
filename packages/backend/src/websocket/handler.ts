import { WebSocket } from 'ws';
import { WSMessage } from '@quality-pilot/shared';

// Store active WebSocket connections
const clients = new Map<string, WebSocket>();

export function wsHandler(ws: WebSocket) {
  const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  clients.set(clientId, ws);

  console.log(`📡 WebSocket client connected: ${clientId}`);

  ws.on('message', (message: Buffer) => {
    try {
      const data = JSON.parse(message.toString());
      
      // Handle client messages (e.g., subscribe to test)
      if (data.type === 'subscribe') {
        // Store subscription info if needed
        console.log(`Client ${clientId} subscribed to test: ${data.testId}`);
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    clients.delete(clientId);
    console.log(`📡 WebSocket client disconnected: ${clientId}`);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for client ${clientId}:`, error);
    clients.delete(clientId);
  });

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    clientId,
  }));
}

/**
 * Broadcast a message to all connected clients
 */
export function broadcastToClients(message: WSMessage) {
  const messageStr = JSON.stringify(message);
  let sentCount = 0;

  clients.forEach((ws, clientId) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(messageStr);
        sentCount++;
      } catch (error) {
        console.error(`Error sending message to client ${clientId}:`, error);
        clients.delete(clientId);
      }
    }
  });

  if (sentCount > 0) {
    console.log(`📤 Broadcasted ${message.type} to ${sentCount} clients`);
  }
}

/**
 * Send message to specific client (if we track test subscriptions)
 */
export function sendToClient(clientId: string, message: WSMessage) {
  const ws = clients.get(clientId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}
