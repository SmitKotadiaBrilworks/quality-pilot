import { Page } from "playwright";

/**
 * Inspect page and return all available interactive elements
 * This helps with debugging and can be used to improve AI prompts
 */
export async function inspectPage(page: Page): Promise<{
  buttons: Array<{ text: string; visible: boolean; tag: string }>;
  links: Array<{ text: string; visible: boolean; href?: string }>;
  inputs: Array<{
    placeholder?: string;
    label?: string;
    type?: string;
    id?: string;
    visible: boolean;
  }>;
}> {
  const result = {
    buttons: [] as Array<{ text: string; visible: boolean; tag: string }>,
    links: [] as Array<{ text: string; visible: boolean; href?: string }>,
    inputs: [] as Array<{
      placeholder?: string;
      label?: string;
      type?: string;
      id?: string;
      visible: boolean;
    }>,
  };

  try {
    // Get all interactive elements (buttons, links, inputs)
    // We use a more comprehensive selector for buttons
    const buttons = await page
      .locator(
        'button, [role="button"], input[type="button"], input[type="submit"], [class*="button"], [class*="btn"], [onclick]'
      )
      .all();

    for (const btn of buttons.slice(0, 50)) {
      try {
        const isVisible = await btn.isVisible().catch(() => false);
        if (!isVisible) continue;

        let text = await btn.innerText().catch(() => null);
        if (!text || !text.trim()) {
          // Try aria-label if no inner text
          text = await btn.getAttribute("aria-label").catch(() => null);
        }

        const tagName = await btn
          .evaluate((el) => el.tagName.toLowerCase())
          .catch(() => "unknown");

        if (text && text.trim()) {
          result.buttons.push({
            text: text.trim(),
            visible: isVisible,
            tag: tagName,
          });
        }
      } catch (e) {
        // Skip
      }
    }

    // Get all links
    const links = await page.locator("a").all();
    for (const link of links.slice(0, 50)) {
      try {
        const isVisible = await link.isVisible().catch(() => false);
        if (!isVisible) continue;

        let text = await link.innerText().catch(() => null);
        if (!text || !text.trim()) {
          text = await link.getAttribute("aria-label").catch(() => null);
        }

        const href = await link.getAttribute("href").catch(() => null);
        if (text && text.trim()) {
          result.links.push({
            text: text.trim(),
            visible: isVisible,
            href: href || undefined,
          });
        }
      } catch (e) {
        // Skip
      }
    }

    // Get all inputs
    const inputs = await page.locator("input, textarea, select").all();
    for (const inp of inputs.slice(0, 50)) {
      try {
        const isVisible = await inp.isVisible().catch(() => false);
        if (!isVisible) continue;

        const placeholder = await inp
          .getAttribute("placeholder")
          .catch(() => null);
        const inputType = await inp.getAttribute("type").catch(() => null);
        const inputId = await inp.getAttribute("id").catch(() => null);

        let label = null;
        if (inputId) {
          label = await page
            .locator(`label[for="${inputId}"]`)
            .first()
            .innerText()
            .catch(() => null);
        }

        if (!label) {
          // Try to find label by aria-label or title
          label = await inp.getAttribute("aria-label").catch(() => null);
          if (!label) {
            label = await inp.getAttribute("title").catch(() => null);
          }
        }

        result.inputs.push({
          placeholder: placeholder || undefined,
          label: label?.trim() || undefined,
          type: inputType || undefined,
          id: inputId || undefined,
          visible: isVisible,
        });
      } catch (e) {
        // Skip
      }
    }
  } catch (error) {
    console.error("Error inspecting page:", error);
  }

  // Remove duplicates
  result.buttons = result.buttons.filter(
    (v, i, a) => a.findIndex((t) => t.text === v.text) === i
  );
  result.links = result.links.filter(
    (v, i, a) => a.findIndex((t) => t.text === v.text) === i
  );

  return result;
}
