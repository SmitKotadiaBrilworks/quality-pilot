import { GoogleGenerativeAI } from "@google/generative-ai";
import { TestAction } from "@quality-pilot/shared";

const genAI = new GoogleGenerativeAI(
  process.env.GEMINI_API_KEY || "AIzaSyBHDd7XcBCDsg0jrWn2WWImbvgKe9Sg6vk"
);

export interface StructuredStep {
  action: TestAction;
  target?: string;
  value?: string;
  assertion?: {
    type: "text" | "element" | "url" | "title" | "count";
    expected: string | number;
  };
  description: string;
}

/**
 * Converts a natural language prompt into structured test steps
 * using Google Gemini AI
 */
export async function generateTestSteps(
  prompt: string,
  url: string
  // credentials?: Record<string, string>
): Promise<StructuredStep[]> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  // Build the prompt for Gemini
  const systemPrompt = `You are a test automation expert. Convert the user's natural language test description into structured test steps.

Rules:
1. Output ONLY valid JSON array of steps
2. Each step must have: action, description, and optionally target, value, assertion
3. Available actions: navigate, click, fill, select, wait, assert, screenshot, scroll, hover, keyboard
4. For credentials, use placeholders like {{email}}, {{password}} - DO NOT use actual values
5. Be specific with targets (use text content, labels, or common selectors)
6. Include assertions to verify expected outcomes

Example output:
[
  {
    "action": "navigate",
    "description": "Navigate to login page",
    "target": "/login"
  },
  {
    "action": "fill",
    "description": "Enter email address",
    "target": "email input",
    "value": "{{email}}"
  },
  {
    "action": "fill",
    "description": "Enter password",
    "target": "password input",
    "value": "{{password}}"
  },
  {
    "action": "click",
    "description": "Click login button",
    "target": "Login"
  },
  {
    "action": "assert",
    "description": "Verify successful login",
    "assertion": {
      "type": "text",
      "expected": "Dashboard"
    }
  }
]`;

  const userPrompt = `URL: ${url}\n\nTest Description: ${prompt}\n\nGenerate test steps:`;

  try {
    const result = await model.generateContent([systemPrompt, userPrompt]);
    const response = await result.response;
    const text = response.text();

    // Extract JSON from response (handle markdown code blocks)
    let jsonText = text.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
    }

    const steps: StructuredStep[] = JSON.parse(jsonText);

    // Validate and return
    if (!Array.isArray(steps)) {
      throw new Error("AI response is not an array");
    }

    return steps;
  } catch (error: any) {
    console.error("Error generating test steps:", error);
    throw new Error(`Failed to generate test steps: ${error.message}`);
  }
}

/**
 * Replaces credential placeholders with actual values
 */
export function injectCredentials(
  steps: StructuredStep[],
  credentials?: Record<string, string>
): StructuredStep[] {
  if (!credentials) return steps;

  return steps.map((step) => {
    const newStep = { ...step };

    // Replace placeholders in value field
    if (newStep.value) {
      Object.entries(credentials).forEach(([key, value]) => {
        newStep.value = newStep.value!.replace(
          new RegExp(`\\{\\{${key}\\}\\}`, "g"),
          value
        );
      });
    }

    return newStep;
  });
}
