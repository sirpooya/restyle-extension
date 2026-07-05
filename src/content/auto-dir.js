/*
 Implements the custom `direction: bidi` value (see CLAUDE.md):
 elements matching a selector whose declaration block contains `direction: bidi`
 get a live `dir="rtl"` or `dir="ltr"` attribute based on their first strong
 directional character, like the native dir="auto" but re-evaluated on DOM changes.
 The declaration itself is invalid CSS and is ignored by the browser.
*/

/** Tracks elements we touched; holds the element's original `dir` ('-' = none) */
const MARK = 'stylus-autodir';
/** A property name boundary avoids matching e.g. `animation-direction: ...` */
const RX_BIDI = /(?<![-\w])direction\s*:\s*bidi(?![-\w])/gi;
const RX_COMMENT = /\/\*[\s\S]*?\*\//g;
/** First strong directional character: LRM/RLM marks or any letter (digits/punctuation are weak) */
const RX_STRONG = /[\u200E\u200F\p{L}]/u;
/** RTL scripts: Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan, Mandaic, Arabic Extended-A/B
    + presentation forms + RLM */
const RX_RTL = /[\u200F\u0590-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFC]/u;

let selectorStr = '';
/** @type {MutationObserver} */
let observer;

/** @param {Injection.SectionsContent[]} [styles] falsy = deactivate */
export function updateAutoDir(styles) {
  const sels = [];
  if (styles) {
    for (const {code} of styles) {
      for (const sel of extractSelectors(code)) {
        if (!sels.includes(sel) && isValidSelector(sel)) sels.push(sel);
      }
    }
  }
  const str = sels.join(',');
  if (str === selectorStr) return;
  if (selectorStr) restoreAll();
  selectorStr = str;
  if (!str) {
    observer?.disconnect();
    return;
  }
  observer ??= new MutationObserver(onMutations);
  // re-observing the same target just replaces the registration
  observer.observe(document, {childList: true, subtree: true, characterData: true});
  processAll();
}

function extractSelectors(code) {
  const res = [];
  let m;
  code = code.replace(RX_COMMENT, '');
  RX_BIDI.lastIndex = 0;
  while ((m = RX_BIDI.exec(code))) {
    const open = code.lastIndexOf('{', m.index);
    // must be directly inside a declaration block
    if (open < 0 || code.lastIndexOf('}', m.index) > open) continue;
    const start = Math.max(
      code.lastIndexOf('{', open - 1),
      code.lastIndexOf('}', open - 1),
      code.lastIndexOf(';', open - 1)) + 1;
    const sel = code.slice(start, open).trim();
    if (sel && sel[0] !== '@' && !res.includes(sel)) res.push(sel);
  }
  return res;
}

function isValidSelector(sel) {
  try {
    document.createDocumentFragment().querySelector(sel);
    return true;
  } catch {
    return false;
  }
}

function processAll() {
  for (const el of document.querySelectorAll(selectorStr)) applyDir(el);
}

/** @param {Element} el */
function applyDir(el) {
  const m = RX_STRONG.exec(el.textContent);
  if (!m) return; // no strong character yet; a later mutation will re-check
  const dir = RX_RTL.test(m[0]) ? 'rtl' : 'ltr';
  if (!el.hasAttribute(MARK)) el.setAttribute(MARK, el.getAttribute('dir') || '-');
  if (el.getAttribute('dir') !== dir) el.setAttribute('dir', dir);
}

function restoreAll() {
  for (const el of document.querySelectorAll(`[${MARK}]`)) {
    const orig = el.getAttribute(MARK);
    if (orig === '-') el.removeAttribute('dir');
    else el.setAttribute('dir', orig);
    el.removeAttribute(MARK);
  }
}

/** @param {MutationRecord[]} mutations */
function onMutations(mutations) {
  for (const m of mutations) {
    if (m.type === 'characterData') {
      recheckClosest(m.target);
    } else {
      for (const n of m.addedNodes) {
        if (n.nodeType === Node.ELEMENT_NODE) {
          if (n.matches(selectorStr)) applyDir(n);
          for (const el of n.querySelectorAll(selectorStr)) applyDir(el);
        } else if (n.nodeType === Node.TEXT_NODE) {
          recheckClosest(n);
        }
      }
    }
  }
}

/** Text changed somewhere: re-evaluate the nearest matching ancestor */
function recheckClosest(node) {
  const el = node.parentElement?.closest(selectorStr);
  if (el) applyDir(el);
}
