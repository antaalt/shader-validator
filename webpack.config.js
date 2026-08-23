//@ts-check
/* eslint-disable @typescript-eslint/naming-convention */

'use strict';

const path = require('path');
const webpack = require('webpack');

/**@type {import('webpack').Configuration}*/
const webConfig = {
  target: 'webworker', // vscode extensions run in webworker context for VS Code web

  entry: './src/extension.ts', // the entry point of this extension
  output: {
    // the bundle is stored in the 'dist' folder (check package.json)
    path: path.resolve(__dirname, 'dist/web'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'source-map',
  externals: {
    vscode: 'commonjs vscode' // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed
  },
  resolve: {
    // support reading TypeScript and JavaScript files
    mainFields: ['browser', 'module', 'main'], // look for `browser` entry point in imported node modules
    extensions: ['.ts', '.js'],
    alias: {
      // provides alternate implementation for node module and source files
    },
    fallback: {
      // Webpack 5 no longer polyfills Node.js core modules automatically.
      // see https://webpack.js.org/configuration/resolve/#resolvefallback
      // for the list of Node.js core module polyfills.
      fs: false, // No filesystem in browser. 
      path: require.resolve('path-browserify'),
      os: require.resolve('os-browserify/browser'),
      child_process: false // No child process in browser. Use it as a way to detect if running on web. 
    }
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: ['ts-loader']
      }
    ]
  }
};
/**@type {import('webpack').Configuration}*/
const nodeConfig = {
  target: 'node',

  entry: './src/extension.ts',
  output: {
    // the bundle is stored in the 'dist' folder (check package.json)
    path: path.resolve(__dirname, 'dist/node'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'source-map',
  externals: {
    vscode: 'commonjs vscode' // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed
  },
  resolve: {
    // support reading TypeScript and JavaScript files
    mainFields: ['main'],
    extensions: ['.ts', '.js'],
    alias: {
      // provides alternate implementation for node module and source files
    },
    fallback: {
    }
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: ['ts-loader']
      }
    ]
  }
};
/**@type {import('webpack').Configuration}*/
const webviewConfig = {
  target: 'web', // the renderer webview is a plain iframe, not an extension host

  entry: './src/view/renderer/webview/main.ts', // the entry point of the renderer webview
  output: {
    // loaded through Webview.asWebviewUri (check src/view/renderer/renderer.ts)
    path: path.resolve(__dirname, 'dist/webview'),
    filename: 'renderer.js',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'source-map',
  resolve: {
    mainFields: ['browser', 'module', 'main'],
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{
          loader: 'ts-loader',
          options: {
            // Compiles against the DOM & WebGPU types instead of the node & vscode ones.
            configFile: path.resolve(__dirname, 'src/view/renderer/webview/tsconfig.json')
          }
        }]
      }
    ]
  }
};
module.exports = [webConfig, nodeConfig, webviewConfig];