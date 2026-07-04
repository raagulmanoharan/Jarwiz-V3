/**
 * pdf.js, lazily. pdf.js is ~400kB and only the PDF card's reader needs it, so
 * it dynamic-imports on first use (Vite splits it out of the main chunk — feel
 * pass, ROADMAP §10 #4) and configures the worker once. The `?url` import
 * resolves to a hashed asset Vite serves, so the worker loads without a CDN
 * (blocked in our sandbox anyway). Everything PDF-rendering imports from here.
 */

type PdfjsModule = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfjsModule> | null = null;

export function getPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    });
  }
  return pdfjsPromise;
}

export type PdfDocument = Awaited<ReturnType<PdfjsModule['getDocument']>['promise']>;
