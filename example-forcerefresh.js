/**
 * Force refresh example
 *
 * Run with `node example-forcerefresh.js`. By default, the library considers
 * that if a URL was fetched during a crawl, the response received can be used
 * for all subsequent fetches for that URL during that crawl. The forceRefresh
 * options forces the library to send another HTTP request.
 */
const fetch = require('./');

fetch('https://api.github.com/users/tidoust', { logToConsole: true })
  .then(_ => fetch('https://api.github.com/users/tidoust', { logToConsole: true }))
  .then(_ => fetch('https://api.github.com/users/tidoust', { logToConsole: true, forceRefresh: true }))
  .catch(err => console.error(err));