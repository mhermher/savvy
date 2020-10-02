const path = require('path');
const externals = require('webpack-node-externals');

module.exports = {
    devtool : 'cheap-source-map',
    target : 'web',
    entry : {
        index : './index.ts'
    },
    context : path.resolve(__dirname, 'src'),
    resolve : {
        extensions : ['.ts']
    },
    module : {
        rules : [
            {
                test : /\.[tj]s$/,
                use : {
                    loader : 'babel-loader',
                    sourceMap : true,
                    presets : [
                        ['@babel/preset-env']
                    ]
                }
            },
            {
                test : /\.ts$/,
                use : [{loader : 'ts-loader'}]
            }
        ]
    },
    output : {
        filename : '[name].bundle.js',
        path : path.resolve(__dirname, 'dist')
    },
    externals : [externals()]
};