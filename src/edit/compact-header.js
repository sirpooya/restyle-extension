import {$create} from '@/js/dom';
import {mqCompact} from '@/js/dom-init';
import {important} from '@/js/dom-util';
import editor from './editor';

const h = $('#header');
export const toggleSticky = val => h.classList.toggle('sticky', val);
export let sticky;

export default function CompactHeader() {
  // Set up mini-header on scroll
  const {isUsercss} = editor;
  const elHeader = $create('div', {
    style: important(`
      top: 0;
      height: 1px;
      position: absolute;
      visibility: hidden;
    `),
  });
  const scroller = isUsercss ? $('.CodeMirror-scroll') : document.body;
  const xoRoot = isUsercss ? scroller : undefined;
  const xo = new IntersectionObserver(onScrolled, {root: xoRoot});
  const elIconized = $$('[data-icon]');
  $('#new-as').onclick = () => {
    if (!editor.style.id && !editor.dirty.isDirty()) {
      location.reload();
    }
  };
  scroller.appendChild(elHeader);
  mqCompact(val => {
    if (val) {
      xo.observe(elHeader);
    } else {
      xo.disconnect();
    }
    for (const el of elIconized)
      el.title = val ? el.textContent : '';
  });

  // Center each compact tab-popup under its icon button, clamped to the viewport.
  const wrap = $('#details-wrapper');
  if (wrap) {
    for (const d of wrap.children) {
      if (d.localName === 'details') {
        d.on('toggle', () => d.open && positionCompactPopup(d));
      }
    }
    // reposition open popups when the toolbar reflows (resize / wrap changes)
    window.on('resize', () => {
      for (const d of wrap.children) {
        if (d.localName === 'details' && d.open) positionCompactPopup(d);
      }
    });
  }

  /** @param {IntersectionObserverEntry[]} entries */
  function onScrolled(entries) {
    sticky = !entries.pop().intersectionRatio;
    if (!isUsercss) scroller.style.paddingTop = sticky ? h.offsetHeight + 'px' : '';
    toggleSticky(sticky);
  }
}

const POPUP_MARGIN = 8; // keep this gap from the viewport edges

/**
 * Compact layout only: center the panel's popup under its icon-button tab,
 * then clamp it so it never runs past the left/right edge of the screen.
 * The popup is absolutely positioned relative to its <details> (the tab), so
 * we express the result as --popup-left (offset from the tab's left edge).
 * @param {HTMLDetailsElement} details
 */
function positionCompactPopup(details) {
  if (!$root.classList.contains('compact-layout')) return;
  const summary = details.$('summary');
  const popup = summary?.nextElementSibling;
  if (!popup) return;
  // measure natural width without a stale --popup-left affecting layout
  popup.style.setProperty('--popup-left', '0px');
  const tab = summary.getBoundingClientRect();
  const popW = popup.getBoundingClientRect().width;
  const vw = document.documentElement.clientWidth;
  // centered viewport-left of the popup, then clamp into the viewport
  const centeredVpLeft = tab.left + tab.width / 2 - popW / 2;
  const maxVpLeft = vw - POPUP_MARGIN - popW;
  const clampedVpLeft = Math.max(POPUP_MARGIN, Math.min(centeredVpLeft, maxVpLeft));
  // convert to an offset relative to the tab's left edge
  popup.style.setProperty('--popup-left', (clampedVpLeft - tab.left) + 'px');
}
