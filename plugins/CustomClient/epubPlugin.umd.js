(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.epubPlugin = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  function epubPlugin(client, options = {}) {
    // Declare dependencies on zip plugin
    const loaded = client.plugins, requires = ['zip'];
    for (const require of requires) {
      if (!loaded.has(require)) {
        return { require };
      }
    }
    // Register handlers and definitions as epub: protocol
    client
      .setHandler('epub:', {
        setSource: (ctx, data) => {
          // Set source via zip: handler
          if (client.hasHandler('zip:', 'setSource')) {
            client.applyHandler('zip:', 'setSource', ctx, data);
          }
        },
        encodeMediaType: (obj, media) => {
          if (client.hasHandler('zip:', 'encodeMediaType')) {
            return client.applyHandler('zip:', 'encodeMediaType', obj, media);
          }
          return null;
        }
      })
      .define('epub:', handler);

    return { name: 'epub' };

    async function handler(request) {
      const url = new URL(request.url);
      const host = url.hostname;
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith('/')) pathname = pathname.slice(1);

      // --- 1. Control requests for 'mimetype' file ---
      if (pathname === 'mimetype') {
        if (request.method === 'GET') {
          return new Response('application/epub+zip', {
            status: 200,
            headers: {
              'Content-Type': 'text/plain; charset=ascii'
            }
          });
        }

        // Return 400 Bad Request for non-GET requests (e.g., write operations)
        return new Response('mimetype file cannot be modified', {
          status: 400,
          statusText: 'Bad Request'
        });
      }

      // --- 2. Complement required structure files (GET only) ---
      if (request.method === 'GET') {
        // Pre-configure mimetype file
        await ensureFile(host, 'mimetype', 'application/epub+zip', 'text/plain');

        if (pathname === 'META-INF/container.xml') {
          const defaultContainerContent = 
`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
          await ensureFile(host, 'META-INF/container.xml', defaultContainerContent, 'application/xml');
        }

        if (pathname === 'EPUB/package.opf') {
          const defaultOpfContent = 
`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:12345678-1234-1234-1234-123456789abc</dc:identifier>
    <dc:title>Untitled</dc:title>
    <dc:language>ja</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
  </spine>
</package>`;
          await ensureFile(host, 'EPUB/package.opf', defaultOpfContent, 'application/oebps-package+xml');
        }
      }

      // --- 3. Delegate request to zip: ---
      // Replace scheme with zip: to create internal request
      const zipUrl = request.url.replace(/^epub:/i, 'zip:');
      const zipRequest = new Request(zipUrl, request);

      // Execute CustomClient fetch (triggers zip: handler)
      const response = await client.fetch(zipRequest);

      // --- 4. Handle response replacement ---
      const accept = request.headers.get('Accept') || '';
      const isDownload = !pathname && (
        url.searchParams.has('download') ||
        accept.includes('application/epub+zip') ||
        accept.includes('application/zip')
      );

      // Update Content-Type to application/epub+zip and set extension to .epub on download
      if (isDownload && response.ok) {
        const headers = new Headers(response.headers);
        headers.set('Content-Type', 'application/epub+zip');
        headers.set('Content-Disposition', `attachment; filename="${host}.epub"`);

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      }

      return response;
    }

    // Helper function to PUT to zip: protocol and complement file if specified path does not exist
    async function ensureFile(host, targetPath, content, contentType) {
      const checkReq = new Request(`zip://${host}/${targetPath}`, { method: 'GET' });
      const checkRes = await client.fetch(checkReq);

      if (checkRes.status === 404) {
        const putReq = new Request(`zip://${host}/${targetPath}`, {
          method: 'PUT',
          headers: {
            'Content-Type': contentType,
            'X-No-Compression': targetPath === 'mimetype' ? 'true' : 'false' // Keep mimetype uncompressed
          },
          body: new TextEncoder().encode(content)
        });
        await client.fetch(putReq);
      }
    }
  }

  return epubPlugin;
}));