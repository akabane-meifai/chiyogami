(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.XRunner = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  const ANY_NS = Symbol('ANY_NS');
  class XRunner {
    constructor(options = {}) {
      const entries1 = (typeof options?.elements === 'object') ? Object.entries(options.elements ?? {}) : [];
      const entries2 = (typeof options?.attributes === 'object') ? Object.entries(options.attributes ?? {}) : [];
      Object.assign(this, {
        _parser: new DOMParser(),
        _strict: options?.strict ?? true,
        _mode: options?.mode ?? null,
        _handlers: (options?.handlers && typeof options.handlers === 'object') ? options.handlers : {},
        _elements: {},
        _attributes: {},
        _nodeTypes: (options?.nodeTypes && typeof options.nodeTypes === 'object') ? options.nodeTypes : {},
        _plugins: new Set(),
        _requires: {},
        _meta: new WeakMap()
      });
      if (this._strict) {
        for (const item of entries1) {
          const [namespaceURI, obj] = item;
          if (!obj || typeof obj !== 'object') {
            continue;
          }
          for (const item2 of Object.entries(obj)) {
            this.defineNS('element', namespaceURI, ...item2);
          }
        }
        for (const item of entries2) {
          const [namespaceURI, obj] = item;
          if (!obj || typeof obj !== 'object') {
            continue;
          }
          for (const item2 of Object.entries(obj)) {
            this.defineNS('attribute', namespaceURI, ...item2);
          }
        }
      } else {
        for (const item of entries1) {
          this.define('element', ...item);
        }
        for (const item of entries2) {
          this.define('attribute', ...item);
        }
      }
    }
    
    get strict() {
      return this._strict;
    }
    
    get mode() {
      return this._mode;
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
    
    define(type, localName, object) {
      return this.defineNS(type, '', localName, object);
    }
    
    defineLN(type, localName, object) {
      return this.defineNS(type, ANY_NS, localName, object);
    }
    
    defineNS(type, namespaceURI, localName, object) {
      const localName2 = this._strict ? localName : localName.toLowerCase();
      const target = (type === 'attribute') ? this._attributes : this._elements;
      if (object == null) {
        if (namespaceURI in target) {
          delete target[namespaceURI][localName2];
        }
      } else {
        if (!(namespaceURI in target)) {
          target[namespaceURI] = {};
        }
        target[namespaceURI][localName2] = object;
      }
      return this;
    }
    
    extend(type, localName, object) {
      return this.extendNS(type, '', localName, object);
    }
    
    extendLN(type, localName, object) {
      return this.extendNS(type, ANY_NS, localName, object);
    }
    
    extendNS(type, namespaceURI, localName, object) {
      const localName2 = this._strict ? localName : localName.toLowerCase();
      const target = (type === 'attribute') ? this._attributes : this._elements;
      if (!target[namespaceURI] || !target[namespaceURI][localName2]) {
        return this;
      }
      Object.assign(target[namespaceURI][localName2], object);
      return this;
    }
    
    setNodeType(type, object) {
      this._nodeTypes[type] = object;
      return this;
    }
    
    setHandler(name, handler) {
      this._handlers[name] = handler;
      return this;
    }
    
    getElementMethod(namespaceURI, element, method) {
      const localName1 = element.localName;
      const localName2 = this._strict ? localName1 : localName1.toLowerCase();
      let object = this._elements[namespaceURI] && this._elements[namespaceURI][localName2];
      if (object && typeof object[method] === 'function') return object[method];
      object = this._elements[namespaceURI] && this._elements[namespaceURI]['*'];
      if (object && typeof object[method] === 'function') return object[method];
      object = this._elements[ANY_NS] && this._elements[ANY_NS][localName2];
      if (object && typeof object[method] === 'function') return object[method];
      object = this._elements[ANY_NS] && this._elements[ANY_NS]['*'];
      if (object && typeof object[method] === 'function') return object[method];
      object = this._nodeTypes[Node.ELEMENT_NODE];
      if (object && typeof object[method] === 'function') return object[method];
      if (typeof this._handlers.unknownMethod === 'function') return this._handlers.unknownMethod;
      if (namespaceURI === '') {
        throw new Error(`Method "${method}" for tag "${localName2}" is not defined.`);
      } else {
        throw new Error(`Method "${method}" for tag "{${namespaceURI}}${localName1}" is not defined.`);
      }
    }
    
    getAttributeMethod(namespaceURI, attribute, method) {
      const localName1 = attribute.localName;
      const localName2 = this._strict ? localName1 : localName1.toLowerCase();
      let object = this._attributes[namespaceURI] && this._attributes[namespaceURI][localName2];
      if (object && typeof object[method] === 'function') return object[method];
      object = this._attributes[namespaceURI] && this._attributes[namespaceURI]['*'];
      if (object && typeof object[method] === 'function') return object[method];
      object = this._attributes[ANY_NS] && this._attributes[ANY_NS][localName2];
      if (object && typeof object[method] === 'function') return object[method];
      object = this._attributes[ANY_NS] && this._attributes[ANY_NS]['*'];
      if (object && typeof object[method] === 'function') return object[method];
      object = this._nodeTypes[Node.ATTRIBUTE_NODE];
      if (object && typeof object[method] === 'function') return object[method];
      if (typeof this._handlers.unknownMethod === 'function') return this._handlers.unknownMethod;
      if (namespaceURI === '') {
        throw new Error(`Method "${method}" for attr "${localName2}" is not defined.`);
      } else {
        throw new Error(`Method "${method}" for attr "{${namespaceURI}}${localName1}" is not defined.`);
      }
    }
    
    getNodeMethod(node, method) {
      const nodeType = node.nodeType;
      const object = this._nodeTypes[nodeType];
      if (!object || typeof object[method] !== 'function') {
        if (typeof this._handlers.unknownMethod === 'function') {
          return this._handlers.unknownMethod;
        }
        throw new Error(`Method "${method}" for type "${nodeType}" is not defined.`);
      }
      return object[method];
    }
    
    run(node, method, ...args) {
      const node2 = ((node.nodeType === Node.DOCUMENT_NODE) && !(Node.DOCUMENT_NODE in this._nodeTypes)) ? node.documentElement : node;
      if (node2.nodeType === Node.ELEMENT_NODE) {
        const namespaceURI = this._strict ? (node2.namespaceURI ?? '') : '';
        return this.getElementMethod(namespaceURI, node2, method).call(node2, {
          method,
          run(...args){
            return this.runner.run(...args);
          },
          getElement(...args){
            return this.runner.getElement(...args);
          },
          getChildNodes(...args){
            return this.runner.getChildNodes(...args);
          },
          getMeta(...args){
            return this.runner.getMeta(...args);
          },
          setMeta(...args){
            return this.runner.setMeta(...args);
          },
          runner: this
        }, ...args);
      }
      if (node2.nodeType === Node.ATTRIBUTE_NODE) {
        const namespaceURI = this._strict ? (node2.namespaceURI ?? '') : '';
        return this.getAttributeMethod(namespaceURI, node2, method).call(node2, {
          method,
          run(...args){
            return this.runner.run(...args);
          },
          runner: this
        }, ...args);
      }
      return this.getNodeMethod(node, method).call(node, {
        method,
        run(...args){
          return this.runner.run(...args);
        },
        runner: this
      }, ...args);
    }
    
    fromNode(node, method, ...args) {
      const ctx = {node, method, args};
      if (typeof this._handlers.preRun === 'function') {
        this._handlers.preRun(ctx);
      }
      ctx.result = this.run(ctx.node, ctx.method, ...ctx.args);
      if (typeof this._handlers.postRun === 'function') {
        this._handlers.postRun(ctx);
      }
      return ctx.result;
    }
    
    fromString(xml, ...args) {
      const doc = this._parser.parseFromString(xml, "application/xml");
      const parserError = doc.querySelector('parsererror');
      if (parserError) {
        throw new Error(`XML Parsing Error: ${parserError.textContent}`);
      }
      if (args.length == 0) {
        return doc;
      }
      return this.fromNode(doc, ...args);
    }
    
    getElement(node, ...args) {
      let element = null;
      switch (node.nodeType) {
        case Node.ELEMENT_NODE:
          element = node;
          break;
        case Node.DOCUMENT_NODE:
          element = node.documentElement;
          break;
        case Node.ATTRIBUTE_NODE:
          element = node.ownerElement;
          break;
        case Node.TEXT_NODE:
        case Node.CDATA_SECTION_NODE:
        case Node.COMMENT_NODE:
          element = node.parentElement;
          break;
      }
      if (element && args.length > 0) {
        return this.run(element, ...args);
      }
      return element;
    }
    
    getChildNodes(node, ...args) {
      const callback = (args.length > 0) ? (node => this.run(node, ...args)) : (node => node);
      return Array.from(node.childNodes, callback);
    }
    
    getMeta(node) {
      return this._meta.has(node) ? this._meta.get(node) : null;
    }
    
    setMeta(node, value) {
      this._meta.set(node, value);
    }
  }
  return XRunner;
}));
