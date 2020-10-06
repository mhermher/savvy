const path = require('path');
const externals = require('webpack-node-externals');

module.exports = {
    mode : 'none',
    devtool : 'cheap-source-map',
    target : 'node',
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
                    options : {
                        sourceMap : true,
                        presets : [
                            ['@babel/preset-env']
                        ]
                    }
                }
            },
            {
                test : /\.ts$/,
                use : [{loader : 'ts-loader'}]
            }
        ]
    },
    output : {
        filename : 'savvy.js',
        path : path.resolve(__dirname, 'dist'),
        library : 'savvy',
        libraryTarget : 'umd',
        umdNamedDefine: true
    },
    externals : [externals()]
};