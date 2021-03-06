/**
 * HTTP error example.
 *
 * Run with `node example-error.js`. This example shows how to use the library
 * to fetch binary content.
 */
const fetch = require('../');

fetch.setParameter('logToConsole', true);
fetch('https://www.w3.org/404')
  .then(response => console.log(`HTTP response status: ${response.status}`))
  .then(_ => fetch('https://www.w3.org/404'))
  .then(response => console.log(`HTTP response status: ${response.status}`))
  .catch(err => console.error(err));