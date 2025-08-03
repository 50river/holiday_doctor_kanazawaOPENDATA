const CSV_URL = 'https://catalog-data.city.kanazawa.ishikawa.jp/dataset/a65a835b-428c-4ca4-bb20-31259fafcf71/resource/3afcebc5-815f-4e4f-a948-108b4a3e00d4/download/kyujitutoubani.csv';

// 表示したい診療科リスト。空配列の場合は全て表示
const CATEGORY_LIST = [];

// 診療時間（日本時間）
const START_HOUR = 9;
const END_HOUR = 17;

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

// 日本時間の現在日時を取得
function getJapanTime() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
}

function pickLatestHoliday(records, dateIdx) {
    const now = getJapanTime();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const data = {};
    records.forEach(row => {
        const d = parseDate(row[dateIdx]);
        if (!d) return;
        const key = d.toISOString().split('T')[0];
        if (!data[key]) data[key] = [];
        data[key].push(row);
    });
    const keys = Object.keys(data).sort();
    let message = '';
    for (const k of keys) {
        const d = new Date(k);
        if (d.getTime() === today.getTime()) {
            if (now.getHours() >= END_HOUR) {
                message = '本日の休日当番医は終了しました';
                continue;
            }
            return { type: 'today', date: data[k][0][dateIdx], rows: data[k], message };
        }
        if (d > today) {
            return { type: 'future', date: data[k][0][dateIdx], rows: data[k], message };
        }
    }
    if (keys.length > 0) {
        const lastKey = keys[keys.length - 1];
        return { type: 'past', date: data[lastKey][0][dateIdx], rows: data[lastKey], message };
    }
    return null;
}

let allRows = [];
let allHeaders = [];
let categoryIdx = -1;

function splitCategories(str) {
    return (str || '').split(/[・､，、]+/).filter(s => s);
}

// 診療科リストに基づきカテゴリをフィルタリング
function filterCategories(catMap) {
    if (!CATEGORY_LIST.length) return catMap;
    const filtered = {};
    CATEGORY_LIST.forEach(cat => {
        if (catMap[cat]) filtered[cat] = catMap[cat];
    });
    return filtered;
}

function renderCategories(catMap) {
    $('#accordion').empty();
    Object.keys(catMap).sort().forEach((cat, i) => {
        const isAlt = i % 2 === 1;
        const collapseId = `collapse${i}`;
        const headingId = `heading${i}`;
        let listHtml = '';
        catMap[cat].forEach(row => {
            const name = row[allHeaders.findIndex(h => /名称|医療機関|病院|クリニック/i.test(h))] || '';
            const time = `${START_HOUR}:00～${END_HOUR}:00`;
            const tel = row[allHeaders.findIndex(h => /電話|電話番号/i.test(h))] || '';
            const addr = row[allHeaders.findIndex(h => /住所|所在地/i.test(h))] || '';
            const mapLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
            listHtml += `
              <div class="hospital-item">
                <div class="hospital-name">${name}</div>
                <div>時間: <span>${time}</span></div>
                <div><span class="icon">📞</span><a href="tel:${tel}">${tel}</a></div>
                <div><span class="icon">📍</span><a href="${mapLink}" target="_blank">${addr}</a></div>
              </div>`;
        });
        const html = `
        <div class="panel panel-default">
          <div class="panel-heading${isAlt ? ' stripe-alt' : ''}" id="${headingId}" data-collapse="${collapseId}" style="user-select:none; cursor:pointer;">
            <div class="panel-title" style="color:inherit; text-decoration:none;">
              ${cat}
            </div>
          </div>
          <div id="${collapseId}" class="panel-collapse" style="display:none;">
            <div class="panel-body">
              ${listHtml}
            </div>
          </div>
        </div>`;
        $('#accordion').append(html);
    });

    $('#accordion .panel-heading').off('click').on('click', function() {
        const target = $(this).attr('data-collapse');
        $('#accordion .panel-collapse').not('#' + target).slideUp(200);
        $('#' + target).slideToggle(200);
    });
}

$(function() {
    fetch(CSV_URL)
        .then(res => res.arrayBuffer())
        .then(buf => {
            const uint8Array = new Uint8Array(buf);
            const unicodeString = Encoding.convert(uint8Array, {
                to: 'UNICODE',
                from: 'SJIS',
                type: 'string'
            });
            const rows = parseCSV(unicodeString);
            allHeaders = rows.shift().map(h => h.replace(/^\uFEFF/, ''));
            let dateIdx = allHeaders.findIndex(h => h === "日付");
            if (dateIdx === -1) {
                $('#date').text('日付カラムが見つかりませんでした');
                return;
            }
            const holiday = pickLatestHoliday(rows, dateIdx);
            if (!holiday) {
                $('#date').text('該当するデータがありません');
                return;
            }
            allRows = holiday.rows;
            categoryIdx = allHeaders.findIndex(h => /診療科目|科/i.test(h));

            let msg = holiday.message || '';
            if (holiday.type === 'past') {
                msg += (msg ? '<br>' : '') + `最新の情報がオープンデータで公開されていません（${holiday.date}まで掲載）`;
            }
            $('#latest-message').html(msg);
            $('#date').text(`${holiday.date} の当番医`);

            const catMap = {};
            allRows.forEach(r => {
                splitCategories(r[categoryIdx]).forEach(c => {
                    if (!catMap[c]) catMap[c] = [];
                    catMap[c].push(r);
                });
            });

            const filteredMap = filterCategories(catMap);
            renderCategories(filteredMap);
        })
        .catch(err => $('#date').text('CSV取得に失敗しました: ' + err));
});