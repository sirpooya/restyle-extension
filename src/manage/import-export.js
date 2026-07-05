import * as chromeSync from '@/js/chrome-sync';
import {IMPORT_THROTTLE, kAppJson, kStyleIdPrefix, STORAGE_KEY, UCD} from '@/js/consts';
import {$create, $toggleDataset} from '@/js/dom';
import {animateElement, messageBox, scrollElementIntoView} from '@/js/dom-util';
import {API} from '@/js/msg-api';
import * as prefs from '@/js/prefs';
import {getMetaComment, styleJSONseemsValid, styleSectionsEqual} from '@/js/style-util';
import {MOBILE} from '@/js/ua';
import {clipString, debounce, deepCopy, deepEqual, hasOwn, isEmptyObj, t} from '@/js/util';
import {addEntryTitle, queue} from './util';

const btnImport = $id('import');
Object.assign($id('export'), {
  onclick: exportToFile,
  oncontextmenu: exportToFile,
}).on('split-btn', exportToFile);
btnImport.onclick = () => importFromFile();

Object.assign(document.body, {
  ondragover(event) {
    const hasFiles = event.dataTransfer.types.includes('Files');
    event.dataTransfer.dropEffect = hasFiles || event.target.type === 'search' ? 'copy' : 'none';
    this.classList.toggle('dropzone', hasFiles);
    if (hasFiles) {
      event.preventDefault();
      this.classList.remove('fadeout');
    }
  },
  ondragend() {
    animateElement(this, 'fadeout', 'dropzone');
  },
  ondragleave(event) {
    try {
      // in Firefox event.target could be XUL browser and hence there is no permission to access it
      if (event.target === this) {
        this.ondragend();
      }
    } catch {
      this.ondragend();
    }
  },
  ondrop(event) {
    if (event.dataTransfer.files.length) {
      event.preventDefault();
      const elOnly = $('#only-updates input');
      if (elOnly?.checked) elOnly.click();
      // Support dropping many files at once (e.g. a whole cloud-sync folder)
      importFromFile([...event.dataTransfer.files]);
    }
    /* Run import first for a while, then run fadeout which is very CPU-intensive in Chrome */
    setTimeout(() => this.ondragend(), 250);
  },
});

async function collectSettings() {
  const [order, lz] = await Promise.all([
    API.styles.getOrder(),
    chromeSync.getLZValues(),
  ]);
  const prefsObj = deepCopy(prefs.__values);
  for (const key in prefsObj)
    if (!hasOwn(prefs.__defaults, key))
      delete prefsObj[key];
  return {
    [STORAGE_KEY]: prefsObj,
    order,
    ...lz,
  };
}

/**
 * Import from one or more files.
 * @param {File|File[]} [files] - a single File, an array of Files, or nothing to
 *   open a multi-select file picker. Multiple files are merged so a whole
 *   cloud-sync `docs` folder (one style per file) can be imported at once.
 */
async function importFromFile(files) {
  let resolve;
  const el = $tag('input');
  const filesPromise = new Promise(res => (resolve = res));
  try {
    if (files) {
      resolve(Array.isArray(files) ? files : [files]);
    } else {
      el.style.display = 'none';
      el.type = 'file';
      el.multiple = true; // allow selecting many files (bulk import)
      el.accept = kAppJson + (MOBILE ? ',text/plain,.json'/*for GDrive-like apps*/ : '');
      el.acceptCharset = 'utf-8';
      document.body.appendChild(el);
      el.initialValue = el.value;
      el.onchange = () => {
        if (el.value === el.initialValue) return resolve([]);
        resolve([...el.files]);
      };
      el.click();
    }
    const picked = await filesPromise;
    el.remove();
    if (!picked.length) return;
    const texts = await Promise.all(picked.map(readFile));
    const merged = mergeImportTexts(texts);
    if (merged != null) {
      await importFromString(merged);
      setTimeout(() => queue.styles.clear(), IMPORT_THROTTLE * 2);
    } else if (texts.length === 1 && getMetaComment(texts[0], '?')) {
      throw t('dragDropUsercssTabstrip');
    } else {
      throw t('importReportUnchanged');
    }
  } catch (err) {
    messageBox.alert(err.message || err);
  }
  function readFile(file) {
    return new Promise((res, rej) => {
      if (file.size > 1e9) {
        return rej((file.size / 1e9).toFixed(1).replace('.0', '') +
          "GB backup? I don't believe you.");
      }
      const fr = new FileReader();
      fr.onloadend = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsText(file, 'utf-8');
    });
  }
}

/**
 * Merge the text of one or more import files into a single JSON array string
 * suitable for {@link importFromString}. Handles:
 *   - a normal Stylus export (array of settings + styles)
 *   - a single cloud-sync doc: `{doc:{...}, _rev}`
 *   - many cloud-sync docs (one per file), e.g. a synced `docs` folder
 * Returns null if nothing parseable was found.
 */
function mergeImportTexts(texts) {
  const out = [];
  for (const text of texts) {
    if (!/^\s*[[{]/.test(text)) continue;
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      continue; // skip a single malformed file instead of failing the batch
    }
    // Unwrap db-to-cloud sync format: {doc:{...}, _rev}
    if (json && json._rev != null && json.doc && typeof json.doc === 'object') {
      out.push(json.doc);
    } else if (Array.isArray(json)) {
      out.push(...json);
    } else if (json && typeof json === 'object') {
      out.push(json);
    }
  }
  return out.length ? JSON.stringify(out) : null;
}

async function importFromString(jsonString) {
  let json = JSON.parse(jsonString) || [];
  if (json._rev && json._rev === json.doc?._rev)
    json = [json.doc];
  const oldStyles = Array.isArray(json) && json.length ? await API.styles.getAll() : [];
  const oldStylesSet = new Set(oldStyles.sort((a, b) =>
    (a = a.customName || a.name).toLowerCase() <
    (b = b.customName || b.name).toLowerCase() ? -1 : a > b));
  const oldStylesById = new Map(oldStyles.map(style => [style.id, style]));
  const oldStylesByUuid = new Map(oldStyles.map(style => [style._id, style]));
  const oldStylesByCustomName = new Map(oldStyles
    .map(style => style.customName && [style.customName.trim(), style])
    .filter(Boolean));
  const oldStylesByName = new Map(oldStyles.map(style => [style.name.trim(), style]));
  const {order: oldOrder, [STORAGE_KEY]: oldPrefs, ...oldLZ} = await collectSettings();
  const items = [];
  const GROUP = 30;
  const INFO = Symbol('info'); // for private props that shouldn't be transferred into API
  const stats = {
    options: {names: [], isOptions: true, legend: 'optionsHeading'},
    added: {names: [], ids: [], legend: 'importReportLegendAdded', dirty: true},
    unchanged: {names: [], ids: [], legend: 'importReportLegendIdentical'},
    metaAndCode: {names: [], ids: [], legend: 'importReportLegendUpdatedBoth', dirty: true},
    metaOnly: {names: [], ids: [], legend: 'importReportLegendUpdatedMeta', dirty: true},
    codeOnly: {names: [], ids: [], legend: 'importReportLegendUpdatedCode', dirty: true},
    invalid: {names: [], legend: 'importReportLegendInvalid'},
  };
  let order;
  btnImport.disabled = true;
  btnImport.dataset.after = `...`;
  await Promise.all(json.map(analyze));
  for (const group of items) {
    const styles = await API.styles.importMany(group);
    for (let j = 0; j < styles.length; j++) {
      const {style, err} = styles[j];
      const item = group[j];
      if (style) queue.styles.set(style.id, style);
      updateStats(style || item, item[INFO], err);
    }
  }
  // TODO: set each style's order during import on-the-fly
  await API.styles.setOrder(order);
  btnImport.disabled = false;
  delete btnImport.dataset.after;
  return done();

  function analyze(item, index) {
    if (item && !item.id && item[STORAGE_KEY]) {
      return analyzeStorage(item);
    }
    if (
      !item ||
      typeof item !== 'object' || (
        isEmptyObj(item[UCD])
          ? !styleJSONseemsValid(item)
          : typeof item.sourceCode !== 'string'
      )
    ) {
      stats.invalid.names.push(`#${index}: ${
        clipString(item && (item.customName || item.name) || '')
      }`);
      return;
    }
    item.name = item.name.trim();
    const byId = oldStylesById.get(item.id);
    const byUuid = oldStylesByUuid.get(item._id);
    const byName = oldStylesByCustomName.get(item.customName) || oldStylesByName.get(item.name);
    let oldStyle = byUuid;
    if (!oldStyle && byId) {
      if (sameStyle(byId, item)) {
        oldStyle = byId;
      } else {
        delete item.id;
      }
    }
    if (!oldStyle && byName) {
      item.id = byName.id;
      oldStyle = byName;
    }
    oldStylesByCustomName.delete(item.customName);
    oldStylesByName.delete(item.name);
    oldStylesSet.delete(oldStyle);
    const metaEqual = oldStyle && deepEqual(oldStyle, item, ['sections', 'sourceCode', '_rev']);
    const codeEqual = oldStyle && sameCode(oldStyle, item);
    if (metaEqual && codeEqual) {
      stats.unchanged.names.push(oldStyle.name);
      stats.unchanged.ids.push(oldStyle.id);
    } else {
      const i = items.length - 1;
      const group = items[i];
      (!group || group.length >= GROUP ? items[i + 1] = [] : group).push(item);
      item[INFO] = {oldStyle, metaEqual, codeEqual};
    }
  }

  async function analyzeStorage(storage) {
    analyzePrefs(storage[STORAGE_KEY], prefs.knownKeys, prefs.__values, true);
    delete storage[STORAGE_KEY];
    order = storage.order;
    delete storage.order;
    if (!isEmptyObj(storage)) {
      analyzePrefs(storage, Object.values(chromeSync.LZ_KEY), await chromeSync.getLZValues());
    }
  }

  function analyzePrefs(obj, validKeys, values, isPref) {
    for (const [key, val] of Object.entries(obj || {})) {
      const isValid = validKeys.includes(key);
      if (!isValid || !deepEqual(val, values[key])) {
        stats.options.names.push({name: key, val, isValid, isPref});
      }
    }
  }

  function sameCode(oldStyle, newStyle) {
    const d1 = oldStyle[UCD];
    const d2 = newStyle[UCD];
    return !d1 + !d2
      ? styleSectionsEqual(oldStyle, newStyle)
      : oldStyle.sourceCode === newStyle.sourceCode && deepEqual(d1.vars, d2.vars);
  }

  function sameStyle(oldStyle, newStyle) {
    return oldStyle.name.trim() === newStyle.name.trim() ||
      ['updateUrl', 'originalMd5', 'originalDigest']
        .some(field => oldStyle[field] && oldStyle[field] === newStyle[field]);
  }

  function updateStats(style, {oldStyle, metaEqual, codeEqual}, err) {
    if (err) {
      err = (Array.isArray(err) ? err : [err]).map(e => e.message || e).join(', ');
      stats.invalid.names.push(style.name + ' - ' + err);
      return;
    }
    if (!oldStyle) {
      stats.added.names.push(style.name);
      stats.added.ids.push(style.id);
      return;
    }
    if (!metaEqual && !codeEqual) {
      stats.metaAndCode.names.push(reportNameChange(oldStyle, style));
      stats.metaAndCode.ids.push(style.id);
      return;
    }
    if (!codeEqual) {
      stats.codeOnly.names.push(style.name);
      stats.codeOnly.ids.push(style.id);
      return;
    }
    stats.metaOnly.names.push(reportNameChange(oldStyle, style));
    stats.metaOnly.ids.push(style.id);
  }

  async function done() {
    if (oldStylesSet.size)
      renderOrphans();
    scrollTo(0, 0);
    const entries = Object.entries(stats);
    const numChanged = entries.reduce((sum, [, val]) =>
      sum + (val.dirty ? val.names.length : 0), 0);
    const report = entries.map(renderStats).filter(Boolean);
    const {button} = await messageBox.show({
      title: t('importReportTitle'),
      contents: $create('#import', report.length ? report : t('importReportUnchanged')),
      buttons: [t('confirmClose'), numChanged && t('undo')],
      onshow: bindClick,
    });
    if (button === 1)
      undo();
  }

  function renderStats([id, {ids, names, legend, isOptions, render}]) {
    if (!names.length) return;
    let btn;
    if (isOptions && names.some(_ => _.isValid)) {
      btn = $create('button', t('importLabel'));
      importOptions.call(btn);
    }
    return (
      $create(`details[data-id=${id}]`, {open: names.length < 10}, [
        $create('summary',
          $create('b', (isOptions ? '' : names.length + ' ') + t(legend))),
        render?.(...arguments),
        $create('p', ids
          ? $create('table', names.map(listItemsWithId, ids))
          : names.map(isOptions ? listOptions : listItems, ids)),
        btn,
      ].filter(Boolean))
    );
  }

  function renderOrphans() {
    const ids = Array.from(oldStylesSet, o => o.id);
    const buttons = [
      ['exportLabel', exportOld],
      ['disableStyleLabel', toggleOld],
      ['deleteStyleLabel', removeOld],
    ].map(([key, fn]) => Object.assign($tag('button'), {onclick: fn, innerText: t(key)}));
    const [, elToggle, elDel] = buttons;
    const elRow = $tag('p');
    elRow.append(...buttons);
    stats.orphans = {
      ids,
      names: Array.from(oldStylesSet, o => o.customName || o.name),
      legend: 'importReportLegendOrphans',
      render: () => elRow,
    };
    let del, off;
    function exportOld() {
      exportToFile(null, [...oldStylesSet], '-extras');
    }
    function removeOld() {
      del = !del;
      elToggle.disabled = del;
      updateDOM(elDel, del, 'del', del
        ? API.styles.removeMany(ids)
        : API.styles.importMany([...oldStylesSet]));
    }
    function toggleOld() {
      off = !off;
      updateDOM(elToggle, off, 'off',
        API.styles.toggleMany(ids, !off && Array.from(oldStylesSet, s => s.enabled)));
    }
    async function updateDOM(btn, state, name, promise) {
      btn.disabled = true;
      $toggleDataset(btn, 'undo', state && t('undo'));
      $toggleDataset(elRow.closest('details'), name, state);
      await promise.catch(console.warn);
      btn.disabled = false;
    }
  }

  function listOptions({name, isValid}) {
    const el = $tag(isValid ? 'div' : 'del');
    el.textContent = name + (isValid ? '' : ` (${t(stats.invalid.legend)})`);
    return el;
  }

  function listItems(name) {
    const el = $tag('div');
    el.textContent = name;
    return el;
  }

  /** @this {number[]} */
  function listItemsWithId(name, i) {
    const id = this[i];
    return $create('tr', [
      $create('td', `#${id}`),
      $create(`a[data-id=${id}][href=edit.html?id=${id}]`, name),
    ]);
  }

  async function importOptions() {
    const oldStorage = await chromeSync.get();
    const lz = {};
    for (const {name, val, isValid, isPref} of stats.options.names) {
      if (isValid) {
        if (isPref) {
          prefs.set(name, val);
        } else {
          lz[name] = val;
        }
      }
    }
    chromeSync.setLZValues(lz);
    const label = this.textContent;
    this.textContent = t('undo');
    this.onclick = async () => {
      const curKeys = Object.keys(await chromeSync.get());
      const keysToRemove = curKeys.filter(k => !hasOwn(oldStorage, k));
      await chromeSync.set(oldStorage);
      await chromeSync.remove(keysToRemove);
      this.textContent = label;
      this.onclick = importOptions;
    };
    return this;
  }

  async function undo() {
    const newIds = [
      ...stats.metaAndCode.ids,
      ...stats.metaOnly.ids,
      ...stats.codeOnly.ids,
      ...stats.added.ids,
    ];
    await API.setPrefs(oldPrefs); // must be done before removing/importing to set sync option
    await API.styles.removeMany(newIds);
    await API.styles.importMany(newIds.map(oldStylesById.get, oldStylesById).filter(Boolean));
    await API.styles.setOrder(oldOrder);
    await chromeSync.setLZValues(oldLZ);
    await messageBox.alert(newIds.length + ' ' + t('importReportUndone'),
      '', t('importReportUndoneTitle'));
  }

  function bindClick(box) {
    for (const block of box.$$('details table')) {
      block.onclick = highlightElement;
      block.onmouseover = addTitle;
    }
    function addTitle(evt, el) {
      if (el) {
        const style = oldStylesById.get(+el.dataset.id);
        if (style) addEntryTitle(el, style);
      } else if ((el = evt.target).href && !el.title)
        debounce(addTitle, 50, null, evt.target);
    }
    function highlightElement(event) {
      event.preventDefault();
      const styleElement = $id(kStyleIdPrefix + event.target.dataset.id);
      if (styleElement) {
        scrollElementIntoView(styleElement);
        animateElement(styleElement);
      }
    }
  }

  function reportNameChange(oldStyle, newStyle) {
    return newStyle.name !== oldStyle.name
      ? oldStyle.name + ' —> ' + newStyle.name
      : oldStyle.name;
  }
}

/**
 * @param {MouseEvent} [e]
 * @param {StyleObj[]} [styles]
 * @param {string} [suffix]
 */
async function exportToFile(e, styles, suffix = '') {
  e?.preventDefault();
  const keepDupSections = e && (e.type === 'contextmenu' || e.shiftKey || e.detail === 'compat');
  const data = [
    await collectSettings(),
    ...(styles || await API.styles.getAll()).map(cleanupStyle),
  ];
  const text = JSON.stringify(data, null, '  ');
  const type = kAppJson;
  const today = new Date();
  $create('a', {
    href: URL.createObjectURL(new Blob([text], {type})),
    download: 'stylus-' + // YYYY-MM-DD-HH-mm
      today.toLocaleString('sv').replace(/[\s:]/g, '-').slice(0, -3) + suffix + '.json',
    type,
  }).dispatchEvent(new MouseEvent('click'));
  /** strip `sections`, `null` and empty objects */
  function cleanupStyle(style) {
    const copy = {};
    for (let [key, val] of Object.entries(style)) {
      if (key === 'sections'
        // Keeping dummy `sections` for compatibility with older Stylus
        // even in deduped backup so the user can resave/reconfigure the style to rebuild it.
          ? !style[UCD] || keepDupSections || (val = [{code: ''}])
          : typeof val !== 'object' || !isEmptyObj(val)) {
        copy[key] = val;
      }
    }
    return copy;
  }
}
