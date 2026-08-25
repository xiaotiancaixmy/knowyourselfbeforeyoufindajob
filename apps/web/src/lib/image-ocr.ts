const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_COUNT = 6;
const MAX_IMAGE_SIZE = 12 * 1024 * 1024;

export type ImageOcrProgress = {
  completedFiles: number;
  fileCount: number;
  progress: number;
};

function validateImages(files: File[]) {
  if (files.length === 0) throw new Error("请先选择职位截图。");
  if (files.length > MAX_IMAGE_COUNT) throw new Error(`一次最多识别 ${MAX_IMAGE_COUNT} 张截图。`);
  for (const file of files) {
    if (!SUPPORTED_IMAGE_TYPES.has(file.type)) throw new Error("仅支持 PNG、JPG 和 WebP 图片。");
    if (file.size > MAX_IMAGE_SIZE) throw new Error("单张图片不能超过 12 MB。");
  }
}

export function normalizeRecognizedText(text: string): string {
  return text
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/(?<=\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu, "")
    .replace(/(?<=\p{Script=Han})[ \t]+(?=[：:，,。；;、])/gu, "")
    .replace(/(?<=[：:，,。；;、])[ \t]+(?=\p{Script=Han})/gu, "")
    .replace(/\bAl(?=\s*(?:产品|工具|模型|能力|平台|系统))/gu, "AI")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export async function recognizeJobDescriptionImages(
  files: File[],
  onProgress: (progress: ImageOcrProgress) => void,
): Promise<string> {
  validateImages(files);
  const { createWorker, OEM } = await import("tesseract.js");
  let activeFileIndex = 0;
  const worker = await createWorker(["chi_sim", "eng"], OEM.LSTM_ONLY, {
    logger: (message) => {
      if (message.status !== "recognizing text") return;
      onProgress({
        completedFiles: activeFileIndex,
        fileCount: files.length,
        progress: Math.min(1, (activeFileIndex + message.progress) / files.length),
      });
    },
  });

  try {
    const recognized: string[] = [];
    for (const [index, file] of files.entries()) {
      activeFileIndex = index;
      const result = await worker.recognize(file);
      const text = normalizeRecognizedText(result.data.text);
      if (text) recognized.push(text);
      onProgress({ completedFiles: index + 1, fileCount: files.length, progress: (index + 1) / files.length });
    }
    const combined = recognized.join("\n\n").trim();
    if (!combined) throw new Error("没有识别到清晰文字，请换一张更完整、更清楚的截图。");
    return combined;
  } finally {
    await worker.terminate();
  }
}
