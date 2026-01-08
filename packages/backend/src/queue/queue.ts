import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { executeTest } from '../executor/testExecutor.js';
import { broadcastToClients } from '../websocket/handler.js';
import { WSMessage } from '@quality-pilot/shared';

const connection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
});

export const testQueue = new Queue('test-execution', { connection });

let worker: Worker | null = null;

export async function initializeQueue() {
  worker = new Worker(
    'test-execution',
    async (job: Job) => {
      const { testId, ...testPrompt } = job.data;

      // Notify clients that test started
      broadcastToClients({
        type: 'test_started',
        testId,
        data: { prompt: testPrompt.prompt },
      });

      try {
        // Execute the test
        await executeTest(testId, testPrompt, (message) => {
          broadcastToClients({
            type: message.type,
            testId,
            data: message.data,
          });
        });

        // Notify completion
        broadcastToClients({
          type: 'test_completed',
          testId,
          data: { timestamp: Date.now() },
        });
      } catch (error: any) {
        console.error(`Test ${testId} failed:`, error);

        broadcastToClients({
          type: 'test_failed',
          testId,
          data: {
            error: error.message || 'Unknown error',
            timestamp: Date.now(),
          },
        });

        throw error;
      }
    },
    {
      connection,
      concurrency: 3, // Run up to 3 tests concurrently
      removeOnComplete: {
        age: 3600, // Keep completed jobs for 1 hour
        count: 100, // Keep last 100 jobs
      },
      removeOnFail: {
        age: 86400, // Keep failed jobs for 24 hours
      },
    }
  );

  worker.on('completed', (job) => {
    console.log(`✅ Test ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ Test ${job?.id} failed:`, err);
  });

  console.log('📋 Test queue initialized');
}
