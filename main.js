// 金沢市オープンデータ API から最新 CSV を取得するための設定
const DATASET_ID = '172014-toubani';
const API_URL = `https://catalog-data.city.kanazawa.ishikawa.jp/api/3/action/package_show?id=${DATASET_ID}`;

// --- CSV utilities ---
function parseCSV(text) {
    const rows = [];
    let inQuote = false, field = '', row = [];
    for (let c, i = 0; i < text.length; i++) {
        c = text[i];
        if (inQuote) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuote = false;
            } else field += c;
        } else {
            if (c === '"') inQuote = true;
            else if (c === ',') { row.push(field); field = ''; }
            else if (c === '\n' || c === '\r') {
                if (field || row.length) row.push(field);
                if (row.length) rows.push(row);
                field = ''; row = [];
                if (c === '\r' && text[i + 1] === '\n') i++; // skip CRLF
            } else field += c;
        }
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
}

function parseDate(str) {
    if (!str) return null;
    str = str.replace(/\s/g, '').replace(/／/g, '/');
    let m = str.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
    if (m) return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
    m = str.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (m) return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
    m = str.match(/(\d{1,2})月(\d{1,2})日/);
    if (m) return new Date(new Date().getFullYear(), Number(m[1])-1, Number(m[2]));
    return null;
}

function pickLatestHoliday(records, dateIdx) {
    const today = new Date();
    const data = {};
    records.forEach(row => {
        const d = parseDate(row[dateIdx]);
        if (!d) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!data[key]) data[key] = [];
        data[key].push(row);
    });
    const keys = Object.keys(data).sort();
    for (const k of keys) {
        const [y, m, day] = k.split('-').map(Number);
        const d = new Date(y, m - 1, day);
        if (d >= new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
            return { type: "future", date: data[k][0][dateIdx], rows: data[k] };
        }
    }
    if (keys.length > 0) {
        const lastKey = keys[keys.length - 1];
        return { type: "past", date: data[lastKey][0][dateIdx], rows: data[lastKey] };
    }
    return null;
}

// --- UI helpers ---
let allHeaders = [];
let allRows = [];
let categoryIdx = -1;
let nameIdx = -1;
let telIdx = -1;
let addrIdx = -1;

function splitCategories(str) {
    return (str || '').split(/[・､，、]+/).filter(s => s);
}

function hospitalItem(row) {
    const name = row[nameIdx] || '';
    const time = "9:00～17:00";
    const tel = row[telIdx] || '';
    const addr = row[addrIdx] || '';
    const mapLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
    return `
      <div class="hospital-item" data-name="${name}" data-addr="${addr}">
        <div class="hospital-name">${name}</div>
        <div>時間: <span>${time}</span></div>
        <div>${addr ? '📍 ' + addr : ''}</div>
        <div class="row-actions">
          ${tel ? `<a class="cta tel" href="tel:${tel}" aria-label="${name} に電話する"><span class="icon">📞</span>電話する</a>` : ''}
          ${addr ? `<a class="cta map" target="_blank" href="${mapLink}" aria-label="${name} を地図で開く"><span class="icon">🗺️</span>地図で開く</a>` : ''}
        </div>
      </div>`;
}

function renderCategories(catMap) {
    const $acc = $('#accordion').empty();
    const cats = Object.keys(catMap).sort();
    cats.forEach((cat, i) => {
        const isAlt = i % 2 === 1;
        const collapseId = `collapse${i}`;
        const headingId = `heading${i}`;
        let listHtml = catMap[cat].map(hospitalItem).join('');
        const html = `
        <section class="panel" data-cat="${cat}">
          <div class="panel-heading ${isAlt ? 'stripe-alt' : ''}" id="${headingId}" data-collapse="${collapseId}" role="button" tabindex="0" aria-controls="${collapseId}" aria-expanded="false">
            ${cat}
          </div>
          <div id="${collapseId}" class="panel-collapse" style="display:none;">
            <div class="panel-body">
              ${listHtml}
            </div>
          </div>
        </section>`;
        $acc.append(html);
    });

    // accordion interactions
    $('#accordion .panel-heading').off('click keydown').on('click keydown', function(e) {
        if (e.type === 'click' || (e.type === 'keydown' && (e.key === 'Enter' || e.key === ' '))) {
            const target = $(this).attr('data-collapse');
            const $c = $('#' + target);
            const open = $c.is(':visible');
            if (!open) {
                $('#accordion .panel-collapse').not($c).slideUp(160);
                $c.slideDown(160);
                $(this).attr('aria-expanded', 'true');
            } else {
                $c.slideUp(160);
                $(this).attr('aria-expanded', 'false');
            }
        }
    });

    $('#loading').remove();
    $('#accordion').prop('hidden', false);
}

$(function() {
    $('#to-top').on('click', () => window.scrollTo({top:0, behavior:'smooth'}));

    // APIから最新のCSVを取得
    fetch(API_URL)
        .then(res => res.json())
        .then(pkg => {
            const resource = (pkg.result.resources || []).find(r => /csv/i.test(r.format));
            if (!resource) throw new Error('CSVリソースが見つかりません');
            return fetch(resource.url || resource.download_url);
        })
        .then(res => res.arrayBuffer())
        .then(buf => {
            const uint8Array = new Uint8Array(buf);
            // まずShift_JISとして解析
            let text = Encoding.convert(uint8Array, { to: 'UNICODE', from: 'SJIS', type: 'string' });
            let rows = parseCSV(text);
            allHeaders = rows.shift().map(h => h.replace(/^\uFEFF/, ''));
            // 日付列が見つからない場合はUTF-8として再解析
            if (allHeaders.findIndex(h => /(日付|年月日|診療日)/.test(h)) === -1) {
                text = new TextDecoder('utf-8').decode(uint8Array);
                rows = parseCSV(text);
                allHeaders = rows.shift().map(h => h.replace(/^\uFEFF/, ''));
            }
            const dateIdx = allHeaders.findIndex(h => /(日付|年月日|診療日)/.test(h));
            if (dateIdx === -1) { $('#date').text('日付カラムが見つかりませんでした'); return; }

            nameIdx = allHeaders.findIndex(h => /名称|医療機関|病院|クリニック/i.test(h));
            telIdx = allHeaders.findIndex(h => /電話|電話番号/i.test(h));
            addrIdx = allHeaders.findIndex(h => /住所|所在地/i.test(h));
            categoryIdx = allHeaders.findIndex(h => /診療科目|科/i.test(h));

            const holiday = pickLatestHoliday(rows, dateIdx);
            if (!holiday) { $('#date').text('該当するデータがありません'); return; }

            if (holiday.type === "past") {
                $('#latest-message').removeClass('sr-only').text(`最新の情報がオープンデータで公開されていません（${holiday.date}まで掲載）`);
            } else {
                $('#latest-message').text('');
            }
            $('#date').text(`${holiday.date} の当番医`);

            allRows = holiday.rows;
            const catMap = {};
            allRows.forEach(r => {
                splitCategories(r[categoryIdx]).forEach(c => {
                    if (!catMap[c]) catMap[c] = [];
                    catMap[c].push(r);
                });
            });

            renderCategories(catMap);
        })
        .catch(err => {
            $('#date').text('CSV取得に失敗しました');
            console.error(err);
        });
});
