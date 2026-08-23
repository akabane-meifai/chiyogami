(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.xIncludePlugin = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  function xIncludePlugin(runner, options) {
    if ((runner.mode !== 'XHTML') || !runner.strict) return;
    const loaded = runner.plugins, requires = ['XHTML Core'];
    for (const require of requires) {
      if (!loaded.has(require)) {
        return {require};
      }
    }
    const ns = 'http://www.w3.org/2001/XInclude';
    const cache = (options.cache && typeof options.cache === 'object') ? options.cache : {};
    const parser = new DOMParser();
    const evaluateXPointer = (doc, xpointerStr) => null;
    const eInclude = {
      getNode(ctx) {
        if (this.hasAttribute('href')) {
          const href = this.getAttribute('href');
          const getInclde = data => {
            if (this.hasAttribute('parse') && this.getAttribute('parse') === 'text') {
              return data;
            }
            if (this.hasAttribute('xpointer')) {
              const xpointer = this.getAttribute('xpointer');
              const targetNodes = evaluateXPointer(doc, xpointer);
              const fragment = document.createDocumentFragment();
              if (targetNodes && targetNodes.length > 0) {
                const nodes = Array.from(targetNodes, node => ctx.runner.fromNode(node, 'getNode'));
                fragment.append(...nodes);
              }
              return fragment;
            }
            return ctx.runner.fromString(data, 'getNode');
          };
          if (cache[href]) {
            return getInclde(cache[href]);
          }
          const placeholder = (typeof options.createPlaceholder === 'function') ? options.createPlaceholder(this) : document.createTextNode('');
          const promise = (typeof options.getContents === 'function') ? options.getContents(href) : fetch(href).then(res => res.text());
          promise.then(data => {
            cache[href] = data;
            placeholder.replaceWith(getInclde(data));
          }).catch(error => {
            const node = (typeof options.createError === 'function') ? options.createError(error, this) : href;
            placeholder.replaceWith(node);
          });
          return placeholder;
        }
        return '';
      }
    };
    runner
      .defineNS('element', ns, 'include', eInclude);
    
    return {name: 'XHTML XInclude'};
  }
  return xIncludePlugin;
}));