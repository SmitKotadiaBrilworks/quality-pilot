import { chromium, firefox, webkit, Browser, Page, BrowserContext } from 'playwright';
import { generateTestSteps, injectCredentials } from '../ai/geminiAgent.js';
import { TestPrompt, TestStep, StepStatus, WSMessageType } from '@quality-pilot/shared';
import Docker from 'dockerode';

const docker = new Docker();

interface ExecutionCallback {
  (message: { type: WSMessageType; data: any }): void;
}

/**
 * Main test execution function
 */
export async function executeTest(
  testId: string,
  testPrompt: TestPrompt,
  callback: ExecutionCallback
): Promise<void> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let container: any = null;

  try {
    // Step 1: Generate test steps from AI
    callback({
      type: 'log',
      data: { message: '🤖 Generating test steps from AI...' },
    });

    let steps = await generateTestSteps(
      testPrompt.prompt,
      testPrompt.url,
      testPrompt.credentials
    );

    // Inject credentials into steps
    steps = injectCredentials(steps, testPrompt.credentials);

    callback({
      type: 'log',
      data: {
        message: `✅ Generated ${steps.length} test steps`,
        steps: steps.map((s, i) => ({ ...s, id: `step_${i}`, status: 'pending' })),
      },
    });

    // Step 2: Launch browser (in Docker container for isolation)
    const browserType = testPrompt.options?.browser || 'chromium';
    const headless = testPrompt.options?.headless !== false;

    callback({
      type: 'log',
      data: { message: `🌐 Launching ${browserType} browser...` },
    });

    // For now, launch locally. In production, use Docker containers
    const browserEngine = getBrowserEngine(browserType);
    browser = await browserEngine.launch({
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    context = await browser.newContext({
      viewport: testPrompt.options?.viewport || { width: 1280, height: 720 },
      recordVideo: {
        dir: `./videos/${testId}/`,
      },
    });

    page = await context.newPage();

    // Step 3: Execute each step
    const executedSteps: TestStep[] = [];

    for (let i = 0; i < steps.length; i++) {
      const stepDef = steps[i];
      const stepId = `step_${i}`;

      const testStep: TestStep = {
        id: stepId,
        action: stepDef.action,
        target: stepDef.target,
        value: stepDef.value,
        assertion: stepDef.assertion,
        timestamp: Date.now(),
        status: 'running',
      };

      callback({
        type: 'step_started',
        data: { step: testStep },
      });

      try {
        // Execute the step
        await executeStep(page, stepDef, testStep);

        testStep.status = 'completed';
        executedSteps.push(testStep);

        // Take screenshot after step
        const screenshot = await page.screenshot({ type: 'png' });
        const screenshotBase64 = screenshot.toString('base64');

        callback({
          type: 'screenshot',
          data: { stepId, screenshot: screenshotBase64 },
        });

        callback({
          type: 'step_completed',
          data: { step: testStep },
        });
      } catch (error: any) {
        testStep.status = 'failed';
        testStep.error = error.message;
        executedSteps.push(testStep);

        callback({
          type: 'step_failed',
          data: { step: testStep, error: error.message },
        });

        // Take screenshot on error
        const screenshot = await page.screenshot({ type: 'png' });
        const screenshotBase64 = screenshot.toString('base64');

        callback({
          type: 'screenshot',
          data: { stepId, screenshot: screenshotBase64 },
        });

        throw error; // Stop execution on failure
      }
    }

    callback({
      type: 'log',
      data: { message: '✅ All test steps completed successfully' },
    });
  } catch (error: any) {
    callback({
      type: 'error',
      data: { message: error.message, stack: error.stack },
    });
    throw error;
  } finally {
    // Cleanup
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
    if (container) {
      try {
        await container.stop();
        await container.remove();
      } catch (e) {
        console.error('Error cleaning up container:', e);
      }
    }
  }
}

/**
 * Execute a single test step
 */
async function executeStep(
  page: Page,
  stepDef: any,
  testStep: TestStep
): Promise<void> {
  const { action, target, value, assertion } = stepDef;

  switch (action) {
    case 'navigate':
      if (!target) throw new Error('Navigate action requires target URL');
      await page.goto(target, { waitUntil: 'networkidle' });
      break;

    case 'click':
      if (!target) throw new Error('Click action requires target');
      await page.click(`text="${target}"`).catch(() => {
        // Try other selectors
        return page.click(target);
      });
      await page.waitForTimeout(500); // Small delay after click
      break;

    case 'fill':
      if (!target || !value) throw new Error('Fill action requires target and value');
      await page.fill(`input[type="text"], input[type="email"], input[type="password"], textarea`, value).catch(() => {
        // Try by label
        return page.fill(`label:has-text("${target}") + input, [placeholder*="${target}"]`, value);
      });
      break;

    case 'select':
      if (!target || !value) throw new Error('Select action requires target and value');
      await page.selectOption(target, value);
      break;

    case 'wait':
      const waitTime = parseInt(value || '1000');
      await page.waitForTimeout(waitTime);
      break;

    case 'assert':
      if (!assertion) throw new Error('Assert action requires assertion');
      await performAssertion(page, assertion, testStep);
      break;

    case 'screenshot':
      // Screenshot is taken automatically after each step
      break;

    case 'scroll':
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      break;

    case 'hover':
      if (!target) throw new Error('Hover action requires target');
      await page.hover(`text="${target}"`).catch(() => page.hover(target));
      break;

    case 'keyboard':
      if (!value) throw new Error('Keyboard action requires value');
      await page.keyboard.press(value);
      break;

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

/**
 * Perform an assertion
 */
async function performAssertion(
  page: Page,
  assertion: any,
  testStep: TestStep
): Promise<void> {
  const { type, expected } = assertion;

  switch (type) {
    case 'text':
      const textContent = await page.textContent('body');
      const found = textContent?.includes(expected as string);
      testStep.assertion = {
        ...assertion,
        actual: textContent,
        passed: found,
      };
      if (!found) {
        throw new Error(`Expected text "${expected}" not found`);
      }
      break;

    case 'url':
      const url = page.url();
      testStep.assertion = {
        ...assertion,
        actual: url,
        passed: url.includes(expected as string),
      };
      if (!url.includes(expected as string)) {
        throw new Error(`Expected URL to contain "${expected}", got "${url}"`);
      }
      break;

    case 'title':
      const title = await page.title();
      testStep.assertion = {
        ...assertion,
        actual: title,
        passed: title.includes(expected as string),
      };
      if (!title.includes(expected as string)) {
        throw new Error(`Expected title to contain "${expected}", got "${title}"`);
      }
      break;

    case 'element':
      const element = await page.locator(expected as string).first();
      const isVisible = await element.isVisible();
      testStep.assertion = {
        ...assertion,
        actual: isVisible ? 'visible' : 'not visible',
        passed: isVisible,
      };
      if (!isVisible) {
        throw new Error(`Expected element "${expected}" not found or not visible`);
      }
      break;

    case 'count':
      const count = await page.locator(expected as string).count();
      testStep.assertion = {
        ...assertion,
        actual: count,
        passed: count === expected,
      };
      if (count !== expected) {
        throw new Error(`Expected ${expected} elements, found ${count}`);
      }
      break;
  }
}

/**
 * Get the appropriate browser engine
 */
function getBrowserEngine(browserType: 'chromium' | 'firefox' | 'webkit') {
  switch (browserType) {
    case 'chromium':
      return chromium;
    case 'firefox':
      return firefox;
    case 'webkit':
      return webkit;
    default:
      return chromium;
  }
}
