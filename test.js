svy = require('./dist/savvy');
fs = require('fs');

let log = [];
let raw = fs.readFileSync('C:/Users/Mher/Downloads/SEP17_ALL_Draft01_IntUse/SEP17_AU_Draft01_IntUse.sav');
let dv = new DataView(raw.buffer);
let decoder = new TextDecoder();
let reader = new svy.FileReader(log);
let sav = new svy.FileFeeder('C:/Users/Mher/Downloads/SEP17_ALL_Draft01_IntUse/SEP17_AU_Draft01_IntUse.sav');
reader.meta(sav).then(parsed => meta = parsed);
reader.headers(sav).then(parsed => headers = parsed);
reader.schema(sav).then(parsed => schema = parsed);

function getPadding(offset) {
    return(({
        magic : dv.getInt32(offset, true),
        code : dv.getInt32(offset + 4, true),
        string : decoder.decode(raw.slice(offset + 8, offset + 32))
    }))
}