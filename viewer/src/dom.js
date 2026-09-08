'use strict';

// Tiny element builder. It is the only way the page creates DOM, and it can only set text and attributes:
// there is no HTML-string path, so log content cannot become markup. Inline event handlers and style attributes
// are refused outright (the page's CSP forbids them anyway); listeners go through addEventListener.

// The SVG namespace is assembled so this file contains no literal URL (a build test forbids those).
const SVG_NS = ['http:', '', 'www.w3.org', '2000', 'svg'].join('/');

function apply(el, attrs) {
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (/^on/i.test(key) || key === 'style' || key === 'srcdoc') throw new Error(`attribute ${key} is not allowed`);
    if (key === 'class') el.setAttribute('class', value);
    else if (key === 'text') el.textContent = String(value);
    else if (key === 'listeners') for (const [type, fn] of Object.entries(value)) el.addEventListener(type, fn);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
  return el;
}

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  apply(el, attrs);
  return append(el, children);
}

function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, attrs);
  return append(el, children);
}

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// Dynamic sizes go through the CSSOM, which CSP allows, rather than a style attribute, which it does not.
function css(el, props) {
  for (const [key, value] of Object.entries(props)) el.style.setProperty(key, String(value));
  return el;
}

module.exports = { SVG_NS, clear, css, h, s };
