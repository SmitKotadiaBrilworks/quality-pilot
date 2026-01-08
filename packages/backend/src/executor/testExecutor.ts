import {
  chromium,
  firefox,
  webkit,
  Browser,
  Page,
  BrowserContext,
} from "playwright";
import {
  generateTestSteps,
  injectCredentials,
  StructuredStep,
} from "../ai/geminiAgent.js";
import { TestPrompt, TestStep, WSMessageType } from "@quality-pilot/shared";

type ExecutionCallback = (message: {
  type: WSMessageType;
  data: unknown;
}) => void;

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

  try {
    // Step 1: Generate test steps from AI
    callback({
      type: "log",
      data: { message: "🤖 Generating test steps from AI..." },
    });

    let steps = await generateTestSteps(
      testPrompt.prompt,
      testPrompt.url,
      testPrompt.credentials
    );

    // Inject credentials into steps
    steps = injectCredentials(steps, testPrompt.credentials);

    callback({
      type: "log",
      data: {
        message: `✅ Generated ${steps.length} test steps`,
        steps: steps.map((s, i) => ({
          ...s,
          id: `step_${i}`,
          status: "pending",
        })),
      },
    });

    // Step 2: Launch browser (in Docker container for isolation)
    const browserType = testPrompt.options?.browser || "chromium";
    const headless = testPrompt.options?.headless !== false;

    callback({
      type: "log",
      data: { message: `🌐 Launching ${browserType} browser...` },
    });

    // For now, launch locally. In production, use Docker containers
    const browserEngine = getBrowserEngine(browserType);
    browser = await browserEngine.launch({
      headless,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    context = await browser.newContext({
      viewport: testPrompt.options?.viewport || { width: 1280, height: 720 },
      recordVideo: {
        dir: `./videos/${testId}/`,
      },
    });

    page = await context.newPage();

    // Step 3: Execute each step
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
        status: "running",
      };

      callback({
        type: "step_started",
        data: { step: testStep },
      });

      try {
        // Execute the step
        await executeStep(page, stepDef, testStep);

        testStep.status = "completed";

        // Take screenshot after step
        const screenshot = await page.screenshot({ type: "png" });
        const screenshotBase64 = screenshot.toString("base64");

        callback({
          type: "screenshot",
          data: { stepId, screenshot: screenshotBase64 },
        });

        callback({
          type: "step_completed",
          data: { step: testStep },
        });
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        testStep.status = "failed";
        testStep.error = errorMessage;

        callback({
          type: "step_failed",
          data: { step: testStep, error: errorMessage },
        });

        // Take screenshot on error
        const screenshot = await page.screenshot({ type: "png" });
        const screenshotBase64 = screenshot.toString("base64");

        callback({
          type: "screenshot",
          data: { stepId, screenshot: screenshotBase64 },
        });

        throw error; // Stop execution on failure
      }
    }

    callback({
      type: "log",
      data: { message: "✅ All test steps completed successfully" },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    callback({
      type: "error",
      data: { message: errorMessage, stack: errorStack },
    });
    throw error;
  } finally {
    // Cleanup
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
  }
}

/**
 * Execute a single test step
 */
async function executeStep(
  page: Page,
  stepDef: StructuredStep,
  testStep: TestStep
): Promise<void> {
  const { action, target, value, assertion } = stepDef;

  switch (action) {
    case "navigate":
      if (!target) throw new Error("Navigate action requires target URL");
      await page.goto(target, { waitUntil: "networkidle" });
      break;

    case "click":
      if (!target) throw new Error("Click action requires target");
      await page.click(`text="${target}"`).catch(() => {
        // Try other selectors
        return page.click(target);
      });
      await page.waitForTimeout(500); // Small delay after click
      break;

    case "fill":
      if (!target || !value)
        throw new Error("Fill action requires target and value");
      await page
        .fill(
          `input[type="text"], input[type="email"], input[type="password"], textarea`,
          value
        )
        .catch(() => {
          // Try by label
          return page.fill(
            `label:has-text("${target}") + input, [placeholder*="${target}"]`,
            value
          );
        });
      break;

    case "select":
      if (!target || !value)
        throw new Error("Select action requires target and value");
      await page.selectOption(target, value);
      break;

    case "wait": {
      const waitTime = Number.parseInt(value || "1000", 10);
      await page.waitForTimeout(waitTime);
      break;
    }

    case "assert":
      if (!assertion) throw new Error("Assert action requires assertion");
      await performAssertion(page, assertion, testStep);
      break;

    case "screenshot":
      // Screenshot is taken automatically after each step
      break;

    case "scroll": {
      await page.evaluate(() => {
        globalThis.scrollBy(0, globalThis.innerHeight);
      });
      break;
    }

    case "hover":
      if (!target) throw new Error("Hover action requires target");
      await page.hover(`text="${target}"`).catch(() => page.hover(target));
      break;

    case "keyboard":
      if (!value) throw new Error("Keyboard action requires value");
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
  assertion: StructuredStep["assertion"],
  testStep: TestStep
): Promise<void> {
  if (!assertion) {
    throw new Error("Assertion is required");
  }

  const { type, expected } = assertion;

  switch (type) {
    case "text": {
      const textContent = await page.textContent("body");
      const expectedText = String(expected);
      const found = textContent?.includes(expectedText) ?? false;
      testStep.assertion = {
        ...assertion,
        actual: textContent ?? undefined,
        passed: found,
      };
      if (!found) {
        throw new Error(`Expected text "${expectedText}" not found`);
      }
      break;
    }

    case "url": {
      const url = page.url();
      const expectedUrl = String(expected);
      testStep.assertion = {
        ...assertion,
        actual: url,
        passed: url.includes(expectedUrl),
      };
      if (!url.includes(expectedUrl)) {
        throw new Error(
          `Expected URL to contain "${expectedUrl}", got "${url}"`
        );
      }
      break;
    }

    case "title": {
      const title = await page.title();
      const expectedTitle = String(expected);
      testStep.assertion = {
        ...assertion,
        actual: title,
        passed: title.includes(expectedTitle),
      };
      if (!title.includes(expectedTitle)) {
        throw new Error(
          `Expected title to contain "${expectedTitle}", got "${title}"`
        );
      }
      break;
    }

    case "element": {
      const expectedSelector = String(expected);
      const element = await page.locator(expectedSelector).first();
      // Playwright's isVisible() returns a Promise
      // eslint-disable-next-line @typescript-eslint/await-thenable
      const isVisible = await element.isVisible();
      testStep.assertion = {
        ...assertion,
        actual: isVisible ? "visible" : "not visible",
        passed: isVisible,
      };
      if (!isVisible) {
        throw new Error(
          `Expected element "${expectedSelector}" not found or not visible`
        );
      }
      break;
    }

    case "count": {
      const expectedSelector = String(expected);
      const expectedCount =
        typeof expected === "number"
          ? expected
          : Number.parseInt(String(expected), 10);
      const count = await page.locator(expectedSelector).count();
      testStep.assertion = {
        ...assertion,
        actual: count,
        passed: count === expectedCount,
      };
      if (count !== expectedCount) {
        throw new Error(`Expected ${expectedCount} elements, found ${count}`);
      }
      break;
    }
  }
}

/**
 * Get the appropriate browser engine
 */
function getBrowserEngine(browserType: "chromium" | "firefox" | "webkit") {
  switch (browserType) {
    case "chromium":
      return chromium;
    case "firefox":
      return firefox;
    case "webkit":
      return webkit;
    default:
      return chromium;
  }
}
