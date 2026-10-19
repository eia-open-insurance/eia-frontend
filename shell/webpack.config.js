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
      remotes: { eia_party: 'eia_party@http://localhost:3001/remoteEntry.js' },
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


