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
      // Themed to the Jarwiz monochrome dark system: dark node fills, hairline
      // borders, white text, muted edges — not Mermaid's default white boxes.
      // The 'base' theme is the one that fully honours themeVariables; corner
      // rounding + any fine-tuning is finished in CSS (.jz-diagram-svg).
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        fontFamily: 'inherit',
        themeVariables: {
          fontFamily: 'inherit',
          fontSize: '14px',
          background: 'transparent',
          primaryColor: '#17171c', // node fill
          primaryBorderColor: '#3a3a42', // node hairline
          primaryTextColor: '#f5f5f7', // node text
          secondaryColor: '#1c1c22',
          secondaryBorderColor: '#3a3a42',
          secondaryTextColor: '#f5f5f7',
          tertiaryColor: '#1c1c22',
          tertiaryBorderColor: '#3a3a42',
          tertiaryTextColor: '#f5f5f7',
          lineColor: '#8a8a94', // edges/arrows
          textColor: '#f5f5f7',
          noteBkgColor: '#1c1c22',
          noteTextColor: '#f5f5f7',
          noteBorderColor: '#3a3a42',
          edgeLabelBackground: '#0e0e12', // edge labels ("Yes"/"No") sit on dark
          clusterBkg: '#141418',
          clusterBorder: '#3a3a42',
          titleColor: '#f5f5f7',
        },
        flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
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
