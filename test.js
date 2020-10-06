svy = require('./dist/savvy');
fs = require('fs');

let log = [];
let raw = fs.readFileSync('C:/Users/Mher/Downloads/PsychBike.sav');
let dv = new DataView(raw.buffer);
let sav = new svy.FileFeeder('C:/Users/Mher/Downloads/PsychBike.sav');
let res;

let reader = new svy.FileReader(log);

reader.meta(sav).then(parsed => {
    res = parsed
});
reader.headers(sav).then(parsed => {
    res = parsed
});