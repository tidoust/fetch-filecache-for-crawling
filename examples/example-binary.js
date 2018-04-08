/**
 * Binary example
 *
 * Run with `node example-binary.js`. This example shows how to use the library
 * to fetch binary content.
 */
const fetch = require('../');

fetch('https://assets-cdn.github.com/apple-touch-icon-60x60.png', { logToConsole: true })
  .then(response => response.arrayBuffer())
  .then(buffer => console.log(`Fetched ${buffer.byteLength} bytes`))
  .catch(err => console.error(err));