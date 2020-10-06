svy = require('./dist/savvy');
fs = require('fs');

let log = [];
let raw = fs.readFileSync('C:/Users/Mher/Downloads/PsychBike.sav');
let dv = new DataView(raw.buffer);
let decoder = new TextDecoder();
let reader = new svy.FileReader(log);
let sav = new svy.FileFeeder('C:/Users/Mher/Downloads/PsychBike.sav');
reader.meta(sav).then(parsed => meta = parsed);
reader.headers(sav).then(parsed => headers = parsed);
reader.schema(sav).then(parsed => schema = parsed);