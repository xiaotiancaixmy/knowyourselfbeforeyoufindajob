declare module "pdf-parse" {
  interface PdfParseResult {
    text: string;
  }

  interface PdfParseOptions {
    version?: string;
  }

  export default function pdfParse(dataBuffer: Buffer, options?: PdfParseOptions): Promise<PdfParseResult>;
}
