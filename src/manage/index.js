import '@/js/dom-init';
import {kNone, kSidebar, pSync} from '@/js/consts';
import {$create, $toggleDataset} from '@/js/dom';
import {setupLiveDetails, setupLivePrefs} from '@/js/dom-prefs';
import {animateElement, messageBox} from '@/js/dom-util';
import {onMessage} from '@/js/msg';
import {swController} from '@/js/msg-init';
import * as prefs from '@/js/prefs';
import * as syncUtil from '@/js/sync-util';
import {favicon} from '@/js/urls';
import {isSidebar, t} from '@/js/util';
import InjectionOrder from './injection-order';
import {showStyles} from './render';
import * as router from './router';
import * as sorter from './sorter';
import UpdateHistory from './updater-ui';
import {UI} from './util';
import './events';
import './incremental-search';
import './manage.css';
import './manage-table.css';
import '@/css/onoffswitch.css';
import '@/css/target-site.css';
import '@/css/theme-modern.css';

(async () => {
  const data = __.MV3 && swController ? prefs.clientData : await prefs.clientData;
  const selectorOpts = '#manage-options-button, #sync-styles';
  setupLiveDetails();
  setupLivePrefs();
  UI.render(true);
  sorter.init();
  if (isSidebar) {
    for (const el of $$(selectorOpts))
      el.on('click', () => location.assign(`/options.html?${kSidebar}#${el.id}`));
  } else {
    router.makeToggle(selectorOpts, 'stylus-options', EmbeddedOptions);
  }
  router.makeToggle('#injection-order-button', 'injection-order', InjectionOrder);
  router.makeToggle('#update-history-button', 'update-history', UpdateHistory);
  router.update();
  showStyles(__.MV3 ? JSON.parse(data.styles || '[]') : data.styles || [], data.ids);
  initSyncButton(data.sync || {});
  initGetStylesButton();
  initDropdownMenus();
  initEmptyState();
  initBottomBar();
  import('./import-export');
})();

function initBottomBar() {
  // Each bottom-bar button forwards its click to the real sidebar control,
  // keeping a single source of truth for behavior (same pattern as the empty state).
  const forward = (fromId, toId) => {
    const from = $id(fromId);
    if (from) from.on('click', () => $id(toId).click());
  };
  forward('bottom-options', 'manage-options-button');
  forward('bottom-write-style', 'add-style');
  forward('bottom-sync', 'sync-styles');
  forward('bottom-get-styles', 'get-styles-button');
  forward('bottom-import', 'import');
  forward('bottom-export', 'export');
}

function initEmptyState() {
  // forwards to the real buttons so there's a single source of truth for behavior
  const forward = (fromId, toId) => {
    const from = $id(fromId);
    if (from) from.on('click', () => $id(toId).click());
  };
  forward('empty-import', 'import');
  forward('empty-get-styles', 'get-styles-button');
  forward('empty-write-style', 'add-style');
  forward('empty-sync', 'sync-styles');
}

function initDropdownMenus() {
  const menus = $$('.dropdown-menu');
  if (!menus.length) return;
  // close an open dropdown when clicking anywhere outside it
  document.on('pointerdown', e => {
    for (const menu of menus) {
      if (menu.open && !menu.contains(e.target)) menu.open = false;
    }
  });
  // and on Escape
  document.on('keydown', e => {
    if (e.key !== 'Escape') return;
    for (const menu of menus) {
      if (menu.open) menu.open = false;
    }
  });
}

function initGetStylesButton() {
  const btn = $id('get-styles-button');
  if (!btn) return;
  btn.on('click', () => {
    const content = $id('get-styles-content').cloneNode(true);
    content.removeAttribute('hidden');
    content.removeAttribute('id');
    messageBox.show({
      title: t('linkGetStyles'),
      contents: content,
      className: 'center-dialog',
      buttons: [t('confirmClose')],
    });
  });
}

// translate CSS manually
document.styleSheets[0].insertRule(
  `:root {${[
    'genericDisabledLabel',
    'updateAllCheckSucceededSomeEdited',
    'filteredStylesAllHidden',
  ].map(id => `--${id}:"${CSS.escape(t(id))}";`).join('')
  }}`);

function initSyncButton(sync) {
  const el = $id('sync-styles');
  const elMsg = $id('sync-status');
  const render = val => {
    const driveId = val.drive || prefs.__values[pSync];
    const drive = syncUtil.DRIVE_NAMES[driveId];
    const hasFav = drive && driveId !== 'webdav';
    const img = el.$('img');
    const msg = drive ? syncUtil.getStatusText(val) : '';
    el.title = t('optionsCustomizeSync');
    el.classList.toggle('icon', !hasFav);
    $toggleDataset(el, 'cloud', drive);
    elMsg.textContent = msg === syncUtil.pending || msg === syncUtil.connected ? '' : msg;
    img.hidden = !hasFav;
    img.src = hasFav ? favicon(driveId + '.com') : '';
    el.$('i').hidden = hasFav;
  };
  onMessage.set(e => {
    if (e.method === 'syncStatusUpdate') render(e.status);
  });
  prefs.subscribe(pSync, (k, v) => v === kNone && render({}));
  render(sync);
}

async function EmbeddedOptions(show, el, selector, toggler) {
  document.title = t(show ? 'optionsHeading' : 'styleManager');
  // TODO: use messageBox() or a dockable sidepanel or the chrome.sidePanel API
  if (show) {
    el = $root.appendChild($create('iframe' + selector, {src: '/options.html#' + toggler.id}));
    el.focus();
    await new Promise(resolve => (window.closeOptions = resolve));
  } else {
    el.contentDocument.activeElement?.blur(); // auto-save text input on closing
    await animateElement(el, 'fadeout');
    el.remove();
  }
}
