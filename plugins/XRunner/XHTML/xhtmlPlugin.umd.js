(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.xhtmlPlugin = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  function xhtmlPlugin(runner, options) {
    if ((runner.mode !== 'XHTML') || !runner.strict) return;
    const loaded = runner.plugins, requires = [];
    for (const require of requires) {
      if (!loaded.has(require)) {
        return {require};
      }
    }
    const ns = 'http://www.w3.org/1999/xhtml';
    const anyElement = {
      getNode(ctx) {
        const node = document.createElement(this.localName);
        for (const attr of this.attributes) {
          node.setAttribute(attr.name, attr.value);
        }
        node.append(...ctx.getChildNodes(this, 'getNode'));
        return node;
      }
    };
    const tText = {
      getNode(ctx) {
        return this.textContent;
      }
    };
    const unknown = (ctx, ...args) => {
      if (ctx.method === 'getNode') {
        return document.createDocumentFragment();
      }
      return null;
    };
    
    runner
      .defineNS('element', ns, '*', anyElement)
      .setNodeType(Node.TEXT_NODE, tText)
      .setHandler('unknownMethod', unknown);
    
    return {name: 'XHTML Core'};
  }
  return xhtmlPlugin;
}));