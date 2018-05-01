/**
 * Usage example.
 *
 * Run with `node example.js`. This should report some progress info to the
 * console and save files in the "cache" folder
 */
const fetch = require('../');

// URLs to crawl, some of which may be identical
// The API
let urls = [
  'https://api.github.com/users/tidoust',
  'https://api.github.com/repos/tidoust/fetch-filecache-for-crawling/issues',
  'https://api.github.com/users/tidoust',
  'https://api.github.com/repos/tidoust/fetch-filecache-for-crawling/issues'
]

fetch.setConfigParam('logToConsole', true);
Promise.all(urls.map(url =>
  fetch(url)
    .then(response => response.json())
    .then(json => console.log('Got some JSON'))
)).catch(err => console.error(err));