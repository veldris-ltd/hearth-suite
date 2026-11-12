/** A generated QR code (byte mode, ECC level M). */
export interface QrCode {
  /** Module grid edge length in modules. */
  size: number;
  /** Row-major module grid; true = dark. */
  modules: boolean[][];
  /** QR version 1–40. */
  version: number;
  /** The data mask (0–7) chosen by lowest penalty. */
  mask: number;
}

/** Encode text into a QR code (byte mode, ECC level M). */
export function encodeQr(text: string): QrCode;

/** Decode the data text back out of a QrCode, inverse of {@link encodeQr}. */
export function decodeQr(qr: QrCode): string;

/** Render a scannable, dark-on-light QR SVG string (with a quiet zone). */
export function qrSvg(
  text: string,
  opts?: { size?: number; dark?: string; light?: string },
): string;
