/**
 * Mermaid, lazily. Mermaid is a large dependency and only the diagram card
 * needs it, so we dynamic-import it on first render and keep one initialized
 * instance. `securityLevel: 'strict'` is important — the Mermaid source comes
 * from the model, so we don't let it emit raw HTML/JS or follow click bindings.
 */

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  parse: (text: string) => Promise<unknown>;
  render: (id: string, text: string) => Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;

async function getMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const mermaid = mod.default as unknown as MermaidApi;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'neutral',
        fontFamily: 'inherit',
        flowchart: { useMaxWidth: true, htmlLabels: true },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

/** Strip ```mermaid / ``` fences and surrounding whitespace the model may add. */
export function stripFences(code: string): string {
  return code
    .replace(/^\s*```(?:mermaid)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

/** Render Mermaid source to an SVG string, or report a parse/render failure. */
export async function renderMermaid(
  id: string,
  code: string,
): Promise<{ svg?: string; error?: string }> {
  const source = code.trim();
  if (!source) return { error: 'empty' };
  try {
    const mermaid = await getMermaid();
    // parse() throws on invalid source — catch it before render leaves error
    // nodes in the DOM.
    await mermaid.parse(source);
    const { svg } = await mermaid.render(id, source);
    return { svg };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
