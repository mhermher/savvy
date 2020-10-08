import { Header, Parsed, Row } from "./types";

/**
 * An tabular object with rows and columns and cells values of either
 * number, string, or boolean
 */
export interface DataSet {
    /** The number of cases */
    n : number,
    /** The names of the columns */
    names : Array<string>,
    /** The map of unique column names to descriptive labels */
    labels : Map<string, string>,
    /**
     * Get a single row of data as a {@link Map} dictionary of key-values
     * @param index the row index
     * @returns a {@link Row}
     */
    row(index : number) : Row,
    /**
     * Get a single column of data as an Array
     * @param key the name of the column
     * @returns an Array of either numbers, strings or booleans
     */
    col(key : string) : Array<number> | Array<string> | Array<boolean>
    /**
     * Subset the object by row and/or column identifiers
     * @param indices an optional Array of row indices
     * @param keys an optional Array of column names
     * @returns a subset {@link DataSet}
     */
    view(indices? : Array<number>, keys? : Array<string>) : DataSet
}

abstract class Column<T = string | number | boolean> {
    protected parent : Savvy;
    protected key : string;
    constructor(parent : Savvy, key : string) {
        this.parent = parent;
        this.key = key;
    }
    public abstract values : Array<T>;
    public abstract measure : 'nominal' | 'ordinal' | 'scale';
    public get label() : string {
        return(this.parent.labels.get(this.key) ?? this.key);
    }
    public get description() : string {
        return(this.parent.descriptions.get(this.key) ?? '');
    }
}

class StrColumn extends Column<string> {
    private missing : Set<string>;
    constructor(
        parent : Savvy,
        key : string,
        missing : Set<string>
    ){
        super(parent, key);
        this.missing = missing;
    }
    public get values() : Array<string> {
        const values = this.parent.col(this.key) as Array<string>;
        return(
            values.map(value => this.missing.has(value) ? null : value)
        )
    }
    public get measure() : 'nominal' {
        return('nominal');
    }
}

class FacColumn extends Column<string> {
    private labels : Map<number, string>;
    private missing : Set<number>;
    private type : number;
    constructor(
        parent : Savvy,
        key : string,
        labels : Map<number, string>,
        missing : Set<number>,
        type : number
    ){
        super(parent, key);
        this.labels = labels;
        this.missing = missing;
        this.type = type;
    }
    public get values() : Array<string> {
        const values = this.parent.col(this.key) as Array<number>;
        return(
            values.map(value => (this.missing.has(value)
                ? null
                : this.labels.get(value) ?? value.toString()
            ))
        );
    }
    public get measure() : 'nominal' | 'ordinal' | 'scale' {
        switch(this.type){
            case 3: return('scale');
            case 2: return('ordinal');
            default: return('nominal');
        }
    }
    public get raw() : Array<number> {
        const values = this.parent.col(this.key) as Array<number>;
        return(
            values.map(value => (this.missing.has(value)
                ? null
                : value
            ))
        );
    }
}

class NumColumn extends Column<number> {
    private missing : Set<number>;
    private norange : [number, number];
    private type : number;
    private isMissing(value : number) : boolean {
        return(
            this.missing.has(value) || (
                value > this.norange[0] &&
                value < this.norange[1]
            )
        )
    }
    constructor(
        parent : Savvy,
        key : string,
        missing : Set<number>,
        norange : [number, number],
        type : number
    ){
        super(parent, key);
        this.missing = missing;
        this.norange = norange;
        this.type = type;
    }
    public get values() : Array<number> {
        const values = this.parent.col(this.key) as Array<number>;
        return(
            values.map(value => this.isMissing(value) ? null : value)
        )
    }
    public get measure() : 'ordinal' | 'scale' {
        switch(this.type){
            case 2: return('ordinal');
            default: return('scale');
        }
    }
}

class View implements DataSet {
    private parent : Savvy;
    private indices : Array<number>;
    private keys : Array<string>;
    constructor(parent : Savvy, indices : Array<number>, keys : Array<string>){
        this.parent = parent;
        this.indices = indices?.slice() ?? new Array(parent.n).fill(0).map((_, idx) => idx);
        this.keys = keys?.slice() ?? parent.names;
    }
    public get n() : number {
        return(this.indices.length);
    }
    public get names() : Array<string> {
        return(Array.from(this.keys));
    }
    public get labels() : Map<string, string> {
        const labels = this.parent.labels;
        return(
            new Map(this.keys.map(key => [key, labels.get(key) ?? '']))
        )
    }
    public row(index : number) : Row {
        return(this.parent.row(this.indices[index]));
    }
    public col(key : string) : Array<string> | Array<number> | Array<boolean> {
        const all = this.parent.col(key);
        return(
            this.indices.map(index => all[index])
        ) as Array<string> | Array<number> | Array<boolean>;
    }
    public view(indices : Array<number>, keys : Array<string>) : DataSet {
        return(
            new View(
                this.parent,
                indices.map(index => this.indices[index]),
                keys
            )
        )
    }
}

/**
 * A DataSet subclass that can be constructed from a {@link Parsed} object
 */
export class Savvy implements DataSet {
    private static pad(code : number) : number {
        return(8 * Math.ceil(code / 8));
    }
    private cases : number;
    private data : Array<Row>;
    private factors : Map<string, Map<number, string>>;
    private overflows : Map<string, Array<string>>;
    private fields : Map<string, Column>;
    private _labels : Map<string, string>;
    private _descriptions : Map<string, string>;
    /**
     *
     * @param parsed a {@link Parsed} object generated with a {@link SavParser}
     */
    constructor(parsed : Parsed) {
        this.cases = parsed.meta.cases;
        this._labels = parsed.internal.labels;
        this.data = parsed.rows;
        this.factors = new Map(
            parsed.headers.map(header => [header.name, new Map()])
        );
        parsed.internal.factors.forEach(
            entry => entry.indices.forEach(
                index => this.factors.set(
                    parsed.headers[index].name,
                    entry.map
                )
            )
        );
        this.fields = new Map();
        this.overflows = new Map();
        this._descriptions = new Map();
        let j : number = 0;
        for (let i = 0; i < parsed.headers.length; i++){
            j = i;
            const header = parsed.headers[i];
            this._descriptions.set(header.name, header.description);
            if (header.code){
                const overflow : Array<string> = [];
                let length = parsed.internal.longs.get(header.name) ?? 0;
                while (length){
                    // decrement left-aligned but
                    // overflowing vars right-aligned
                    // [255, 255, 255, 12]
                    // has an overflow of 3 * 256 (8-padded)
                    // but keep left-most header instead of right-most
                    length -= Savvy.pad(parsed.headers[i++].code);
                    overflow.push(parsed.headers[i].name);
                }
                this.overflows.set(header.name, overflow);
                this.fields.set(
                    header.name,
                    new StrColumn(
                        this,
                        header.name,
                        new Set(header.missing.strings)
                    )
                );
            } else {
                if (this.factors.get(header.name)?.size) {
                    this.fields.set(
                        header.name,
                        new FacColumn(
                            this,
                            header.name,
                            this.factors.get(header.name),
                            new Set(header.missing.codes),
                            parsed.internal.display[j].type
                        )
                    )
                } else {
                    this.fields.set(
                        header.name,
                        new NumColumn(
                            this,
                            header.name,
                            new Set(header.missing.codes),
                            header.missing.range,
                            parsed.internal.display[j].type
                        )
                    )
                }
            }
        }
        parsed.headers.reduce((left, right) => {
            if (left.length){
                const last = left.pop();
                if (parsed.internal.longs.has(last.name)){
                    const overflow = parsed.internal.longs.get(last.name);
                    if (overflow){
                        parsed.internal.longs.set(
                            last.name,
                            overflow - (8 * Math.ceil(last.code / 8))
                        )
                    } else {
                        parsed.internal.longs.delete(last.name);
                    }
                }
                left.push(last, right);
                return(left);
            } else {
                return([right]);
            }
        }, [] as Array<Header>);
    }
    public get n() : number {
        return(this.cases);
    }
    public get names() : Array<string> {
        return(Array.from(this.fields.keys()));
    }
    public get labels() : Map<string, string> {
        return(new Map([...this._labels]))
    }
    public set labels(labels : Map<string, string>) {
        this._labels = new Map([
            ...this._labels,
            ...labels
        ]);
    }
    /**
     * A map of of unique column keys to longer descriptions
     */
    public get descriptions() : Map<string, string> {
        return(new Map([...this._descriptions]));
    }
    public set descriptions(descriptions : Map<string, string>) {
        this._descriptions = new Map([
            ...this._descriptions,
            ...descriptions
        ]);
    }
    public row(index : number) : Row {
        return(new Map([...this.data[index]]));
    }
    public col(key : string) : Array<number> | Array<string> | Array<boolean> {
        return(
            this.data.map(
                row => row.get(key) ?? null
            ) as Array<number> | Array<string> | Array<boolean>
        )
    }
    public view(indices? : Array<number>, fields? : Array<string>) : DataSet {
        return(
            new View(
                this,
                indices,
                fields
            )
        )
    }
}