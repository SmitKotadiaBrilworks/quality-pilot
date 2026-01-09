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
import { inspectPage } from "./pageInspector.js";

type ExecutionCallback = (message: {
  type: WSMessageType;
  data: unknown;
}) => void;

// Store active test executions for cancellation
const activeExecutions = new Map<
  string,
  {
    browser: Browser | null;
    context: BrowserContext | null;
    page: Page | null;
    cancelled: boolean;
  }
>();

/**
 * Cancel a running test execution
 */
export function cancelTestExecution(testId: string): void {
  const execution = activeExecutions.get(testId);
  if (execution) {
    execution.cancelled = true;
    console.log(`🛑 Cancellation requested for test ${testId}`);
  }
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

  // Register this execution for cancellation
  activeExecutions.set(testId, {
    browser: null,
    context: null,
    page: null,
    cancelled: false,
  });

  try {
    // Step 1: Launch browser first (in Docker container for isolation)
    const browserType = testPrompt.options?.browser || "chromium";
    const headless = testPrompt.options?.headless !== false;

    callback({
      type: "log",
      data: { message: `🌐 Launching ${browserType} browser...` },
    });

    // Check if cancelled before starting browser
    const execution = activeExecutions.get(testId);
    if (execution?.cancelled) {
      throw new Error("Test execution was cancelled");
    }

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
    // Set default timeout for all actions on this page
    page.setDefaultTimeout(30000);

    // Update execution record
    if (execution) {
      execution.browser = browser;
      execution.context = context;
      execution.page = page;
    }

    // Step 2: Initial navigation and page inspection
    callback({
      type: "log",
      data: { message: `🚀 Navigating to ${testPrompt.url}...` },
    });

    await page.goto(testPrompt.url, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    // Wait for JS execution and animations
    await page.waitForTimeout(3000);

    callback({
      type: "log",
      data: { message: "🔍 Inspecting page elements..." },
    });

    const pageData = await inspectPage(page);
    const pageElements = {
      buttons: pageData.buttons.map((b) => b.text),
      links: pageData.links.map((l) => l.text),
      inputs: pageData.inputs.map(
        (i) => i.label || i.placeholder || i.id || "input"
      ),
    };

    // Step 3: Generate test steps from AI WITH page elements knowledge
    callback({
      type: "log",
      data: { message: "🤖 Generating optimized test steps from AI..." },
    });

    let steps = await generateTestSteps(
      testPrompt.prompt,
      testPrompt.url,
      pageElements
    );

    // Inject credentials into steps
    steps = injectCredentials(steps, testPrompt.credentials);

    callback({
      type: "log",
      data: {
        message: `✅ Generated ${steps.length} test steps based on page analysis`,
        steps: steps.map((s, i) => ({
          ...s,
          id: `step_${i}`,
          status: "pending",
        })),
      },
    });

    // Step 4: Execute each step
    // Track context for scoped clicking (e.g., which ebook card we're in)
    let currentContext: string | null = null;

    for (let i = 0; i < steps.length; i++) {
      // Check for cancellation before each step
      const execution = activeExecutions.get(testId);
      if (execution?.cancelled) {
        callback({
          type: "log",
          data: { message: "🛑 Test execution cancelled by user" },
        });
        throw new Error("Test execution was cancelled");
      }

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

      // Update context if this step mentions a specific item (e.g., ebook title)
      if (
        stepDef.description &&
        (stepDef.description.includes("ebook") ||
          stepDef.description.includes("card"))
      ) {
        // Try to extract context from description
        const contextMatch =
          stepDef.description.match(
            /(?:ebook|card|item).*?["']([^"']+)["']/i
          ) || stepDef.description.match(/titled\s+([^,.]+)/i);
        if (contextMatch) {
          currentContext = contextMatch[1].trim();
        }
      }

      callback({
        type: "step_started",
        data: { step: testStep },
      });

      try {
        // Execute the step (pass context for scoped operations)
        await executeStep(page, stepDef, testStep, currentContext || undefined);

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

    // Check if it was a cancellation
    if (errorMessage.includes("cancelled")) {
      callback({
        type: "test_failed",
        data: {
          error: "Test execution was cancelled",
          timestamp: Date.now(),
        },
      });
    } else {
      callback({
        type: "error",
        data: { message: errorMessage, stack: errorStack },
      });
    }
    throw error;
  } finally {
    // Cleanup
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});

    // Remove from active executions
    activeExecutions.delete(testId);
  }
}

/**
 * Execute a single test step
 */
async function executeStep(
  page: Page,
  stepDef: StructuredStep,
  testStep: TestStep,
  context?: string | null
): Promise<void> {
  const { action, target, value, assertion } = stepDef;

  switch (action) {
    case "navigate": {
      if (!target) throw new Error("Navigate action requires target URL");
      await page.goto(target, {
        waitUntil: "networkidle",
        timeout: 60000, // Increased timeout for slow pages
      });
      // Wait a bit more for dynamic content to load
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(2000); // Give time for JavaScript to render
      break;
    }

    case "click": {
      if (!target) throw new Error("Click action requires target");

      // Clean the target - remove leading/trailing whitespace and normalize
      const cleanTarget = target.trim();

      // Reject invalid selectors that AI might generate
      if (
        cleanTarget.includes(":contains") ||
        cleanTarget.includes(":has-text") ||
        (cleanTarget.includes("href") &&
          cleanTarget.includes('"') &&
          cleanTarget.match(/href.*["'][^"']* [^"']*["']/))
      ) {
        throw new Error(
          `Invalid selector generated: "${target}". Use plain text instead (e.g., "Download Now")`
        );
      }

      // Wait for page to be ready
      await page
        .waitForLoadState("networkidle", { timeout: 10000 })
        .catch(() => {
          // Ignore timeout, continue anyway
        });

      // Wait a bit more for dynamic content (especially for cards/modals)
      await page.waitForTimeout(3000);

      // Debug: Get all available clickable elements on the page
      const availableElements: Array<{
        text: string;
        tag: string;
        visible: boolean;
      }> = [];
      try {
        const allClickable = await page
          .locator(
            'button, a, [role="button"], input[type="button"], input[type="submit"], [onclick], [class*="button"], [class*="btn"]'
          )
          .all();
        for (const elem of allClickable.slice(0, 30)) {
          try {
            const text = await elem.textContent().catch(() => null);
            const tagName = await elem
              .evaluate((el) => el.tagName.toLowerCase())
              .catch(() => "unknown");
            const isVisible = await elem.isVisible().catch(() => false);
            if (text && text.trim()) {
              availableElements.push({
                text: text.trim(),
                tag: tagName,
                visible: isVisible,
              });
            }
          } catch (e) {
            // Skip this element
          }
        }
        console.log(
          `🔍 Found ${availableElements.length} clickable elements on page`
        );
        if (availableElements.length > 0) {
          console.log(
            `📋 Available elements:`,
            availableElements
              .map(
                (e: { text: string; tag: string; visible: boolean }) =>
                  `[${e.tag}] "${e.text}" (visible: ${e.visible})`
              )
              .join(", ")
          );
        }
      } catch (e) {
        console.log("⚠️ Could not inspect page elements:", e);
      }

      // Try multiple selector strategies with increased timeout
      const strategies = [
        // Strategy 1: getByRole with name (most reliable for buttons/links)
        async () => {
          const locator = page
            .getByRole("button", { name: cleanTarget, exact: false })
            .first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 5000 })
            .catch(() => {});
          await locator.click({ timeout: 30000 });
        },
        // Strategy 2: getByRole for link
        async () => {
          const locator = page
            .getByRole("link", { name: cleanTarget, exact: false })
            .first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 5000 })
            .catch(() => {});
          await locator.click({ timeout: 30000 });
        },
        // Strategy 3: getByText with exact match (most reliable for visible text)
        async () => {
          const locator = page.getByText(cleanTarget, { exact: true }).first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 5000 })
            .catch(() => {});
          await locator.click({ timeout: 30000 });
        },
        // Strategy 4: getByText with case-insensitive exact match
        async () => {
          const escaped = cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const locator = page
            .getByText(new RegExp(`^${escaped}$`, "i"))
            .first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 5000 })
            .catch(() => {});
          await locator.click({ timeout: 30000 });
        },
        // Strategy 5: getByText with partial match (if exact doesn't work)
        async () => {
          const locator = page.getByText(cleanTarget, { exact: false }).first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 5000 })
            .catch(() => {});
          await locator.click({ timeout: 30000 });
        },
        // Strategy 6: Find by text content that contains target (more flexible)
        async () => {
          const allElements = await page
            .locator('button, a, [role="button"], [onclick]')
            .all();
          for (const elem of allElements) {
            const text = await elem.textContent().catch(() => null);
            if (
              text &&
              text.trim().toLowerCase().includes(cleanTarget.toLowerCase())
            ) {
              await elem
                .scrollIntoViewIfNeeded({ timeout: 5000 })
                .catch(() => {});
              await elem.click({ timeout: 30000 });
              return;
            }
          }
          throw new Error("Element not found by text content");
        },
        // Strategy 7: Scoped clicking - if context is available, scope to parent container
        async () => {
          if (context) {
            // Find the parent element (e.g., ebook card) that contains the context text
            const contextLocator = page
              .getByText(context, { exact: false })
              .first();
            const isContextVisible = await contextLocator
              .isVisible()
              .catch(() => false);

            if (isContextVisible) {
              // Find the nearest common ancestor (card/container)
              // Then find the target button/link within that container
              const parentContainer = contextLocator
                .locator("..")
                .locator("..")
                .first();
              const scopedTarget = parentContainer
                .getByText(cleanTarget, { exact: false })
                .first();

              await scopedTarget
                .scrollIntoViewIfNeeded({ timeout: 5000 })
                .catch(() => {});
              await scopedTarget.click({ timeout: 30000 });
              return;
            }
          }
          throw new Error("Context not available");
        },
        // Strategy 8: Exact text match with locator
        async () => {
          const locator = page.locator(`text="${cleanTarget}"`).first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 5000 })
            .catch(() => {});
          await locator.click({ timeout: 30000 });
        },
        // Strategy 6: Text with leading/trailing whitespace tolerance
        async () => {
          const locator = page
            .locator(
              `text=/^\\s*${cleanTarget.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
              )}\\s*$/i`
            )
            .first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 5000 })
            .catch(() => {});
          await locator.click({ timeout: 30000 });
        },
        // Strategy 4: Contains text (partial match)
        async () => {
          const locator = page.locator(`text=${cleanTarget}`).first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 5000 })
            .catch(() => {});
          await locator.click({ timeout: 30000 });
        },
        // Strategy 5: getByText (Playwright's recommended method) - handles whitespace better
        async () => {
          const locator = page.getByText(cleanTarget, { exact: false }).first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 5000 })
            .catch(() => {});
          await locator.click({ timeout: 30000 });
        },
        // Strategy 6: Button with text (has-text)
        async () => {
          const locator = page
            .locator(`button:has-text("${cleanTarget}")`)
            .first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 5000 })
            .catch(() => {});
          await locator.click({ timeout: 30000 });
        },
        // Strategy 7: Link with text (has-text)
        async () => {
          const locator = page.locator(`a:has-text("${cleanTarget}")`).first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 5000 })
            .catch(() => {});
          await locator.click({ timeout: 30000 });
        },
        // Strategy 8: Role-based button with regex (case-insensitive)
        async () => {
          const locator = page
            .getByRole("button", {
              name: new RegExp(
                cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                "i"
              ),
            })
            .first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 5000 })
            .catch(() => {});
          await locator.click({ timeout: 30000 });
        },
        // Strategy 9: Role-based link with regex (case-insensitive)
        async () => {
          const locator = page
            .getByRole("link", {
              name: new RegExp(
                cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                "i"
              ),
            })
            .first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 5000 })
            .catch(() => {});
          await locator.click({ timeout: 30000 });
        },
        // Strategy 10: CSS selector if target looks like one (but not pseudo-selectors)
        async () => {
          // Only try if it looks like a valid CSS selector (not containing :contains, :has-text, etc.)
          if (
            !target.includes(":contains") &&
            !target.includes(":has-text") &&
            (target.startsWith(".") ||
              target.startsWith("#") ||
              target.startsWith("[") ||
              target.includes(" ") ||
              target.includes(">") ||
              target.includes("+") ||
              target.includes("~"))
          ) {
            const locator = page.locator(target).first();
            await locator
              .scrollIntoViewIfNeeded({ timeout: 5000 })
              .catch(() => {});
            await locator.click({ timeout: 30000 });
          } else {
            throw new Error("Invalid selector");
          }
        },
        // Strategy 11: Find by class containing target text
        async () => {
          const locator = page
            .locator(`[class*="${cleanTarget.toLowerCase()}"]`)
            .first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 5000 })
            .catch(() => {});
          await locator.click({ timeout: 30000 });
        },
        // Strategy 12: Find by href containing target text (only if no spaces in target)
        async () => {
          // Only try href matching if target has no spaces (URLs don't have spaces)
          if (!cleanTarget.includes(" ")) {
            const locator = page
              .locator(`a[href*="${cleanTarget.toLowerCase()}"]`)
              .first();
            await locator
              .scrollIntoViewIfNeeded({ timeout: 5000 })
              .catch(() => {});
            await locator.click({ timeout: 30000 });
          } else {
            throw new Error("Skipping href strategy - target contains spaces");
          }
        },
      ];

      let lastError: Error | null = null;
      for (const strategy of strategies) {
        try {
          await strategy();
          await page.waitForTimeout(500); // Small delay after click
          return; // Success, exit
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          continue; // Try next strategy
        }
      }

      // If all strategies failed, provide helpful error with available elements
      const availableTexts = availableElements
        .filter(
          (e: { text: string; tag: string; visible: boolean }) => e.visible
        )
        .map(
          (e: { text: string; tag: string; visible: boolean }) => `"${e.text}"`
        )
        .slice(0, 10)
        .join(", ");

      throw new Error(
        `Failed to click "${target}" after trying multiple strategies: ${
          lastError?.message || "Unknown error"
        }. Available visible elements: ${availableTexts || "none found"}`
      );
    }

    case "fill": {
      if (!target || !value)
        throw new Error("Fill action requires target and value");

      // Debug: Get all available input fields
      const availableInputs: Array<{
        placeholder?: string;
        label?: string;
        type?: string;
        id?: string;
      }> = [];
      try {
        const allInputs = await page.locator("input, textarea").all();
        for (const inp of allInputs.slice(0, 20)) {
          try {
            const placeholder = await inp
              .getAttribute("placeholder")
              .catch(() => null);
            const inputType = await inp.getAttribute("type").catch(() => null);
            const inputId = await inp.getAttribute("id").catch(() => null);
            const label = inputId
              ? await page
                  .locator(`label[for="${inputId}"]`)
                  .textContent()
                  .catch(() => null)
              : null;
            availableInputs.push({
              placeholder: placeholder || undefined,
              label: label?.trim() || undefined,
              type: inputType || undefined,
              id: inputId || undefined,
            });
          } catch (e) {
            // Skip
          }
        }
        console.log(
          `🔍 Found ${availableInputs.length} input fields:`,
          availableInputs
        );
      } catch (e) {
        console.log("⚠️ Could not inspect input fields:", e);
      }

      // Try multiple strategies to find the input field
      const fillStrategies = [
        // Strategy 1: Find by placeholder text (exact match)
        async () => {
          const locator = page
            .getByPlaceholder(target, { exact: true })
            .first();
          await locator.fill(value, { timeout: 30000 });
        },
        // Strategy 2: Find by placeholder text (partial match)
        async () => {
          const locator = page
            .getByPlaceholder(target, { exact: false })
            .first();
          await locator.fill(value, { timeout: 30000 });
        },
        // Strategy 2b: Find by placeholder containing target words
        async () => {
          const targetWords = target
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 2);
          const allInputs = await page.locator("input, textarea").all();
          for (const inp of allInputs) {
            try {
              const placeholder = await inp
                .getAttribute("placeholder")
                .catch(() => null);
              if (
                placeholder &&
                targetWords.every((word) =>
                  placeholder.toLowerCase().includes(word)
                )
              ) {
                await inp.fill(value, { timeout: 30000 });
                return;
              }
            } catch (e) {
              continue;
            }
          }
          throw new Error("Input not found by placeholder words");
        },
        // Strategy 3: Find by label text, then find associated input
        async () => {
          const label = page.getByText(target, { exact: false }).first();
          const labelFor = await label.getAttribute("for").catch(() => null);
          if (labelFor) {
            await page.locator(`#${labelFor}`).fill(value, { timeout: 30000 });
          } else {
            // Find input next to label
            const input = label
              .locator("..")
              .locator("input, textarea")
              .first();
            await input.fill(value, { timeout: 30000 });
          }
        },
        // Strategy 4: Find by label text using getByLabel
        async () => {
          const locator = page.getByLabel(target, { exact: false }).first();
          await locator.fill(value, { timeout: 30000 });
        },
        // Strategy 5: Find by role and name
        async () => {
          const locator = page
            .getByRole("textbox", { name: new RegExp(target, "i") })
            .first();
          await locator.fill(value, { timeout: 30000 });
        },
        // Strategy 6: Generic input selector with placeholder
        async () => {
          const locator = page
            .locator(
              `input[placeholder*="${target}"], textarea[placeholder*="${target}"]`
            )
            .first();
          await locator.fill(value, { timeout: 30000 });
        },
        // Strategy 7: Fallback to any visible input
        async () => {
          const locator = page
            .locator(
              'input[type="text"], input[type="email"], input[type="password"], textarea'
            )
            .first();
          await locator.fill(value, { timeout: 30000 });
        },
      ];

      let lastError: Error | null = null;
      for (const strategy of fillStrategies) {
        try {
          await strategy();
          return; // Success
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          continue;
        }
      }

      // Provide helpful error with available inputs
      const availableInfo = availableInputs
        .slice(0, 5)
        .map(
          (inp: {
            placeholder?: string;
            label?: string;
            type?: string;
            id?: string;
          }) => {
            const parts: string[] = [];
            if (inp.placeholder)
              parts.push(`placeholder: "${inp.placeholder}"`);
            if (inp.label) parts.push(`label: "${inp.label}"`);
            if (inp.type) parts.push(`type: ${inp.type}`);
            return parts.join(", ");
          }
        )
        .join("; ");

      throw new Error(
        `Failed to fill "${target}" after trying multiple strategies: ${
          lastError?.message || "Unknown error"
        }. Available inputs: ${availableInfo || "none found"}`
      );
    }

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
      // Scroll down by viewport height, or scroll to specific element if target provided
      if (target) {
        try {
          const element = await page.locator(target).first();
          await element.scrollIntoViewIfNeeded({ timeout: 5000 });
        } catch {
          // If element not found, just scroll down
          await page.evaluate(() => {
            globalThis.scrollBy(0, globalThis.innerHeight);
          });
        }
      } else {
        await page.evaluate(() => {
          globalThis.scrollBy(0, globalThis.innerHeight);
        });
      }
      await page.waitForTimeout(500); // Wait for scroll to complete
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
