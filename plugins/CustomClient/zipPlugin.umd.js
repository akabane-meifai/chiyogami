(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.zipPlugin = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // ==============================
  // CRC32 Implementation
  // ==============================
  const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    return table;
  })();

  function crc32(data, previous = 0) {
    let crc = previous ^ 0xFFFFFFFF;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // ==============================
  // Main Plugin
  // ==============================
  function zipPlugin(client, options = {}) {
    const archives = (options.sources && typeof options.sources === 'object') ? options.sources : {};

    client
      .setHandler('zip:', { setSource, encodeMediaType })
      .define('zip:', handler);

    return { name: 'zip' };

    async function handler(request) {
      const url = new URL(request.url);
      const host = url.hostname;
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith('/')) pathname = pathname.slice(1);

      if (!archives[host]) {
        if (request.method === 'PUT' || request.method === 'POST') {
          archives[host] = { entries: new Map() };
        } else {
          return new Response('Archive Not Found', { status: 404 });
        }
      }

      const archive = archives[host];

      // ==================== GET ====================
      if (request.method === 'GET') {
        const accept = request.headers.get('Accept') || '';
        const isDownload = !pathname ||
          url.searchParams.has('download') ||
          accept.includes('application/zip');

        if (isDownload) {
          const index = url.searchParams.has('index') ? url.searchParams.get('index') : false;
          const zipBlob = await buildZip(archive, { index });
          
          return new Response(zipBlob, {
            status: 200,
            headers: {
              'Content-Type': 'application/zip',
              'Content-Disposition': `attachment; filename="${host}.zip"`
            }
          });
        }

        if (pathname === '' || pathname.endsWith('/')) {
          const prefix = pathname;
          const list = [];
          for (const name of archive.entries.keys()) {
            if (name.startsWith(prefix)) {
              list.push(new URL(name, request.url).href);
            }
          }
          return { data: { url: list } };
        }

        const entry = archive.entries.get(pathname);
        if (!entry) {
          return new Response('File Not Found', { status: 404 });
        }

        const mime = guessMime(pathname);
        return new Response(entry.data, {
          status: 200,
          headers: {
            'Content-Type': mime,
            'Content-Length': entry.data.byteLength,
            'X-CRC32': entry.crc.toString(16)
          }
        });
      }

      // ==================== PUT / POST ====================
      if (request.method === 'PUT' || request.method === 'POST') {
        const contentType = request.headers.get('Content-Type') || '';

        if (!pathname || contentType.includes('application/zip')) {
          const blob = await request.blob();
          const parsed = await parseZip(blob);
          archives[host] = parsed;
          return { data: { url: request.url, files: [...parsed.entries.keys()] } };
        }

        const data = new Uint8Array(await request.arrayBuffer());
        let compression = 8;

        const headerVal = request.headers.get('X-Compression');
        if (headerVal !== null) {
          compression = parseInt(headerVal, 10);
        } else if (request.headers.get('X-No-Compression') === 'true') {
          compression = 0;
        }

        let compressedData = null;
        if (compression === 8) {
          try {
            compressedData = await deflate(data);
          } catch (e) {
            console.warn('Deflate error, falling back to STORE:', e);
            compression = 0;
          }
        }

        const entry = {
          fileName: pathname,
          data,
          compressedData: compression === 8 ? compressedData : null,
          compression,
          crc: crc32(data),
          lastMod: new Date()
        };

        archive.entries.set(pathname, entry);
        return { data: { url: request.url, crc: entry.crc.toString(16), compression } };
      }

      // ==================== DELETE ====================
      if (request.method === 'DELETE') {
        if (!pathname) {
          delete archives[host];
          return { data: { url: request.url } };
        }
        if (archive.entries.has(pathname)) {
          archive.entries.delete(pathname);
          return { data: { url: request.url } };
        }
        return new Response('File Not Found', { status: 404 });
      }

      return new Response('Method Not Allowed', { status: 405 });
    }

    // ==============================
    // Helpers
    // ==============================
    function setSource(ctx, name, data) {
      if (data instanceof Blob || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        parseZip(data).then(parsed => {
          archives[name] = parsed;
          ctx.sources[name] = parsed;
        });
      } else {
        archives[name] = data;
        ctx.sources[name] = data;
      }
    }

    function encodeMediaType(obj, media) {
      if (/^(?:\*|application)\/(?:\*|json)$/.test(media?.type || '')) {
        return new Response(JSON.stringify(obj.data), {
          status: obj.status ?? 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return null;
    }

    // ==============================
    // ZIP Parsing
    // ==============================
    async function parseZip(source) {
      const buffer = await toArrayBuffer(source);
      const view = new DataView(buffer);
      const entries = new Map();

      let eocd = -1;
      for (let i = buffer.byteLength - 22; i >= 0; i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
          eocd = i;
          break;
        }
      }
      if (eocd === -1) throw new Error('Invalid ZIP: End of Central Directory not found');

      const centralOffset = view.getUint32(eocd + 16, true);
      const centralSize = view.getUint32(eocd + 12, true);
      let offset = centralOffset;

      while (offset < centralOffset + centralSize) {
        if (view.getUint32(offset, true) !== 0x02014b50) break;

        const compression = view.getUint16(offset + 10, true);
        const crc = view.getUint32(offset + 16, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const nameLen = view.getUint16(offset + 28, true);
        const extraLen = view.getUint16(offset + 30, true);
        const commentLen = view.getUint16(offset + 32, true);
        const localOffset = view.getUint32(offset + 42, true);

        const nameBytes = new Uint8Array(buffer, offset + 46, nameLen);
        const fileName = new TextDecoder('utf-8').decode(nameBytes);

        const fileNameLenLocal = view.getUint16(localOffset + 26, true);
        const extraLenLocal = view.getUint16(localOffset + 28, true);
        const dataStart = localOffset + 30 + fileNameLenLocal + extraLenLocal;
        const compressed = new Uint8Array(buffer, dataStart, compressedSize);

        let data;
        if (compression === 0) {
          data = compressed.slice(0);
        } else if (compression === 8) {
          data = await inflate(compressed);
        } else {
          throw new Error(`Unsupported compression method: ${compression}`);
        }

        entries.set(fileName, {
          fileName,
          data,
          compressedData: compression === 8 ? compressed : null,
          compression,
          crc,
          lastMod: new Date()
        });

        offset += 46 + nameLen + extraLen + commentLen;
      }

      return { entries };
    }

    // ==============================
    // ZIP Building
    // ==============================
    async function buildZip(archive, buildOptions = {}) {
      const parts = [];
      const central = [];
      let offset = 0;
      const now = new Date();

      let entriesList = Array.from(archive.entries.values());

      if (typeof buildOptions.index === 'string') {
        entriesList.sort((a, b) => {
          if (a.fileName === buildOptions.index) return -1;
          if (b.fileName === buildOptions.index) return 1;
          return 0;
        });
      }

      for (const entry of entriesList) {
        const nameBytes = new TextEncoder().encode(entry.fileName);
        const useDeflate = entry.compression === 8 && entry.compressedData;
        const compressed = useDeflate ? entry.compressedData : entry.data;
        const compression = useDeflate ? 8 : 0;
        const crc = entry.crc;
        const uncompressedSize = entry.data.byteLength;
        const compressedSize = compressed.byteLength;

        // --- Local File Header (30 Bytes) ---
        const localHeader = new ArrayBuffer(30);
        const localView = new DataView(localHeader);
        localView.setUint32(0, 0x04034b50, true); // Local header signature
        localView.setUint16(4, 20, true);         // Version needed: 2.0
        localView.setUint16(6, 0x0800, true);     // General purpose bit flag (Bit 11: UTF-8)
        localView.setUint16(8, compression, true);// Compression method
        localView.setUint16(10, dosTime(now), true);
        localView.setUint16(12, dosDate(now), true);
        localView.setUint32(14, crc, true);
        localView.setUint32(18, compressedSize, true);
        localView.setUint32(22, uncompressedSize, true);
        localView.setUint16(26, nameBytes.length, true);
        localView.setUint16(28, 0, true);         // Extra field length

        parts.push(localHeader, nameBytes, compressed);

        // --- Central Directory Header (46 Bytes) ---
        const centralHeader = new ArrayBuffer(46);
        const cView = new DataView(centralHeader);
        cView.setUint32(0, 0x02014b50, true);     // Central directory signature
        cView.setUint16(4, 0x0014, true);         // Version made by: 2.0 / MS-DOS FAT
        cView.setUint16(6, 20, true);             // Version needed: 2.0
        cView.setUint16(8, 0x0800, true);         // General purpose bit flag (UTF-8)
        cView.setUint16(10, compression, true);   // Compression method
        cView.setUint16(12, dosTime(now), true);
        cView.setUint16(14, dosDate(now), true);
        cView.setUint32(16, crc, true);
        cView.setUint32(20, compressedSize, true);
        cView.setUint32(24, uncompressedSize, true);
        cView.setUint16(28, nameBytes.length, true);
        cView.setUint16(30, 0, true);             // Extra field length
        cView.setUint16(32, 0, true);             // File comment length
        cView.setUint16(34, 0, true);             // Disk number start
        cView.setUint16(36, 0, true);             // Internal file attributes
        cView.setUint32(38, 0x00000020, true);     // External file attributes (DOS Archive)
        cView.setUint32(42, offset, true);         // Relative offset of local header

        central.push(centralHeader, nameBytes);
        offset += 30 + nameBytes.length + compressedSize;
      }

      // --- End of Central Directory (EOCD) Header (22 Bytes) ---
      const centralSize = central.reduce((sum, p) => sum + p.byteLength, 0);
      const eocd = new ArrayBuffer(22);
      const eocdView = new DataView(eocd);
      eocdView.setUint32(0, 0x06054b50, true);   // EOCD signature
      eocdView.setUint16(4, 0, true);           // Number of this disk
      eocdView.setUint16(6, 0, true);           // Disk where central directory starts
      eocdView.setUint16(8, archive.entries.size, true);  // Entries on this disk
      eocdView.setUint16(10, archive.entries.size, true); // Total entries
      eocdView.setUint32(12, centralSize, true); // Size of central directory
      eocdView.setUint32(16, offset, true);      // Offset of central directory
      eocdView.setUint16(20, 0, true);           // Comment length

      return new Blob([...parts, ...central, eocd], { type: 'application/zip' });
    }

    // ==============================
    // Compression / Decompression Utilities
    // ==============================
    async function deflate(data) {
      if (typeof CompressionStream === 'undefined') {
        throw new Error('CompressionStream is not supported');
      }
      
      let cs;
      let isRaw = true;
      try {
        cs = new CompressionStream('deflate-raw');
      } catch (e) {
        cs = new CompressionStream('deflate');
        isRaw = false;
      }

      const stream = new Blob([data]).stream().pipeThrough(cs);
      const buffer = await new Response(stream).arrayBuffer();
      const result = new Uint8Array(buffer);

      // Strip zlib header (2 bytes) & checksum (4 bytes) if deflate-raw was fallback'd to deflate
      if (!isRaw) {
        return result.subarray(2, result.length - 4);
      }
      return result;
    }

    async function inflate(data) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('DecompressionStream is not supported');
      }

      let ds;
      try {
        ds = new DecompressionStream('deflate-raw');
      } catch (e) {
        ds = new DecompressionStream('deflate');
      }

      const stream = new Blob([data]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    function toArrayBuffer(source) {
      if (source instanceof ArrayBuffer) return source;
      if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
      if (source instanceof Blob) return source.arrayBuffer();
      throw new Error('Unsupported source type');
    }

    function dosTime(date) {
      return (date.getSeconds() / 2) | (date.getMinutes() << 5) | (date.getHours() << 11);
    }

    function dosDate(date) {
      return date.getDate() | ((date.getMonth() + 1) << 5) | ((date.getFullYear() - 1980) << 9);
    }

    function guessMime(path) {
      const ext = path.split('.').pop()?.toLowerCase();
      const map = {
        txt: 'text/plain', html: 'text/html', htm: 'text/html', xhtml: 'application/xhtml+xml',
        css: 'text/css', js: 'application/javascript', json: 'application/json',
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
        svg: 'image/svg+xml', webp: 'image/webp', ncx: 'application/x-dtbncx+xml',
        opf: 'application/oebps-package+xml', zip: 'application/zip'
      };
      return map[ext] || 'application/octet-stream';
    }
  }

  return zipPlugin;
}));