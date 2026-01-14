
import { GoogleGenAI, Type } from "@google/genai";
import { SiteInfo } from "../types";

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
