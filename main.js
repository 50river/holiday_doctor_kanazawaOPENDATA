const CSV_URL = 'https://catalog-data.city.kanazawa.ishikawa.jp/dataset/a65a835b-428c-4ca4-bb20-31259fafcf71/resource/3afcebc5-815f-4e4f-a948-108b4a3e00d4/download/kyujitutoubani.csv';

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
        const key = d.toISOString().split('T')[0];
        if (!data[key]) data[key] = [];
        data[key].push(row);
    });
    const keys = Object.keys(data).sort();
    for (const k of keys) {
        const d = new Date(k);
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

function display(holiday, headers) {
    if (holiday.type === "past") {
        $('#latest-message').html(
          `最新の情報がオープンデータで公開されていません（${holiday.date}まで掲載）`
        );
    } else {
        $('#latest-message').html("");
    }
    $('#date').text(`${holiday.date} の当番医`);
    $('#accordion').empty();
    holiday.rows.forEach((row, i) => {
        const name = row[headers.findIndex(h => /名称|医療機関|病院|クリニック/i.test(h))] || '';
        const category = row[headers.findIndex(h => /診療科目|科/i.test(h))] || '';
        const time = "9:00～17:00";
        const tel = row[headers.findIndex(h => /電話|電話番号/i.test(h))] || '';
        const addr = row[headers.findIndex(h => /住所|所在地/i.test(h))] || '';
        const mapLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
        const isAlt = i % 2 === 1;
        const collapseId = `collapse${i}`;
        const headingId = `heading${i}`;
        const html = `
        <div class="panel panel-default">
          <div class="panel-heading${isAlt ? ' stripe-alt' : ''}" id="${headingId}" data-collapse="${collapseId}" style="user-select:none; cursor:pointer;">
            <div class="panel-title" style="color:inherit; text-decoration:none;">
              <span class="namecat">
                <span class="name">${name}</span><br>
                <span class="cat">（${category}）</span>
              </span>
            </div>
          </div>
          <div id="${collapseId}" class="panel-collapse" style="display:none;">
            <div class="panel-body">
              <div>時間: <span>${time}</span></div>
              <div>電話: <a href="tel:${tel}">${tel}</a></div>
              <div>住所: <a href="${mapLink}" target="_blank">${addr}</a></div>
            </div>
          </div>
        </div>`;
        $('#accordion').append(html);
    });

    // アコーディオン機能
    $('#accordion .panel-heading').off('click').on('click', function() {
        const target = $(this).attr('data-collapse');
        // 他を閉じる（アコーディオン動作）
        $('#accordion .panel-collapse').not('#' + target).slideUp(200);
        // 自分はトグル
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
            let headers = rows.shift();
            headers = headers.map(h => h.replace(/^\uFEFF/, ''));
            let dateIdx = headers.findIndex(h => h === "日付");
            if (dateIdx === -1) {
                $('#date').text('日付カラムが見つかりませんでした');
                return;
            }
            const holiday = pickLatestHoliday(rows, dateIdx);
            if (holiday) display(holiday, headers);
            else $('#date').text('該当するデータがありません');
        })
        .catch(err => $('#date').text('CSV取得に失敗しました: ' + err));
});