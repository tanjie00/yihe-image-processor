import { GoogleGenAI } from "@google/genai";
import { loadElementImage } from "./canvasService";

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove Data URI prefix (e.g. "data:image/jpeg;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
};

const getClosestAspectRatio = (width: number, height: number): string => {
  const ratio = width / height;
  const supported = [
    { str: "1:1", val: 1 },
    { str: "3:4", val: 3/4 },
    { str: "4:3", val: 4/3 },
    { str: "9:16", val: 9/16 },
    { str: "16:9", val: 16/9 },
  ];
  return supported.reduce((prev, curr) => 
    Math.abs(curr.val - ratio) < Math.abs(prev.val - ratio) ? curr : prev
  ).str;
};

export const removeTextFromImage = async (file: File, modelName: string = 'gemini-2.5-flash-image'): Promise<string> => {
  let apiKey = process.env.API_KEY;
  if (!apiKey) {
    // Fallback to localStorage
    apiKey = localStorage.getItem('gemini_api_key') || undefined;
  }
  if (!apiKey) {
    throw new Error("未找到 API Key。请在侧边栏设置中输入 API Key。");
  }

  // Get image dimensions to determine the best aspect ratio for the model
  let aspectRatio = "1:1";
  const objectUrl = URL.createObjectURL(file);
  try {
      const img = await loadElementImage(objectUrl);
      aspectRatio = getClosestAspectRatio(img.naturalWidth, img.naturalHeight);
  } catch (e) {
      console.warn("Could not determine image aspect ratio, defaulting to 1:1", e);
  } finally {
      URL.revokeObjectURL(objectUrl);
  }

  const ai = new GoogleGenAI({ apiKey });
  const base64Data = await fileToBase64(file);

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Data,
              mimeType: file.type || 'image/png',
            },
          },
          {
            text: "Edit this image. Remove all text overlays. Preserve product labels and brand names.",
          },
        ],
      },
      config: {
        imageConfig: {
            aspectRatio: aspectRatio as any
        }
      }
    });

    // Extract the image from the response
    if (response.candidates && response.candidates.length > 0) {
      const content = response.candidates[0].content;
      if (content && content.parts) {
        for (const part of content.parts) {
          if (part.inlineData && part.inlineData.data) {
            return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
          }
        }
        
        // If no image found, check for text response (e.g. refusal or error message)
        const textPart = content.parts.find(p => p.text);
        if (textPart && textPart.text) {
          throw new Error(`模型响应了文本而非图片: ${textPart.text}`);
        }
      }
    }

    throw new Error("Gemini 未返回图像数据。可能是由于安全策略拒绝了处理。");
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};