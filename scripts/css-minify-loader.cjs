/**
 * Minimal CSS minification loader for webpack.
 *
 * Uses postcss + cssnano directly, bypassing postcss-loader's
 * config-file discovery (which conflicts with postcss.config.js
 * used by tailwindcss).
 */
const postcss = require("postcss");
const cssnano = require("cssnano");

const processor = postcss([cssnano({ preset: "default" })]);

module.exports = function (source) {
  const callback = this.async();
  processor
    .process(source, { from: undefined })
    .then((result) => callback(null, result.css))
    .catch((err) => callback(err));
};
