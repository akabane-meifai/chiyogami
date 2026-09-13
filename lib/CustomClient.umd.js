(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CustomClient = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  class CustomClient {
    constructor(options = {}) {
      Object.assign(this, {
        _protocols: (options?.protocols && typeof options.protocols === 'object') ? options.protocols : {},
        _handlers: (options?.handlers && typeof options.handlers === 'object') ? options.handlers : {},
        _sources: (options?.sources && typeof options.sources === 'object') ? options.sources : {},
        _plugins: new Set(),
        _requires: {}
      });
    }
    
    get plugins() {
      return new Set(this._plugins);
    }
    
    use(plugin, options = {}) {
      const result = plugin(this, options);
      if (result) {
        if (typeof result.name === 'string') {
          this._plugins.add(result.name);
          if (Array.isArray(this._requires[result.name])) {
            for (const object of this._requires[result.name]) {
              this.use(object.plugin, object.options);
            }
            delete this._requires[result.name];
          }
        }
        if (typeof result.require === 'string') {
          if (!Array.isArray(this._requires[result.require])) {
            this._requires[result.require] = [];
          }
          this._requires[result.require].push({plugin, options});
        }
      }
      return this;
    }
    
    define(protocol, handler) {
      this._protocols[protocol] = handler;
      return this;
    }
    
    setHandler(protocol, handler) {
      this._handlers[protocol] = handler;
      return this;
    }
    
    hasHandler(protocol, name) {
      return this._handlers[protocol] && (typeof this._handlers[protocol][name] === 'function');
    }
    
    applyHandler(protocol, name, ...args) {
      return this._handlers[protocol][name](...args);
    }
    
    setSource(protocol, name, ...data) {
      if (!this._sources[protocol]) {
        this._sources[protocol] = {};
      }
      if (typeof this._handlers[protocol]?.setSource === 'function') {
        const ctx = {
          protocol,
          name,
          sources: this._sources[protocol]
        };
        this._handlers[protocol].setSource(ctx, ...data);
      } else {
        this._sources[protocol][name] = data.at(0);
      }
      return this;
    }
    
    getSource(protocol, name) {
      if (!this._sources[protocol]) {
        return null;
      }
      if (typeof this._handlers[protocol]?.getSource === 'function') {
        const ctx = {
          protocol,
          name,
          sources: this._sources[protocol]
        };
        return this._handlers[protocol].getSource(ctx);
      }
      return this._sources[protocol][name];
    }

    parseAcceptHeader(acceptHeader) {
      if (!acceptHeader) return ['*/*'];
      return acceptHeader
        .split(',')
        .map((item, index) => {
          const parts = item.split(';').map(p => p.trim());
          const mediaType = parts.shift().toLowerCase();
          const params = {};
          let q = 1.0;
          let paramCount = 0;
          for (const token of parts) {
            const [key, value] = token.split('=').map(p => p?.trim());
            if (key?.toLowerCase() === 'q') {
              const parsedQ = parseFloat(value);
              q = isNaN(parsedQ) ? 1.0 : parsedQ;
            } else if (key) {
              params[key] = value;
              paramCount++;
            }
          }
          let specificity = 2;
          if (mediaType === '*/*') {
            specificity = 0;
          } else if (mediaType.endsWith('/*')) {
            specificity = 1;
          }
          return {
            mediaType,
            q,
            specificity,
            params,
            paramCount,
            index
          };
        })
        .filter(entry => entry.q > 0)
        .sort((a, b) => {
          if (b.q !== a.q) return b.q - a.q;
          if (b.specificity !== a.specificity) return b.specificity - a.specificity;
          if (b.paramCount !== a.paramCount) return b.paramCount - a.paramCount;
          return a.index - b.index;
        })
        .map(entry => { return { type: entry.mediaType, params: entry.params }; });
    }
    
    async fetch(...args) {
      let request = new Request(...args);
      const urlObj = new URL(request.url);
      const protocol = urlObj.protocol.toLowerCase();
      const handler = (typeof this._protocols[protocol] === 'function') ? this._protocols[protocol] : globalThis.fetch;
      if (typeof this._handlers[protocol]?.beforeFetch === 'function') {
        request = this._handlers[protocol]?.beforeFetch(request);
      }
      let response = await Promise.try(handler, request);
      if (typeof this._handlers[protocol]?.afterFetch === 'function') {
        response = this._handlers[protocol]?.afterFetch(response);
      }
      if (!(response instanceof Response)) {
        if (typeof this._handlers[protocol]?.encodeMediaType === 'function') {
          const headers = request.headers;
          const accept = headers.has('Accept') ? headers.get('Accept') : null;
          const acceptTypes = this.parseAcceptHeader(accept);
          for (const mediaType of acceptTypes) {
            const res = this._handlers[protocol].encodeMediaType(response, mediaType);
            if (res instanceof Response) {
              return res;
            }
          }
        }
      }
      return response;
    }
    
    stream(...args) {
      const request = new Request(...args);
      const urlObj = new URL(request.url);
      const protocol = urlObj.protocol.toLowerCase();
      if (typeof this._handlers[protocol]?.stream === 'function') {
        return this._handlers[protocol].stream(...args);
      }
      const { readable, writable } = new TransformStream();
      this.fetch(request)
        .then(res => {
          if (!res.body) {
            throw new Error('Response body is null');
          }
          return res.body.pipeTo(writable);
        })
        .catch(err => {
          writable.abort(err).catch(() => {});
        });
      return readable;
    }
  }
  return CustomClient;
}));
