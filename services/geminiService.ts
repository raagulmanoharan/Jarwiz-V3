
import { GoogleGenAI, Type } from "@google/genai";
import { SiteInfo, SuggestedResource, ResourceKind } from "../types";

const KINDS: ResourceKind[] = ['video', 'paper', 'doc', 'article'];

export const analyzeLink = async (url: string): Promise<SiteInfo> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyze this URL and provide a concise title, a short description (max 2 sentences), a dominant brand color (hex), and a category. Ensure all text is in sentence case. URL: ${url}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          themeColor: { type: Type.STRING },
          category: { type: Type.STRING },
        },
        required: ["title", "description", "themeColor", "category"],
      },
    },
  });

  try {
    const text = response.text;
    return JSON.parse(text) as SiteInfo;
  } catch (error) {
    console.error("Failed to parse Gemini response", error);
    return {
      title: "Untitled link",
      description: "No metadata found for this link.",
      themeColor: "#3b82f6",
      category: "Website",
    };
  }
};

// --- Ultra Think: grounded discovery ---------------------------------------

interface BoardItem {
  title: string;
  description: string;
  url: string;
}

const normalizeUrl = (url: string): string =>
  url.trim().toLowerCase().replace(/[#?].*$/, '').replace(/\/+$/, '');

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

// The model is asked for a bare JSON array, but grounded responses sometimes
// wrap it in prose or ```json fences. Pull out the outermost array and parse it.
const extractJsonArray = (raw: string): any[] => {
  if (!raw) return [];
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * Reads the current board and uses Gemini with Google Search grounding to find
 * genuinely related, real resources from the web. Grounding is what keeps the
 * URLs real rather than hallucinated — the whole feature depends on it.
 */
export const findRelatedResources = async (
  cards: BoardItem[]
): Promise<SuggestedResource[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const boardSummary = cards
    .map((c, i) => `${i + 1}. ${c.title} — ${c.description}`)
    .join('\n');

  const prompt = `You are a research assistant expanding a user's visual research board.

The board already contains:
${boardSummary}

Using Google Search, find 6-8 genuinely relevant, high-quality resources from across the web that deepen or expand on the themes above. Favour non-obvious, substantive material the user is unlikely to have already found: academic papers, in-depth articles and docs, and videos. Do NOT include anything already on the board. Only use real URLs you actually found through search — never invent a link.

Respond with ONLY a JSON array, no prose and no markdown fences. Each element must be an object with exactly these keys:
- "title": concise title in sentence case
- "description": 1-2 sentence summary of the resource
- "url": the real, working URL to the resource
- "type": one of "video", "paper", "doc", "article"
- "reason": one short sentence starting with "Because you saved" that ties it to a specific board item`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const existing = new Set(cards.map((c) => normalizeUrl(c.url)));
  const seen = new Set<string>();
  const results: SuggestedResource[] = [];

  for (const item of extractJsonArray(response.text ?? '')) {
    const url = typeof item?.url === 'string' ? item.url.trim() : '';
    if (!/^https?:\/\//i.test(url)) continue;

    const key = normalizeUrl(url);
    if (existing.has(key) || seen.has(key)) continue;
    seen.add(key);

    results.push({
      title: (item.title || 'Untitled resource').toString().trim(),
      description: (item.description || '').toString().trim(),
      url,
      type: KINDS.includes(item.type) ? item.type : 'article',
      reason: (item.reason || '').toString().trim(),
      source: hostOf(url),
    });
  }

  return results;
};
