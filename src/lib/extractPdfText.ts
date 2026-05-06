/** Client-side PDF text extraction for SOP normalizer (text layer only). */

const MAX_BYTES = 25 * 1024 * 1024;

export type ExtractPdfTextResult = {
  text: string;
  numPages: number;
};

export async function extractTextFromPdfArrayBuffer(data: ArrayBuffer): Promise<ExtractPdfTextResult> {
  if (data.byteLength > MAX_BYTES) {
    throw new Error(`PDF is too large (max ${MAX_BYTES / (1024 * 1024)} MB).`);
  }

  const pdfjs = await import('pdfjs-dist');
  const workerMod = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  const workerSrc =
    typeof workerMod === 'object' && workerMod !== null && 'default' in workerMod
      ? (workerMod as { default: string }).default
      : String(workerMod);
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const numPages = pdf.numPages;
  const pageTexts: string[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const parts: string[] = [];
    for (const item of content.items) {
      if (item && typeof item === 'object' && 'str' in item) {
        const s = (item as { str?: string }).str;
        if (typeof s === 'string' && s.length) parts.push(s);
      }
    }
    pageTexts.push(parts.join(' '));
  }

  const text = pageTexts.join('\n\n').replace(/\u0000/g, '').trim();
  return { text, numPages };
}
