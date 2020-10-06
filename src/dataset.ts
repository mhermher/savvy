export interface DataSet {
    n : number,
    fields : Array<string>,
    row(index : number) : {[key : string] : string | number | boolean},
    rows(indices : Array<number>) : DataSet,
    col(name : string) : Array<number> | Array<string> | Array<boolean>,
    cols(names : Array<string>) : DataSet
}