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
// Test suite for the web, bundled aswell because the webworker extension host
// can only resolve the `vscode` module, everything else must be inlined.
const webTestConfig = {
  target: 'webworker',

  entry: './src/test/suite/indexWeb.ts',
  output: {
    // Kept out of dist/web so that it is not picked up as part of the extension.
    path: path.resolve(__dirname, 'dist/web-test/suite'),
    filename: 'index.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'source-map',
  externals: {
    vscode: 'commonjs vscode' // Provided by the extension host.
  },
  resolve: {
    mainFields: ['browser', 'module', 'main'], // Required to pick mocha browser entry.
    extensions: ['.ts', '.js'],
    fallback: {
      fs: false, // No filesystem in browser.
      child_process: false, // No child process in browser. Used to detect if running on web.
      path: require.resolve('path-browserify'),
      os: require.resolve('os-browserify/browser'),
      assert: require.resolve('assert') // Used by the tests themselves.
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
  },
  plugins: [
    // A webworker cannot load extra chunks, everything must land in a single file.
    new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
    // mocha & the shared test utils expect a node process object.
    new webpack.ProvidePlugin({ process: 'process/browser' }),
    // There is no environment in the browser, so the test flags are inlined at build time.
    // pretest builds & runs in the same shell, so setting them before npm run test works.
    new webpack.EnvironmentPlugin({
      USE_WASI_SERVER: '',
      SHOW_SERVER_LOGS: ''
    })
  ]
};

module.exports = [webConfig, nodeConfig, webTestConfig];