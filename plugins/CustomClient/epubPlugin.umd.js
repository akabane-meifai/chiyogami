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
    
    const archives = (options.sources && typeof options.sources === 'object') ? options.sources : {};
    
    // Register handlers and definitions as epub: protocol
    client
      .setHandler('epub:', { setSource, getSource, encodeMediaType })
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
      const handlerName = request.method.toLowerCase() + 'Zip';
      if (!client.hasHandler('zip:', handlerName)) {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const response = await client.applyHandler('zip:', handlerName, request, archives);

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

    function setSource(ctx, data) {
      return client.applyHandler('zip:', 'trySetZip', ctx.name, data, archives);
    }

    function getSource(ctx) {
      return archives[ctx.name] || null;
    }

    function encodeMediaType(obj, media) {
      if (client.hasHandler('zip:', 'encodeMediaType')) {
        return client.applyHandler('zip:', 'encodeMediaType', obj, media);
      }
      return null;
    }

    // Helper function to PUT to zip: protocol and complement file if specified path does not exist
    async function ensureFile(host, targetPath, content, contentType) {
      const checkReq = new Request(`epub://${host}/${targetPath}`, { method: 'GET' });
      const checkRes = await client.applyHandler('zip:', 'getZip', checkReq, archives);

      if (checkRes.status === 404) {
        const putReq = new Request(`epub://${host}/${targetPath}`, {
          method: 'PUT',
          headers: {
            'Content-Type': contentType,
            'X-No-Compression': targetPath === 'mimetype' ? 'true' : 'false' // Keep mimetype uncompressed
          },
          body: new TextEncoder().encode(content)
        });
        await client.applyHandler('zip:', 'putZip', putReq, archives);
      }
    }
  }

  return epubPlugin;
}));