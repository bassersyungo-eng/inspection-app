const GAS_URL = 'https://script.google.com/macros/s/AKfycbyu0lJtEr_skyc4YHXBz1oRnkNyY-n9ra7GXCVD7y54SVst-FR3OuwyIAnQDovt9duT/exec';
const STORAGE_KEY = 'inspection_records_fallback';

const dom = {
  deviceName:       document.getElementById('deviceName'),
  itemCount:        document.getElementById('itemCount'),
  countOk:          document.getElementById('countOk'),
  countNg:          document.getElementById('countNg'),
  countSkip:        document.getElementById('countSkip'),
  todayDate:        document.getElementById('todayDate'),
  inspectorName:    document.getElementById('inspectorName'),
  checkList:        document.getElementById('checkList'),
  appMessage:       document.getElementById('appMessage'),
  jsonFile:         document.getElementById('jsonFile'),
  completionPanel:  document.getElementById('completionPanel'),
  finishButton:     document.getElementById('finishButton'),
  resetButton:      document.getElementById('resetButton'),
  finishedScreen:   document.getElementById('finishedScreen'),
  finishedSummary:  document.getElementById('finishedSummary'),
  finishedMeta:     document.getElementById('finishedMeta'),
  finishedBackButton: document.getElementById('finishedBackButton'),
};

// ============================================================
// ファイルプロトコル判定
// ============================================================
function isFileProtocol() {
  return window.location.protocol === 'file:';
}

// ============================================================
// レコード読み書き（メモリ + ローカルフォールバック）
// ============================================================
function loadRecords() {
  if (isFileProtocol()) {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  }
  return window.APP_RECORDS || [];
}

function saveRecords(records) {
  window.APP_RECORDS = records;
  if (isFileProtocol()) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }
}

// ============================================================
// GAS API 通信
// ============================================================
async function gasGet(params) {
  const url = GAS_URL + '?' + new URLSearchParams(params).toString();
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function fetchMasterData() {
  const data = await gasGet({ action: 'getAll' });
  data.devices = [{
    device_id: 'print_l',
    device_name: '印刷1号機 [L]',
    device_code: 'L',
    device_type: '印刷'
  }];
  return data;
}

async function fetchRecords() {
  const year = new Date().getFullYear();
  return await gasGet({ action: 'getRecords', year });
}

async function saveRecordToGAS(record) {
  await gasGet({ action: 'addRecord', data: JSON.stringify(record) });
}

// ============================================================
// 日付ユーティリティ
// ============================================================
function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function getStatus(records, item) {
  const today = todayDate();
  return records.find(r => r.item_id === item.item_id && r.check_date === today) || null;
}

// ============================================================
// 頻度判定
// ============================================================
function isDueNormal(item, records) {
  const today = new Date(todayDate());
  const last = getLastRecordDate(item, records);
  const freq = (item.frequency || '').trim();

  if (!freq || /毎日/.test(freq)) {
    return !records.some(r => r.item_id === item.item_id && r.check_date === todayDate());
  }

  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  if (/毎週|週/.test(freq)) {
    return !records.some(r => {
      const d = new Date(r.check_date);
      return d >= weekStart && d <= weekEnd && r.item_id === item.item_id;
    });
  }

  if (/毎月|１ヶ月|1ヶ月|1か月/.test(freq)) {
    return !records.some(r => {
      const d = new Date(r.check_date);
      return d.getFullYear() === today.getFullYear() &&
             d.getMonth() === today.getMonth() &&
             r.item_id === item.item_id;
    });
  }

  const monthMatch = freq.match(/(\d+)\s*ヶ月/);
  if (monthMatch) {
    const months = Number(monthMatch[1]);
    if (!last) return true;
    const due = new Date(last);
    due.setMonth(due.getMonth() + months);
    return today >= due;
  }

  return !records.some(r => r.item_id === item.item_id && r.check_date === todayDate());
}

function getLastRecordDate(item, records) {
  const dates = records
    .filter(r => r.item_id === item.item_id && r.check_date)
    .map(r => new Date(r.check_date));
  return dates.length ? new Date(Math.max(...dates)) : null;
}

function buildVisibleItems(items, records) {
  const normalItems = items.filter(i => i.special_type === 'normal');
  const dueNormal = normalItems.filter(i => isDueNormal(i, records));
  if (dueNormal.length > 0) return dueNormal;
  const specialItems = items.filter(i => i.special_type !== 'normal');
  return specialItems.filter(i => !records.some(r => r.item_id === i.item_id && r.check_date === todayDate()));
}

function buildSortedItems(items) {
  const orderMap = { normal: 0, as_needed: 1, alarm: 2 };
  return items.slice().sort((a, b) => {
    const t = orderMap[a.special_type] - orderMap[b.special_type];
    return t !== 0 ? t : (a.order || 0) - (b.order || 0);
  });
}

function formatDateLabel(item, records) {
  const status = getStatus(records, item);
  if (status) return `${status.check_date} / ${status.inspector}`;
  const last = getLastRecordDate(item, records);
  if (last) {
    const y = last.getFullYear();
    const m = String(last.getMonth() + 1).padStart(2, '0');
    const d = String(last.getDate()).padStart(2, '0');
    return `最終: ${y}-${m}-${d}`;
  }
  return '未登録';
}

// ============================================================
// 担当者プルダウン
// ============================================================
function loadInspectors(data) {
  const deviceId = data.devices?.[0]?.device_id;
  const inspectors = (data.inspectors || []).filter(i => !deviceId || i.device_id === deviceId);
  dom.inspectorName.innerHTML = '<option value="">-- 担当者を選択 --</option>';
  inspectors.forEach(i => {
    const opt = document.createElement('option');
    opt.value = i.name;
    opt.textContent = i.name;
    dom.inspectorName.appendChild(opt);
  });
}

// ============================================================
// 画面描画
// ============================================================
function renderItems(data) {
  const records = loadRecords();
  dom.checkList.innerHTML = '';
  dom.todayDate.textContent = todayDate();

  if (!data?.check_items?.length) {
    dom.checkList.textContent = 'チェック項目が見つかりません。';
    return;
  }

  dom.deviceName.textContent = data.devices?.[0]?.device_name || '未設定';

  const visibleItems = buildVisibleItems(data.check_items, records);
  dom.itemCount.textContent = `${visibleItems.length} / ${data.check_items.length}`;

  const counts = { OK: 0, NG: 0, SKIP: 0 };
  records.filter(r => r.check_date === todayDate()).forEach(r => {
    counts[r.result] = (counts[r.result] || 0) + 1;
  });
  dom.countOk.textContent   = counts.OK;
  dom.countNg.textContent   = counts.NG;
  dom.countSkip.textContent = counts.SKIP;

  const allDone = visibleItems.length > 0 && visibleItems.every(i => getStatus(records, i));
  dom.completionPanel.classList.toggle('hidden', !allDone);

  const sorted  = buildSortedItems(visibleItems);
  const grouped = sorted.reduce((acc, item) => {
    const key = item.category || '未分類';
    (acc[key] = acc[key] || []).push(item);
    return acc;
  }, {});

  Object.keys(grouped).forEach(category => {
    const section = document.createElement('div');
    section.className = 'check-card';
    const catTitle = document.createElement('div');
    catTitle.style.cssText = 'font-weight:700;margin-bottom:10px;';
    catTitle.textContent = category;
    section.appendChild(catTitle);

    grouped[category].forEach(item => {
      const card = document.createElement('div');
      card.className = 'check-card';

      const title = document.createElement('h3');
      title.textContent = item.item_name;
      card.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'check-meta';
      const freqBadge = document.createElement('span');
      freqBadge.className = 'check-badge badge-frequency';
      freqBadge.textContent = item.frequency || '頻度なし';
      meta.appendChild(freqBadge);
      const typeBadge = document.createElement('span');
      typeBadge.className = 'check-badge ' + (item.special_type === 'normal' ? 'badge-normal' : 'badge-special');
      typeBadge.textContent = item.special_type === 'normal' ? '通常' : (item.special_type === 'as_needed' ? '実施時' : '警報時');
      meta.appendChild(typeBadge);
      card.appendChild(meta);

      if (item.criteria) {
        const el = document.createElement('div');
        el.textContent = '基準: ' + item.criteria;
        card.appendChild(el);
      }
      if (item.note) {
        const el = document.createElement('div');
        el.textContent = '備考: ' + item.note;
        card.appendChild(el);
      }

      const dateLabel = document.createElement('div');
      dateLabel.className = 'item-status';
      dateLabel.textContent = formatDateLabel(item, records);
      card.appendChild(dateLabel);

      const status = getStatus(records, item);
      const statusLabel = document.createElement('div');
      statusLabel.className = 'item-status' + (status ? ' ' + status.result.toLowerCase() : '');
      statusLabel.textContent = status ? '今日の登録: ' + status.result : '今日の登録: なし';
      card.appendChild(statusLabel);

      const actionRow = document.createElement('div');
      actionRow.className = 'action-row';
      const noteInput = document.createElement('input');
      noteInput.type = 'text';
      noteInput.placeholder = '備考（任意）';
      noteInput.className = 'item-note-input';
      actionRow.appendChild(noteInput);

      ['OK', 'NG'].forEach(result => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `action-button action-${result.toLowerCase()}`;
        btn.textContent = result;
        btn.addEventListener('click', () => registerResult(
          data.devices[0].device_id, item, result, data.devices[0].device_name, noteInput.value
        ));
        actionRow.appendChild(btn);
      });

      if (item.special_type !== 'normal') {
        const skipBtn = document.createElement('button');
        skipBtn.type = 'button';
        skipBtn.className = 'action-button action-skip';
        skipBtn.textContent = 'SKIP';
        skipBtn.addEventListener('click', () => registerResult(
          data.devices[0].device_id, item, 'SKIP', data.devices[0].device_name, noteInput.value
        ));
        actionRow.appendChild(skipBtn);
      }

      card.appendChild(actionRow);
      section.appendChild(card);
    });
    dom.checkList.appendChild(section);
  });
}

// ============================================================
// 結果登録
// ============================================================
async function registerResult(deviceId, item, result, deviceName, note = '') {
  if (item.special_type === 'normal' && result === 'SKIP') {
    showMessage('通常項目はSKIPできません。OKまたはNGを選択してください。');
    return;
  }

  const records = loadRecords();
  const today = todayDate();
  const newRecord = {
    record_id:   `${item.item_id}-${today}-${Date.now()}`,
    item_id:     item.item_id,
    item_name:   item.item_name,
    category:    item.category,
    device_id:   deviceId,
    device_name: deviceName,
    check_date:  today,
    task_type:   item.task_type,
    result,
    inspector:   dom.inspectorName.value.trim() || '未設定',
    memo:        note || '',
    is_special:  item.special_type !== 'normal'
  };

  // メモリをすぐ更新して再描画（楽観的更新）
  const updated = records.filter(r => !(r.item_id === item.item_id && r.check_date === today));
  updated.push(newRecord);
  saveRecords(updated);
  renderItems(window.APP_DATA);
  showMessage(`${item.item_name} を ${result} で登録中...`);

  // GASに保存
  if (!isFileProtocol()) {
    try {
      await saveRecordToGAS(newRecord);
      showMessage(`${item.item_name} を ${result} で登録しました。`);
    } catch {
      showMessage('通信エラー: 記録は画面上のみ保存されています。再読み込みすると消える場合があります。');
    }
  } else {
    showMessage(`${item.item_name} を ${result} で登録しました。`);
  }
}

// ============================================================
// メッセージ表示
// ============================================================
function showMessage(msg) {
  dom.appMessage.textContent = msg;
}

// ============================================================
// ファイル読み込み（file://モード用）
// ============================================================
function loadLocalFileData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(JSON.parse(reader.result)); } catch (e) { reject(e); }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, 'UTF-8');
  });
}

// ============================================================
// ボタン類のイベント設定
// ============================================================
function enableControls() {
  dom.finishButton.addEventListener('click', () => {
    const records = loadRecords().filter(r => r.check_date === todayDate());
    const ok   = records.filter(r => r.result === 'OK').length;
    const ng   = records.filter(r => r.result === 'NG').length;
    const skip = records.filter(r => r.result === 'SKIP').length;
    dom.finishedSummary.innerHTML =
      `<span class="sum-ok">OK: ${ok}</span>` +
      `<span class="sum-ng">NG: ${ng}</span>` +
      `<span class="sum-skip">SKIP: ${skip}</span>`;
    dom.finishedMeta.textContent =
      `${todayDate()}　${dom.deviceName.textContent}　担当: ${dom.inspectorName.value || '未設定'}`;
    dom.finishedScreen.classList.remove('hidden');
    dom.completionPanel.classList.add('hidden');
  });

  dom.finishedBackButton.addEventListener('click', () => {
    dom.finishedScreen.classList.add('hidden');
  });

  dom.resetButton.addEventListener('click', () => {
    const today = todayDate();
    saveRecords(loadRecords().filter(r => r.check_date !== today));
    renderItems(window.APP_DATA);
    showMessage('本日の記録をリセットしました。');
  });

  dom.jsonFile.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await loadLocalFileData(file);
      window.APP_DATA = data;
      loadInspectors(data);
      renderItems(data);
      showMessage('JSONファイルを読み込みました。');
    } catch {
      showMessage('ファイルの読み込みに失敗しました。');
    }
  });
}

// ============================================================
// 起動
// ============================================================
async function start() {
  enableControls();
  dom.todayDate.textContent = todayDate();

  if (isFileProtocol()) {
    showMessage('ファイルで開いています。下のボタンから design_data_latest.json を選択してください。');
    dom.checkList.textContent = 'JSONファイルを選択してください。';
    return;
  }

  showMessage('データを読み込んでいます...');
  dom.checkList.textContent = '';

  try {
    const [masterData, records] = await Promise.all([fetchMasterData(), fetchRecords()]);
    window.APP_DATA    = masterData;
    window.APP_RECORDS = records;
    loadInspectors(masterData);
    renderItems(masterData);
    showMessage('');
  } catch (err) {
    showMessage('読み込みに失敗しました: ' + err.message);
    dom.checkList.textContent = 'データの読み込みに失敗しました。';
  }
}

start();
