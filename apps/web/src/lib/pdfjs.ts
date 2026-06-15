/**
 * pdf.js singleton — configure the worker once. Vite resolves the `?url` import
 * to a hashed asset it serves, so the worker loads without a CDN (which is
 * blocked in our sandbox anyway). Everything PDF-rendering imports from here.
 */

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjsLib };
export type PdfDocument = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;
