const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ModuleFederationPlugin } = require('webpack').container;

// The ten federated remotes are loaded from the same origin as the shell. The
// path is stable across local `npm start`, Docker Compose, and the Kubernetes
// deployment: the shell dev server, the shell nginx config, and the Ingress
// `eia-remotes` all expose /remotes/<vertical>/remoteEntry.js and rewrite the
// prefix to the remote's nginx/dev-server root. Webpack's automatic public path
// derives the chunk base from the executed remoteEntry.js URL, so lazy chunks
// keep resolving under /remotes/<vertical>/ without a rebuild.
const remotes = {
  eia_party: 'eia_party@/remotes/party/remoteEntry.js',
  eia_policy: 'eia_policy@/remotes/policy/remoteEntry.js',
  eia_contract: 'eia_contract@/remotes/contract/remoteEntry.js',
  eia_direct_claims: 'eia_direct_claims@/remotes/direct-claims/remoteEntry.js',
  eia_assumed_claims: 'eia_assumed_claims@/remotes/assumed-claims/remoteEntry.js',
  eia_cession: 'eia_cession@/remotes/cession/remoteEntry.js',
  eia_retrocession: 'eia_retrocession@/remotes/retrocession/remoteEntry.js',
  eia_document: 'eia_document@/remotes/document/remoteEntry.js',
  eia_payment: 'eia_payment@/remotes/payment/remoteEntry.js',
  eia_notifications: 'eia_notifications@/remotes/notifications/remoteEntry.js'
};

// Local `npm start` support: proxy each /remotes/<vertical>/ prefix to the
// matching dev server (3001-3010) and strip the prefix, mirroring the nginx
// rewrite used by Compose and the Ingress.
const remoteTargets = [
  ['/remotes/party', 'http://localhost:3001'],
  ['/remotes/policy', 'http://localhost:3002'],
  ['/remotes/contract', 'http://localhost:3003'],
  ['/remotes/direct-claims', 'http://localhost:3004'],
  ['/remotes/assumed-claims', 'http://localhost:3005'],
  ['/remotes/cession', 'http://localhost:3006'],
  ['/remotes/retrocession', 'http://localhost:3007'],
  ['/remotes/document', 'http://localhost:3008'],
  ['/remotes/payment', 'http://localhost:3009'],
  ['/remotes/notifications', 'http://localhost:3010']
];

const remoteProxy = remoteTargets.map(([context, target]) => ({
  context: [context],
  target,
  changeOrigin: true,
  pathRewrite: { [`^${context}`]: '' }
}));

module.exports = {
  entry: './src/index.jsx',
  output: { path: path.resolve(__dirname, 'dist'), publicPath: 'auto', clean: true },
  resolve: { extensions: ['.js', '.jsx'] },
  module: {
    rules: [
      { test: /\.jsx?$/, exclude: /node_modules/, use: { loader: 'swc-loader', options: { jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } } } } },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] }
    ]
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'eia_shell',
      remotes,
      shared: { react: { singleton: true, requiredVersion: false }, 'react-dom': { singleton: true, requiredVersion: false } }
    }),
    new HtmlWebpackPlugin({ template: './public/index.html' })
  ],
  devServer: {
    port: 3000,
    allowedHosts: 'all',
    historyApiFallback: true,
    hot: true,
    proxy: [
      // Same-origin auth for local development when an auth-config.js opts in:
      // /auth/oauth2/token -> the Spring Authorization Server on :9000. The
      // trailing slash keeps /auth-config.js out of this proxy.
      { context: ['/auth/'], target: 'http://localhost:9000', changeOrigin: true, pathRewrite: { '^/auth': '' } },
      { context: ['/api'], target: 'http://localhost:8080', changeOrigin: true },
      ...remoteProxy
    ]
  }
};

