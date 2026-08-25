import { describe, expect, it } from "vitest";

import { normalizeRecognizedText } from "./image-ocr";

describe("normalizeRecognizedText", () => {
  it("removes OCR spacing between Chinese characters and repairs common AI misreads", () => {
    expect(normalizeRecognizedText("Al 产品 经 理\n岗位 职责 : 负责 Al 产品 从 0 到 1")).toBe(
      "AI 产品经理\n岗位职责:负责 AI 产品从 0 到 1",
    );
  });

  it("keeps paragraph breaks while trimming noisy whitespace", () => {
    expect(normalizeRecognizedText("  第一段  \r\n\r\n\r\n  第二段  ")).toBe("第一段\n\n第二段");
  });
});
