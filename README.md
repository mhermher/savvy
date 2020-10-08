# savvy

Read all fields from a .sav file.
All fields include the full Schema and all data cells as a Row[]

From a node.js Buffer using `fs.readFile`
```
fs = require('fs');

let all;
const parser = new SavParser()
// with async readFile
fs.readFile('some/path/to/file.sav', (err, data) => {
    parser.all(new Feeder(data.buffer)).then(
        result => all = result
    )
});
// with syncronous readFileSync
parser.all(
    new Feeder(fs.readFileSync('/some/path/to/file.sav').buffer)
).then(
    parsed => all = parsed
);
```

In the browser with File API
```
<input type="file" onchange = "onChange(event)"></input>
```
```
const all;
function onChange(event){
    const file = event.target.files[0];
    const reader = new FileReader();
    const parser = new SavParser();
    reader.onload = function(data){
        data.arrayBuffer().then(
            buffer => parser.all(new Feeder(buffer))
        ).then(
            parsed => all = parsed
        );
    }
    reader.readAsArrayBuffer(file);
}
```