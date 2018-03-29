/**
 * Usage example.
 *
 * Run with `node example.js`. This should report some progress info to the
 * console and save files in the "cache" folder
 */
const fetch = require('./');

// URLs to crawl, some of which may be identical
let urls = [
  'https://caniuse.com/data.json',
  'https://caniuse.com/data.json'
]

Promise.all(urls.map(url =>
  fetch(url, { logToConsole: true })
    .then(response => response.json())
    .then(json => console.log(Object.keys(json.data).length +
      ' entries in Can I Use'))
)).catch(err => console.error(err));