import {kDisableAll, kSidebar, kStyleIds} from '@/js/consts';
import {__values as __prefs, subscribe} from '@/js/prefs';
import {CHROME, FIREFOX, MOBILE, VIVALDI} from '@/js/ua';
import {debounce, deepCopy, NOP, t} from '@/js/util';
import {
  browserAction, browserSidebar, MF_ICON_EXT, MF_ICON_PATH, openSidebar, paintCanvas,
  toggleListener,
} from '@/js/util-webext';
import * as colorScheme from './color-scheme';
import {bgBusy, bgInit, onSchemeChange} from './common';
import {removePreloadedStyles} from './style-via-webrequest';
import {tabCache, set as tabSet} from './tab-manager';

const staleBadges = new Set();
/** @type {{ [url: string]: ImageData | Promise<ImageData> }} */
const imageDataCache = {};
const badgeOvr = {color: '', text: ''};
// https://github.com/openstyles/stylus/issues/1287 Fenix can't use custom ImageData
const FIREFOX_ANDROID = (__.B_FIREFOX || __.B_ANY && FIREFOX) && MOBILE;
const ICON_SIZES =
  !__.MV3 && VIVALDI ? [19, 38] : // old Vivaldi
    __.MV3 || !(__.B_FIREFOX || __.B_ANY && FIREFOX) ? [16, 32] : // Chromium
      MOBILE ? [32, 38] : // FF mobile 1x, 1.5x, 2x DPI // TODO: +48
        [16, 32, 38]; // FF desktop toolbar and panel 1x, 1.5x, 2x DPI // TODO: 38->48, +64
const kBadgeDisabled = 'badgeDisabled';
const kBadgeNormal = 'badgeNormal';
const kIconset = 'iconset';
const kShowBadge = 'show-badge';
// https://github.com/openstyles/stylus/issues/335
let hasCanvas = FIREFOX_ANDROID ? false : null;

if (browserAction) {
  bgInit.push(initIcons);
  if (browserSidebar) {
    if (__.MV3) try {
      // Gonna unregister in subscribe() if not enabled
      toggleListener(browserAction.onClicked, true, openPopupInSidebar);
    } catch (err) {
      // Some browsers throw "unable to find toolbar item" for a button in the overflow menu
      console.error(err);
    }
    subscribe('popup.sidePanel', (key, val) => {
      try {
        browserAction.setPopup({popup: val ? '' : 'popup.html'});
        toggleListener(browserAction.onClicked, val, openPopupInSidebar);
      } catch (err) {
        console.error(err);
      }
    }, true);
  }
}

onSchemeChange.add(() => {
  if (__prefs[kIconset] === -1) {
    debounce(refreshGlobalIcon);
    debounce(refreshAllIcons);
  }
});

export async function refreshIconsWhenReady() {
  if (!browserAction)
    return;
  if (bgBusy) {
    bgInit[bgInit.indexOf(initIcons)] = 0;
    await bgBusy;
  }
  initIcons(true);
}

function initIcons(runNow = !__.MV3) {
  subscribe([
    kDisableAll,
    kBadgeDisabled,
    kBadgeNormal,
  ], () => {
    debounce(refreshIconBadgeColor);
    debounce(refreshAllIcons); // the active-style dot uses the badge colors
  }, runNow);
  subscribe([
    kShowBadge,
  ], () => debounce(refreshAllIconsBadgeText), runNow);
  subscribe([
    kDisableAll,
    kIconset,
  ], () => debounce(refreshAllIcons), runNow);
}

/**
 * @param {(number|string)[]} styleIds
 * @param {boolean} [lazyBadge] preventing flicker during page load
 * @param {number} [iid] instance id
 */
export function updateIconBadge(styleIds, lazyBadge, iid) {
  // FIXME: in some cases, we only have to redraw the badge. is it worth a optimization?
  const {tab: {id: tabId}, TDM} = this.sender;
  const frameId = TDM > 0 ? 0 : this.sender.frameId;
  const value = styleIds.length ? styleIds.map(Number) : undefined;
  tabSet(tabId, kStyleIds, frameId, value);
  if (iid) tabSet(tabId, 'iid', frameId, (!__.MV3 || value) && iid);
  debounce(refreshStaleBadges, frameId && lazyBadge ? 250 : 0);
  staleBadges.add(tabId);
  if (!frameId) refreshIcon(tabId, true);
  removePreloadedStyles(null, tabId + ':' + frameId);
}

  /** Calling with no params clears the override */
export function overrideBadge({text = '', color = '', title = ''} = {}) {
  if (badgeOvr.text === text) {
    return;
  }
  badgeOvr.text = text;
  badgeOvr.color = color;
  refreshIconBadgeColor();
  setBadgeText({text});
  for (let tabId in tabCache) {
    tabId = +tabId;
    if (text) {
      setBadgeText({tabId, text});
    } else {
      refreshIconBadgeText(tabId);
    }
  }
  browserAction.setTitle({
    title: title && t(title, '', false) || title || '',
  }).catch(NOP);
}

function refreshIconBadgeText(tabId) {
  if (badgeOvr.text) return;
  /* Active-style indicator is a small dot painted onto the icon in setIcon();
     the native badge is too large, so it's only a fallback when canvas is unavailable */
  const text = FIREFOX_ANDROID && __prefs[kShowBadge] && getStyleCount(tabId) ? '●' : '';
  setBadgeText({tabId, text});
  refreshIcon(tabId);
}

function getIconName(hasStyles = false) {
  const i = __prefs[kIconset];
  const prefix = i === 0 || i === -1 && colorScheme.isDark ? '' : 'light/';
  const postfix = __prefs[kDisableAll] ? 'x' : !hasStyles ? 'w' : '';
  return `${prefix}$SIZE$${postfix}`;
}

function refreshIcon(tabId, force = false) {
  const td = tabCache[tabId] ??= (
    __.DEBUGLOG('refreshIcon missing %d in tabCache', tabId, deepCopy(tabCache)),
    {id: tabId}
  );
  const oldIcon = td.icon;
  const hasStyles = td[kStyleIds]?.[0];
  const dot = !!(hasStyles && __prefs[kShowBadge]) && getDotColor();
  const iconName = getIconName(hasStyles);
  const newIcon = iconName + (dot || '');
  // (changing the icon only for the main page, frameId = 0)
  if (!force && oldIcon === newIcon) {
    return;
  }
  tabSet(tabId, 'icon', newIcon);
  setIcon({
    path: getIconPath(iconName),
    tabId,
  }, dot);
}

function getDotColor() {
  return __prefs[__prefs[kDisableAll] ? kBadgeDisabled : kBadgeNormal];
}

function getIconPath(icon) {
  return ICON_SIZES.reduce(
    (obj, size) => {
      obj[size] = MF_ICON_PATH + icon.replace('$SIZE$', size) + MF_ICON_EXT;
      return obj;
    },
    {}
  );
}

/** @return {number | ''} */
function getStyleCount(tabId) {
  const allIds = new Set();
  for (const frameData of Object.values(tabCache[tabId]?.[kStyleIds] || {}))
    frameData.forEach(allIds.add, allIds);
  return allIds.size || '';
}

// Caches imageData for icon paths.
// Never rejects: returns null on failure (e.g. transient "Failed to fetch"
// while the SW is spinning up) so callers can fall back and retry later.
async function loadImage(url) {
  let img;
  try {
    img = __.B_CHROME || __.B_ANY && CHROME
      ? await createImageBitmap(await (await fetch(url)).blob())
      : await new Promise((resolve, reject) =>
        Object.assign(new Image(), {
          src: url,
          onload: e => resolve(e.target),
          onerror: reject,
        }));
  } catch {
    delete imageDataCache[url]; // don't leave a rejected promise cached
    return null;
  }
  const {width: w, height: h} = img;
  const result = paintCanvas(w, h, ctx => ctx.drawImage(img, 0, 0, w, h));
  imageDataCache[url] = result;
  return result;
}

/** @param {chrome.tabs.Tab} tab */
function openPopupInSidebar(tab) {
  openSidebar('popup.html?' + kSidebar, false, {tabId: tab.id});
}

function refreshGlobalIcon() {
  setIcon({
    path: getIconPath(getIconName()),
  });
}

function refreshIconBadgeColor() {
  setBadgeBackgroundColor({
    color: badgeOvr.color ||
      __prefs[__prefs[kDisableAll] ? kBadgeDisabled : kBadgeNormal],
  });
}

function refreshAllIcons() {
  __.DEBUGLOG('refreshAllIcons', deepCopy(tabCache));
  for (const tabId in tabCache) {
    refreshIcon(+tabId);
  }
  refreshGlobalIcon();
}

function refreshAllIconsBadgeText() {
  __.DEBUGLOG('refreshAllIconsBadgeText', deepCopy(tabCache));
  for (const tabId in tabCache) {
    refreshIconBadgeText(+tabId);
  }
}

function refreshStaleBadges() {
  __.DEBUGLOG('refreshStaleBadges', [...staleBadges]);
  for (const tabId of staleBadges) {
    refreshIconBadgeText(tabId);
  }
  staleBadges.clear();
}

/**
 * @param {chrome.browserAction.TabIconDetails} data
 * @param {string} [dot] paints a small active-style dot of this color in the bottom-right corner
 */
async function setIcon(data, dot) {
  if (hasCanvas == null) {
    const url = MF_ICON_PATH + ICON_SIZES[0] + MF_ICON_EXT;
    const probe = await (imageDataCache[url] = loadImage(url));
    hasCanvas = probe ? probe.data.some(b => b !== 255) : (delete imageDataCache[url], null);
  } else if (hasCanvas.then) {
    hasCanvas = await hasCanvas;
  }
  if (hasCanvas) {
    const imageData = {};
    for (const [key, url] of Object.entries(data.path)) {
      const cacheKey = dot ? `${url}|${dot}|${colorScheme.isDark ? 'd' : 'l'}` : url;
      let val = imageDataCache[cacheKey];
      if (!val) {
        val = imageDataCache[url] || (imageDataCache[url] = loadImage(url));
        if (dot) {
          val = imageDataCache[cacheKey] = Promise.resolve(val)
            .then(img => img && paintDot(img));
        }
      }
      val = val.then ? await val : val;
      // any size failed to load -> drop the poisoned entry and fall back to path icons
      if (!val) {
        delete imageDataCache[cacheKey];
        return void browserAction.setIcon(data).catch(NOP);
      }
      imageData[key] = val;
    }
    data.imageData = imageData;
    delete data.path;
  }
  browserAction.setIcon(data).catch(NOP);
}

/** @param {ImageData} img */
function paintDot(img) {
  const {width: w, height: h} = img;
  const r = w * 3 / 16; // 3px radius on the 16px icon, scales with DPI variants
  const bw = w * 2 / 16; // 2px border on the 16px icon, scales with DPI variants
  // A blue dot with a border matching the toolbar (dark border on a dark
  // toolbar, light on a light one) so the dot reads cleanly on either.
  const dotColor = '#1f6fe5';
  const borderColor = colorScheme.isDark ? '#000' : '#fff';
  return paintCanvas(w, h, ctx => {
    ctx.putImageData(img, 0, 0);
    // outer border circle
    ctx.fillStyle = borderColor;
    ctx.beginPath();
    ctx.arc(w - r, h - r, r + bw, 0, 2 * Math.PI);
    ctx.fill();
    // inner blue dot
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(w - r, h - r, r, 0, 2 * Math.PI);
    ctx.fill();
  });
}

/** @param {chrome.browserAction.BadgeTextDetails} data */
function setBadgeText(data) {
  browserAction.setBadgeText(data).catch(NOP);
}

/** @param {chrome.browserAction.BadgeBackgroundColorDetails} data */
function setBadgeBackgroundColor(data) {
  browserAction.setBadgeBackgroundColor(data).catch(NOP);
}
