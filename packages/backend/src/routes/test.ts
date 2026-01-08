import { Router } from 'express';
import { z } from 'zod';
import { testQueue } from '../queue/queue.js';
import { TestPrompt } from '@quality-pilot/shared';

const router = Router();

const testPromptSchema = z.object({
  prompt: z.string().min(1),
  url: z.string().url(),
  credentials: z.record(z.string()).optional(),
  testData: z.record(z.any()).optional(),
  options: z.object({
    browser: z.enum(['chromium', 'firefox', 'webkit']).optional(),
    headless: z.boolean().optional(),
    timeout: z.number().optional(),
    viewport: z.object({
      width: z.number(),
      height: z.number(),
    }).optional(),
  }).optional(),
});

router.post('/run', async (req, res) => {
  try {
    const validated = testPromptSchema.parse(req.body);
    const testPrompt: TestPrompt = validated;

    // Generate unique test ID
    const testId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Add to queue
    await testQueue.add('execute-test', {
      testId,
      ...testPrompt,
    }, {
      jobId: testId,
    });

    res.json({
      success: true,
      testId,
      message: 'Test queued for execution',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
      return;
    }

    console.error('Error queueing test:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to queue test',
    });
  }
});

router.get('/status/:testId', async (req, res) => {
  try {
    const { testId } = req.params;
    const job = await testQueue.getJob(testId);

    if (!job) {
      res.status(404).json({
        success: false,
        error: 'Test not found',
      });
      return;
    }

    const state = await job.getState();
    const progress = job.progress;

    res.json({
      success: true,
      testId,
      status: state,
      progress,
    });
  } catch (error) {
    console.error('Error getting test status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get test status',
    });
  }
});

export { router as testRouter };
