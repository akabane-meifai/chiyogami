(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.indexedDbPlugin = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  function indexedDbPlugin(client, options = {}) {
    const protocol = (typeof options.protocol === 'string') ? options.protocol : 'idb:';
    const sources = (options.sources && typeof options.sources === 'object') ? options.sources : {};

    // Helper function to open an IndexedDB database and ensure the target object store exists
    function openDB(dbName, storeName) {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: 'key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    // Handler for source registration
    const idbHandler = {
      setSource(ctx, config) {
        ctx.sources[ctx.name] = {
          dbName: config.dbName || 'DefaultDB',
          storeName: config.storeName || 'default_store',
          ...config
        };
      }
    };

    // Register the handler and protocol router
    client
      .setHandler(protocol, idbHandler)
      .define(protocol, async (request) => {
        const urlObj = new URL(request.url);
        const configName = urlObj.hostname;
        const key = urlObj.pathname.replace(/^\//, '');

        const sources = client._sources[protocol] || {};
        const config = sources[configName];

        if (!config) {
          return new Response(JSON.stringify({ error: `Source "${configName}" not defined` }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const { dbName, storeName } = config;
        const db = await openDB(dbName, storeName);

        // GET: Retrieve a single record or list all items
        if (request.method === 'GET') {
          if (key) {
            const record = await new Promise((resolve, reject) => {
              const tx = db.transaction(storeName, 'readonly');
              const req = tx.objectStore(storeName).get(key);
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });

            if (!record) {
              return new Response(JSON.stringify({ error: 'Key Not Found' }), { 
                status: 404, 
                headers: { 'Content-Type': 'application/json' } 
              });
            }

            return new Response(record.value, {
              status: 200,
              headers: { 'Content-Type': record.contentType || 'application/json' }
            });
          } else {
            // Retrieve all records when no key is specified
            const records = await new Promise((resolve, reject) => {
              const tx = db.transaction(storeName, 'readonly');
              const req = tx.objectStore(storeName).getAll();
              req.onsuccess = () => resolve(req.result || []);
              req.onerror = () => reject(req.error);
            });

            const items = records.map(item => {
              let parsedValue = item.value;
              if (item.contentType?.includes('application/json')) {
                try { parsedValue = JSON.parse(item.value); } catch {}
              }
              return {
                key: item.key,
                value: parsedValue,
                contentType: item.contentType,
                updatedAt: item.updatedAt
              };
            });

            return new Response(JSON.stringify(items, null, 2), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }

        // PUT / POST: Upsert data
        if (request.method === 'PUT' || request.method === 'POST') {
          if (!key) {
            return new Response(JSON.stringify({ error: 'Key is required for PUT/POST' }), { 
              status: 400, 
              headers: { 'Content-Type': 'application/json' } 
            });
          }

          const value = await request.text();
          const contentType = request.headers.get('Content-Type') || 'application/json';

          await new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put({ key, value, contentType, updatedAt: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });

          return new Response(JSON.stringify({ success: true, key }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // DELETE: Remove a single record or clear the entire store
        if (request.method === 'DELETE') {
          await new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            if (key) {
              store.delete(key);
            } else {
              store.clear();
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });

          return new Response(null, { status: 204 });
        }

        // Method Not Allowed
        return new Response('Method Not Allowed', { 
          status: 405, 
          headers: { 'Allow': 'GET, POST, PUT, DELETE' } 
        });
      });
    
    // Auto-register initial sources if passed via options
    for (const name in sources) {
      if (Object.prototype.hasOwnProperty.call(sources, name)) {
        client.setSource(protocol, name, sources[name]);
      }
    }

    return { name: options.name || `indexed-db-plugin:${protocol}` };
  }
  return indexedDbPlugin;
}));