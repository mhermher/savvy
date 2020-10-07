svy = require('./dist/savvy');
fs = require('fs');

let log = [];
let raw = fs.readFileSync('C:/Users/Mher/Downloads/SEP17_ALL_Draft01_IntUse/SEP17_AU_Draft01_IntUse.sav');
let reader = new svy.FileReader(log);
let sav = new svy.Feeder(fs.readFileSync('C:/Users/Mher/Downloads/SEP17_ALL_Draft01_IntUse/SEP17_AU_Draft01_IntUse.sav').buffer);
reader.meta(sav).then(parsed => meta = parsed);
reader.headers(sav).then(parsed => headers = parsed);
reader.schema(sav).then(parsed => schema = parsed);
reader.all(sav).then(parsed => data = parsed);

let dv = new DataView(raw.buffer);
let decoder = new TextDecoder();