import { AppError } from '../errors.ts';
import type { PrintSize } from '../settings.ts';

/**
 * Renders the current SVG scene into a print-sized JPEG.
 * No external libraries: the SVG is serialized, loaded into an <img>
 * and rasterized through a canvas.
 */
export async function renderJpeg(
  svg: SVGSVGElement,
  contentRadius: number,
  size: PrintSize,
  background: string
): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement;

  // Export ignores the on-screen zoom: show the whole tree, centered.
  clone.querySelector('.zoom-layer')?.removeAttribute('transform');

  const side = Math.max(contentRadius * 2, 1) * 1.04;
  const aspect = size.width / size.height;
  const vbWidth = aspect >= 1 ? side * aspect : side;
  const vbHeight = aspect >= 1 ? side : side / aspect;
  clone.setAttribute('viewBox', `${-vbWidth / 2} ${-vbHeight / 2} ${vbWidth} ${vbHeight}`);
  clone.setAttribute('width', String(size.width));
  clone.setAttribute('height', String(size.height));

  // The rasterizing <img> cannot load external fonts — embed Spectral as data URIs.
  // On failure (offline) the serif fallback from FONT_STACK applies.
  const fontCss = await chartFontCss();
  if (fontCss) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = fontCss;
    clone.insertBefore(style, clone.firstChild);
  }

  const svgText = new XMLSerializer().serializeToString(clone);
  const svgUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await loadImage(svgUrl);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new AppError('canvasUnavailable');
    ctx.fillStyle = background || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, size.width, size.height);
    return await toJpegBlob(canvas);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const FONT_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Spectral:wght@400;600&display=swap';

let fontCssPromise: Promise<string> | null = null;

/** Google Fonts CSS for Spectral with every font file inlined as a data URI. Cached; '' on failure. */
function chartFontCss(): Promise<string> {
  fontCssPromise ??= (async () => {
    const response = await fetch(FONT_CSS_URL);
    let css = await response.text();
    const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]!))];
    for (const url of urls) {
      const buffer = await (await fetch(url)).arrayBuffer();
      css = css.replaceAll(url, `data:font/woff2;base64,${arrayBufferToBase64(buffer)}`);
    }
    return css;
  })().catch(() => {
    fontCssPromise = null;
    return '';
  });
  return fontCssPromise;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new AppError('rasterizeFailed'));
    image.src = url;
  });
}

function toJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new AppError('jpegFailed'))),
      'image/jpeg',
      0.95
    );
  });
}
