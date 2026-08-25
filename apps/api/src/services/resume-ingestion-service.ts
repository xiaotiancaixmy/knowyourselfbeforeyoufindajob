import pdf from "pdf-parse";

import { BadRequestError } from "../lib/app-error.js";

export class ResumeIngestionService {
  extractFromText(rawText: string): string {
    const cleaned = this.cleanExtractedText(rawText);
    if (!cleaned) {
      throw new BadRequestError("导入文本为空，请先补充简历内容。");
    }
    return cleaned;
  }

  async extractFromPdf(fileBytes: Buffer): Promise<string> {
    if (fileBytes.length === 0 || fileBytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new BadRequestError("上传的文件不是有效 PDF，请重新选择文件或改用文本导入。");
    }
    try {
      const result = await pdf(fileBytes, { version: "v2.0.550" });
      const cleaned = this.cleanExtractedText(result.text);
      if (!cleaned) {
        throw new BadRequestError("PDF 没有提取出可用文本；如果是扫描件，请改用文本导入。");
      }
      return cleaned;
    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }
      throw new BadRequestError("PDF 文本解析失败，请确认文件未损坏，或改用文本导入。");
    }
  }

  private cleanExtractedText(rawText: string): string {
    return rawText
      .normalize("NFKC")
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000\u200B-\u200D\u2060\uFEFF]/gu, "")
      .replace(/[\u00A0\u3000]/gu, " ")
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
}
