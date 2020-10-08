svy = require('./dist/savvy');
fs = require('fs');

let log = [];
let raw = fs.readFileSync('C:/Users/Mher/Downloads/SEP17_ALL_Draft01_IntUse/SEP17_AU_Draft01_IntUse.sav');
let reader = new svy.FileReader(log);
let savau = new svy.Feeder(fs.readFileSync('C:/Users/Mher/Downloads/SEP17_ALL_Draft01_IntUse/SEP17_AU_Draft01_IntUse.sav').buffer);
reader.all(savau).then(parsed => dataau = parsed);

let ds = new svy.Savvy(dataau);

/*
    Create Brutal Case
    Include very long strings
    Include very long factor label
    Include factor variable after very long string
    Include all many subcode types
*/