const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ModuleFederationPlugin } = require('webpack').container;

module.exports = {
  entry: './src/index.jsx',
  output: { path: path.resolve(__dirname, 'dist'), publicPath: 'auto', clean: true },
  resolve: { extensions: ['.js', '.jsx'] },
  module: {
    rules: [{ test: /\.jsx?$/, exclude: /node_modules/, use: { loader: 'swc-loader', options: { jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } } } } }]
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'eia_shell',
      remotes: {
        eia_party: 'eia_party@http://localhost:3001/remoteEntry.js',
        eia_policy: 'eia_policy@http://localhost:3002/remoteEntry.js',
        eia_contract: 'eia_contract@http://localhost:3003/remoteEntry.js',
        eia_direct_claims: 'eia_direct_claims@http://localhost:3004/remoteEntry.js',
        eia_assumed_claims: 'eia_assumed_claims@http://localhost:3005/remoteEntry.js',
        eia_cession: 'eia_cession@http://localhost:3006/remoteEntry.js',
        eia_retrocession: 'eia_retrocession@http://localhost:3007/remoteEntry.js',
        eia_document: 'eia_document@http://localhost:3008/remoteEntry.js',
        eia_payment: 'eia_payment@http://localhost:3009/remoteEntry.js',
        eia_notifications: 'eia_notifications@http://localhost:3010/remoteEntry.js'
      },
      shared: { react: { singleton: true, requiredVersion: false }, 'react-dom': { singleton: true, requiredVersion: false } }
    }),
    new HtmlWebpackPlugin({ template: './public/index.html' })
  ],
  devServer: {
    port: 3000,
    allowedHosts: 'all',
    historyApiFallback: true,
    hot: true,
    proxy: [{ context: ['/api'], target: 'http://localhost:8080', changeOrigin: true }]
  }
};
