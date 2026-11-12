export interface ZipEntry {
  /** Archive path, e.g. `word/document.xml` (forward slashes). */
  name: string;
  data: Uint8Array;
}

export interface UnzippedEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  crcOk: boolean;
}

export function crc32(bytes: Uint8Array): number;
export function utf8(text: string): Uint8Array;
export function zipStore(entries: ZipEntry[]): Uint8Array;
export function unzipStore(buffer: Uint8Array | ArrayBuffer): UnzippedEntry[];
