# savvy

Read all fields from a .sav file.
All fields include the full Schema and all data cells as a Row[]

Still in development:
TODO: expose objects of Column classes
TODO: concatenate long string column values
TODO: uncompressed data files
TODO: unrecognized codes

From a node.js Buffer using `fs.readFile`
```
fs = require('fs');

let all;
const parser = new SavParser();
// with async readFile
fs.readFile('some/path/to/file.sav', (err, data) => {
    parser.all(new Feeder(data.buffer)).then(
        result => all = result
    )
});
// with syncronous `readFileSync`
parser.all(
    new Feeder(fs.readFileSync('/some/path/to/file.sav').buffer)
).then(
    parsed => all = parsed
);
// nodejs Buffers may need to be sliced when accessing the underlying ArrayBuffer
// It's always safer to slice from the byteOffset (which commonly is 0) and byteLength
new Feeder(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
);
```

In the browser with File API
```
<input type="file" onchange = "onChange"></input>
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

Parsing less than the complete data file
```
const parser = new SavParser();

// read only the meta fields from a sav file
parser.meta(new Feeder(buffer)).then(parsed => {/* do stuff */});

// read only the header fields from a sav file
// Header here refers to the head of the columns of the data, i.e.
// properties of the columns in the data file
parser.headers(new Feeder(buffer)).then(parsed => {/* do stuff */});

// read all schema fields from a sav file
// Schema here refers to all information except for the data cells themselves
parser.schema(new Feeder(buffer)).then(parsed => {/* do stuff */});
```

DataSet interface for parsed data
Savvy class implements DataSet
```
const parser = new SavParser();
let dataset;
parser.all(new Feeder(buffer)).then(
    parsed => dataset = new Savvy(parsed)
)
// n : number - number of cases
dataset.n
// names : Array<string> - column names (short unique names)
dataset.names
// labels : Map<string, string> - column long labels (key-value by unique name)
dataset.labels
// row(index : number) : Map<string, number | string> - get a row as key-value map
dataset.row(0)
// col(key : string) : Array<number> | Array<string> - get a column as an array
dataset.col('IDField')
// view(indices? : Array<number>, keys? : Array<string>) : DataSet - subset by rows/columns
```

See types.d.ts file for how parsed data is encoded