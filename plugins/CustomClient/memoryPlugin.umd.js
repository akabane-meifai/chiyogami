(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.memoryPlugin = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  function memoryPlugin(client, options = {}){
    const dataSource = (options.sources && typeof options.sources === 'object') ? options.sources : {};
    client
      .setHandler('memory:', { setSource })
      .define('memory:', handler);
    return { name: 'memory' };
    function handler(request) {
      const { host, pathname } = new URL(request.url);
      if (request.method === 'GET') {
        if (!dataSource[host]) {
        } else if(pathname.endsWith('/')) {
          const url = Object
            .keys(dataSource[host])
            .filter(path => path.startsWith(pathname))
            .map(path => new URL(path, request.url).href);
          return Promise.resolve(createJsonResponse({ url }));
        } else if (dataSource[host][pathname]) {
          const data = dataSource[host][pathname];
          const headers = (data instanceof Blob && data.type) ? {'Content-Type': data.type} : {}; 
          return Promise.resolve(new Response(data, { status: 200, headers }));
        }
      } else if (request.method === 'POST') {
        if(pathname.endsWith('/')) {
          if (!(host in dataSource)) {
            dataSource[host] = {};
          }
          const headers = request.headers;
          const type = headers.has('Content-Type') ? headers.get('Content-Type') : 'application/octet-stream';

          if (type.startsWith('multipart/form-data;')) {
            return request.formData().then(formData => {
              const url = Array.from(formData.values(), value => {
                if (value instanceof Blob) {
                  const ext = value.name && value.name.includes('.') ? `.${value.name.split('.').pop()}` : '';
                  const randomName = `${crypto.randomUUID()}${ext}`;
                  const append = new URL(randomName, request.url);
                  dataSource[host][append.pathname] = value;
                  return append.href;
                }
                return null;
              }).filter(value => value != null);
              return Promise.resolve(createJsonResponse({ url }));
            }, err => {
              return Promise.resolve(createJsonResponse({}));
            });
          }
          return request.blob().then(blob => {
            const randomName = crypto.randomUUID();
            const append = new URL(randomName, request.url);
            dataSource[host][append.pathname] = blob;
            return Promise.resolve(createJsonResponse({ url: append.href }));
          });
        }
      } else if (request.method === 'PUT') {
        if (!(host in dataSource)) {
          dataSource[host] = {};
        }
        const headers = request.headers;
        const type = headers.has('Content-Type') ? headers.get('Content-Type') : 'application/octet-stream';
        if (type.startsWith('multipart/form-data;')) {
          return request.formData().then(formData => {
            const url = Array.from(formData.values(), value => {
              if (value instanceof Blob) {
                const append = new URL(value.name, request.url);
                dataSource[host][append.pathname] = value;
                return append.href;
              }
              return null;
            }).filter(value => value != null);
            return Promise.resolve(createJsonResponse({ url }));
          }, err => {
            return Promise.resolve(createJsonResponse({}));
          });
        }
        return request.blob().then(blob => {
          dataSource[host][pathname] = blob;
          return Promise.resolve(createJsonResponse({ url: request.url }));
        });
      } else if (request.method === 'DELETE') {
        delete dataSource[host][pathname];
        return Promise.resolve(createJsonResponse({ url: request.url }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    }
    function setSource(ctx, path, data) {
      const { name, sources } = ctx;
      if (!(name in sources)) {
        if (name in dataSource) {
          sources[name] = dataSource[name];
        } else {
          sources[name] = dataSource[name] = {};
        }
      }
      sources[name][path] = data;
    }
    function createJsonResponse(data, status = 200) {
      return new Response(JSON.stringify(data), { status, headers: {'Content-Type': 'application/json'}});
    }
  }
  return memoryPlugin;
}));
